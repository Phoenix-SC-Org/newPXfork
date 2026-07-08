import { describe, it, expect, beforeEach, vi } from 'vitest';

// =============================================================================
// Notification Center — security regressions (single-org)
// =============================================================================
// The `notifications` table is service-role only (RLS deny-by-default + no
// authenticated policy — schema.sql SECTION 6), so app code is the ONLY boundary.
// These pin the invariants:
//   • fail-closed: every helper throws on a missing/invalid userId BEFORE any
//     query (a caller that forgets to scope can't issue an unscoped read/write
//     under the RLS-bypassing service-role key).
//   • self-scoped reads: getUserNotifications returns ONLY the caller's rows and
//     never surfaces the raw user_id to the client.
//   • cross-user BOLA: mark-read throws SecurityDenial (and writes nothing) for an
//     id owned by another user; delete is scoped so a foreign id no-ops.
//   • realtime is id-only: createNotification's broadcast carries just
//     { notificationId, targetUserId } — no title/body on the wire.
// Single-org: there is no organization_id — the user_id scoping is the boundary.
//
// notifications.ts imports supabase/handleSupabaseError/safeFetch/broadcastToOrg
// from './common.js', so mocking '../lib/db/common.js' flows a behaviour-true
// stub + a capturing broadcast into it (SecurityDenial comes from the real errors).

const h = vi.hoisted(() => {
    const state = {
        rows: {} as Record<string, Array<Record<string, unknown>>>,
        touched: {} as Record<string, number>,
        broadcasts: [] as Array<{ event: string; payload: Record<string, unknown> }>,
    };

    type Pred = { op: 'eq' | 'in' | 'is'; col: string; val: unknown };
    const matches = (r: Record<string, unknown>, preds: Pred[]) => preds.every(p => {
        if (p.op === 'eq') return String(r[p.col]) === String(p.val);
        if (p.op === 'in') return (p.val as unknown[]).map(String).includes(String(r[p.col]));
        return p.val === null ? (r[p.col] === null || r[p.col] === undefined) : r[p.col] === p.val;
    });

    function makeBuilder(table: string) {
        const preds: Pred[] = [];
        let verb: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let insertRows: Array<Record<string, unknown>> = [];
        let countMode = false;

        const settle = (): Array<Record<string, unknown>> => {
            if (verb === 'insert') {
                state.touched[table] = (state.touched[table] || 0) + insertRows.length;
                return insertRows.map((r, i) => ({ id: 1000 + i, created_at: '2026-01-01T00:00:00Z', ...r }));
            }
            const matched = (state.rows[table] || []).filter(r => matches(r, preds));
            if (verb === 'update' || verb === 'delete') {
                state.touched[table] = (state.touched[table] || 0) + matched.length;
            }
            return matched;
        };

        const builder: any = {
            select: (_cols?: unknown, opts?: { head?: boolean; count?: string }) => { if (opts && (opts.head || opts.count)) countMode = true; return builder; },
            insert: (rows: any) => { verb = 'insert'; insertRows = Array.isArray(rows) ? rows : [rows]; return builder; },
            update: () => { verb = 'update'; return builder; },
            delete: () => { verb = 'delete'; return builder; },
            eq: (col: string, val: unknown) => { preds.push({ op: 'eq', col, val }); return builder; },
            in: (col: string, val: unknown) => { preds.push({ op: 'in', col, val }); return builder; },
            is: (col: string, val: unknown) => { preds.push({ op: 'is', col, val }); return builder; },
            order: () => builder,
            limit: () => builder,
            range: () => builder,
            single: async () => ({ data: settle()[0] ?? null, error: null }),
            maybeSingle: async () => ({ data: settle()[0] ?? null, error: null }),
            then: (resolve: (v: { data: Array<Record<string, unknown>> | null; count?: number; error: null }) => unknown) => {
                const data = settle();
                return resolve(countMode ? { data: null, count: data.length, error: null } : { data, error: null });
            },
        };
        return builder;
    }

    const supabaseStub = { from: (table: string) => makeBuilder(table) };
    return { state, supabaseStub };
});

