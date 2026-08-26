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
