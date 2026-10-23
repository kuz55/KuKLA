# Release status: KuKLA 2.1.0

Implemented:
- Linux-first Docker server.
- PostgreSQL schema and development seed.
- JWT authentication and RBAC.
- Search lifecycle.
- Members.
- Tasks.
- Audit events.
- GPS ingestion and retrieval.
- Snapshot API.
- WebSocket handshake endpoint.
- Desktop Tauri/React operational UI.
- Desktop OpenStreetMap operational map.
- Flutter field UI.
- Mobile SQLite cache and offline command queue.
- Mobile GPS collection/transmission.
- Docker backup/restore scripts.
- GitLab CI configuration.

Not bundled because they are environment-specific:
- Node modules.
- Rust/Cargo registries.
- Flutter SDK/platform generated folders.
- TLS certificates.
- Production secrets.

Before real rescue operations:
- Complete production hardening.
- Add push notifications.
- Add durable realtime event fan-out via Redis/WebSocket.
- Validate background GPS behavior on target Android/iOS versions.
- Perform security and field acceptance testing.

## Target stack transition

The project is transitioning to a Go/C desktop client. Current position:

- `server/` (Fastify/TypeScript, PostgreSQL) remains the authoritative contract and is extended, not replaced.
- `rebuild/` (Go/C, GTK4, SQLite) already performs a local create/list/read search workflow, stores data in SQLite, packages a portable Windows build in CI, and implements the local questionnaire and role catalog.
- `desktop/` (Tauri/React) is **deprecated**; it stays as a behavior reference until the Go/C client reaches parity.
- `mobile/` (Flutter) remains the field client.

Not yet implemented in the Go/C client: phone/OTP sign-in and server connection, authenticated role assignment and review, task and group screens, maps and offline map packages, request intake, media pipeline, notifications, synchronization, backup/restore and database encryption.

Data ownership between server and client is fixed in [ADR-0001](adr/0001-data-ownership-server-vs-local.md); the per-entity breakdown is in [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md).
