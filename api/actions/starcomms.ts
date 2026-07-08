// StarComms integration actions (V1: read-only status + connection test).
//
// Gated on `admin:access` via api/services.ts fullPermissionMap (both actions).
// The owner API key lives ONLY in process.env (see lib/comms/starcomms.ts) and
// never appears in any value returned here — responses carry a secret-free
// config summary plus the normalized status, or a typed error.

import { describeCommsConfig, getCachedCommsStatus, getCommsProvider } from '../../lib/comms/index.js';

export const starcommsActions = {
    // Read: config summary, plus live status when enabled AND configured.
    // When disabled/unconfigured we return the summary with a null status
    // instead of attempting (and reporting) a doomed fetch.
    'admin:starcomms_status': async () => {
        const config = describeCommsConfig();
        if (!config.enabled || !config.configured) {
            return { config, status: null, error: null };
        }
        const result = await getCommsProvider().getStatus();
        return result.ok
            ? { config, status: result.status, error: null }
            : { config, status: null, error: { kind: result.error, message: result.message } };
    },

    // Test: force a live fetch regardless of state and report the outcome.
    // Bypasses the cache on purpose (V1 admin probe).
    'admin:starcomms_test': async () => {
        const config = describeCommsConfig();
        const result = await getCommsProvider().getStatus();
        return result.ok
            ? { config, ok: true, status: result.status, error: null }
            : { config, ok: false, status: null, error: { kind: result.error, message: result.message } };
    },

    // Manual write (V3): open the StarComms operation. Admin-only, gated on
    // `admin:access` in api/services.ts. Non-destructive (toggles the open flag).
    // The provider validates enabled/base-url/api-key and returns a typed,
    // secret-free result — the owner key never appears in this response.
    'admin:starcomms_open': async () => {
        const config = describeCommsConfig();
        const result = await getCommsProvider().setOperationOpen(true);
        return result.ok
            ? { config, ok: true, error: null }
            : { config, ok: false, error: { kind: result.error, message: result.message } };
    },

    // Manual write (V3): close the StarComms operation. Same gate/guarantees.
    'admin:starcomms_close': async () => {
        const config = describeCommsConfig();
        const result = await getCommsProvider().setOperationOpen(false);
        return result.ok
            ? { config, ok: true, error: null }
            : { config, ok: false, error: { kind: result.error, message: result.message } };
    },

    // Operational widget read (V2). CACHED/throttled — safe for many
    // dispatch/ops users mounting the widget concurrently. Gated in
    // api/services.ts on operations:view OR request:dispatch OR admin:access.
    // Returns a secret-free config summary + normalized status + last-good
    // fetchedAt. Never triggers a fetch when disabled/unconfigured.
    'operation:starcomms_status': async () => {
        const config = describeCommsConfig();
        if (!config.enabled || !config.configured) {
            return { config, status: null, error: null, fetchedAt: null };
        }
        const r = await getCachedCommsStatus();
        return r.ok
            ? { config, status: r.status, error: null, fetchedAt: r.fetchedAt }
            : { config, status: null, error: { kind: r.error, message: r.message }, fetchedAt: r.fetchedAt };
    },
};
