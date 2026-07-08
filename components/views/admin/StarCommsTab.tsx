import React, { useCallback, useEffect, useState } from 'react';
import { useData } from '../../../contexts/DataContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useI18n } from '../../../i18n/I18nContext';
import StarCommsOperationControls from '../../shared/StarCommsOperationControls';

// StarComms integration panel. Reads come from admin:starcomms_status /
// admin:starcomms_test; V3 adds manual admin-only write actions
// (admin:starcomms_open / admin:starcomms_close). All actions return a
// secret-free config summary — the owner API key never reaches this component.

interface CommsConfig {
    provider: string;
    enabled: boolean;
    configured: boolean;
    baseUrl: string | null;
    timeoutMs: number;
}
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
interface StatusResponse { config: CommsConfig; status: CommsStatus | null; error: CommsError | null }
interface TestResponse { config: CommsConfig; ok: boolean; status: CommsStatus | null; error: CommsError | null }

// Net Presets (V4)
interface NetPresetEntry { name: string; purpose?: string }
interface NetPreset { id: string; name: string; description: string; nets: NetPresetEntry[] }
interface PresetsResponse { presets: NetPreset[] }
interface NetPresetPreview {
    presetId: string;
    presetName: string;
    existing: { name: string; purpose?: string }[];
    toCreate: { name: string; purpose?: string }[];
    conflicts: { name: string; reason: string }[];
    unmanaged: string[];
    warnings: string[];
}
interface PreviewResponse { config: CommsConfig; ok: boolean; error: CommsError | null; preview: NetPresetPreview | null }

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black mb-0.5">{label}</div>
        <div className="text-sm text-slate-200 font-mono break-all">{value}</div>
    </div>
);

