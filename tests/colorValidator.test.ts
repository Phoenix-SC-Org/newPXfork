import { describe, it, expect } from 'vitest';
import { normalizeHexColor } from '../lib/color';

describe('normalizeHexColor', () => {
    it('accepts + lowercases #rrggbb (trimmed)', () => {
        expect(normalizeHexColor('#0EA5E9')).toBe('#0ea5e9');
        expect(normalizeHexColor('  #0ea5e9  ')).toBe('#0ea5e9');
        expect(normalizeHexColor('#000000')).toBe('#000000');
    });

    it('expands #rgb → #rrggbb', () => {
        expect(normalizeHexColor('#fff')).toBe('#ffffff');
        expect(normalizeHexColor('#0AF')).toBe('#00aaff');
    });

    it('rejects anything that could carry a CSS metacharacter (the injection guard)', () => {
        for (const bad of [
            'red', 'rgb(0,0,0)', 'hsl(0,0%,0%)', 'oklch(50% 0 0)', 'transparent', 'currentColor',
            'red;}body{display:none}', '#fff;}x{y:z}', 'url(//evil/x)', 'expression(alert(1))',
            'var(--x)', '#0ea5e9 ; }', '#0ea5e9/**/', '#12345', '#1234567', '#gggggg', '#ff', '#', '',
        ]) {
            expect(normalizeHexColor(bad), bad).toBeNull();
        }
    });

    it('rejects non-strings', () => {
        expect(normalizeHexColor(null)).toBeNull();
        expect(normalizeHexColor(undefined)).toBeNull();
        expect(normalizeHexColor(0x0ea5e9)).toBeNull();
        expect(normalizeHexColor({})).toBeNull();
        expect(normalizeHexColor(['#fff'])).toBeNull();
    });

    it('output can only ever contain [#0-9a-f]', () => {
        const out = normalizeHexColor('#AbCdEf');
        expect(out).toBe('#abcdef');
        expect(out).toMatch(/^#[0-9a-f]{6}$/);
    });
});
