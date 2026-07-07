# StarComms Integration — Handoff (V1 + V2)

**Status:** V1 shipped & stabilized (2026-07-08). **V2 implemented 2026-07-08**
— read-only operational visibility. Still no write operations of any kind.

Scope:
- **V1:** read the status of an external StarComms shard in **Admin →
  Integrations → StarComms**, with a connection test.
- **V2:** a reusable read-only **StarComms status widget** in the **Operations
  Center** and **Dispatch Console**, backed by a cached/throttled read action
  visible to Operations / Dispatch / Admin users.

Both are fully optional and inert when disabled.

---

## V2 summary (read-only operational visibility)

- Reusable `StarCommsStatusWidget` (container) + pure `StarCommsStatusView`
  (prop-driven, testable) showing: connection status, `operationOpen`, connected
  operator count, nets, feature flags, shard version, last successful refresh
  time, and a manual refresh button.
- Mounted in `OperationsCenterView` (top of the list) and `DispatchCenterView`
  (top of the Comms Matrix column). Loads on its own async path — **never blocks
  the host page**; renders **nothing** when disabled or when the caller lacks
  access, so operational areas stay clean.
- New cached read action `operation:starcomms_status` (secret-free:
  `{ config, status | null, error | null, fetchedAt }`).
- **Server-side throttle:** a 15s in-process TTL cache with in-flight de-dupe in
  `lib/comms/index.ts` (`getCachedCommsStatus`) collapses many concurrent widget
  mounts to at most one upstream request per window. Admin **Test Connection**
  (V1) still bypasses the cache for a fresh probe. Timeout stays governed by
  `STARCOMMS_TIMEOUT_MS`.
- **No new env vars, no schema change, no new DB permissions, no write actions.**

### V2 permission gate

Chosen (approved): the widget action is admitted to **Operations OR Dispatch OR
Admin** users, so dispatchers without `operations:view` still get live data.

- `fullPermissionMap['operation:starcomms_status'] = 'operations:view'` (base).
- A localized OR in the dispatcher's existing special-case chain (same pattern
  as `isUnitLeader` / `isRequestLead`) additionally admits `request:dispatch` or
  `admin:access`:
  `isStarCommsReader = action === 'operation:starcomms_status' && (perms.includes('request:dispatch') || perms.includes('admin:access'))`.
- The V1 admin actions remain `admin:access`-only for the config panel.

---

## Architecture (replaceable provider layer)

A small `CommsProvider` abstraction so a future official/open-source StarComms
(or a different backend) can be dropped in without touching callers.

```
lib/comms/types.ts      CommsProvider interface + secret-free types
lib/comms/starcomms.ts  StarCommsProvider — GET {BASE_URL}/api/v1/status (server-only)
lib/comms/index.ts      getCommsProvider() factory + describeCommsConfig()
        ▲
api/actions/starcomms.ts   admin:starcomms_status / admin:starcomms_test
        ▲  (registered in api/services.ts)
components/views/admin/StarCommsTab.tsx   admin UI (calls the two actions via rpcAction)
```

To swap providers later: implement `CommsProvider` and return it from
`getCommsProvider()` in `lib/comms/index.ts`. Nothing else changes.

---

## Changed / added files

**New — V1**
- `lib/comms/types.ts` — provider interface, `CommsStatus`, `CommsConfigSummary`, `CommsResult`, error taxonomy.
- `lib/comms/starcomms.ts` — StarComms provider (Bearer auth, AbortController timeout, lenient response coercion, `redact()`).
- `lib/comms/index.ts` — factory + config-summary helper **(+ V2: `getCachedCommsStatus` TTL cache + `__resetCommsCache` test helper)**.
- `api/actions/starcomms.ts` — `admin:starcomms_status`, `admin:starcomms_test` **(+ V2: `operation:starcomms_status`)**.
- `components/views/admin/StarCommsTab.tsx` — admin panel (i18n).
- `tests/starcomms.test.ts` — 13 tests.
- `STARCOMMS_HANDOFF.md` — this file.

