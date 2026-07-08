// =============================================================================
// Comms Provider layer — a small, replaceable abstraction over an external
// voice-comms backend. StarComms is the first implementation (lib/comms/
// starcomms.ts); a future official open-source StarComms (or another backend)
// can implement the same CommsProvider interface without touching callers.
//
// Design rules:
//   - Server-side ONLY. The owner API key lives in process.env and never
//     appears in any value returned from this layer (see CommsConfigSummary /
//     CommsResult — both are secret-free).
//   - Fully optional: when disabled/unconfigured, getStatus() returns a typed
//     error result instead of throwing, so the rest of the app is unaffected.
// =============================================================================

/** Discrete, non-sensitive failure kinds. Never carries secret material. */
export type CommsErrorKind =
    | 'disabled'          // integration turned off (STARCOMMS_ENABLED not true)
    | 'missing_base_url'  // STARCOMMS_BASE_URL unset
    | 'missing_api_key'   // STARCOMMS_OWNER_API_KEY unset
    | 'unauthorized'      // provider rejected the key (401/403)
    | 'timeout'           // request exceeded STARCOMMS_TIMEOUT_MS
    | 'network'           // could not reach the provider / non-OK HTTP
    | 'malformed';        // response was not the expected JSON shape

/** A single voice net/channel as reported by the provider. Loose by design —
 *  only the known display fields are typed; unknown fields are preserved. */
export interface CommsNet {
    id: string | null;
    name: string | null;
    [key: string]: unknown;
}

/** Normalized status snapshot. All fields nullable — the provider may omit any. */
export interface CommsStatus {
    guildId: string | null;
    guildName: string | null;
    shard: { publicUrl: string | null; version: string | null };
    connectedOperators: number | null;
    operationOpen: boolean | null;
    nets: CommsNet[];
    /** Provider feature flags, e.g. { push_to_talk: true }. */
    features: Record<string, boolean>;
}

/** Secret-free configuration summary safe to return to an admin client.
 *  baseUrl is the operator-set shard URL (not a secret); the API key is
 *  intentionally absent. */
export interface CommsConfigSummary {
    provider: string;
    enabled: boolean;
    configured: boolean;
    baseUrl: string | null;
    timeoutMs: number;
}

export type CommsResult =
    | { ok: true; status: CommsStatus }
    | { ok: false; error: CommsErrorKind; message: string };

/** Result of a write action. Secret-free: carries only a success flag or a typed
 *  non-sensitive error — never the API key or any request/response body. */
export type CommsWriteResult =
    | { ok: true }
    | { ok: false; error: CommsErrorKind; message: string };

/** Generic secret-free read result carrying typed data (V5). */
export type CommsDataResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: CommsErrorKind; message: string };

// --- V5 read shapes (loose by design; unknown fields preserved) -------------

/** A connected operator from GET /api/v1/roster. */
export interface CommsRosterOperator {
    userId: string | null;
    displayName: string | null;
    nets: string[];
    transport: string | null;
    transmitting: boolean | null;
    connectedSince: string | null;
    /** Only present when the key has the read:roster:roles scope. */
    roleIds?: string[];
    [key: string]: unknown;
}

/** A stored assignment from GET /api/v1/assignments. */
export interface CommsAssignment {
    userId: string | null;
    netUid: string | null;
    netName: string | null;
    [key: string]: unknown;
}

/** A role-to-net auto-assignment rule from GET /api/v1/rules. */
export interface CommsRoleNetRule {
    roleId: string | null;
    netUids: string[];
    [key: string]: unknown;
}

/** Result of creating a net (POST /api/v1/nets). */
export interface CommsCreateNetResult {
    slot: number | null;
    netUid: string | null;
    name: string | null;
}

// --- V5 write inputs (secret-free; only non-sensitive fields) ---------------

export interface CommsAssignmentAction {
    userId: string;
    netUid: string;
    action: 'assign' | 'unassign';
}

export interface CommsRoleNetRuleInput {
    roleId: string;
    netUids: string[];
}

export interface CommsProvider {
    readonly name: string;
    /** Non-secret config summary (env presence only, never values). */
    describeConfig(): CommsConfigSummary;
    /** Fetch live status. Resolves to a typed result; never throws for the
     *  expected disabled/misconfig/network/timeout/malformed cases. */
    getStatus(): Promise<CommsResult>;
    /** Manual write (V3): open (`true`) or close (`false`) the StarComms
     *  operation. Server-only. Resolves to a typed, secret-free result; never
     *  throws for the expected disabled/misconfig/unauthorized/timeout/network
     *  cases. Non-destructive: it only toggles the operation-open flag. */
    setOperationOpen(open: boolean): Promise<CommsWriteResult>;

    // --- V5: roster / assignments / role-net rules (reads) ------------------
    /** GET /api/v1/roster — connected operators (scope read:roster). */
    getRoster(): Promise<CommsDataResult<CommsRosterOperator[]>>;
    /** GET /api/v1/assignments — stored assignment map (scope read:assignments). */
    getAssignments(): Promise<CommsDataResult<CommsAssignment[]>>;
    /** GET /api/v1/rules — role-to-net auto rules (scope read:assignments). */
    getRoleNetRules(): Promise<CommsDataResult<CommsRoleNetRule[]>>;

    // --- V5: assignments (writes; scope write:assignments) ------------------
    /** POST /api/v1/assignments { action: 'assign' }. Non-destructive. */
    assignUserToNet(userId: string, netUid: string): Promise<CommsWriteResult>;
    /** POST /api/v1/assignments { action: 'unassign' } — removal; only on explicit confirm. */
    unassignUserFromNet(userId: string, netUid: string): Promise<CommsWriteResult>;
    /** POST /api/v1/assignments/bulk — up to 200 per-item assign/unassign actions. */
    bulkApplyAssignments(actions: CommsAssignmentAction[]): Promise<CommsWriteResult>;

    // --- V5: role-to-net rules (write; scope write:rules) -------------------
    /** POST /api/v1/rules — REPLACES the whole rule set. Preview + confirm required. */
    replaceRoleNetRules(rules: CommsRoleNetRuleInput[]): Promise<CommsWriteResult>;

    // --- V4 apply repair: create a net (scope write:nets) -------------------
    /** POST /api/v1/nets { name } — creates a net; returns slot + persistent uid. */
    createNet(name: string): Promise<CommsDataResult<CommsCreateNetResult>>;
}
