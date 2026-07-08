import { describe, it, expect, vi } from 'vitest';

// pickPublicThemeConfig gates the theme blob onto the UNAUTHENTICATED boot payload —
// an allowlist rebuild (future keys dropped, accent re-validated to #rrggbb) so a
// stored-blob key or an injection string can never ride the pre-auth response into the
// SSR/client CSS sink. (lib/db is mocked only so api/query imports without a live client.)
vi.mock('../lib/db', () => ({}));

import { pickPublicThemeConfig } from '../api/query';

const sortedKeys = (o: object) => Object.keys(o).sort();

describe('unauth boot allowlist — pickPublicThemeConfig', () => {
    it('returns EXACTLY { enabled, accent } from a fat blob (future keys dropped, accent normalized)', () => {
        const out = pickPublicThemeConfig({
            enabled: true, accent: '#0EA5E9',
            internalRampCache: 'x', tokens: { surface: '#fff' }, futureThemeSecret: 'nope',
        });
        expect(sortedKeys(out)).toEqual(['accent', 'enabled']);
        expect(out.enabled).toBe(true);
        expect(out.accent).toBe('#0ea5e9');
        expect((out as { internalRampCache?: unknown }).internalRampCache).toBeUndefined();
        expect((out as { tokens?: unknown }).tokens).toBeUndefined();
    });

    it('drops an invalid/injection accent and coerces enabled to a strict boolean', () => {
        const out = pickPublicThemeConfig({ enabled: 'yes', accent: 'red;}body{display:none}' });
        expect(out.enabled).toBe(false);
        expect(sortedKeys(out)).toEqual(['enabled']);
    });

    it('returns { enabled: false } for nullish input', () => {
        expect(pickPublicThemeConfig(null)).toEqual({ enabled: false });
        expect(pickPublicThemeConfig(undefined)).toEqual({ enabled: false });
    });
});
