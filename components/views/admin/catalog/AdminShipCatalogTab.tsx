import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useData } from '../../../../contexts/DataContext';
import { useNotification } from '../../../../contexts/NotificationContext';
import { PlatformShip, ToastVariant } from '../../../../types';
import { useI18n } from '../../../../i18n/I18nContext';

interface ShipWithUsage extends PlatformShip {
    usageCount: number;
}

const PAGE_SIZE = 50;

const sizeOptions = ['Vehicle', 'Snub', 'Small', 'Medium', 'Large', 'Capital'];

// Dashboard toast shim — maps the old portal addPortalToast(msg, type) signature
// onto the dashboard's addToast(message, icon, className, options) surface.
type ToastFn = (message: string, type?: 'error' | 'success' | 'warning' | 'info') => void;

type SortField = 'name' | 'manufacturer' | 'usageCount' | 'msrp';

const SortIcon: React.FC<{ field: SortField; sortField: SortField; sortDir: 'asc' | 'desc' }> = ({ field, sortField, sortDir }) => {
    if (sortField !== field) return <i className="fa-solid fa-sort text-slate-700 ml-1"></i>;
    return <i className={`fa-solid fa-sort-${sortDir === 'asc' ? 'up' : 'down'} text-purple-400 ml-1`}></i>;
};

