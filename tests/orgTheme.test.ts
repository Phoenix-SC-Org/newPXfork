import { describe, it, expect } from 'vitest';
import { hexToOklch, oklchToHex, accentRampVars, accentRampCss, accentRampHexes, SKY_VAR_NAMES } from '../lib/orgTheme';

describe('hexToOklch', () => {
    it('black → L≈0, white → L≈1', () => {
        expect(hexToOklch('#000000')!.L).toBeCloseTo(0, 2);
        expect(hexToOklch('#ffffff')!.L).toBeCloseTo(1, 2);
    });
    it('recovers the sky hue (~237°) from sky-500 hex #0ea5e9', () => {
        const { H } = hexToOklch('#0ea5e9')!;
        expect(H).toBeGreaterThan(225);
        expect(H).toBeLessThan(250);
    });
    it('returns null for invalid input', () => {
        expect(hexToOklch('red')).toBeNull();
        expect(hexToOklch('#zzz')).toBeNull();
    });
});

describe('accentRampVars', () => {
    it('emits all 11 sky stops', () => {
        const vars = accentRampVars('#ef4444')!;
        expect(Object.keys(vars).sort()).toEqual([...SKY_VAR_NAMES].sort());
    });
    it('PINS lightness to the reference ramp regardless of hue (contrast preserved)', () => {
        const red = accentRampVars('#ef4444')!;
        const green = accentRampVars('#22c55e')!;
        expect(red['--color-sky-500']).toMatch(/^oklch\(68\.5% /);
        expect(green['--color-sky-500']).toMatch(/^oklch\(68\.5% /);
        expect(red['--color-sky-950']).toMatch(/^oklch\(29\.3% /);
        expect(red['--color-sky-50']).toMatch(/^oklch\(97\.7% /);
    });
    it('rotates hue to the accent hue', () => {
        const red = accentRampVars('#ef4444')!; // hue ~25°
        const hue = Number(red['--color-sky-500']!.match(/ ([\d.]+)\)$/)![1]);
        expect(hue).toBeGreaterThan(10);
        expect(hue).toBeLessThan(45);
    });
    it('returns null for an invalid accent', () => {
        expect(accentRampVars('nope')).toBeNull();
        expect(accentRampCss('nope')).toBeNull();
    });
    it('serialized CSS carries only safe characters (no metachar from input)', () => {
        const css = accentRampCss('#ef4444')!;
        expect(css).toMatch(/^[-a-z0-9%(). :;]+$/);
        expect(css).toContain('--color-sky-500:oklch(');
        expect(css).not.toContain('}');
        expect(css).not.toContain(';;');
    });
    it('emits only safe numeric tokens for pathological accents (no NaN/metachar)', () => {
        for (const accent of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff']) {
            const css = accentRampCss(accent)!;
            expect(css).toMatch(/^[-a-z0-9%(). :;]+$/);
            expect(css).not.toMatch(/nan|infinity/i);
        }
    });
});

describe('oklchToHex (inverse of hexToOklch)', () => {
    it('round-trips representative colors within ~1 sRGB step', () => {
        for (const hex of ['#0ea5e9', '#ef4444', '#22c55e', '#7c3aed', '#000000', '#ffffff', '#808080']) {
            const ok = hexToOklch(hex)!;
            const back = oklchToHex(ok.L, ok.C, ok.H);
            for (let i = 1; i < 7; i += 2) {
                expect(Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16))).toBeLessThanOrEqual(2);
            }
        }
    });
    it('emits a canonical #rrggbb', () => {
        expect(oklchToHex(0.685, 0.148, 237)).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe('accentRampHexes', () => {
    it('preserves lightness ordering (light stop lighter than dark stop)', () => {
        const hexes = accentRampHexes('#ef4444')!;
        expect(hexes['400']).toMatch(/^#[0-9a-f]{6}$/);
        expect(hexToOklch(hexes['400'])!.L).toBeGreaterThan(hexToOklch(hexes['700'])!.L);
    });
    it('an achromatic accent (gray/white/black) yields a NEUTRAL ramp (chroma 0)', () => {
        for (const gray of ['#808080', '#ffffff', '#000000']) {
            for (const v of Object.values(accentRampVars(gray)!)) {
                expect(Number(v.match(/^oklch\([\d.]+% ([\d.]+) /)![1])).toBe(0);
            }
            const [r, g, b] = [1, 3, 5].map((i) => parseInt(accentRampHexes(gray)!['500'].slice(i, i + 2), 16));
            expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
            expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
        }
    });
    it('the DEFAULT accent (#0ea5e9) round-trips to ~full saturation (no desaturation)', () => {
        const chroma = Number(accentRampVars('#0ea5e9')!['--color-sky-500']!.match(/^oklch\([\d.]+% ([\d.]+) /)![1]);
        expect(chroma).toBeGreaterThan(0.16);
        expect(chroma).toBeLessThanOrEqual(0.169 * 1.15);
    });
});
