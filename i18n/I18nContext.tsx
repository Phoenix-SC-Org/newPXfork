import React, { createContext, use, useEffect, useMemo, useCallback } from 'react';
import { Language, TranslateParams, translate, translateEnglish } from './index';
import { de } from './de';
import { usePersistentState } from '../hooks/usePersistentState';

interface I18nContextValue {
    language: Language;
    /** BCP-47 locale for Intl/toLocaleString formatting, derived from language. */
    locale: string;
    setLanguage: (lang: Language) => void;
    t: (key: string, params?: TranslateParams) => string;
}

const LOCALE_BY_LANGUAGE: Record<Language, string> = { en: 'en-US', de: 'de-DE' };

/** Browser language on first visit; localStorage ('ui.language') wins after. */
function detectDefaultLanguage(): Language {
    try {
        return typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
    } catch {
        return 'en';
    }
}

// English defaults so components render sensibly even without a provider
// (e.g. isolated component tests).
const I18nContext = createContext<I18nContextValue>({
    language: 'en',
    locale: 'en-US',
    setLanguage: () => undefined,
    t: (key, params) => translateEnglish(key, params),
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [storedLanguage, setStoredLanguage] = usePersistentState<Language>('ui.language', detectDefaultLanguage());
    // Guard against a corrupted/legacy stored value — anything unknown is 'en'.
    const language: Language = storedLanguage === 'de' ? 'de' : 'en';

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    const setLanguage = useCallback((lang: Language) => {
        setStoredLanguage(lang === 'de' ? 'de' : 'en');
    }, [setStoredLanguage]);

    const t = useCallback((key: string, params?: TranslateParams) => (
        language === 'de' ? translate(de, key, params) : translateEnglish(key, params)
    ), [language]);

    const value = useMemo(
        () => ({ language, locale: LOCALE_BY_LANGUAGE[language], setLanguage, t }),
        [language, setLanguage, t],
    );

    return <I18nContext value={value}>{children}</I18nContext>;
};

export function useI18n(): I18nContextValue {
    return use(I18nContext);
}
