// =============================================================================
// StarComms operational awareness (V2.1) — pure, i18n-free correlation between
// the safe StarComms status and whether a myRSI operation/dispatch context is
// currently active. Kept out of the widget component file so it stays a plain,
// unit-testable module (and so the widget file only exports components).
//
// No secret/API-key material can enter here: it only reads the already-safe,
// normalized CommsStatus produced by lib/comms.
// =============================================================================

import type { CommsStatus } from '../../lib/comms/types';

export type AwarenessLevel = 'warning' | 'info';

/** A single derived warning/hint. `key` is stable (used for React keys, tests,
 *  and message lookup); the human text is resolved at render time via i18n. */
export interface AwarenessItem { level: AwarenessLevel; key: string }

/** After how long a displayed status is considered stale (client-side hint).
 *  The server cache TTL is 15s; 60s means the widget simply hasn't refreshed in
 *  a while — not that the shard is down. */
export const STALE_AFTER_MS = 60_000;

/** Known StarComms feature flags surfaced compactly, in a stable order. */
export const KNOWN_FEATURE_KEYS = ['globalPttEnabled', 'acarsEnabled', 'publicNet.enabled', 'orgLink.enabled'] as const;

/**
 * Derive read-only warnings/hints from a normalized StarComms status and the
 * host's "a myRSI operation/dispatch context is currently active" signal. Only
 * produces items when a live status is present; disabled/error/not-configured
 * states are surfaced by the widget's own banners, not here.
 */
export function deriveCommsAwareness(status: CommsStatus | null, operationActive: boolean): AwarenessItem[] {
    if (!status) return [];
    const items: AwarenessItem[] = [];

    // Operation open/closed correlation.
    if (operationActive && status.operationOpen === false) {
        items.push({ level: 'warning', key: 'op-closed' });
    } else if (status.operationOpen === true && !operationActive) {
        items.push({ level: 'info', key: 'op-open-no-myrsi' });
    }

    // Operator awareness — only a concern while an operation is active.
    if (operationActive && status.connectedOperators === 0) {
        items.push({ level: 'warning', key: 'no-operators' });
    }

    // Net awareness.
    if (status.nets.length === 0) {
        items.push({ level: 'info', key: 'no-nets' });
    }

    // Feature awareness — ACARS disabled during an active context is informational only.
    if (operationActive && status.features.acarsEnabled === false) {
        items.push({ level: 'info', key: 'acars-off' });
    }

    return items;
}
