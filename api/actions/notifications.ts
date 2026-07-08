// Notification Center actions — self-scoped mutations on the caller's OWN inbox.
//
// Dispatched through POST /api/services: by the time a handler runs the
// dispatcher has verified the JWT and force-injected payload.userId to the authed
// user's id (see ACTOR_ID_FIELDS in api/services.ts). userId is therefore ALWAYS
// server-derived — never taken from the client. The notification ids the client
// supplies are TARGET ids; the db layer asserts each belongs to userId before
// mutating (BOLA) and throws SecurityDenial on a foreign id.
//
// Each action maps to the 'user:manage:self' pseudo-permission (any authenticated
// caller) in api/services.ts — the inbox is per-user, gated by the user_id scoping
// in the db layer, not by a role permission.
//
// Reads are NOT here — the inbox is fetched via the self-scoped
// GET /api/query?target=state&subset=notifications path (server-derived userId).

import * as db from '../../lib/db.js';

interface MarkReadPayload { userId: number; notificationIds?: number[] }
interface MarkAllReadPayload { userId: number }
interface DeletePayload { userId: number; notificationId?: number }

export const notificationActions = {
    'notifications:mark_read': async ({ userId, notificationIds }: MarkReadPayload) => {
        const updated = await db.markNotificationsRead(userId, Array.isArray(notificationIds) ? notificationIds : []);
        return { success: true, updated };
    },

    'notifications:mark_all_read': async ({ userId }: MarkAllReadPayload) => {
        const updated = await db.markAllNotificationsRead(userId);
        return { success: true, updated };
    },

    'notifications:delete': async ({ userId, notificationId }: DeletePayload) => {
        await db.deleteNotification(userId, Number(notificationId));
        return { success: true };
    },
};
