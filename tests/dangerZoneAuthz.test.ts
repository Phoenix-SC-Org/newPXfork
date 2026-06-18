import { describe, it, expect } from 'vitest';
import { adminActions } from '../api/actions/admin';
import { fullPermissionMap } from '../api/services';

// Danger-Zone DB destruction (red-team dbtools-1/2/3). Authorization is THREE
// independent server-side gates: the dispatcher perm (admin:db:destroy, not
// seeded to Dispatcher), the genuine Admin role, and a server-validated typed
// confirmation phrase. The typed phrase must never be a browser-only gate.

type Handler = (p: unknown) => Promise<unknown>;
const wipe = (adminActions as Record<string, Handler>)['admin:db:full_wipe'];
const reset = (adminActions as Record<string, Handler>)['admin:db:full_reset'];

describe('danger-zone permission gating', () => {
    it('full reset/wipe require the dedicated admin:db:destroy perm (not bare admin:access)', () => {
        expect(fullPermissionMap['admin:db:full_reset']).toBe('admin:db:destroy');
        expect(fullPermissionMap['admin:db:full_wipe']).toBe('admin:db:destroy');
    });
    it('domain resets require the domain management perm', () => {
        expect(fullPermissionMap['admin:db:reset_finances']).toBe('finance:manage');
        expect(fullPermissionMap['admin:db:reset_quartermaster']).toBe('qm:manage');
    });
});

describe('danger-zone server-side role + phrase enforcement', () => {
    // The handler validates synchronously (before any DB await), so it throws
    // synchronously — never reaching the destructive RPC.
    it('rejects a non-Admin even with the correct phrase', () => {
        expect(() => wipe({ user: { role: 'Dispatcher' }, confirmPhrase: 'WIPE EVERYTHING' })).toThrow(/only an admin/i);
        expect(() => reset({ userId: 1, user: { role: 'Dispatcher' }, confirmPhrase: 'RESET' })).toThrow(/only an admin/i);
    });
    it('rejects an Admin with the wrong/blank phrase (browser gate is not trusted)', () => {
        expect(() => wipe({ user: { role: 'Admin' }, confirmPhrase: 'wipe everything' })).toThrow(/confirmation phrase/i);
        expect(() => wipe({ user: { role: 'Admin' }, confirmPhrase: '' })).toThrow(/confirmation phrase/i);
        expect(() => reset({ userId: 1, user: { role: 'Admin' }, confirmPhrase: 'reset' })).toThrow(/confirmation phrase/i);
        expect(() => reset({ userId: 1, user: { role: 'Admin' } })).toThrow(/confirmation phrase/i);
    });
});
