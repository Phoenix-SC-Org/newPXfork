import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCommsProvider, describeCommsConfig } from '../lib/comms/index';
import { starcommsActions } from '../api/actions/starcomms';
import { fullPermissionMap } from '../api/services';

const KEY = 'SC_OWNER_KEY_SECRET_123';
const BASE = 'https://shard.example.com';
const OK_BODY = {
    guildId: 'g-42',
    guildName: 'Phoenix',
    shard: { publicUrl: 'https://shard.example.com', version: '1.4.2' },
    connectedOperators: 4,
    operationOpen: true,
    nets: [{ id: 'n1', name: 'Command' }, { id: 'n2', name: 'Fleet' }],
    features: { push_to_talk: true, recording: false },
};

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}

/** Minimal Response-like stub. */
function res(status: number, body: unknown, opts: { nonJson?: boolean } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: opts.nonJson ? () => Promise.reject(new Error('not json')) : () => Promise.resolve(body),
    } as unknown as Response;
}

describe('StarComms — permission mapping', () => {
    it('gates both actions on admin:access', () => {
        expect(fullPermissionMap['admin:starcomms_status']).toBe('admin:access');
        expect(fullPermissionMap['admin:starcomms_test']).toBe('admin:access');
    });
});

describe('StarComms provider', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('reports disabled when STARCOMMS_ENABLED is not set', async () => {
        const cfg = describeCommsConfig();
        expect(cfg.enabled).toBe(false);
        expect(cfg.configured).toBe(false);
        const r = await getCommsProvider().getStatus();
        expect(r).toEqual({ ok: false, error: 'disabled', message: expect.any(String) });
    });

    it('reports missing_base_url when enabled without a base URL', async () => {
        vi.stubEnv('STARCOMMS_ENABLED', 'true');
        expect(describeCommsConfig().configured).toBe(false);
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'missing_base_url' });
    });

    it('reports missing_api_key when enabled with a base URL but no key', async () => {
        vi.stubEnv('STARCOMMS_ENABLED', 'true');
        vi.stubEnv('STARCOMMS_BASE_URL', BASE);
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'missing_api_key' });
    });

    it('fetches and normalizes a successful status', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, OK_BODY));
        vi.stubGlobal('fetch', fetchMock);

        const r = await getCommsProvider().getStatus();
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('expected ok');
        expect(r.status.guildName).toBe('Phoenix');
        expect(r.status.connectedOperators).toBe(4);
        expect(r.status.operationOpen).toBe(true);
        expect(r.status.shard.version).toBe('1.4.2');
        expect(r.status.nets).toHaveLength(2);
        expect(r.status.features.push_to_talk).toBe(true);

        // The request carried the Bearer token to the correct URL.
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/status`);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    });

    it('maps a 401 to unauthorized', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'nope' })));
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'unauthorized' });
    });

    it('maps an aborted request to timeout', async () => {
        enableFull();
        vi.stubEnv('STARCOMMS_TIMEOUT_MS', '5');
        // fetch that never resolves but rejects with AbortError when the signal fires.
        vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
            });
        }));
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'timeout' });
    });

    it('maps a non-JSON body to malformed', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, null, { nonJson: true })));
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'malformed' });
    });

    it('maps a non-object JSON body to malformed', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, 'just a string')));
        const r = await getCommsProvider().getStatus();
        expect(r).toMatchObject({ ok: false, error: 'malformed' });
    });

    it('never leaks the API key in the config summary', () => {
        enableFull();
        const cfg = describeCommsConfig();
        expect(cfg.baseUrl).toBe(BASE); // shard URL is not secret
        expect(JSON.stringify(cfg)).not.toContain(KEY);
    });
});

describe('StarComms actions — no key leakage', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('status action returns config + status without the key anywhere', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, OK_BODY)));
        const out = await starcommsActions['admin:starcomms_status']();
        expect(JSON.stringify(out)).not.toContain(KEY);
        expect((out as { status: unknown }).status).toMatchObject({ guildName: 'Phoenix' });
    });

    it('status action short-circuits (no fetch) when disabled', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_status']() as { status: unknown; error: unknown };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.status).toBeNull();
        expect(out.error).toBeNull();
    });

    it('test action reports failure with a redacted, key-free message on 401', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'bad' })));
        const out = await starcommsActions['admin:starcomms_test']() as { ok: boolean; error: { kind: string } | null };
        expect(out.ok).toBe(false);
        expect(out.error?.kind).toBe('unauthorized');
        expect(JSON.stringify(out)).not.toContain(KEY);
    });
});
