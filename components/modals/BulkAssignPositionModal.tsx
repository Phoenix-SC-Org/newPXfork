import React, { useState } from 'react';
import { useHR } from '../../contexts/HRContext';
import apiService from '../../services/apiService';
import BulkActionShell from '../shared/BulkActionShell';
import BulkProgressDisplay from '../shared/BulkProgressDisplay';
import { useBulkProgress } from '../../hooks/useBulkProgress';
import { useBulkActionFlow } from '../../hooks/useBulkActionFlow';
import { User } from '../../types';
import { useI18n } from '../../i18n/I18nContext';

interface Props {
    selectedUsers: User[];
    onClose: () => void;
}

/**
 * Assigns the chosen primary position (job title) to all selected users.
 * Operates on `users.position_id` only — secondary position is left alone.
 */
const BulkAssignPositionModal: React.FC<Props> = ({ selectedUsers, onClose }) => {
    const { t } = useI18n();
    const { hrPositions } = useHR();
    const [positionId, setPositionId] = useState<number | null>(null);
    const bulk = useBulkProgress<number>();

    const targetIds = selectedUsers.map((u) => u.id);

    useBulkActionFlow({
        state: bulk.state,
        aggregate: bulk.aggregate,
        total: bulk.total,
        onClose,
        successVerb: 'Assigned',
    });

    const onConfirm = () => {
        if (positionId == null) return;
        bulk.run(targetIds, async (chunk) => {
            const res = await apiService.rpc('admin:bulk_assign_position', { targetUserIds: chunk, positionId });
            return res?.data ?? res;
        });
    };

    const isRunning = bulk.state === 'running';
    const isFinished = bulk.state === 'done' || bulk.state === 'cancelled' || bulk.state === 'error';

    return (
        <BulkActionShell
            title={t('Assign Primary Position')}
            subtitle={t('All selected members will be set to the chosen job title.')}
            selectedUsers={selectedUsers}
            onClose={onClose}
            onConfirm={onConfirm}
            confirmLabel={t('Assign')}
            confirmDisabled={positionId == null}
            busy={isRunning}
            hideFooter={isRunning || isFinished}
        >
            {!isRunning && !isFinished && (
                <div className="space-y-2">
                    <label className="text-sm font-bold text-white">{t('Position')}</label>
                    <select
                        value={positionId ?? ''}
                        onChange={(e) => setPositionId(e.target.value ? Number(e.target.value) : null)}
                        className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-md text-sm text-white focus:outline-none focus:border-sky-500/50"
                    >
                        <option value="">{t('— Select a position —')}</option>
                        {(hrPositions || []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}
            {(isRunning || isFinished) && (
                <BulkProgressDisplay
                    state={bulk.state}
                    processed={bulk.processed}
                    total={bulk.total}
                    aggregate={bulk.aggregate}
                    onCancel={bulk.cancel}
                    error={bulk.error}
                />
            )}
        </BulkActionShell>
    );
};

export default BulkAssignPositionModal;