**New — V2**
- `components/shared/StarCommsStatusWidget.tsx` — reusable widget (container + pure `StarCommsStatusView`).
- `tests/starcommsWidget.test.tsx` — 10 tests (action, cache/throttle, view states).

**Modified**
- `api/services.ts` — V1: 1 import, `...starcommsActions`, 2 map entries. V2: 1 map entry (`operation:starcomms_status`) + 1 localized OR line (`isStarCommsReader`) in the permission gate. No other logic touched.
- `components/views/admin/AdminPanelView.tsx` — lazy import, 1 Integrations tab entry, 1 render-switch case (V1).
- `components/views/operations/OperationsCenterView.tsx` — import + mount `<StarCommsStatusWidget />` (V2, 2 lines).
- `components/views/operations/DispatchCenterView.tsx` — import + mount `<StarCommsStatusWidget />` in the Comms Matrix column (V2, 2 lines).
- `components/views/admin/StarCommsTab.tsx` — "used by Operations widget" note (V2, 1 line).
- `i18n/de.ts` — 22 (V1) + 6 (V2) German strings.
- `.env.example` — `STARCOMMS_*` block (V1).
- `DEPLOYMENT_GUIDE.md` — StarComms env table + security note + curl/PowerShell test (V1).

**Not touched:** auth, Discord OAuth, Supabase/RLS, the general permission
system beyond the single localized OR line, `schema.sql`, `reset_db.sql`,
`/api/query`.

---

## Environment variables

| Variable | Required | Default | Notes |
| :--- | :--- | :--- | :--- |
| `STARCOMMS_ENABLED` | to enable | (off) | `true`/`1`/`yes`/`on` = on; anything else/unset = off |
| `STARCOMMS_BASE_URL` | when enabled | — | e.g. `https://comms.your-org.space`; client calls `{BASE_URL}/api/v1/status` |
| `STARCOMMS_OWNER_API_KEY` | when enabled | — | **Owner secret.** Server-only, sent only as `Authorization: Bearer …`. Rotate if leaked |
| `STARCOMMS_TIMEOUT_MS` | no | `5000` | request timeout in ms |

Set in Coolify's env UI (not build variables); restart the container (env is
read at startup). Verification (`curl` / PowerShell) is in `DEPLOYMENT_GUIDE.md`.

---

## Permission model

V1 gates both actions and the admin tab on the existing **`admin:access`**
permission (no schema change). Two enforcement layers:

- **UI:** the admin nav filters tabs by `hasPermission(tab.permission)` and the
  render switch re-checks `hasPermission('admin:access')`.
- **Server (authoritative):** `admin:starcomms_status` / `admin:starcomms_test`
  use the protected `admin:` prefix → the dispatcher requires
  `fullPermissionMap[action]` = `admin:access`. A caller without it gets `403`.
  No `user:manage:self` and no op-owner bypass apply.

The originally-requested `starcomms:view` / `starcomms:admin` split is deferred
to V2 (would add two rows to the `schema.sql` permission catalog + a reseed).

---

## Test results (2026-07-08, after V2)

- `npx tsc --noEmit` — **clean**
- `npm run lint` — **clean** (0 warnings, `--max-warnings 0`)
- `npm run test` — **1403 passed / 148 files** (V1 13 + V2 10 + permissionMapCoverage)
- `npm run build` — **success**
- `npm run i18n:check` — **OK** (no missing/orphan keys)

`tests/starcomms.test.ts` (V1) covers: permission mapping; disabled; missing
base URL; missing API key; success+normalized; 401→unauthorized; timeout;
malformed (non-JSON and non-object); API-key redaction in provider + action
responses.

