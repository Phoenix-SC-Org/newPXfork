import React, { useState } from 'react';
import { useData } from '../../../contexts/DataContext';
import type { TreasuryAccount } from '../../../types';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

interface Props {
    accounts: TreasuryAccount[];
    onCreate: () => void;
    onRefresh: () => void;
}

const TYPE_LABEL: Record<TreasuryAccount['type'], string> = {
    general: 'General',
    reserve: 'Reserve',
    project: 'Project',
    ops: 'Operations',
};

export default function FinancesAccountsTab({ accounts, onCreate, onRefresh }: Props) {
    const { rpcAction } = useData();
    const { addToast, confirm } = useNotification();
    const { t } = useI18n();
    const [working, setWorking] = useState<number | null>(null);

    const archive = async (account: TreasuryAccount) => {
        const ok = await confirm({
            title: t('Archive {name}?', { name: account.name }),
            message: t('The account will be hidden from new deposits/withdrawals. Its balance ({balance} aUEC) and history are preserved.', { balance: account.balanceCached.toLocaleString() }),
            confirmText: t('Archive'),
            variant: 'warning',
        });
        if (!ok) return;
        setWorking(account.id);
        try {
            await rpcAction('finance:archive_account', { accountId: account.id });
            addToast(t('Account archived'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50');
            onRefresh();
        } catch (err: any) {
            addToast(t('Archive failed'), <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', {
                description: err?.message,
            });
        } finally {
            setWorking(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-widest">{t('Treasury accounts')}</h2>
                    <p className="text-[11px] text-slate-500 font-mono uppercase tracking-widest mt-0.5">
                        {t('Carve out reserves, project funds, or op budgets')}
                    </p>
                </div>
                <button
                    onClick={onCreate}
                    className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-widest text-[11px] transition-all"
                >
                    <i className="fa-solid fa-plus" /> {t('New Account')}
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {accounts.map((a) => (
                    <div
                        key={a.id}
                        className={`rounded-xl border ${a.isActive ? 'border-white/10' : 'border-white/5 opacity-60'} bg-slate-900/50 p-4 flex flex-col`}
                    >
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                                    {t(TYPE_LABEL[a.type])}{!a.isActive && ` · ${t('Archived')}`}
                                </div>
                                <div className="text-sm font-bold text-white truncate">{a.name}</div>
                            </div>
                            <i className="fa-solid fa-vault text-amber-300/70" />
                        </div>
                        <div className="text-2xl font-black font-mono text-white mb-2">
                            {a.balanceCached.toLocaleString()} <span className="text-xs text-slate-500 font-normal">aUEC</span>
                        </div>
                        {a.description && <div className="text-[11px] text-slate-500 mb-3 line-clamp-3">{a.description}</div>}
                        <div className="flex-1" />
                        {a.isActive && (
                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/5">
                                <button
                                    onClick={() => archive(a)}
                                    disabled={working === a.id}
                                    className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-rose-300 transition"
                                >
                                    {t('Archive')}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
