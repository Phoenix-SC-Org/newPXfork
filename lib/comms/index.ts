// Comms provider factory + a short server-side status cache. Swap
// StarCommsProvider here (or select by an env var) to move to a different
// backend later — callers depend only on the CommsProvider interface.

import { StarCommsProvider } from './starcomms.js';
import type { CommsConfigSummary, CommsErrorKind, CommsProvider, CommsStatus } from './types.js';

let provider: CommsProvider | null = null;

/** The active comms provider (stateless; reads env live on each call). */
export function getCommsProvider(): CommsProvider {
    if (!provider) provider = new StarCommsProvider();
    return provider;
}

/** Secret-free config summary for the active provider. */
export function describeCommsConfig(): CommsConfigSummary {
    return getCommsProvider().describeConfig();
}

// ---------------------------------------------------------------------------
// Short-lived status cache (throttle). The operational widget can be rendered
// by many dispatch/ops users at once; without this each mount would hit the
// external shard. A brief TTL + in-flight de-dupe collapses that to at most one
// upstream request per window. Admin "Test Connection" (V1) bypasses this cache
// on purpose so an admin always gets a fresh probe.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15_000;

interface CachedStatus { status: CommsStatus; fetchedAt: string }
let cache: CachedStatus | null = null;
let inflight: Promise<import('./types.js').CommsResult> | null = null;

/** Secret-free result for the operational widget: the normalized status (or a
 *  typed error), plus the ISO timestamp of the last SUCCESSFUL fetch (which
 *  survives a subsequent error so the UI can show "last good refresh"). */
export interface CommsStatusResult {
    ok: boolean;
    status: CommsStatus | null;
    error: CommsErrorKind | null;
    message: string | null;
    fetchedAt: string | null;
}

/** Reset the cache — test helper only. */
export function __resetCommsCache(): void {
    cache = null;
    inflight = null;
}

/**
 * Cached/throttled status read. Returns fresh cache within CACHE_TTL_MS,
 * otherwise fetches once (concurrent callers share the in-flight promise).
 * `now` is injectable for deterministic tests.
 */
export async function getCachedCommsStatus(now: () => number = Date.now): Promise<CommsStatusResult> {
    if (cache && now() - Date.parse(cache.fetchedAt) < CACHE_TTL_MS) {
        return { ok: true, status: cache.status, error: null, message: null, fetchedAt: cache.fetchedAt };
    }
    if (!inflight) {
        inflight = getCommsProvider().getStatus().finally(() => { inflight = null; });
    }
    const result = await inflight;
    if (result.ok) {
        cache = { status: result.status, fetchedAt: new Date(now()).toISOString() };
        return { ok: true, status: result.status, error: null, message: null, fetchedAt: cache.fetchedAt };
    }
    // Keep the last good fetchedAt (if any) so the widget can show it alongside
    // the current error.
    return { ok: false, status: null, error: result.error, message: result.message, fetchedAt: cache?.fetchedAt ?? null };
}

export type {
    CommsProvider,
    CommsResult,
    CommsStatus,
    CommsConfigSummary,
    CommsErrorKind,
    CommsNet,
} from './types.js';
