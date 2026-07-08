import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCommsProvider } from '../lib/comms/index';

const KEY = 'SC_OWNER_KEY_V5_PROVIDER_321';
const BASE = 'https://shard.example.com';

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}
function res(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('StarCommsProvider — V5 reads', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('getRoster: disabled → typed error, no fetch, no key', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().getRoster();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(r).toMatchObject({ ok: false, error: 'disabled' });
        expect(JSON.stringify(r)).not.toContain(KEY);
    });

    it('getRoster: GET /roster, coerces operators, no key leak', async () => {
        enableFull();
        const body = { operators: [{ userId: '123', displayName: 'Alpha', nets: ['net_a'], transport: 'webrtc', transmitting: true, connectedSince: '2026-01-01T00:00:00Z' }] };
        const fetchMock = vi.fn().mockResolvedValue(res(200, body));
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().getRoster();
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('expected ok');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/roster`);
        expect(init.method).toBe('GET');
        expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
        expect(r.data[0]).toMatchObject({ userId: '123', displayName: 'Alpha', transmitting: true });
        expect(JSON.stringify(r)).not.toContain(KEY);
    });

    it('getAssignments: GET /assignments', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, { assignments: [{ userId: '1', netUid: 'net_a' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().getAssignments();
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/assignments`);
        expect(r.ok && r.data[0].netUid).toBe('net_a');
    });

    it('getRoleNetRules: GET /rules; 401 → unauthorized, no key', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'no' })));
        const r = await getCommsProvider().getRoleNetRules();
        expect(r).toMatchObject({ ok: false, error: 'unauthorized' });
        expect(JSON.stringify(r)).not.toContain(KEY);
    });
});

describe('StarCommsProvider — V5 writes', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('assignUserToNet: POST /assignments { action: assign }', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, { ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().assignUserToNet('123', 'net_a');
        expect(r.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/assignments`);
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ userId: '123', netUid: 'net_a', action: 'assign' });
    });

    it('unassignUserFromNet: POST /assignments { action: unassign }', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, {}));
        vi.stubGlobal('fetch', fetchMock);
        await getCommsProvider().unassignUserFromNet('123', 'net_a');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ userId: '123', netUid: 'net_a', action: 'unassign' });
    });

    it('bulkApplyAssignments: POST /assignments/bulk { assignments }', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, {}));
        vi.stubGlobal('fetch', fetchMock);
        const actions = [{ userId: '1', netUid: 'net_a', action: 'assign' as const }];
        await getCommsProvider().bulkApplyAssignments(actions);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/assignments/bulk`);
        expect(JSON.parse(init.body)).toEqual({ assignments: actions });
    });

    it('bulkApplyAssignments: >200 actions is rejected without fetching', async () => {
        enableFull();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const actions = Array.from({ length: 201 }, () => ({ userId: '1', netUid: 'net_a', action: 'assign' as const }));
        const r = await getCommsProvider().bulkApplyAssignments(actions);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(r).toMatchObject({ ok: false, error: 'malformed' });
    });

    it('replaceRoleNetRules: POST /rules { rules }', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, {}));
        vi.stubGlobal('fetch', fetchMock);
        const rules = [{ roleId: '456', netUids: ['net_a'] }];
        await getCommsProvider().replaceRoleNetRules(rules);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/rules`);
        expect(JSON.parse(init.body)).toEqual({ rules });
    });

    it('createNet: POST /nets { name } → slot + uid; empty name rejected', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, { slot: 4, netUid: 'net_new', name: 'Strike Net' }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().createNet('Strike Net');
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('expected ok');
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/nets`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Strike Net' });
        expect(r.data).toEqual({ slot: 4, netUid: 'net_new', name: 'Strike Net' });

        fetchMock.mockClear();
        const empty = await getCommsProvider().createNet('   ');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(empty).toMatchObject({ ok: false, error: 'malformed' });
    });

    it('writes are blocked when the key is missing (no fetch)', async () => {
        vi.stubEnv('STARCOMMS_ENABLED', 'true');
        vi.stubEnv('STARCOMMS_BASE_URL', BASE);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const r = await getCommsProvider().replaceRoleNetRules([{ roleId: '1', netUids: [] }]);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(r).toMatchObject({ ok: false, error: 'missing_api_key' });
    });

    it('a write timeout is handled safely', async () => {
        enableFull();
        vi.stubEnv('STARCOMMS_TIMEOUT_MS', '5');
        vi.stubGlobal('fetch', (_u: string, init: { signal: AbortSignal }) => new Promise((_res, reject) => {
            init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        }));
        const r = await getCommsProvider().assignUserToNet('1', 'net_a');
        expect(r).toMatchObject({ ok: false, error: 'timeout' });
    });
});
