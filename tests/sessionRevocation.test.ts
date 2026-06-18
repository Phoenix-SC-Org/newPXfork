import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-user session revocation (HANDOFF s7a/s3-4/s3-5): revokeUserSessions stamps
// tokens_valid_from so HMAC tokens issued earlier are 401'd by the dispatcher;
// deleteUser stamps it too so a removed user's live sessions die immediately.

const h = vi.hoisted(() => ({
    userExists: true,
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('../lib/db/common', () => {
    function builder(table: string) {
        const state = { values: null as Record<string, unknown> | null, op: 'select' };
        const b: any = {};
        b.select = () => b;
        b.update = (v: Record<string, unknown>) => { state.op = 'update'; state.values = v; return b; };
        b.eq = () => b; b.is = () => b; b.in = () => b; b.order = () => b; b.limit = () => b;
        const settle = () => {
            if (state.op === 'update') { h.updates.push({ table, values: state.values! }); return Promise.resolve({ data: null, error: null }); }
            if (table === 'users') return Promise.resolve({ data: h.userExists ? { id: 7 } : null, error: null });
            return Promise.resolve({ data: null, error: null });
        };
        b.single = () => settle(); b.maybeSingle = () => settle();
        b.then = (resolve: any, reject: any) => settle().then(resolve, reject);
        return b;
    }
    return {
        supabase: { from: (t: string) => builder(t) },
        handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
        broadcastToOrg: () => {}, broadcastToChannel: () => {}, getSystemRoles: async () => ({}),
        safeFetch: async () => [],
    };
});
vi.mock('../lib/db/system', () => ({ getAllSettings: async () => ({}) }));
vi.mock('../lib/discord', () => ({ getDiscordMember: async () => null, pushDiscordRolesForUser: async () => undefined, getDiscordUserById: async () => null, buildGlobalAvatarUrl: () => '' }));
vi.mock('../lib/push', () => ({ isAllowedPushEndpoint: () => true, MAX_PUSH_SUBSCRIPTIONS_PER_USER: 10 }));

import { revokeUserSessions, deleteUser, reactivateUser } from '../lib/db/users';

beforeEach(() => { h.updates = []; h.userExists = true; });

describe('revokeUserSessions', () => {
    it('rejects an invalid id without writing', async () => {
        await expect(revokeUserSessions(0)).rejects.toThrow(/invalid user id/i);
        await expect(revokeUserSessions(-3)).rejects.toThrow(/invalid user id/i);
        await expect(revokeUserSessions(1.5)).rejects.toThrow(/invalid user id/i);
        expect(h.updates.length).toBe(0);
    });
    it('rejects a non-existent user', async () => {
        h.userExists = false;
        await expect(revokeUserSessions(7)).rejects.toThrow(/not found/i);
        expect(h.updates.length).toBe(0);
    });
    it('stamps tokens_valid_from for a real user', async () => {
        await revokeUserSessions(7);
        const u = h.updates.find((u) => u.table === 'users');
        expect(u?.values).toHaveProperty('tokens_valid_from');
        expect(typeof u?.values.tokens_valid_from).toBe('string');
    });
});

describe('deleteUser auto-revokes the removed user session', () => {
    it('stamps tokens_valid_from alongside deleted_at', async () => {
        await deleteUser(7);
        const u = h.updates.find((u) => u.table === 'users');
        expect(u?.values).toHaveProperty('deleted_at');
        expect(u?.values).toHaveProperty('tokens_valid_from');
    });
});

describe('reactivateUser mass-assignment allowlist (s3-6a)', () => {
    it('copies only name/avatar_url (+deleted_at:null) — never role_id/reputation', async () => {
        await reactivateUser(7, { name: 'New', avatar_url: 'a.png', role_id: 99, reputation: 100 } as any);
        const u = h.updates.find((u) => u.table === 'users');
        expect(u?.values).toEqual({ deleted_at: null, name: 'New', avatar_url: 'a.png' });
        expect(u?.values).not.toHaveProperty('role_id');
        expect(u?.values).not.toHaveProperty('reputation');
    });
});
