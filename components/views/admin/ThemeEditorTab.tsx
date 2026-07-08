import React, { useState } from 'react';
import { useConfig } from '../../../contexts/ConfigContext';
import { TabPageHeader, SectionPanel } from '../../shared/ui';
import { useNotification } from '../../../contexts/NotificationContext';
import { normalizeHexColor } from '../../../lib/color';
import { accentRampVars, accentRampHexes } from '../../../lib/orgTheme';
import { contrastRatio, AA_BODY, AA_LARGE } from '../../../lib/a11y';

const DEFAULT_ACCENT = '#0ea5e9'; // sky-500
const SURFACE = '#0f172a';        // the app's dark surface (slate-900), fixed in v1

const ThemeEditorTab: React.FC = () => {
    const { themeConfig, updateThemeConfig } = useConfig();
    const { addToast } = useNotification();
    const [enabled, setEnabled] = useState<boolean>(themeConfig?.enabled === true);
    const [accent, setAccent] = useState<string>(() => normalizeHexColor(themeConfig?.accent) || DEFAULT_ACCENT);
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    // Re-sync local state when the saved config changes.
    const [prev, setPrev] = useState(themeConfig);
    if (themeConfig !== prev) {
        setPrev(themeConfig);
        setEnabled(themeConfig?.enabled === true);
        setAccent(normalizeHexColor(themeConfig?.accent) || DEFAULT_ACCENT);
    }

    const validAccent = normalizeHexColor(accent);
    const ramp = validAccent ? accentRampVars(validAccent) : null;
    // Candidate ramp applied ONLY to the preview wrapper — nothing outside changes, so a
    // bad in-progress pick can never render the admin UI itself unreadable.
    const previewStyle = ramp ? (ramp as unknown as React.CSSProperties) : undefined;

    // The app renders the L-PINNED ramp stops, NOT the raw accent — so measure the shades
    // that actually paint: the accent as link/icon text on the dark surface (sky-400), and
    // a white label on a primary button (sky-600). These are the honest, on-screen numbers.
    const stops = validAccent ? accentRampHexes(validAccent) : null;
    const linkContrast = stops ? contrastRatio(stops['400'], SURFACE) : 0;
    const buttonContrast = stops ? contrastRatio('#ffffff', stops['600']) : 0;
    // "Block only egregious" (the chosen a11y policy): sub-AA-large (3:1) is unreadable.
    // With lightness pinned this effectively never fires — it's a safety net, not a nag.
    const egregious = stops != null && (linkContrast < AA_LARGE || buttonContrast < AA_LARGE);

    // `min` = the WCAG bar that APPLIES to this pairing (4.5 normal text, 3.0 large/bold);
    // the tier label reflects the actual ratio, the colour reflects whether it clears its bar.
    const contrastBadge = (ratio: number, min: number) => {
        const tier = ratio >= AA_BODY ? 'AA' : ratio >= AA_LARGE ? 'AA large' : 'low';
        const ok = ratio >= min;
        const cls = ok ? 'text-emerald-400' : ratio >= AA_LARGE ? 'text-amber-400' : 'text-red-400';
        const icon = ok ? 'fa-check' : ratio >= AA_LARGE ? 'fa-circle-half-stroke' : 'fa-triangle-exclamation';
        return <span className={cls}><i className={`fa-solid ${icon} mr-1.5`} />{ratio.toFixed(1)}:1 {tier}</span>;
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updateThemeConfig({ enabled, accent: validAccent || undefined });
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 2000);
        } catch {
            addToast('Save Failed', <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: 'Failed to save theme settings. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            <TabPageHeader
                title="Custom Theme"
                icon="fa-solid fa-palette"
                accent="sky"
                subtitle="Brand the dashboard with your org's accent colour. Shades are auto-generated from your accent to keep the interface readable."
            />

            <SectionPanel title="Accent Colour" icon="fa-solid fa-brush">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <span className={`relative inline-block w-10 h-6 shrink-0 mt-0.5 rounded-full transition-colors ${enabled ? 'bg-sky-500' : 'bg-slate-700'}`}>
                                <input type="checkbox" className="sr-only" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                            </span>
                            <span>
                                <span className="block text-sm text-slate-200 font-medium">Enable custom theme</span>
                                <span className="block text-[11px] text-slate-500 mt-0.5">When off, the default theme applies for everyone.</span>
                            </span>
                        </label>

                        <div>
                            <label htmlFor="accent" className="block text-sm font-medium text-slate-300 mb-2">Brand Accent</label>
                            <div className="flex items-center gap-2">
                                <input type="color" id="accent" value={validAccent || DEFAULT_ACCENT} onChange={(e) => setAccent(e.target.value)} className="bg-transparent border-none w-10 h-10 cursor-pointer p-0 rounded" />
                                <input type="text" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#0ea5e9" className="flex-1 bg-slate-700/50 border border-slate-600 rounded-md p-2.5 text-white font-mono text-sm" />
                            </div>
                            {accent && !validAccent && (
                                <p className="text-xs text-amber-400 mt-1.5"><i className="fa-solid fa-triangle-exclamation mr-1" />Enter a hex colour like #0ea5e9.</p>
                            )}
                        </div>

                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-sm space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-300">Accent text &amp; icons on background</span>
                                {contrastBadge(linkContrast, AA_BODY)}
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-300">Button label (white on accent)</span>
                                {contrastBadge(buttonContrast, AA_LARGE)}
                            </div>
                            <p className="text-[11px] text-slate-500">Measured on the generated shades that actually render. Body text and surfaces keep the default palette, so readability holds across hues; some hues sit just below the 4.5 ideal on buttons but stay legible.</p>
                            {egregious && (
                                <p className="text-xs text-red-400 font-medium"><i className="fa-solid fa-triangle-exclamation mr-1.5" />This accent is hard to read — saving is disabled. Pick a different colour or reset to default.</p>
                            )}
                            <button type="button" onClick={() => setAccent(DEFAULT_ACCENT)} className="text-xs font-bold text-sky-400 hover:text-sky-300">
                                <i className="fa-solid fa-rotate-left mr-1.5" />Reset to the default accent
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Live Preview</label>
                        <div style={previewStyle} className="rounded-xl border border-white/10 bg-slate-950 p-5 space-y-4 overflow-hidden">
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-black text-white tracking-widest uppercase">Dashboard</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold uppercase tracking-wider">Live</span>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold">Primary</button>
                                <button type="button" className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm font-bold border border-slate-700">Secondary</button>
                            </div>
                            <p className="text-sm text-slate-300">Interactive elements use your accent — like this <span className="text-sky-400 underline">accent link</span> and the focus ring below.</p>
                            <input placeholder="Focused input" readOnly className="w-full bg-slate-900 border border-sky-500/50 rounded-lg p-2.5 text-white text-sm ring-2 ring-sky-500/50 outline-none" />
                            <div className="flex items-center gap-3 text-sky-400 text-lg">
                                <i className="fa-solid fa-circle-nodes" /><i className="fa-solid fa-shield-halved" /><i className="fa-solid fa-satellite-dish" />
                                <span className="text-xs text-slate-500 ml-auto">Icons &amp; highlights</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || isSaved || (enabled && (!validAccent || egregious))}
                        className={`px-6 py-2 text-sm font-semibold text-white rounded-md border border-slate-600 transition-colors w-32 text-center ${isSaving ? 'bg-slate-800 cursor-wait' : isSaved ? 'bg-green-600 border-green-500' : 'bg-slate-700 hover:bg-slate-600'} disabled:opacity-50`}
                    >
                        {isSaving ? <i className="fa-solid fa-spinner animate-spin" /> : isSaved ? 'Saved!' : 'Save Theme'}
                    </button>
                </div>
            </SectionPanel>
        </div>
    );
};

export default ThemeEditorTab;
