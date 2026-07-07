# StarComms Integration — V1 Plan & Design

Design reference for the StarComms integration on `beta/starcomms-integration-v1`.
Operational status, env, and rollout live in `/STARCOMMS_HANDOFF.md`; this file
documents the *why* and *how* of the design so future work stays consistent.

## Goal

Add an **optional, read-only** StarComms integration, structured as a
**replaceable Comms Provider layer** so the official/open-source StarComms (or
another backend) can be swapped in later without touching callers.

Hard constraints (V1):
- No write actions; never create/update/open/close anything in StarComms.
- Never expose the owner API key to the frontend, logs, UI, or API responses.
- Env-first config; no hardcoded secrets.
- Safe when `STARCOMMS_ENABLED` is false/missing — the app works normally.
- No `schema.sql` change; no new DB permissions.

## Architecture — replaceable provider layer

```
lib/comms/types.ts      CommsProvider interface + secret-free types
lib/comms/starcomms.ts  StarCommsProvider — GET {BASE_URL}/api/v1/status (server-only)
lib/comms/index.ts      getCommsProvider() factory + describeCommsConfig()
                        (+ V2: getCachedCommsStatus 15s TTL cache)
        ▲
api/actions/starcomms.ts   admin:starcomms_status / admin:starcomms_test (V1)
                           operation:starcomms_status (V2, cached)
        ▲  (registered in api/services.ts via ...starcommsActions)
components/views/admin/StarCommsTab.tsx        admin page (V1)
components/shared/StarCommsStatusWidget.tsx    operational widget (V2)
```

To swap backends later: implement `CommsProvider` and return it from
`getCommsProvider()` in `lib/comms/index.ts`. Callers depend only on the
interface (`getStatus()`, `describeConfig()`), never on the concrete class.

## Provider behaviour (`lib/comms/starcomms.ts`)

- Reads `STARCOMMS_*` from `process.env` on each call (stateless).
- `GET {BASE_URL}/api/v1/status` with `Authorization: Bearer <key>` and
  `Accept: application/json`.
- Timeout via `AbortController` + `STARCOMMS_TIMEOUT_MS` (default 5000ms).
- Typed error taxonomy (never throws for expected cases):
  `disabled | missing_base_url | missing_api_key | unauthorized | timeout |
  network | malformed`.
- Lenient `coerceStatus` maps the (loosely-specced) body to a normalized
  `CommsStatus` (unknown fields ignored, missing → null). **Single place to
  update** when the official schema lands.
- `redact()` strips the key from any outgoing string (belt-and-suspenders; the
  key is never logged or returned by construction).

## Actions & registration

Service actions (no `/api/query` subset), registered in `api/services.ts`:

| Action | Version | Gate | Purpose |
| :--- | :--- | :--- | :--- |
| `admin:starcomms_status` | V1 | `admin:access` | config summary + live status for the admin panel |
| `admin:starcomms_test` | V1 | `admin:access` | forced live probe (bypasses cache) |
| `operation:starcomms_status` | V2 | `operations:view` OR `request:dispatch` OR `admin:access` | cached read for the operational widget |

All return **secret-free** shapes: `{ config, status | null, error | null }`
(+`fetchedAt` for the widget action). `config` is
`{ provider, enabled, configured, baseUrl, timeoutMs }` — `baseUrl` (shard URL)
is not secret; the key is never included.

## Permission mapping (V1 decision)

The repo seeds permissions from `schema.sql` and gates each protected action via
`fullPermissionMap` in `api/services.ts` (one required permission per action,
with a special-case OR chain for a few actions).

- **V1:** reuse **`admin:access`** for both actions + the tab. No schema change,
  no reseed — appropriate for an experimental, admin-only, read-only panel.
- **V2:** the widget must be visible to Operations *and* Dispatch users (not just
  admins). Implemented as `operations:view` in `fullPermissionMap` plus a
  localized OR (`isStarCommsReader`) in the dispatcher's existing special-case
  chain (same pattern as `isUnitLeader` / `isRequestLead`) admitting
  `request:dispatch` / `admin:access`. Still no new DB permissions.
- **Deferred (V3):** dedicated `starcomms:view` / `starcomms:admin` catalog rows
  in `schema.sql` + reseed, once the feature is stable.

## Environment variables

| Variable | Required | Default |
| :--- | :--- | :--- |
| `STARCOMMS_ENABLED` | to enable | off |
| `STARCOMMS_BASE_URL` | when enabled | — |
| `STARCOMMS_OWNER_API_KEY` | when enabled | — |
| `STARCOMMS_TIMEOUT_MS` | no | 5000 |

## Security model

- Owner key: server-only, `process.env` → Authorization header only.
- `lib/comms/*` never imported client-side (verified: not in `dist/assets`).
- Responses/logs are secret-free; the key name may appear in help text, never the
  value.
- Enforced by tests (`tests/starcomms.test.ts`, `tests/starcommsWidget.test.tsx`)
  and a bundle grep in the handoff verification.

## Testing strategy

- Provider/action unit tests with `vi.stubEnv` + a mocked `fetch`:
  disabled / missing base URL / missing key / success / 401 / timeout /
  malformed / key-redaction / cache-throttle.
- Presentational `StarCommsStatusView` rendered via `@testing-library/react`
  through `I18nProvider` for every UI state (loading / connected / error /
  not-configured / empty) — proving the widget cannot break the host page.
- Permission-map coverage is pinned by the existing `permissionMapCoverage` test.

## Out of scope (V1) / future

- Writes of any kind (V3, behind `starcomms:admin`).
- Admin-console-stored (encrypted) credentials as an alternative to env.
- Auto-refresh/polling; distributed cache if scaled horizontally.
- Deep links into StarComms nets/operators.
- Tightening `coerceStatus` to the official StarComms schema when published.
