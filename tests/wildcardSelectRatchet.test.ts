import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Wildcard-select ratchet (security / data-minimisation rule).
//
// No new `select('*')`, `select(`...(*)...`)` embed wildcards, or bare `select()`
// calls may be added to the server data layer. Every wildcard pulls every column
// — including ones added to the table later — and is one missed mapper away from
// shipping them to the browser. New queries must enumerate exactly the columns the
// caller needs.
//
// The legacy wildcard backlog has been fully cleared — every data-layer query now
// enumerates its exact columns. The baseline is therefore EMPTY: no wildcard select,
// `(*)` embed, or bare `select()` is permitted anywhere in lib/** or api/**. Any new
// one fails the "no file gained a wildcard select" check below; the rule is now
// absolute, not a ratchet down from a tolerated baseline.

const BASELINE: Record<string, number> = {};

const ROOT = resolve(__dirname, '..');

function countWildcardSelects(src: string): number {
    let count = 0;
    // Any select whose (string) argument contains a '*' — covers select('*'),
    // multi-line template selects with (*) embeds, and "col, rel(*)" strings.
    const re = /\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        if (m[1].includes('*')) count++;
    }
    // Bare .select() selects every column too.
    const bare = src.match(/\.select\(\s*\)/g);
    count += bare ? bare.length : 0;
    return count;
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel, acc);
        else if (entry.name.endsWith('.ts')) acc.push(rel);
    }
    return acc;
}

describe('wildcard-select ratchet (lib/** + api/**)', () => {
    const files = [...walk('lib'), ...walk('api')];
    const current: Record<string, number> = {};
    for (const rel of files) {
        const count = countWildcardSelects(readFileSync(join(ROOT, rel.split('/').join(sep)), 'utf8'));
        if (count > 0) current[rel] = count;
    }

    it('no file gained a wildcard select (enumerate your columns instead)', () => {
        const regressions: string[] = [];
        for (const [file, count] of Object.entries(current)) {
            const allowed = BASELINE[file] ?? 0;
            if (count > allowed) {
                regressions.push(`${file}: ${count} wildcard selects (baseline ${allowed}) — new queries must enumerate exact columns`);
            }
        }
        expect(regressions, regressions.join('\n')).toEqual([]);
    });

    it('baseline is ratcheted down when wildcards are removed', () => {
        const stale: string[] = [];
        for (const [file, allowed] of Object.entries(BASELINE)) {
            const count = current[file] ?? 0;
            if (count < allowed) {
                stale.push(`${file}: now ${count} (baseline ${allowed}) — lower the BASELINE entry to lock in the improvement`);
            }
        }
        expect(stale, stale.join('\n')).toEqual([]);
    });
});
