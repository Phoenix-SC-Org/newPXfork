import { describe, it, expect } from 'vitest';
import { minifyUser, blankSensitiveUserFields } from '../lib/db/mappers';
import { UserRole, type User } from '../types';

// minifyUser / blankSensitiveUserFields project an already-mapped User down to a
// safe-to-embed shape. createOperation returns the op owner through minifyUser,
// so this guards against the owner-spoof PII leak (and any other embed of a
// hydrated User) regardless of how the source SELECT was widened.
function fullUser(): User {
    return {
        id: 42, name: 'Cmdr', avatarUrl: 'a.png', discordId: '101953620311810048',
        rsiHandle: 'Cmdr', roleId: 1, role: UserRole.Admin, reputation: 10, isDuty: true,
        permissions: ['admin:access', 'operations:manage'],
        createdAt: 't0',
        adminNotes: 'secret admin note', personnelNotes: 'secret hr note',
        clearanceLevel: { id: 5, level: 5, name: 'TS' } as unknown as User['clearanceLevel'],
        limitingMarkers: [{ id: 1, name: 'NOFORN', code: 'NF' }] as unknown as User['limitingMarkers'],
        conductRecord: [{ id: 'c1', type: 'warning', reason: 'x', enteredBy: { id: 1, name: 'A' }, createdAt: 't' }] as unknown as User['conductRecord'],
        rsiHandlePending: 'PendingHandle',
        rsiVerificationCode: 'VERIFY-1234',
    } as User;
}

describe('blankSensitiveUserFields / minifyUser', () => {
    it('blanks every private/security field but keeps public identity', () => {
        const u = blankSensitiveUserFields(fullUser());
        // public identity preserved
        expect(u.name).toBe('Cmdr');
        expect(u.avatarUrl).toBe('a.png');
        expect(u.role).toBe(UserRole.Admin);
        // sensitive fields blanked
        expect(u.discordId).toBe('');
        expect(u.permissions).toEqual([]);
        expect(u.adminNotes).toBeUndefined();
        expect(u.personnelNotes).toBeUndefined();
        expect(u.clearanceLevel).toBeUndefined();
        expect(u.limitingMarkers).toEqual([]);
        expect(u.conductRecord).toEqual([]);
        expect(u.rsiHandlePending).toBeUndefined();
        expect(u.rsiVerificationCode).toBeUndefined();
    });

    it('the serialized projection contains no secret values', () => {
        const blob = JSON.stringify(minifyUser(fullUser()));
        expect(blob).not.toContain('secret admin note');
        expect(blob).not.toContain('secret hr note');
        expect(blob).not.toContain('VERIFY-1234');
        expect(blob).not.toContain('PendingHandle');
        expect(blob).not.toContain('101953620311810048');
        expect(blob).not.toContain('admin:access');
    });

    it('passes through nullish', () => {
        expect(minifyUser(undefined)).toBeUndefined();
        expect(minifyUser(null)).toBeUndefined();
    });
});
