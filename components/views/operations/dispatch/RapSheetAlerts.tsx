import React from 'react';
import type { HydratedWarrant, IntelThreatLevel, User } from '../../../../types';
import { useI18n } from '../../../../i18n/I18nContext';

interface Props {
    activeWarrants: HydratedWarrant[];
    highestThreat: IntelThreatLevel | null;
    subject: User | undefined;
}

/**
 * Prominent alert bar above the RAP sheet body. Surfaces the three flags a
 * dispatcher absolutely needs to clock before approving/dispatching anything:
 *   - Active warrant against the subject
 *   - Elevated intel threat level (Critical or High)
 *   - Low reputation on a registered subject (≤ 15)
 */
export default function RapSheetAlerts({ activeWarrants, highestThreat, subject }: Props) {
    const { t, locale } = useI18n();
    const showWarrant = activeWarrants.length > 0;
    const showThreat = highestThreat === 'Critical' || highestThreat === 'High';
    const showLowTrust = !!subject && (subject.reputation ?? 100) <= 15;

    if (!showWarrant && !showThreat && !showLowTrust) return null;

    return (
        <div className="space-y-2">
            {showWarrant && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-center gap-3 animate-pulse-slow">
                    <div className="w-8 h-8 rounded-sm bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-triangle-exclamation text-red-300"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
                            {activeWarrants.length > 1 ? t('Active Cautions') : t('Active Caution')}
                        </div>
                        <div className="text-sm text-white truncate">
                            {t('{count} outstanding', { count: activeWarrants.length })}
                            {activeWarrants[0]?.action ? ` · ${t(activeWarrants[0].action, { context: 'warrantAction' })}` : ''}
                            {activeWarrants[0]?.uecReward ? ` · ${t('{amount} aUEC reward', { amount: activeWarrants[0].uecReward.toLocaleString(locale) })}` : ''}
                        </div>
                    </div>
                </div>
            )}

            {showThreat && (
                <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${
                    highestThreat === 'Critical'
                        ? 'border-red-500/40 bg-red-500/10'
                        : 'border-amber-500/40 bg-amber-500/10'
                }`}>
                    <div className={`w-8 h-8 rounded border flex items-center justify-center shrink-0 ${
                        highestThreat === 'Critical'
                            ? 'bg-red-500/20 border-red-500/40'
                            : 'bg-amber-500/20 border-amber-500/40'
                    }`}>
                        <i className={`fa-solid fa-radiation ${highestThreat === 'Critical' ? 'text-red-300' : 'text-amber-300'}`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className={`text-[10px] font-black uppercase tracking-[0.25em] ${highestThreat === 'Critical' ? 'text-red-300' : 'text-amber-300'}`}>
                            {t('Elevated Threat')}
                        </div>
                        <div className="text-sm text-white">
                            {t('Intel reports rate this subject at')} <strong>{highestThreat && t(highestThreat)}</strong>. {t('Approach with caution.')}
                        </div>
                    </div>
                </div>
            )}

            {showLowTrust && (
                <div className="rounded-lg border border-slate-500/30 bg-slate-500/10 px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-sm bg-slate-500/20 border border-slate-500/40 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-scale-unbalanced text-slate-300"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-300">{t('Low Trust')}</div>
                        <div className="text-sm text-white">
                            {t('Reputation {rep}/100 — consider verifying intent before committing units.', { rep: subject?.reputation ?? 0 })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
