import { describe, it, expect, vi, beforeEach } from 'vitest';

// read-scope-1: getAnnouncementsState filters notices by the caller's audience
// SERVER-SIDE (the client filter is cosmetic). A Client must never receive an
// Admin-only / staff-only notice body; managers (Admin or admin:config:notices)
// see all for the management tab.

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('../lib/db/common', () => {
    function builder() {
        const b: any = {};
        for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'update', 'insert', 'delete', 'upsert']) {
            b[m] = () => b;
        }
        const settle = () => Promise.resolve({ data: h.rows, error: null });
        b.single = () => Promise.resolve({ data: h.rows[0] ?? null, error: null });
        b.maybeSingle = () => Promise.resolve({ data: h.rows[0] ?? null, error: null });
        b.then = (resolve: any, reject: any) => settle().then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: () => builder(), rpc: () => Promise.resolve({ data: null, error: null }) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}), safeFetch: async () => [],
    };
});

import { getAnnouncementsState } from '../lib/db';

beforeEach(() => {
    h.rows = [
        { id: 'a1', title: 'Member notice', body: 'm', audience: ['Member'], publish_date: 't' },
        { id: 'a2', title: 'Admin only', body: 'secret', audience: ['Admin'], publish_date: 't' },
        { id: 'a3', title: 'All', body: 'x', audience: ['Member', 'Client'], publish_date: 't' },
    ];
});

const ids = (r: { announcements: Array<{ id: string }> }) => r.announcements.map(a => a.id).sort();

describe('getAnnouncementsState audience scoping', () => {
    it('a Client sees only Client-audience notices', async () => {
        const out = await getAnnouncementsState({ role: 'Client', permissions: [] });
        expect(ids(out)).toEqual(['a3']);
    });
    it('a Member sees Member-audience notices, not Admin-only', async () => {
        const out = await getAnnouncementsState({ role: 'Member', permissions: [] });
        expect(ids(out)).toEqual(['a1', 'a3']);
    });
    it('a Dispatcher inherits Member-targeted notices', async () => {
        const out = await getAnnouncementsState({ role: 'Dispatcher', permissions: [] });
        expect(ids(out)).toEqual(['a1', 'a3']);
    });
    it('an Admin sees everything', async () => {
        const out = await getAnnouncementsState({ role: 'Admin', permissions: [] });
        expect(ids(out)).toEqual(['a1', 'a2', 'a3']);
    });
    it('admin:config:notices manager sees everything', async () => {
        const out = await getAnnouncementsState({ role: 'Member', permissions: ['admin:config:notices'] });
        expect(ids(out)).toEqual(['a1', 'a2', 'a3']);
    });
    it('an absent caller sees nothing (fail closed)', async () => {
        const out = await getAnnouncementsState(null);
        expect(out.announcements).toEqual([]);
    });
});
