import { describe, it, expect, beforeEach, vi } from 'vitest';

// =============================================================================
// Academy (LMS) — security regressions (single-org)
// =============================================================================
// Behaviour-true-ish Supabase stub: each .from(table) returns a chainable builder
// whose terminal maybeSingle()/single() resolve to a per-table seeded ROW, and
// whose bare-await resolves to a per-table seeded LIST + COUNT. Tests seed
// h.rows / h.lists / h.counts to steer the academy guards under test.
// academy.ts imports supabase/handleSupabaseError/broadcastToOrg from './common.js'
// and awardCertification/getOrgFeatures from './system.js', createNotification from
// './notifications.js' — all mocked here (SecurityDenial comes from the real errors).
//
// Single-org: the multi-tenant "requires organizationId (fail closed)" cases are GONE
// (there is no org param). What remains — the cert-award escalation double gate,
// self-enrol gating + capacity, and resource-BOLA — are the load-bearing controls.
const h = vi.hoisted(() => {
    const rows = new Map<string, unknown>();
    const lists = new Map<string, unknown[]>();
    const counts = new Map<string, number>();
    const makeBuilder = (table: string) => {
        const b: Record<string, unknown> = {};
        const chain = () => b;
        for (const m of ['select', 'eq', 'in', 'neq', 'not', 'is', 'order', 'limit', 'range', 'insert', 'update', 'delete', 'upsert']) b[m] = chain;
        b.maybeSingle = async () => ({ data: rows.get(table) ?? null, error: null });
        b.single = async () => ({ data: rows.get(table) ?? null, error: null });
        b.then = (resolve: (v: unknown) => unknown) => resolve({ data: lists.get(table) ?? [], error: null, count: counts.get(table) ?? 0 });
        return b;
    };
    const supabaseStub = { from: (t: string) => makeBuilder(t) };
    // Award stub lives inside vi.hoisted so it's initialised before the hoisted
    // vi.mock factory below references it.
    const awardCertification = vi.fn(async () => undefined);
    return { rows, lists, counts, supabaseStub, awardCertification };
});

vi.mock('../lib/db/common.js', () => ({
    supabase: h.supabaseStub,
    handleSupabaseError: ({ error }: { error: unknown }) => { if (error) throw error; },
    broadcastToOrg: () => Promise.resolve(),
    safeFetch: async (query: PromiseLike<{ data: unknown; error: unknown }>, fallback: unknown) => {
        const { data, error } = await query; return error ? fallback : (data ?? fallback);
    },
}));
// Stub the award path — the escalation tests deny BEFORE it would ever be called;
// the idempotency test asserts it is NOT called for an already-completed enrolment.
vi.mock('../lib/db/system.js', () => ({
    awardCertification: h.awardCertification,
    getOrgFeatures: async () => ({ academy: { enabled: true } }),
}));
vi.mock('../lib/db/notifications.js', () => ({ createNotification: async () => null }));

import {
    setCourseCertification, certifyAndComplete, updateCourse, selfEnroll,
} from '../lib/db/academy';
import { SecurityDenial } from '../lib/errors';

beforeEach(() => { h.rows.clear(); h.lists.clear(); h.counts.clear(); h.awardCertification.mockClear(); });

// The novel control: linking OR awarding a course certification requires
// admin:award:certification (canAward), composed on top of academy:manage.
describe('academy — certification-award escalation gate', () => {
    it('setCourseCertification denies without cert-award authority', async () => {
        h.rows.set('academy_courses', { id: 'c1', status: 'draft', access: 'gated', delivery: 'cohort', certification_id: null, created_by: 1 });
        await expect(setCourseCertification('c1', 9, 1, /* canAward */ false))
            .rejects.toThrow(/Award Certification permission/);
    });

    it('certifyAndComplete denies awarding a cert without cert-award authority', async () => {
        h.rows.set('academy_enrollments', { id: 'e1', session_id: 's1', student_id: 2, status: 'in_progress' });
        h.rows.set('academy_sessions', { id: 's1', course_id: 'c1', status: 'in_progress', capacity: null, enrollment_open: true });
        h.rows.set('academy_courses', { id: 'c1', status: 'published', access: 'gated', delivery: 'cohort', certification_id: 9, created_by: 1 });
        h.lists.set('academy_outcomes', []); // no required outcomes → allRequiredOutcomesCompetent() true
        await expect(certifyAndComplete('e1', 1, /* canAward */ false))
            .rejects.toThrow(/Award Certification permission/);
        expect(h.awardCertification).not.toHaveBeenCalled();
    });
});

// A2 idempotency (belt-and-braces): certifying an ALREADY-completed enrolment is a
// no-op — it must not re-award the certification.
describe('academy — certify idempotency', () => {
    it('certifyAndComplete no-ops (no re-award) on an already-completed enrolment', async () => {
        h.rows.set('academy_enrollments', { id: 'e1', session_id: 's1', student_id: 2, status: 'completed' });
        h.rows.set('academy_sessions', { id: 's1', course_id: 'c1', status: 'in_progress', capacity: null, enrollment_open: true });
        h.rows.set('academy_courses', { id: 'c1', status: 'published', access: 'gated', delivery: 'cohort', certification_id: 9, created_by: 1 });
        await expect(certifyAndComplete('e1', 1, /* canAward */ true)).resolves.toBeUndefined();
        expect(h.awardCertification).not.toHaveBeenCalled();
    });
});

// Resource-BOLA: a by-id write on a resource that doesn't exist (a would-be
// foreign id under multi-tenancy) is denied — loadCourse returns nothing →
// SecurityDenial, even for a manager.
describe('academy — resource BOLA', () => {
    it('updateCourse denies an unknown course', async () => {
        h.rows.set('academy_courses', null);
        await expect(updateCourse('missing-course', 1, /* canManage */ true, { title: 'x' }))
            .rejects.toBeInstanceOf(SecurityDenial);
    });
});

// Self-enrol respects course gating + session capacity (server-enforced, never just UI).
describe('academy — self-enrol gating + capacity', () => {
    it('denies self-enrol into a gated course', async () => {
        h.rows.set('academy_sessions', { id: 's1', course_id: 'c1', status: 'scheduled', capacity: null, enrollment_open: true });
        h.rows.set('academy_courses', { id: 'c1', status: 'published', access: 'gated', delivery: 'cohort', certification_id: null, created_by: 1 });
        await expect(selfEnroll('s1', 2)).rejects.toThrow(/not open for self-enrolment/);
    });

    it('denies self-enrol when the session is at capacity', async () => {
        h.rows.set('academy_sessions', { id: 's1', course_id: 'c1', status: 'scheduled', capacity: 1, enrollment_open: true });
        h.rows.set('academy_courses', { id: 'c1', status: 'published', access: 'open', delivery: 'cohort', certification_id: null, created_by: 1 });
        h.counts.set('academy_enrollments', 1); // already full
        await expect(selfEnroll('s1', 2)).rejects.toThrow(/full/);
    });
});
