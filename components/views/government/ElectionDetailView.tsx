
import React, { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useData } from '../../../contexts/DataContext';
import { useGovernment } from '../../../contexts/GovernmentContext';
import WindowFrame from '../../layout/WindowFrame';
import { GovernmentElection, ElectionStatus } from '../../../types';
import VotingBooth from './VotingBooth';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

interface ElectionDetailViewProps {
    election: GovernmentElection;
    onBack: () => void;
}

const statusColors: Record<string, { bg: string; text: string }> = {
    Draft: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
    Candidacy: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
    Voting: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    Concluded: { bg: 'bg-sky-500/10', text: 'text-sky-400' },
    Cancelled: { bg: 'bg-red-500/10', text: 'text-red-400' },
    Runoff: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
};

const ElectionDetailView: React.FC<ElectionDetailViewProps> = ({ election, onBack }) => {
    const { currentUser, hasPermission } = useAuth();
    const { rpcAction } = useData();
    const { refreshGovernment } = useGovernment();
    const { addToast, confirm } = useNotification();
    const { t } = useI18n();

    const [showVotingBooth, setShowVotingBooth] = useState(false);
    const [showCandidacyForm, setShowCandidacyForm] = useState(false);
    const [candidacyStatement, setCandidacyStatement] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const canManageElections = hasPermission('gov:electoral_officer');
    const canParticipate = hasPermission('gov:participate');
    const isVotingPhase = election.status === ElectionStatus.Voting;
    const isCandidacyPhase = election.status === ElectionStatus.Candidacy;
    const isConcluded = election.status === ElectionStatus.Concluded;
    const candidates = election.candidates || [];
    const myCandidate = candidates.find(c => c.userId === currentUser?.id);
    const hasVoted = election.hasVoted;
    const colors = statusColors[election.status] || statusColors.Draft;

    const handleAdvance = async () => {
        const nextPhase = election.status === 'Draft' ? 'Candidacy' : election.status === 'Candidacy' ? 'Voting' : 'Concluded';
        const confirmed = await confirm({
            title: t('Advance to {phase}', { phase: t(nextPhase) }),
            message: t('Move this election to the {phase} phase?', { phase: t(nextPhase) }),
            confirmText: t('Advance'),
            variant: 'info'
        });
        if (!confirmed) return;
        setIsLoading(true);
        try {
            await rpcAction('gov:advance_election', { electionId: election.id });
            addToast(t('Election Advanced'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Election moved to {phase} phase.', { phase: t(nextPhase) }) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Advance Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to advance election.') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = async () => {
        const confirmed = await confirm({
            title: t('Cancel Election'),
            message: t('This will permanently cancel the election. Continue?'),
            confirmText: t('Cancel Election'),
            variant: 'danger'
        });
        if (!confirmed) return;
        setIsLoading(true);
        try {
            await rpcAction('gov:cancel_election', { electionId: election.id, reason: 'Cancelled by electoral officer' });
            addToast(t('Election Cancelled'), <i className="fa-solid fa-ban" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40');
            await refreshGovernment();
            onBack();
        } catch (err: any) {
            addToast(t('Cancel Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to cancel.') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeclareCandidacy = async () => {
        setIsLoading(true);
        try {
            await rpcAction('gov:declare_candidacy', {
                electionId: election.id,
                statement: candidacyStatement || null
            });
            setShowCandidacyForm(false);
            setCandidacyStatement('');
            addToast(t('Candidacy Declared'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('You are now a candidate.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Declaration Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to declare candidacy.') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleWithdraw = async () => {
        const confirmed = await confirm({
            title: t('Withdraw Candidacy'),
            message: t('Are you sure you want to withdraw?'),
            confirmText: t('Withdraw'),
            variant: 'warning'
        });
        if (!confirmed) return;
        setIsLoading(true);
        try {
            await rpcAction('gov:withdraw_candidacy', { electionId: election.id });
            addToast(t('Candidacy Withdrawn'), <i className="fa-solid fa-check" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40', { description: t('Your candidacy has been withdrawn.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Withdrawal Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to withdraw.') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCertify = async () => {
        setIsLoading(true);
        try {
            await rpcAction('gov:certify_results', { electionId: election.id });
            addToast(t('Results Certified'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Election results are now official.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Certify Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to certify.') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleVoteSubmitted = async () => {
        setShowVotingBooth(false);
        addToast(t('Vote Cast'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Your vote has been recorded securely.') });
        await refreshGovernment();
    };

    return (
        <div className="space-y-6">
            {/* Back button */}
            <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
                <i className="fa-solid fa-arrow-left"></i> {t('Back to Elections')}
            </button>

            {/* Election Header */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-5">
                <div className="flex items-start justify-between mb-3">
                    <div>
                        <h2 className="text-lg font-bold text-white">{election.title}</h2>
                        {election.position && (
                            <p className="text-sm text-slate-400 mt-0.5">
                                <i className={`${election.position.icon || 'fa-solid fa-user'} mr-1`}></i>
                                {election.position.name}
                                {election.isByElection && <span className="text-amber-400 ml-2">{t('(By-election)')}</span>}
                            </p>
                        )}
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-sm ${colors.bg} ${colors.text}`}>
                        {t(election.status)}
                    </span>
                </div>

                {election.description && (
                    <p className="text-sm text-slate-300 mb-3">{election.description}</p>
                )}

                {/* Meta info */}
                <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                    <span><i className="fa-solid fa-check-to-slot mr-1"></i>{t(election.electionType)}</span>
                    <span><i className="fa-solid fa-trophy mr-1"></i>{election.maxWinners === 1 ? t('{count} seat', { count: election.maxWinners }) : t('{count} seats', { count: election.maxWinners })}</span>
                    {election.minVoterTurnoutPct && <span>{t('Min turnout: {pct}%', { pct: election.minVoterTurnoutPct })}</span>}
                    {election.minVoteThresholdPct && <span>{t('Win threshold: {pct}%', { pct: election.minVoteThresholdPct })}</span>}
                    {election.allowRunoff && <span className="text-purple-400">{t('Runoff enabled')}</span>}
                    {election.totalVotesCast !== undefined && <span>{t('{count} total votes', { count: election.totalVotesCast })}</span>}
                </div>

                {election.conclusionReason && (
                    <p className="text-xs text-slate-500 mt-2 italic border-t border-slate-700/50 pt-2">{election.conclusionReason}</p>
                )}

                {election.certifiedAt && (
                    <p className="text-xs text-emerald-400 mt-1"><i className="fa-solid fa-certificate mr-1"></i>{t('Certified')}</p>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 mt-4">
                    {canManageElections && ['Draft', 'Candidacy', 'Voting'].includes(election.status) && (
                        <button onClick={handleAdvance} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md hover:bg-emerald-500/20 transition-colors disabled:opacity-40">
                            <i className="fa-solid fa-forward"></i>
                            {election.status === 'Draft' ? t('Open Candidacy') : election.status === 'Candidacy' ? t('Start Voting') : t('Conclude')}
                        </button>
                    )}
                    {canManageElections && ['Draft', 'Candidacy', 'Voting'].includes(election.status) && (
                        <button onClick={handleCancel} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-40">
                            <i className="fa-solid fa-xmark"></i> {t('Cancel')}
                        </button>
                    )}
                    {canManageElections && isConcluded && !election.certifiedAt && (
                        <button onClick={handleCertify} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-md hover:bg-sky-500/20 transition-colors disabled:opacity-40">
                            <i className="fa-solid fa-certificate"></i> {t('Certify Results')}
                        </button>
                    )}
                </div>
            </div>

            {/* Candidates */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-white">{t('Candidates ({count})', { count: candidates.length })}</h3>
                    {isCandidacyPhase && canParticipate && !myCandidate && (
                        <button onClick={() => setShowCandidacyForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md hover:bg-amber-500/20 transition-colors">
                            <i className="fa-solid fa-hand"></i> {t('Declare Candidacy')}
                        </button>
                    )}
                    {isCandidacyPhase && myCandidate && (
                        <button onClick={handleWithdraw} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-40">
                            <i className="fa-solid fa-ban"></i> {t('Withdraw')}
                        </button>
                    )}
                </div>

                {candidates.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {candidates
                            .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
                            .map(candidate => (
                            <div key={candidate.id} className={`bg-slate-800/40 border rounded-lg p-4 ${candidate.isWinner ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/50'}`}>
                                <div className="flex items-center gap-3 mb-2">
                                    {candidate.user?.avatarUrl ? (
                                        <img src={candidate.user.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                                            <i className="fa-solid fa-user text-slate-500"></i>
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white">{candidate.user?.name || t('Unknown')}</span>
                                            {candidate.isWinner && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-400 font-bold">
                                                    <i className="fa-solid fa-crown mr-1"></i>{t('ELECTED')}
                                                </span>
                                            )}
                                        </div>
                                        {candidate.user?.rsiHandle && (
                                            <span className="text-[10px] text-slate-500">{candidate.user.rsiHandle}</span>
                                        )}
                                    </div>
                                    {isConcluded && candidate.voteCount !== undefined && (
                                        <div className="text-right">
                                            <div className="text-sm font-bold text-white">{candidate.voteCount}</div>
                                            <div className="text-[10px] text-slate-400">{candidate.votePercentage?.toFixed(1)}%</div>
                                        </div>
                                    )}
                                </div>
                                {candidate.platformStatement && (
                                    <p className="text-xs text-slate-300 bg-slate-800/60 rounded-sm p-2 mt-2 italic">
                                        "{candidate.platformStatement}"
                                    </p>
                                )}
                                {isConcluded && candidate.votePercentage !== undefined && (
                                    <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${candidate.isWinner ? 'bg-amber-500' : 'bg-slate-500'}`}
                                            style={{ width: `${Math.min(candidate.votePercentage, 100)}%` }}
                                        ></div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-slate-500 text-center py-6">{t('No candidates have declared yet.')}</p>
                )}
            </div>

            {/* Vote Button */}
            {isVotingPhase && canParticipate && !hasVoted && (
                <div className="flex justify-center">
                    <button
                        onClick={() => setShowVotingBooth(true)}
                        className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                    >
                        <i className="fa-solid fa-box-ballot"></i>
                        {t('Cast Your Vote')}
                    </button>
                </div>
            )}

            {isVotingPhase && hasVoted && (
                <div className="text-center py-4">
                    <span className="text-sm text-emerald-400"><i className="fa-solid fa-check-circle mr-1"></i>{t('You have already voted in this election.')}</span>
                </div>
            )}

            <WindowFrame
                isOpen={showVotingBooth}
                onClose={() => setShowVotingBooth(false)}
                title={t('Voting Booth')}
                subtitle={election.title}
                icon="fa-solid fa-box-ballot"
                color="emerald"
                width="max-w-xl"
            >
                <VotingBooth
                    election={election}
                    onSubmit={handleVoteSubmitted}
                    onCancel={() => setShowVotingBooth(false)}
                />
            </WindowFrame>

            <WindowFrame
                isOpen={showCandidacyForm}
                onClose={() => setShowCandidacyForm(false)}
                title={t('Declare Candidacy')}
                subtitle={election.title}
                icon="fa-solid fa-user-tie"
                color="amber"
                width="max-w-md"
            >
                <div className="flex flex-col h-full">
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t('Platform Statement (optional)')}</label>
                            <textarea
                                value={candidacyStatement}
                                onChange={e => setCandidacyStatement(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:ring-1 focus:ring-amber-500 focus:border-amber-500 outline-hidden transition-all resize-none"
                                rows={5}
                                placeholder={t('Tell voters why they should vote for you...')}
                                disabled={isLoading}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end items-center p-4 bg-slate-900/50 border-t border-white/5 shrink-0 gap-3">
                        <button type="button" onClick={() => setShowCandidacyForm(false)} disabled={isLoading} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50">{t('Cancel')}</button>
                        <button
                            type="button"
                            onClick={handleDeclareCandidacy}
                            disabled={isLoading}
                            className="px-6 py-2 text-xs font-bold uppercase tracking-wider text-white bg-amber-600 rounded-lg hover:bg-amber-500 transition-all shadow-lg shadow-amber-900/20 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none border border-amber-500/50"
                        >
                            {isLoading ? <i className="fa-solid fa-spinner animate-spin" /> : t('Declare Candidacy')}
                        </button>
                    </div>
                </div>
            </WindowFrame>
        </div>
    );
};

export default ElectionDetailView;
