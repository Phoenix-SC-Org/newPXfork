import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Session-token hardening (HANDOFF s3-7): verifyToken validates the decoded JSON
// shape after the HMAC check and returns a NORMALISED { userId, exp } — it never
// trusts extra payload fields, and the token no longer carries roleId.

const SECRET = 'test-secret-fixed-1234567890abcdef';
vi.hoisted(() => { process.env.JWT_SECRET = 'test-secret-fixed-1234567890abcdef'; });

import { signToken, verifyToken } from '../lib/auth';

// Forge a token with an arbitrary payload but a VALID signature (we know the key).
function forge(payload: unknown): string {
    const enc = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = createHmac('sha256', SECRET).update(enc).digest('hex');
    return `${enc}.${sig}`;
}
const future = Date.now() + 60_000;

describe('verifyToken', () => {
    it('round-trips a signed token to a normalised { userId, exp } (no roleId)', () => {
        const out = verifyToken(signToken({ userId: 5 }))!;
        expect(out.userId).toBe(5);
        expect(typeof out.exp).toBe('number');
        expect((out as unknown as Record<string, unknown>).roleId).toBeUndefined();
    });
    it('drops any extra payload fields even when validly signed', () => {
        const out = verifyToken(forge({ userId: 9, exp: future, roleId: 99, isAdmin: true }))!;
        expect(out).toEqual({ userId: 9, exp: future });
    });
    it('rejects a non-numeric exp (would make the expiry check a no-op)', () => {
        expect(verifyToken(forge({ userId: 1, exp: 'not-a-number' }))).toBeNull();
    });
    it('rejects a non-numeric userId', () => {
        expect(verifyToken(forge({ userId: 'x', exp: future }))).toBeNull();
    });
    it('rejects a token carrying a non-session purpose', () => {
        expect(verifyToken(forge({ userId: 1, exp: future, purpose: 'admin_setup' }))).toBeNull();
    });
    it('rejects a tampered signature', () => {
        const t = signToken({ userId: 1 });
        expect(verifyToken(t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa'))).toBeNull();
    });
    it('rejects a malformed token', () => {
        expect(verifyToken('garbage')).toBeNull();
        expect(verifyToken(undefined)).toBeNull();
    });
});
