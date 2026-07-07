import React, { useCallback, useEffect, useState } from 'react';
import { useData } from '../../../contexts/DataContext';
import { useI18n } from '../../../i18n/I18nContext';

// StarComms integration panel (V1: read-only). All data comes from the
// admin:starcomms_status / admin:starcomms_test service actions, which return
// a secret-free config summary + normalized status. The owner API key never
// reaches this component.

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

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black mb-0.5">{label}</div>
        <div className="text-sm text-slate-200 font-mono break-all">{value}</div>
    </div>
);

const StarCommsTab: React.FC = () => {
    const { rpcAction } = useData();
    const { t } = useI18n();

    const [config, setConfig] = useState<CommsConfig | null>(null);
    const [status, setStatus] = useState<CommsStatus | null>(null);
    const [error, setError] = useState<CommsError | null>(null);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    // Mount fetch. All setState happens AFTER the await, off the synchronous
    // effect path (loading initialises to true), so this doesn't cascade.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await rpcAction('admin:starcomms_status', {}) as StatusResponse;
                if (cancelled) return;
                setConfig(res.config);
                setStatus(res.status);
                setError(res.error);
            } catch (e) {
                if (!cancelled) setError({ kind: 'network', message: e instanceof Error ? e.message : 'Request failed.' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [rpcAction]);

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
            setTesting(false);
        }
    }, [rpcAction, t]);

    const yesNo = (v: boolean | null) => (v === null ? '—' : v ? t('Yes') : t('No'));

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-black text-white flex items-center gap-2">
                        <i className="fa-solid fa-satellite-dish text-sky-400" /> {t('StarComms')}
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">{t('External voice comms integration (read-only status).')}</p>
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
                </>
            )}
        </div>
    );
};

export default StarCommsTab;
