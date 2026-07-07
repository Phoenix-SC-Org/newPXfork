import React from 'react';
import apiService from '../../services/apiService';
import BulkActionShell from '../shared/BulkActionShell';
import BulkProgressDisplay from '../shared/BulkProgressDisplay';
import { useBulkProgress } from '../../hooks/useBulkProgress';
import { useBulkActionFlow } from '../../hooks/useBulkActionFlow';
import { useI18n } from '../../i18n/I18nContext';
import { User } from '../../types';

interface Props {
    selectedUsers: User[];
    onClose: () => void;
}

/**
 * Toolbar-flavoured bulk demote: takes pre-selected users from the row
 * checkboxes and dispatches `admin:bulk_demote_to_client`. Distinct from
 * the in-modal selection flow used by `BulkDemoteModal` (which is
 * launched from the over-cap grace banner without prior selection state).
 */
const BulkDemoteToClientModal: React.FC<Props> = ({ selectedUsers, onClose }) => {
    const { t } = useI18n();
    const bulk = useBulkProgress<number>();

    const targetIds = selectedUsers.map((u) => u.id);

    useBulkActionFlow({
        state: bulk.state,
        aggregate: bulk.aggregate,
        total: bulk.total,
        onClose,
        successVerb: 'Demoted',
    });

    const onConfirm = () => {
        bulk.run(targetIds, async (chunk) => {
            const res = await apiService.rpc('admin:bulk_demote_to_client', { targetUserIds: chunk });
            return res?.data ?? res;
        });
    };

    const isRunning = bulk.state === 'running';
    const isFinished = bulk.state === 'done' || bulk.state === 'cancelled' || bulk.state === 'error';

    return (
        <BulkActionShell
            title={t('Demote to Client')}
            subtitle={t('Selected members will lose Member-tier access and be moved to the Client role.')}
            selectedUsers={selectedUsers}
            onClose={onClose}
            onConfirm={onConfirm}
            confirmLabel={t('Demote {count}', { count: selectedUsers.length })}
            busy={isRunning}
            hideFooter={isRunning || isFinished}
        >
            {!isRunning && !isFinished && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-md p-3 text-xs text-rose-200">
                    <i className="fa-solid fa-triangle-exclamation mr-2" />
                    {t("Demoting a member is reversible (re-promote one user at a time via their detail panel) but a bulk re-promotion tool isn't available yet. Double-check the selection list before confirming.")}
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

export default BulkDemoteToClientModal;