vi.mock('../lib/db/common.js', () => ({
    supabase: h.supabaseStub,
    handleSupabaseError: ({ error, message }: { error: unknown; message: string }) => { if (error) throw new Error(message); },
    safeFetch: async (query: PromiseLike<{ data: unknown; error: unknown }>, fallback: unknown) => {
        const { data, error } = await query;
        return error ? fallback : (data ?? fallback);
    },
    broadcastToOrg: (event: string, payload: Record<string, unknown>) => { h.state.broadcasts.push({ event, payload }); return Promise.resolve(); },
}));
// createNotification fires a best-effort web-push; stub it to a no-op resolve.
vi.mock('../lib/push.js', () => ({ sendPushToUsers: () => Promise.resolve() }));

import * as notif from '../lib/db/notifications';
import { SecurityDenial } from '../lib/errors';

const CALLER = 7;
const OTHER = 99;

beforeEach(() => {
    h.state.rows = {};
    h.state.touched = {};
    h.state.broadcasts = [];
});

describe('notifications — fail closed on missing/invalid user', () => {
    it('reads reject without a valid userId', async () => {
        await expect(notif.getUserNotifications(0)).rejects.toThrow(/userId is required/);
        await expect(notif.getUnreadCount(0)).rejects.toThrow(/userId is required/);
    });
    it('createNotification rejects without user / type+title', async () => {
        await expect(notif.createNotification(0, { type: 't', title: 'x' })).rejects.toThrow(/userId is required/);
        await expect(notif.createNotification(CALLER, { type: '', title: '' })).rejects.toThrow(/type and title/);
    });
    it('mutations reject without a valid userId', async () => {
        await expect(notif.markNotificationsRead(0, [1])).rejects.toThrow(/userId is required/);
        await expect(notif.markAllNotificationsRead(0)).rejects.toThrow(/userId is required/);
        await expect(notif.deleteNotification(0, 1)).rejects.toThrow(/userId is required/);
    });
});

describe('notifications — self-scoped reads', () => {
    it('returns ONLY the caller\'s rows', async () => {
        h.state.rows.notifications = [
            { id: 1, user_id: CALLER, type: 'x', title: 'mine', body: null, link: null, metadata: {}, read_at: null, created_at: '2026-01-01' },
            { id: 2, user_id: OTHER, type: 'x', title: 'theirs', body: null, link: null, metadata: {}, read_at: null, created_at: '2026-01-02' },
        ];
        const rows = await notif.getUserNotifications(CALLER);
        expect(rows.map(r => r.id)).toEqual([1]);
        expect(rows.map(r => r.title)).not.toContain('theirs');
    });
    it('does not surface the raw user_id to the client', async () => {
        h.state.rows.notifications = [{ id: 1, user_id: CALLER, type: 'x', title: 't', body: null, link: null, metadata: {}, read_at: null, created_at: '2026-01-01' }];
        const [row] = await notif.getUserNotifications(CALLER);
        expect(row).not.toHaveProperty('userId');
        expect(row).not.toHaveProperty('user_id');
    });
});

describe('notifications — cross-user BOLA', () => {
    it('mark-read throws SecurityDenial on another user\'s id and writes nothing', async () => {
        h.state.rows.notifications = [{ id: 5, user_id: OTHER, read_at: null }];
        await expect(notif.markNotificationsRead(CALLER, [5])).rejects.toBeInstanceOf(SecurityDenial);
        expect(h.state.touched.notifications || 0).toBe(0);
    });
    it('mark-read updates the caller\'s own unread rows', async () => {
        h.state.rows.notifications = [{ id: 7, user_id: CALLER, read_at: null }];
        const n = await notif.markNotificationsRead(CALLER, [7]);
        expect(n).toBe(1);
        expect(h.state.touched.notifications).toBe(1);
    });
    it('delete is scoped to userId — a foreign-user id no-ops without error', async () => {
        h.state.rows.notifications = [{ id: 8, user_id: OTHER }];
        await notif.deleteNotification(CALLER, 8);
        expect(h.state.touched.notifications || 0).toBe(0);
    });
});

describe('notifications — realtime signal is id-only', () => {
    it('createNotification broadcasts notification_update with ONLY {notificationId, targetUserId}', async () => {
        const n = await notif.createNotification(CALLER, { type: 'request', title: 'Sensitive Title', body: 'Sensitive Body', link: 'requests' });
        expect(n?.id).toBe(1000);
        const bc = h.state.broadcasts.find(b => b.event === 'notification_update');
        expect(bc).toBeTruthy();
        expect(bc!.payload).toEqual({ notificationId: 1000, targetUserId: CALLER });
        // No row content (title/body) ever rides the channel.
        expect(JSON.stringify(bc!.payload)).not.toMatch(/Sensitive/);
    });
});
