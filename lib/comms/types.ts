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

export interface CommsProvider {
    readonly name: string;
    /** Non-secret config summary (env presence only, never values). */
    describeConfig(): CommsConfigSummary;
    /** Fetch live status. Resolves to a typed result; never throws for the
     *  expected disabled/misconfig/network/timeout/malformed cases. */
    getStatus(): Promise<CommsResult>;
}
