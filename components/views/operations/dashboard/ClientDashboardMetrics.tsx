import React, { useMemo } from 'react';
import { useData } from '../../../../contexts/DataContext';
import { useAuth, useFormatDate } from '../../../../contexts/AuthContext';
import { ServiceRequestStatus } from '../../../../types';
import { MetricCard } from '../../../shared/ui';
import { useI18n } from '../../../../i18n/I18nContext';

export default function ClientDashboardMetrics() {
    const { t } = useI18n();
    const { hydratedServiceRequests } = useData();
    const { currentUser } = useAuth();
    const fmt = useFormatDate();

    const requestsFilled = useMemo(() => hydratedServiceRequests.filter((r: any) =>
        r.clientId === currentUser?.id && r.status === ServiceRequestStatus.Success,
    ).length, [hydratedServiceRequests, currentUser?.id]);

    if (!currentUser) return null;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricCard
                label={t('Requests Filled')}
                value={requestsFilled}
                sub={requestsFilled === 0 ? t('Your first op awaits') : t('Completed services')}
                icon="fa-clipboard-check"
                accent="emerald"
            />
            <MetricCard
                label={t('Reputation')}
                value={currentUser.reputation}
                sub={t('Standing with this org')}
                icon="fa-star"
                accent="amber"
            />
            <MetricCard
                label={t('Member Since')}
                value={(currentUser.tenureStartDate || currentUser.createdAt) ? fmt.date(currentUser.tenureStartDate || currentUser.createdAt) : '—'}
                sub={t('Your service tenure')}
                icon="fa-calendar-day"
                accent="slate"
            />
        </div>
    );
}
