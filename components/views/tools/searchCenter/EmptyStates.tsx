import React from 'react';
import { useI18n } from '../../../../i18n/I18nContext';

interface EmptyProps {
    query?: string;
}

export const EmptyIdle: React.FC = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600 opacity-60">
            <i className="fa-brands fa-searchengin text-6xl mb-4" aria-hidden />
            <p className="text-lg font-bold uppercase tracking-widest">{t('Awaiting Query Input')}</p>
            <p className="text-xs text-slate-500 mt-2 font-mono uppercase tracking-wider">
                {t('Use the filter panel to narrow scope')}
            </p>
        </div>
    );
};

export const EmptyNoMatches: React.FC<EmptyProps> = ({ query }) => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <i className="fa-solid fa-ghost text-4xl mb-4" aria-hidden />
            <p>{query ? t('No records found matching "{query}"', { query }) : t('No records found')}</p>
            <p className="text-xs text-slate-600 mt-2 font-mono uppercase tracking-wider">
                {t('Try a different term or relax filters')}
            </p>
        </div>
    );
};

export const EmptyNoTypes: React.FC = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-center justify-center py-20 text-amber-400">
            <i className="fa-solid fa-filter-circle-xmark text-4xl mb-4" aria-hidden />
            <p>{t('All result types are filtered out')}</p>
            <p className="text-xs text-amber-500/70 mt-2 font-mono uppercase tracking-wider">
                {t('Enable at least one type in the filter panel')}
            </p>
        </div>
    );
};
