import React, { useCallback, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useI18n } from '../../i18n/I18nContext';

// Shared manual open/close controls for the StarComms operation. Reused by the
// admin StarComms tab (V3) and the Operations/Dispatch widget (V3.1) so the
// gating/confirm/write/refresh logic lives in ONE place.
//
// Safety: these are MANUAL, admin-only actions. The buttons render only for
// users with admin:access (the same permission the backend enforces on
// admin:starcomms_open / admin:starcomms_close) — normal ops/dispatch users see
// the read-only status but no controls. The owner API key never reaches this
// component; writes go through the myRSI action dispatcher. No auto-sync.

interface WriteResponse { ok: boolean; error: { kind: string; message: string } | null }

export interface StarCommsOperationControlsViewProps {
    /** True when the viewer holds admin:access (may open/close). */
    canManage: boolean;
    /** STARCOMMS_ENABLED. */
    enabled: boolean;
    /** enabled && base-url && key present. */
    configured: boolean;
    /** Current StarComms operation flag; null = unknown/unavailable. */
    operationOpen: boolean | null;
    /** Whether a live status is available (false → buttons disabled). */
    statusAvailable: boolean;
    /** Which write (if any) is in flight — drives the spinner/disabled state. */
    writing: null | 'open' | 'close';
    /** Compact layout for the operational widget; full card for the admin tab. */
    compact: boolean;
    /** Optional last-refresh label (shown in the full/admin variant). */
    lastRefresh?: string | null;
    onOpen: () => void;
    onClose: () => void;
}

/** Pure, prop-driven view — no context, fully testable. Renders NOTHING unless
 *  the viewer is an admin (admin:access) and the integration is enabled, so the
 *  operational widget stays read-only for non-admins. */
export const StarCommsOperationControlsView: React.FC<StarCommsOperationControlsViewProps> = ({
    canManage, enabled, configured, operationOpen, statusAvailable, writing, compact, lastRefresh, onOpen, onClose,
}) => {
    const { t } = useI18n();
    if (!canManage || !enabled) return null;

    const known = statusAvailable && operationOpen !== null;
    const canOpen = configured && known && operationOpen === false && !writing;
    const canClose = configured && known && operationOpen === true && !writing;
    const openTitle = !configured ? t('Not fully configured.') : !known ? t('Status unavailable.') : operationOpen === true ? t('The operation is already open.') : undefined;
    const closeTitle = !configured ? t('Not fully configured.') : !known ? t('Status unavailable.') : operationOpen === false ? t('The operation is already closed.') : undefined;

    const buttons = (
        <div className="flex flex-wrap gap-2">
            <button
                onClick={onOpen}
                disabled={!canOpen}
                title={openTitle}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <i className={`fa-solid ${writing === 'open' ? 'fa-circle-notch animate-spin' : 'fa-play'} mr-1.5`} />{t('Open StarComms operation')}
            </button>
            <button
                onClick={onClose}
                disabled={!canClose}
                title={closeTitle}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <i className={`fa-solid ${writing === 'close' ? 'fa-circle-notch animate-spin' : 'fa-stop'} mr-1.5`} />{t('Close StarComms operation')}
            </button>
        </div>
    );

    // Compact variant for the operational widget — the widget already shows the
    // current operation state + last refresh in its grid, so this is just a
    // labelled button row that makes the manual/admin nature explicit.
    if (compact) {
        return (
            <div className="pt-3 mt-1 border-t border-white/5 space-y-2">
                <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black flex items-center gap-1.5">
                    <i className="fa-solid fa-tower-broadcast text-sky-400" /> {t('Manual operation control')}
                    <span className="text-slate-600 normal-case tracking-normal font-normal">· {t('Admin only — no auto-sync')}</span>
                </div>
                {buttons}
            </div>
        );
    }

    // Full card for the admin StarComms tab.
    return (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.03] px-4 py-3 space-y-3">
            <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-sky-300 flex items-center gap-2">
                    <i className="fa-solid fa-tower-broadcast" /> {t('Manual operation control')}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                    {t('Manually open or close the StarComms operation. These are one-off admin actions — myRSI does not sync to StarComms automatically.')}
                </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500 uppercase tracking-widest font-black">{t('Current operation:')}</span>
                <span className={`font-bold ${operationOpen === true ? 'text-emerald-300' : operationOpen === false ? 'text-slate-300' : 'text-slate-500'}`}>
                    {operationOpen === true ? t('Open') : operationOpen === false ? t('Closed') : t('Unknown')}
                </span>
                {lastRefresh && <span className="text-slate-500">· {t('Last refreshed: {time}', { time: lastRefresh })}</span>}
            </div>
            {buttons}
            {!known && configured && (
                <p className="text-[11px] text-amber-300/80"><i className="fa-solid fa-triangle-exclamation mr-1.5" />{t('StarComms status is unavailable — refresh with Test Connection before changing the operation state.')}</p>
            )}
        </div>
    );
};

export interface StarCommsOperationControlsProps {
    enabled: boolean;
    configured: boolean;
    operationOpen: boolean | null;
    statusAvailable: boolean;
    /** Called after a successful write so the host re-fetches the status. */
    onRefresh: () => Promise<void> | void;
    lastRefresh?: string | null;
    compact?: boolean;
}

/** Container: wires the admin gate + confirmation dialog + existing V3 write
 *  actions + refresh. The write endpoint/key never touch the client — rpcAction
 *  dispatches to the admin:access-gated server action. */
const StarCommsOperationControls: React.FC<StarCommsOperationControlsProps> = ({
    enabled, configured, operationOpen, statusAvailable, onRefresh, lastRefresh, compact = false,
}) => {
    const { hasPermission } = useAuth();
    const { rpcAction } = useData();
    const { confirm, addToast } = useNotification();
    const { t } = useI18n();
    const [writing, setWriting] = useState<null | 'open' | 'close'>(null);
    const canManage = hasPermission('admin:access');

    const doWrite = useCallback(async (open: boolean) => {
        const ok = await confirm({
            title: open ? t('Open StarComms operation?') : t('Close StarComms operation?'),
            message: open
                ? t('This manually opens the StarComms operation and notifies connected clients. It does not sync automatically with myRSI.')
                : t('This manually closes the StarComms operation and notifies connected clients. It does not sync automatically with myRSI.'),
            confirmText: open ? t('Open operation') : t('Close operation'),
            variant: open ? 'info' : 'danger',
        });
        if (!ok) return;
        setWriting(open ? 'open' : 'close');
        try {
            const res = await rpcAction(open ? 'admin:starcomms_open' : 'admin:starcomms_close', {}) as WriteResponse;
            if (res.ok) {
                addToast(open ? t('StarComms operation opened.') : t('StarComms operation closed.'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50');
                await onRefresh();
            } else {
                addToast(res.error?.message || t('StarComms action failed.'), <i className="fa-solid fa-triangle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50');
            }
        } catch (e) {
            addToast(e instanceof Error ? e.message : t('StarComms action failed.'), <i className="fa-solid fa-triangle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50');
        } finally {
            setWriting(null);
        }
    }, [confirm, addToast, rpcAction, onRefresh, t]);

    return (
        <StarCommsOperationControlsView
            canManage={canManage}
            enabled={enabled}
            configured={configured}
            operationOpen={operationOpen}
            statusAvailable={statusAvailable}
            writing={writing}
            compact={compact}
            lastRefresh={lastRefresh}
            onOpen={() => void doWrite(true)}
            onClose={() => void doWrite(false)}
        />
    );
};

export default StarCommsOperationControls;
