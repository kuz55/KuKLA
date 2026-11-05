# Operations runbook

## Status
`docker compose ps`

## Logs
`docker compose logs -f server`

## Restart
`docker compose restart server`

## Backup
`./scripts/backup.sh`

## Restore
`./scripts/restore.sh backups/<file>.dump`

## Update
`git pull && docker compose up -d --build`

Never run a destructive database reset against production.

---

## Rules fixed by decision

### Access to tracks

A track is operational data inside a search operation. **Any user with access to a search operation may view the tracks of its members.** Access is governed by membership and role in that operation, not by point authorship. There is no additional "own track only" restriction.

### Medical notes

The current manager-only subject-profile API/UI accepts and displays `subjects.medical_notes` through online server requests, but this is an incomplete implementation—not approval to collect real subject data. **Do not enter real subject or medical data** until privacy/retention rules, production PostgreSQL/storage and backup protections, audit verification, tests and the end-to-end workflow are reviewed and approved. The client has no offline/degraded-network support for this feature. Keep the roadmap item PARTIAL; see the [Subject data policy proposal](acceptance/subject-data-policy-proposal.md), [ADR-0001](adr/0001-data-ownership-server-vs-local.md) for the server/local boundary, and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) for completion gates.

The current API restricts access to search-management roles with access to the relevant search. The concrete roles are `SYSTEM_OWNER`, `SUPERADMIN`, `SUPERUSER`, `ADMIN`, `LEADER`, `COORDINATOR`, and `REGIONAL_MANAGER` — the server's `managementRoles` (`server/src/rbac.ts`); `SEARCHER` and `VIEWER` do not receive subject data. Regional managers must pass the normal direct-search or active-organization membership check, receive no global-search/audit bypass, and cannot create searches. No structured region assignment model or subject deletion endpoint exists. Server authorization does not settle the open privacy, retention, encryption, backup or operational-review requirements.

### Secrets

Provider secrets — SMS/OTP credentials, `JWT_SECRET`, `DATABASE_URL`, backup keys — are supplied through environment variables or a secret manager. They are never committed to the repository, written to logs, or embedded in a client build.

### Local roles

The local database on a client must not store authorizing roles. Authorization is decided by the server on every access; hiding interface elements is never treated as authorization.

> **Known discrepancy to fix in code.** The current local migration `rebuild/internal/storage/sqlite/migrations/005_users_and_profiles.sql` seeds a device row with the role `SEARCHER`. Under this decision that row must become a technical installation identity **without a role**. This is a code change and is deliberately not made in this documentation-only change; it is recorded here so the migration is corrected before any rights decision relies on it.

## Open items requiring an owner decision

The following operational parameters are **not yet fixed**. Numbers must not be invented during implementation; they must be decided and recorded here before the related feature ships.

| Item | Status | Notes |
|---|---|---|
| GPS point and track retention period | **Undecided** | Affects storage growth and personal-data obligations |
| Log retention (application, audit, sync) | **Undecided** | Rotation and maximum age |
| Backup schedule, RPO and RTO | **Undecided** | See also production requirements |
| Whether offline map packages are included in backups | **Undecided** | Large and reinstallable; can be recorded in the manifest instead of copied |
| Personal data deletion procedure | **Undecided** | Required before handling witness and subject data at scale |
| Backup encryption key ownership | **Undecided** | User passphrase versus OS key store |

## Production deployment (target)

The planned production host for the server is a TrueNAS system. Until deployment is configured:

- there is no VPN for remote administration, and NAS administration ports are **not** exposed to the internet;
- remote administration must be arranged through a VPN (for example Tailscale), never through direct port forwarding of the NAS administration panel or SMB;
- deployment must include migrations, health checks, data persistence and a documented rollback path.
