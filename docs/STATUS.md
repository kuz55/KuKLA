# KuKLA 2.1 status

This file separates the product target from behavior present in the repository. The project is an MVP in active transition; it is not a certified or field-ready rescue system.

## Working foundations

- Fastify/TypeScript API backed by PostgreSQL, with transactional/checksummed schema migrations.
- Email/phone plus password login, bcrypt password hashes, JWT-backed sessions, global roles and search-membership checks.
- Search CRUD, search membership, tasks, events, GPS ingestion/retrieval and a snapshot endpoint.
- Tauri + React command-center UI, OpenStreetMap view, invitation screens, and a manager-only search-scoped subject profile slice.
- Minimal Flutter field UI with foreground GPS and a local SQLite cache/command-queue foundation.
- Go/C + GTK4 local-only prototype with private IPC, SQLite migrations, local search create/list/read, local questionnaire and role catalog.
- Docker Compose, backup/restore scripts and GitHub Actions for server, desktop, Go and GTK builds.

## Target architecture

- `server/` + PostgreSQL remain authoritative for shared operational state.
- `desktop/` (Tauri/React) is the target native desktop client: Windows and Linux first; macOS packaging later.
- `mobile/` (Flutter) remains the field client.
- `rebuild/` (Go/C, GTK4) is an experimental local-only prototype, not connected to the server and not the product target.
- Redis is present in Compose but unused by current server code.

## Not yet field-ready

- Invitation delivery and target-client onboarding. Admin-only one-time API tokens plus a temporary create/revoke/accept flow exist in Tauri; mobile onboarding and email/SMS delivery remain pending.
- Complete per-resource authorization, organization/team workflows, task assignment lifecycle, subject intake, sectors and operational-period management.
- WebSocket event fan-out, notifications, GPS idempotency and the end-to-end offline synchronization/conflict protocol.
- Mobile task/GPS snapshot persistence, secure token storage, background GPS service and managed offline maps; the current Tauri session token remains in WebView `localStorage` pending OS credential-store support.
- Subject-profile privacy/retention decisions, production storage and backup protections, expanded automated tests, PostgreSQL/production audit verification, full workflow/field acceptance, and degraded-network behavior. Keep this roadmap item PARTIAL; field/mobile access, photo upload, hard deletion and offline use remain out of scope.
- Production observability, retention policy, restore drills, independent security review and field acceptance.

Do not use the current build as the sole coordination or safety system for a live rescue operation. Continue with [ARCHITECTURE.md](ARCHITECTURE.md), [GAP_ANALYSIS.md](GAP_ANALYSIS.md) and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) when planning the next product increments.
