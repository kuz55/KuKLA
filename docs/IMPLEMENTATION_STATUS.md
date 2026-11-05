# KuKLA implementation status

This document records what is implemented in the current stabilization branch. It is intentionally separate from the product vision and roadmap.

## Implemented in this branch

- Server-side search access is scoped to privileged roles and membership; `REGIONAL_MANAGER` requires explicit direct search membership, while other non-privileged roles may also use active organization membership.
- Search creation automatically adds the creator to `search_members`.
- Task reads require search access.
- Task updates require search access; searchers may update only tasks assigned to themselves and cannot reassign or reprioritize them.
- Task assignees must be members of the search.
- The initial subject-profile slice supports manager-only, search-scoped reads, creation and updates in the desktop command-center search view. Subject reads and writes revalidate current search-management access transactionally; create/update audit payloads omit profile values, and subject audit events are hidden from non-manager event and snapshot readers.
- Writes to existing searches revalidate the live session and actor role/status inside the transaction, hold the relevant session/user locks through commit, serialize with API membership changes per search, recheck access after lock waits, and check session expiry at commit. Mutation and audit records commit atomically.
- GPS, events, members, snapshots, and search details require search access.
- Offline snapshots check access and read all sections in one read-only repeatable-read transaction.
- WebSocket handshake requires an authenticated session.
- JWT authentication is backed by the `sessions` table, so logout/deactivation/revocation takes effect immediately instead of waiting for JWT expiry.
- Production startup fails when required secrets are left at development defaults.
- Public registration is disabled by default in production. The server requires `ALLOW_PUBLIC_REGISTRATION=true`; the Tauri desktop UI additionally requires `VITE_ALLOW_PUBLIC_REGISTRATION=true` at build time.
- Legacy development seed accounts are disabled during upgrade.
- Database migrations are executed by a transactional migration runner with an advisory lock and SHA-256 checksums.
- A second migration run is expected to be a no-op.
- The runtime Docker image contains the SQL migrations and runs the migration runner before starting the server.
- The committed seed backup artifact has been removed.
- `REGIONAL_MANAGER` can be assigned through the existing one-time invitation or administrator role-update flow. The server treats it as a search-management role only for searches where it has explicit direct membership; organization membership alone does not grant access. The role is not privileged, cannot create searches or administer global users/invitations, and has no all-project audit bypass.
- Desktop role controls are aligned with the server role hierarchy, display the regional-manager role, and keep user administration controls disabled for non-administrator managers.
- Desktop defaults to the normal Compose API port `18080`.
- Desktop Tauri CSP is no longer disabled globally.
- Subject-panel component tests cover search scoping, create/update requests, validation, fail-closed online-only errors, and the absence of photo/delete controls; API tests verify photo URLs are not accepted or stored and hard deletion is not exposed. No offline cache or queue is introduced.
- RBAC policy has dedicated unit-test coverage. Administrative user changes re-check and lock the actor and target in a transaction; the change and its audit event commit atomically.
- GitHub Actions validates server build, migrations, tests, desktop build/check, and native Tauri Linux DEB and Windows MSI bundles. macOS native builds are not configured yet.
- Native Tauri session-token storage now uses Windows Credential Manager or Linux Secret Service rather than WebView storage; legacy-token migration and failure behavior have desktop unit coverage. The resolved Rust dependency lockfile and Linux DEB/Windows MSI bundle builds are verified in CI; runtime smoke tests against the actual OS credential stores remain pending.

## Known limitations

- Organization roles are a foundation; full permission objects and resource-level policy tables are not yet implemented.
- Admin-created, one-time invitation tokens and manager-only membership grants are implemented. Regional-manager accounts can be onboarded by invitation but receive no search access until explicitly added to each search; organization membership alone grants no regional-manager access. A structured region assignment model is not implemented; the desktop search view provides per-search membership controls that call the server-authorized add/remove endpoints. The Tauri/React desktop client has temporary create/revoke and acceptance screens; email/SMS delivery, mobile onboarding screens, and request/approval workflow remain pending. The Go/C prototype is not connected to the server. Self-join is blocked.
- WebSocket currently authenticates and supports ping/pong, but the realtime event fan-out layer is not implemented.
- Offline sync conflict resolution is represented in the schema but not yet implemented end-to-end.
- Field GPS and mobile functionality require the future Flutter client.
- Subject profiles currently have no field/mobile access, photo upload, hard deletion, or offline/degraded-network behavior. Privacy/retention decisions, full workflow review, and production audit/retention verification remain outstanding; this is a narrow management-only slice, not operational rescue-coordination readiness, and its roadmap item remains incomplete.
- A real Linux host smoke test still requires access to the deployment machine.
