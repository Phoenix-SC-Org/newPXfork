// Lightweight i18n core — no external dependency.
//
// Natural-key approach: the translation KEY is the English source text itself.
// A missing dictionary entry therefore falls back to English by construction —
// the app can never render a broken key, only untranslated English.
//
// Ambiguous short terms use a context object instead of a plain string:
//
//   'Order': { marketplace: 'Bestellung', government: 'Anordnung' }
//
// resolved via t('Order', { context: 'marketplace' }). An optional '_' entry
// is the context-less default. If the requested context (and '_') is missing,
// the English key is returned — never a wrong-context translation.
//
// Interpolation: '{name}' placeholders are replaced from params, e.g.
// t('{count} members', { count: 5 }). The reserved 'context' param is never
// interpolated. This works in the English fallback path too.

export type Language = 'en' | 'de';

export const LANGUAGES: readonly Language[] = ['en', 'de'];

/** Value: plain translation, or a context → translation map ('_' = default). */
export type Dictionary = Record<string, string | Record<string, string>>;

export interface TranslateParams {
    /** Disambiguation context for short/ambiguous keys. Not interpolated. */
    context?: string;
    [param: string]: string | number | undefined;
}

const EMPTY: Dictionary = {};

function interpolate(text: string, params?: TranslateParams): string {
    if (!params || !text.includes('{')) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
        if (name === 'context') return match;
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}

export function translate(dict: Dictionary, key: string, params?: TranslateParams): string {
    const entry = dict[key];
    let text: string;
    if (entry === undefined) {
        text = key;
    } else if (typeof entry === 'string') {
        text = entry;
    } else {
        const context = params?.context;
        const resolved = (context !== undefined ? entry[context] : undefined) ?? entry['_'];
        text = resolved ?? key;
    }
    return interpolate(text, params);
}

/** English pass-through: no dictionary lookup, but params still interpolate. */
export function translateEnglish(key: string, params?: TranslateParams): string {
    return translate(EMPTY, key, params);
}
