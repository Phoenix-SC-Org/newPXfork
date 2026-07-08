// =============================================================================
// StarComms provider — first implementation of the CommsProvider interface.
// Calls GET {STARCOMMS_BASE_URL}/api/v1/status with an owner Bearer token.
//
// Security: STARCOMMS_OWNER_API_KEY is read from the environment on each call
// and only ever placed in the outgoing Authorization header. It is never
// logged and never included in any returned value (redact() is a belt-and-
// suspenders guard on outgoing messages).
// =============================================================================

import { log as baseLog } from '../log.js';
import type { CommsConfigSummary, CommsNet, CommsProvider, CommsResult, CommsStatus } from './types.js';

const log = baseLog.child({ module: 'comms.starcomms' });

const DEFAULT_TIMEOUT_MS = 5000;
const STATUS_PATH = '/api/v1/status';

function readEnabled(): boolean {
    const v = (process.env.STARCOMMS_ENABLED || '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function readBaseUrl(): string | null {
    const v = (process.env.STARCOMMS_BASE_URL || '').trim();
    return v ? v.replace(/\/+$/, '') : null; // strip trailing slash(es)
}

function readApiKey(): string | null {
    const v = (process.env.STARCOMMS_OWNER_API_KEY || '').trim();
    return v || null;
}

function readTimeoutMs(): number {
    const raw = process.env.STARCOMMS_TIMEOUT_MS;
    if (!raw) return DEFAULT_TIMEOUT_MS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** Replace any occurrence of the API key in a string with a redaction marker.
 *  Messages we build never contain the key, but this makes that guarantee
 *  explicit for anything derived from upstream errors. */
export function redact(s: string): string {
    const key = process.env.STARCOMMS_OWNER_API_KEY;
    if (key && key.length > 0 && s.includes(key)) return s.split(key).join('***REDACTED***');
    return s;
}

// --- Lenient coercion of the (unversioned/loosely-specced) status body -------

function asStr(v: unknown): string | null {
    return typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : null);
}
function asNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}
function asBool(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
}
function asObj(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function coerceNets(v: unknown): CommsNet[] {
    if (!Array.isArray(v)) return [];
    return v.map((raw) => {
        const o = asObj(raw);
        return { ...o, id: asStr(o.id), name: asStr(o.name) };
    });
}

function coerceFeatures(v: unknown): Record<string, boolean> {
    const o = asObj(v);
    const out: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(o)) {
        const b = asBool(val);
        if (b !== null) out[k] = b;
    }
    return out;
}

// The V2.1 operational-awareness UI surfaces four well-known StarComms feature
// flags by canonical name. They may arrive either top-level, nested under
// `features`, or (for publicNet/orgLink) inside their own object — so we look in
// every plausible spot and merge the resolved value under a stable key. Absent
// flags are simply not added (kept compact; no false "disabled"). This stays a
// pure boolean map — no secret material can enter here.
function enrichKnownFeatures(body: Record<string, unknown>, features: Record<string, boolean>): Record<string, boolean> {
    const out = { ...features };
    const f = asObj(body.features);
    const set = (key: string, v: boolean | null) => { if (v !== null) out[key] = v; };
    set('globalPttEnabled', asBool(body.globalPttEnabled) ?? asBool(f.globalPttEnabled));
    set('acarsEnabled', asBool(body.acarsEnabled) ?? asBool(f.acarsEnabled));
    set('publicNet.enabled', asBool(asObj(body.publicNet).enabled) ?? asBool(f['publicNet.enabled']));
    set('orgLink.enabled', asBool(asObj(body.orgLink).enabled) ?? asBool(f['orgLink.enabled']));
    return out;
}

function coerceStatus(body: Record<string, unknown>): CommsStatus {
    const guild = asObj(body.guild);
    const shard = asObj(body.shard);
    const operators = asObj(body.operators);
    const operation = asObj(body.operation);
    return {
        guildId: asStr(body.guildId) ?? asStr(guild.id),
        guildName: asStr(body.guildName) ?? asStr(guild.name),
        shard: {
            publicUrl: asStr(shard.publicUrl) ?? asStr(body.publicUrl),
            version: asStr(shard.version) ?? asStr(body.version),
        },
        connectedOperators: asNum(body.connectedOperators) ?? asNum(operators.connected),
        operationOpen: asBool(body.operationOpen) ?? asBool(operation.open),
        nets: coerceNets(body.nets),
        features: enrichKnownFeatures(body, coerceFeatures(body.features)),
    };
}

export class StarCommsProvider implements CommsProvider {
    readonly name = 'starcomms';

    describeConfig(): CommsConfigSummary {
        const enabled = readEnabled();
        const baseUrl = readBaseUrl();
        const hasKey = !!readApiKey();
        return {
            provider: this.name,
            enabled,
            configured: enabled && !!baseUrl && hasKey,
            baseUrl, // shard URL is not secret; the key is never included
            timeoutMs: readTimeoutMs(),
        };
    }

    async getStatus(): Promise<CommsResult> {
        if (!readEnabled()) {
            return { ok: false, error: 'disabled', message: 'StarComms integration is disabled.' };
        }
        const baseUrl = readBaseUrl();
        if (!baseUrl) {
            return { ok: false, error: 'missing_base_url', message: 'STARCOMMS_BASE_URL is not set.' };
        }
        const key = readApiKey();
        if (!key) {
            return { ok: false, error: 'missing_api_key', message: 'STARCOMMS_OWNER_API_KEY is not set.' };
        }

        const timeoutMs = readTimeoutMs();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(`${baseUrl}${STATUS_PATH}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
                signal: controller.signal,
            });
        } catch (e) {
            const name = (e as { name?: string })?.name;
            if (name === 'AbortError') {
                log.warn('starcomms status timeout', { timeoutMs });
                return { ok: false, error: 'timeout', message: `StarComms request timed out after ${timeoutMs}ms.` };
            }
            log.warn('starcomms status network error', { err: redact(String((e as { message?: string })?.message || e)) });
            return { ok: false, error: 'network', message: 'Could not reach the StarComms shard.' };
        } finally {
            clearTimeout(timer);
        }

        if (res.status === 401 || res.status === 403) {
            log.warn('starcomms status unauthorized', { status: res.status });
            return { ok: false, error: 'unauthorized', message: `StarComms rejected the API key (HTTP ${res.status}).` };
        }
        if (!res.ok) {
            log.warn('starcomms status http error', { status: res.status });
            return { ok: false, error: 'network', message: `StarComms returned HTTP ${res.status}.` };
        }

        let body: unknown;
        try {
            body = await res.json();
        } catch {
            return { ok: false, error: 'malformed', message: 'StarComms returned a non-JSON response.' };
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return { ok: false, error: 'malformed', message: 'StarComms returned an unexpected response shape.' };
        }
        return { ok: true, status: coerceStatus(body as Record<string, unknown>) };
    }
}
