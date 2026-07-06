#!/usr/bin/env node
// i18n consistency check.
//
// Scans client source for t('…') calls and compares against the German
// dictionary (i18n/de.ts). Reports:
//   - ERROR:   keys that look like technical identifiers (service actions,
//              permission keys, snake_case/camelCase tokens, routes, icon
//              classes, URLs) — these must never be wrapped in t().
//   - ERROR:   non-static t(`…`) template-literal keys (keys must be static).
//   - WARNING: orphaned de.ts entries whose key no longer appears in source
//              (typical after an upstream merge changed the English text).
//   - INFO:    used keys without a German entry (fine — English fallback).
//
// Exit code 1 only on errors; warnings/info never fail the build.
//
// Requires Node with TypeScript type stripping (default since Node 23.6;
// package.json engines requires >= 24) to import i18n/de.ts directly.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Client-side surfaces only. Server code (api/, lib/) is intentionally not
// translated and must not use t(). i18n/ itself is excluded — it contains
// only the dictionary and doc-comment examples, no real t() call sites.
const SCAN_DIRS = ['components', 'contexts', 'hooks'];
const SCAN_FILES = ['App.tsx', 'DashboardApp.tsx'];

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            yield* walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
            yield full;
        }
    }
}

const files = [];
for (const dir of SCAN_DIRS) {
    try { files.push(...walk(path.join(root, dir))); } catch { /* dir may not exist */ }
}
for (const f of SCAN_FILES) files.push(path.join(root, f));

// Matches bare t('…') / t("…") calls (not obj.t(...), not format(...)).
const T_CALL_RE = /(?<![\w.$])t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
const T_TEMPLATE_RE = /(?<![\w.$])t\(\s*`/;

/** Heuristics for keys that look like technical identifiers, not UI text. */
function suspicionReason(key) {
    const hasSpace = key.includes(' ');
    if (!hasSpace) {
        if (/^[a-z0-9-]+:[a-z0-9_:*.-]+$/i.test(key)) return 'looks like a service action / permission key';
        if (key.includes('_')) return 'looks like a snake_case identifier';
        if (/^[a-z]+[A-Z]/.test(key)) return 'looks like a camelCase identifier';
        if (key.startsWith('fa-')) return 'looks like an icon class';
    }
    if (key.startsWith('/')) return 'looks like a route/path';
    if (/^https?:\/\//i.test(key)) return 'looks like a URL';
    return null;
}

// Keys resolved through DYNAMIC t() calls (e.g. t(announcement.type) rendering
// an enum value). The static scan cannot see these — list them here so they
// don't show up as orphans. Keep this list short and documented.
const DYNAMIC_KEYS = new Set([
    // components/ui/Notice.tsx: t(announcement.type, { context: 'announcement' })
    'Information', 'Warning', 'Danger',
]);

const usedKeys = new Map(); // key -> first "file:line"
const errors = [];

for (const file of files) {
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
        if (T_TEMPLATE_RE.test(line)) {
            errors.push(`${rel}:${i + 1}: t(\`…\`) template-literal key — translation keys must be static strings`);
        }
        for (const m of line.matchAll(T_CALL_RE)) {
            const key = m[2].replace(/\\(['"\\])/g, '$1');
            if (!usedKeys.has(key)) usedKeys.set(key, `${rel}:${i + 1}`);
            const reason = suspicionReason(key);
            if (reason) errors.push(`${rel}:${i + 1}: suspicious key ${JSON.stringify(key)} — ${reason}`);
        }
    });
}

// Load the German dictionary (Node type stripping imports the .ts directly).
let de;
try {
    ({ de } = await import(pathToFileURL(path.join(root, 'i18n', 'de.ts')).href));
} catch (e) {
    console.error('ERROR: could not load i18n/de.ts —', e.message);
    console.error('Hint: this script needs Node >= 23.6 (TypeScript type stripping). package.json requires Node >= 24.');
    process.exit(1);
}

const deKeys = new Set(Object.keys(de));
const orphans = [...deKeys].filter((k) => !usedKeys.has(k) && !DYNAMIC_KEYS.has(k));
const missing = [...usedKeys.keys()].filter((k) => !deKeys.has(k));

console.log(`i18n-check: scanned ${files.length} files, found ${usedKeys.size} t() keys, ${deKeys.size} de entries.`);

if (errors.length > 0) {
    console.error(`\n${errors.length} ERROR(S):`);
    for (const e of errors) console.error(`  ${e}`);
}
if (orphans.length > 0) {
    console.warn(`\n${orphans.length} WARNING(S) — orphaned de.ts entries (English source text changed or removed):`);
    for (const k of orphans) console.warn(`  ${JSON.stringify(k)}`);
}
if (missing.length > 0) {
    console.log(`\n${missing.length} INFO — keys without German translation (English fallback active):`);
    for (const k of missing) console.log(`  ${JSON.stringify(k)}  (first use: ${usedKeys.get(k)})`);
}
if (errors.length === 0 && orphans.length === 0 && missing.length === 0) {
    console.log('OK — no issues found.');
}

process.exit(errors.length > 0 ? 1 : 0);
