// RequestsContext owns the hydratedServiceRequests slice plus the
// service-request CRUD methods.
//
// Mounts OUTSIDE DataProvider so DataContext can call useRequests() in its body
// and re-expose hydratedServiceRequests on the useData() value, keeping the
// public API unchanged. Also mounts OUTSIDE AuthProvider/SessionProvider so
// SessionContext can register its refreshUser callback here (used by
// deleteRequest for a full-session refresh).
//
// CRUD methods emit success toasts/sounds inline; useNotification and useConfig
// are available because Requests mounts inside NotificationProvider (via
// UIProvider) and ConfigProvider.
//
// Hydration: registers a slice setter on 'requests' with DataCore, populated on
// initial state, any 'main'/'requests' subset response, and realtime resync.
// DataContext registers its refresh callback here at mount; CRUD methods call
// it after their RPC completes.

import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataCore } from './DataCoreContext';
import { useNotification } from './NotificationContext';
import { useConfig } from './ConfigContext';
import { useI18n } from '../i18n/I18nContext';
import { HydratedServiceRequest } from '../types';

export type { HydratedServiceRequest } from '../types';

export interface RequestsContextValue {
    hydratedServiceRequests: HydratedServiceRequest[];

    // Exposed for DataContext's optimisticUpdate ('service_requests') branch and
    // fetchDataSubset('requests') handler.
    setHydratedServiceRequests: React.Dispatch<React.SetStateAction<HydratedServiceRequest[]>>;

    createRequest: (data: any) => Promise<any>;
    createAdHocRequest: (data: any) => Promise<any>;
    cancelRequest: (id: string) => Promise<void>;
    deleteRequest: (id: string) => Promise<void>;
    updateRequestStatus: (id: string, status: string, notes?: string, report?: any) => Promise<void>;
    rateRequest: (id: string, rating: number, feedback: string) => Promise<void>;
    acceptRequest: (id: string, memberId: number) => Promise<void>;
    refuseRequest: (id: string, reason: string) => Promise<void>;
    addRequestNote: (id: string, note: string) => Promise<void>;
    triageRequest: (id: string, notes: string, urgency: string) => Promise<void>;
    adminAcceptAndAssignRequest: (id: string, leadId: number, notes: string, urgency?: string) => Promise<void>;
    dispatchMembers: (id: string, memberIds: number[]) => Promise<void>;
    startMission: (id: string) => Promise<void>;
    completeRequest: (requestId: string, report: any, userId: number) => Promise<void>;
    addResponder: (requestId: string, userId: number) => Promise<void>;
    removeResponder: (requestId: string, userId: number) => Promise<void>;
    setLeadResponder: (requestId: string, userId: number | undefined) => Promise<void>;

    /** DataContext registers its refreshRequests callback here at mount. */
    registerRefreshRequests: (fn: () => Promise<void> | void) => () => void;
    /** SessionContext registers its refreshUser callback here at mount;
     *  deleteRequest uses it for a full-session refresh. */
    registerRefreshUser: (fn: () => Promise<void> | void) => () => void;
}

const RequestsContext = createContext<RequestsContextValue | null>(null);

