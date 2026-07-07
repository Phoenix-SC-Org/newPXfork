# StarComms Integration — Handoff (V1)

**Status:** V1 shipped and running in the beta deployment. Stabilization pass
completed 2026-07-08. Read-only status integration; no write operations.

Scope of V1: read the status of an external StarComms shard and surface it in
**Admin → Integrations → StarComms**, with a connection test. Fully optional and
inert when disabled.

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

**New**
- `lib/comms/types.ts` — provider interface, `CommsStatus`, `CommsConfigSummary`, `CommsResult`, error taxonomy.
- `lib/comms/starcomms.ts` — StarComms provider (Bearer auth, AbortController timeout, lenient response coercion, `redact()`).
- `lib/comms/index.ts` — factory + config-summary helper.
- `api/actions/starcomms.ts` — `admin:starcomms_status`, `admin:starcomms_test`.
- `components/views/admin/StarCommsTab.tsx` — admin panel (i18n).
- `tests/starcomms.test.ts` — 13 tests.
- `STARCOMMS_HANDOFF.md` — this file.

**Modified (minimal, additive)**
- `api/services.ts` — 1 import, `...starcommsActions` in the registry, 2 `fullPermissionMap` entries. No other logic touched.
- `components/views/admin/AdminPanelView.tsx` — lazy import, 1 Integrations tab entry, 1 render-switch case.
- `i18n/de.ts` — 22 German strings for the tab.
- `.env.example` — `STARCOMMS_*` block.
- `DEPLOYMENT_GUIDE.md` — StarComms env table + security note + curl/PowerShell test.

**Not touched:** auth, Discord OAuth, Supabase/RLS, the general permission
system, `schema.sql`, `reset_db.sql`, `/api/query`.

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

## Test results (2026-07-08)

- `npx tsc --noEmit` — **clean**
- `npm run lint` — **clean** (0 warnings, `--max-warnings 0`)
- `npm run test` — **1393 passed / 147 files** (incl. 13 StarComms + permissionMapCoverage)
- `npm run build` — **success**
- `npm run i18n:check` — **OK** (no missing/orphan keys)

`tests/starcomms.test.ts` covers: permission mapping present; disabled state;
missing base URL; missing API key; successful+normalized status; 401 →
unauthorized; timeout (aborted request); malformed (non-JSON and non-object);
API-key redaction in provider results and in both action responses.

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

## Known limitations (V1)

- **Read-only.** No mint/join/mute/move or any write to StarComms.
- **Env-only config.** No admin-console-entered credentials (unlike Discord/
  LiveKit which support DB-stored secrets). Changing config needs an env edit +
  restart.
- **Single permission gate.** view and admin both map to `admin:access`; no
  separate `starcomms:view` / `starcomms:admin`.
- **No caching / polling.** Status is fetched on tab open and on demand (Test
  Connection); it is not auto-refreshed or cached.
- **Loose response schema.** The `/api/v1/status` shape is coerced leniently
  (unknown fields ignored, missing fields → null). If the official StarComms API
  finalizes a different schema, the mapper in `lib/comms/starcomms.ts`
  (`coerceStatus`) is the single place to adjust.
- **No WAF handling.** If a Cloudflare/WAF challenges the shard, the request
  fails as `network`/`unauthorized` (same class as the UEX case).

---

## Next steps (V2 — NOT implemented)

1. Dedicated permissions `starcomms:view` / `starcomms:admin` (schema.sql
   catalog rows + reseed; needs explicit approval per project rules).
2. Optional admin-console config (DB-stored, encrypted like LiveKit) as an
   alternative to env-only.
3. Write operations behind `starcomms:admin` once the official API stabilizes
   (mint join tokens, net management), added to the `CommsProvider` interface.
4. Lightweight caching/auto-refresh for the status panel.
5. Pin the response schema to the official StarComms spec when published and
   tighten `coerceStatus`.
