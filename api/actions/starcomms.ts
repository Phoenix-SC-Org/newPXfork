// StarComms integration actions (V1: read-only status + connection test).
//
// Gated on `admin:access` via api/services.ts fullPermissionMap (both actions).
// The owner API key lives ONLY in process.env (see lib/comms/starcomms.ts) and
// never appears in any value returned here — responses carry a secret-free
// config summary plus the normalized status, or a typed error.

import { describeCommsConfig, getCachedCommsStatus, getCommsProvider } from '../../lib/comms/index.js';
import type { CommsAssignmentAction, CommsRoleNetRuleInput } from '../../lib/comms/index.js';
import { NET_PRESETS, getNetPreset, buildNetPresetPreview } from '../../lib/comms/netPresets.js';
import { readSyncConfig, computeSyncSuggestions } from '../../lib/comms/syncPlanner.js';
import { buildRoleNetRulesPreview, buildAssignmentsPreview } from '../../lib/comms/v5Planner.js';

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

    // Sync Planner (V6) — READ-ONLY. Returns the (all-default-OFF) sync flags plus
    // the SUGGESTED actions computed from current status + the caller-supplied
    // myRSI operation-active signal. Never writes; execution of a suggestion is a
    // separate explicit click that reuses the V3 open/close actions. Gated on
    // admin:access. Secret-free. `operationActive` is passed in so the comms layer
    // stays decoupled from the operations DB.
    'admin:starcomms_sync_plan': async (payload: { operationActive?: boolean }) => {
        const config = describeCommsConfig();
        const sync = readSyncConfig();
        if (!config.enabled || !config.configured) {
            return { config, sync, status: null, suggestions: [], error: null };
        }
        const result = await getCommsProvider().getStatus();
        if (!result.ok) {
            return { config, sync, status: null, suggestions: [], error: { kind: result.error, message: result.message } };
        }
        const suggestions = computeSyncSuggestions(sync, result.status, !!payload?.operationActive);
        return { config, sync, status: result.status, suggestions, error: null };
    },

    // --- V4 apply repair -----------------------------------------------------
    // Creates the MISSING nets of a preset (POST /api/v1/nets). Never deletes or
    // renames. Re-derives the missing set from live status (authoritative), so a
    // duplicate click is safe (already-existing nets are skipped). admin:access.
    'admin:starcomms_apply_net_preset': async (payload: { presetId?: string }) => {
        const config = describeCommsConfig();
        const preset = getNetPreset(payload?.presetId ?? '');
        const base = { config, created: 0, skipped: 0, errors: [] as { name: string; message: string }[] };
        if (!preset) return { ...base, ok: false, error: { kind: 'unknown_preset', message: 'Unknown net preset.' } };
        if (!config.enabled) return { ...base, ok: false, error: { kind: 'disabled', message: 'StarComms integration is disabled.' } };
        if (!config.configured) return { ...base, ok: false, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' } };
        const provider = getCommsProvider();
        const statusRes = await provider.getStatus();
        if (!statusRes.ok) return { ...base, ok: false, error: { kind: statusRes.error, message: statusRes.message } };
        const preview = buildNetPresetPreview(preset, statusRes.status.nets);
        let created = 0;
        const errors: { name: string; message: string }[] = [];
        for (const net of preview.toCreate) {
            const r = await provider.createNet(net.name);
            if (r.ok) created++;
            else errors.push({ name: net.name, message: r.message });
        }
        return { config, ok: errors.length === 0, created, skipped: preview.existing.length, errors, error: null };
    },

    // --- V5 combined read for the admin UI -----------------------------------
    // Fetches roster + assignments + rules (+ status) in parallel. Per-section
    // errors are surfaced (e.g. 'unauthorized' → missing scope) so the UI can
    // show "missing scope" warnings. READ-ONLY. Secret-free. admin:access.
    'admin:starcomms_v5_state': async () => {
        const config = describeCommsConfig();
        if (!config.enabled || !config.configured) {
            return { config, status: null, roster: null, assignments: null, rules: null, errors: {} };
        }
        const provider = getCommsProvider();
        const [statusRes, rosterRes, assignRes, rulesRes] = await Promise.all([
            provider.getStatus(), provider.getRoster(), provider.getAssignments(), provider.getRoleNetRules(),
        ]);
        return {
            config,
            status: statusRes.ok ? statusRes.status : null,
            roster: rosterRes.ok ? rosterRes.data : null,
            assignments: assignRes.ok ? assignRes.data : null,
            rules: rulesRes.ok ? rulesRes.data : null,
            errors: {
                status: statusRes.ok ? null : { kind: statusRes.error, message: statusRes.message },
                roster: rosterRes.ok ? null : { kind: rosterRes.error, message: rosterRes.message },
                assignments: assignRes.ok ? null : { kind: assignRes.error, message: assignRes.message },
                rules: rulesRes.ok ? null : { kind: rulesRes.error, message: rulesRes.message },
            },
        };
    },

    // --- V5 role-to-net rules: preview (READ-ONLY) + apply (REPLACES) --------
    'admin:starcomms_preview_role_net_rules': async (payload: { rules?: CommsRoleNetRuleInput[] }) => {
        const config = describeCommsConfig();
        const desired = Array.isArray(payload?.rules) ? payload.rules : [];
        if (!config.enabled) return { config, ok: false, error: { kind: 'disabled', message: 'StarComms integration is disabled.' }, preview: null };
        if (!config.configured) return { config, ok: false, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' }, preview: null };
        const provider = getCommsProvider();
        const [rulesRes, statusRes] = await Promise.all([provider.getRoleNetRules(), provider.getStatus()]);
        if (!rulesRes.ok) return { config, ok: false, error: { kind: rulesRes.error, message: rulesRes.message }, preview: null };
        const nets = statusRes.ok ? statusRes.status.nets : [];
        return { config, ok: true, error: null, preview: buildRoleNetRulesPreview(desired, rulesRes.data, nets) };
    },

    'admin:starcomms_apply_role_net_rules': async (payload: { rules?: CommsRoleNetRuleInput[]; confirm?: boolean }) => {
        const config = describeCommsConfig();
        if (payload?.confirm !== true) return { config, ok: false, error: { kind: 'not_confirmed', message: 'Explicit confirmation is required to replace the rule set.' } };
        if (!config.enabled) return { config, ok: false, error: { kind: 'disabled', message: 'StarComms integration is disabled.' } };
        if (!config.configured) return { config, ok: false, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' } };
        const rules = Array.isArray(payload?.rules) ? payload.rules : [];
        const r = await getCommsProvider().replaceRoleNetRules(rules);
        return r.ok ? { config, ok: true, error: null } : { config, ok: false, error: { kind: r.error, message: r.message } };
    },

    // --- V5 assignments: preview (READ-ONLY) + apply -------------------------
    'admin:starcomms_preview_assignments': async (payload: { actions?: CommsAssignmentAction[] }) => {
        const config = describeCommsConfig();
        const actions = Array.isArray(payload?.actions) ? payload.actions : [];
        if (!config.enabled) return { config, ok: false, error: { kind: 'disabled', message: 'StarComms integration is disabled.' }, preview: null };
        if (!config.configured) return { config, ok: false, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' }, preview: null };
        const provider = getCommsProvider();
        const [assignRes, rosterRes, statusRes] = await Promise.all([provider.getAssignments(), provider.getRoster(), provider.getStatus()]);
        if (!assignRes.ok) return { config, ok: false, error: { kind: assignRes.error, message: assignRes.message }, preview: null };
        const roster = rosterRes.ok ? rosterRes.data : [];
        const nets = statusRes.ok ? statusRes.status.nets : [];
        return { config, ok: true, error: null, preview: buildAssignmentsPreview(actions, assignRes.data, roster, nets) };
    },

    'admin:starcomms_apply_assignments': async (payload: { actions?: CommsAssignmentAction[]; confirm?: boolean }) => {
        const config = describeCommsConfig();
        if (payload?.confirm !== true) return { config, ok: false, applied: 0, error: { kind: 'not_confirmed', message: 'Explicit confirmation is required.' } };
        if (!config.enabled) return { config, ok: false, applied: 0, error: { kind: 'disabled', message: 'StarComms integration is disabled.' } };
        if (!config.configured) return { config, ok: false, applied: 0, error: { kind: 'missing_config', message: 'StarComms is not fully configured.' } };
        const actions = Array.isArray(payload?.actions) ? payload.actions : [];
        if (actions.length === 0) return { config, ok: true, applied: 0, error: null };
        const provider = getCommsProvider();
        let r;
        if (actions.length === 1) {
            const a = actions[0];
            r = a.action === 'unassign'
                ? await provider.unassignUserFromNet(a.userId, a.netUid)
                : await provider.assignUserToNet(a.userId, a.netUid);
        } else {
            r = await provider.bulkApplyAssignments(actions);
        }
        return r.ok ? { config, ok: true, applied: actions.length, error: null } : { config, ok: false, applied: 0, error: { kind: r.error, message: r.message } };
    },
};
