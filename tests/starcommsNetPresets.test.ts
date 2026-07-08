import { describe, it, expect, vi, afterEach } from 'vitest';
import { NET_PRESETS, getNetPreset, buildNetPresetPreview } from '../lib/comms/netPresets';
import { starcommsActions } from '../api/actions/starcomms';
import { fullPermissionMap } from '../api/services';

const KEY = 'SC_OWNER_KEY_V4_777';
const BASE = 'https://shard.example.com';

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}
function res(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

// --- Pure preview diff -------------------------------------------------------

describe('netPresets — buildNetPresetPreview (pure, read-only diff)', () => {
    const standard = getNetPreset('standard')!;

    it('detects existing vs missing nets, matching case-insensitively', () => {
        const p = buildNetPresetPreview(standard, [{ name: 'command' }, { name: 'Flight' }]);
        expect(p.existing.map((n) => n.name)).toEqual(['Command', 'Flight']);
        expect(p.toCreate.map((n) => n.name)).toEqual(['Ground', 'Logistics', 'Medical', 'Intel']);
    });

    it('marks every preset net as to-create when the shard has none', () => {
        const p = buildNetPresetPreview(standard, []);
        expect(p.existing).toHaveLength(0);
        expect(p.toCreate).toHaveLength(standard.nets.length);
    });

    it('lists unmanaged existing nets and always warns that nothing is deleted', () => {
        const p = buildNetPresetPreview(standard, [{ name: 'Command' }, { name: 'Secret Ops' }]);
        expect(p.unmanaged).toContain('Secret Ops');
        expect(p.warnings).toContain('no-delete');
        expect(p.warnings).toContain('unmanaged-existing');
    });

    it('ignores blank/null existing net names', () => {
        const p = buildNetPresetPreview(standard, [{ name: null }, { name: '   ' }]);
        expect(p.existing).toHaveLength(0);
        expect(p.toCreate).toHaveLength(standard.nets.length);
    });
});

// --- Read-only actions -------------------------------------------------------

describe('StarComms V4 — net preset actions (list + preview)', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('gates list + preview on admin:access', () => {
        expect(fullPermissionMap['admin:starcomms_list_net_presets']).toBe('admin:access');
        expect(fullPermissionMap['admin:starcomms_preview_net_preset']).toBe('admin:access');
    });

    it('lists the code-defined preset catalog', async () => {
        const out = await starcommsActions['admin:starcomms_list_net_presets']() as { presets: unknown[] };
        expect(out.presets).toEqual(NET_PRESETS);
    });

    it('blocks preview (no fetch) when disabled', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_net_preset']({ presetId: 'standard' }) as { ok: boolean; error: { kind: string } | null; preview: unknown };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.ok).toBe(false);
        expect(out.error?.kind).toBe('disabled');
        expect(out.preview).toBeNull();
    });

    it('blocks preview (no fetch) when config is missing', async () => {
        vi.stubEnv('STARCOMMS_ENABLED', 'true'); // enabled, but no base URL / key
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_net_preset']({ presetId: 'standard' }) as { ok: boolean; error: { kind: string } | null };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.error?.kind).toBe('missing_config');
    });

    it('rejects an unknown preset without fetching', async () => {
        enableFull();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_net_preset']({ presetId: 'nope' }) as { ok: boolean; error: { kind: string } | null };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.error?.kind).toBe('unknown_preset');
    });

    it('preview reads status only (GET /status) — never a write endpoint — and detects existing/missing; no key leak', async () => {
        enableFull();
        const body = { nets: [{ id: 'n1', name: 'Command' }, { id: 'n2', name: 'Intel' }] };
        const fetchMock = vi.fn().mockResolvedValue(res(200, body));
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['admin:starcomms_preview_net_preset']({ presetId: 'standard' }) as {
            ok: boolean; preview: { existing: { name: string }[]; toCreate: { name: string }[] };
        };
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/status`);
        expect(init.method).toBe('GET'); // read-only — NOT a POST to /api/v1/operation or a net endpoint
        expect(out.ok).toBe(true);
        expect(out.preview.existing.map((n) => n.name)).toEqual(['Command', 'Intel']);
        expect(out.preview.toCreate.map((n) => n.name)).toEqual(['Flight', 'Ground', 'Logistics', 'Medical']);
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('surfaces a 401 during preview safely without leaking the key', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'no' })));
        const out = await starcommsActions['admin:starcomms_preview_net_preset']({ presetId: 'standard' }) as { ok: boolean; error: { kind: string } | null };
        expect(out.ok).toBe(false);
        expect(out.error?.kind).toBe('unauthorized');
        expect(JSON.stringify(out)).not.toContain(KEY);
    });
});
