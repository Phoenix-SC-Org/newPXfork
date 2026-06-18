import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit-feed post deletion authorization (red-team s4-6). The DELETE is authorized
// against the POST's OWN unit (never a client-supplied unitId): author of the
// post, the post-unit's leader, or a moderator (units:view_all). The classic bug
// was a leader of unit A deleting a post in unit B by passing {unitId: A}.

const h = vi.hoisted(() => ({
    post: { unit_id: 2, author_id: 5 } as { unit_id: number | null; author_id: number } | null,
    unitLeaderId: 9 as number | null,
    deletes: 0,
}));

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const state = { op: 'select' };
        const b: any = {};
        b.select = () => b; b.eq = () => b; b.is = () => b; b.in = () => b; b.order = () => b; b.limit = () => b;
        b.delete = () => { state.op = 'delete'; return b; };
        const settle = () => {
            if (state.op === 'delete') { h.deletes++; return Promise.resolve({ data: null, error: null }); }
            if (table === 'unit_posts') return Promise.resolve({ data: h.post, error: null });
            if (table === 'units') return Promise.resolve({ data: h.unitLeaderId == null ? null : { leader_id: h.unitLeaderId }, error: null });
            return Promise.resolve({ data: null, error: null });
        };
        b.single = () => settle(); b.maybeSingle = () => settle();
        b.then = (resolve: any, reject: any) => settle().then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}), safeFetch: async () => [],
    };
});
vi.mock('../lib/cache', () => ({ cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: () => {} }, TTL: {} }));
vi.mock('../lib/push', () => ({ sendPushToAll: () => {} }));
vi.mock('../lib/db/seeder', () => ({ seedNewOrganization: async () => {} }));

import { deleteUnitPost } from '../lib/db/system';

beforeEach(() => { h.post = { unit_id: 2, author_id: 5 }; h.unitLeaderId = 9; h.deletes = 0; });

describe('deleteUnitPost authorization', () => {
    it('the author may delete their own post', async () => {
        await deleteUnitPost('p1', { id: 5, permissions: [] });
        expect(h.deletes).toBe(1);
    });
    it("the post-unit's leader may delete it", async () => {
        await deleteUnitPost('p1', { id: 9, permissions: [] }); // unit 2's leader
        expect(h.deletes).toBe(1);
    });
    it('a moderator (units:view_all) may delete any post', async () => {
        await deleteUnitPost('p1', { id: 123, permissions: ['units:view_all'] });
        expect(h.deletes).toBe(1);
    });
    it('a non-author, non-leader, non-moderator is refused', async () => {
        await expect(deleteUnitPost('p1', { id: 123, permissions: [] })).rejects.toThrow(/not authorized/i);
        expect(h.deletes).toBe(0);
    });
    it('a leader of a DIFFERENT unit cannot delete this post (cross-unit hole closed)', async () => {
        // Actor 9 leads unit A, but the post lives in unit 2 whose leader is 50.
        h.unitLeaderId = 50;
        await expect(deleteUnitPost('p1', { id: 9, permissions: [] })).rejects.toThrow(/not authorized/i);
        expect(h.deletes).toBe(0);
    });
    it('no-op (no throw) when the post is already gone', async () => {
        h.post = null;
        await expect(deleteUnitPost('p1', { id: 1, permissions: [] })).resolves.toBeUndefined();
        expect(h.deletes).toBe(0);
    });
});
