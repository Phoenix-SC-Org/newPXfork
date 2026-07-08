// PersistentNotificationsContext — the per-user Notification Center inbox.
//
// Distinct from the ephemeral toast NotificationContext (useNotification): this
// owns the DURABLE, server-backed inbox — the list, the unread count, and the
// mark-read / mark-all-read / delete mutations. Reads come from the self-scoped
// GET /api/query 'notifications' subset (server derives the userId; a member only
// ever receives their OWN rows). Realtime is a window event dispatched by
// DataCoreContext ('app:realtime:notification-update'); we refetch ONLY when the
// id-only signal's targetUserId matches the signed-in user — so one member's
// notification never triggers a refetch (or reveals anything) on another's client.

import React, { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useDataCore } from './DataCoreContext';
import { useAuth } from './AuthContext';
import apiService from '../services/apiService';
import { PersistentNotification } from '../types';

export interface PersistentNotificationsContextValue {
    notifications: PersistentNotification[];
    unreadCount: number;
    loaded: boolean;
    refresh: () => Promise<void>;
    markRead: (ids: number[]) => Promise<void>;
    markAllRead: () => Promise<void>;
    deleteNotification: (id: number) => Promise<void>;
}

const PersistentNotificationsContext = createContext<PersistentNotificationsContextValue | null>(null);

export const PersistentNotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { rpcAction } = useDataCore();
    const { currentUser } = useAuth();
    const [notifications, setNotifications] = useState<PersistentNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loaded, setLoaded] = useState(false);

    const uid = currentUser?.id ?? null;

    // Shared refetch, used by the realtime handler + the mutations below (both
    // fire from event handlers / async callbacks — never synchronously in an
    // effect body).
    const refresh = useCallback(async () => {
        try {
            const data = await apiService.getStateSubset('notifications');
            setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
            setUnreadCount(typeof data?.unreadCount === 'number' ? data.unreadCount : 0);
            setLoaded(true);
        } catch {
            // Non-fatal — the bell keeps its last-known state.
        }
    }, []);

    // Initial load whenever a signed-in user is present. Fetch + setState run in
    // a nested async fn (never a synchronous setState in the effect body), guarded
    // against a post-unmount write.
    useEffect(() => {
        if (!uid) return;
        let cancelled = false;
        void (async () => {
            try {
                const data = await apiService.getStateSubset('notifications');
                if (cancelled) return;
                setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
                setUnreadCount(typeof data?.unreadCount === 'number' ? data.unreadCount : 0);
                setLoaded(true);
            } catch {
                /* non-fatal */
            }
        })();
        return () => { cancelled = true; };
    }, [uid]);

    // Realtime: refetch ONLY when the id-only signal targets this user. The
    // refetch fires from the event listener (not the effect body).
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { targetUserId?: number } | undefined;
            if (detail?.targetUserId != null && detail.targetUserId === uid) {
                void refresh();
            }
        };
        window.addEventListener('app:realtime:notification-update', handler);
        return () => window.removeEventListener('app:realtime:notification-update', handler);
    }, [refresh, uid]);

    const markRead = useCallback(async (ids: number[]) => {
        const targets = ids.filter((id) => Number.isInteger(id) && id > 0);
        if (targets.length === 0) return;
        // Optimistic: flip locally, then confirm + reconcile with the server.
        const now = new Date().toISOString();
        setNotifications((prev) => prev.map((n) => (targets.includes(n.id) && !n.readAt ? { ...n, readAt: now } : n)));
        setUnreadCount((prev) => Math.max(0, prev - targets.length));
        await rpcAction('notifications:mark_read', { notificationIds: targets });
        await refresh();
    }, [rpcAction, refresh]);

    const markAllRead = useCallback(async () => {
        const now = new Date().toISOString();
        setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
        setUnreadCount(0);
        await rpcAction('notifications:mark_all_read', {});
        await refresh();
    }, [rpcAction, refresh]);

    const deleteNotification = useCallback(async (id: number) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        await rpcAction('notifications:delete', { notificationId: id });
        await refresh();
    }, [rpcAction, refresh]);

    const value = useMemo<PersistentNotificationsContextValue>(() => ({
        notifications, unreadCount, loaded, refresh, markRead, markAllRead, deleteNotification,
    }), [notifications, unreadCount, loaded, refresh, markRead, markAllRead, deleteNotification]);

    return <PersistentNotificationsContext value={value}>{children}</PersistentNotificationsContext>;
};

export const usePersistentNotifications = (): PersistentNotificationsContextValue => {
    const ctx = use(PersistentNotificationsContext);
    if (!ctx) throw new Error('usePersistentNotifications must be used within a PersistentNotificationsProvider');
    return ctx;
};
