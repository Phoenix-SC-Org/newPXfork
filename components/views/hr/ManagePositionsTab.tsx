
import React, { useState } from 'react';
import { useData } from '../../../contexts/DataContext';
import { useHR } from '../../../contexts/HRContext';
import { useTableControls } from '../../../hooks/useTableControls';
import EmptyState from '../../shared/ui/EmptyState';
import { useNotification } from '../../../contexts/NotificationContext';
import { useModalRegistry } from '../../../contexts/ModalRegistryContext';
import { useI18n } from '../../../i18n/I18nContext';

const ManagePositionsTab: React.FC = () => {
    const { rpcAction, refreshHR } = useData();
    const { hrPositions } = useHR();
    const { addToast, confirm } = useNotification();
    const { t } = useI18n();
    const { openCreatePositionModal } = useModalRegistry();
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const { sortedAndFilteredItems } = useTableControls(
        hrPositions,
        { key: 'name', direction: 'ascending' },
        ['name', 'description'],
        searchTerm
    );

    const handleDelete = async (id: number) => {
        const confirmed = await confirm({ title: t('Delete Position'), message: t('Are you sure you want to delete this position?'), confirmText: t('Delete'), variant: 'danger' });
        if (!confirmed) return;
        setDeletingId(id);
        try {
            await rpcAction('hr:delete_position', { id });
            await refreshHR();
        } catch (e) {
            console.error(e);
            addToast(t('Delete Failed'), <i className="fa-solid fa-xmark"></i>, "bg-red-500/10 text-red-400 border-red-500/50", { description: t('Failed to delete the position.') });
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
                        <i className="fa-solid fa-briefcase text-emerald-300"></i>
                        {t('Manage Job Roles')}
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">{t('Define standardized job titles and functional roles.')}</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none text-xs" />
                        <input
                            type="search"
                            placeholder={t('Search roles...')}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-slate-500 font-mono text-sm focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/40 outline-hidden transition-all"
                        />
                    </div>
                    <button
                        onClick={() => openCreatePositionModal()}
                        className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/40 rounded-lg shadow-lg shadow-emerald-900/30 transition whitespace-nowrap"
                    >
                        <i className="fa-solid fa-plus"></i>{t('New Role')}
                    </button>
                </div>
            </div>

            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-700/50 overflow-hidden">
                {sortedAndFilteredItems.length > 0 ? (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/5 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                                <th className="px-5 py-3 w-16 text-center">{t('Icon')}</th>
                                <th className="px-5 py-3">{t('Role Title')}</th>
                                <th className="px-5 py-3 hidden md:table-cell">{t('Description')}</th>
                                <th className="px-5 py-3 w-32 text-right">{t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {sortedAndFilteredItems.map(pos => (
                                <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors group">
                                    <td className="px-5 py-3 text-center">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-300 mx-auto">
                                            <i className={`${pos.icon || 'fa-solid fa-user-tag'}`}></i>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-white font-bold">
                                        {pos.name}
                                        <div className="md:hidden text-xs text-slate-400 mt-1 truncate max-w-[150px]">{pos.description || '-'}</div>
                                    </td>
                                    <td className="px-5 py-3 text-sm text-slate-400 truncate max-w-xs hidden md:table-cell">{pos.description || '-'}</td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => openCreatePositionModal(pos)} className="p-2 text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-colors" title={t('Edit')}><i className="fa-solid fa-pencil"></i></button>
                                            <button
                                                onClick={() => handleDelete(pos.id)}
                                                disabled={deletingId === pos.id}
                                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                                                title={t('Delete')}
                                            >
                                                {deletingId === pos.id ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-trash-can"></i>}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState
                        icon="fa-briefcase"
                        accent="emerald"
                        heading={t('No job roles defined')}
                        description={searchTerm ? t('Try a different search term.') : t('Create standardized roles to assign to members.')}
                    />
                )}
            </div>
        </div>
    );
};

export default ManagePositionsTab;
