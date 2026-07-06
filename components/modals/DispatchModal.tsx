
import React, { useCallback, useState } from 'react';
import { HydratedServiceRequest } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useRequests } from '../../contexts/RequestsContext';
import WindowFrame from '../layout/WindowFrame';
import MemberPicker from '../shared/MemberPicker';
import { useNotification } from '../../contexts/NotificationContext';
import { useI18n } from '../../i18n/I18nContext';

interface DispatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    request: HydratedServiceRequest;
}

const DispatchModal: React.FC<DispatchModalProps> = ({ isOpen, onClose, request }) => {
    const { hasPermission } = useAuth();
    const { dispatchMembers } = useRequests();
    const { addToast } = useNotification();
    const { t } = useI18n();
    // Staged-batch flow: edits live locally and only commit on Confirm.
    // Pre-seeded with whoever's already assigned so the dispatcher can adjust.
    const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(request.assignedMembers.map(m => m.id)));
    const [isLoading, setIsLoading] = useState(false);

    const handleToggle = useCallback(async (memberId: number, currentlyAssigned: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (currentlyAssigned) next.delete(memberId);
            else next.add(memberId);
            return next;
        });
    }, []);

    const handleSubmit = async () => {
        setIsLoading(true);
        try {
            await dispatchMembers(request.id, Array.from(selectedIds));
            onClose();
        } catch (err) {
            console.error(err);
            addToast(
                t('Dispatch Failed'),
                <i className="fa-solid fa-xmark"></i>,
                'bg-red-500/10 text-red-400 border-red-500/50',
                { description: t('An error occurred while dispatching members. Please try again.') },
            );
            setIsLoading(false);
        }
    };

    return (
        <WindowFrame
            isOpen={isOpen}
            onClose={onClose}
            title={t('Mission Dispatch')}
            subtitle={t('Assign Active Units')}
            icon="fa-solid fa-tower-broadcast"
            color="amber"
            width="max-w-xl"
        >
            {/* Single flex column inside the WindowFrame body so the footer
                stays pinned and only the picker scrolls when content overflows. */}
            <div className="flex flex-col h-full">
                <div className="shrink-0 px-4 py-3 border-b border-slate-800/60 bg-slate-900/30">
                    <p className="text-xs text-slate-400">
                        {t('Select active personnel to assign to')} <strong className="text-white">{request.serviceType}</strong>.
                        {' '}{t("Click rows to toggle; Confirm replaces the request's full responder set.")}
                    </p>
                </div>

                <div className="flex-1 min-h-0">
                    <MemberPicker
                        assignedIds={selectedIds}
                        onToggle={handleToggle}
                        matchKeyword={request.serviceType}
                        allowDutyToggle={hasPermission('admin:user:update')}
                    />
                </div>

                {/* Pinned footer — always visible */}
                <div className="shrink-0 p-3 border-t border-white/5 bg-slate-900/50 flex justify-between items-center rounded-b-xl">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        {selectedIds.size === 1 ? t('{count} unit selected', { count: selectedIds.size }) : t('{count} units selected', { count: selectedIds.size })}
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-bold uppercase text-slate-400 hover:text-white transition-colors"
                            disabled={isLoading}
                        >
                            {t('Cancel')}
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="px-6 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/50 hover:bg-amber-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading}
                        >
                            {isLoading ? <i className="fa-solid fa-spinner animate-spin"></i> : t('Confirm Dispatch')}
                        </button>
                    </div>
                </div>
            </div>
        </WindowFrame>
    );
};

export default DispatchModal;
