import { describe, it, expect, vi, beforeEach } from 'vitest';

// Secret decrypt-on-read (HANDOFF s5-6): client-facing/boot/public read paths
// must NOT pull live credentials into memory. getAllSettings({decryptSecrets:false})
// skips the decrypt entirely; getPublicSettings reads ONLY the public-intent keys.

const h = vi.hoisted(() => ({
    rows: [] as Array<{ key: string; value: unknown }>,
    decryptCalls: 0,
}));

vi.mock('../lib/db/common', () => {
    function builder(_table: string) {
        let inKeys: string[] | null = null;
        const b: any = {};
        b.select = () => b;
        b.in = (_col: string, vals: string[]) => { inKeys = vals; return b; };
        b.eq = () => b; b.is = () => b; b.order = () => b; b.limit = () => b;
        const data = () => inKeys ? h.rows.filter((r) => inKeys!.includes(r.key)) : h.rows;
        const settle = () => Promise.resolve({ data: data(), error: null });
        b.maybeSingle = () => Promise.resolve({ data: data()[0] ?? null, error: null });
        b.single = () => Promise.resolve({ data: data()[0] ?? null, error: null });
        b.then = (resolve: any, reject: any) => settle().then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}), safeFetch: async () => [],
    };
});
vi.mock('../lib/crypto', () => ({
    encryptConfigSecrets: (_k: string, v: unknown) => v,
    decryptConfigSecrets: (_k: string, v: unknown) => { h.decryptCalls++; return v; },
    encryptSecret: (v: string) => v,
    decryptSecret: (v: string) => { h.decryptCalls++; return `DECRYPTED:${v}`; },
}));
vi.mock('../lib/cache', () => ({ cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: () => {} }, TTL: {} }));
vi.mock('../lib/push', () => ({ sendPushToAll: () => {} }));
vi.mock('../lib/db/seeder', () => ({ seedNewOrganization: async () => {} }));

import { getAllSettings, getPublicSettings } from '../lib/db/system';

beforeEach(() => {
    h.decryptCalls = 0;
    h.rows = [
        { key: 'geminiKey', value: 'enc-gemini' },
        { key: 'discordConfig', value: { botToken: 'enc-bot', clientId: 'cid' } },
        { key: 'aiConfig', value: { enabled: true, model: 'gemini' } },
        { key: 'publicPageConfig', value: { enabled: true, motto: 'hi' } },
        { key: 'brandingConfig', value: { name: 'MyOrg', iconUrl: 'i.png' } },
        { key: 'admin_setup_code', value: { code: 'SETUP-XYZ' } },
    ];
});

describe('getAllSettings({ decryptSecrets: false })', () => {
    it('does not decrypt any secret on the read path', async () => {
        const out = await getAllSettings({ decryptSecrets: false });
        expect(h.decryptCalls).toBe(0);
        // geminiKey is NOT merged into aiConfig.apiKey when decryption is skipped
        expect((out.aiConfig as { apiKey?: string }).apiKey).toBeUndefined();
    });
    it('still decrypts by default (server-internal consumers)', async () => {
        await getAllSettings();
        expect(h.decryptCalls).toBeGreaterThan(0);
    });
});

describe('getPublicSettings', () => {
    it('returns only the public-intent keys and never decrypts', async () => {
        const out = await getPublicSettings();
        expect(h.decryptCalls).toBe(0);
        expect(out.brandingConfig.name).toBe('MyOrg');
        expect(out.publicPageConfig.enabled).toBe(true);
        // secret-bearing keys are not even read into the result
        expect((out as Record<string, unknown>).geminiKey).toBeUndefined();
        expect((out as Record<string, unknown>).discordConfig).toBeUndefined();
        expect((out as Record<string, unknown>).admin_setup_code).toBeUndefined();
    });
});
