import { describe, it, expect, vi, beforeEach } from 'vitest';

// The core fail-closed predicate behind BOTH feature gates (dispatcher + read path).
// isOptionalFeatureEnabled must: read Government from its own governmentsConfig key
// and every other module from the orgFeatures blob; treat every optional module as
// DEFAULT-OFF; and FAIL CLOSED (any settings-read error → disabled) so a DB blip can
// never leave a toggled-off module reachable.

const h = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    throwOnKey: null as string | null,
}));

function makeBuilder() {
    let key = '';
    const b: any = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => { if (col === 'key') key = val; return b; };
    b.maybeSingle = async () => {
        if (h.throwOnKey === key) throw new Error('settings read failed');
        return { data: key in h.settings ? { value: h.settings[key] } : null, error: null };
    };
    return b;
}

vi.mock('../lib/db/common.js', () => ({
    supabase: { from: () => makeBuilder() },
    handleSupabaseError: ({ error }: { error: unknown }) => { if (error) throw error; },
    safeFetch: async (query: PromiseLike<{ data: unknown; error: unknown }>, fallback: unknown) => {
        const { data, error } = await query; return error ? fallback : (data ?? fallback);
    },
    broadcastToOrg: () => Promise.resolve(),
    broadcastToChannel: () => Promise.resolve(),
    getSystemRoles: async () => ({}),
}));

import { isFeatureEnabled, isGovernmentEnabled, isOptionalFeatureEnabled } from '../lib/db/system';

beforeEach(() => { h.settings = {}; h.throwOnKey = null; });

describe('isFeatureEnabled — orgFeatures blob, default OFF, fail closed', () => {
    it('true only when the module is explicitly enabled', async () => {
        h.settings.orgFeatures = { marketplace: { enabled: true } };
        expect(await isFeatureEnabled('marketplace')).toBe(true);
    });
    it('false when enabled:false, absent key, or absent blob (default OFF)', async () => {
        h.settings.orgFeatures = { marketplace: { enabled: false } };
        expect(await isFeatureEnabled('marketplace')).toBe(false);
        h.settings.orgFeatures = { warehouse: { enabled: true } }; // marketplace key absent
        expect(await isFeatureEnabled('marketplace')).toBe(false);
        h.settings = {}; // no orgFeatures row at all
        expect(await isFeatureEnabled('marketplace')).toBe(false);
    });
    it('fails closed (false) when the settings read throws', async () => {
        h.throwOnKey = 'orgFeatures';
        expect(await isFeatureEnabled('marketplace')).toBe(false);
    });
});

describe('isGovernmentEnabled — separate governmentsConfig key, default OFF, fail closed', () => {
    it('reads the governmentsConfig row, not orgFeatures', async () => {
        h.settings.governmentsConfig = { enabled: true };
        // A government flag mistakenly placed in orgFeatures must NOT satisfy it.
        h.settings.orgFeatures = { government: { enabled: false } };
        expect(await isGovernmentEnabled()).toBe(true);
    });
    it('false when absent or disabled', async () => {
        expect(await isGovernmentEnabled()).toBe(false);
        h.settings.governmentsConfig = { enabled: false };
        expect(await isGovernmentEnabled()).toBe(false);
    });
    it('fails closed (false) when the read throws', async () => {
        h.throwOnKey = 'governmentsConfig';
        expect(await isGovernmentEnabled()).toBe(false);
    });
});

describe('isOptionalFeatureEnabled — routes government to its own source', () => {
    it("'government' resolves via governmentsConfig, ignoring orgFeatures", async () => {
        h.settings.governmentsConfig = { enabled: true };
        expect(await isOptionalFeatureEnabled('government')).toBe(true);
        h.settings.governmentsConfig = { enabled: false };
        expect(await isOptionalFeatureEnabled('government')).toBe(false);
    });
    it('non-government features resolve via the orgFeatures blob', async () => {
        h.settings.orgFeatures = { quartermaster: { enabled: true } };
        expect(await isOptionalFeatureEnabled('quartermaster')).toBe(true);
        expect(await isOptionalFeatureEnabled('finances')).toBe(false);
    });
});
