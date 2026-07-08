// AcademyContext owns the Academy (LMS) domain slices. Thin slice-owner in the
// WarehouseContext mould: it holds state, registers slice setters with DataCore
// (so applyStateData fans a 'academy' / 'academy_my' subset response into them),
// and exposes refreshAcademy / refreshMyAcademy which DataContext registers
// (they wrap fetchDataSubset). Academy tab components consume useAcademy() for
// state + refresh and useData() for rpcAction — so, unlike Warehouse, these
// fields are NOT re-exposed on the useData() shim (no legacy consumers).
//
// Provider order: mounts OUTSIDE DataProvider (between QuartermasterProvider and
// DataProvider) so DataContext can call useAcademy() in its body to register the
// refresh callbacks. Inside DataCoreProvider so useDataCore() is available.
//
// Slices (4): academyCourses + academySessions (staff 'academy' subset),
//             academyCatalog + academyMyEnrollments (self 'academy_my' subset).
//
// Feature gating: academy is feature-gated per-org (orgMeta.features.academy).
// The staff realtime handler (academy_update → fetchDataSubset('academy')) is
// always registered on the staff channel for academy:view holders; the slice
// setters fire regardless and are simply never invoked when the feature is off.

import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataCore } from './DataCoreContext';
import type { AcademyCourse, AcademySession, AcademyEnrollment } from '../types';

export interface AcademyContextValue {
    // --- State slices (4) ---
    academyCourses: AcademyCourse[];        // staff: all courses (management)
    academySessions: AcademySession[];      // staff: all sessions (management)
    academyCatalog: AcademyCourse[];        // student: published courses
    academyMyEnrollments: AcademyEnrollment[]; // student: my enrolments

    // --- Refresh (registered by DataContext; wrap fetchDataSubset) ---
    refreshAcademy: () => Promise<void> | void;     // 'academy' (staff) subset
    refreshMyAcademy: () => Promise<void> | void;    // 'academy_my' (self) subset

    // --- Refresh registration (DataContext calls these on mount) ---
    registerRefreshAcademy: (fn: () => Promise<void> | void) => () => void;
    registerRefreshMyAcademy: (fn: () => Promise<void> | void) => () => void;
}

const AcademyContext = createContext<AcademyContextValue | null>(null);

export const AcademyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { registerSliceSetter } = useDataCore();

    const [academyCourses, setAcademyCourses] = useState<AcademyCourse[]>([]);
    const [academySessions, setAcademySessions] = useState<AcademySession[]>([]);
    const [academyCatalog, setAcademyCatalog] = useState<AcademyCourse[]>([]);
    const [academyMyEnrollments, setAcademyMyEnrollments] = useState<AcademyEnrollment[]>([]);

    // --- Refresh-callback registration (ref pattern; DataContext owns fetchDataSubset) ---
    const refreshAcademyRef = useRef<(() => Promise<void> | void) | null>(null);
    const refreshMyAcademyRef = useRef<(() => Promise<void> | void) | null>(null);

    const registerRefreshAcademy = useCallback((fn: () => Promise<void> | void) => {
        refreshAcademyRef.current = fn;
        return () => { if (refreshAcademyRef.current === fn) refreshAcademyRef.current = null; };
    }, []);
    const registerRefreshMyAcademy = useCallback((fn: () => Promise<void> | void) => {
        refreshMyAcademyRef.current = fn;
        return () => { if (refreshMyAcademyRef.current === fn) refreshMyAcademyRef.current = null; };
    }, []);

    const refreshAcademy = useCallback(async () => { const fn = refreshAcademyRef.current; if (fn) await fn(); }, []);
    const refreshMyAcademy = useCallback(async () => { const fn = refreshMyAcademyRef.current; if (fn) await fn(); }, []);

    // --- Slice-setter registration (keyed by data-payload field name) ---
    useEffect(() => {
        const unregCourses = registerSliceSetter('academyCourses', (data: { academyCourses?: AcademyCourse[] }) => {
            if (data.academyCourses) setAcademyCourses(data.academyCourses);
        });
        const unregSessions = registerSliceSetter('academySessions', (data: { academySessions?: AcademySession[] }) => {
            if (data.academySessions) setAcademySessions(data.academySessions);
        });
        const unregCatalog = registerSliceSetter('academyCatalog', (data: { academyCatalog?: AcademyCourse[] }) => {
            if (data.academyCatalog) setAcademyCatalog(data.academyCatalog);
        });
        const unregEnrollments = registerSliceSetter('academyMyEnrollments', (data: { academyMyEnrollments?: AcademyEnrollment[] }) => {
            if (data.academyMyEnrollments) setAcademyMyEnrollments(data.academyMyEnrollments);
        });
        return () => { unregCourses(); unregSessions(); unregCatalog(); unregEnrollments(); };
    }, [registerSliceSetter]);

    const value = useMemo<AcademyContextValue>(() => ({
        academyCourses, academySessions, academyCatalog, academyMyEnrollments,
        refreshAcademy, refreshMyAcademy,
        registerRefreshAcademy, registerRefreshMyAcademy,
    }), [
        academyCourses, academySessions, academyCatalog, academyMyEnrollments,
        refreshAcademy, refreshMyAcademy, registerRefreshAcademy, registerRefreshMyAcademy,
    ]);

    return <AcademyContext value={value}>{children}</AcademyContext>;
};

export const useAcademy = (): AcademyContextValue => {
    const ctx = use(AcademyContext);
    if (!ctx) throw new Error('useAcademy must be used within an AcademyProvider');
    return ctx;
};
