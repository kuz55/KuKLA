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

Medical notes on a search subject (`subjects.medical_notes`) must **not** be collected, stored or displayed until data-at-rest encryption is in place on the client (SQLCipher with an OS key store). The column exists in the schema but remains unused until this condition is met. See [ADR-0001](adr/0001-data-ownership-server-vs-local.md).

Once encryption is in place, access to medical data is limited to the roles that manage the search lifecycle. The concrete list is `SYSTEM_OWNER`, `SUPERADMIN`, `SUPERUSER`, `ADMIN`, `LEADER`, `COORDINATOR` — that is, the server's existing `managementRoles` (`server/src/rbac.ts`). `SEARCHER` and `VIEWER` never receive medical data. This list must be reconfirmed before the medical feature ships.

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