`tests/starcommsWidget.test.tsx` (V2) covers: widget action gated on
`operations:view`; disabled state (no fetch, no key); success (status +
`fetchedAt`, no key); 401 error (no key); **cache throttle** (repeat reads
within TTL → one upstream call, re-fetch after TTL); and the view rendering
every state without throwing (loading / connected / timeout-error /
not-configured / empty) — the last proving the widget cannot break the host
Operations/Dispatch initial load.

### V2 leakage re-check (built bundle)

`dist/assets` grep after build: `process.env.STARCOMMS*` = 0, server endpoint
`api/v1/status` = 0 (`lib/comms` did not bundle client-side). Only the widget
action name `operation:starcomms_status` appears (benign).

---

## Stabilization verification (this pass)

- **API key not exposed to the frontend bundle:** built `dist/assets` grep —
  `process.env.STARCOMMS*` = 0, server endpoint `api/v1/status` = 0 (i.e.
  `lib/comms` did not bundle client-side), no StarComms-linked `Bearer ${…}`.
  The only client-side occurrence of `STARCOMMS_OWNER_API_KEY` is the env-var
  **name** inside an admin help sentence — not the value.
- **API key not in API responses:** actions return a secret-free config summary
  + normalized status only; tests assert the key never appears in any output.
- **API key not in logs:** the four `log.warn` calls emit only `timeoutMs` /
  `status` / a `redact()`-ed network-error message.
- **`STARCOMMS_ENABLED=false` is safe:** `readEnabled()` only treats
  `true/1/yes/on` as on, so `false` → off; the status action short-circuits with
  no fetch and returns `{ status: null, error: null }`; the app is unaffected.
- **Missing base URL / API key:** the panel shows an amber "Not fully
  configured" banner; **Test Connection** returns the specific
  `missing_base_url` / `missing_api_key` error message. No crash, no secret.
- **Non-admin access blocked:** UI hides the tab; server denies the actions with
  `403` (verified against the dispatcher permission gate).
- **`/api/query` and `/api/services` unaffected:** the only dispatcher change was
  additive (import + spread + 2 map lines); full suite + permissionMapCoverage
  green; `/api/query` was not modified.

---

## Known limitations (V1 + V2)

- **Read-only.** No mint/join/mute/move or any write to StarComms.
- **Env-only config.** No admin-console-entered credentials (unlike Discord/
  LiveKit). Changing config needs an env edit + restart.
- **Permission gate.** V1 admin panel = `admin:access`. V2 widget =
  `operations:view` OR `request:dispatch` OR `admin:access`. No dedicated
  `starcomms:*` DB perms yet.
- **Cache is per-process.** The 15s TTL cache lives in-process; instances behind
  a load balancer each keep their own (fine at current scale; not distributed).
- **Manual refresh is throttled.** Clicking refresh within the 15s window returns
  cached data (unchanged `fetchedAt`). Admins force a fresh probe via **Test
  Connection** (uncached).
- **Widget hides on disabled / no-access.** By design it renders nothing rather
  than an error box in those cases.
- **Loose response schema.** `/api/v1/status` is coerced leniently; the single
  place to adjust is `coerceStatus` in `lib/comms/starcomms.ts`.
- **No WAF handling.** A Cloudflare/WAF challenge surfaces as
  `network`/`unauthorized` (same class as the UEX case).

---

## Next steps (V3 — NOT implemented)

1. Dedicated permissions `starcomms:view` / `starcomms:admin` (schema.sql
   catalog rows + reseed; needs explicit approval per project rules).
2. Optional admin-console config (DB-stored, encrypted like LiveKit).
3. **Write operations** behind `starcomms:admin` once the official API
   stabilizes (mint join tokens, open/close operation, net management), added to
   the `CommsProvider` interface — out of scope until then.
4. Auto-refresh/polling for the widget and/or a distributed cache if scaled
   horizontally.
5. Deep links from the widget into StarComms nets/operators.
6. Pin the response schema to the official StarComms spec when published and
   tighten `coerceStatus`.