export const RequestsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { rpcAction, registerSliceSetter } = useDataCore();
    const { addToast, playSound } = useNotification();
    const { brandingConfig } = useConfig();
    const { t } = useI18n();

    const [hydratedServiceRequests, setHydratedServiceRequests] = useState<HydratedServiceRequest[]>([]);

    const refreshRequestsRef = useRef<(() => Promise<void> | void) | null>(null);
    const refreshUserRef = useRef<(() => Promise<void> | void) | null>(null);

    const registerRefreshRequests = useCallback((fn: () => Promise<void> | void) => {
        refreshRequestsRef.current = fn;
        return () => { if (refreshRequestsRef.current === fn) refreshRequestsRef.current = null; };
    }, []);
    const registerRefreshUser = useCallback((fn: () => Promise<void> | void) => {
        refreshUserRef.current = fn;
        return () => { if (refreshUserRef.current === fn) refreshUserRef.current = null; };
    }, []);

    const refreshRequestsFn = useCallback(async () => {
        const fn = refreshRequestsRef.current;
        if (fn) await fn();
    }, []);
    const refreshUserFn = useCallback(async () => {
        const fn = refreshUserRef.current;
        if (fn) await fn();
    }, []);

    useEffect(() => {
        const unreg = registerSliceSetter('requests', (data: any) => {
            if (data.requests) setHydratedServiceRequests(data.requests);
        });
        return unreg;
    }, [registerSliceSetter]);

    const createRequest = useCallback((data: any) =>
        rpcAction('request:create', { newRequest: data }).then(async (res) => {
            addToast(t("Request Created"), <i className="fa-solid fa-satellite-dish"></i>, "bg-sky-500/10 text-sky-400 border-sky-500/50", { description: t("Your service request has been submitted."), silent: true });
            playSound(brandingConfig.newRequestSoundUrl);
            await refreshRequestsFn();
            return res.id;
        }),
    [rpcAction, addToast, playSound, brandingConfig.newRequestSoundUrl, refreshRequestsFn, t]);

    const createAdHocRequest = useCallback((data: any) =>
        rpcAction('request:create_adhoc', { newRequest: data }).then(async (res) => {
            addToast(t("Ad-Hoc Logged"), <i className="fa-solid fa-pen-to-square"></i>, "bg-amber-500/10 text-amber-400 border-amber-500/50", { description: t("An ad-hoc service request has been logged."), silent: true });
            playSound(brandingConfig.newRequestSoundUrl);
            await refreshRequestsFn();
            return res.id;
        }),
    [rpcAction, addToast, playSound, brandingConfig.newRequestSoundUrl, refreshRequestsFn, t]);

    const cancelRequest = useCallback((id: string) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Cancelled' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:cancel', { requestId: id }).then(async () => {
            addToast(t("Request Cancelled"), <i className="fa-solid fa-ban"></i>, "bg-red-500/10 text-red-400 border-red-500/50", { description: t("The service request has been cancelled.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const deleteRequest = useCallback((id: string) => {
        setHydratedServiceRequests(prev => prev.filter(r => r.id !== id));
        return rpcAction('request:delete', { requestId: id }).then(async () => {
            // Full-session refresh via the registered Session.refreshUser callback.
            await refreshUserFn();
            addToast(t("Request Deleted"), <i className="fa-solid fa-trash"></i>, "bg-red-500/10 text-red-400 border-red-500/50", { description: t("The service request has been permanently removed.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshUserFn, refreshRequestsFn, t]);

    const updateRequestStatus = useCallback((id: string, status: string, notes?: string, report?: any) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: status as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:update_status', { requestId: id, status, notes, report }).then(async () => {
            addToast(t("Status Updated"), <i className="fa-solid fa-pen-to-square"></i>, "bg-sky-500/10 text-sky-400 border-sky-500/50", { description: t("Request status changed to {status}.", { status: t(status) }) });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const rateRequest = useCallback((id: string, rating: number, feedback: string) =>
        rpcAction('request:rate', { requestId: id, rating, feedback }).then(async () => {
            addToast(t("Feedback Submitted"), <i className="fa-solid fa-star"></i>, "bg-amber-500/10 text-amber-400 border-amber-500/50", { description: t("Your rating and feedback have been recorded.") });
            await refreshRequestsFn();
        }),
    [rpcAction, addToast, refreshRequestsFn, t]);

    const acceptRequest = useCallback((id: string, memberId: number) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Accepted' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:accept', { requestId: id, memberId }).then(async () => {
            addToast(t("Mission Accepted"), <i className="fa-solid fa-handshake"></i>, "bg-green-500/10 text-green-400 border-green-500/50", { description: t("You have accepted this mission."), silent: true });
            playSound(brandingConfig.assignmentSoundUrl);
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, playSound, brandingConfig.assignmentSoundUrl, refreshRequestsFn, t]);

    const refuseRequest = useCallback((id: string, reason: string) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Refused' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:refuse', { requestId: id, notes: reason }).then(async () => {
            addToast(t("Request Refused"), <i className="fa-solid fa-xmark"></i>, "bg-red-500/10 text-red-400 border-red-500/50", { description: t("The service request has been refused.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const addRequestNote = useCallback((id: string, note: string) =>
        rpcAction('request:add_note', { requestId: id, note }).then(() => { void refreshRequestsFn(); }),
    [rpcAction, refreshRequestsFn]);

    const triageRequest = useCallback((id: string, notes: string, urgency: string) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Triaged' as HydratedServiceRequest['status'], urgency: urgency as HydratedServiceRequest['urgency'] } : r));
        return rpcAction('request:triage', { requestId: id, notes, urgency }).then(async () => {
            addToast(t("Request Triaged"), <i className="fa-solid fa-filter"></i>, "bg-amber-500/10 text-amber-400 border-amber-500/50", { description: t("The request has been triaged and prioritized.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const adminAcceptAndAssignRequest = useCallback((id: string, leadId: number, notes: string, urgency?: string) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Accepted' as HydratedServiceRequest['status'], ...(urgency ? { urgency: urgency as HydratedServiceRequest['urgency'] } : {}) } : r));
        return rpcAction('request:admin_accept', { requestId: id, leadResponderId: leadId, notes, urgency }).then(async () => {
            addToast(t("Lead Assigned"), <i className="fa-solid fa-user-tag"></i>, "bg-green-500/10 text-green-400 border-green-500/50", { description: t("A lead responder has been assigned to the request."), silent: true });
            playSound(brandingConfig.assignmentSoundUrl);
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, playSound, brandingConfig.assignmentSoundUrl, refreshRequestsFn, t]);

    const dispatchMembers = useCallback((id: string, memberIds: number[]) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Accepted' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:dispatch_members', { requestId: id, memberIds }).then(async () => {
            addToast(t("Unit Dispatched"), <i className="fa-solid fa-tower-broadcast"></i>, "bg-teal-500/10 text-teal-400 border-teal-500/50", { description: t("Members have been dispatched to the request."), silent: true });
            playSound(brandingConfig.assignmentSoundUrl);
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, playSound, brandingConfig.assignmentSoundUrl, refreshRequestsFn, t]);

    const startMission = useCallback((id: string) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'In-Progress' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:start', { requestId: id }).then(async () => {
            addToast(t("Mission Started"), <i className="fa-solid fa-jet-fighter-up"></i>, "bg-green-500/10 text-green-400 border-green-500/50", { description: t("The mission is now in progress.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const completeRequest = useCallback((requestId: string, report: any, userId: number) => {
        setHydratedServiceRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'Success' as HydratedServiceRequest['status'] } : r));
        return rpcAction('request:complete', { requestId, report, userId }).then(async () => {
            addToast(t("Mission Completed"), <i className="fa-solid fa-flag-checkered"></i>, "bg-green-500/10 text-green-400 border-green-500/50", { description: t("The mission has been completed successfully.") });
            await refreshRequestsFn();
        });
    }, [rpcAction, addToast, refreshRequestsFn, t]);

    const addResponder = useCallback((requestId: string, userId: number) =>
        rpcAction('request:add_responder', { requestId, memberId: userId }).then(() => { void refreshRequestsFn(); }),
    [rpcAction, refreshRequestsFn]);

    const removeResponder = useCallback((requestId: string, userId: number) =>
        rpcAction('request:remove_responder', { requestId, memberId: userId }).then(() => { void refreshRequestsFn(); }),
    [rpcAction, refreshRequestsFn]);

    const setLeadResponder = useCallback((requestId: string, userId: number | undefined) =>
        rpcAction('request:set_lead', { requestId, memberId: userId }).then(() => { void refreshRequestsFn(); }),
    [rpcAction, refreshRequestsFn]);

    const value = useMemo<RequestsContextValue>(() => ({
        hydratedServiceRequests, setHydratedServiceRequests,
        createRequest, createAdHocRequest,
        cancelRequest, deleteRequest, updateRequestStatus,
        rateRequest, acceptRequest, refuseRequest,
        addRequestNote, triageRequest, adminAcceptAndAssignRequest,
        dispatchMembers, startMission, completeRequest,
        addResponder, removeResponder, setLeadResponder,
        registerRefreshRequests, registerRefreshUser,
    }), [
        hydratedServiceRequests,
        createRequest, createAdHocRequest,
        cancelRequest, deleteRequest, updateRequestStatus,
        rateRequest, acceptRequest, refuseRequest,
        addRequestNote, triageRequest, adminAcceptAndAssignRequest,
        dispatchMembers, startMission, completeRequest,
        addResponder, removeResponder, setLeadResponder,
        registerRefreshRequests, registerRefreshUser,
    ]);

    return <RequestsContext value={value}>{children}</RequestsContext>;
};

export const useRequests = (): RequestsContextValue => {
    const ctx = use(RequestsContext);
    if (!ctx) throw new Error('useRequests must be used within a RequestsProvider');
    return ctx;
};
