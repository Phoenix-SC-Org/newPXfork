import React, { createContext, use, useCallback, useEffect, useMemo } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';

// Central theme registry. A theme is a `data-theme` attribute on <html> plus a
// CSS file in styles/themes/ that overrides the Tailwind color-scale variables
// (see styles/themes/red.css for the token architecture). 'blue' is the
// untouched upstream look (Classic) — it has no overrides by design, which
// keeps future upstream merges conflict-free.

export type ThemeId = 'red' | 'blue' | 'black';

export const DEFAULT_THEME: ThemeId = 'red';

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
    { id: 'red', label: 'Red', swatch: '#ef2a4d' },
    { id: 'blue', label: 'Classic (Blue)', swatch: '#0ea5e9' },
    { id: 'black', label: 'Black', swatch: '#3f3f46' },
];

const STORAGE_KEY = 'ui.theme';

function sanitize(value: unknown): ThemeId {
    return value === 'red' || value === 'blue' || value === 'black' ? value : DEFAULT_THEME;
}

function readStoredTheme(): ThemeId {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        return sanitize(raw ? JSON.parse(raw) : null);
    } catch {
        return DEFAULT_THEME;
    }
}

// Pre-paint init: set the attribute at module-import time (before React renders)
// so the first painted frame already uses the persisted theme — no flash of the
// default theme for users who picked another one.
if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = readStoredTheme();
}

interface ThemeContextValue {
    theme: ThemeId;
    setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: DEFAULT_THEME,
    setTheme: () => undefined,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [storedTheme, setStoredTheme] = usePersistentState<ThemeId>(STORAGE_KEY, DEFAULT_THEME);
    // Guard against a corrupted/legacy stored value.
    const theme = sanitize(storedTheme);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    const setTheme = useCallback((next: ThemeId) => {
        setStoredTheme(sanitize(next));
    }, [setStoredTheme]);

    const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

    return <ThemeContext value={value}>{children}</ThemeContext>;
};

export function useTheme(): ThemeContextValue {
    return use(ThemeContext);
}
