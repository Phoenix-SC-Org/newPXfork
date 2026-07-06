
import React, { useMemo } from 'react';
import { useData } from '../../../contexts/DataContext';
import { useAuth } from '../../../contexts/AuthContext';
import Notice from '../../ui/Notice';
import EmptyState from '../../shared/ui/EmptyState';
import { useI18n } from '../../../i18n/I18nContext';

const HRNoticesTab: React.FC = () => {
    const { announcements } = useData();
    const { currentUser } = useAuth();
    const { t } = useI18n();

    const visibleNotices = useMemo(() => {
        if (!currentUser) return [];
        const now = new Date();
        return announcements.filter(ann => {
            if (ann.expiryDate && new Date(ann.expiryDate) < now) return false;
            if (ann.audience.includes(currentUser.role)) return true;
            if (ann.audience.includes('Member') && currentUser.role === 'Dispatcher') return true;
            return false;
        }).sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
    }, [announcements, currentUser]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
                        <i className="fa-solid fa-bullhorn text-emerald-300"></i>
                        {t('Notices & Bulletins')}
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">{t('Official communications and department updates.')}</p>
                </div>
            </div>

            <div className="space-y-4 max-w-4xl mx-auto">
                {visibleNotices.length > 0 ? (
                    visibleNotices.map(notice => (
                        <div key={notice.id} className="transform transition-all duration-300 hover:-translate-y-0.5">
                            <Notice announcement={notice} />
                        </div>
                    ))
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30">
                        <EmptyState
                            icon="fa-inbox"
                            accent="emerald"
                            heading={t('No active notices')}
                            description={t('Official communications will appear here when HR or command posts them.')}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default HRNoticesTab;
