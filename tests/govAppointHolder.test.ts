import { describe, it, expect, vi, beforeEach } from 'vitest';

// appointPositionHolder: appointee-existence guard (s4-8b — a permission-granting
// write on a non-forced client userId) + atomic max_holders appointment (race-2,
// via the gov_appoint_holder FOR UPDATE RPC) with a soft-fallback when the RPC
// isn't deployed yet.

const h = vi.hoisted(() => ({
    appointeeExists: true,
    rpcResult: { data: null as unknown, error: null as unknown },
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const b: any = {};
        for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'update', 'insert', 'delete', 'upsert']) {
            b[m] = () => b;
        }
        const data = () => {
            if (table === 'users') return h.appointeeExists ? { id: 1 } : null;
            if (table === 'government_positions') return { max_holders: 5 };
            if (table === 'government_position_holders') return { id: 50, position_id: 3, user_id: 1, appointed_by_id: 2, election_id: null, started_at: 't', ended_at: null };
            return null;
        };
        b.single = () => Promise.resolve({ data: data(), error: null });
        b.maybeSingle = () => Promise.resolve({ data: data(), error: null });
        b.then = (r: any) => Promise.resolve({ data: data(), error: null, count: 0 }).then(r);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t), rpc: (fn: string, args: unknown) => { h.rpcCalls.push({ fn, args }); return Promise.resolve(h.rpcResult); } },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, safeFetch: async () => [], getSystemRoles: async () => ({}),
    };
});

import { appointPositionHolder } from '../lib/db/government/structure';

beforeEach(() => { h.appointeeExists = true; h.rpcResult = { data: 50, error: null }; h.rpcCalls = []; });

describe('appointPositionHolder appointee guard (s4-8b)', () => {
    it('rejects a non-finite appointee id', async () => {
        await expect(appointPositionHolder({ userId: 1.5 as number, positionId: 3 })).rejects.toThrow(/invalid appointee/i);
    });
    it('rejects a non-existent / deleted appointee', async () => {
        h.appointeeExists = false;
        await expect(appointPositionHolder({ userId: 999, positionId: 3 })).rejects.toThrow(/not a valid member/i);
        expect(h.rpcCalls.length).toBe(0); // never reaches the appointment
    });
});

describe('appointPositionHolder atomic appointment (race-2)', () => {
    it('appoints via the gov_appoint_holder RPC for a valid member', async () => {
        const res = await appointPositionHolder({ userId: 1, positionId: 3, appointedById: 2 });
        expect(h.rpcCalls.some((c) => c.fn === 'gov_appoint_holder')).toBe(true);
        expect(res).toBeTruthy();
    });
    it('maps position_full / already_holds RPC errors', async () => {
        h.rpcResult = { data: null, error: { message: 'position_full' } };
        await expect(appointPositionHolder({ userId: 1, positionId: 3 })).rejects.toThrow(/position is full/i);
        h.rpcResult = { data: null, error: { message: 'already_holds' } };
        await expect(appointPositionHolder({ userId: 1, positionId: 3 })).rejects.toThrow(/already holds/i);
    });
    it('falls back to the non-atomic path when the RPC is not deployed', async () => {
        h.rpcResult = { data: null, error: { code: 'PGRST202', message: 'missing' } };
        const res = await appointPositionHolder({ userId: 1, positionId: 3 });
        expect(res).toBeTruthy(); // fallback insert path returns the mapped holder
    });
});
