import { describe, it, expect, vi, beforeEach } from 'vitest';

// F11/F12/F13: server-side numeric validation on the rating + operation economy
// write paths. Each guard runs before the DB write, so an out-of-range / non-finite
// value can't poison the public rating average or corrupt the operation UEC pool.

const h = vi.hoisted(() => ({
    requestStatus: 'Success' as string,
    requestExists: true,
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const state = { op: 'select', values: null as Record<string, unknown> | null };
        const b: any = {};
        b.select = () => b;
        b.update = (v: Record<string, unknown>) => { state.op = 'update'; state.values = v; return b; };
        b.eq = () => b; b.is = () => b; b.in = () => b; b.neq = () => b; b.order = () => b; b.limit = () => b;
        const settle = () => {
            if (state.op === 'update') { h.updates.push({ table, values: state.values! }); return Promise.resolve({ data: null, error: null }); }
            if (table === 'service_requests') return Promise.resolve({ data: h.requestExists ? { status: h.requestStatus, client_id: 5 } : null, error: null });
            if (table === 'operations') return Promise.resolve({ data: { id: 'op1', owner_id: 1 }, error: null });
            if (table === 'operation_participants') return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ data: null, error: null });
        };
        b.single = () => settle(); b.maybeSingle = () => settle();
        b.then = (r: any, j: any) => settle().then(r, j);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t), rpc: (fn: string, args: unknown) => { h.rpcCalls.push({ fn, args }); return Promise.resolve({ data: null, error: null }); } },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}), safeFetch: async () => [],
    };
});
vi.mock('../lib/secrets', () => ({ getOrgSecret: async () => null }));

import { rateRequest } from '../lib/db/requests';
import { addOperationUec, setOperationPayoutSplits } from '../lib/db/ops';

beforeEach(() => { h.requestStatus = 'Success'; h.requestExists = true; h.updates = []; h.rpcCalls = []; });

describe('rateRequest validation (F11)', () => {
    it('rejects out-of-range and non-finite ratings without writing', async () => {
        for (const bad of [0, 6, -1, 2e9, NaN, Infinity]) {
            await expect(rateRequest('r1', bad as number, 'ok')).rejects.toThrow(/1.5 stars/i);
        }
        expect(h.updates.length).toBe(0);
    });
    it('rejects rating a request that is not completed', async () => {
        h.requestStatus = 'InProgress';
        await expect(rateRequest('r1', 5, 'great')).rejects.toThrow(/completed/i);
        expect(h.updates.length).toBe(0);
    });
    it('writes a clamped integer rating + HTML-stripped feedback for a completed request', async () => {
        await rateRequest('r1', 4, '<b>nice</b> work');
        const u = h.updates.find(u => u.table === 'service_requests');
        expect(u?.values.client_rating).toBe(4);
        expect(String(u?.values.client_feedback)).not.toMatch(/<b>/);
    });
});

describe('addOperationUec validation (F12)', () => {
    it('rejects negative, zero, non-finite, and absurd amounts before any RPC', async () => {
        for (const bad of [0, -100, NaN, Infinity, 2e12]) {
            await expect(addOperationUec('op1', bad as number, 'r', 1)).rejects.toThrow(/positive number/i);
        }
        expect(h.rpcCalls.length).toBe(0);
    });
});

describe('setOperationPayoutSplits validation (F13)', () => {
    it('rejects a negative per-member percent even when the total is ~100', async () => {
        await expect(setOperationPayoutSplits('op1', [{ userId: 1, percent: 150 }, { userId: 2, percent: -50 }], 1))
            .rejects.toThrow(/between 0 and 100/i);
    });
    it('rejects a non-finite percent', async () => {
        await expect(setOperationPayoutSplits('op1', [{ userId: 1, percent: NaN }], 1))
            .rejects.toThrow(/between 0 and 100/i);
    });
});
