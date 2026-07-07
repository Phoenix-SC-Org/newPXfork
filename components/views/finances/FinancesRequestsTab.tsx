import React, { useMemo, useState } from 'react';
import { useData } from '../../../contexts/DataContext';
import type { LedgerEntry } from '../../../types';
import LedgerRow from './LedgerRow';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

interface Props {
    entries: LedgerEntry[];
    onRefresh: () => void;
}

export default function FinancesRequestsTab({ entries, onRefresh }: Props) {
    const { rpcAction } = useData();
    const { addToast, confirm } = useNotification();
    const { t, locale } = useI18n();
    const [working, setWorking] = useState<string | null>(null);

    const pending = useMemo(
        () => entries
            .filter((e) => e.status === 'pending')
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        [entries],
    );

    const approve = async (entry: LedgerEntry) => {
        const typeLabel = t(entry.entryType, { context: 'finance' });
        const amountLabel = Math.abs(entry.amount).toLocaleString(locale);
        const ok = await confirm({
            title: t('Confirm {type}?', { type: typeLabel }),
            message: entry.memo
                ? t('Approve {amount} aUEC {type} with memo "{memo}"? Only confirm after verifying against the in-game alt account.', { amount: amountLabel, type: typeLabel, memo: entry.memo })
                : t('Approve {amount} aUEC {type}? Only confirm after verifying against the in-game alt account.', { amount: amountLabel, type: typeLabel }),
            confirmText: t('Confirm'),
        });
        if (!ok) return;
        setWorking(entry.id);
        try {
            const res = await rpcAction('finance:approve_entry', { entryId: entry.id });
            if (!res?.applied) {
                addToast(t('Already processed'), <i className="fa-solid fa-circle-info" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40', {
                    description: t('Someone else already acted on this entry.'),
                });
            } else {
                addToast(t('Entry confirmed'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50');
            }
            onRefresh();
        } catch (err: any) {
            addToast(t('Approval failed'), <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', {
                description: err?.message || t('Try again.'),
            });
        } finally {
            setWorking(null);
        }
    };

    const reject = async (entry: LedgerEntry) => {
        const reason = window.prompt(t('Reject {type} of {amount} aUEC. Reason (shown to the submitter):', {
            type: t(entry.entryType, { context: 'finance' }),
            amount: Math.abs(entry.amount).toLocaleString(locale),
        }));
        if (reason === null) return;
        setWorking(entry.id);
        try {
            await rpcAction('finance:reject_entry', { entryId: entry.id, reason });
            addToast(t('Entry rejected'), <i className="fa-solid fa-check" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40');
            onRefresh();
        } catch (err: any) {
            addToast(t('Rejection failed'), <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', {
                description: err?.message || t('Try again.'),
            });
        } finally {
            setWorking(null);
        }
    };

    if (pending.length === 0) {
        return (
            <div className="rounded-xl border border-white/5 bg-slate-900/30 p-10 text-center">
                <i className="fa-solid fa-inbox text-3xl text-slate-600 mb-3" />
                <div className="text-sm text-slate-400 font-bold">{t('No pending requests')}</div>
                <div className="text-[11px] text-slate-500 font-mono uppercase tracking-widest mt-1">{t('The queue is empty')}</div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span>{t('{count} pending', { count: pending.length })}</span>
                <span className="flex-1 h-px bg-white/5" />
                <span>{t('Oldest first · confirm after matching memo in-game')}</span>
            </div>
            {pending.map((e) => (
                <div key={e.id} className={working === e.id ? 'opacity-60 pointer-events-none' : ''}>
                    <LedgerRow
                        entry={e}
                        onApprove={() => approve(e)}
                        onReject={() => reject(e)}
                    />
                </div>
            ))}
        </div>
    );
}
