import React, { useState } from 'react';
import WindowFrame from '../../layout/WindowFrame';
import { useData } from '../../../contexts/DataContext';
import type { TreasuryAccount } from '../../../types';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

interface Props {
    accounts: TreasuryAccount[];
    onClose: () => void;
    onSubmitted: () => void;
}

export default function SubmitWithdrawalModal({ accounts, onClose, onSubmitted }: Props) {
    const { rpcAction } = useData();
    const { addToast } = useNotification();
    const { t, locale } = useI18n();
    const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0);
    const [amount, setAmount] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    const selected = accounts.find((a) => a.id === accountId);
    const magnitude = Math.trunc(Number(amount));
    const overdrawn = !!selected && magnitude > selected.balanceCached;
    const valid = accountId > 0 && magnitude > 0 && reason.trim().length > 0;

    const submit = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            await rpcAction('finance:submit_withdrawal', {
                accountId,
                amount: magnitude,
                reason: reason.trim(),
            });
            addToast(
                t('Withdrawal requested'),
                <i className="fa-solid fa-check" />,
                'bg-emerald-500/10 text-emerald-400 border-emerald-500/50',
                { description: t('An officer will review and execute the transfer.') },
            );
            onSubmitted();
        } catch (err: any) {
            addToast(t('Submission failed'), <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', {
                description: err?.message,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <WindowFrame
            isOpen
            onClose={onClose}
            title={t('Request Withdrawal')}
            subtitle={t('Treasury ledger')}
            icon="fa-solid fa-arrow-up-from-bracket"
            color="red"
            width="max-w-md"
        >
            <div className="p-5 space-y-4">
                <p className="text-xs text-slate-400 bg-slate-900/60 p-3 rounded-sm border border-slate-800 leading-relaxed">
                    {t('Requests are held as')} <span className="text-rose-300 font-bold">{t('pending', { context: 'finance' })}</span> {t('until an officer with')} <span className="font-mono">finance:approve</span> {t('executes the transfer in-game and confirms.')}
                </p>

                <label className="block">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Account')}</span>
                    <select
                        value={accountId}
                        onChange={(e) => setAccountId(Number(e.target.value))}
                        className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    >
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name} · {a.balanceCached.toLocaleString(locale)} aUEC
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Amount (aUEC)')}</span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={t('e.g. 20000')}
                        className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                    {overdrawn && (
                        <span className="text-[10px] text-rose-400 mt-1 block font-bold uppercase tracking-widest">
                            {t('Exceeds current balance · the officer may still partially fulfil')}
                        </span>
                    )}
                </label>

                <label className="block">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Reason')}</span>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                        maxLength={500}
                        placeholder={t("What's the payout for? (op reward, member payout, purchase, etc.)")}
                        className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                </label>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={submit}
                        disabled={!valid || submitting}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Submitting…') : t('Request Withdrawal')}
                    </button>
                </div>
            </div>
        </WindowFrame>
    );
}
