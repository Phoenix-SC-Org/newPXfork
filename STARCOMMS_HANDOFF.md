# StarComms Integration — Handoff

This document is the source of truth for the StarComms integration on this fork.
Last verified: **2026-07-08**.

---

## StarComms V6 — optional sync: suggested actions (2026-07-08)

Optional, **opt-in** sync. Everything is OFF by default and **suggestion-only** —
nothing runs automatically, there are no background jobs, no polling, no schema
change. The planner is side-effect-free; execution of a suggestion is a separate
explicit admin click that reuses the existing V3 open/close actions.

### ⚠️ Correction to the assumed "current state"
The V6 brief listed "V5 works" and implied V4 apply works. In this repo:
- **V5 (role-to-net / assignments) does NOT exist** (Phase-1-blocked: StarComms
  exposes no rules/assignments/operator-list endpoints; `status` gives only an
  operator *count*).
- **V4 = Preview only; Apply (net creation) is deferred** (no create-net endpoint).
- The only working StarComms **write** is V3 `open`/`close`.

Consequently V6 delivers a full suggested-actions **planner for all four modes**,
but **real manual execution only for operation open/close**. Net-preset
suggestions point to the V4 Preview; role-net / assignment suggestions are
**informational only** ("not yet available"). No endpoints were guessed.

### Status
Phase 1 (planner) + Phase 2 (admin UI) complete on
`beta/starcomms-v6-optional-sync` (branched off V4 `8e4b620`). Phases 3–4
(env-gated auto/background execution) intentionally **not** built. All checks
green. Committed locally per phase; **not pushed**.

### Sync modes (independent env flags, ALL default false)
| Flag | Suggestion | Executable now? |
| :--- | :--- | :--- |
| `STARCOMMS_SYNC_OPERATION_STATE` | open when myRSI active & StarComms closed; close when open & no active op | ✅ via V3 open/close (manual confirm) |
| `STARCOMMS_SYNC_NET_PRESET` | review a net preset for the active op | ⚠️ V4 Preview only (apply deferred) |
| `STARCOMMS_SYNC_ROLE_NET_RULES` | review role-to-net mapping | ❌ informational (V5 absent) |
| `STARCOMMS_SYNC_ASSIGNMENTS` | review operator assignments | ❌ informational (V5 absent) |

### Env vars
`STARCOMMS_SYNC_OPERATION_STATE` / `_NET_PRESET` / `_ROLE_NET_RULES` /
`_ASSIGNMENTS` (all `false`), `STARCOMMS_SYNC_MODE=suggested` (only `suggested`
implemented; `auto` reserved and never acted on), `STARCOMMS_SYNC_MIN_INTERVAL_SECONDS=30`
(advisory; not a poller). Documented in `.env.example`. Read at startup.

### Architecture (planner vs executor)
- **Planner** `lib/comms/syncPlanner.ts`: `readSyncConfig()` (env flags) + pure
  `computeSyncSuggestions(sync, status, operationActive)` → typed secret-free
  suggestions. No I/O, no writes, no secrets. Fully unit-tested.
- **Read action** `admin:starcomms_sync_plan` (`admin:access`): returns flags +
  status + suggestions; fetches `GET /api/v1/status` only. `operationActive` is
  passed in by the caller so the comms layer stays decoupled from the operations DB.
- **Executor**: NOT new code — actionable suggestions reuse the V3
  `admin:starcomms_open`/`_close` actions via the shared `StarCommsOperationControls`
  (confirm dialog + refresh). No duplicated StarComms calls; provider stays replaceable.
- **UI**: a "StarComms Sync" section in the admin StarComms tab shows mode
  badges (enabled/disabled), current StarComms operation state + myRSI active,
  the suggestions, inline confirm controls for actionable ones, and a "manual
  only — nothing runs automatically" note. `operationActive` sourced from
  `useOperations()`.

### Changed files
**New:** `lib/comms/syncPlanner.ts`, `tests/starcommsSync.test.ts`.
**Modified:** `api/actions/starcomms.ts` (`admin:starcomms_sync_plan`),
`api/services.ts` (map → `admin:access`), `components/views/admin/StarCommsTab.tsx`
(Sync section + `useOperations`), `i18n/de.ts` (V6 strings), `.env.example`
(sync flags). No `schema.sql`, no new permissions, no unrelated modules.

### Tests run and results (2026-07-08)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings; fixed a `react-hooks/set-state-in-effect`
  by wrapping the plan-load in an async IIFE, matching the file's other effects)
- `npm run i18n:check` — OK (5269 keys / 5903 de entries)
- `npm run build` — success (client + server)
- `npm run test` — **1548 passed / 164 files** (+13 V6)
- Bundle grep: `process.env.STARCOMMS*` = 0, `api/v1/operation` = 0, `api/v1/status` = 0
- V6 coverage: all flags default false; planner side-effect-free/no writes;
  operation-open suggested when active+closed; operation-close when open+inactive;
  no suggestion when already aligned; role-net/assignment review-only;
  sync_plan gated admin:access; disabled → no fetch; flags-off → no suggestions;
  reads GET /status only (method GET, never a write); 401 handled; no key leak.

### Known limitations / what remains manual
- **Everything is manual** — suggestions never auto-execute; the admin clicks to
  open/close. No background jobs, no polling, no auto-apply.
- Only **operation open/close** is executable. Net-preset apply (V4) and all of
  V5 (role-net rules, assignments) do **not** exist, so those suggestions are
  review-only.
- `operationActive` in the admin sync panel comes from the client
  `OperationsContext`; if operations aren't loaded on the admin route it reads
  `false` (conservative — worst case a missing open suggestion).
- Suggestions are computed on demand (on load / after an action), not polled.

### What would be needed before true automation (V6 Phase 4 / later)
1. Explicit **auto-execute** flag(s) separate from the suggestion flags, plus a
   confirmation/guardrail design (and likely an audit trail).
2. A safe **audit/event** sink (none was invented — no schema table added). If
   persistence of sync settings or an audit log is required → **stop and ask**
   before any `schema.sql` change.
3. For net-preset / role-net / assignment automation: the missing StarComms
   **create-net / rules / assignments endpoints + scopes** (V4-apply and V5 are
   still blocked on these — do not guess).
4. A rate limiter honoring `STARCOMMS_SYNC_MIN_INTERVAL_SECONDS` if background
   execution is ever added.

---

## StarComms V4 — net presets: Preview shipped, Apply DEFERRED (2026-07-08)

Manual net presets, **split into safe steps**. Steps 2–3 (preset model +
read-only **Preview**) are implemented. Step 4 (**Apply** / actually creating
nets) is **not implemented** — it is blocked on an unconfirmed StarComms
create-net endpoint (see "API discovery" below). Nothing here writes to StarComms.

### Status
Code-complete for **Preview** on `beta/starcomms-v4-net-presets` (branched off
`1a4de98`, which includes V1–V3.1). All checks green. Not committed/pushed.
Read-only V1/V2/V2.1 + V3/V3.1 write controls untouched and passing.

