import { describe, it, expect, vi, afterEach } from 'vitest';
import { readSyncConfig, computeSyncSuggestions, type SyncConfigSummary } from '../lib/comms/syncPlanner';
import { starcommsActions } from '../api/actions/starcomms';
import { fullPermissionMap } from '../api/services';
import type { CommsStatus } from '../lib/comms/types';

const KEY = 'SC_OWNER_KEY_V6_555';
const BASE = 'https://shard.example.com';

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}
function res(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}
function statusWith(over: Partial<CommsStatus>): CommsStatus {
    return {
        guildId: 'g', guildName: 'G', shard: { publicUrl: null, version: '1' },
        connectedOperators: 0, operationOpen: false, nets: [], features: {}, ...over,
    };
}
const allOn: SyncConfigSummary = {
    operationState: true, netPreset: true, roleNetRules: true, assignments: true,
    mode: 'suggested', minIntervalSeconds: 30, anyEnabled: true,
};
const allOff: SyncConfigSummary = {
    operationState: false, netPreset: false, roleNetRules: false, assignments: false,
    mode: 'suggested', minIntervalSeconds: 30, anyEnabled: false,
};

// --- readSyncConfig ----------------------------------------------------------

describe('syncPlanner — readSyncConfig (all default OFF)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('defaults every sync flag to false when unset', () => {
        const c = readSyncConfig();
        expect(c.operationState).toBe(false);
        expect(c.netPreset).toBe(false);
        expect(c.roleNetRules).toBe(false);
        expect(c.assignments).toBe(false);
        expect(c.anyEnabled).toBe(false);
        expect(c.mode).toBe('suggested');
        expect(c.minIntervalSeconds).toBe(30);
    });

    it('reads explicit enables', () => {
        vi.stubEnv('STARCOMMS_SYNC_OPERATION_STATE', 'true');
        vi.stubEnv('STARCOMMS_SYNC_MIN_INTERVAL_SECONDS', '60');
        const c = readSyncConfig();
        expect(c.operationState).toBe(true);
        expect(c.anyEnabled).toBe(true);
        expect(c.minIntervalSeconds).toBe(60);
    });
});

// --- Pure planner (side-effect free) ----------------------------------------

describe('syncPlanner — computeSyncSuggestions (pure, no writes)', () => {
    it('produces no suggestions when all flags are OFF (even if op active + closed)', () => {
        const out = computeSyncSuggestions(allOff, statusWith({ operationOpen: false }), true);
        expect(out).toEqual([]);
    });

    it('suggests operation-open when a myRSI op is active and StarComms is closed', () => {
        const out = computeSyncSuggestions(allOn, statusWith({ operationOpen: false }), true);
        const s = out.find((x) => x.kind === 'operation-open');
        expect(s).toBeTruthy();
        expect(s?.actionable).toBe(true);
        expect(s?.action).toBe('open');
    });

    it('suggests operation-close when StarComms is open and no myRSI op is active', () => {
        const out = computeSyncSuggestions(allOn, statusWith({ operationOpen: true }), false);
        const s = out.find((x) => x.kind === 'operation-close');
        expect(s?.actionable).toBe(true);
        expect(s?.action).toBe('close');
    });

    it('does NOT suggest open when StarComms is already open and op is active', () => {
        const out = computeSyncSuggestions(allOn, statusWith({ operationOpen: true }), true);
        expect(out.find((x) => x.kind === 'operation-open')).toBeUndefined();
        expect(out.find((x) => x.kind === 'operation-close')).toBeUndefined();
    });

    it('role-net and assignment suggestions are review-only (not actionable)', () => {
        const out = computeSyncSuggestions(allOn, statusWith({ operationOpen: true }), true);
        expect(out.find((x) => x.kind === 'role-net-rules')?.actionable).toBe(false);
        expect(out.find((x) => x.kind === 'assignments')?.actionable).toBe(false);
    });

    it('returns nothing when status is unavailable', () => {
        expect(computeSyncSuggestions(allOn, null, true)).toEqual([]);
    });
});

// --- Read-only sync_plan action ---------------------------------------------

describe('StarComms V6 — sync_plan action (read-only)', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('gates on admin:access', () => {
        expect(fullPermissionMap['admin:starcomms_sync_plan']).toBe('admin:access');
    });

    it('returns disabled state without fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_sync_plan']({ operationActive: true }) as { status: unknown; suggestions: unknown[] };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.status).toBeNull();
        expect(out.suggestions).toEqual([]);
    });

    it('with all sync flags OFF, produces no suggestions even when configured/active', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { operationOpen: false })));
        const out = await starcommsActions['admin:starcomms_sync_plan']({ operationActive: true }) as { suggestions: unknown[]; sync: { anyEnabled: boolean } };
        expect(out.sync.anyEnabled).toBe(false);
        expect(out.suggestions).toEqual([]);
    });

    it('reads GET /status only (never a write) and suggests open; no key leak', async () => {
        enableFull();
        vi.stubEnv('STARCOMMS_SYNC_OPERATION_STATE', 'true');
        const fetchMock = vi.fn().mockResolvedValue(res(200, { operationOpen: false, nets: [] }));
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_sync_plan']({ operationActive: true }) as {
            suggestions: { kind: string; actionable: boolean }[];
        };
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/status`);
        expect(init.method).toBe('GET');
        expect(out.suggestions.some((s) => s.kind === 'operation-open' && s.actionable)).toBe(true);
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('surfaces a 401 during planning without leaking the key', async () => {
        enableFull();
        vi.stubEnv('STARCOMMS_SYNC_OPERATION_STATE', 'true');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'no' })));
        const out = await starcommsActions['admin:starcomms_sync_plan']({ operationActive: true }) as { error: { kind: string } | null; suggestions: unknown[] };
        expect(out.error?.kind).toBe('unauthorized');
        expect(out.suggestions).toEqual([]);
        expect(JSON.stringify(out)).not.toContain(KEY);
    });
});