const StarCommsTab: React.FC = () => {
    const { rpcAction } = useData();
    const { hasPermission } = useAuth();
    const { t, locale } = useI18n();
    const canManage = hasPermission('admin:access');

    const [config, setConfig] = useState<CommsConfig | null>(null);
    const [status, setStatus] = useState<CommsStatus | null>(null);
    const [error, setError] = useState<CommsError | null>(null);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [lastRefresh, setLastRefresh] = useState<string | null>(null);

    // Net Presets (V4)
    const [presets, setPresets] = useState<NetPreset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<string>('');
    const [preview, setPreview] = useState<NetPresetPreview | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    // Reusable status load — also used to refresh after a manual write.
    const loadStatus = useCallback(async () => {
        try {
            const res = await rpcAction('admin:starcomms_status', {}) as StatusResponse;
            setConfig(res.config);
            setStatus(res.status);
            setError(res.error);
        } catch (e) {
            setError({ kind: 'network', message: e instanceof Error ? e.message : 'Request failed.' });
        } finally {
            setLastRefresh(new Date().toLocaleTimeString(locale));
        }
    }, [rpcAction, locale]);

    // Mount fetch. All setState happens AFTER the await, off the synchronous
    // effect path (loading initialises to true), so this doesn't cascade.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await loadStatus();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [loadStatus]);

    const runTest = useCallback(async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await rpcAction('admin:starcomms_test', {}) as TestResponse;
            setConfig(res.config);
            if (res.ok) {
                setStatus(res.status);
                setError(null);
                setTestResult({ ok: true, message: t('Connection OK') });
            } else {
                setStatus(null);
                setError(res.error);
                setTestResult({ ok: false, message: res.error?.message || t('Connection failed') });
            }
        } catch (e) {
            setTestResult({ ok: false, message: e instanceof Error ? e.message : t('Connection failed') });
        } finally {
            setLastRefresh(new Date().toLocaleTimeString(locale));
            setTesting(false);
        }
    }, [rpcAction, t, locale]);

    // Load the code-defined preset catalog once (secret-free, admin-only action).
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await rpcAction('admin:starcomms_list_net_presets', {}) as PresetsResponse;
                if (cancelled) return;
                setPresets(res.presets || []);
                setSelectedPreset((prev) => prev || res.presets?.[0]?.id || '');
            } catch { /* leave empty — the Net Presets section simply has nothing to preview */ }
        })();
        return () => { cancelled = true; };
    }, [rpcAction]);

    // Preview (Step 3) — READ-ONLY diff of the selected preset vs existing nets.
    const runPreview = useCallback(async () => {
        if (!selectedPreset) return;
        setPreviewing(true);
        setPreviewError(null);
        setPreview(null);
        try {
            const res = await rpcAction('admin:starcomms_preview_net_preset', { presetId: selectedPreset }) as PreviewResponse;
            if (res.ok && res.preview) setPreview(res.preview);
            else setPreviewError(res.error?.message || t('Preview failed.'));
        } catch (e) {
            setPreviewError(e instanceof Error ? e.message : t('Preview failed.'));
        } finally {
            setPreviewing(false);
        }
    }, [rpcAction, selectedPreset, t]);

    const yesNo = (v: boolean | null) => (v === null ? '—' : v ? t('Yes') : t('No'));
    const selectedPresetObj = presets.find((p) => p.id === selectedPreset) || null;
    // Warning keys → localized text (literal t() so the i18n scanner sees them).
    const warningText: Record<string, string> = {
        'no-delete': t('Existing StarComms nets are never deleted or renamed — Apply only creates the missing nets.'),
        'duplicate-in-preset': t('This preset contains duplicate net names; duplicates are ignored.'),
        'unmanaged-existing': t('Some existing nets are not part of this preset and will be left unchanged.'),
    };

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-black text-white flex items-center gap-2">
                        <i className="fa-solid fa-satellite-dish text-sky-400" /> {t('StarComms')}
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">{t('External voice comms integration (read-only status).')}</p>
                    <p className="text-xs text-slate-500 mt-1"><i className="fa-solid fa-circle-info mr-1.5" />{t('This status is also shown to Operations and Dispatch users via a read-only widget.')}</p>
                </div>
                <button
                    onClick={runTest}
                    disabled={testing || loading}
                    className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest bg-sky-500/10 text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                >
                    <i className={`fa-solid ${testing ? 'fa-circle-notch animate-spin' : 'fa-plug-circle-check'} mr-2`} />
                    {testing ? t('Testing…') : t('Test Connection')}
                </button>
            </div>

            {loading ? (
                <div className="text-slate-500 text-sm"><i className="fa-solid fa-circle-notch animate-spin mr-2" />{t('Loading…')}</div>
            ) : (
                <>
                    {/* Config summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Field label={t('Enabled')} value={yesNo(config?.enabled ?? null)} />
                        <Field label={t('Configured')} value={yesNo(config?.configured ?? null)} />
                        <Field label={t('Base URL')} value={config?.baseUrl || '—'} />
                        <Field label={t('Timeout')} value={config ? `${config.timeoutMs} ms` : '—'} />
                    </div>

                    {/* State banners */}
                    {config && !config.enabled && (
                        <div className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">
                            <i className="fa-solid fa-circle-info text-slate-400 mr-2" />
                            {t('Integration disabled. Set STARCOMMS_ENABLED=true and restart the app to enable.')}
                        </div>
                    )}
                    {config && config.enabled && !config.configured && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                            <i className="fa-solid fa-triangle-exclamation text-amber-400 mr-2" />
                            {t('Not fully configured. Set STARCOMMS_BASE_URL and STARCOMMS_OWNER_API_KEY, then restart.')}
                        </div>
                    )}

                    {/* Test result banner */}
                    {testResult && (
                        <div className={`rounded-lg border px-4 py-3 text-sm ${testResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
                            <i className={`fa-solid ${testResult.ok ? 'fa-circle-check text-emerald-400' : 'fa-circle-xmark text-red-400'} mr-2`} />
                            {testResult.message}
                        </div>
                    )}

                    {/* Error (from status load) */}
                    {error && !testResult && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                            <i className="fa-solid fa-circle-xmark text-red-400 mr-2" />
                            {error.message}
                        </div>
                    )}

                    {/* Live status */}
                    {status && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <Field label={t('Guild ID')} value={status.guildId || '—'} />
                                <Field label={t('Guild Name')} value={status.guildName || '—'} />
                                <Field label={t('Connected Operators')} value={status.connectedOperators ?? '—'} />
                                <Field label={t('Shard URL')} value={status.shard.publicUrl || '—'} />
                                <Field label={t('Shard Version')} value={status.shard.version || '—'} />
                                <Field label={t('Operation Open')} value={yesNo(status.operationOpen)} />
                            </div>

                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{t('Nets')}</h3>
                                {status.nets.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {status.nets.map((n, i) => (
                                            <span key={n.id || n.name || JSON.stringify(n)} className="px-2 py-1 rounded-md text-xs font-mono bg-slate-800/60 border border-slate-700/50 text-slate-300">
                                                {n.name || n.id || `#${i + 1}`}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500">{t('No nets reported.')}</p>
                                )}
                            </div>

                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{t('Feature Flags')}</h3>
                                {Object.keys(status.features).length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(status.features).map(([k, v]) => (
                                            <span key={k} className={`px-2 py-1 rounded-md text-xs font-mono border ${v ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-500'}`}>
                                                <i className={`fa-solid ${v ? 'fa-check' : 'fa-xmark'} mr-1`} />{k}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500">{t('No feature flags reported.')}</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Manual operation control (V3) — admin-only write actions,
                        shared with the Operations/Dispatch widget (V3.1). Renders
                        only for admins while the integration is enabled; disables
                        when misconfigured/unavailable/state-already-matches. */}
                    <StarCommsOperationControls
                        enabled={!!config?.enabled}
                        configured={!!config?.configured}
                        operationOpen={status?.operationOpen ?? null}
                        statusAvailable={!!status}
                        onRefresh={loadStatus}
                        lastRefresh={lastRefresh}
                    />

                    {/* Net Presets (V4) — admin-only. Preview is read-only (diffs a
                        preset's desired nets against existing nets). Apply (net
                        creation) is deferred until the StarComms create-net endpoint
                        is confirmed, so its button stays locked. Existing nets are
                        never deleted or renamed. */}
                    {canManage && config?.enabled && (
                        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.03] px-4 py-3 space-y-3">
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-sky-300 flex items-center gap-2">
                                    <i className="fa-solid fa-diagram-project" /> {t('Net Presets')}
                                </h3>
                                <p className="text-xs text-slate-400 mt-1">
                                    {t('Preview a preset of voice nets against StarComms, then create the missing ones. Manual and admin-only — existing nets are never deleted or renamed.')}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    value={selectedPreset}
                                    onChange={(e) => { setSelectedPreset(e.target.value); setPreview(null); setPreviewError(null); }}
                                    disabled={!config.configured || !status || previewing || presets.length === 0}
                                    className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-hidden focus:ring-1 focus:ring-sky-500/50 disabled:opacity-40"
                                >
                                    {presets.length === 0 && <option value="">{t('No presets available')}</option>}
                                    {presets.map((p) => <option key={p.id} value={p.id}>{t(p.name)}</option>)}
                                </select>
                                <button
                                    onClick={() => void runPreview()}
                                    disabled={!config.configured || !status || previewing || !selectedPreset}
                                    title={!config.configured ? t('Not fully configured.') : !status ? t('Status unavailable.') : undefined}
                                    className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-sky-500/10 text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <i className={`fa-solid ${previewing ? 'fa-circle-notch animate-spin' : 'fa-eye'} mr-1.5`} />{t('Preview changes')}
                                </button>
                                <span className="text-slate-500 text-xs">· {t('Operation Open')}: {yesNo(status?.operationOpen ?? null)}</span>
                            </div>

                            {selectedPresetObj && (
                                <div className="text-[11px] text-slate-400">
                                    <span className="uppercase tracking-widest font-black text-slate-500">{t('Desired nets:')}</span> {selectedPresetObj.nets.map((n) => n.name).join(' · ')}
                                </div>
                            )}

                            {previewError && (
                                <div className="text-xs text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5" />{previewError}</div>
                            )}

                            {preview && (
                                <div className="space-y-2 text-xs">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <div className="text-[9px] uppercase tracking-widest text-emerald-300/80 font-black mb-1">{t('Would be created')} ({preview.toCreate.length})</div>
                                            {preview.toCreate.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {preview.toCreate.map((n) => <span key={n.name} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">+ {n.name}</span>)}
                                                </div>
                                            ) : <span className="text-slate-500">{t('Nothing to create — all preset nets already exist.')}</span>}
                                        </div>
                                        <div>
                                            <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black mb-1">{t('Already exist')} ({preview.existing.length})</div>
                                            {preview.existing.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {preview.existing.map((n) => <span key={n.name} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800/60 border border-slate-700/50 text-slate-400">{n.name}</span>)}
                                                </div>
                                            ) : <span className="text-slate-500">—</span>}
                                        </div>
                                    </div>
                                    {preview.warnings.map((w) => (
                                        <p key={w} className="text-[10px] text-amber-300/80"><i className="fa-solid fa-triangle-exclamation mr-1.5" />{warningText[w] ?? w}</p>
                                    ))}
                                    {/* Apply — locked until the StarComms create-net endpoint is confirmed. */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <button
                                            disabled
                                            title={t('Applying (net creation) is not yet enabled — pending the StarComms create-net endpoint.')}
                                            className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-slate-700/40 text-slate-500 border border-slate-600/40 cursor-not-allowed"
                                        >
                                            <i className="fa-solid fa-lock mr-1.5" />{t('Apply preset')}
                                        </button>
                                        <span className="text-[10px] text-slate-500">{t('Apply is pending the StarComms create-net endpoint (Preview is read-only).')}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Operational awareness (V2.1) — read-only explainer of where
                        StarComms status is surfaced outside the admin panel, plus a
                        compact summary of any StarComms-side conditions worth noting.
                        No write controls. */}
                    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-4 py-3 space-y-2">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                            <i className="fa-solid fa-satellite-dish text-sky-400" /> {t('Operational awareness')}
                        </h3>
                        <p className="text-xs text-slate-400">
                            {t('A read-only StarComms status widget is shown in the Operations Center and the Dispatch Console. It surfaces contextual, non-blocking warnings when the StarComms operation state does not match myRSI (e.g. an active myRSI operation while StarComms is closed, or no operators connected).')}
                        </p>
                        {status && (
                            <ul className="text-xs text-slate-300 space-y-1 mt-1">
                                <li><i className="fa-solid fa-circle-dot text-slate-500 mr-1.5 text-[8px]" />{t('StarComms operation:')} {yesNo(status.operationOpen)}</li>
                                {status.connectedOperators === 0 && (
                                    <li className="text-amber-300"><i className="fa-solid fa-triangle-exclamation mr-1.5" />{t('No StarComms operators are currently connected.')}</li>
                                )}
                                {status.nets.length === 0 && (
                                    <li className="text-sky-300"><i className="fa-solid fa-circle-info mr-1.5" />{t('No StarComms nets are available.')}</li>
                                )}
                                {status.features.acarsEnabled === false && (
                                    <li className="text-sky-300"><i className="fa-solid fa-circle-info mr-1.5" />{t('StarComms ACARS is disabled for this deployment.')}</li>
                                )}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default StarCommsTab;
