import React from 'react';
import { THEMES, useTheme } from '../../theme/ThemeContext';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Unobtrusive theme picker: one color swatch per theme (Red / Classic / Black).
 * Persists via ThemeProvider (localStorage 'ui.theme'). Usable pre-login
 * (LoginView footer) and post-login (Header), like the LanguageSwitcher.
 */
const ThemeSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { theme, setTheme } = useTheme();
    const { t } = useI18n();

    return (
        <div
            className={`inline-flex items-center gap-2 ${className}`}
            role="group"
            aria-label={t('Switch theme')}
            title={t('Switch theme')}
        >
            {THEMES.map((opt) => (
                <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    title={t(opt.label)}
                    aria-pressed={theme === opt.id}
                    className={`w-3.5 h-3.5 rounded-full border border-white/25 transition-all ${
                        theme === opt.id
                            ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-slate-900 scale-110'
                            : 'opacity-60 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: opt.swatch }}
                />
            ))}
        </div>
    );
};

export default ThemeSwitcher;