### API discovery result (Step 1)
Searched the whole repo (provider, docs, `.env.example`, OpenAPI). **Only two
StarComms endpoints are known:**
- `GET /api/v1/status` — read; returns `nets: [{ id, name, … }]`. **Used by Preview.**
- `POST /api/v1/operation` `{ open }` — V3 open/close.

**Missing / required before Apply can be built (do NOT guess these):**
| Need | Endpoint | Status |
| :--- | :--- | :--- |
| Create a net | ??? method + path + body | ❌ **unknown — must be provided** |
| Update a net (optional) | ??? | ❌ unknown |
| Order nets (optional) | ??? | ❌ unknown |

### Required Owner API key scopes
- **Preview (implemented):** `read:status` (already in use).
- **Apply (deferred):** a net-management **write scope** (e.g. `write:net` /
  `manage:nets`) — exact name **to be confirmed with the create-net endpoint**.

### Endpoint contracts USED (this step)
- Preview calls **`GET {BASE_URL}/api/v1/status`** (via the existing provider
  `getStatus()`), then diffs in pure code. No write endpoint is called.

### Data model (Step 2) — code-defined, no schema
`lib/comms/netPresets.ts`: `NetPreset { id, name, description, nets: [{ name, purpose? }] }`.
Color/accent/relay are intentionally omitted (not confirmed supported by the API).
Presets: **Standard Operation** (Command, Flight, Ground, Logistics, Medical,
Intel), **Large Operation** (Command, Air Command, Ground Command, CAS,
Logistics, Rescue / Medical, Intel, Staging), **Training** (Instructor, Trainees,
Support). **No `schema.sql` change; no DB; no new permissions.**

### Preview (Step 3) — read-only
`buildNetPresetPreview(preset, existingNets)` (pure) → `{ existing, toCreate,
conflicts, unmanaged, warnings }`, matching by case-insensitive name. Always warns
that existing nets are never deleted/renamed; flags unmanaged existing nets and
in-preset duplicates.

### Permission
Reuses **`admin:access`** for both V4 actions (no schema change, no
`starcomms:manage`). UI section is admin-gated (`hasPermission('admin:access')`)
and hidden when disabled.

### Changed files
**New**
- `lib/comms/netPresets.ts` — preset catalog + pure `buildNetPresetPreview`.
- `tests/starcommsNetPresets.test.ts` — pure-diff + action tests.

**Modified**
- `api/actions/starcomms.ts` — `admin:starcomms_list_net_presets` (catalog),
  `admin:starcomms_preview_net_preset` (read-only diff; validates
  enabled/configured/preset; secret-free).
- `api/services.ts` — two `fullPermissionMap` entries → `admin:access`.
- `components/views/admin/StarCommsTab.tsx` — "Net Presets" section: preset
  select → **Preview changes** → diff display (would-create / already-exist /
  warnings). **Apply button is present but locked** with a "pending create-net
  endpoint" hint. Disabled when disabled/misconfigured/status-unavailable/
  non-admin/preview-pending.
- `i18n/de.ts` — V4 German strings (preset names + preview UI).
- `scripts/i18n-check.mjs` — preset display names added to `DYNAMIC_KEYS`
  (resolved via `t(p.name)`).

### Tests run and results (2026-07-08)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — OK (5254 keys / 5888 de entries)
- `npm run build` — success (client + server)
- `npm run test` — **1535 passed / 163 files** (StarComms 69; +11 V4)
- Bundle grep: `process.env.STARCOMMS*` = 0, `api/v1/operation` = 0, `api/v1/status` = 0
- V4 coverage: pure diff (existing/missing/case-insensitive/unmanaged/no-delete
  warning/blank-name ignore); actions gated admin:access; list returns catalog;
  preview blocked (no fetch) when disabled / missing-config / unknown-preset;
  **preview reads GET /status only (method GET) — never a write endpoint**;
  preview detects existing+missing; 401 handled; no key leak.

### Known limitations
- **Apply not implemented** — net creation is deferred until the create-net
  endpoint + scope are confirmed. The UI shows the preview and a locked Apply
  button; no write is possible.
- **Preview is uncached** (`getStatus()` direct) — accurate but one shard call
  per Preview click. The V2/V2.1 read cache is unchanged.
