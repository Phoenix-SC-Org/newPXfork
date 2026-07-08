import { describe, it, expect, vi, afterEach } from 'vitest';
import { starcommsActions } from '../api/actions/starcomms';
import { fullPermissionMap } from '../api/services';

const KEY = 'SC_OWNER_KEY_V5_ACTIONS_444';
const BASE = 'https://shard.example.com';

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}
function res(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}
/** Fetch mock routed by `${METHOD} ${path}`; unrouted calls resolve to 200 {}. */
function routed(routes: Record<string, Response>) {
    return vi.fn((url: string, init?: { method?: string }) => {
        const path = String(url).replace(BASE, '');
        const method = init?.method || 'GET';
        return Promise.resolve(routes[`${method} ${path}`] ?? res(200, {}));
    });
}
const calls = (m: ReturnType<typeof vi.fn>) => m.mock.calls.map((c) => `${(c[1]?.method) || 'GET'} ${String(c[0]).replace(BASE, '')}`);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('StarComms V5 — permission map', () => {
    it('gates all new actions on admin:access', () => {
        for (const a of [
            'admin:starcomms_apply_net_preset', 'admin:starcomms_v5_state',
            'admin:starcomms_preview_role_net_rules', 'admin:starcomms_apply_role_net_rules',
            'admin:starcomms_preview_assignments', 'admin:starcomms_apply_assignments',
        ]) {
            expect(fullPermissionMap[a]).toBe('admin:access');
        }
    });
});

