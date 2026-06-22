import { describe, it, expect, vi, beforeEach } from 'vitest';

// appointPositionHolder: appointee-existence guard (s4-8b — a permission-granting
// write on a non-forced client userId) + atomic max_holders appointment (race-2,
// via the gov_appoint_holder FOR UPDATE RPC) with a soft-fallback when the RPC
// isn't deployed yet.

const h = vi.hoisted(() => ({
    appointeeExists: true,
    // Default target seat: an ordinary appointed office with no apex powers.
    position: { max_holders: 5, fill_method: 'Appointed', can_veto_legislation: false, can_call_elections: false } as Record<string, unknown>,
    // Powers of the seat behind a holder being removed (G2 removePositionHolder gate).
    holderPosition: null as null | { can_veto_legislation?: boolean; can_call_elections?: boolean },
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
            if (table === 'government_positions') return h.position;
            // Superset row: flat holder fields for the appointment fetch + a `position`
            // embed for the removePositionHolder apex check.
            if (table === 'government_position_holders') return { id: 50, position_id: 3, user_id: 1, appointed_by_id: 2, election_id: null, started_at: 't', ended_at: null, position: h.holderPosition };
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

import { appointPositionHolder, removePositionHolder } from '../lib/db/government/structure';

beforeEach(() => {
    h.appointeeExists = true;
    h.position = { max_holders: 5, fill_method: 'Appointed', can_veto_legislation: false, can_call_elections: false };
    h.holderPosition = null;
    h.rpcResult = { data: 50, error: null };
    h.rpcCalls = [];
});

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

describe('appointPositionHolder authority ceiling (G2)', () => {
    it('refuses to hand-appoint an elected seat (must come through an election)', async () => {
        h.position = { max_holders: 1, fill_method: 'Elected', can_veto_legislation: true, can_call_elections: true };
        await expect(appointPositionHolder({ userId: 1, positionId: 3 }, { role: 'Member', permissions: ['gov:manage'] }))
            .rejects.toThrow(/filled by elected, not by direct appointment/i);
        expect(h.rpcCalls.length).toBe(0);
    });

    it('refuses a non-admin appointing into an apex (veto/call-elections) appointed seat', async () => {
        h.position = { max_holders: 1, fill_method: 'Appointed', can_veto_legislation: false, can_call_elections: true };
        await expect(appointPositionHolder({ userId: 1, positionId: 3 }, { role: 'Member', permissions: ['gov:manage'] }))
            .rejects.toThrow(/requires an administrator/i);
        expect(h.rpcCalls.length).toBe(0);
    });

    it('refuses the seeded Dispatcher (gov:manage + admin:access, role Dispatcher) — the apex carve-out is the Admin ROLE, not admin:access', async () => {
        h.position = { max_holders: 1, fill_method: 'Appointed', can_veto_legislation: true, can_call_elections: true };
        await expect(appointPositionHolder({ userId: 1, positionId: 3 }, { role: 'Dispatcher', permissions: ['gov:manage', 'admin:access'] }))
            .rejects.toThrow(/requires an administrator/i);
        expect(h.rpcCalls.length).toBe(0);
    });

    it('allows an org admin to appoint into an apex appointed seat', async () => {
        h.position = { max_holders: 1, fill_method: 'Appointed', can_veto_legislation: true, can_call_elections: true };
        const res = await appointPositionHolder({ userId: 1, positionId: 3 }, { role: 'Admin', permissions: [] });
        expect(h.rpcCalls.some((c) => c.fn === 'gov_appoint_holder')).toBe(true);
        expect(res).toBeTruthy();
    });

    it('exempts the election-conclusion path (electionId set) from the ceiling', async () => {
        // An elected apex seat being filled by its own concluded election must succeed
        // even though a manual appointment of the same seat would be refused.
        h.position = { max_holders: 1, fill_method: 'Elected', can_veto_legislation: true, can_call_elections: true };
        const res = await appointPositionHolder({ userId: 1, positionId: 3, electionId: 99 });
        expect(h.rpcCalls.some((c) => c.fn === 'gov_appoint_holder')).toBe(true);
        expect(res).toBeTruthy();
    });
});

describe('removePositionHolder apex gate (G2)', () => {
    it('refuses a non-admin removing the holder of an apex office', async () => {
        h.holderPosition = { can_veto_legislation: true, can_call_elections: false };
        await expect(removePositionHolder(50, 'removed', { role: 'Member', permissions: ['gov:manage'] }))
            .rejects.toThrow(/requires an administrator/i);
    });

    it('refuses the seeded Dispatcher (admin:access but role Dispatcher) from removing an apex holder', async () => {
        h.holderPosition = { can_veto_legislation: false, can_call_elections: true };
        await expect(removePositionHolder(50, 'removed', { role: 'Dispatcher', permissions: ['gov:manage', 'admin:access'] }))
            .rejects.toThrow(/requires an administrator/i);
    });

    it('allows removing the holder of an ordinary office', async () => {
        h.holderPosition = { can_veto_legislation: false, can_call_elections: false };
        await expect(removePositionHolder(50, 'removed', { role: 'Member', permissions: ['gov:manage'] }))
            .resolves.toBeUndefined();
    });

    it('allows an org admin to remove an apex holder', async () => {
        h.holderPosition = { can_veto_legislation: true, can_call_elections: true };
        await expect(removePositionHolder(50, 'removed', { role: 'Admin', permissions: [] }))
            .resolves.toBeUndefined();
    });
});
