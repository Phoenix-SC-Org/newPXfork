import React, { useCallback, useEffect, useState } from 'react';
import { useData } from '../../contexts/DataContext';
import { useI18n } from '../../i18n/I18nContext';
import { deriveCommsAwareness, KNOWN_FEATURE_KEYS, STALE_AFTER_MS } from './starCommsAwareness';

// Read-only StarComms status widget for operational areas (Operations / Dispatch).
// Data comes from the cached `operation:starcomms_status` service action — a
// secret-free config summary + normalized status. The owner API key never
// reaches this component. The widget loads on its own async path and never
// blocks the host page; on disabled / permission-denied it renders nothing.

interface CommsConfig { provider: string; enabled: boolean; configured: boolean; baseUrl: string | null; timeoutMs: number }
interface CommsNet { id: string | null; name: string | null;[k: string]: unknown }
interface CommsStatus {
    guildId: string | null;
    guildName: string | null;
    shard: { publicUrl: string | null; version: string | null };
    connectedOperators: number | null;
    operationOpen: boolean | null;
    nets: CommsNet[];
    features: Record<string, boolean>;
}
interface CommsError { kind: string; message: string }
interface StatusResponse { config: CommsConfig; status: CommsStatus | null; error: CommsError | null; fetchedAt: string | null }

interface ViewProps {
    loading: boolean;
    refreshing: boolean;
    config: CommsConfig | null;
    status: CommsStatus | null;
    error: CommsError | null;
    lastRefresh: string | null;
    operationActive: boolean;
    stale: boolean;
    onRefresh: () => void;
}

const Cell: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black">{label}</div>
        <div className="text-sm text-slate-200 font-mono">{value}</div>
    </div>
);

