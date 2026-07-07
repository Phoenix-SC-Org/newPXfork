
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useData } from '../../../contexts/DataContext';
import { useMembers } from '../../../contexts/MembersContext';
import { useGovernment } from '../../../contexts/GovernmentContext';
import WikiEditor from '../wiki/WikiEditor';
import { GovernmentBranchType, PositionFillMethod,
    GovernmentBranch, GovernmentPosition
} from '../../../types';
import { TabPageHeader } from '../../shared/ui';
import WindowFrame from '../../layout/WindowFrame';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

const EMPTY_EDITOR_CONTENT: Record<string, never> = {};

const GovernmentSettingsTab: React.FC = () => {
    const { t } = useI18n();
    const { currentUser } = useAuth();
    const { rpcAction } = useData();
    const { allUsers } = useMembers();
    const {
        governmentsFeatureConfig, governmentConfig, governmentBranches, governmentPositions,
        refreshGovernment,
    } = useGovernment();
    const { addToast, confirm } = useNotification();

    const [enabled, setEnabled] = useState(governmentsFeatureConfig?.enabled || false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Government identity/metadata. Initialised from the current config so the
    // form is correct on first render; kept in sync below via the previous-value
    // pattern when the config changes.
    const [govName, setGovName] = useState(governmentConfig?.name || '');
    const [govDescription, setGovDescription] = useState(governmentConfig?.description || '');
    const [govType, setGovType] = useState<string>(governmentConfig?.governmentType || 'custom');
    const [isEditingIdentity, setIsEditingIdentity] = useState(false);

    // Constitution editor
    const [isEditingConstitution, setIsEditingConstitution] = useState(false);

    // Appointment modal
    const [showAppointModal, setShowAppointModal] = useState(false);
    const [appointPositionId, setAppointPositionId] = useState<number | null>(null);
    const [appointUserId, setAppointUserId] = useState<number | null>(null);
    const [appointSearch, setAppointSearch] = useState('');

    // Branch/Position editing
    const [editingBranch, setEditingBranch] = useState<GovernmentBranch | null>(null);
    const [editingPosition, setEditingPosition] = useState<GovernmentPosition | null>(null);
    const [showBranchForm, setShowBranchForm] = useState(false);
    const [showPositionForm, setShowPositionForm] = useState(false);
    const [branchForNewPosition, setBranchForNewPosition] = useState<number | null>(null);

    // Branch form
    const [branchName, setBranchName] = useState('');
    const [branchType, setBranchType] = useState<string>('Custom');
    const [branchDescription, setBranchDescription] = useState('');
    const [branchIcon, setBranchIcon] = useState('');

    // Position form
    const [posName, setPosName] = useState('');
    const [posDescription, setPosDescription] = useState('');
    const [posFillMethod, setPosFillMethod] = useState<string>('Appointed');
    const [posTermDays, setPosTermDays] = useState('');
    const [posMaxHolders, setPosMaxHolders] = useState('1');
    const [posIcon, setPosIcon] = useState('');
    const [posCanPropose, setPosCanPropose] = useState(false);
    const [posCanVote, setPosCanVote] = useState(false);
    const [posCanVeto, setPosCanVeto] = useState(false);
    const [posCanCallElections, setPosCanCallElections] = useState(false);
    const [posCanIssueOrders, setPosCanIssueOrders] = useState(false);

    // Re-fetch government data on mount and whenever the feature toggle changes.
    // This is an external-system sync (data fetch), so it stays in an effect.
    useEffect(() => {
        refreshGovernment();
    }, [governmentsFeatureConfig?.enabled, refreshGovernment]);

    // Sync the locally-editable `enabled` flag from the feature config during
    // render (previous-value pattern) instead of in an effect, so we don't
    // trigger an extra render. Behaviour matches the old `[...enabled]` dep.
    const [prevFeatureEnabled, setPrevFeatureEnabled] = useState(governmentsFeatureConfig?.enabled);
    if (prevFeatureEnabled !== governmentsFeatureConfig?.enabled) {
        setPrevFeatureEnabled(governmentsFeatureConfig?.enabled);
        setEnabled(governmentsFeatureConfig?.enabled || false);
    }

    // Sync government config into local editable form state when it changes.
    // Done during render via the previous-value pattern to avoid an extra render.
    const [prevGovernmentConfig, setPrevGovernmentConfig] = useState(governmentConfig);
    if (prevGovernmentConfig !== governmentConfig) {
        setPrevGovernmentConfig(governmentConfig);
        if (governmentConfig) {
            setGovName(governmentConfig.name || '');
            setGovDescription(governmentConfig.description || '');
            setGovType(governmentConfig.governmentType || 'custom');
        }
    }

    const toggleFeature = async () => {
        const newEnabled = !enabled;
        if (!newEnabled && governmentBranches.length > 0) {
            const confirmed = await confirm({
                title: t('Disable Government Feature'),
                message: t('Disabling will hide the Government section from all members. Government data will be preserved.'),
                confirmText: t('Disable'),
                cancelText: t('Cancel'),
                variant: 'warning'
            });
            if (!confirmed) return;
        }
        setEnabled(newEnabled);
        setIsSaving(true);
        try {
            await rpcAction('gov:update_feature_config', { config: { enabled: newEnabled } });
            addToast(t('Settings Updated'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: newEnabled ? t('Government feature enabled.') : t('Government feature disabled.') });
        } catch (err: any) {
            setEnabled(!newEnabled);
            addToast(t('Update Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to update settings.') });
        } finally {
            setIsSaving(false);
        }
    };

    const applyTemplate = async (templateType: string) => {
        const confirmed = await confirm({
            title: t('Apply Template'),
            message: t('This will replace all current branches and positions with the template defaults. Position holders will be removed. Continue?'),
            confirmText: t('Apply Template'),
            variant: 'warning'
        });
        if (!confirmed) return;
        setIsLoading(true);
        try {
            await rpcAction('gov:apply_template', { templateType });
            addToast(t('Template Applied'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Government structure has been updated.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Template Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to apply template.') });
        } finally {
            setIsLoading(false);
        }
    };

    // Government identity save
    const saveGovernmentIdentity = async () => {
        if (!govName.trim()) return;
        setIsSaving(true);
        try {
            await rpcAction('gov:upsert_config', {
                config: {
                    governmentType: govType,
                    name: govName,
                    description: govDescription,
                }
            });
            setIsEditingIdentity(false);
            addToast(t('Identity Saved'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Government identity updated.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Save Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to update government identity.') });
        } finally {
            setIsSaving(false);
        }
    };

    // Constitution save (receives TipTap JSON from WikiEditor)
    const saveConstitution = async (json: any) => {
        try {
            await rpcAction('gov:update_constitution', { content: json });
            setIsEditingConstitution(false);
            addToast(t('Constitution Saved'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Constitution updated.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Save Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to update constitution.') });
        }
    };

    // Appoint holder
    const openAppointModal = (positionId: number) => {
        setAppointPositionId(positionId);
        setAppointUserId(null);
        setAppointSearch('');
        setShowAppointModal(true);
    };

    const appointHolder = async () => {
        if (!appointPositionId || !appointUserId) return;
        setIsLoading(true);
        try {
            await rpcAction('gov:appoint_holder', {
                positionId: appointPositionId,
                targetUserId: appointUserId,
            });
            setShowAppointModal(false);
            addToast(t('Appointment Confirmed'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('Position holder appointed successfully.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Appointment Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to appoint holder.') });
        } finally {
            setIsLoading(false);
        }
    };

    const removeHolder = async (holderId: number, holderName: string) => {
        const confirmed = await confirm({
            title: t('Remove Position Holder'),
            message: t('Remove {holderName} from this position?', { holderName }),
            confirmText: t('Remove'),
            variant: 'danger'
        });
        if (!confirmed) return;
        try {
            await rpcAction('gov:remove_holder', { holderId, reason: 'Removed by admin' });
            addToast(t('Holder Removed'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: t('{holderName} removed from position.', { holderName }) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Remove Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to remove holder.') });
        }
    };

    // Filtered users for appointment search
    const filteredAppointUsers = allUsers.filter(u => {
        if (!appointSearch.trim()) return true;
        const s = appointSearch.toLowerCase();
        return u.name.toLowerCase().includes(s) || (u.rsiHandle && u.rsiHandle.toLowerCase().includes(s));
    }).slice(0, 20);

    // Position currently being appointed to (drives the modal subtitle and the
    // per-user "already holds" check below).
    const appointPosition = governmentPositions.find(p => p.id === appointPositionId);

    // Independent positions (no branch) shown in their own section.
    const independentPositions = governmentPositions.filter(p => !p.branchId);

    // Branch CRUD
    const openBranchForm = (branch?: GovernmentBranch) => {
        if (branch) {
            setEditingBranch(branch);
            setBranchName(branch.name);
            setBranchType(branch.branchType);
            setBranchDescription(branch.description || '');
            setBranchIcon(branch.icon || '');
        } else {
            setEditingBranch(null);
            setBranchName('');
            setBranchType('Custom');
            setBranchDescription('');
            setBranchIcon('');
        }
        setShowBranchForm(true);
    };

    const saveBranch = async () => {
        if (!branchName.trim()) return;
        setIsLoading(true);
        try {
            if (editingBranch) {
                await rpcAction('gov:update_branch', {
                    branchId: editingBranch.id,
                    updates: { name: branchName, branchType, description: branchDescription, icon: branchIcon }
                });
            } else {
                await rpcAction('gov:create_branch', {
                    branchData: { name: branchName, branchType, description: branchDescription, icon: branchIcon }
                });
            }
            setShowBranchForm(false);
            addToast(t('Branch Saved'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: editingBranch ? t('Branch updated.') : t('Branch created.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Save Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to save branch.') });
        } finally {
            setIsLoading(false);
        }
    };

    const deleteBranch = async (branch: GovernmentBranch) => {
        const positionsInBranch = governmentPositions.filter(p => p.branchId === branch.id).length;
        const message = positionsInBranch > 0
            ? (positionsInBranch === 1
                ? t("Delete \"{name}\"? {count} position will become independent — you'll be able to reassign or remove them afterwards.", { name: branch.name, count: positionsInBranch })
                : t("Delete \"{name}\"? {count} positions will become independent — you'll be able to reassign or remove them afterwards.", { name: branch.name, count: positionsInBranch }))
            : t('Delete "{name}"?', { name: branch.name });
        const confirmed = await confirm({ title: t('Delete Branch'), message, confirmText: t('Delete'), variant: 'danger' });
        if (!confirmed) return;
        try {
            await rpcAction('gov:delete_branch', { branchId: branch.id });
            addToast(t('Branch Deleted'), <i className="fa-solid fa-trash" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40', { description: t('Branch "{name}" removed.', { name: branch.name }) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Delete Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to delete branch.') });
        }
    };

    // Position CRUD
    const openPositionForm = (branchId: number | null, position?: GovernmentPosition) => {
        setBranchForNewPosition(branchId);
        if (position) {
            setEditingPosition(position);
            setPosName(position.name);
            setPosDescription(position.description || '');
            setPosFillMethod(position.fillMethod);
            setPosTermDays(position.termLengthDays?.toString() || '');
            setPosMaxHolders(position.maxHolders.toString());
            setPosIcon(position.icon || '');
            setPosCanPropose(position.canProposeLegislation);
            setPosCanVote(position.canVoteLegislation);
            setPosCanVeto(position.canVetoLegislation);
            setPosCanCallElections(position.canCallElections);
            setPosCanIssueOrders((position as any).canIssueOrders || false);
        } else {
            setEditingPosition(null);
            setPosName('');
            setPosDescription('');
            setPosFillMethod('Appointed');
            setPosTermDays('');
            setPosMaxHolders('1');
            setPosIcon('');
            setPosCanPropose(false);
            setPosCanVote(false);
            setPosCanVeto(false);
            setPosCanCallElections(false);
            setPosCanIssueOrders(false);
        }
        setShowPositionForm(true);
    };

    const savePosition = async () => {
        if (!posName.trim()) return;
        setIsLoading(true);
        try {
            const data = {
                branchId: branchForNewPosition,
                name: posName,
                description: posDescription,
                fillMethod: posFillMethod,
                termLengthDays: posTermDays ? parseInt(posTermDays) : null,
                maxHolders: parseInt(posMaxHolders) || 1,
                icon: posIcon,
                canProposeLegislation: posCanPropose,
                canVoteLegislation: posCanVote,
                canVetoLegislation: posCanVeto,
                canCallElections: posCanCallElections,
                canIssueOrders: posCanIssueOrders,
                permissionsGranted: buildPermissionsGranted(),
            };
            if (editingPosition) {
                await rpcAction('gov:update_position', { positionId: editingPosition.id, updates: data });
            } else {
                await rpcAction('gov:create_position', { positionData: data });
            }
            setShowPositionForm(false);
            addToast(t('Position Saved'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50', { description: editingPosition ? t('Position updated.') : t('Position created.') });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Save Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to save position.') });
        } finally {
            setIsLoading(false);
        }
    };

    const buildPermissionsGranted = () => {
        const perms: string[] = [];
        if (posCanPropose || posCanVote || posCanVeto) perms.push('gov:elected_official');
        return perms;
    };

    const deletePosition = async (position: GovernmentPosition) => {
        const confirmed = await confirm({ title: t('Delete Position'), message: t('Delete "{name}"? Current holders will be removed.', { name: position.name }), confirmText: t('Delete'), variant: 'danger' });
        if (!confirmed) return;
        try {
            await rpcAction('gov:delete_position', { positionId: position.id });
            addToast(t('Position Deleted'), <i className="fa-solid fa-trash" />, 'bg-slate-500/10 text-slate-300 border-slate-500/40', { description: t('Position "{name}" removed.', { name: position.name }) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Delete Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to delete position.') });
        }
    };

    // Move a branch up (-1) or down (+1) in the org-scoped ordering.
    // Sorts a fresh copy by sortOrder before swapping so that uneven gaps
    // (e.g. after a delete) don't produce surprising swaps.
    const moveBranch = async (branchId: number, direction: -1 | 1) => {
        const sorted = [...governmentBranches].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const idx = sorted.findIndex(b => b.id === branchId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= sorted.length) return;
        const reordered = [...sorted];
        [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
        try {
            await rpcAction('gov:reorder_branches', { orderedIds: reordered.map(b => b.id) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Reorder Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to reorder branches.') });
        }
    };

    const movePosition = async (positionId: number, branchId: number, direction: -1 | 1) => {
        const inBranch = governmentPositions
            .filter(p => p.branchId === branchId)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const idx = inBranch.findIndex(p => p.id === positionId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= inBranch.length) return;
        const reordered = [...inBranch];
        [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
        try {
            await rpcAction('gov:reorder_positions', { branchId, orderedIds: reordered.map(p => p.id) });
            await refreshGovernment();
        } catch (err: any) {
            addToast(t('Reorder Failed'), <i className="fa-solid fa-circle-exclamation" />, 'bg-red-500/10 text-red-400 border-red-500/50', { description: err.message || t('Failed to reorder positions.') });
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            <TabPageHeader
                title={t('Government')}
                icon="fa-solid fa-landmark"
                accent="indigo"
                subtitle={t('Configure branches, positions, elections, and legislation.')}
            />

            {enabled ? (
                <div className="flex items-center gap-3 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg text-xs text-indigo-200/80">
                    <i className="fa-solid fa-circle-info text-indigo-400"></i>
                    <span>{t('Government is enabled. Toggle the feature itself from')} <span className="text-indigo-300 font-semibold">{t('Admin → Optional Features')}</span>.</span>
                </div>
            ) : (
                <div className="p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-xl text-center">
                    <i className="fa-solid fa-landmark text-3xl text-indigo-400 mb-3"></i>
                    <h3 className="text-lg font-bold text-white mb-1">{t('Government Feature Disabled')}</h3>
                    <p className="text-sm text-slate-400 mb-4 max-w-md mx-auto leading-relaxed">
                        {t('Enable Government in')} <span className="text-indigo-300 font-semibold">{t('Admin → Optional Features')}</span> {t('to configure branches, positions, elections, and legislation.')}
                    </p>
                </div>
            )}

            {enabled && (
                <>
                    {/* Quick Template Application */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-2">{t('Quick Setup Templates')}</h4>
                        <p className="text-xs text-slate-400 mb-3">{t('Apply a template to quickly set up branches and positions. All templates are fully customisable after application.')}</p>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { type: 'military_junta', label: 'Military Junta', icon: 'fa-solid fa-helmet-safety' },
                                { type: 'corporate_board', label: 'Corporate Board', icon: 'fa-solid fa-building' },
                                { type: 'democratic_republic', label: 'Democratic Republic', icon: 'fa-solid fa-landmark-dome' },
                                { type: 'constitutional_monarchy', label: 'Constitutional Monarchy', icon: 'fa-solid fa-crown' },
                                { type: 'westminster', label: 'Westminster', icon: 'fa-solid fa-landmark' },
                                { type: 'technocracy', label: 'Technocracy', icon: 'fa-solid fa-microchip' },
                                { type: 'pirate_code', label: 'Pirate Code', icon: 'fa-solid fa-skull-crossbones' },
                            ].map(tpl => (
                                <button
                                    key={tpl.type}
                                    onClick={() => applyTemplate(tpl.type)}
                                    disabled={isLoading}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-md hover:bg-slate-700 transition-colors"
                                >
                                    <i className={tpl.icon}></i>
                                    {t(tpl.label)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Government Identity */}
                    {governmentConfig && (
                        <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-white">{t('Government Identity')}</h4>
                                {!isEditingIdentity ? (
                                    <button
                                        onClick={() => setIsEditingIdentity(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-md hover:bg-slate-700 transition-colors"
                                    >
                                        <i className="fa-solid fa-pen text-xs"></i>
                                        {t('Edit')}
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => { setIsEditingIdentity(false); setGovName(governmentConfig.name || ''); setGovDescription(governmentConfig.description || ''); setGovType(governmentConfig.governmentType || 'custom'); }}
                                            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                                        >
                                            {t('Cancel')}
                                        </button>
                                        <button
                                            onClick={saveGovernmentIdentity}
                                            disabled={isSaving || !govName.trim()}
                                            className="px-4 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-md disabled:opacity-40"
                                        >
                                            {isSaving ? t('Saving...') : t('Save')}
                                        </button>
                                    </div>
                                )}
                            </div>
                            {isEditingIdentity ? (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{t('Government Name')}</label>
                                        <input
                                            value={govName}
                                            onChange={e => setGovName(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                                            placeholder={t('e.g. The Republic of...')}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{t('Government Type')}</label>
                                        <select
                                            value={govType}
                                            onChange={e => setGovType(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                                        >
                                            <option value="military_junta">{t('Military Junta')}</option>
                                            <option value="corporate_board">{t('Corporate Board')}</option>
                                            <option value="democratic_republic">{t('Democratic Republic')}</option>
                                            <option value="constitutional_monarchy">{t('Constitutional Monarchy')}</option>
                                            <option value="westminster">{t('Westminster')}</option>
                                            <option value="technocracy">{t('Technocracy')}</option>
                                            <option value="pirate_code">{t('Pirate Code')}</option>
                                            <option value="custom">{t('Custom')}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{t('Description')}</label>
                                        <textarea
                                            value={govDescription}
                                            onChange={e => setGovDescription(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                                            rows={2}
                                            placeholder={t('A brief description of your government...')}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                        <i className="fa-solid fa-landmark text-amber-400"></i>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">{governmentConfig.name || t('Unnamed Government')}</p>
                                        <p className="text-xs text-slate-400">{governmentConfig.description || t(formatGovernmentType(governmentConfig.governmentType))}</p>
                                    </div>
                                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-sm bg-slate-700 text-slate-400 uppercase">{t(formatGovernmentType(governmentConfig.governmentType))}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Constitution Editor */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                                <i className="fa-solid fa-scroll text-amber-400 text-xs"></i>
                                {t('Constitution')}
                            </h4>
                            {!isEditingConstitution && (
                                <button
                                    onClick={() => setIsEditingConstitution(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-md hover:bg-slate-700 transition-colors"
                                >
                                    <i className={`fa-solid ${governmentConfig?.constitutionContent ? 'fa-pen' : 'fa-plus'} text-xs`}></i>
                                    {governmentConfig?.constitutionContent ? t('Edit') : t('Draft Constitution')}
                                </button>
                            )}
                        </div>
                        {isEditingConstitution ? (
                            <div>
                                <p className="text-xs text-slate-400 mb-2">{t("Write your organisation's constitution. This will be visible to all members under the Constitution tab.")}</p>
                                <WikiEditor
                                    content={governmentConfig?.constitutionContent || EMPTY_EDITOR_CONTENT}
                                    editable={true}
                                    onSave={saveConstitution}
                                    onCancel={() => setIsEditingConstitution(false)}
                                />
                            </div>
                        ) : governmentConfig?.constitutionContent ? (
                            <div className="max-h-48 overflow-y-auto">
                                <WikiEditor
                                    content={governmentConfig.constitutionContent}
                                    editable={false}
                                />
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 italic">{t('No constitution drafted yet. Click "Draft Constitution" to get started.')}</p>
                        )}
                    </div>

                    {/* Branches & Positions */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-white">{t('Branches & Positions')}</h4>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => openPositionForm(null)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/40 border border-slate-600 rounded-md hover:bg-slate-700/60 transition-colors"
                                    title={t('Create a position that exists outside any branch')}
                                >
                                    <i className="fa-solid fa-plus"></i>
                                    {t('Add Independent Position')}
                                </button>
                                <button
                                    onClick={() => openBranchForm()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md hover:bg-amber-500/20 transition-colors"
                                >
                                    <i className="fa-solid fa-plus"></i>
                                    {t('Add Branch')}
                                </button>
                            </div>
                        </div>

                        {/* Independent Positions */}
                        {independentPositions.length > 0 && (
                                <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden mb-3">
                                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/60">
                                        <div className="flex items-center gap-2">
                                            <i className="fa-solid fa-star text-slate-400 text-sm"></i>
                                            <span className="text-sm font-medium text-white">{t('Independent Positions')}</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-700 text-slate-400">{t('No Branch')}</span>
                                        </div>
                                    </div>
                                    <div className="divide-y divide-slate-700/30">
                                        {independentPositions.map(pos => {
                                            const filledCount = pos.currentHolders?.length || 0;
                                            const canAppoint = filledCount < pos.maxHolders;
                                            return (
                                                <div key={pos.id} className="px-4 py-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <i className={`${pos.icon || 'fa-solid fa-user'} text-slate-400 text-xs`}></i>
                                                            <span className="text-xs text-white">{pos.name}</span>
                                                            <span className="text-[10px] px-1 py-0.5 rounded-sm bg-slate-700/50 text-slate-500">{t(pos.fillMethod, { context: 'fillMethod' })}</span>
                                                            <span className={`text-[10px] px-1 py-0.5 rounded-sm ${canAppoint ? 'bg-orange-500/10 text-orange-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                                                {filledCount}/{pos.maxHolders}
                                                            </span>
                                                            {pos.termLengthDays && <span className="text-[10px] text-slate-500">{pos.termLengthDays}d</span>}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            {canAppoint && (
                                                                <button onClick={() => openAppointModal(pos.id)} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors" title={t('Appoint holder')}>
                                                                    <i className="fa-solid fa-user-plus text-[10px]"></i>
                                                                </button>
                                                            )}
                                                            <button onClick={() => openPositionForm(null, pos)} className="p-1 text-slate-500 hover:text-slate-200 transition-colors" title={t('Edit position')}>
                                                                <i className="fa-solid fa-pen text-[10px]"></i>
                                                            </button>
                                                            <button onClick={() => deletePosition(pos)} className="p-1 text-slate-500 hover:text-red-400 transition-colors" title={t('Delete position')}>
                                                                <i className="fa-solid fa-trash text-[10px]"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {pos.currentHolders && pos.currentHolders.length > 0 && (
                                                        <div className="ml-5 mt-1 space-y-0.5">
                                                            {pos.currentHolders.map(holder => (
                                                                <div key={holder.id} className="flex items-center justify-between group">
                                                                    <div className="flex items-center gap-2">
                                                                        {holder.user?.avatarUrl ? (
                                                                            <img src={holder.user.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                                                        ) : (
                                                                            <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center">
                                                                                <i className="fa-solid fa-user text-[6px] text-slate-500"></i>
                                                                            </div>
                                                                        )}
                                                                        <span className="text-[11px] text-slate-300">{holder.user?.name || t('Unknown')}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => removeHolder(holder.id, holder.user?.name || t('this holder'))}
                                                                        className="p-0.5 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                        title={t('Remove from position')}
                                                                    >
                                                                        <i className="fa-solid fa-xmark text-[10px]"></i>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                        )}

                        {governmentBranches.length === 0 ? (
                            <div className="text-center py-8 bg-slate-800/30 border border-slate-700/50 rounded-lg">
                                <i className="fa-solid fa-building-columns text-2xl text-slate-600 mb-2"></i>
                                <p className="text-sm text-slate-400">{t('No branches defined. Apply a template or create branches manually.')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {[...governmentBranches]
                                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                                    .map((branch, branchIdx, sortedBranches) => {
                                    const branchPositions = governmentPositions
                                        .filter(p => p.branchId === branch.id)
                                        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                                    return (
                                        <div key={branch.id} className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
                                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/60">
                                                <div className="flex items-center gap-2">
                                                    <i className={`${branch.icon || 'fa-solid fa-building-columns'} text-amber-400 text-sm`}></i>
                                                    <span className="text-sm font-medium text-white">{branch.name}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-700 text-slate-400">{t(branch.branchType, { context: 'branchType' })}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => moveBranch(branch.id, -1)} disabled={branchIdx === 0} className="p-1.5 text-slate-400 hover:text-sky-300 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors" title={t('Move up')}>
                                                        <i className="fa-solid fa-chevron-up text-xs"></i>
                                                    </button>
                                                    <button onClick={() => moveBranch(branch.id, 1)} disabled={branchIdx === sortedBranches.length - 1} className="p-1.5 text-slate-400 hover:text-sky-300 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors" title={t('Move down')}>
                                                        <i className="fa-solid fa-chevron-down text-xs"></i>
                                                    </button>
                                                    <button onClick={() => openPositionForm(branch.id)} className="p-1.5 text-slate-400 hover:text-emerald-400 transition-colors" title={t('Add position')}>
                                                        <i className="fa-solid fa-plus text-xs"></i>
                                                    </button>
                                                    <button onClick={() => openBranchForm(branch)} className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors" title={t('Edit branch')}>
                                                        <i className="fa-solid fa-pen text-xs"></i>
                                                    </button>
                                                    <button onClick={() => deleteBranch(branch)} className="p-1.5 text-slate-400 hover:text-red-400 transition-colors" title={t('Delete branch')}>
                                                        <i className="fa-solid fa-trash text-xs"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            {branchPositions.length > 0 ? (
                                                <div className="divide-y divide-slate-700/30">
                                                    {branchPositions.map((pos, posIdx) => {
                                                        const filledCount = pos.currentHolders?.length || 0;
                                                        const canAppoint = filledCount < pos.maxHolders;
                                                        return (
                                                            <div key={pos.id} className="px-4 py-2">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <i className={`${pos.icon || 'fa-solid fa-user'} text-slate-400 text-xs`}></i>
                                                                        <span className="text-xs text-white">{pos.name}</span>
                                                                        <span className="text-[10px] px-1 py-0.5 rounded-sm bg-slate-700/50 text-slate-500">{t(pos.fillMethod, { context: 'fillMethod' })}</span>
                                                                        <span className={`text-[10px] px-1 py-0.5 rounded-sm ${canAppoint ? 'bg-orange-500/10 text-orange-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                                                            {filledCount}/{pos.maxHolders}
                                                                        </span>
                                                                        {pos.termLengthDays && <span className="text-[10px] text-slate-500">{pos.termLengthDays}d</span>}
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        <button onClick={() => movePosition(pos.id, branch.id, -1)} disabled={posIdx === 0} className="p-1 text-slate-500 hover:text-sky-300 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors" title={t('Move up')}>
                                                                            <i className="fa-solid fa-chevron-up text-[10px]"></i>
                                                                        </button>
                                                                        <button onClick={() => movePosition(pos.id, branch.id, 1)} disabled={posIdx === branchPositions.length - 1} className="p-1 text-slate-500 hover:text-sky-300 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors" title={t('Move down')}>
                                                                            <i className="fa-solid fa-chevron-down text-[10px]"></i>
                                                                        </button>
                                                                        {canAppoint && (
                                                                            <button onClick={() => openAppointModal(pos.id)} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors" title={t('Appoint holder')}>
                                                                                <i className="fa-solid fa-user-plus text-[10px]"></i>
                                                                            </button>
                                                                        )}
                                                                        <button onClick={() => openPositionForm(branch.id, pos)} className="p-1 text-slate-500 hover:text-slate-200 transition-colors" title={t('Edit position')}>
                                                                            <i className="fa-solid fa-pen text-[10px]"></i>
                                                                        </button>
                                                                        <button onClick={() => deletePosition(pos)} className="p-1 text-slate-500 hover:text-red-400 transition-colors" title={t('Delete position')}>
                                                                            <i className="fa-solid fa-trash text-[10px]"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                {/* Current holders with remove button */}
                                                                {pos.currentHolders && pos.currentHolders.length > 0 && (
                                                                    <div className="ml-5 mt-1 space-y-0.5">
                                                                        {pos.currentHolders.map(holder => (
                                                                            <div key={holder.id} className="flex items-center justify-between group">
                                                                                <div className="flex items-center gap-2">
                                                                                    {holder.user?.avatarUrl ? (
                                                                                        <img src={holder.user.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                                                                    ) : (
                                                                                        <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center">
                                                                                            <i className="fa-solid fa-user text-[6px] text-slate-500"></i>
                                                                                        </div>
                                                                                    )}
                                                                                    <span className="text-[11px] text-slate-300">{holder.user?.name || t('Unknown')}</span>
                                                                                </div>
                                                                                <button
                                                                                    onClick={() => removeHolder(holder.id, holder.user?.name || t('this holder'))}
                                                                                    className="p-0.5 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                                    title={t('Remove from position')}
                                                                                >
                                                                                    <i className="fa-solid fa-xmark text-[10px]"></i>
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-500 text-center py-3">{t('No positions in this branch')}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}

            <WindowFrame
                isOpen={showBranchForm}
                onClose={() => setShowBranchForm(false)}
                title={editingBranch ? t('Edit Branch') : t('New Branch')}
                subtitle={t('Government Configuration')}
                icon="fa-solid fa-sitemap"
                color="indigo"
                width="max-w-md"
            >
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto p-6 space-y-3">
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Name')}</label>
                            <input value={branchName} onChange={e => setBranchName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" placeholder={t('e.g. Executive')} />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Type')}</label>
                            <select value={branchType} onChange={e => setBranchType(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white">
                                {Object.values(GovernmentBranchType).map(bt => <option key={bt} value={bt}>{t(bt, { context: 'branchType' })}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Description')}</label>
                            <textarea value={branchDescription} onChange={e => setBranchDescription(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" rows={2} />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Icon (FontAwesome class)')}</label>
                            <input value={branchIcon} onChange={e => setBranchIcon(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" placeholder="e.g. fa-solid fa-landmark" />
                        </div>
                    </div>
                    <div className="border-t border-white/10 bg-slate-950/50 px-6 py-4 flex justify-end gap-2 shrink-0">
                        <button onClick={() => setShowBranchForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
                        <button onClick={saveBranch} disabled={isLoading || !branchName.trim()} className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md disabled:opacity-40">{t('Save')}</button>
                    </div>
                </div>
            </WindowFrame>

            <WindowFrame
                isOpen={showPositionForm}
                onClose={() => setShowPositionForm(false)}
                title={editingPosition ? t('Edit Position') : t('New Position')}
                subtitle={t('Role Configuration')}
                icon="fa-solid fa-id-badge"
                color="indigo"
                width="max-w-lg"
            >
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto p-6 space-y-3">
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Branch')}</label>
                            <select
                                value={branchForNewPosition ?? ''}
                                onChange={e => setBranchForNewPosition(e.target.value === '' ? null : parseInt(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                            >
                                <option value="">{t('— Independent (no branch) —')}</option>
                                {governmentBranches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-500 mt-1 italic">{t('Independent positions appear outside any branch in the public overview.')}</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Name')}</label>
                            <input value={posName} onChange={e => setPosName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" placeholder={t('e.g. Senator')} />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Description')}</label>
                            <textarea value={posDescription} onChange={e => setPosDescription(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" rows={2} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{t('Fill Method')}</label>
                                <select value={posFillMethod} onChange={e => setPosFillMethod(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white">
                                    {Object.values(PositionFillMethod).map(m => <option key={m} value={m}>{t(m, { context: 'fillMethod' })}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{t('Max Holders')}</label>
                                <input type="number" min="1" value={posMaxHolders} onChange={e => setPosMaxHolders(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{t('Term Length (days)')}</label>
                                <input type="number" min="1" value={posTermDays} onChange={e => setPosTermDays(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" placeholder={t('Indefinite')} />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{t('Icon (FontAwesome)')}</label>
                                <input value={posIcon} onChange={e => setPosIcon(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" placeholder="fa-solid fa-user" />
                            </div>
                        </div>

                        <div className="border-t border-slate-700/50 pt-3">
                            <h4 className="text-xs font-semibold text-slate-300 mb-2">{t('Legislative Powers')}</h4>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input type="checkbox" checked={posCanPropose} onChange={e => setPosCanPropose(e.target.checked)} className="rounded-sm border-slate-600" />
                                    {t('Can propose legislation')}
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input type="checkbox" checked={posCanVote} onChange={e => setPosCanVote(e.target.checked)} className="rounded-sm border-slate-600" />
                                    {t('Can vote on legislation')}
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input type="checkbox" checked={posCanVeto} onChange={e => setPosCanVeto(e.target.checked)} className="rounded-sm border-slate-600" />
                                    {t('Has veto power')}
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input type="checkbox" checked={posCanCallElections} onChange={e => setPosCanCallElections(e.target.checked)} className="rounded-sm border-slate-600" />
                                    {t('Can call elections')}
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input type="checkbox" checked={posCanIssueOrders} onChange={e => setPosCanIssueOrders(e.target.checked)} className="rounded-sm border-slate-600" />
                                    {t('Can issue executive orders')}
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-white/10 bg-slate-950/50 px-6 py-4 flex justify-end gap-2 shrink-0">
                        <button onClick={() => setShowPositionForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
                        <button onClick={savePosition} disabled={isLoading || !posName.trim()} className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md disabled:opacity-40">{t('Save')}</button>
                    </div>
                </div>
            </WindowFrame>
            <WindowFrame
                isOpen={showAppointModal}
                onClose={() => setShowAppointModal(false)}
                title={t('Appoint Position Holder')}
                subtitle={appointPosition ? t('Appointing to: {name}', { name: appointPosition.name }) : t('Select a member')}
                icon="fa-solid fa-user-plus"
                color="indigo"
                width="max-w-md"
            >
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto p-6 space-y-3">
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">{t('Search Members')}</label>
                            <input
                                value={appointSearch}
                                onChange={e => setAppointSearch(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                                placeholder={t('Search by name or RSI handle...')}
                                autoFocus
                            />
                        </div>
                        <div className="max-h-72 overflow-y-auto space-y-0.5 bg-slate-800/50 rounded-md border border-slate-700/50">
                            {filteredAppointUsers.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-4">{t('No members found')}</p>
                            ) : (
                                filteredAppointUsers.map(user => {
                                    const isSelected = appointUserId === user.id;
                                    const alreadyHolds = appointPosition?.currentHolders?.some(h => h.userId === user.id) || false;
                                    return (
                                        <button
                                            key={user.id}
                                            onClick={() => !alreadyHolds && setAppointUserId(user.id)}
                                            disabled={alreadyHolds}
                                            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                                                alreadyHolds ? 'opacity-40 cursor-not-allowed' :
                                                isSelected ? 'bg-indigo-500/10 border-l-2 border-indigo-400' : 'hover:bg-slate-700/50'
                                            }`}
                                        >
                                            {user.avatarUrl ? (
                                                <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center">
                                                    <i className="fa-solid fa-user text-[8px] text-slate-500"></i>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <span className="text-xs text-white block truncate">{user.name}</span>
                                                {user.rsiHandle && <span className="text-[10px] text-slate-500 block truncate">{user.rsiHandle}</span>}
                                            </div>
                                            {alreadyHolds && <span className="text-[10px] text-slate-500">{t('Already holds')}</span>}
                                            {isSelected && !alreadyHolds && <i className="fa-solid fa-check text-indigo-400 text-xs"></i>}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    <div className="border-t border-white/10 bg-slate-950/50 px-6 py-4 flex justify-end gap-2 shrink-0">
                        <button onClick={() => setShowAppointModal(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
                        <button
                            onClick={appointHolder}
                            disabled={isLoading || !appointUserId}
                            className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md disabled:opacity-40"
                        >
                            {isLoading ? t('Appointing...') : t('Appoint')}
                        </button>
                    </div>
                </div>
            </WindowFrame>
        </div>
    );
};

function formatGovernmentType(type: string): string {
    const labels: Record<string, string> = {
        military_junta: 'Military Junta',
        corporate_board: 'Corporate Board',
        democratic_republic: 'Democratic Republic',
        constitutional_monarchy: 'Constitutional Monarchy',
        westminster: 'Westminster Parliament',
        technocracy: 'Technocracy',
        pirate_code: 'Pirate Code',
        custom: 'Custom Government',
    };
    return labels[type] || type;
}

export default GovernmentSettingsTab;
