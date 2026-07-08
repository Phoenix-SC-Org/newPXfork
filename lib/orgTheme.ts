// Per-org accent theme: generate an OKLCH shade ramp from a single accent hex by
// PINNING each stop's lightness (and scaling chroma) to the default Tailwind `sky` ramp
// and ROTATING only the hue. Because each stop's perceptual lightness is preserved, the
// existing UI's contrast is preserved too — with small, bounded drift (OKLCH L is not
// WCAG relative luminance, so a hue change moves measured contrast by up to ~±0.5:1). A
// garish accent shifts the hue but can't make body text unreadable: the dominant
// accent-as-light-text-on-dark usages stay ~7:1+ and ramp-on-ramp pairs stay ~5:1 for
// every hue. The generated `--color-sky-*` overrides re-tint accent usages authored with
// Tailwind utilities (solid AND opacity, via color-mix(var(...))). A handful of literal
// rgba(14,165,233,…) glows / data-viz colors in components are NOT covered in v1.
//
// Pure + dependency-free; shared by the SSR injector (api/index.ts) and the client apply
// (DashboardApp). Callers pass a canonical #rrggbb (normalizeHexColor); the CSS output is
// computed NUMBERS only, so it can never carry a CSS metacharacter.

import { normalizeHexColor } from './color.js';

// Default Tailwind v4 `sky` ramp in OKLCH as [stop, L%, C]. sky-50/800 are currently
// tree-shaken from the bundle (unused) but included so the override stays coherent if
// they are ever used. This is the reference lightness structure we preserve.
const SKY_RAMP: Array<[stop: number, L: number, C: number]> = [
    [50, 97.7, 0.013], [100, 95.1, 0.026], [200, 90.1, 0.058], [300, 82.8, 0.111],
    [400, 74.6, 0.16], [500, 68.5, 0.169], [600, 58.8, 0.158], [700, 50.0, 0.134],
    [800, 44.3, 0.11], [900, 39.1, 0.09], [950, 29.3, 0.066],
];

// Below this OKLCH chroma an accent is treated as achromatic (gray/white/black): its hue
// is meaningless, so we produce a true-neutral ramp rather than clamping up to a muddy
// tinted one.
const ACHROMATIC_C = 0.01;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** sRGB hex (#rrggbb) → OKLCH { L (0..1), C, H (deg 0..360) }. Pure; no deps. */
export function hexToOklch(hex: string): { L: number; C: number; H: number } | null {
    const c = normalizeHexColor(hex);
    if (!c) return null;
    const [r, g, b] = [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)]
        .map((h) => parseInt(h, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    // linear sRGB → LMS → Oklab (Björn Ottosson's matrices)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const okL = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const okA = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const okB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const C = Math.sqrt(okA * okA + okB * okB);
    let H = Math.atan2(okB, okA) * (180 / Math.PI);
    if (H < 0) H += 360;
    return { L: okL, C, H };
}

/**
 * OKLCH (L 0..1, C, H deg) → sRGB #rrggbb, channel-clamped to gamut. Exact inverse of
 * hexToOklch. Used to measure a GENERATED stop's WCAG contrast (the a11y readout in the
 * editor) — the app renders the L-pinned stops, not the raw accent, so honest contrast
 * numbers must come from here. NOT a CSS sink (CSS output uses accentRampVars/Css).
 */
export function oklchToHex(L: number, C: number, H: number): string {
    const hr = H * (Math.PI / 180);
    const a = C * Math.cos(hr);
    const b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    return '#' + lin.map((v) => {
        const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
        return Math.round(clamp(srgb, 0, 1) * 255).toString(16).padStart(2, '0');
    }).join('');
}

// Reference mid-tone chroma for scaling the org's saturation — the TRUE sRGB chroma of
// sky-500 (#0ea5e9 ≈ 0.148), NOT Tailwind's wide-gamut authored 0.169. Measuring the
// numerator (accent) and denominator (reference) in the same space makes the DEFAULT
// accent round-trip to a chromaScale of 1.0 (reproduces the stock theme) instead of
// desaturating it to ~87%.
const SKY_REF_C = hexToOklch('#0ea5e9')!.C;

/** Per-stop {L%, C, H} the ramp renders — shared by the CSS (vars) and a11y (hex) paths. */
function rampComponents(accentHex: string): Array<{ stop: number; L: number; C: number; H: number }> | null {
    const ok = hexToOklch(accentHex);
    if (!ok) return null;
    const chromaScale = ok.C < ACHROMATIC_C ? 0 : clamp(ok.C / SKY_REF_C, 0.4, 1.15);
    return SKY_RAMP.map(([stop, L, C]) => ({ stop, L, C: C * chromaScale, H: ok.H }));
}

/**
 * Build the per-org `--color-sky-*` overrides from an accent hex → map of CSS var name →
 * `oklch(L% C H)`. Lightness pinned to the reference ramp; chroma scaled by the accent's
 * saturation (clamped so a muted brand stays muted, a vivid one stays vivid — or zeroed to
 * a true-neutral ramp for an achromatic accent); hue set to the accent's. Browsers
 * gamut-map any out-of-sRGB oklch, so no explicit clamp is required. Null for an invalid accent.
 */
export function accentRampVars(accentHex: string): Record<string, string> | null {
    const comps = rampComponents(accentHex);
    if (!comps) return null;
    const out: Record<string, string> = {};
    for (const { stop, L, C, H } of comps) {
        out[`--color-sky-${stop}`] = `oklch(${L}% ${C.toFixed(4)} ${H.toFixed(2)})`;
    }
    return out;
}

/**
 * The generated ramp as sRGB hex per stop (keyed by stop, e.g. '400'). For measuring what
 * ACTUALLY renders (a11y contrast readout) — NOT a CSS sink (CSS uses accentRampVars/Css).
 */
export function accentRampHexes(accentHex: string): Record<string, string> | null {
    const comps = rampComponents(accentHex);
    if (!comps) return null;
    const out: Record<string, string> = {};
    for (const { stop, L, C, H } of comps) out[String(stop)] = oklchToHex(L / 100, C, H);
    return out;
}

/** CSS variable names this module manages (for client-side teardown). */
export const SKY_VAR_NAMES = SKY_RAMP.map(([stop]) => `--color-sky-${stop}`);

/** Serialize the ramp to a `:root{…}` declaration body for the SSR `<style>` block. */
export function accentRampCss(accentHex: string): string | null {
    const vars = accentRampVars(accentHex);
    if (!vars) return null;
    return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}
