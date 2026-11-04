# KuKLA implementation status

This document records what is implemented in the current stabilization branch. It is intentionally separate from the product vision and roadmap.

## Implemented in this branch

- Server-side search access is scoped to privileged roles, search membership, or active organization membership.
- Search creation automatically adds the creator to `search_members`.
- Task reads require search access.
- Task updates require search access; searchers may update only tasks assigned to themselves and cannot reassign or reprioritize them.
- Task assignees must be members of the search.
- GPS, events, members, snapshots, and search details require search access.
- Offline snapshots check access and read all sections in one read-only repeatable-read transaction.
- WebSocket handshake requires an authenticated session.
- JWT authentication is backed by the `sessions` table, so logout/deactivation/revocation takes effect immediately instead of waiting for JWT expiry.
- Production startup fails when required secrets are left at development defaults.
- Public registration is disabled by default in production. The server requires `ALLOW_PUBLIC_REGISTRATION=true`; the legacy desktop UI additionally requires `VITE_ALLOW_PUBLIC_REGISTRATION=true` at build time.
- Legacy development seed accounts are disabled during upgrade.
- Database migrations are executed by a transactional migration runner with an advisory lock and SHA-256 checksums.
- A second migration run is expected to be a no-op.
- The runtime Docker image contains the SQL migrations and runs the migration runner before starting the server.
- The committed seed backup artifact has been removed.
- Desktop role controls are aligned with the server role hierarchy.
- Desktop defaults to the normal Compose API port `18080`.
- Desktop Tauri CSP is no longer disabled globally.
- RBAC policy has dedicated unit-test coverage. Administrative user changes re-check and lock the actor and target in a transaction; the change and its audit event commit atomically.
- GitHub Actions validates server build, migrations, tests, and desktop build/check.

## Known limitations

- Organization roles are a foundation; full permission objects and resource-level policy tables are not yet implemented.
- Admin-created, one-time invitation tokens and manager-only membership grants are implemented. The deprecated Tauri/React desktop client has temporary create/revoke and acceptance screens; email/SMS delivery, target Go/C and mobile screens, and request/approval workflow remain pending. Self-join is blocked.
- WebSocket currently authenticates and supports ping/pong, but the realtime event fan-out layer is not implemented.
- Offline sync conflict resolution is represented in the schema but not yet implemented end-to-end.
- Field GPS and mobile functionality require the future Flutter client.
- A real Linux host smoke test still requires access to the deployment machine.