export default function AdminShipCatalogTab() {
    const { rpcAction } = useData();
    const { addToast, confirm } = useNotification();
    const { t, locale } = useI18n();
    const toast = useCallback<ToastFn>((message, type = 'info') => {
        addToast(message, null, '', { variant: type as ToastVariant });
    }, [addToast]);

    const [ships, setShips] = useState<ShipWithUsage[]>([]);
    const loadShips = useCallback(async () => {
        try {
            const rows = await rpcAction('catalog:list_ships', {});
            setShips(Array.isArray(rows) ? rows : []);
        } catch (e: any) {
            toast(t('Failed to load ships: {msg}', { msg: e?.message || t('unknown') }), 'error');
        }
    }, [rpcAction, toast, t]);
    // Mount / dependency-change data fetch. The fetch is genuinely asynchronous: setShips
    // only runs after the awaited RPC resolves. Inlining the async work directly in the
    // effect (rather than calling loadShips) keeps the setState provably post-await, so the
    // set-state-in-effect rule is satisfied without changing behavior. A cancelled flag
    // drops a late resolution after unmount/re-run, which is strictly correct for a fetch.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const rows = await rpcAction('catalog:list_ships', {});
                if (!cancelled) setShips(Array.isArray(rows) ? rows : []);
            } catch (e: any) {
                if (!cancelled) toast(t('Failed to load ships: {msg}', { msg: e?.message || t('unknown') }), 'error');
            }
        })();
        return () => { cancelled = true; };
    }, [rpcAction, toast, t]);

    // Filter state
    const [search, setSearch] = useState('');
    const [filterManufacturer, setFilterManufacturer] = useState('');
    const [filterSize, setFilterSize] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [page, setPage] = useState(0);

    // Sort state
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Edit modal state
    const [editingShip, setEditingShip] = useState<ShipWithUsage | null>(null);
    const [editForm, setEditForm] = useState<Record<string, any>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Merge state
    const [mergeSource, setMergeSource] = useState<ShipWithUsage | null>(null);
    const [mergeSearch, setMergeSearch] = useState('');

    // Sync state
    const [syncLoading, setSyncLoading] = useState(false);

    // Repair state
    const [repairLoading, setRepairLoading] = useState(false);

    // --- Derived Data ---

    const manufacturers = useMemo(() => {
        const set = new Set(ships.map(s => s.manufacturer));
        return Array.from(set).sort();
    }, [ships]);

    const sizes = useMemo(() => {
        const set = new Set(ships.map(s => s.size).filter(Boolean) as string[]);
        return Array.from(set).sort();
    }, [ships]);

    const productionStatuses = useMemo(() => {
        const set = new Set(ships.map(s => s.productionStatus).filter(Boolean) as string[]);
        return Array.from(set).sort();
    }, [ships]);

    const filtered = useMemo(() => {
        const result = ships.filter(s => {
            if (search) {
                const q = search.toLowerCase();
                if (!s.name.toLowerCase().includes(q) && !s.manufacturer.toLowerCase().includes(q)) return false;
            }
            if (filterManufacturer && s.manufacturer !== filterManufacturer) return false;
            if (filterSize && s.size !== filterSize) return false;
            if (filterStatus && s.productionStatus !== filterStatus) return false;
            return true;
        });

        result.sort((a, b) => {
            let cmp = 0;
            if (sortField === 'name') cmp = a.name.localeCompare(b.name);
            else if (sortField === 'manufacturer') cmp = a.manufacturer.localeCompare(b.manufacturer);
            else if (sortField === 'usageCount') cmp = a.usageCount - b.usageCount;
            else if (sortField === 'msrp') cmp = (a.msrp || 0) - (b.msrp || 0);
            return sortDir === 'asc' ? cmp : -cmp;
        });

        return result;
    }, [ships, search, filterManufacturer, filterSize, filterStatus, sortField, sortDir]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageShips = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const stats = useMemo(() => ({
        total: ships.length,
        manufacturers: new Set(ships.map(s => s.manufacturer)).size,
        withImages: ships.filter(s => s.imageUrl).length,
        totalUsage: ships.reduce((sum, s) => sum + s.usageCount, 0),
        noUuid: ships.filter(s => !s.externalUuid).length,
    }), [ships]);

    // --- Handlers ---

    const handleSort = useCallback((field: typeof sortField) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    }, [sortField]);

    const openEdit = useCallback((ship: ShipWithUsage) => {
        setEditingShip(ship);
        const { usageCount, ...rest } = ship;
        setEditForm({ ...rest });
    }, []);

    const handleEditChange = useCallback((field: string, value: any) => {
        setEditForm(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleSave = async () => {
        if (!editingShip) return;
        setIsSaving(true);
        try {
            const { id, usageCount, externalUuid, ...editable } = editingShip;
            const updates: Record<string, any> = {};
            for (const key of Object.keys(editable)) {
                if (editForm[key] !== (editingShip as any)[key]) {
                    updates[key] = editForm[key];
                }
            }
            if (Object.keys(updates).length === 0) {
                setEditingShip(null);
                return;
            }
            await rpcAction('catalog:update_ship', { shipId: editingShip.id, updates });
            setEditingShip(null);
            loadShips();
            toast(t('Ship updated successfully'), 'success');
        } catch (e: any) {
            toast(e.message || t('Failed to update ship'), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (ship: ShipWithUsage) => {
        const msg = ship.usageCount > 0
            ? t('"{name}" is referenced by {count} user ship(s). You must merge it first to reassign those references.', { name: ship.name, count: ship.usageCount })
            : t('Are you sure you want to delete "{name}"? This cannot be undone.', { name: ship.name });
        const ok = await confirm({ title: t('Delete Ship'), message: msg, confirmText: t('Delete'), variant: 'danger' });
        if (!ok) return;
        try {
            await rpcAction('catalog:delete_ship', { shipId: ship.id });
            loadShips();
            toast(t('Deleted "{name}"', { name: ship.name }), 'success');
        } catch (e: any) {
            toast(e.message || t('Failed to delete ship'), 'error');
        }
    };

    const mergeTargets = useMemo(() => {
        if (!mergeSource) return [];
        const q = mergeSearch.toLowerCase();
        return ships
            .filter(s => s.id !== mergeSource.id && (
                !q || s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q)
            ))
            .slice(0, 20);
    }, [mergeSource, mergeSearch, ships]);

    const handleMerge = async (target: ShipWithUsage) => {
        if (!mergeSource) return;
        const ok = await confirm({
            title: t('Merge Ships'),
            message: t('Reassign {count} user ship(s) from "{source}" to "{target}", then delete "{source}"?', { count: mergeSource.usageCount, source: mergeSource.name, target: target.name }),
            confirmText: t('Merge & Delete'),
            variant: 'danger'
        });
        if (!ok) return;
        try {
            await rpcAction('catalog:merge_ships', { keepId: target.id, deleteId: mergeSource.id });
            setMergeSource(null);
            setMergeSearch('');
            loadShips();
            toast(t('Ships merged successfully'), 'success');
        } catch (e: any) {
            toast(e.message || t('Failed to merge ships'), 'error');
        }
    };

    const handleSync = async () => {
        setSyncLoading(true);
        try {
            const res = await rpcAction('catalog:sync_ships', {});
            toast(t('Sync complete: {synced} ships synced, {claimed} legacy rows claimed, {errors} errors, {images} images', { synced: res.synced, claimed: res.claimed || 0, errors: res.errors || 0, images: res.images }), 'success');
            loadShips();
        } catch (e: any) {
            toast(t('Sync failed: {msg}', { msg: e.message || t('Unknown error') }), 'error');
        } finally {
            setSyncLoading(false);
        }
    };

    const handleRepair = async () => {
        const ok = await confirm({
            title: t('Repair Ship Catalog'),
            message: t('This will find and merge duplicate ships created by paint/livery variants in the API. User ship references will be safely reassigned. This may take a moment.'),
            confirmText: t('Run Repair'),
            variant: 'danger'
        });
        if (!ok) return;
        setRepairLoading(true);
        try {
            const res = await rpcAction('catalog:repair_ships', {});
            const msg = res.shipsMerged > 0
                ? t('Repair complete: {merged} duplicates merged, {backfilled} backfilled, {errors} errors', { merged: res.shipsMerged, backfilled: res.backfilled, errors: res.errors || 0 })
                : t('No duplicates found. {backfilled} entries backfilled.', { backfilled: res.backfilled });
            toast(msg, res.errors > 0 ? 'warning' : 'success');
            loadShips();
        } catch (e: any) {
            toast(t('Repair failed: {msg}', { msg: e.message || t('Unknown error') }), 'error');
        } finally {
            setRepairLoading(false);
        }
    };

    const clearFilters = () => {
        setSearch('');
        setFilterManufacturer('');
        setFilterSize('');
        setFilterStatus('');
        setPage(0);
    };

    const selectClass = 'bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-hidden focus:border-purple-500 transition-all';
    const inputClass = 'w-full bg-black/30 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-hidden focus:border-purple-500 transition-all placeholder:text-slate-600';
    const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

    return (
        <div className="animate-fade-in-up p-4 md:p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-black text-white flex items-center gap-3">
                        <i className="fa-solid fa-rocket text-purple-400"></i>
                        {t('Ship Catalog')}
                        <span className="text-sm font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-sm">{ships.length}</span>
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">{t('Manage the platform-wide ship database synced from the Star Citizen Wiki.')}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleRepair}
                        disabled={repairLoading || syncLoading}
                        className="flex items-center gap-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                        {repairLoading ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-wrench"></i>}
                        {repairLoading ? t('Repairing...') : t('Repair Duplicates')}
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={syncLoading || repairLoading}
                        className="flex items-center gap-2 bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                        {syncLoading ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-arrows-rotate"></i>}
                        {syncLoading ? t('Syncing...') : t('Sync from Wiki')}
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                {[
                    { label: 'Total Ships', value: stats.total, icon: 'fa-database', color: 'text-purple-400' },
                    { label: 'Manufacturers', value: stats.manufacturers, icon: 'fa-industry', color: 'text-sky-400' },
                    { label: 'With Images', value: stats.withImages, icon: 'fa-image', color: 'text-green-400' },
                    { label: 'User References', value: stats.totalUsage, icon: 'fa-users', color: 'text-amber-400' },
                    { label: 'No External UUID', value: stats.noUuid, icon: 'fa-triangle-exclamation', color: 'text-red-400' },
                ].map(s => (
                    <div key={s.label} className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                        <i className={`fa-solid ${s.icon} ${s.color} text-lg mb-1`}></i>
                        <p className="text-xl font-black text-white">{s.value}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t(s.label)}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-slate-900 border border-white/10 rounded-xl p-4 mb-6">
                <div className="flex flex-col lg:flex-row gap-3 items-end">
                    <div className="flex-1 w-full relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"></i>
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                            placeholder={t('Search by name or manufacturer...')}
                            className="w-full bg-black/30 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-hidden focus:border-purple-500 transition-all placeholder:text-slate-600"
                        />
                    </div>
                    <select value={filterManufacturer} onChange={(e) => { setFilterManufacturer(e.target.value); setPage(0); }} className={selectClass}>
                        <option value="">{t('All Manufacturers')}</option>
                        {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select value={filterSize} onChange={(e) => { setFilterSize(e.target.value); setPage(0); }} className={selectClass}>
                        <option value="">{t('All Sizes')}</option>
                        {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }} className={selectClass}>
                        <option value="">{t('All Statuses')}</option>
                        {productionStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(search || filterManufacturer || filterSize || filterStatus) && (
                        <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-white underline whitespace-nowrap">
                            {t('Clear')}
                        </button>
                    )}
                </div>
                <p className="text-[10px] text-slate-600 mt-2">{t('{count} ships shown', { count: filtered.length })}</p>
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden mb-6">
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-black/30 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5">
                            <tr>
                                <th className="p-3 w-14"></th>
                                <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('name')}>
                                    {t('Name')} <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                                </th>
                                <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('manufacturer')}>
                                    {t('Manufacturer')} <SortIcon field="manufacturer" sortField={sortField} sortDir={sortDir} />
                                </th>
                                <th className="p-3">{t('Size')}</th>
                                <th className="p-3">{t('Role')}</th>
                                <th className="p-3">{t('Status')}</th>
                                <th className="p-3 cursor-pointer hover:text-white text-right" onClick={() => handleSort('msrp')}>
                                    MSRP <SortIcon field="msrp" sortField={sortField} sortDir={sortDir} />
                                </th>
                                <th className="p-3 cursor-pointer hover:text-white text-center" onClick={() => handleSort('usageCount')}>
                                    {t('Usage')} <SortIcon field="usageCount" sortField={sortField} sortDir={sortDir} />
                                </th>
                                <th className="p-3 text-right">{t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {pageShips.map(ship => (
                                <tr key={ship.id} className="hover:bg-white/5 transition-colors">
                                    <td className="p-3">
                                        {ship.imageUrl ? (
                                            <img src={ship.imageUrl} alt="" className="w-12 h-8 object-cover rounded-sm border border-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        ) : (
                                            <div className="w-12 h-8 bg-slate-800 rounded-sm border border-white/10 flex items-center justify-center">
                                                <i className="fa-solid fa-rocket text-slate-700 text-xs"></i>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3 font-bold text-white">{ship.name}</td>
                                    <td className="p-3 text-slate-400">{ship.manufacturer}</td>
                                    <td className="p-3">
                                        {ship.size && (
                                            <span className={`text-[10px] font-bold uppercase ${
                                                ship.size === 'Capital' ? 'text-red-400' :
                                                ship.size === 'Large' ? 'text-amber-400' :
                                                ship.size === 'Medium' ? 'text-sky-400' :
                                                'text-green-400'
                                            }`}>{t(ship.size, { context: 'shipSize' })}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-slate-500 text-xs">{ship.role || '-'}</td>
                                    <td className="p-3">
                                        {ship.productionStatus && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                                ship.productionStatus === 'Flight Ready' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                                ship.productionStatus === 'In Production' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                                'bg-slate-500/10 text-slate-400 border-slate-500/20'
                                            }`}>{ship.productionStatus}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-right text-slate-400 font-mono text-xs">
                                        {ship.msrp ? `$${ship.msrp.toLocaleString(locale)}` : '-'}
                                    </td>
                                    <td className="p-3 text-center">
                                        {ship.usageCount > 0 ? (
                                            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full">{ship.usageCount}</span>
                                        ) : (
                                            <span className="text-slate-700 text-xs">0</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-right">
                                        <div className="flex justify-end gap-1">
                                            <button onClick={() => openEdit(ship)} className="p-1.5 text-purple-400 hover:bg-purple-500/10 rounded-sm transition-colors" title={t('Edit')}>
                                                <i className="fa-solid fa-pen-to-square"></i>
                                            </button>
                                            {ship.usageCount > 0 && (
                                                <button onClick={() => { setMergeSource(ship); setMergeSearch(''); }} className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-sm transition-colors" title={t('Merge into another ship')}>
                                                    <i className="fa-solid fa-code-merge"></i>
                                                </button>
                                            )}
                                            <button onClick={() => handleDelete(ship)} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-sm transition-colors" title={t('Delete')}>
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden divide-y divide-white/5">
                    {pageShips.map(ship => (
                        <div key={ship.id} className="p-4 space-y-3">
                            <div className="flex gap-3 items-start">
                                {ship.imageUrl ? (
                                    <img src={ship.imageUrl} alt="" className="w-16 h-10 object-cover rounded-sm border border-white/10 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                    <div className="w-16 h-10 bg-slate-800 rounded-sm border border-white/10 flex items-center justify-center shrink-0">
                                        <i className="fa-solid fa-rocket text-slate-700"></i>
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-white font-bold truncate">{ship.name}</p>
                                    <p className="text-xs text-slate-500">{ship.manufacturer}</p>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {ship.size && <span className="text-[10px] font-bold text-sky-400">{t(ship.size, { context: 'shipSize' })}</span>}
                                        {ship.role && <span className="text-[10px] text-slate-600">{ship.role}</span>}
                                        {ship.usageCount > 0 && (
                                            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t('{count} users', { count: ship.usageCount })}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => openEdit(ship)} className="text-xs text-purple-400 font-bold uppercase">{t('Edit')}</button>
                                {ship.usageCount > 0 && (
                                    <button onClick={() => { setMergeSource(ship); setMergeSearch(''); }} className="text-xs text-amber-400 font-bold uppercase">{t('Merge')}</button>
                                )}
                                <button onClick={() => handleDelete(ship)} className="text-xs text-red-400 font-bold uppercase">{t('Delete')}</button>
                            </div>
                        </div>
                    ))}
                </div>

                {filtered.length === 0 && (
                    <div className="p-12 text-center text-slate-600">
                        <i className="fa-solid fa-rocket text-3xl mb-3 opacity-30"></i>
                        <p className="text-sm font-bold">{t('No ships found')}</p>
                        <p className="text-xs mt-1">{ships.length === 0 ? t('The ship catalog is empty. Try syncing from the Wiki.') : t('Try adjusting your search or filters.')}</p>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-between items-center text-sm text-slate-400 mb-8">
                    <p className="text-xs">
                        {t('Showing {from}-{to} of {total}', { from: page * PAGE_SIZE + 1, to: Math.min((page + 1) * PAGE_SIZE, filtered.length), total: filtered.length })}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => p - 1)}
                            disabled={page === 0}
                            className="px-3 py-1.5 bg-slate-800 border border-white/10 rounded-sm text-xs font-bold disabled:opacity-30 hover:bg-slate-700 transition-colors"
                        >
                            <i className="fa-solid fa-chevron-left mr-1"></i> {t('Prev')}
                        </button>
                        <span className="px-3 py-1.5 text-xs font-bold text-slate-500">
                            {page + 1} / {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => p + 1)}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-1.5 bg-slate-800 border border-white/10 rounded-sm text-xs font-bold disabled:opacity-30 hover:bg-slate-700 transition-colors"
                        >
                            {t('Next')} <i className="fa-solid fa-chevron-right ml-1"></i>
                        </button>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingShip && (
                <div className="fixed inset-0 z-150 bg-black/90 backdrop-blur-sm flex items-start justify-center animate-fade-in overflow-y-auto p-4">
                    <div className="bg-slate-900 border border-purple-500/30 shadow-2xl shadow-purple-900/20 rounded-2xl max-w-3xl w-full my-8 relative">
                        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-purple-500 to-pink-500 rounded-t-2xl"></div>

                        <div className="p-6 border-b border-white/10 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-white">{t('Edit Ship')}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">ID: {editingShip.id} {editingShip.externalUuid && `| UUID: ${editingShip.externalUuid}`}</p>
                            </div>
                            <button onClick={() => setEditingShip(null)} className="text-slate-400 hover:text-white transition-colors">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">

                            {/* Image Preview */}
                            {editForm.imageUrl && (
                                <div className="flex justify-center">
                                    <img src={editForm.imageUrl} alt={t('Preview')} className="max-h-40 rounded-lg border border-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                </div>
                            )}

                            {/* Basic Info */}
                            <div>
                                <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <i className="fa-solid fa-tag"></i> {t('Basic Info')}
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelClass}>{t('Name')}</label>
                                        <input value={editForm.name || ''} onChange={(e) => handleEditChange('name', e.target.value)} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Manufacturer')}</label>
                                        <input value={editForm.manufacturer || ''} onChange={(e) => handleEditChange('manufacturer', e.target.value)} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Manufacturer Code')}</label>
                                        <input value={editForm.manufacturerCode || ''} onChange={(e) => handleEditChange('manufacturerCode', e.target.value)} className={inputClass} placeholder={t('e.g. RSI')} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Role')}</label>
                                        <input value={editForm.role || ''} onChange={(e) => handleEditChange('role', e.target.value)} className={inputClass} placeholder={t('e.g. Combat, Exploration')} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Career')}</label>
                                        <input value={editForm.career || ''} onChange={(e) => handleEditChange('career', e.target.value)} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Size')}</label>
                                        <select value={editForm.size || ''} onChange={(e) => handleEditChange('size', e.target.value)} className={inputClass}>
                                            <option value="">-</option>
                                            {sizeOptions.map(s => <option key={s} value={s}>{t(s, { context: 'shipSize' })}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Production Status')}</label>
                                        <input value={editForm.productionStatus || ''} onChange={(e) => handleEditChange('productionStatus', e.target.value)} className={inputClass} placeholder={t('e.g. Flight Ready')} />
                                    </div>
                                </div>
                            </div>

                            {/* Specs */}
                            <div>
                                <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <i className="fa-solid fa-gauge-high"></i> {t('Specifications')}
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { key: 'crewMin', label: 'Crew Min' },
                                        { key: 'crewMax', label: 'Crew Max' },
                                        { key: 'cargoCapacity', label: 'Cargo (SCU)' },
                                        { key: 'msrp', label: 'MSRP ($)' },
                                        { key: 'length', label: 'Length (m)' },
                                        { key: 'beam', label: 'Beam (m)' },
                                        { key: 'height', label: 'Height (m)' },
                                        { key: 'mass', label: 'Mass (kg)' },
                                        { key: 'scmSpeed', label: 'SCM Speed' },
                                        { key: 'maxSpeed', label: 'Max Speed' },
                                        { key: 'health', label: 'Health' },
                                        { key: 'shieldHp', label: 'Shield HP' },
                                    ].map(f => (
                                        <div key={f.key}>
                                            <label className={labelClass}>{t(f.label)}</label>
                                            <input
                                                type="number"
                                                value={editForm[f.key] ?? ''}
                                                onChange={(e) => handleEditChange(f.key, e.target.value ? parseFloat(e.target.value) : null)}
                                                className={inputClass}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Media & Links */}
                            <div>
                                <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <i className="fa-solid fa-link"></i> {t('Media & Links')}
                                </h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className={labelClass}>{t('Image URL')}</label>
                                        <input value={editForm.imageUrl || ''} onChange={(e) => handleEditChange('imageUrl', e.target.value)} className={inputClass} placeholder="https://..." />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className={labelClass}>{t('Wiki URL')}</label>
                                            <input value={editForm.wikiUrl || ''} onChange={(e) => handleEditChange('wikiUrl', e.target.value)} className={inputClass} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>{t('Pledge URL')}</label>
                                            <input value={editForm.pledgeUrl || ''} onChange={(e) => handleEditChange('pledgeUrl', e.target.value)} className={inputClass} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('Description')}</label>
                                        <textarea
                                            value={editForm.description || ''}
                                            onChange={(e) => handleEditChange('description', e.target.value)}
                                            className={`${inputClass} h-24 resize-none`}
                                            placeholder={t('Ship description...')}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-white/10 flex justify-end gap-3">
                            <button onClick={() => setEditingShip(null)} className="px-4 py-2 text-xs font-bold uppercase text-slate-400 hover:text-white transition-colors">
                                {t('Cancel')}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-6 py-2 bg-purple-500/10 text-purple-400 border border-purple-500/50 hover:bg-purple-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                            >
                                {isSaving ? <i className="fa-solid fa-spinner animate-spin"></i> : t('Save Changes')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Merge Modal */}
            {mergeSource && (
                <div className="fixed inset-0 z-150 bg-black/90 backdrop-blur-sm flex items-center justify-center animate-fade-in p-4">
                    <div className="bg-slate-900 border border-amber-500/30 shadow-2xl shadow-amber-900/20 rounded-2xl max-w-lg w-full relative">
                        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-amber-500 to-orange-500 rounded-t-2xl"></div>

                        <div className="p-6 border-b border-white/10">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <i className="fa-solid fa-code-merge text-amber-400"></i> {t('Merge Ship')}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {t('Reassign all')} <strong className="text-amber-400">{mergeSource.usageCount}</strong> {t('user reference(s) from')} "<strong className="text-white">{mergeSource.name}</strong>" {t('to another ship, then delete it.')}
                            </p>
                        </div>

                        <div className="p-6">
                            <label className={labelClass}>{t('Select target ship to keep')}</label>
                            <input
                                type="text"
                                value={mergeSearch}
                                onChange={(e) => setMergeSearch(e.target.value)}
                                placeholder={t('Search for target ship...')}
                                className={`${inputClass} mb-3`}
                                autoFocus
                            />
                            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1">
                                {mergeTargets.map(target => (
                                    <button
                                        key={target.id}
                                        onClick={() => handleMerge(target)}
                                        className="w-full text-left p-3 rounded-lg border border-transparent hover:border-amber-500/30 hover:bg-amber-500/5 transition-all flex items-center gap-3"
                                    >
                                        {target.imageUrl ? (
                                            <img src={target.imageUrl} alt="" className="w-10 h-7 object-cover rounded-sm border border-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        ) : (
                                            <div className="w-10 h-7 bg-slate-800 rounded-sm border border-white/10 flex items-center justify-center">
                                                <i className="fa-solid fa-rocket text-slate-700 text-[10px]"></i>
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-white font-bold truncate">{target.name}</p>
                                            <p className="text-[10px] text-slate-500">{target.manufacturer} {target.size && `| ${target.size}`}</p>
                                        </div>
                                        {target.usageCount > 0 && (
                                            <span className="text-[10px] text-slate-500">{t('{count} refs', { count: target.usageCount })}</span>
                                        )}
                                    </button>
                                ))}
                                {mergeTargets.length === 0 && (
                                    <p className="text-sm text-slate-600 italic text-center py-4">
                                        {mergeSearch ? t('No ships match your search') : t('Type to search for a target ship')}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-white/10 flex justify-end">
                            <button onClick={() => { setMergeSource(null); setMergeSearch(''); }} className="px-4 py-2 text-xs font-bold uppercase text-slate-400 hover:text-white transition-colors">
                                {t('Cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
