import { describe, it, expect, vi, beforeEach } from 'vitest';

// F9/F10: caps on member-initiated HR + job applications. The per-user throttle and
// the free-text length cap bound the unbounded record-creation + recruiter push
// fan-out an authenticated account could otherwise drive; UNIQUE(applicant_id,job_id)
// (schema) stops re-applying to one posting (mapped to a friendly error here).

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const state = { op: 'select' };
        const b: any = {};
        b.select = () => b;
        b.insert = () => { state.op = 'insert'; return b; };
        b.update = () => { state.op = 'update'; return b; };
        b.eq = () => b; b.ilike = () => b; b.is = () => b; b.in = () => b; b.order = () => b; b.limit = () => b;
        const settle = () => {
            if (table === 'hr_job_postings') return Promise.resolve({ data: { title: 'Pilot', position_id: 1 }, error: null });
            if (table === 'users') return Promise.resolve({ data: { id: 5, name: 'A', discord_id: 'd', rsi_handle: 'h' }, error: null });
            if (table === 'hr_job_applications' && state.op === 'insert') return Promise.resolve({ data: null, error: hh.jobInsertError });
            if (table === 'hr_applications' && state.op === 'insert') return Promise.resolve({ data: { id: 'app1' }, error: null });
            return Promise.resolve({ data: null, error: null });
        };
        b.single = () => settle(); b.maybeSingle = () => settle();
        b.then = (r: any, j: any) => settle().then(r, j);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}), safeFetch: async () => [],
    };
});
vi.mock('../lib/push', () => ({ sendPushToUsers: async () => {} }));

const hh = vi.hoisted(() => ({ jobInsertError: null as null | { code?: string } }));

import { checkSubmissionRateLimit, _resetSubmissionRateLimit } from '../lib/submissionRateLimit';
import { createHRApplication, applyForJob } from '../lib/db/hr';

describe('submission rate limiter (F9/F10)', () => {
    beforeEach(() => _resetSubmissionRateLimit());

    it('allows 5 per minute, then blocks', () => {
        const t = 1_000_000;
        for (let i = 0; i < 5; i++) expect(checkSubmissionRateLimit(7, t).ok).toBe(true);
        expect(checkSubmissionRateLimit(7, t).ok).toBe(false);
    });

    it('resets after the minute window', () => {
        const t = 1_000_000;
        for (let i = 0; i < 5; i++) checkSubmissionRateLimit(7, t);
        expect(checkSubmissionRateLimit(7, t).ok).toBe(false);
        expect(checkSubmissionRateLimit(7, t + 61_000).ok).toBe(true);
    });

    it('enforces a daily cap (30) across separate minute windows', () => {
        let t = 1_000_000, allowed = 0;
        for (let i = 0; i < 100; i++) { if (checkSubmissionRateLimit(7, t).ok) allowed++; t += 61_000; }
        expect(allowed).toBe(30);
    });

    it('tracks users independently and fails open for a missing id', () => {
        const t = 1_000_000;
        for (let i = 0; i < 5; i++) checkSubmissionRateLimit(7, t);
        expect(checkSubmissionRateLimit(7, t).ok).toBe(false);
        expect(checkSubmissionRateLimit(8, t).ok).toBe(true);
        expect(checkSubmissionRateLimit(undefined, t).ok).toBe(true);
    });
});

describe('HR application length + duplicate guards (F9/F10)', () => {
    beforeEach(() => { hh.jobInsertError = null; });

    it('rejects an over-length application statement (createHRApplication)', async () => {
        await expect(createHRApplication({ rsiHandle: 'h', notes: 'x'.repeat(5001), userId: 1 } as any))
            .rejects.toThrow(/too long/i);
    });

    it('rejects an over-length job-application statement (applyForJob)', async () => {
        await expect(applyForJob({ jobId: 'j1', userId: 5, statement: 'x'.repeat(5001) }))
            .rejects.toThrow(/too long/i);
    });

    it('maps a duplicate job application (23505) to a friendly error', async () => {
        hh.jobInsertError = { code: '23505' };
        await expect(applyForJob({ jobId: 'j1', userId: 5, statement: 'ok' }))
            .rejects.toThrow(/already applied/i);
    });
});
