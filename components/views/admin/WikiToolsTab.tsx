
import React, { useState, useRef } from 'react';
import { useData } from '../../../contexts/DataContext';
import { useConfig } from '../../../contexts/ConfigContext';
import { useFormatDate } from '../../../contexts/AuthContext';
import { WikiExportBundle, WikiImportMode, WikiImportResult } from '../../../types';
import { TabPageHeader } from '../../shared/ui';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';

const WikiToolsTab: React.FC = () => {
    const { rpcAction, refreshWiki } = useData();
    const { brandingConfig } = useConfig();
    const fmt = useFormatDate();
    const { addToast, confirm } = useNotification();
    const { t } = useI18n();

    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [bundle, setBundle] = useState<WikiExportBundle | null>(null);
    const [bundleFilename, setBundleFilename] = useState<string>('');
    const [parseError, setParseError] = useState<string>('');
    const [mode, setMode] = useState<WikiImportMode>('skip');
    const [includeHomeConfig, setIncludeHomeConfig] = useState(false);
    const [lastResult, setLastResult] = useState<WikiImportResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const result: WikiExportBundle = await rpcAction('wiki:export_pages', {});
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            const orgSlug = slugify(brandingConfig?.name || result.sourceOrg?.name || 'wiki');
            link.href = url;
            link.download = `wiki-export-${orgSlug}-${date}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            addToast(
                t('Export ready'),
                <i className="fa-solid fa-check" />,
                'bg-emerald-500/10 text-emerald-400 border-emerald-500/50',
                { description: t('{count} pages exported.', { count: result.pages.length }) }
            );
        } catch (err: any) {
            addToast(
                t('Export failed'),
                <i className="fa-solid fa-xmark" />,
                'bg-red-500/10 text-red-400 border-red-500/50',
                { description: err?.message || t('Could not generate export.') }
            );
        } finally {
            setIsExporting(false);
        }
    };

    const validateBundle = (raw: any): WikiExportBundle | string => {
        if (!raw || typeof raw !== 'object') return t('Not a JSON object.');
        if (raw.version !== 1) return t('Unsupported export version: {version}. This tool expects version 1.', { version: raw.version });
        if (!Array.isArray(raw.pages)) return t('Bundle is missing a "pages" array.');
        for (const p of raw.pages) {
            if (!p || typeof p !== 'object') return t('Bundle contains an invalid page entry.');
            if (typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.slug !== 'string') {
                return t('Bundle contains pages with missing required fields (id/title/slug).');
            }
        }
        return raw as WikiExportBundle;
    };

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setParseError('');
        setBundle(null);
        setLastResult(null);
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || ''));
                const validated = validateBundle(parsed);
                if (typeof validated === 'string') {
                    setParseError(validated);
                    return;
                }
                setBundle(validated);
                setBundleFilename(file.name);
            } catch (err: any) {
                setParseError(t('Could not parse JSON: {message}', { message: err?.message || t('unknown error') }));
            }
        };
        reader.onerror = () => setParseError(t('Could not read file.'));
        reader.readAsText(file);
    };

    const handleImport = async () => {
        if (!bundle) return;
        const modeLabel = mode === 'skip' ? t('Skip conflicts') : mode === 'overwrite' ? t('Overwrite existing') : t('Always insert as new');
        const homeNote = includeHomeConfig ? ' ' + t('The wiki home layout will also be replaced.') : '';
        const variant: 'danger' | 'info' = mode === 'overwrite' ? 'danger' : 'info';
        const confirmed = await confirm({
            title: t('Confirm Wiki Import'),
            message: t('Import {count} pages from {source} using policy "{policy}".', { count: bundle.pages.length, source: bundle.sourceOrg?.name || t('unknown source'), policy: modeLabel }) + homeNote + ' ' + t('Limiting markers will be stripped.'),
            confirmText: mode === 'overwrite' ? t('Overwrite') : t('Import'),
            variant,
        });
        if (!confirmed) return;

        setIsImporting(true);
        setLastResult(null);
        try {
            const result: WikiImportResult = await rpcAction('wiki:import_pages', {
                bundle,
                mode,
                importHomeConfig: includeHomeConfig,
            });
            setLastResult(result);
            await refreshWiki();
            addToast(
                t('Import complete'),
                <i className="fa-solid fa-check" />,
                'bg-emerald-500/10 text-emerald-400 border-emerald-500/50',
                { description: t('Inserted {inserted}, updated {updated}, skipped {skipped}.', { inserted: result.inserted, updated: result.updated, skipped: result.skipped }) }
            );
        } catch (err: any) {
            addToast(
                t('Import failed'),
                <i className="fa-solid fa-xmark" />,
                'bg-red-500/10 text-red-400 border-red-500/50',
                { description: err?.message || t('Could not import bundle.') }
            );
        } finally {
            setIsImporting(false);
        }
    };

    const clearBundle = () => {
        setBundle(null);
        setBundleFilename('');
        setParseError('');
        setLastResult(null);
    };

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            <TabPageHeader
                title={t("Wiki Export & Import")}
                icon="fa-solid fa-book"
                accent="emerald"
                subtitle={t("Back up the org wiki to a JSON file, restore it later, or seed a new org from another org's content. Limiting markers and user attribution are not transferred.")}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
                    <div className="px-6 py-4 bg-slate-800/50 border-b border-slate-700/50 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{t('Export')}</h3>
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className="text-[10px] bg-sky-600 hover:bg-sky-500 text-white px-3 py-1 rounded-sm font-bold uppercase transition-colors disabled:opacity-50"
                        >
                            {isExporting ? <i className="fa-solid fa-spinner animate-spin"></i> : <><i className="fa-solid fa-download mr-1"></i>{t('Download JSON')}</>}
                        </button>
                    </div>
                    <div className="p-6 text-sm text-slate-300 space-y-3">
                        <p>{t('Generates a JSON snapshot containing every wiki page (title, slug, content, classification level, sort order, parent tree) plus the wiki home layout.')}</p>
                        <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                            <li>{t('Limiting markers are listed by name only; they are not re-applied on import.')}</li>
                            <li>{t('Author attribution (creator/updater) is not preserved across orgs.')}</li>
                            <li>{t('Embedded image URLs are kept verbatim — they may break across orgs.')}</li>
                        </ul>
                    </div>
                </div>

                <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
                    <div className="px-6 py-4 bg-slate-800/50 border-b border-slate-700/50 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{t('Import')}</h3>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={handleFileSelected}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isImporting}
                            className="text-[10px] bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-3 py-1 rounded-sm font-bold uppercase transition-colors disabled:opacity-50"
                        >
                            <i className="fa-solid fa-folder-open mr-1"></i>{t('Choose File')}
                        </button>
                    </div>

                    <div className="p-6 space-y-4">
                        {parseError && (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                                <i className="fa-solid fa-triangle-exclamation mr-2"></i>{parseError}
                            </div>
                        )}

                        {!bundle && !parseError && (
                            <p className="text-xs text-slate-500">{t('No file selected. Choose a previously-exported wiki JSON file to begin.')}</p>
                        )}

                        {bundle && (
                            <>
                                <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300 space-y-1">
                                    <div><span className="text-slate-500 uppercase tracking-wider mr-2">{t('File:')}</span>{bundleFilename}</div>
                                    <div><span className="text-slate-500 uppercase tracking-wider mr-2">{t('Source org:')}</span>{bundle.sourceOrg?.name || '—'}</div>
                                    <div><span className="text-slate-500 uppercase tracking-wider mr-2">{t('Pages:')}</span>{bundle.pages.length}</div>
                                    <div><span className="text-slate-500 uppercase tracking-wider mr-2">{t('Exported:')}</span>{fmt(bundle.exportedAt)}</div>
                                    {bundle.wikiHomeConfig && (
                                        <div><span className="text-slate-500 uppercase tracking-wider mr-2">{t('Includes:')}</span>{t('Wiki home layout')}</div>
                                    )}
                                </div>

                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{t('Conflict Policy')}</div>
                                    <div className="space-y-1.5">
                                        {([
                                            { value: 'skip', label: 'Skip conflicts', desc: 'Existing pages with the same slug are left alone. New pages are added.' },
                                            { value: 'overwrite', label: 'Overwrite existing', desc: 'Existing pages are replaced with the imported version. Destructive.' },
                                            { value: 'new', label: 'Always insert as new', desc: 'Every imported page becomes a new row. Slugs collide-suffix as needed.' },
                                        ] as { value: WikiImportMode; label: string; desc: string }[]).map((opt) => (
                                            <label key={opt.value} className={`flex items-start gap-3 p-2.5 rounded border cursor-pointer transition-colors ${
                                                mode === opt.value
                                                    ? 'bg-sky-600/10 border-sky-500/40'
                                                    : 'bg-slate-900/40 border-slate-700/40 hover:border-slate-600'
                                            }`}>
                                                <input
                                                    type="radio"
                                                    name="wiki-import-mode"
                                                    value={opt.value}
                                                    checked={mode === opt.value}
                                                    onChange={() => setMode(opt.value)}
                                                    className="mt-0.5 accent-sky-500"
                                                />
                                                <div className="flex-1">
                                                    <div className="text-xs font-bold text-white">{t(opt.label)}</div>
                                                    <div className="text-[11px] text-slate-400">{t(opt.desc)}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {bundle.wikiHomeConfig && (
                                    <label className="flex items-start gap-3 p-2.5 rounded-sm border bg-slate-900/40 border-slate-700/40 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={includeHomeConfig}
                                            onChange={(e) => setIncludeHomeConfig(e.target.checked)}
                                            className="mt-0.5 accent-sky-500"
                                        />
                                        <div className="flex-1">
                                            <div className="text-xs font-bold text-white">{t('Also import wiki home layout')}</div>
                                            <div className="text-[11px] text-slate-400">{t('Replaces the current wiki home page configuration with the one in the bundle.')}</div>
                                        </div>
                                    </label>
                                )}

                                <div className="flex gap-2 pt-2">
                                    <button
                                        onClick={handleImport}
                                        disabled={isImporting}
                                        className="text-[10px] bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-sm font-bold uppercase transition-colors disabled:opacity-50"
                                    >
                                        {isImporting ? <><i className="fa-solid fa-spinner animate-spin mr-1"></i>{t('Importing...')}</> : <><i className="fa-solid fa-upload mr-1"></i>{t('Run Import')}</>}
                                    </button>
                                    <button
                                        onClick={clearBundle}
                                        disabled={isImporting}
                                        className="text-[10px] bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-4 py-2 rounded-sm font-bold uppercase transition-colors disabled:opacity-50"
                                    >
                                        {t('Clear')}
                                    </button>
                                </div>
                            </>
                        )}

                        {lastResult && (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                                <i className="fa-solid fa-check mr-2"></i>
                                {t('Inserted {inserted}, updated {updated}, skipped {skipped}.', { inserted: lastResult.inserted, updated: lastResult.updated, skipped: lastResult.skipped })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WikiToolsTab;