- **Name-based matching** — existing-vs-desired is compared by case-insensitive
  name (StarComms net `id`s aren't preset-stable). A rename on the shard would
  read as "missing" until re-matched.
- Presets are **code-defined** (edit `lib/comms/netPresets.ts` + redeploy); no
  admin-console editing. Inherits all V3 caveats (env-only config, no WAF, etc.).

### Next steps
- **V4-Apply** (blocked): once you provide the create-net contract (method, path,
  body, success/409 semantics) + scope, add `provider.createNet()` + an
  `admin:starcomms_apply_net_preset` action that **creates missing nets only**
  (never delete/rename), refreshes status, returns `{ created, skipped, warnings,
  errors }`, redacts secrets — plus the apply-path tests already listed in the V4
  spec (apply creates only missing, doesn't delete, 401/timeout safe).
- **V4.1** — optional net ordering / purpose/color fields **iff** the API
  confirms support.
- **V4.2** — dedicated `starcomms:manage` permission (schema change + reseed) to
  replace `admin:access` reuse, once net management is proven in beta.

---

## StarComms V3.1 — operational open/close controls (2026-07-08)

Surfaces the existing V3 manual open/close controls inside the Operations/Dispatch
StarComms widget (previously admin-panel only), **reusing the V3 backend actions
and gate**. No new backend, no new permission, no auto-sync, no schema change.

### Status
Code-complete on `beta/starcomms-v3-1-ops-controls`. All checks green (below).
Not yet committed/pushed. Admin panel V3 controls and read-only V1/V2/V2.1 intact.

### What changed
The manual controls were extracted into a **shared component** used by both the
admin tab and the widget, so the gating/confirm/write/refresh logic lives in one
place (no duplication).

**New**
- `components/shared/StarCommsOperationControls.tsx` — pure
  `StarCommsOperationControlsView` (prop-driven, testable) + a container that
  wires the admin gate + confirm dialog + existing V3 actions + refresh. Renders
  **nothing** unless the viewer has `admin:access` and the integration is enabled.
  A `compact` prop switches between the widget's button row and the admin card.

**Modified**
- `components/shared/StarCommsStatusWidget.tsx` — the pure view gained an optional
  `controls` slot; the container injects `<StarCommsOperationControls compact>`
  with `enabled`/`configured`/`operationOpen`/`statusAvailable`/`onRefresh`. The
  widget already shows current operation state, last-refresh, and the V2.1
  warnings/hints — the controls sit beneath them.
- `components/views/admin/StarCommsTab.tsx` — replaced its inline V3 write card
  with the shared `<StarCommsOperationControls>` (removed the duplicated
  `doWrite`/`writing`/`canManage` logic and now-unused imports).
- `i18n/de.ts` — one new string (`"Admin only — no auto-sync"`); all other V3
  strings reused.
- `tests/starcommsControls.test.tsx` (new) — pure-view + container tests.

### Permission behavior
- **Backend unchanged** — writes still dispatch to `admin:starcomms_open` /
  `admin:starcomms_close`, gated on **`admin:access`** in `fullPermissionMap`.
- **Client-side visibility** — the buttons render only when
  `useAuth().hasPermission('admin:access')` is true. Normal Operations/Dispatch
  users (who can *read* the widget via `operations:view` / `request:dispatch`)
  see the read-only status **without** any controls. A non-admin who forged the
  call still gets a 403 server-side. No backend permission was weakened; no
  `starcomms:manage` added.

### Button states (widget & admin, shared logic)
Hidden when not admin **or** `STARCOMMS_ENABLED=false`. Disabled when: not
configured; status unavailable; a write is in flight (spinner); or the current
`operationOpen` already matches the requested action (Open disabled while open,
Close disabled while closed). Confirmation dialog before every write; status
refreshes on success; failures show a non-blocking toast.

### Tests run and results (2026-07-08)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — OK (5239 keys / 5871 de entries)
- `npm run build` — success (client + server)
- `npm run test` — **1524 passed / 162 files** (StarComms 58; +12 V3.1)
- Bundle grep: `process.env.STARCOMMS*` = 0, `api/v1/operation` = 0, `api/v1/status` = 0
- V3.1 coverage: non-admin → no controls; disabled → no controls; Open disabled
  when already open; Close disabled when already closed; both disabled when status
  unavailable / write in flight; confirm required (dismiss → no backend call);
  success → `admin:starcomms_open`/`close` called + status refreshed; failure →
  toast, no refresh.

### Known limitations
- **Admin-gated visibility only** — a non-admin Operations user never sees the
  buttons (by design). No "read-only admins can view but not act" tier.
- **Compact widget variant** shows just the button row + a "manual, no auto-sync"
  label; the current state/last-refresh come from the widget's own grid (not
  duplicated in the control block).
- Inherits all V3 limitations: manual only, no auto-sync/background jobs,
  non-destructive, `admin:access` gate (no `starcomms:manage`), per-process 15s
  cache, env-only config, loose schema, no WAF handling.

### Suggested next steps
- **V3.2** — if/when a dedicated `starcomms:manage` permission is introduced
  (schema change + reseed), swap the `admin:access` checks (UI `hasPermission` +
  backend map) to it in one place each.
- **V3.2** — richer confirm copy that reuses the V2.1 awareness (e.g. warn when
  closing StarComms while a myRSI operation is still active).
- **V3.2** — optional inline error text in the widget (in addition to the toast)
  for operators who miss the transient toast.

---

## Production readiness — V3 (2026-07-08): PASS

Production-readiness pass over the full StarComms integration (V1 → V3). **No new
features added.** All verification checks pass; the integration is safe to run in
production with the owner key scoped to `read:status` + `write:operation`.

### Final branch
`beta/starcomms-v3-manual-actions` @ `b8160b4` (V3 committed + pushed; V3 verified
working in beta). This doc update is the only pending working-tree change.

### Gate results
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — OK (5238 keys / 5870 de entries; **no missing V3 strings**)
- `npm run build` — success (client + server)
- `npm run test` — **1512 passed / 161 files** (StarComms 46; V1/V2/V2.1 read-only
  + upstream academy/notifications/feature-gate suites all green)
- Bundle leak audit (post-build `dist/assets`): `process.env.STARCOMMS*` = 0,
  `api/v1/operation` = 0, `api/v1/status` = 0, `STARCOMMS_OWNER_API_KEY` = 2
  (env-var **name** in the EN+DE admin help sentence only — never the value).

### Verified behaviours
| Check | Status | Where enforced |
| :--- | :--- | :--- |
| Owner key never in frontend/UI/logs/API/snapshots/bundle | ✅ | key read only in `lib/comms/starcomms.ts` → `Authorization` header; `redact()` on errors; actions return secret-free `{config, ok, error}`; bundle grep clean |
| `STARCOMMS_ENABLED=false` disables all StarComms | ✅ | `readEnabled()` gates `getStatus()` **and** `setOperationOpen()` (typed `disabled`, no fetch); widget + admin write section hidden |
| Missing `STARCOMMS_BASE_URL` handled | ✅ | typed `missing_base_url`, no fetch |
| Missing `STARCOMMS_OWNER_API_KEY` handled | ✅ | typed `missing_api_key`, no fetch |
| Invalid / 401 key handled | ✅ | typed `unauthorized` (read + write) |
| Timeout doesn't block app loading | ✅ | per-call `AbortController`; widget async, renders error, never throws |
| Manual open/close require confirmation | ✅ | `confirm()` in `StarCommsTab.doWrite` |
| Manual open/close admin-only | ✅ | `hasPermission('admin:access')` (UI) + `fullPermissionMap` `admin:access` (server) |
| Buttons disabled when state already matches | ✅ | `canOpen` ⇐ `operationOpen===false`; `canClose` ⇐ `===true` |
| Status refreshes after open/close | ✅ | `loadStatus()` on success |
| V1/V2/V2.1 read-only views still work | ✅ | existing suites pass |
| Upstream merged features still work | ✅ | 1512-test suite green |
| German complete for all V3 UI strings | ✅ | `i18n:check` OK (no missing) |

### Final env vars (myRSI beta/prod)
| Variable | Required | Default | Notes |
| :--- | :--- | :--- | :--- |
| `STARCOMMS_ENABLED` | to enable | (off) | `true`/`1`/`yes`/`on` = on; anything else/unset = off |
| `STARCOMMS_BASE_URL` | when enabled | — | shard base; client calls `{BASE_URL}/api/v1/status` (read) and `POST {BASE_URL}/api/v1/operation` (write) |
| `STARCOMMS_OWNER_API_KEY` | when enabled | — | **owner secret**, server-only, `Authorization: Bearer …` only. **Scope: `read:status` + `write:operation`** (write scope is new for V3 open/close) |
| `STARCOMMS_TIMEOUT_MS` | no | `5000` | per-request timeout (ms) |

Set as **runtime** env in Coolify (not build vars); env is read at startup, so a
change needs a container restart/redeploy.

### Manual rollout checklist (beta → prod)
1. Ensure the StarComms owner key includes **`write:operation`** scope (else
   open/close return a safe `unauthorized` toast; reads still work).
2. Set/confirm the four `STARCOMMS_*` runtime env vars; restart the container.
3. Open **Admin → Integrations → StarComms** → **Test Connection** → expect a live
   status (guild, shard version, operators, `operationOpen`, nets, flags).
4. Confirm the **Manual operation control** card is visible (admin, enabled,
   configured) and shows the current operation state + last-refresh time.
5. Click **Open**/​**Close** → confirm the dialog → verify the toast and that the
   status refreshes to the new `operationOpen`, and the now-matching button
   disables.
6. Verify the **Operations Center** and **Dispatch Console** read-only widgets
   render (V2/V2.1) with the correct awareness warnings.
7. Confirm a **non-admin** never sees the write buttons and the
   `admin:starcomms_open`/`close` actions return 403 for them.
8. (No schema step) V3 added **no** schema changes — `schema.sql` re-run / Repair
   Database are **not** required for this rollout. (They were only needed for the
   earlier upstream c27b797 merge.)

### Rollback steps
- **Fastest (disable, no redeploy of code):** set `STARCOMMS_ENABLED=false` in
  Coolify and restart — the entire integration (read + write) goes inert; the app
  behaves as if StarComms never existed. No data is affected.
- **Disable writes only:** remove the `write:operation` scope from the owner key
  (rotate to a read-only key). Open/close then fail safely (`unauthorized`);
  V1/V2/V2.1 reads continue.
- **Revert the code:** V3 is isolated to commit `b8160b4`. `git revert b8160b4`
  (or redeploy the prior commit `28f9e96`) removes the write actions/buttons; V1/
  V2/V2.1 remain intact. No schema/migration to unwind.
- If the owner key is ever exposed: **rotate it** in Coolify and restart.

### Known limitations (production)
- **Manual only** — admin clicks open/close; **no** auto-sync, background jobs,
  net creation, assignment/role sync, or destructive actions.
- **Admin panel only** — write buttons live in the admin tab; Operations/Dispatch
  widgets stay read-only.
- **`admin:access` gate** (not a dedicated `starcomms:manage`) — intentional; a
  per-feature perm is a deferred `schema.sql` change.
- **No optimistic UI / no 409 distinction** — a redundant open/close (already
  disabled in UI) would surface as a generic error toast if the shard rejects it.
- **Per-process 15s status cache**; **env-only config** (restart to change);
  **loose response schema** (tighten in `coerceStatus`); **no WAF handling**.

---

## Pre-V3 status snapshot (2026-07-08) — read this first

Consolidated status at the point of starting **V3 (manual write actions)**.
Details for each area are in the dedicated sections below.

### Current branch
`beta/starcomms-v3-manual-actions` (created off the merged V2.1 line). Working
tree clean. Recent history (newest first):
- `b8cac73` update + translationv2 — Academy German translation (rest)
- `8ca582b` update + translation — Academy German translation (part)
- `001cef7` Complete StarComms V2.1 awareness integration 334 — resolved-merge fix
- `c27b797` v15.4.1-open — upstream catch-up (ancestor)

No push of V3 work yet. Nothing is committed on this branch beyond what it
inherited; V3 code has **not** started (this doc update precedes it).

### Upstream c27b797 merge — DONE & stable
Upstream `c27b797` (v15.4.1-open: notifications, Academy LMS, native uploads, org
accent/theme, feature-gate hardening, schema changes) is fully merged. 21 files /
36 conflict regions resolved by combining upstream with our fork. StarComms
V1/V2/V2.1 fully preserved. `lib/supabaseServer.ts` intentionally kept our
plain-fetch version (upstream's custom undici Agent breaks Supabase on our
runtime). See "Upstream merge — c27b797" below.

### StarComms V1 / V2 / V2.1 — all shipped, read-only
- **V1** — admin panel (Admin → Integrations → StarComms): config summary +
  Test Connection + live status. Gate: `admin:access`.
- **V2** — cached operational widget in Operations Center + Dispatch Console
  (`operation:starcomms_status`, 15s TTL). Gate: `operations:view` OR
  `request:dispatch` OR `admin:access` via `isStarCommsReader`.
- **V2.1** — contextual read-only awareness (warnings/hints correlating myRSI
  operation state vs StarComms `operationOpen`, operators, nets, feature flags,
  staleness); derived frontend-side; four known feature flags normalized in
  `coerceStatus`.
- **All three remain strictly read-only.** No writes exist yet.

### Beta deployment — LIVE
Deployed and running on beta (Coolify). The earlier failed redeploy was a stale
commit (`89ef51e`) still carrying conflict markers; the resolved commit
(`001cef7`) builds clean and is live. After schema changes, `schema.sql` must be
re-run on beta Supabase followed by **Repair Database** (see merge section).

### Translation (EN/DE) — Academy DONE
Upstream's Academy (LMS) UI was English-only; now fully localized via the fork's
natural-key i18n. ~9 files wrapped in `t()` (7 Academy views + Sidebar nav label
+ Academy feature toggle); **186 German entries** added to `i18n/de.ts`
(informal "du" register); 1 orphan removed. `npm run i18n:check` → OK.

### Tests run (2026-07-08, post-translation)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — OK (5218 keys / 5850 de entries, no missing/orphan)
- `npm run build` — success (client + server)
- `npm run test` — **1505 passed / 161 files** (StarComms: 39)
- Bundle leak grep: `process.env.STARCOMMS*` = 0, `api/v1/status` = 0

### Known limitations (carried into V3)
- **Read-only only** — no mint/join/mute/move/open/close; no writes anywhere yet.
- **Env-only config**; no admin-console-stored credentials. Changes need an env
  edit + container restart.
- **Permission-gate reuse** — no dedicated `starcomms:*` DB perms
  (`admin:access` / `operations:view` reused). A real write boundary is a V3
  prerequisite (see below).
- **Per-process 15s cache**; not distributed across instances.
- **Loose response schema** — `coerceStatus` in `lib/comms/starcomms.ts` is the
  single place to tighten when the official StarComms schema lands.
- **No WAF handling** — a challenge in front of the shard surfaces as
  `network`/`unauthorized`.

### V3 goal & guardrails — manual write actions ONLY
V3 introduces the first **write** path to StarComms. Hard constraints:
- **Manual write actions only** — user-initiated, explicit. Each write is a
  deliberate operator action with a confirmation step.
- **No automatic sync yet** — never mirror myRSI operation open/close, rosters,
  or assignments to StarComms automatically. No background reconciliation.
- **No destructive actions** — no delete/wipe/purge/close-and-discard. Scope to
  additive/idempotent operations (e.g. open/mint/join); nothing that irreversibly
  removes StarComms state.
- **No API key exposure** — `STARCOMMS_OWNER_API_KEY` stays server-only, only in
  the outgoing `Authorization` header; never in the frontend, logs, UI, test
  snapshots, or API responses. All write responses stay secret-free.
- **Permission boundary** — a genuine write needs a real gate; V3 should add
  dedicated `starcomms:*` permission(s) rather than reusing `admin:access`
  (schema change + reseed). Plan and confirm before touching `schema.sql`.

**V3 (manual open/close write actions) is now implemented** — see the next
section. Later phases (V3.1+) remain future work.

---

## StarComms V3 — manual write actions (implemented, 2026-07-08)

First **write** path to StarComms. Manual, admin-only, non-destructive. Still no
automatic sync, no background jobs, no net/assignment/role sync.

### Status
Code-complete on `beta/starcomms-v3-manual-actions`. All checks green (below).
Not yet committed/pushed. Read-only V1/V2/V2.1 untouched and still passing.

### Endpoint used (confirmed from official StarComms Owner API docs)
- **`POST {STARCOMMS_BASE_URL}/api/v1/operation`**
  - Headers: `Authorization: Bearer <STARCOMMS_OWNER_API_KEY>`,
    `Content-Type: application/json`, `Accept: application/json`
  - Body: `{ "open": true }` to open, `{ "open": false }` to close
  - The shard toggles the operation-open flag and broadcasts a config update to
    connected clients. Required owner-key scope: `write:operation` (plus
    `read:status` for the existing status refresh).
  - Response body is intentionally **not** returned to callers; only a typed
    ok/err is surfaced. Success = any 2xx; 401/403 → `unauthorized`.

### Actions & permission
| Action | Gate | Purpose |
| :--- | :--- | :--- |
| `admin:starcomms_open` | `admin:access` | manually open the StarComms operation |
| `admin:starcomms_close` | `admin:access` | manually close the StarComms operation |

Reuses existing **`admin:access`** (same as V1). **No `schema.sql` change, no
`starcomms:manage` permission, no reseed** — per the approved V3 scope.

### Changed files
- `lib/comms/types.ts` — `CommsWriteResult` type + `setOperationOpen(open)` on the
  `CommsProvider` interface (keeps the provider replaceable).
- `lib/comms/starcomms.ts` — `setOperationOpen()` impl: validates
  enabled/base-url/api-key, POSTs `{ open }`, reuses the `AbortController`
  timeout + `redact()`, typed secret-free errors. `OPERATION_PATH` constant.
- `lib/comms/index.ts` — re-export `CommsWriteResult`.
- `api/actions/starcomms.ts` — `admin:starcomms_open` / `admin:starcomms_close`
  actions returning `{ config, ok, error }` (secret-free; key never included).
- `api/services.ts` — two `fullPermissionMap` entries → `admin:access` (registry
  already spreads `...starcommsActions`). No dispatcher special-case.
- `components/views/admin/StarCommsTab.tsx` — “Open/Close StarComms operation”
  buttons with confirm dialog; disabled when disabled/misconfigured/no
  `admin:access`/state-already-matches/status-unavailable; refreshes status on
  success; non-blocking error toast; shows current `operationOpen` + last-refresh;
  explicit “manual, no auto-sync” copy.
- `i18n/de.ts` — German strings for the V3 UI (informal “du”).
- `tests/starcomms.test.ts` — V3 write-action suite.

### Safety posture (matches approved scope)
- Manual admin-only buttons; **no auto-open/close, no background jobs, no sync**.
- Non-destructive — only toggles the operation-open flag; no delete/wipe.
- All writes go server-side through the myRSI action dispatcher; the browser
  never sees the endpoint or key (bundle grep: `api/v1/operation` = 0,
  `process.env.STARCOMMS*` = 0).
- Safe when `STARCOMMS_ENABLED=false` or config missing (typed `disabled` /
  `missing_*` result, no fetch).
- Key redacted in all logs/errors; write responses are secret-free.

### Tests run and results (2026-07-08)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — OK (5238 keys / 5870 de entries)
- `npm run build` — success (client + server)
- `npm run test` — **1512 passed / 161 files** (StarComms: 46; +7 V3)
- Bundle grep: `process.env.STARCOMMS*` = 0, `api/v1/operation` = 0, `api/v1/status` = 0
- V3 coverage: gate = admin:access; disabled → no fetch; missing key → no fetch;
  open posts `{open:true}` to `/api/v1/operation` w/ bearer + JSON (no key leak);
  close posts `{open:false}`; 401 → unauthorized (no leak); timeout handled.

### Known limitations
- **Admin panel only** — write buttons live in Admin → Integrations → StarComms;
  the Operations/Dispatch widget stays read-only (surfacing there = V3.1).
- **No optimistic UI** — after a write we re-fetch admin status (uncached) to
  reflect the new state; there's a brief round-trip.
- **No 409/no-op distinction** — the UI already disables a button when the state
  matches, but if the shard rejects a redundant open/close it surfaces as a
  generic error toast.
- **`admin:access` gate** (not a dedicated `starcomms:manage`) — intentional for
  this branch; a real per-feature perm is a schema change (deferred, needs a
  plan + reseed).
- Same env-only-config, per-process-cache, loose-schema, no-WAF caveats as V2.

### Next ideas (NOT implemented)
- **V3.1** — surface the open/close buttons in the Operations StarComms widget
  for `operations:view` holders (needs an explicit gate decision; likely still
  `admin:access` for writes while reads stay broad).
- **V3.1** — dedicated `starcomms:manage` permission in `schema.sql` (+ reseed)
  replacing `admin:access` reuse, once writes are proven in beta.
- **V3.2** — additional manual write actions if the Owner API supports them
  (e.g. mint/join a net) — still manual, still non-destructive; **no** automatic
  operation/roster/role sync (explicitly out of scope).
- **V3.2** — optional confirmation that includes the myRSI-vs-StarComms mismatch
  (reuse V2.1 awareness) so an admin closing StarComms sees if a myRSI op is
  still active.

---

## Upstream merge — c27b797 (v15.4.1-open "Catch Up Update")

Upstream MyRSI commit `c27b797e69756b60e14543971cdb6457f2620efe` was merged into
the StarComms V2.1 branch (`beta/starcomms-v2-1-upstream-c27b797`). Upstream adds
notifications, Academy (LMS), native image uploads, org accent/theme changes,
optional-feature-gate hardening, schema changes, tests, and docs. StarComms
V1/V2/V2.1 is fully preserved — **no StarComms files, actions, components, tests,
or docs were deleted; no StarComms schema permissions were added.**

### How the merge arrived
The branch was handed over with the merge **committed while unresolved** — i.e.
literal `<<<<<<< / ======= / >>>>>>>` markers were baked into 21 files (git's
index showed no unmerged entries). Each region was resolved in-place by combining
upstream with our fork's changes.

### Conflicts resolved (21 files, 36 regions)
- **`api/services.ts`** — kept **both** the StarComms action imports/registry/
  permission-map entries (`admin:starcomms_status`, `admin:starcomms_test`,
  `operation:starcomms_status`) **and** upstream's `notificationActions` /
  `academyActions` + their permission-map entries. The StarComms dispatcher OR-line
  (`isStarCommsReader`) and upstream's `OPTIONAL_FEATURE_NAMESPACES` feature-gate
  are both intact. StarComms still reuses `admin:access` / `operations:view` only.
- **`lib/supabaseServer.ts`** (security-critical) — **kept our fork's version**
  (plain `createClient` on the runtime's global fetch). Upstream reintroduced a
  custom undici `Agent` with connection pooling; we intentionally rejected it
  because that dispatcher broke all Supabase calls on our runtime
  (`UND_ERR_INVALID_ARG` / "invalid onRequestStart method"). Noted inline in the file.
- **`DashboardApp.tsx`** — union of imports: our i18n/theme providers **and**
  upstream's org-accent helpers (`useConfig`, `normalizeHexColor`, `orgTheme`).
- **Native image uploads** (`AwardIconInput`, `RankModal`, `UnitModal`,
  `ClientSettingsTab`, `OrganizationIdentityTab`, `OrgPublicPageTab`,
  `SiteMetadataTab`, `AllianceManagementTab`, `AdminItemCatalogTab`,
  `WikiEditor`, `WikiToolbar`) — took upstream's new `ImageInput`/upload feature,
  kept our `t()` localization on labels.
- **`FeaturesSettingsTab.tsx`** — took upstream's real Academy feature toggle
  (replacing our "coming soon" placeholder).
- **`DiscordSettingsTab.tsx`** — dropped our duplicate tab bar in favour of
  upstream's sticky tab bar (localized), kept our Discord-sync security note.
- **`ATSTab.tsx`** — took upstream's category dropdown (our `categoryTabs` var no
  longer exists; upstream's `categoryOptions` does), kept `t()` localization.
- **`HeaderNotificationsBell.tsx`** — took upstream's `totalCount` notifications
  layout, kept our i18n strings.
- **`DutyRosterView.tsx`** — kept upstream's clickable-row + `stopPropagation`
  behaviour, kept our i18n titles and the `const { t }` component body.
- **`index.css`** — kept our fork's scrollbar colour fallbacks.
- **`DEPLOYMENT_GUIDE.md`** — kept the StarComms section **and** added upstream's
  media-upload env-var paragraph.

### Schema — action required on beta
`schema.sql` merged cleanly and **already contains upstream's additions**
(notifications, Academy, media). **Because the schema changed, on the beta
Supabase you must:**
1. **Re-run `schema.sql`** in the Supabase SQL editor so the new tables/columns/
   policies land in the database.
2. **Run "Repair Database"** afterwards (Admin → … ) so permission-catalog /
   feature seeding is reconciled with the new schema.

No new **StarComms** schema permissions were invented (StarComms still rides
`admin:access` / `operations:view`, per V2.1).

### Tests run and results (post-merge)
- `npm install` — clean (0 vulnerabilities; lockfile already consistent)
- `npx tsc --noEmit` — **clean**
- `npm run build` — **success** (client + server)
- `npm run lint` — **clean** (0 warnings, `--max-warnings 0`)
- `npm run test` — **1505 passed / 161 files** (was 1419/148 pre-merge; upstream's
  academy/notifications/media suites now run alongside StarComms's 39)
- Bundle leak grep (post-build): `process.env.STARCOMMS*` = 0, `api/v1/status` = 0.

### Status
Stabilized. Working tree holds the resolved files (not committed, not pushed).
No new StarComms features were added during this merge; V3 write actions remain
out of scope.

---

## Current branch

```
beta/starcomms-integration-v1
```

Relevant commits (newest first):
- `5c6b93b` Add StarComms read-only integration v2 (operational widget) — committed, pending beta validation
- `47f7442` Add StarComms read-only integration (V1 handoff doc)
- `c06058c` Add StarComms integration foundation v1

Working tree is **clean** (everything committed). No push has been performed by
the assistant.

---

## Current StarComms V1 status

**V1 = shipped and working in the beta deployment.** Read-only:
- Admin page **Admin → Integrations → StarComms** shows enabled/configured,
  Base URL, timeout, a **Test Connection** button, and — when reachable — guild
  id/name, shard public URL/version, connected operators, operationOpen, nets,
  and feature flags.
- Backed by the external shard call `GET {STARCOMMS_BASE_URL}/api/v1/status` with
  an owner Bearer token, server-side only.
- Fully optional and inert when `STARCOMMS_ENABLED` is not `true`.

**V2 (read-only operational widget)** is code-complete and committed on this
branch (`5c6b93b`) but is treated as *pending beta validation* — see
"Exact next steps for V2". It adds a `StarCommsStatusWidget` to the Operations
Center and Dispatch Console plus a cached read action; still no writes.

**V2.1 (read-only operational awareness)** is code-complete on branch
`beta/starcomms-v2-ops-widget`. It layers *contextual warnings/hints* on top of
the V2 widget (operation open/closed correlation, operator/net awareness,
feature-flag awareness, stale-status hint) and a read-only "Operational
awareness" section in the admin panel. **No writes, no new actions, no new
permissions, no `schema.sql` change.** See "StarComms V2.1" below.

---

## StarComms V2.1 — operational awareness (read-only)

### Status
Code-complete, **not yet committed/pushed** (working-tree changes). All checks
green (see "Tests run" below). Reuses the V2 `operation:starcomms_status` gate
verbatim — no permission or schema change.

### Where warnings are derived (frontend-side, one additive backend tweak)
Warnings are derived **client-side** in a pure, unit-tested helper
(`components/shared/starCommsAwareness.ts`), because the `operation:starcomms_status`
action is a **shared, context-free, throttled** read — injecting per-caller
myRSI operation state into it would break the shared-cache guarantee and couple
the comms action to operations/requests DB queries. The host views already hold
the authoritative "is a myRSI operation/dispatch context active" signal, and all
correlation inputs (`operationOpen`, `connectedOperators`, `nets`, `features`)
are already in the safe typed V2 response — no secret involved. The only backend
change is additive: normalizing four known feature flags in `coerceStatus`.

### Warning / hint rules (`deriveCommsAwareness`)
Only evaluated when a live status is present (disabled/error/not-configured are
handled by the widget's own banners — rule 1.3 below):

| Condition | Level | Message (natural key) |
| :--- | :--- | :--- |
| myRSI op active **and** `operationOpen === false` | warning | `myRSI operation is active, but StarComms operation is closed.` |
| `operationOpen === true` **and** no active myRSI op | info | `StarComms operation is open, but no active myRSI operation was detected.` |
| myRSI op active **and** `connectedOperators === 0` | warning | `No StarComms operators are currently connected.` |
| `nets.length === 0` | info | `No StarComms nets are available.` |
| myRSI op active **and** `features.acarsEnabled === false` | info (never error) | `StarComms ACARS is disabled for this deployment.` |
| StarComms unavailable / timeout / disabled / misconfigured | non-blocking banner in the widget only (never blocks page load) | existing V2 error/not-configured banners |
| displayed status older than `STALE_AFTER_MS` (60s) | hint | `StarComms status may be stale — refresh for the latest.` |

"myRSI op active" signal per host: Operations Center = any operation with
`OperationStatus.Active`; Dispatch Console = `stats.active > 0` (active service
requests). Staleness re-evaluates on a 30s local timer that issues **no** network
fetch (avoids aggressive polling); manual refresh (V2) is unchanged.

### Feature flags
`coerceStatus` now normalizes four known flags into the existing `features`
map under stable keys — `globalPttEnabled`, `acarsEnabled`, `publicNet.enabled`,
`orgLink.enabled` — read from top-level, nested-under-`features`, or the
`publicNet`/`orgLink` objects. Absent flags are omitted (no false "disabled").
Values are booleans only; no secret can enter. The widget shows known flags
first, then any remaining provider flags.

### Changed files (V2.1)
**New**
- `components/shared/starCommsAwareness.ts` — pure `deriveCommsAwareness()`,
  `STALE_AFTER_MS`, `KNOWN_FEATURE_KEYS` (no React, fully testable).

**Modified (additive)**
- `lib/comms/starcomms.ts` — `enrichKnownFeatures()` folded into `coerceStatus`.
- `components/shared/StarCommsStatusWidget.tsx` — `operationActive` prop, awareness
  banners, stale hint, known-flags-first ordering; container computes staleness.
- `components/views/operations/OperationsCenterView.tsx` — passes
  `operationActive={operations.some(o => o.status === Active)}`.
- `components/views/operations/DispatchCenterView.tsx` — passes
  `operationActive={stats.active > 0}`.
- `components/views/admin/StarCommsTab.tsx` — read-only "Operational awareness"
  section (explainer + StarComms-side condition summary; no write controls).
- `i18n/de.ts` — 9 German strings for the new keys.
- `tests/starcomms.test.ts` — feature-flag coercion + key-redaction tests.
- `tests/starcommsWidget.test.tsx` — `deriveCommsAwareness` rule tests + view render tests.

**Not touched:** `api/services.ts` (no new action/perm), `schema.sql`, auth,
Discord OAuth, Supabase/RLS, `lib/comms/index.ts` (cache unchanged),
`lib/comms/types.ts` (no type change — `features` was already a boolean map).

### Tests run and results (V2.1)
- `npx tsc --noEmit` — **clean**
- `npm run lint` — **clean** (0 warnings, `--max-warnings 0`)
- `npm run i18n:check` — **OK** (no missing/orphan keys; 5034 keys / 5667 de entries)
- `npm run test` — **1419 passed / 148 files** (+16 vs V2: 6 provider/flag + 10 awareness/view)
- `npm run build` — **success** (client + server)
- Bundle leak grep (post-build): `process.env.STARCOMMS*` = 0, `api/v1/status` = 0;
  `STARCOMMS_OWNER_API_KEY` = 2 (env-var **name** in the admin help sentence only,
  EN+DE bundle — never the value).

### Known limitations (V2.1)
- "myRSI op active" is derived from data the host view already has; on a view
  that hasn't loaded operations/requests yet it is momentarily `false` (may briefly
  suppress the op-open/closed correlation). No false *warnings* result.
- Staleness is a display hint only (60s), decoupled from the 15s server cache TTL;
  it never forces a refetch.
- Admin "Operational awareness" summary shows StarComms-*intrinsic* conditions
  only (operators/nets/ACARS/operation-open) — it has no myRSI operation context,
  so it deliberately omits the op-correlation rules to avoid false positives.
- Feature-flag coercion still assumes a loosely-specced body; the single place to
  tighten remains `coerceStatus` / `enrichKnownFeatures` in `lib/comms/starcomms.ts`.
- Same per-process cache and no-WAF-handling caveats as V2.

### Suggested V3 roadmap (write actions — NOT implemented)
V3 would introduce the first **write** path and therefore a real permission
boundary. Suggested shape when the feature stabilizes:
1. Add dedicated catalog permissions `starcomms:view` / `starcomms:admin` in
   `schema.sql` (+ reseed) — replacing the current V1/V2 gate reuse.
2. Add write actions behind `starcomms:admin`, e.g. open/close operation, mint/join
   a net, mute/move an operator — each with an explicit confirmation step.
3. Extend `CommsProvider` with the write methods (keep the interface swappable);
   implement in `StarCommsProvider` with the same redaction/timeout discipline.
4. Optional two-way sync of myRSI operation open/close ↔ StarComms operation state
   (behind an explicit opt-in; never automatic).
5. Audit-log every write (actor + action + target) and add write-path tests
   (authz, idempotency, failure surfaces, no-secret-leak).

Out of scope now, per V2.1 constraints — do **not** implement V3 here.

---

## What is working in beta (V1)

- StarComms admin panel renders with correct enabled/configured state.
- Test Connection returns a live status when the shard + key are valid.
- With `STARCOMMS_ENABLED` unset/false, the integration is invisible to the app
  and nothing calls the shard.
- No StarComms owner key is present in the client bundle, UI, logs, or API
  responses (re-verified by bundle grep + tests).

---

## Coolify beta configuration assumptions

- myRSI beta runs on Coolify (Nixpacks), single container, env read at **startup**
  (a var change requires a container restart/redeploy).
- The four `STARCOMMS_*` vars are set in Coolify's **environment** UI (runtime
  variables, **not** build variables).
- The StarComms shard is reachable from the container over HTTPS. If a
  Cloudflare/WAF sits in front of the shard it may challenge server-to-server
  calls (same failure class as the earlier UEX case) — surfaces as
  `network`/`unauthorized`, not a crash.
- `STARCOMMS_TIMEOUT_MS` governs the per-request timeout; the default of 5000ms
  is assumed if unset.

---

## Required myRSI beta env vars

| Variable | Required | Default | Notes |
| :--- | :--- | :--- | :--- |
| `STARCOMMS_ENABLED` | to enable | (off) | `true`/`1`/`yes`/`on` = on; anything else/unset = off |
| `STARCOMMS_BASE_URL` | when enabled | — | shard base, e.g. `https://comms.your-org.space`; client calls `{BASE_URL}/api/v1/status` |
| `STARCOMMS_OWNER_API_KEY` | when enabled | — | **owner secret**, server-only, sent only as `Authorization: Bearer …` |
| `STARCOMMS_TIMEOUT_MS` | no | `5000` | request timeout in ms |

Curl / PowerShell verification snippets are in `DEPLOYMENT_GUIDE.md`
(StarComms section).

---

## Security notes

- **`STARCOMMS_OWNER_API_KEY` must never reach the frontend, logs, UI, or API
  responses.** Enforcement:
  - Read only in `lib/comms/starcomms.ts` (server) and placed only in the
    outgoing `Authorization` header.
  - `lib/comms/*` is imported only by the server action module — verified it is
    **not** in the client bundle (`process.env.STARCOMMS*` = 0 and endpoint
    `api/v1/status` = 0 in `dist/assets`).
  - All actions return a **secret-free** config summary + normalized status; the
    only client-side occurrence of the string `STARCOMMS_OWNER_API_KEY` is the
    env-var **name** inside an admin help sentence — not the value.
  - Logs (`log.warn`) emit only `timeoutMs` / HTTP `status` / a `redact()`-ed
    network-error message.
  - Tests assert the key never appears in provider results or action responses.
- Rotate the key if it is ever exposed. Keep it in Coolify env only; never commit.

---

## Files changed for V1 (and why)

**New**
- `lib/comms/types.ts` — replaceable `CommsProvider` interface + secret-free types (so a future official StarComms can drop in).
- `lib/comms/starcomms.ts` — StarComms provider: Bearer auth, `AbortController` timeout, lenient response coercion, `redact()`.
- `lib/comms/index.ts` — `getCommsProvider()` factory + `describeCommsConfig()`.
- `api/actions/starcomms.ts` — the two V1 actions.
- `components/views/admin/StarCommsTab.tsx` — admin panel UI (i18n).
- `tests/starcomms.test.ts` — 13 tests.

**Modified (minimal, additive)**
- `api/services.ts` — 1 import, `...starcommsActions` in the registry, 2 `fullPermissionMap` entries. No other logic touched.
- `components/views/admin/AdminPanelView.tsx` — lazy import + 1 Integrations tab entry + 1 render-switch case.
- `i18n/de.ts` — 22 German strings.
- `.env.example` — `STARCOMMS_*` block.
- `DEPLOYMENT_GUIDE.md` — env table + security note + curl/PowerShell test.

(V2 additionally added `components/shared/StarCommsStatusWidget.tsx`,
`tests/starcommsWidget.test.tsx`, a cache in `lib/comms/index.ts`, the
`operation:starcomms_status` action, one map entry + one OR line in
`api/services.ts`, and mounts in `OperationsCenterView` / `DispatchCenterView` —
see the V1 plan doc for the split.)

---

## Backend actions / queries / services added

- **Actions** (registered in `api/services.ts` via `...starcommsActions`):
  - `admin:starcomms_status` — read config summary + live status (V1).
  - `admin:starcomms_test` — force a live probe, bypassing cache (V1).
  - `operation:starcomms_status` — cached/throttled read for the operational widget (V2).
- **Queries:** none. Reads go through the service-action dispatcher (same pattern
  as `AllianceManagementTab`); no new `/api/query` subset was added.
- **Services/helpers:** `getCommsProvider()`, `describeCommsConfig()`,
  `getCachedCommsStatus()` (15s TTL + in-flight de-dupe, V2) in `lib/comms/`.

---

## Frontend components / pages added

- **V1:** `components/views/admin/StarCommsTab.tsx` — admin page under
  **Admin → Integrations → StarComms**.
- **V2:** `components/shared/StarCommsStatusWidget.tsx` — reusable widget
  (container + pure `StarCommsStatusView`), mounted in the Operations Center and
  the Dispatch Console.

---

## Permission decision

**V1 uses the existing `admin:access` permission. No `schema.sql` change, no new
DB permissions.**

- Both V1 actions and the admin tab are gated on `admin:access`.
- Rationale: V1 is an admin-only, read-only config panel; reusing `admin:access`
  avoids a schema-catalog change + reseed on the beta branch while the feature is
  experimental.
- (V2's widget action reuses `operations:view` OR `request:dispatch` OR
  `admin:access` via one localized OR line in the dispatcher's existing
  special-case chain — still no schema change and no new DB perms.)
- Dedicated `starcomms:view` / `starcomms:admin` permissions are intentionally
  deferred (they would require schema.sql rows + reseed).

---

## Tests run and results (2026-07-08)

- `npx tsc --noEmit` — **clean**
- `npm run lint` — **clean** (0 warnings, `--max-warnings 0`)
- `npm run test` — **1403 passed / 148 files** (StarComms: 13 V1 + 10 V2; plus permissionMapCoverage)
- `npm run build` — **success**
- `npm run i18n:check` — **OK** (no missing/orphan keys)
- Bundle leak grep: `process.env.STARCOMMS*` = 0, `api/v1/status` = 0 in `dist/assets`.

StarComms test coverage: permission mapping; disabled (no fetch, no key);
missing base URL; missing API key; success + normalized status; 401 →
unauthorized; timeout; malformed (non-JSON / non-object); API-key redaction;
cache throttle (one upstream call per TTL); widget view renders every state
without throwing.

---

## Known limitations

- **Read-only.** No mint/join/mute/move/open/close or any write to StarComms.
- **Env-only config.** No admin-console-entered credentials; changes need an env
  edit + restart.
- **Permission gate reuse.** No dedicated `starcomms:*` DB perms yet.
- **Cache is per-process** (15s TTL); not distributed across instances.
- **Manual widget refresh is throttled** within the TTL (admins can force a fresh
  probe via Test Connection).
- **Loose response schema.** `/api/v1/status` is coerced leniently; the single
  place to adjust is `coerceStatus` in `lib/comms/starcomms.ts`.
- **No WAF handling.** A challenge in front of the shard surfaces as
  `network`/`unauthorized`.

---

## Exact next steps for V2

V2 is code-complete and committed (`5c6b93b`). To finish shipping it to beta:

1. **Deploy the branch to beta** (Coolify redeploy of `beta/starcomms-integration-v1`).
2. **Validate the widget in beta** with `STARCOMMS_ENABLED=true` and a valid
   shard/key: open **Operations Center** and **Dispatch Console** and confirm the
   widget shows connection status, operator count, nets, feature flags, shard
   version, and a last-refresh time; click refresh.
3. **Validate the permission behaviour:** a dispatcher (has `request:dispatch`,
   not `operations:view`) sees live data; a member without ops/dispatch/admin
   sees no widget (renders nothing) and the `operation:starcomms_status` action
   returns 403 for them.
4. **Validate disabled/misconfig paths in beta:** with `STARCOMMS_ENABLED=false`
   the widget is absent everywhere; with enabled-but-missing key the admin panel
   shows the amber "not fully configured" state.
5. **Watch the throttle:** confirm many concurrent dispatch users generate at
   most ~1 shard call / 15s / instance (server logs).
6. **Update this handoff** to mark V2 "validated in beta" once the above pass.

(Everything above is validation/rollout — no new V2 code is required.)

---

## What NOT to change

- Do **not** add write actions or any operation that creates/updates/opens/closes
  anything in StarComms (that is V3, out of scope).
- Do **not** expose `STARCOMMS_OWNER_API_KEY` to the client — keep all shard calls
  in `lib/comms/*` (server) and return only secret-free data.
- Do **not** change `schema.sql`, `reset_db.sql`, auth, Discord OAuth,
  Supabase/RLS, or the general permission system beyond the one existing
  localized OR line.
- Do **not** add new DB permissions on this beta branch.
- Do **not** refactor unrelated modules or the dispatcher beyond the StarComms
  entries already present.
- Do **not** `git push` without explicit approval.

---

## Commands for a new Claude session to continue safely

```bash
# 1. Confirm you are on the right branch and the tree is clean
git branch --show-current          # expect: beta/starcomms-integration-v1
git status --short                 # expect: empty

# 2. See the StarComms surface
git log --oneline | grep -i starcomms
ls lib/comms api/actions/starcomms.ts components/shared/StarCommsStatusWidget.tsx

# 3. Verify the build/health before any change
npx tsc --noEmit
npm run lint
npm run test
npm run build
npm run i18n:check

# 4. Prove no key leaks into the client bundle (after a build)
grep -rl "process.env.STARCOMMS" dist/assets/ | wc -l   # expect 0
grep -rl "api/v1/status" dist/assets/ | wc -l            # expect 0

# 5. Run only the StarComms tests while iterating
npx vitest run tests/starcomms.test.ts tests/starcommsWidget.test.tsx
```

Key files to read first: `lib/comms/starcomms.ts` (shard client + redaction),
`api/actions/starcomms.ts` (actions), `api/services.ts` (permission gate +
registry, search "starcomms"), `components/shared/StarCommsStatusWidget.tsx`
(widget), and `docs/integrations/starcomms-v1-plan.md` (design/plan).
