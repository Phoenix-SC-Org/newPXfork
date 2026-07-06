
import React from 'react';
import { useOperations } from '../../../contexts/OperationsContext';
import { useAuth, useFormatDate } from '../../../contexts/AuthContext';
import { OperationStatus } from '../../../types';
import EmptyState from '../../shared/ui/EmptyState';
import { useNavigation } from '../../../contexts/NavigationContext';
import { useI18n } from '../../../i18n/I18nContext';

const getStatusChipClass = (status: OperationStatus) => {
    switch (status) {
        case OperationStatus.Active: return 'bg-green-500/10 text-green-400 border-green-500/30';
        case OperationStatus.Scheduled: return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
        case OperationStatus.Planning: return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
        case OperationStatus.Concluded: return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
        default: return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
};

const MyOperationsTab: React.FC = () => {
    const { operations } = useOperations();
    const { currentUser } = useAuth();
    const fmt = useFormatDate();
    const { t } = useI18n();
    const { viewOperationDetails } = useNavigation();

    const myOps = operations.filter(op =>
        op.participants.some(p => p.userId === currentUser?.id)
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
                        <i className="fa-solid fa-person-military-rifle text-emerald-300"></i>
                        {t('Operations Log')}
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">{t('Deployments and training exercises you participated in.')}</p>
                </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-700/50 overflow-hidden">
                {myOps.length > 0 ? (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/5 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                                <th className="px-5 py-3">{t('Operation')}</th>
                                <th className="px-5 py-3">{t('Role')}</th>
                                <th className="px-5 py-3">{t('Date')}</th>
                                <th className="px-5 py-3 text-right">{t('Status')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {myOps.map(op => {
                                const role = op.ownerId === currentUser?.id ? t('Operation Lead') : t('Participant');
                                return (
                                    <tr key={op.id} onClick={() => viewOperationDetails(op)} className="hover:bg-slate-800/40 transition-colors cursor-pointer group">
                                        <td className="px-5 py-3">
                                            <p className="text-white font-bold text-sm group-hover:text-emerald-200 transition-colors">{op.name}</p>
                                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t(op.type, { context: 'operation type' })}</p>
                                        </td>
                                        <td className="px-5 py-3 text-sm text-slate-300">{role}</td>
                                        <td className="px-5 py-3 text-xs text-slate-400 font-mono">{fmt(op.createdAt)}</td>
                                        <td className="px-5 py-3 text-right">
                                            <span className={`px-2.5 py-0.5 rounded-sm text-[10px] font-black uppercase tracking-wider border ${getStatusChipClass(op.status)}`}>
                                                {t(op.status, { context: 'operation status' })}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState
                        icon="fa-person-military-rifle"
                        accent="emerald"
                        heading={t('No operations history')}
                        description={t('Operations you participate in will appear here.')}
                        compact
                    />
                )}
            </div>
        </div>
    );
};

export default MyOperationsTab;
