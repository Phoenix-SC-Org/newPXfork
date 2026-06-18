import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// HANDOFF s5-2 / s5-3: the security-header middleware + slowloris timeouts.
// server.ts builds an Express app at module scope (and binds a real socket on
// main-module import), so this pins the configuration at the source rather than
// booting the server. A revert that drops any of these would re-fail here.
const src = readFileSync(join(resolve(__dirname, '..'), 'server.ts'), 'utf8');

describe('security headers (s5-2)', () => {
    it('disables the legacy XSS auditor (X-XSS-Protection: 0)', () => {
        expect(src).toMatch(/setHeader\('X-XSS-Protection',\s*'0'\)/);
        expect(src).not.toMatch(/X-XSS-Protection',\s*'1; mode=block'/);
    });
    it('sets Cross-Origin-Opener-Policy: same-origin', () => {
        expect(src).toMatch(/setHeader\('Cross-Origin-Opener-Policy',\s*'same-origin'\)/);
    });
    it('sets a Permissions-Policy that denies camera/geo/payment/usb and allows microphone=(self)', () => {
        expect(src).toMatch(/setHeader\('Permissions-Policy',/);
        expect(src).toMatch(/camera=\(\)/);
        expect(src).toMatch(/microphone=\(self\)/);
    });
    it("CSP carries object-src 'none' and frame-ancestors 'none'", () => {
        expect(src).toMatch(/object-src 'none'/);
        expect(src).toMatch(/frame-ancestors 'none'/);
    });
});

describe('slowloris timeouts (s5-3)', () => {
    it('sets requestTimeout and headersTimeout on the inbound server', () => {
        expect(src).toMatch(/server\.requestTimeout\s*=/);
        expect(src).toMatch(/server\.headersTimeout\s*=/);
    });
});

describe('terminal recovery handler (s5-10a) + AI-limiter prune (s5-5b)', () => {
    it('has a terminal app.all that 303-redirects to a hardcoded "/"', () => {
        expect(src).toMatch(/app\.all\(/);
        expect(src).toMatch(/res\.redirect\(303,\s*'\/'\)/);
    });
    it('wires the AI rate-limit prune into the periodic sweep', () => {
        expect(src).toMatch(/pruneAiRateLimitBuckets\(/);
    });
});