describe('V4 apply repair — admin:starcomms_apply_net_preset', () => {
    it('creates ONLY missing nets via POST /api/v1/nets; no key leak', async () => {
        enableFull();
        const fetchMock = routed({
            'GET /api/v1/status': res(200, { nets: [{ id: 'n1', name: 'Command' }] }),
            'POST /api/v1/nets': res(200, { slot: 2, netUid: 'net_x', name: 'x' }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_apply_net_preset']({ presetId: 'standard' }) as { ok: boolean; created: number; skipped: number };
        // standard = Command, Flight, Ground, Logistics, Medical, Intel → 1 exists, 5 created
        expect(out.ok).toBe(true);
        expect(out.created).toBe(5);
        expect(out.skipped).toBe(1);
        expect(calls(fetchMock).filter((c) => c === 'POST /api/v1/nets')).toHaveLength(5);
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('is blocked (no fetch) when disabled', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_apply_net_preset']({ presetId: 'standard' }) as { ok: boolean; error: { kind: string } };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.error.kind).toBe('disabled');
    });
});

describe('V5 role-to-net rules', () => {
    it('preview does NOT POST /rules and flags missing nets', async () => {
        enableFull();
        const fetchMock = routed({
            'GET /api/v1/rules': res(200, { rules: [{ roleId: '1', netUids: ['net_a'] }] }),
            'GET /api/v1/status': res(200, { nets: [{ id: 'net_a', name: 'A' }] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_role_net_rules']({ rules: [{ roleId: '2', netUids: ['net_missing'] }] }) as { ok: boolean; preview: { missingNetUids: string[]; warnings: string[] } };
        expect(out.ok).toBe(true);
        expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
        expect(out.preview.missingNetUids).toContain('net_missing');
        expect(out.preview.warnings).toContain('rules-replace');
    });

    it('apply requires confirmation (no write without confirm)', async () => {
        enableFull();
        const fetchMock = routed({});
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_apply_role_net_rules']({ rules: [{ roleId: '1', netUids: ['net_a'] }] }) as { ok: boolean; error: { kind: string } };
        expect(out.ok).toBe(false);
        expect(out.error.kind).toBe('not_confirmed');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('apply with confirm POSTs /api/v1/rules with { rules }', async () => {
        enableFull();
        const fetchMock = routed({ 'POST /api/v1/rules': res(200, {}) });
        vi.stubGlobal('fetch', fetchMock);
        const rules = [{ roleId: '456', netUids: ['net_a'] }];
        const out = await starcommsActions['admin:starcomms_apply_role_net_rules']({ rules, confirm: true }) as { ok: boolean };
        expect(out.ok).toBe(true);
        const postCall = fetchMock.mock.calls.find((c) => (c[1]?.method) === 'POST');
        expect(String(postCall?.[0])).toBe(`${BASE}/api/v1/rules`);
        expect(JSON.parse((postCall?.[1] as { body: string }).body)).toEqual({ rules });
    });
});

describe('V5 assignments', () => {
    it('preview does NOT write and detects unknown users / missing nets', async () => {
        enableFull();
        const fetchMock = routed({
            'GET /api/v1/assignments': res(200, { assignments: [] }),
            'GET /api/v1/roster': res(200, { operators: [{ userId: '111', displayName: 'A', nets: [] }] }),
            'GET /api/v1/status': res(200, { nets: [{ id: 'net_a', name: 'A' }] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_assignments']({ actions: [{ userId: '999', netUid: 'net_missing', action: 'assign' }] }) as { ok: boolean; preview: { toApply: unknown[]; unknownUsers: string[]; missingNets: string[] } };
        expect(out.ok).toBe(true);
        expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
        expect(out.preview.unknownUsers).toContain('999');
        expect(out.preview.missingNets).toContain('net_missing');
        expect(out.preview.toApply).toHaveLength(1);
    });

    it('apply requires confirmation', async () => {
        enableFull();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_apply_assignments']({ actions: [{ userId: '1', netUid: 'net_a', action: 'assign' }] }) as { ok: boolean; error: { kind: string } };
        expect(out.ok).toBe(false);
        expect(out.error.kind).toBe('not_confirmed');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('single confirmed assign POSTs /api/v1/assignments', async () => {
        enableFull();
        const fetchMock = routed({ 'POST /api/v1/assignments': res(200, {}) });
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_apply_assignments']({ actions: [{ userId: '1', netUid: 'net_a', action: 'assign' }], confirm: true }) as { ok: boolean; applied: number };
        expect(out.ok).toBe(true);
        expect(out.applied).toBe(1);
        expect(calls(fetchMock)).toContain('POST /api/v1/assignments');
    });

    it('multiple confirmed actions use /assignments/bulk', async () => {
        enableFull();
        const fetchMock = routed({ 'POST /api/v1/assignments/bulk': res(200, {}) });
        vi.stubGlobal('fetch', fetchMock);
        const actions = [
            { userId: '1', netUid: 'net_a', action: 'assign' as const },
            { userId: '2', netUid: 'net_b', action: 'unassign' as const },
        ];
        const out = await starcommsActions['admin:starcomms_apply_assignments']({ actions, confirm: true }) as { ok: boolean };
        expect(out.ok).toBe(true);
        expect(calls(fetchMock)).toContain('POST /api/v1/assignments/bulk');
    });
});

describe('V5 state read — admin:starcomms_v5_state', () => {
    it('returns per-section data and surfaces a 401 as a section error (missing scope), no key leak', async () => {
        enableFull();
        const fetchMock = routed({
            'GET /api/v1/status': res(200, { nets: [] }),
            'GET /api/v1/roster': res(200, { operators: [{ userId: '1', displayName: 'A', nets: [] }] }),
            'GET /api/v1/assignments': res(401, { error: 'scope' }),
            'GET /api/v1/rules': res(200, { rules: [] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_v5_state']() as { roster: unknown[] | null; assignments: unknown[] | null; errors: { assignments: { kind: string } | null } };
        expect(out.roster).toHaveLength(1);
        expect(out.assignments).toBeNull();
        expect(out.errors.assignments?.kind).toBe('unauthorized');
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('is safe (no fetch) when disabled', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_v5_state']() as { roster: unknown };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.roster).toBeNull();
    });
});
