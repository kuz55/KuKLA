# KuKLA Target Architecture

> Data ownership and the server/local boundary are fixed by [ADR-0001](adr/0001-data-ownership-server-vs-local.md).
> The per-entity breakdown lives in [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md).

## Goal

Server-first search coordination system with desktop and field clients.

- Command staff (leaders, coordinators) work in a cross-platform desktop client for **Windows and Linux**.
- Field members work in a mobile client.
- There is no mandatory browser UI.
- **PostgreSQL remains the authoritative state.** The Go/C desktop client extends the platform; it does not replace the server.

## Components

| Component | Role | Status |
|---|---|---|
| Fastify API (`server/`) | Authentication, RBAC, searches, members, tasks, events, GPS | **Authoritative contract**; extended, not replaced |
| PostgreSQL | Authoritative state | Active |
| Go engine (`rebuild/`) | Local desktop application logic, SQLite cache and outbound command queue | Target desktop client |
| C/GTK 4 (`rebuild/ui/gtk`) | Native desktop interface on Linux and Windows | Target desktop client |
| Flutter (`mobile/`) | Field client with local cache and offline command queue | Retained in the target architecture |
| Tauri + React (`desktop/`) | Previous desktop client | **Deprecated**; behavior reference until Go/C reaches parity |
| Redis | Reserved for queues/cache/realtime expansion | Present but unused by server code |
| Nginx | Optional production reverse proxy / TLS termination | Active |

### Desktop transport

The desktop application does not open TCP ports by default. The GTK interface talks to the local Go engine over a private Unix-domain socket on Linux or an ACL-restricted named pipe on Windows. The engine talks to the server over HTTPS.

## Data flow

- The **server is authoritative**. Clients read operational state and submit changes.
- The **local database is derived**: a read cache for server data plus an outbound queue for commands issued without connectivity.
- Field commands (GPS points, task status) are written locally when the network is unavailable and flushed afterwards with retry and idempotency keys.
- The local database **does not store authorizing roles**. A role is only meaningful as returned by the server. Hiding interface elements is never treated as authorization.
- Conflicts keep both versions and are resolved by an authorized user, not silently overwritten.

## Authentication

- Phone number with a one-time code (OTP) is the primary field credential.
- Email and password sign-in remains available for organizations without SMS.
- Public self-registration is disabled; accounts are created by invitation or by an administrator.
- The session token is stored in the operating system credential store, not in a plain configuration file.
- Production requires TLS, strong secrets, restricted network exposure and no default accounts.

## Security

JWT is required for protected API calls. Role checks are performed on the server. The first system owner is created by the one-time `kukla_bootstrap_system_owner` procedure, never by a shipped default password (see [`SECURITY_BOOTSTRAP.md`](SECURITY_BOOTSTRAP.md)).

Client data at rest is **planned** to be encrypted with SQLCipher using a key held by the operating system credential store. This is not implemented yet: the local database is currently unencrypted. Medical notes on a search subject must not be collected or displayed until that encryption is in place (see [`OPERATIONS.md`](OPERATIONS.md)).

## Not applicable to the local client

These mechanisms protect the server perimeter and have no meaning in local mode:

- cross-user authorization and organization isolation (a local install has one OS user);
- request rate limiting;
- CORS and port exposure;
- WebSocket broadcast (realtime requires a second participant, i.e. the server).
