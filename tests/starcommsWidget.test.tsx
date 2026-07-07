import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { getCachedCommsStatus, __resetCommsCache } from '../lib/comms/index';
import { starcommsActions } from '../api/actions/starcomms';
import { fullPermissionMap } from '../api/services';
import { I18nProvider } from '../i18n/I18nContext';
import { StarCommsStatusView } from '../components/shared/StarCommsStatusWidget';

const KEY = 'SC_OWNER_KEY_WIDGET_999';
const BASE = 'https://shard.example.com';
const OK_BODY = {
    guildId: 'g-7', guildName: 'Phoenix',
    shard: { publicUrl: 'https://shard.example.com', version: '2.0.0' },
    connectedOperators: 3, operationOpen: true,
    nets: [{ id: 'n1', name: 'Command' }],
    features: { push_to_talk: true },
};

function enableFull() {
    vi.stubEnv('STARCOMMS_ENABLED', 'true');
    vi.stubEnv('STARCOMMS_BASE_URL', BASE);
    vi.stubEnv('STARCOMMS_OWNER_API_KEY', KEY);
}
function res(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

// --- Backend action + cache -------------------------------------------------

describe('StarComms V2 — widget read action', () => {
    beforeEach(() => __resetCommsCache());
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('gates the widget action on operations:view', () => {
        expect(fullPermissionMap['operation:starcomms_status']).toBe('operations:view');
    });

    it('returns disabled state without fetching or leaking the key', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const out = await starcommsActions['operation:starcomms_status']() as { status: unknown; error: unknown; fetchedAt: unknown };
        expect(fetchMock).not.toHaveBeenCalled();
        expect(out.status).toBeNull();
        expect(out.error).toBeNull();
        expect(out.fetchedAt).toBeNull();
    });

    it('returns a normalized status and fetchedAt on success — no key in output', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, OK_BODY)));
        const out = await starcommsActions['operation:starcomms_status']() as { status: { guildName: string } | null; fetchedAt: string | null };
        expect(out.status?.guildName).toBe('Phoenix');
        expect(out.fetchedAt).toEqual(expect.any(String));
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('returns a typed error (401) without leaking the key', async () => {
        enableFull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401, { error: 'nope' })));
        const out = await starcommsActions['operation:starcomms_status']() as { status: unknown; error: { kind: string } | null };
        expect(out.status).toBeNull();
        expect(out.error?.kind).toBe('unauthorized');
        expect(JSON.stringify(out)).not.toContain(KEY);
    });

    it('throttles: concurrent/repeat reads within the TTL hit the shard once', async () => {
        enableFull();
        const fetchMock = vi.fn().mockResolvedValue(res(200, OK_BODY));
        vi.stubGlobal('fetch', fetchMock);
        let t = 1_000_000;
        const now = () => t;
        await getCachedCommsStatus(now);
        await getCachedCommsStatus(now); // within TTL → cached
        expect(fetchMock).toHaveBeenCalledTimes(1);
        t += 20_000; // advance past the 15s TTL
        await getCachedCommsStatus(now);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

// --- Presentational view (graceful states, no crash) ------------------------

const renderView = (props: Partial<React.ComponentProps<typeof StarCommsStatusView>>) =>
    render(
        <I18nProvider>
            <StarCommsStatusView
                loading={false}
                refreshing={false}
                config={{ provider: 'starcomms', enabled: true, configured: true, baseUrl: BASE, timeoutMs: 5000 }}
                status={null}
                error={null}
                lastRefresh={null}
                onRefresh={() => undefined}
                {...props}
            />
        </I18nProvider>,
    );

describe('StarComms V2 — status view renders every state gracefully', () => {
    afterEach(() => cleanup());

    it('renders a loading state', () => {
        renderView({ loading: true });
        expect(screen.getByText('Loading…')).toBeTruthy();
    });

    it('renders a successful status (operators + nets)', () => {
        renderView({ status: { ...OK_BODY } });
        expect(screen.getByText('Connected')).toBeTruthy();
        expect(screen.getByText('Command')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('renders a timeout/error state with the message', () => {
        renderView({ error: { kind: 'timeout', message: 'StarComms request timed out after 5000ms.' }, lastRefresh: '10:00:00' });
        expect(screen.getByText('Offline')).toBeTruthy();
        expect(screen.getByText(/timed out/)).toBeTruthy();
    });

    it('renders a not-configured state', () => {
        renderView({ config: { provider: 'starcomms', enabled: true, configured: false, baseUrl: null, timeoutMs: 5000 } });
        expect(screen.getByText(/not fully configured/i)).toBeTruthy();
    });

    it('never throws for a malformed/empty status (does not break host load)', () => {
        expect(() => renderView({ status: null, error: null })).not.toThrow();
    });
});
