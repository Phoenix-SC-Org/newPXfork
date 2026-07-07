# StarComms Integration — Handoff

Feature work is **paused**. This document is the source of truth for the
StarComms integration on this fork. Last verified: **2026-07-08**.

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
