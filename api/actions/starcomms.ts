// StarComms integration actions (V1: read-only status + connection test).
//
// Gated on `admin:access` via api/services.ts fullPermissionMap (both actions).
// The owner API key lives ONLY in process.env (see lib/comms/starcomms.ts) and
// never appears in any value returned here — responses carry a secret-free
// config summary plus the normalized status, or a typed error.

import { describeCommsConfig, getCommsProvider } from '../../lib/comms/index.js';

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
    'admin:starcomms_test': async () => {
        const config = describeCommsConfig();
        const result = await getCommsProvider().getStatus();
        return result.ok
            ? { config, ok: true, status: result.status, error: null }
            : { config, ok: false, status: null, error: { kind: result.error, message: result.message } };
    },
};
