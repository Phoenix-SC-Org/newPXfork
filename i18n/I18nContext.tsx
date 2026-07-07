import React, { createContext, use, useEffect, useMemo, useCallback, useState } from 'react';
import { Language, TranslateParams, Dictionary, translate, translateEnglish } from './index';
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

// ---------------------------------------------------------------------------
// Lazy German dictionary. de.ts is ~120 KB gzip / 5,600 entries — statically
// importing it put it on the critical load path for EVERY user (also English
// ones). It is now a separate async chunk, fetched only when German is active.
// Until it arrives, t() falls back to English (the keys ARE the English text),
// which is the same guarantee the dictionary itself provides for missing keys.
// ---------------------------------------------------------------------------

let deCache: Dictionary | null = null;
let dePromise: Promise<Dictionary> | null = null;

function loadGermanDictionary(): Promise<Dictionary> {
    if (!dePromise) {
        dePromise = import('./de').then((mod) => {
            deCache = mod.de;
            return mod.de;
        });
    }
    return dePromise;
}

function storedLanguage(): Language | null {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ui.language') : null;
        const value = raw ? JSON.parse(raw) : null;
        return value === 'de' || value === 'en' ? value : null;
    } catch {
        return null;
    }
}

// Pre-warm at module-import time (before React renders): if the session will
// start in German, kick off the dictionary fetch now so it downloads in
// parallel with app bootstrap instead of after the first render. Also stamp
// <html lang> pre-mount so the first paint carries the right language.
if (typeof document !== 'undefined') {
    const initial = storedLanguage() ?? detectDefaultLanguage();
    document.documentElement.lang = initial;
    if (initial === 'de') void loadGermanDictionary();
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
    const [storedLang, setStoredLanguage] = usePersistentState<Language>('ui.language', detectDefaultLanguage());
    // Guard against a corrupted/legacy stored value — anything unknown is 'en'.
    const language: Language = storedLang === 'de' ? 'de' : 'en';

    // The German dictionary, once loaded. Seeded from the module cache so a
    // pre-warmed (or previously loaded) dictionary is available on first render.
    const [deDict, setDeDict] = useState<Dictionary | null>(deCache);

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    useEffect(() => {
        if (language !== 'de' || deDict) return;
        let cancelled = false;
        void loadGermanDictionary().then((dict) => {
            if (!cancelled) setDeDict(dict);
        });
        return () => { cancelled = true; };
    }, [language, deDict]);

    const setLanguage = useCallback((lang: Language) => {
        setStoredLanguage(lang === 'de' ? 'de' : 'en');
    }, [setStoredLanguage]);

    const t = useCallback((key: string, params?: TranslateParams) => (
        language === 'de' && deDict ? translate(deDict, key, params) : translateEnglish(key, params)
    ), [language, deDict]);

    const value = useMemo(
        () => ({ language, locale: LOCALE_BY_LANGUAGE[language], setLanguage, t }),
        [language, setLanguage, t],
    );

    return <I18nContext value={value}>{children}</I18nContext>;
};

export function useI18n(): I18nContextValue {
    return use(I18nContext);
}
