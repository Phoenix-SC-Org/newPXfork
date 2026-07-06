import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { translate, translateEnglish, Dictionary } from '../i18n/index';
import { de } from '../i18n/de';
import { I18nProvider, useI18n } from '../i18n/I18nContext';

describe('translate (core)', () => {
    it('falls back to the English key when no entry exists', () => {
        expect(translate({}, 'Save Changes')).toBe('Save Changes');
    });

    it('returns the German entry when present', () => {
        expect(translate({ 'Save Changes': 'Änderungen speichern' }, 'Save Changes')).toBe('Änderungen speichern');
    });

    it('interpolates {name} params in translations', () => {
        const dict: Dictionary = { '{count} members': '{count} Mitglieder' };
        expect(translate(dict, '{count} members', { count: 5 })).toBe('5 Mitglieder');
    });

    it('interpolates params in the English fallback path too', () => {
        expect(translateEnglish('{count} members', { count: 3 })).toBe('3 members');
    });

    it('leaves unknown placeholders untouched', () => {
        expect(translateEnglish('{count} of {total}', { count: 1 })).toBe('1 of {total}');
    });

    it('never interpolates the reserved context param', () => {
        expect(translateEnglish('literal {context}', { context: 'marketplace' })).toBe('literal {context}');
    });
});

describe('translate (context disambiguation)', () => {
    const dict: Dictionary = {
        'Order': { marketplace: 'Bestellung', government: 'Anordnung' },
        'Unit': { _: 'Einheit', measurement: 'Maßeinheit' },
    };

    it('resolves the requested context', () => {
        expect(translate(dict, 'Order', { context: 'marketplace' })).toBe('Bestellung');
        expect(translate(dict, 'Order', { context: 'government' })).toBe('Anordnung');
    });

    it('falls back to English when the requested context is missing and no default exists', () => {
        expect(translate(dict, 'Order', { context: 'logistics' })).toBe('Order');
    });

    it('falls back to English when no context is given and no default exists', () => {
        expect(translate(dict, 'Order')).toBe('Order');
    });

    it('uses the "_" default when present', () => {
        expect(translate(dict, 'Unit')).toBe('Einheit');
        expect(translate(dict, 'Unit', { context: 'unknown' })).toBe('Einheit');
        expect(translate(dict, 'Unit', { context: 'measurement' })).toBe('Maßeinheit');
    });
});

describe('de dictionary shape', () => {
    it('contains only strings or string-valued context maps', () => {
        for (const [key, value] of Object.entries(de)) {
            if (typeof value === 'string') continue;
            expect(typeof value, `entry ${JSON.stringify(key)}`).toBe('object');
            for (const [ctx, text] of Object.entries(value)) {
                expect(typeof text, `entry ${JSON.stringify(key)} context ${JSON.stringify(ctx)}`).toBe('string');
            }
        }
    });
});

const Probe: React.FC = () => {
    const { language, setLanguage, t } = useI18n();
    return (
        <div>
            <span data-testid="lang">{language}</span>
            <span data-testid="radio">{t('Radio')}</span>
            <button onClick={() => setLanguage('de')}>to-de</button>
            <button onClick={() => setLanguage('en')}>to-en</button>
        </div>
    );
};

describe('I18nProvider', () => {
    beforeEach(() => {
        cleanup();
        localStorage.clear();
        document.documentElement.lang = '';
    });

    it('defaults to English (jsdom navigator is en-US) and passes text through', () => {
        render(<I18nProvider><Probe /></I18nProvider>);
        expect(screen.getByTestId('lang').textContent).toBe('en');
        expect(screen.getByTestId('radio').textContent).toBe('Radio');
        expect(document.documentElement.lang).toBe('en');
    });

    it('switches to German, translates, sets <html lang> and persists to localStorage', () => {
        render(<I18nProvider><Probe /></I18nProvider>);
        fireEvent.click(screen.getByText('to-de'));
        expect(screen.getByTestId('lang').textContent).toBe('de');
        expect(screen.getByTestId('radio').textContent).toBe('Funk');
        expect(document.documentElement.lang).toBe('de');
        expect(localStorage.getItem('ui.language')).toBe('"de"');
    });

    it('restores the persisted language on mount', () => {
        localStorage.setItem('ui.language', '"de"');
        render(<I18nProvider><Probe /></I18nProvider>);
        expect(screen.getByTestId('lang').textContent).toBe('de');
        expect(document.documentElement.lang).toBe('de');
    });

    it('treats a corrupted stored value as English', () => {
        localStorage.setItem('ui.language', '"fr"');
        render(<I18nProvider><Probe /></I18nProvider>);
        expect(screen.getByTestId('lang').textContent).toBe('en');
        expect(screen.getByTestId('radio').textContent).toBe('Radio');
    });
});
