import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider, useTheme, THEMES, DEFAULT_THEME } from '../theme/ThemeContext';

const Probe: React.FC = () => {
    const { theme, setTheme } = useTheme();
    return (
        <div>
            <span data-testid="theme">{theme}</span>
            <button onClick={() => setTheme('black')}>to-black</button>
            <button onClick={() => setTheme('blue')}>to-blue</button>
            <button onClick={() => setTheme('red')}>to-red</button>
        </div>
    );
};

describe('ThemeProvider', () => {
    beforeEach(() => {
        cleanup();
        localStorage.clear();
        delete document.documentElement.dataset.theme;
    });

    it('exposes exactly the three themes with red as default', () => {
        expect(THEMES.map((t) => t.id)).toEqual(['red', 'blue', 'black']);
        expect(DEFAULT_THEME).toBe('red');
    });

    it('defaults to red and sets the data-theme attribute', () => {
        render(<ThemeProvider><Probe /></ThemeProvider>);
        expect(screen.getByTestId('theme').textContent).toBe('red');
        expect(document.documentElement.dataset.theme).toBe('red');
    });

    it('switches themes, updates the attribute and persists to localStorage', () => {
        render(<ThemeProvider><Probe /></ThemeProvider>);
        fireEvent.click(screen.getByText('to-black'));
        expect(screen.getByTestId('theme').textContent).toBe('black');
        expect(document.documentElement.dataset.theme).toBe('black');
        expect(localStorage.getItem('ui.theme')).toBe('"black"');
        fireEvent.click(screen.getByText('to-blue'));
        expect(document.documentElement.dataset.theme).toBe('blue');
        expect(localStorage.getItem('ui.theme')).toBe('"blue"');
    });

    it('restores the persisted theme on mount', () => {
        localStorage.setItem('ui.theme', '"blue"');
        render(<ThemeProvider><Probe /></ThemeProvider>);
        expect(screen.getByTestId('theme').textContent).toBe('blue');
        expect(document.documentElement.dataset.theme).toBe('blue');
    });

    it('treats a corrupted stored value as the red default', () => {
        localStorage.setItem('ui.theme', '"pink"');
        render(<ThemeProvider><Probe /></ThemeProvider>);
        expect(screen.getByTestId('theme').textContent).toBe('red');
        expect(document.documentElement.dataset.theme).toBe('red');
    });
});
