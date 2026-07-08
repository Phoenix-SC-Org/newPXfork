// WCAG contrast utilities for the theme editor. Pure; imports the strict hex validator.
// UX-only (live warnings + a "nearest passing shade" fix) — NOT a security boundary, so
// invalid input fails safe (luminance 0) rather than throwing.

import { normalizeHexColor } from './color.js';

/** WCAG relative luminance of a hex color (0..1). Invalid input → 0. */
export function relativeLuminance(hex: string): number {
    const c = normalizeHexColor(hex);
    if (!c) return 0;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const [r, g, b] = [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)].map((h) => lin(parseInt(h, 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(fg: string, bg: string): number {
    const a = relativeLuminance(fg);
    const b = relativeLuminance(bg);
    const [hi, lo] = a >= b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
}

export const AA_BODY = 4.5;
export const AA_LARGE = 3.0;
export const AA_UI = 3.0;
export const AAA_BODY = 7.0;

export function passes(fg: string, bg: string, min = AA_BODY): boolean {
    return contrastRatio(fg, bg) >= min;
}

/**
 * Nudge fg's lightness toward black or white (whichever the bg calls for) by the MINIMAL
 * amount that clears `min` against bg. Returns a canonical hex — the input unchanged if it
 * already passes, or the closest achievable (pure black/white) if even that can't reach the
 * target. Binary-searches the sRGB blend toward the endpoint.
 */
export function nearestPassingShade(fg: string, bg: string, min = AA_BODY): string {
    const f = normalizeHexColor(fg);
    if (!f) return '#000000';
    if (passes(f, bg, min)) return f;
    const target = relativeLuminance(bg) > 0.5 ? 0 : 255; // darken on light bg, lighten on dark
    const rgb = [parseInt(f.slice(1, 3), 16), parseInt(f.slice(3, 5), 16), parseInt(f.slice(5, 7), 16)];
    const toHex = (arr: number[]) => '#' + arr.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    let lo = 0;
    let hi = 1;
    let best = target === 0 ? '#000000' : '#ffffff';
    for (let i = 0; i < 20; i++) {
        const t = (lo + hi) / 2;
        const cand = toHex(rgb.map((v) => v + (target - v) * t));
        if (passes(cand, bg, min)) { best = cand; hi = t; } else { lo = t; }
    }
    return best;
}
