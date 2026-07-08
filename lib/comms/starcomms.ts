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
import type {
    CommsConfigSummary, CommsNet, CommsProvider, CommsResult, CommsStatus, CommsWriteResult,
    CommsDataResult, CommsRosterOperator, CommsAssignment, CommsRoleNetRule, CommsCreateNetResult,
    CommsAssignmentAction, CommsRoleNetRuleInput, CommsErrorKind,
} from './types.js';

const log = baseLog.child({ module: 'comms.starcomms' });

const DEFAULT_TIMEOUT_MS = 5000;
const STATUS_PATH = '/api/v1/status';
const OPERATION_PATH = '/api/v1/operation';
const ROSTER_PATH = '/api/v1/roster';
const ASSIGNMENTS_PATH = '/api/v1/assignments';
const ASSIGNMENTS_BULK_PATH = '/api/v1/assignments/bulk';
const RULES_PATH = '/api/v1/rules';
const NETS_PATH = '/api/v1/nets';
const BULK_ASSIGNMENT_LIMIT = 200;

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

// --- V5 lenient coercion -----------------------------------------------------

function asStrArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => asStr(x)).filter((x): x is string => x !== null);
}

function coerceRosterOperator(raw: unknown): CommsRosterOperator {
    const o = asObj(raw);
    const op: CommsRosterOperator = {
        ...o,
        userId: asStr(o.userId) ?? asStr(o.id),
        displayName: asStr(o.displayName) ?? asStr(o.name),
        nets: asStrArray(o.nets),
        transport: asStr(o.transport),
        transmitting: asBool(o.transmitting),
        connectedSince: asStr(o.connectedSince) ?? asStr(o.connectedAt),
    };
    const roles = asStrArray(o.roleIds ?? o.roles);
    if (roles.length > 0) op.roleIds = roles;
    return op;
}

function coerceAssignment(raw: unknown): CommsAssignment {
    const o = asObj(raw);
    return {
        ...o,
        userId: asStr(o.userId) ?? asStr(o.id),
        netUid: asStr(o.netUid) ?? asStr(o.uid),
        netName: asStr(o.netName) ?? asStr(o.name),
    };
}

function coerceRule(raw: unknown): CommsRoleNetRule {
    const o = asObj(raw);
    return { ...o, roleId: asStr(o.roleId), netUids: asStrArray(o.netUids) };
}