/** Pure presentational view — no context, fully prop-driven (testable). */
export const StarCommsStatusView: React.FC<ViewProps> = ({ loading, refreshing, config, status, error, lastRefresh, operationActive, stale, onRefresh }) => {
    const { t } = useI18n();
    const ok = !!status && !error;
    const yesNo = (v: boolean | null) => (v === null ? '—' : v ? t('Yes') : t('No'));
    const awareness = deriveCommsAwareness(status, operationActive);
    // Resolve each awareness key to display text via literal t() calls (keeps the
    // i18n scanner able to see the natural keys, and DE translations in sync).
    const awarenessText: Record<string, string> = {
        'op-closed': t('myRSI operation is active, but StarComms operation is closed.'),
        'op-open-no-myrsi': t('StarComms operation is open, but no active myRSI operation was detected.'),
        'no-operators': t('No StarComms operators are currently connected.'),
        'no-nets': t('No StarComms nets are available.'),
        'acars-off': t('StarComms ACARS is disabled for this deployment.'),
    };
    // Known flags first (stable order), then any remaining provider flags.
    const featureKeys = status
        ? [...KNOWN_FEATURE_KEYS.filter((k) => k in status.features), ...Object.keys(status.features).filter((k) => !KNOWN_FEATURE_KEYS.includes(k as typeof KNOWN_FEATURE_KEYS[number]))]
        : [];

    return (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/5 bg-slate-800/40">
                <div className="flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-satellite-dish text-sky-400 text-sm" />
                    <span className="text-xs font-black uppercase tracking-widest text-slate-300">{t('StarComms')}</span>
                    {!loading && (
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${
                            ok ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : error ? 'bg-red-500/15 text-red-300 border-red-500/30'
                              : 'bg-slate-700/40 text-slate-400 border-slate-600/40'
                        }`}>
                            {ok ? t('Connected') : error ? t('Offline') : t('Not configured')}
                        </span>
                    )}
                </div>
                <button
                    onClick={onRefresh}
                    disabled={refreshing || loading}
                    title={t('Refresh')}
                    className="text-slate-500 hover:text-sky-400 transition-colors disabled:opacity-50 text-xs px-1.5 py-1"
                >
                    <i className={`fa-solid fa-rotate ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="p-4">
                {loading ? (
                    <div className="text-slate-500 text-xs"><i className="fa-solid fa-circle-notch animate-spin mr-2" />{t('Loading…')}</div>
                ) : config && config.enabled && !config.configured ? (
                    <div className="text-xs text-amber-300/90">
                        <i className="fa-solid fa-triangle-exclamation mr-1.5" />{t('StarComms is enabled but not fully configured.')}
                    </div>
                ) : error ? (
                    <div className="space-y-1.5">
                        <div className="text-xs text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5" />{error.message}</div>
                        {lastRefresh && <div className="text-[10px] text-slate-500">{t('Last good refresh: {time}', { time: lastRefresh })}</div>}
                    </div>
                ) : status ? (
                    <div className="space-y-3">
                        {/* Contextual, non-blocking warnings/hints (V2.1). */}
                        {awareness.length > 0 && (
                            <div className="space-y-1.5">
                                {awareness.map((a) => (
                                    <div
                                        key={a.key}
                                        className={`flex items-start gap-1.5 text-[11px] leading-snug rounded-md px-2 py-1.5 border ${
                                            a.level === 'warning'
                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                                                : 'bg-sky-500/10 border-sky-500/25 text-sky-200'
                                        }`}
                                    >
                                        <i className={`fa-solid ${a.level === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'} mt-0.5`} />
                                        <span>{awarenessText[a.key]}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {stale && (
                            <div className="text-[10px] text-amber-300/80">
                                <i className="fa-solid fa-clock-rotate-left mr-1" />{t('StarComms status may be stale — refresh for the latest.')}
                            </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Cell label={t('Operation Open')} value={yesNo(status.operationOpen)} />
                            <Cell label={t('Connected Operators')} value={status.connectedOperators ?? '—'} />
                            <Cell label={t('Shard Version')} value={status.shard.version || '—'} />
                            <Cell label={t('Last Refresh')} value={lastRefresh || '—'} />
                        </div>

                        <div>
                            <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black mb-1">{t('Nets')}</div>
                            {status.nets.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {status.nets.map((n, i) => (
                                        <span key={n.id || n.name || JSON.stringify(n)} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800/60 border border-slate-700/50 text-slate-300">
                                            {n.name || n.id || `#${i + 1}`}
                                        </span>
                                    ))}
                                </div>
                            ) : <span className="text-[10px] text-slate-500">{t('No nets reported.')}</span>}
                        </div>

                        {featureKeys.length > 0 && (
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black mb-1">{t('Feature Flags')}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {featureKeys.map((k) => {
                                        const v = status.features[k];
                                        return (
                                            <span key={k} className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${v ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-500'}`}>
                                                <i className={`fa-solid ${v ? 'fa-check' : 'fa-xmark'} mr-1`} />{k}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-slate-500">{t('No status available.')}</div>
                )}
            </div>
        </div>
    );
};

/** Container: fetches the cached status via rpcAction and manages state.
 *  Renders nothing when the integration is disabled or the caller lacks access.
 *  `operationActive` is the host view's authoritative "a myRSI operation/dispatch
 *  context is currently active" signal, used only to derive contextual hints. */
const StarCommsStatusWidget: React.FC<{ operationActive?: boolean }> = ({ operationActive = false }) => {
    const { rpcAction } = useData();
    const { locale } = useI18n();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [config, setConfig] = useState<CommsConfig | null>(null);
    const [status, setStatus] = useState<CommsStatus | null>(null);
    const [error, setError] = useState<CommsError | null>(null);
    const [fetchedAt, setFetchedAt] = useState<string | null>(null);
    const [hidden, setHidden] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await rpcAction('operation:starcomms_status', {}) as StatusResponse;
            setConfig(res.config);
            setStatus(res.status);
            setError(res.error);
            setFetchedAt(res.fetchedAt);
            // Hide entirely when the integration is off org-wide — keeps
            // operational areas clean for orgs not using StarComms.
            setHidden(!res.config?.enabled);
        } catch {
            // Permission denied (403) or any transport error: hide silently so a
            // broken widget never intrudes on the operational page.
            setHidden(true);
        }
    }, [rpcAction]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await fetchStatus();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [fetchStatus]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchStatus();
        setRefreshing(false);
    }, [fetchStatus]);

    // Staleness is a display-only concern: re-evaluate on a light interval so the
    // "may be stale" hint appears without ever issuing another network fetch
    // (avoids aggressive polling). The tick only bumps local state.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNowTick(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    if (hidden) return null;

    const lastRefresh = fetchedAt ? new Date(fetchedAt).toLocaleTimeString(locale) : null;
    const stale = !!fetchedAt && !error && nowTick - Date.parse(fetchedAt) > STALE_AFTER_MS;

    return (
        <StarCommsStatusView
            loading={loading}
            refreshing={refreshing}
            config={config}
            status={status}
            error={error}
            lastRefresh={lastRefresh}
            operationActive={operationActive}
            stale={stale}
            onRefresh={onRefresh}
        />
    );
};

export default StarCommsStatusWidget;
