// Strict, dependency-free color validation shared by server + client.
//
// SECURITY: this is the ONLY barrier against CSS injection for org theme colors. The
// CSP is `style-src 'unsafe-inline'` (React inline styles + boot splash depend on it),
// so an injected `<style>` block EXECUTES — a defect here is directly exploitable. A
// value that survives normalizeHexColor can contain ONLY the characters `[#0-9a-f]`, so
// it is structurally incapable of carrying a CSS metacharacter ( ; } { : ( ) / * space ).
// This is an allowlist BY OUTPUT SHAPE, not a denylist of bad patterns. HTML-escaping is
// insufficient — the sink is CSS grammar (`red;}body{display:none}` has no HTML specials).

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;

/**
 * Validate + normalize a color to canonical lowercase `#rrggbb`. Accepts ONLY `#rgb`
 * (expanded) or `#rrggbb`; returns null for ANYTHING else (no best-effort repair).
 * `#FFF` → `#ffffff`; `red` / `rgb(...)` / `url(...)` / `red;}body{}` / trailing junk /
 * non-strings → null.
 */
export function normalizeHexColor(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const s = input.trim();
    if (HEX6_RE.test(s)) return s.toLowerCase();
    if (HEX3_RE.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    return null;
}
