// Per-user throttle for member-initiated submissions (HR applications + job
// applications). A single authenticated account could otherwise loop
// user:submit_application / user:apply_job to create unbounded rows AND fan a Web
// Push out to every recruiter + admin on each one (a storage + notification DoS).
// Keyed on the server-injected user id, so it is independent of, and additional to,
// the global per-IP limiter.
//
// In-memory, single-instance — same caveat as authRateLimit.ts / radio.ts: move to a
// shared store if the server is ever replicated, or each replica enforces its own
// limit and the effective ceiling multiplies.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const PER_MINUTE = 5;
const PER_DAY = 30;
const MAX_BUCKETS = 20_000;

interface Bucket {
    minuteCount: number;
    minuteStart: number;
    dayCount: number;
    dayStart: number;
}

const buckets = new Map<string, Bucket>();

export interface SubmissionRateLimitResult {
    ok: boolean;
    /** Seconds until the relevant window resets. 0 when ok. */
    retryAfter: number;
    scope?: 'minute' | 'day';
}

/**
 * Record a submission attempt for `userId` and decide if it may proceed. `now` is
 * injectable for tests. A missing id fails open — these actions are reached only
 * after the dispatcher injects the authenticated user, so a real caller always has
 * one, and the global limiter still caps an anonymous flood.
 */
export function checkSubmissionRateLimit(userId: number | string | undefined | null, now: number = Date.now()): SubmissionRateLimitResult {
    if (userId === undefined || userId === null || userId === '') return { ok: true, retryAfter: 0 };
    const key = String(userId);

    let b = buckets.get(key);
    if (!b) {
        if (buckets.size >= MAX_BUCKETS) return { ok: true, retryAfter: 0 }; // shed under spray; IP limiter still caps
        b = { minuteCount: 0, minuteStart: now, dayCount: 0, dayStart: now };
        buckets.set(key, b);
    }
    if (now - b.minuteStart >= MINUTE_MS) { b.minuteCount = 0; b.minuteStart = now; }
    if (now - b.dayStart >= DAY_MS) { b.dayCount = 0; b.dayStart = now; }

    if (b.dayCount >= PER_DAY) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((b.dayStart + DAY_MS - now) / 1000)), scope: 'day' };
    }
    if (b.minuteCount >= PER_MINUTE) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((b.minuteStart + MINUTE_MS - now) / 1000)), scope: 'minute' };
    }
    b.minuteCount += 1;
    b.dayCount += 1;
    return { ok: true, retryAfter: 0 };
}

/** Throwing convenience wrapper for the submission action handlers. */
export function assertSubmissionRateLimit(userId: number | string | undefined | null, now: number = Date.now()): void {
    const r = checkSubmissionRateLimit(userId, now);
    if (!r.ok) {
        const err = new Error(`Too many submissions (per ${r.scope}). Try again in ${r.retryAfter}s.`) as Error & { code?: string };
        err.code = 'SUBMISSION_RATE_LIMITED';
        throw err;
    }
}

/** Periodic cleanup of fully-expired buckets. Returns the number removed. */
export function pruneSubmissionRateLimitBuckets(now: number = Date.now()): number {
    let removed = 0;
    for (const [k, b] of buckets.entries()) {
        if (now - b.dayStart >= DAY_MS && now - b.minuteStart >= MINUTE_MS) {
            buckets.delete(k);
            removed++;
        }
    }
    return removed;
}

/** Test-only: clear all bucket state. */
export function _resetSubmissionRateLimit(): void {
    buckets.clear();
}
