// StarComms integration actions (V1: read-only status + connection test).
//
// Gated on `admin:access` via api/services.ts fullPermissionMap (both actions).
// The owner API key lives ONLY in process.env (see lib/comms/starcomms.ts) and
// never appears in any value returned here — responses carry a secret-free
// config summary plus the normalized status, or a typed error.

import { describeCommsConfig, getCachedCommsStatus, getCommsProvider } from '../../lib/comms/index.js';
import { NET_PRESETS, getNetPreset, buildNetPresetPreview } from '../../lib/comms/netPresets.js';

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

    // Net Presets (V4) — read-only catalog. The presets are code-defined
    // (lib/comms/netPresets.ts) and secret-free; returning them keeps a single
    // source of truth so the admin UI never duplicates preset definitions.
    'admin:starcomms_list_net_presets': async () => {
        return { presets: NET_PRESETS };
    },

    // Net Presets (V4) — Preview (Step 3). READ-ONLY: fetches current status and
    // diffs the chosen preset's desired nets against the existing nets. Never
    // calls a write endpoint and never creates/deletes/renames anything. Gated on
    // admin:access in api/services.ts. Secret-free (no key in any field).
    'admin:starcomms_preview_net_preset': async (payload: { presetId?: string }) => {
        const config = describeCommsConfig();
        const preset = getNetPreset(payload?.presetId ?? '');
        if (!preset) {
            return { config, ok: false, error: { kind: 'unknown_preset', message: 'Unknown net preset.' }, preview: null };
        }
        if (!config.enabled) {
            return { config, ok: false, error: { kind: 'disabled', message: 'StarComms integration is disabled.' }, preview: null };
        }
        if (!config.configured) {
            return { config, ok: false, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' }, preview: null };
        }
        const result = await getCommsProvider().getStatus();
        if (!result.ok) {
            return { config, ok: false, error: { kind: result.error, message: result.message }, preview: null };
        }
        const preview = buildNetPresetPreview(preset, result.status.nets);
        return { config, ok: true, error: null, preview };
    },
};
