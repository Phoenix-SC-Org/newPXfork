import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { Language } from '../../i18n/index';

/**
 * Unobtrusive EN/DE toggle. Persists the choice via the I18n provider
 * (localStorage 'ui.language'). Usable both pre-login (LoginView footer)
 * and post-login (Header).
 */
const LanguageSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { language, setLanguage, t } = useI18n();

    const item = (lang: Language, label: string) => (
        <button
            type="button"
            onClick={() => setLanguage(lang)}
            aria-pressed={language === lang}
            className={`px-1 py-0.5 rounded-sm transition-colors ${
                language === lang
                    ? 'text-sky-400 font-bold'
                    : 'text-slate-500 hover:text-slate-300'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div
            className={`inline-flex items-center font-mono text-[10px] uppercase tracking-widest select-none ${className}`}
            title={t('Switch language')}
            role="group"
            aria-label={t('Switch language')}
        >
            <i className="fa-solid fa-globe text-slate-600 mr-1.5 text-[10px]" aria-hidden />
            {item('en', 'EN')}
            <span className="text-slate-700">/</span>
            {item('de', 'DE')}
        </div>
    );
};

export default LanguageSwitcher;
