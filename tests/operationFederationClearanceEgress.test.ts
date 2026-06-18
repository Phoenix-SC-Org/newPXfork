import { describe, it, expect, vi, beforeEach } from 'vitest';

// fed-leak-1: the joint-op federation egress must enforce the per-peer outbound
// clearance ceiling (the lesser of the org-wide max and the peer's
// outbound_max_clearance) — exactly as intel does. An op above the ceiling must
// project to null (suppressed), and inviting such an op to that peer must throw.

const h = vi.hoisted(() => ({
    opClearance: 0,
    globalMax: 5,
    peerMax: 0,
    peerActiveOps: true,
}));

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const b: any = {};
        b.select = () => b; b.eq = () => b; b.is = () => b; b.in = () => b; b.order = () => b; b.limit = () => b; b.not = () => b;
        b.update = () => b; b.upsert = () => b; b.insert = () => b; b.delete = () => b;
        const data = () => {
            if (table === 'operation_limiting_markers') return [];
            if (table === 'alliance_peers') return { status: h.peerActiveOps ? 'Active' : 'Inactive', channels: { operations: h.peerActiveOps }, outbound_max_clearance: h.peerMax };
            if (table === 'operations') return { joint_version: 1, is_joint: true };
            return null;
        };
        const settle = () => Promise.resolve({ data: data(), error: null });
        b.single = () => settle(); b.maybeSingle = () => settle();
        b.then = (resolve: any, reject: any) => settle().then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, safeFetch: async () => [],
    };
});
vi.mock('../lib/db/ops', () => ({
    getFullOperationDetails: async (id: string) => ({ id, name: 'Op', clearanceLevel: h.opClearance, participants: [], tasks: [], commandNodes: [], logistics: [], commsPlan: [], limitingMarkers: [] }),
}));
vi.mock('../lib/db/system', () => ({ getMaxShareableClearance: async () => h.globalMax }));
vi.mock('../lib/db/mappers', () => ({ toMirroredOperation: (r: Record<string, unknown>) => r }));
vi.mock('../lib/db/alliances', () => ({ callAlliancePeer: async () => null }));
vi.mock('../lib/db/allianceSyncState', () => ({
    scheduleDebounced: () => {}, cancelDebounced: () => {}, tryConsumeToken: () => true,
    getCachedAllianceSyncConfig: () => ({}), recordPeerFailure: () => {}, recordPeerSuccess: () => {},
}));

import { buildOperationSnapshot, inviteAllyToOperation } from '../lib/db/operations-federation';

beforeEach(() => { h.opClearance = 0; h.globalMax = 5; h.peerMax = 0; h.peerActiveOps = true; });

describe('buildOperationSnapshot clearance ceiling (fed-leak-1)', () => {
    it('suppresses (null) an op above the peer ceiling', async () => {
        h.opClearance = 5; h.peerMax = 0; h.globalMax = 5; // min(5,0)=0, 5>0
        expect(await buildOperationSnapshot('op1', 'peerA')).toBeNull();
    });
    it('shares an op at/below the peer ceiling', async () => {
        h.opClearance = 3; h.peerMax = 5; h.globalMax = 5; // min=5, 3<=5
        expect(await buildOperationSnapshot('op1', 'peerA')).not.toBeNull();
    });
    it('respects the org-wide ceiling even when the peer ceiling is higher', async () => {
        h.opClearance = 3; h.peerMax = 5; h.globalMax = 2; // min=2, 3>2
        expect(await buildOperationSnapshot('op1', 'peerA')).toBeNull();
    });
    it('an unclassified op is always shareable', async () => {
        h.opClearance = 0; h.peerMax = 0;
        expect(await buildOperationSnapshot('op1', 'peerA')).not.toBeNull();
    });
});

describe('inviteAllyToOperation refuses an over-classified op (defense-in-depth)', () => {
    it('throws instead of inviting/sharing when the op exceeds the peer ceiling', async () => {
        h.opClearance = 5; h.peerMax = 0;
        await expect(inviteAllyToOperation('op1', 'peerA')).rejects.toThrow(/cannot be shared/i);
    });
});
