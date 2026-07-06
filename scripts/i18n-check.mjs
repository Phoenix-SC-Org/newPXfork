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

// Keys the suspicion heuristics would flag, but which ARE intentional display
// text (stylized terminal-look headings with underscores). Review before adding.
const SUSPICIOUS_ALLOW = new Set([
    'Identity_Provisioning_Protocol', // NewUserSetupView heading
    'Security_Protocol',              // RsiVerificationRequiredView heading
    '/unit', '/hr',                   // marketplaceUi price suffixes ("12 aUEC/unit")
]);

/** Heuristics for keys that look like technical identifiers, not UI text. */
function suspicionReason(key) {
    if (SUSPICIOUS_ALLOW.has(key)) return null;
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
    // components/views/operations/DashboardView.tsx: Enum-Anzeigen
    // t(urgency/threatLevel/step/status, { context: '…' })
    'Low', 'Medium', 'High', 'Critical', 'None', 'PVP',
    'Submitted', 'Accepted', 'Assigned', 'En Route',
    'Applied', 'Screening', 'Interviewing', 'On Hold', 'Offered', 'Rejected', 'Hired', 'Withdrawn',
    // components/views/onboarding/OnboardingWizard.tsx: t(STEP_LABELS[s]) / t(c.label) / t(c.tip)
    'Welcome', 'Preflight', 'Create account', 'Admin claim', 'RSI handle', 'Import data', 'All set',
    'Database connection', 'Discord sign-in', 'Session token signing key',
    'Secrets encryption at rest', 'Live realtime updates',
    'Could not reach the database. Check your network and Supabase project status, then re-check. (The server will not start at all if it cannot reach Supabase, so this normally only fails on a transient blip.)',
    'Set DISCORD_CLIENT_ID in your environment, then restart the app/container and re-check — you sign in with Discord in the next step. Environment variables are only read at startup, so a re-check alone will not pick up a new value.',
    'Set JWT_SECRET to a high-entropy random value of at least 32 characters (e.g. `openssl rand -hex 32`), then restart the app/container and re-check (env vars are only read at startup). A short/weak key makes session tokens forgeable.',
    'Set SECRETS_ENCRYPTION_KEY to a random value of at least 32 characters (e.g. `openssl rand -hex 32`) so admin-entered API keys are encrypted at rest, then restart the app/container and re-check (env vars are only read at startup). A short/weak key weakens the encryption. (In production the server refuses to start until this is at least 32 chars.)',
    'Set SUPABASE_JWT_SECRET (your Supabase project JWT secret, ≥32 chars) to enable live updates, then restart the app/container and re-check (env vars are only read at startup). Otherwise the app refreshes manually.',
    // HR: Nav-Labels (HRHubView t(item.label)/t(group.title)) + Tab-Arrays
    'Self Service', 'My Organisation', 'Service History', 'HR Management',
    'My Career', 'My Unit', 'My Specialisations', 'Manage Members', 'Client Register',
    'Manage Vacancy', 'Manage Roles / Positions', 'Interview Templates',
    'All', 'Recruitment', 'Vetting', 'Jobs',
    'Overview', 'Background', 'Investigation', 'RSI Profile', 'Conduct',
    'RSI Profile Validation', 'Organization History Check', 'Internal Conduct Record', 'Interview Assessment',
    // HR: Status-/Typ-Enums (t(x.status, { context }) u. ä.)
    'Completed', 'GRANTED', 'DENIED', 'APPROVED', 'PENDING SIGN-OFF', 'REQUESTED',
    'RESOLVED', 'DISMISSED', 'FINDING ISSUED', 'OPEN', 'TRANSFERRED', 'PENDING', 'PROMOTED',
    'Dispatcher', 'Admin', 'Internal Promotion', 'Security Clearance', 'Unit Transfer',
    'clear', 'flagged', 'pending',
    'Commendation', 'Observation', 'Counseling', 'Infraction',
    'Approved', 'Denied', 'Cancelled', 'Triaged', 'In-Progress', 'Refused', 'Aborted', 'GameError',
    'Planning', 'Concluded', 'PvP', 'PvE', 'Mixed', 'Non-Combat', 'Training', 'Social',
    // Phase 5 (Operations & Dispatch): dynamisch aufgelöste Keys — Enum-Anzeigen,
    // Modul-Level-Label-Arrays (Provider, Nav, Kalender, Kategorien), Status-Label-Helper.
    "Discord Voice",
    "Discord Text",
    "TeamSpeak",
    "Mumble",
    "SimpleRadio",
    "DCS-SRS",
    "External / URL",
    "Other / Notes",
    "Discord — Voice channel",
    "Discord — Text channel",
    "In-platform Op Radio",
    "SimpleRadio (in-game)",
    "DCS-SRS (in-game)",
    "External URL",
    "Other / free-text",
    "Waypoint",
    "Ship",
    "Zone",
    "Line",
    "unit",
    "waypoint",
    "ship",
    "zone",
    "line",
    "text",
    "icon",
    "Comms Plan",
    "Ops Log",
    "Skipped",
    "primary",
    "secondary",
    "assignment",
    "Normal",
    "Roster & ORBAT",
    "Ledger",
    "Holding",
    "Engaged",
    "Regrouping",
    "Disengaging",
    "RTB",
    "Standby",
    "Live Operations",
    "Post-Op",
    "My Status",
    "S1 - Situation",
    "S2 - Mission",
    "S3 - Execution",
    "S4 - Admin & Log",
    "S5 - Cmd & Sig",
    "Administer",
    "S7 - After Action",
    "Maybe",
    "Observations",
    "Sustain (What Went Well)",
    "Improve (What To Fix)",
    "Action Items",
    "Sustain",
    "Improve",
    "Declined",
    "Tentative",
    "Registered",
    "Attended",
    "Late",
    "No Show",
    "Excused",
    "Fuel",
    "Repairs",
    "Supplies",
    "Consumables",
    "Crew",
    "Other",
    "Ammo",
    "Medical",
    "Transport",
    "Needed",
    "Partial",
    "Fulfilled",
    "Unset",
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "month",
    "week",
    "day",
    "My Assigned",
    "Resolved",
    "My Requests",
    "Update status",
    "Accept mission",
    "Resolve / Complete",
    "Copy REF ID",
    "Toggle this panel",
    "SUBMITTED",
    "TRIAGED",
    "ACCEPTED",
    "IN PROGRESS",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
    "REFUSED",
    "ABORTED",
    "GAME ERROR",
    "No log entries found.",
    "Failed to load dossier.",
    "Unproven",
    "Trusted",
    "Standard",
    "High Caution",
    "Extreme Caution",
    "Standing",
    "ACTIVE",
    "STANDING",
    "CLAIMED",
    "HIGH CAUTION",
    "EXTREME CAUTION",
    "Draft",
    "Candidacy",
    "Voting",
    "Runoff",
    "Proposed",
    "Debate",
    "Passed",
    "Vetoed",
    "Repealed",
    "Amended",
    // Phase 6 (Intel & Allianzen): Dossier-Tabs/Stats, AI-Statustexte, Bulletin-Dauern, Allianz-Filter, Relativzeit
    "Reports",
    "Interactions",
    "Members",
    "Affiliations",
    "Known Members",
    "Awaiting configuration",
    "Analysis available",
    "Ready to scan",
    "Rate Limit Active",
    "Analysis Failed",
    "Unknown error",
    "The AI service is temporarily at capacity. Try again shortly.",
    "The AI service encountered an unexpected error.",
    "AI returned an empty response. Please try again later.",
    "Failed to generate summary. The AI service may be temporarily unavailable.",
    "{minutes}m ago",
    "{hours}h ago",
    "{days}d ago",
    "Alliance",
    "Rivalry",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "Indefinite",
    // Phase 7 (Fleet/Warehouse/QM): Schiffs-/Gruppenstatus, Lager-Kategorien/-Bewegungsgründe, QM-Status/Zustände/Outcomes
    "Stored",
    "Lent",
    "Sold",
    "Division",
    "Squadron",
    "Wing",
    "Taskforce",
    "Movements",
    "Withdrawals",
    "Ore",
    "Refined",
    "RMC",
    "Munition",
    "Consumable",
    "approved",
    "fulfilled",
    "denied",
    "cancelled",
    "Sale",
    "Crafting",
    "Initial",
    "Restock",
    "Withdraw · Sale",
    "Withdraw · Craft",
    "Withdraw · Transport",
    "Withdraw · Other",
    "Transfer In",
    "Transfer Out",
    "Loss",
    "Destruction",
    "Refined Material",
    "Adjust (correction)",
    "Loss / shrinkage",
    "New stock arrived (mining haul, refinery output, purchase).",
    "Fix a count error. Can go up or down.",
    "Stock missing without explanation.",
    "Stock destroyed (combat, accident, expiry).",
    "Selling the stock for aUEC.",
    "Material consumed in crafting / manufacturing.",
    "Hauling between warehouses or to a partner.",
    "Anything else — explain in notes.",
    "overview",
    "low stock",
    "catalog",
    "locations",
    "issuances",
    "member records",
    "Issuances",
    "Settings",
    "all",
    "weapon",
    "armor",
    "component",
    "consumable",
    "misc",
    "pristine",
    "used",
    "damaged",
    "broken",
    "New stock arrived. Adds to the on-hand total.",
    "Fix an inventory miscount. Can go up or down.",
    "Stock has gone missing. Reduces the on-hand total.",
    "Stock destroyed (combat, accident, expiry). Reduces the on-hand total.",
    "Returned",
    "Written Off",
    "On time",
    "returned_on_time",
    "returned_late",
    "returned_damaged",
    "lost",
    "destroyed_in_action",
    // Phase 8 (Marketplace/Finanzen): Listing-Typen, Contract-Steps, Report-Gründe, Buchungstypen/-status, Kontotypen
    "Selling",
    "Buying",
    "Offering",
    "Requesting",
    "Delivered",
    "Seller",
    "Buyer",
    "Prohibited / banned goods",
    "Scam or fraud",
    "Spam or duplicate",
    "Misleading description or price",
    "Harassment or abuse",
    "seller",
    "buyer",
    "All types",
    "Transfers",
    "Payouts",
    "Adjustments",
    "All statuses",
    "Reversed",
    "deposit",
    "withdrawal",
    "transfer",
    "payout",
    "adjustment",
    "confirmed",
    "rejected",
    "general",
    "reserve",
    "project",
    "ops",
    "Reserve",
    "Project",
    "The main org bank — most orgs only have this one.",
    "Safety buffer kept separately from day-to-day funds.",
    "Earmarked for a specific project or acquisition.",
    "Funds allocated to ongoing ops and payouts.",
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
