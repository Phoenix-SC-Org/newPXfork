import React, { useState, useCallback } from 'react';
import { HydratedOperation, OperationCostCategory } from '../../types';
import { useOperations } from '../../contexts/OperationsContext';
import WindowFrame from '../layout/WindowFrame';
import { useNotification } from '../../contexts/NotificationContext';
import { useI18n } from '../../i18n/I18nContext';

interface AddCostModalProps {
    isOpen: boolean;
    onClose: () => void;
    operation: HydratedOperation;
}

const CATEGORIES: { value: OperationCostCategory; label: string; icon: string }[] = [
    { value: 'fuel', label: 'Fuel', icon: 'fa-gas-pump' },
    { value: 'repairs', label: 'Repairs', icon: 'fa-wrench' },
    { value: 'supplies', label: 'Supplies', icon: 'fa-boxes-stacked' },
    { value: 'consumables', label: 'Consumables', icon: 'fa-bottle-water' },
    { value: 'crew', label: 'Crew', icon: 'fa-users' },
    { value: 'other', label: 'Other', icon: 'fa-ellipsis' },
];

const AddCostModal: React.FC<AddCostModalProps> = ({ isOpen, onClose, operation }) => {
    const { addOperationCost } = useOperations();
    const { addToast } = useNotification();
    const { t } = useI18n();
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState<OperationCostCategory>('fuel');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        const numAmount = parseInt(amount, 10);
        if (isNaN(numAmount) || numAmount <= 0) {
            addToast(t("Validation Error"), <i className="fa-solid fa-triangle-exclamation"></i>, "bg-amber-500/10 text-amber-400 border-amber-500/50", { description: t("Please enter a positive cost amount.") });
            return;
        }

        setIsLoading(true);
        try {
            await addOperationCost(operation.id, numAmount, category, description.trim() || undefined);
            setAmount('');
            setDescription('');
            setCategory('fuel');
            onClose();
        } catch (err: any) {
            console.error("Failed to record cost:", err);
            addToast(t("Error"), <i className="fa-solid fa-xmark"></i>, "bg-red-500/10 text-red-400 border-red-500/50", { description: err?.message || t("Failed to record cost.") });
            setIsLoading(false);
        }
    }, [amount, category, description, operation, addOperationCost, addToast, onClose, t]);

    const inputClass = "w-full bg-slate-900/60 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-red-500/40 focus:ring-1 focus:ring-red-500/50 outline-hidden transition-all";
    const labelClass = "block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5";

    return (
        <WindowFrame
            isOpen={isOpen}
            onClose={onClose}
            title={t('Record Cost')}
            subtitle={t('Ledger Entry')}
            icon="fa-solid fa-money-bill-trend-up"
            color="red"
            width="max-w-md"
        >
            <form onSubmit={handleSubmit} className="flex flex-col h-full">
                <div className="p-6 space-y-5">
                    <div>
                        <label className={labelClass}>{t('aUEC Cost')}</label>
                        <div className="relative">
                            <i className="fa-solid fa-minus absolute left-3 top-1/2 -translate-y-1/2 text-red-400 text-xs"></i>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder={t('e.g., 50000')}
                                className={`${inputClass} pl-8 font-mono`}
                                required
                                autoFocus
                                disabled={isLoading}
                                min={1}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>{t('Category')}</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {CATEGORIES.map(cat => {
                                const selected = category === cat.value;
                                return (
                                    <button
                                        key={cat.value}
                                        type="button"
                                        onClick={() => setCategory(cat.value)}
                                        disabled={isLoading}
                                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                            selected
                                                ? 'bg-red-500/15 border-red-500/40 text-red-200'
                                                : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:border-slate-600'
                                        }`}
                                    >
                                        <i className={`fa-solid ${cat.icon} text-sm`}></i>
                                        {t(cat.label)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>{t('Description')} <span className="text-slate-600 font-normal normal-case ml-2">{t('(Optional)')}</span></label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('e.g., Quantum fuel resupply at Port Olisar')}
                            maxLength={200}
                            className={inputClass}
                            disabled={isLoading}
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-white/5 bg-slate-900/50 flex justify-end gap-3 rounded-b-xl">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold uppercase text-slate-400 hover:text-white transition-colors" disabled={isLoading}>{t('Cancel')}</button>
                    <button
                        type="submit"
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white border border-red-500/40 shadow-lg shadow-red-900/30 rounded-lg text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                        disabled={isLoading}
                    >
                        {isLoading ? <i className="fa-solid fa-spinner animate-spin"></i> : t('Record Cost')}
                    </button>
                </div>
            </form>
        </WindowFrame>
    );
};

export default AddCostModal;
