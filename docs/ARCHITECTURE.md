# KuKLA Target Architecture

> Server data ownership is fixed by [ADR-0001](adr/0001-data-ownership-server-vs-local.md); the Tauri desktop-client choice is recorded in [ADR-0002](adr/0002-tauri-cross-platform-desktop.md).
> The per-entity breakdown lives in [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md).

## Goal

Server-first search coordination system with desktop and field clients.

- Command staff (leaders, coordinators) use the native Tauri desktop client on **Windows and Linux**; macOS packaging is planned for a later increment.
- Field members work in a separate mobile client.
- There is no mandatory browser UI; Vite's browser server is used for development only.
- **PostgreSQL remains the authoritative state.** The Tauri client uses the server API and does not replace the backend.

## Components

| Component | Role | Status |
|---|---|---|
| Fastify API (`server/`) | Authentication, RBAC, searches, members, tasks, events, GPS | **Authoritative contract**; extended, not replaced |
| PostgreSQL | Authoritative state | Active |
| Tauri + React (`desktop/`) | Cross-platform native desktop client | Target for Windows/Linux; macOS planned |
| Go/C + GTK4 (`rebuild/`) | Local-only desktop prototype with SQLite | Experimental; not connected to the server and not the product target |
| Flutter (`mobile/`) | Field client | Retained in the target architecture; offline workflow is incomplete |
| Redis | Reserved for queues/cache/realtime expansion | Present but unused by server code |
| Nginx | Optional production reverse proxy / TLS termination | Active |

### Desktop transport

The Tauri client calls the server API over HTTP(S); the packaged default is the local Compose API, while production deployments use HTTPS. During web development, the Vite proxy keeps API calls same-origin. The client does not host a local API. Durable offline caching and command queuing are not implemented in Tauri yet; the separate Go/C prototype's private IPC is not the transport for the target client.

## Data flow

- The **server is authoritative**. The Tauri desktop client reads and changes shared state only through the server API.
- Tauri currently has no local operational database or durable offline command queue. Its subject-profile screen makes online API calls; degraded-network behavior remains a roadmap item.
- Server-side role and search-access checks are authoritative. Hiding interface elements is never treated as authorization.
- Any future offline cache/queue must preserve server authority and define conflict resolution before field use.

## Authentication

- The current desktop sign-in is email/phone plus password; phone OTP is not implemented.
- Public self-registration is disabled; accounts are created by invitation or by an administrator.
- The Tauri UI currently persists its session token in WebView `localStorage`. Moving it to the operating system credential store is a security requirement still to implement before production use.
- Production requires TLS, strong secrets, restricted network exposure and no default accounts.

## Security

JWT is required for protected API calls. Role checks are performed on the server. The first system owner is created by the one-time `kukla_bootstrap_system_owner` procedure, never by a shipped default password (see [`SECURITY_BOOTSTRAP.md`](SECURITY_BOOTSTRAP.md)).

The subject-profile slice permits only management roles with access to the relevant search to read or edit medical notes. It does not cache those records for offline use. This implementation is not a completed privacy approval: retention/deletion, production storage and backup protections, and operational audit review remain open. Do not treat the feature as ready for field or rescue-coordination use. The unencrypted SQLite database in `rebuild/` belongs to an experimental local prototype and is not used by the Tauri client.
