# KuKLA 2.1 status

This file separates the product target from behavior present in the repository. The project is an MVP in active transition; it is not a certified or field-ready rescue system.

## Working foundations

- Fastify/TypeScript API backed by PostgreSQL, with transactional/checksummed schema migrations.
- Email/phone plus password login, bcrypt password hashes, JWT-backed sessions, global roles and search-membership checks.
- Search CRUD, search membership, tasks, events, GPS ingestion/retrieval and a snapshot endpoint.
- Minimal legacy Tauri/React command UI and an OpenStreetMap view.
- Minimal Flutter field UI with foreground GPS and a local SQLite cache/command-queue foundation.
- Go/C + GTK4 engine with private local IPC, SQLite migrations, local search create/list/read, local questionnaire and role catalog.
- Docker Compose, backup/restore scripts and GitHub Actions for server, legacy desktop, Go and GTK builds.

## Target architecture

- `server/` + PostgreSQL remain authoritative for shared operational state.
- `rebuild/` (Go/C, GTK4) is the target desktop client. Its current local workflow is **not** yet connected to the server.
- `mobile/` (Flutter) remains the field client.
- `desktop/` (Tauri/React) is deprecated and is only a behavior reference until the Go/C client reaches parity.
- Redis is present in Compose but unused by current server code.

## Not yet field-ready

- Invitation delivery and target-client onboarding. Admin-only one-time API tokens plus a temporary create/revoke/accept flow exist in the legacy Tauri/React desktop client. Email/SMS delivery, Go/C and mobile screens, and request/approval workflows remain pending.
- Complete per-resource authorization, organization/team workflows, task assignment lifecycle, subject intake, sectors and operational-period management.
- WebSocket event fan-out, notifications, GPS idempotency and the end-to-end offline synchronization/conflict protocol.
- Mobile task/GPS snapshot persistence, secure token storage, background GPS service and managed offline maps.
- Go/C server authentication/synchronization, server-backed operations, maps, task screens, backup/restore and database encryption.
- Production observability, retention policy, restore drills, independent security review and field acceptance.

Do not use the current build as the sole coordination or safety system for a live rescue operation. Continue with [ARCHITECTURE.md](ARCHITECTURE.md), [GAP_ANALYSIS.md](GAP_ANALYSIS.md) and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) when planning the next product increments.
