import { describe, it, expect, vi, beforeEach } from 'vitest';

// dos-2: fleet:add_ships must bound write amplification — a per-request cap and a
// per-user hangar ceiling (there is intentionally NO UNIQUE(user_id, ship_id),
// since owning duplicate hulls is legitimate, so the count ceiling is the guard).

const h = vi.hoisted(() => ({ existingCount: 0, inserts: 0 }));

vi.mock('../lib/db/common', () => {
    function builder(_table: string) {
        let isCount = false;
        const b: any = {};
        b.select = (_c?: unknown, opts?: { head?: boolean; count?: string }) => { if (opts?.head) isCount = true; return b; };
        b.eq = () => b; b.order = () => b; b.limit = () => b;
        b.insert = () => { h.inserts++; return Promise.resolve({ error: null }); };
        b.then = (resolve: any, reject: any) =>
            Promise.resolve(isCount ? { count: h.existingCount, data: null, error: null } : { data: [], error: null }).then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, safeFetch: async () => [],
    };
});

import { addUserShips } from '../lib/db/fleet';

beforeEach(() => { h.existingCount = 0; h.inserts = 0; });

describe('addUserShips caps', () => {
    it('rejects a batch larger than the per-request cap', async () => {
        const ids = Array.from({ length: 101 }, (_, i) => i + 1);
        await expect(addUserShips(1, ids)).rejects.toThrow(/too many ships/i);
        expect(h.inserts).toBe(0);
    });
    it('rejects when the batch would exceed the per-user hangar ceiling', async () => {
        h.existingCount = 999;
        await expect(addUserShips(1, [1, 2, 3])).rejects.toThrow(/hangar limit/i);
        expect(h.inserts).toBe(0);
    });
    it('inserts a normal batch under the limits', async () => {
        h.existingCount = 10;
        await addUserShips(1, [101, 102]);
        expect(h.inserts).toBe(1);
    });
    it('is a no-op for an empty batch', async () => {
        await addUserShips(1, []);
        expect(h.inserts).toBe(0);
    });
});