/** Assignments/rules responses may be an array or wrapped in a keyed object. */
function asArrayFrom(body: unknown, ...keys: string[]): unknown[] {
    if (Array.isArray(body)) return body;
    const o = asObj(body);
    for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
    return [];
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

    // --- Manual write (V3) ---------------------------------------------------
    // POST {BASE_URL}/api/v1/operation with { open: boolean }. Opening/closing is
    // non-destructive — it only toggles the operation-open flag (the shard then
    // broadcasts a config update to connected clients). The owner key is read
    // per-call and only placed in the Authorization header; the request body
    // carries no secret and the response body is intentionally NOT returned.
    async setOperationOpen(open: boolean): Promise<CommsWriteResult> {
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
            res = await fetch(`${baseUrl}${OPERATION_PATH}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({ open }),
                signal: controller.signal,
            });
        } catch (e) {
            const name = (e as { name?: string })?.name;
            if (name === 'AbortError') {
                log.warn('starcomms operation timeout', { timeoutMs, open });
                return { ok: false, error: 'timeout', message: `StarComms request timed out after ${timeoutMs}ms.` };
            }
            log.warn('starcomms operation network error', { open, err: redact(String((e as { message?: string })?.message || e)) });
            return { ok: false, error: 'network', message: 'Could not reach the StarComms shard.' };
        } finally {
            clearTimeout(timer);
        }

        if (res.status === 401 || res.status === 403) {
            log.warn('starcomms operation unauthorized', { status: res.status });
            return { ok: false, error: 'unauthorized', message: `StarComms rejected the API key (HTTP ${res.status}).` };
        }
        if (!res.ok) {
            log.warn('starcomms operation http error', { status: res.status, open });
            return { ok: false, error: 'network', message: `StarComms returned HTTP ${res.status}.` };
        }
        return { ok: true };
    }

    // --- Shared request helper (V5 + V4-apply) -------------------------------
    // Validates config, applies the timeout, sends the owner key ONLY in the
    // Authorization header, and maps failures to the typed error taxonomy. The
    // parsed JSON body (or null) is returned on 2xx; callers coerce it. The key
    // is never returned and only redacted values are logged. getStatus() and
    // setOperationOpen() keep their own copies (unchanged) to preserve V1–V3.
    private validateConfig(): { ok: true; baseUrl: string; key: string; timeoutMs: number } | { ok: false; error: CommsErrorKind; message: string } {
        if (!readEnabled()) return { ok: false, error: 'disabled', message: 'StarComms integration is disabled.' };
        const baseUrl = readBaseUrl();
        if (!baseUrl) return { ok: false, error: 'missing_base_url', message: 'STARCOMMS_BASE_URL is not set.' };
        const key = readApiKey();
        if (!key) return { ok: false, error: 'missing_api_key', message: 'STARCOMMS_OWNER_API_KEY is not set.' };
        return { ok: true, baseUrl, key, timeoutMs: readTimeoutMs() };
    }

    private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: CommsErrorKind; message: string }> {
        const v = this.validateConfig();
        if (!v.ok) return v;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), v.timeoutMs);
        let res: Response;
        try {
            res = await fetch(`${v.baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${v.key}`,
                    Accept: 'application/json',
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                signal: controller.signal,
            });
        } catch (e) {
            const name = (e as { name?: string })?.name;
            if (name === 'AbortError') {
                log.warn('starcomms request timeout', { path, timeoutMs: v.timeoutMs });
                return { ok: false, error: 'timeout', message: `StarComms request timed out after ${v.timeoutMs}ms.` };
            }
            log.warn('starcomms request network error', { path, err: redact(String((e as { message?: string })?.message || e)) });
            return { ok: false, error: 'network', message: 'Could not reach the StarComms shard.' };
        } finally {
            clearTimeout(timer);
        }
        if (res.status === 401 || res.status === 403) {
            log.warn('starcomms request unauthorized', { path, status: res.status });
            return { ok: false, error: 'unauthorized', message: `StarComms rejected the API key (HTTP ${res.status}). The key may lack the required scope.` };
        }
        if (!res.ok) {
            log.warn('starcomms request http error', { path, status: res.status });
            return { ok: false, error: 'network', message: `StarComms returned HTTP ${res.status}.` };
        }
        const json: unknown = await res.json().catch(() => null);
        return { ok: true, body: json };
    }

    // --- V5 reads ------------------------------------------------------------

    async getRoster(): Promise<CommsDataResult<CommsRosterOperator[]>> {
        const r = await this.request('GET', ROSTER_PATH);
        if (!r.ok) return r;
        const rows = asArrayFrom(r.body, 'operators', 'roster');
        return { ok: true, data: rows.map(coerceRosterOperator) };
    }

    async getAssignments(): Promise<CommsDataResult<CommsAssignment[]>> {
        const r = await this.request('GET', ASSIGNMENTS_PATH);
        if (!r.ok) return r;
        const rows = asArrayFrom(r.body, 'assignments');
        return { ok: true, data: rows.map(coerceAssignment) };
    }

    async getRoleNetRules(): Promise<CommsDataResult<CommsRoleNetRule[]>> {
        const r = await this.request('GET', RULES_PATH);
        if (!r.ok) return r;
        const rows = asArrayFrom(r.body, 'rules');
        return { ok: true, data: rows.map(coerceRule) };
    }

    // --- V5 assignment writes ------------------------------------------------

    async assignUserToNet(userId: string, netUid: string): Promise<CommsWriteResult> {
        const r = await this.request('POST', ASSIGNMENTS_PATH, { userId, netUid, action: 'assign' });
        return r.ok ? { ok: true } : r;
    }

    async unassignUserFromNet(userId: string, netUid: string): Promise<CommsWriteResult> {
        const r = await this.request('POST', ASSIGNMENTS_PATH, { userId, netUid, action: 'unassign' });
        return r.ok ? { ok: true } : r;
    }

    async bulkApplyAssignments(actions: CommsAssignmentAction[]): Promise<CommsWriteResult> {
        if (actions.length === 0) return { ok: true };
        if (actions.length > BULK_ASSIGNMENT_LIMIT) {
            return { ok: false, error: 'malformed', message: `Too many assignment actions (max ${BULK_ASSIGNMENT_LIMIT}).` };
        }
        const r = await this.request('POST', ASSIGNMENTS_BULK_PATH, { assignments: actions });
        return r.ok ? { ok: true } : r;
    }

    // --- V5 role-to-net rules (REPLACES the whole set) -----------------------

    async replaceRoleNetRules(rules: CommsRoleNetRuleInput[]): Promise<CommsWriteResult> {
        const r = await this.request('POST', RULES_PATH, { rules });
        return r.ok ? { ok: true } : r;
    }

    // --- V4 apply repair: create a net --------------------------------------

    async createNet(name: string): Promise<CommsDataResult<CommsCreateNetResult>> {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: 'malformed', message: 'Net name is required.' };
        const r = await this.request('POST', NETS_PATH, { name: trimmed });
        if (!r.ok) return r;
        const o = asObj(r.body);
        return {
            ok: true,
            data: {
                slot: asNum(o.slot),
                netUid: asStr(o.netUid) ?? asStr(o.uid),
                name: asStr(o.name) ?? trimmed,
            },
        };
    }
}
