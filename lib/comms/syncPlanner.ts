// =============================================================================
// StarComms Sync Planner (V6) — OPTIONAL, explicitly-enabled sync.
//
// Everything here is OFF by default and SIDE-EFFECT FREE. The planner only
// *computes suggestions* ("you may want to open the StarComms operation") from
// the current StarComms status + a myRSI operation-active signal. It never
// writes, never touches the network, never touches secrets, and never runs on a
// timer. Execution of a suggestion is a separate, explicit admin click that
// reuses the existing V3 open/close actions — there is no auto-execution here.
// =============================================================================

import type { CommsStatus } from './types.js';

/** Secret-free summary of the V6 sync feature flags (all default OFF). */
export interface SyncConfigSummary {
    /** Suggest StarComms open/close based on myRSI operation state (V3 executor). */
    operationState: boolean;
    /** Suggest reviewing a StarComms net preset (V4 preview). */
    netPreset: boolean;
    /** Suggest reviewing role-to-net rules (V5 — not yet available). */
    roleNetRules: boolean;
    /** Suggest reviewing operator assignments (V5 — not yet available). */
    assignments: boolean;
    /** Execution mode. Only 'suggested' is implemented; 'auto' is reserved and
     *  NOT acted upon by V6 (no automatic execution exists). */
    mode: string;
    /** Advisory minimum seconds between sync actions (not a poller). */
    minIntervalSeconds: number;
    /** True when ANY sync mode is enabled. */
    anyEnabled: boolean;
}

const DEFAULT_MIN_INTERVAL_SECONDS = 30;

function readFlag(name: string): boolean {
    const v = (process.env[name] || '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Read the V6 sync flags from the environment. All default OFF. Stateless. */
export function readSyncConfig(): SyncConfigSummary {
    const operationState = readFlag('STARCOMMS_SYNC_OPERATION_STATE');
    const netPreset = readFlag('STARCOMMS_SYNC_NET_PRESET');
    const roleNetRules = readFlag('STARCOMMS_SYNC_ROLE_NET_RULES');
    const assignments = readFlag('STARCOMMS_SYNC_ASSIGNMENTS');
    const mode = (process.env.STARCOMMS_SYNC_MODE || 'suggested').trim().toLowerCase() || 'suggested';
    const rawInterval = parseInt(process.env.STARCOMMS_SYNC_MIN_INTERVAL_SECONDS || '', 10);
    const minIntervalSeconds = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : DEFAULT_MIN_INTERVAL_SECONDS;
    return {
        operationState,
        netPreset,
        roleNetRules,
        assignments,
        mode,
        minIntervalSeconds,
        anyEnabled: operationState || netPreset || roleNetRules || assignments,
    };
}

export type SyncSuggestionKind =
    | 'operation-open'
    | 'operation-close'
    | 'net-preset'
    | 'role-net-rules'
    | 'assignments';

/** A single suggested action. Secret-free. `messageKey` is a natural-key English
 *  string localized in the UI. `actionable` is true only when V6 can actually
 *  execute it now (operation open/close via V3); everything else is review-only. */
export interface SyncSuggestion {
    kind: SyncSuggestionKind;
    severity: 'warning' | 'info';
    messageKey: string;
    actionable: boolean;
    /** Hint for the UI on how to act. */
    action?: 'open' | 'close' | 'review-net-presets' | 'review-role-net' | 'review-assignments' | 'review';
}

/**
 * PURE planner. Given the sync flags, the current normalized StarComms status,
 * and whether a myRSI operation is currently active, returns the list of
 * suggested actions. No writes, no I/O, no secrets. Only enabled flags produce
 * suggestions; an unavailable status yields no suggestions.
 */
export function computeSyncSuggestions(
    sync: SyncConfigSummary,
    status: CommsStatus | null,
    operationActive: boolean,
): SyncSuggestion[] {
    if (!status) return [];
    const out: SyncSuggestion[] = [];

    // 1) Operation state — the only mode with a real executor (V3 open/close).
    if (sync.operationState) {
        if (operationActive && status.operationOpen === false) {
            out.push({
                kind: 'operation-open',
                severity: 'warning',
                messageKey: 'Suggested: open the StarComms operation — a myRSI operation is active but StarComms is closed.',
                actionable: true,
                action: 'open',
            });
        } else if (status.operationOpen === true && !operationActive) {
            out.push({
                kind: 'operation-close',
                severity: 'info',
                messageKey: 'Suggested: close the StarComms operation — no active myRSI operation was detected.',
                actionable: true,
                action: 'close',
            });
        }
    }

    // 2) Net preset — review via the V4 preview (apply is deferred; not executed here).
    if (sync.netPreset && operationActive) {
        out.push({
            kind: 'net-preset',
            severity: 'info',
            messageKey: 'Suggested: review the StarComms net preset for the active operation.',
            actionable: false,
            action: 'review-net-presets',
        });
    }

    // 3) Role-to-net rules — V5 provides preview/apply; suggest reviewing the
    //    Role-to-Net section. Runtime scope availability is surfaced by the UI
    //    (via the v5_state per-section errors), not the planner.
    if (sync.roleNetRules) {
        out.push({
            kind: 'role-net-rules',
            severity: 'info',
            messageKey: 'Suggested: review the StarComms role-to-net mapping.',
            actionable: false,
            action: 'review-role-net',
        });
    }

    // 4) Assignments — V5 provides preview/apply; suggest reviewing the
    //    Assignments section.
    if (sync.assignments) {
        out.push({
            kind: 'assignments',
            severity: 'info',
            messageKey: 'Suggested: review StarComms operator assignments.',
            actionable: false,
            action: 'review-assignments',
        });
    }

    return out;
}
