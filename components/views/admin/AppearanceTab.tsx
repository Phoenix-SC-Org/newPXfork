import React, { useState, useMemo, Suspense } from 'react';
import { useAuth } from '../../../contexts/AuthContext';

// Unified "Appearance" view: composes the branding/presentation sub-tabs
// (Organization Identity, Client Dashboard, Site Metadata) behind an internal tab
// bar. Public Landing Page is deliberately NOT here — it stays a separate top-level
// Admin Console nav item. Each sub-tab keeps its own state and save logic; this
// wrapper only routes between them and gates per sub-permission.
const OrganizationIdentityTab = React.lazy(() => import('./OrganizationIdentityTab'));
const ThemeEditorTab = React.lazy(() => import('./ThemeEditorTab'));
const ClientSettingsTab = React.lazy(() => import('./ClientSettingsTab'));
const SiteMetadataTab = React.lazy(() => import('./SiteMetadataTab'));

const SUB_TABS = [
    { id: 'identity', label: 'Organization Identity', icon: 'fa-solid fa-palette', permission: 'admin:config:branding' },
    { id: 'theme', label: 'Custom Theme', icon: 'fa-solid fa-brush', permission: 'admin:config:theme' },
    { id: 'settings', label: 'Client Dashboard', icon: 'fa-solid fa-desktop', permission: 'admin:config:settings' },
    { id: 'metadata', label: 'Site Metadata', icon: 'fa-solid fa-globe', permission: 'admin:config:metadata' },
] as const;

type SubTabId = typeof SUB_TABS[number]['id'];

const Fallback = () => (
    <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
            <i className="fa-solid fa-circle-notch animate-spin text-slate-300 text-2xl"></i>
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest">Loading Module</p>
        </div>
    </div>
);

const AppearanceTab: React.FC = () => {
    const { hasPermission } = useAuth();

    const visibleTabs = useMemo(() => SUB_TABS.filter(t => hasPermission(t.permission)), [hasPermission]);
    const [active, setActive] = useState<SubTabId>(() => (visibleTabs[0]?.id ?? 'identity'));

    // If a permission change hid the active sub-tab, fall back to the first visible one.
    const activeId: SubTabId = visibleTabs.some(t => t.id === active) ? active : (visibleTabs[0]?.id ?? 'identity');

    const renderSub = () => {
        switch (activeId) {
            case 'identity': return hasPermission('admin:config:branding') ? <OrganizationIdentityTab /> : null;
            case 'theme': return hasPermission('admin:config:theme') ? <ThemeEditorTab /> : null;
            case 'settings': return hasPermission('admin:config:settings') ? <ClientSettingsTab /> : null;
            case 'metadata': return hasPermission('admin:config:metadata') ? <SiteMetadataTab /> : null;
            default: return null;
        }
    };

    return (
        <div className="flex flex-col min-h-full">
            <div className="sticky top-0 z-10 flex items-center gap-1 px-4 md:px-8 pt-4 border-b border-slate-800/60 bg-slate-950/60 backdrop-blur-xs overflow-x-auto scrollbar-none">
                {visibleTabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActive(tab.id)}
                        className={`shrink-0 flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-widest border-b-2 transition-colors ${activeId === tab.id
                            ? 'border-sky-500 text-sky-300'
                            : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                        <i className={`${tab.icon} text-[10px]`}></i>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>
            <Suspense fallback={<Fallback />}>
                {renderSub()}
            </Suspense>
        </div>
    );
};

export default AppearanceTab;
