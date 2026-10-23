# KuKLA Product Requirements

## Product definition

KuKLA is an open-source operational platform for search-and-rescue organizations. The primary object is a search operation (incident), not a user or a map.

The system must provide a shared operational picture for command staff and field teams, including planning, assignments, location tracking, operational events and post-operation history.

## Core operational lifecycle

1. Register an incident and subject.
2. Capture last known information and initial intelligence.
3. Define the search area and priorities.
4. Create an operational period and briefing.
5. Organize teams and resources.
6. Divide the area into sectors.
7. Assign sectors/tasks to teams.
8. Track field teams and GPS positions.
9. Record clues, observations and witness statements.
10. Monitor check-ins, connectivity and emergency state.
11. Re-plan as new information arrives.
12. Close the operational period and search.
13. Produce debriefing, audit history and archive.

## Functional domains

### Identity and access
- Authentication and session management.
- Phone number and one-time code (OTP) sign-in as the primary field credential.
- Email and password sign-in remains available for organizations that operate without SMS.
- Public self-registration is disabled. Accounts are created by invitation or by an administrator.
- Phone numbers are normalized and stored in E.164 format.
- One-time codes are single-use, time-limited, rate-limited and audited. Provider secrets are supplied through environment variables and are never committed to the repository, written to logs, or embedded in the client.
- The session token is stored in the operating system credential store on desktop clients.
- Server-side RBAC.
- Least-privilege access to operational and personal data.
- Audit trail for security-sensitive actions.

### Organizations
- Organization ownership and membership.
- Future support for mutual-aid participation by other organizations.
- Isolation of organization data by authorization policy.

### Incidents and subjects
- Search lifecycle: planned, active, paused, completed, cancelled.
- One or more subjects per incident in future-compatible schema.
- Last known position, time, description, clothing, photo and operational notes.

### Command and planning
- Operational periods.
- Briefing/debriefing.
- Search sectors.
- Assignments and priorities.
- Common operating picture.

### People and teams
- Search members.
- Teams and callsigns.
- Team types: foot, vehicle, K9, UAV, air and other.
- Team status and leader.

### GIS
- Incident and last-known points.
- Teams and live positions.
- Tracks. Any user with access to a search operation may view the tracks of its members; access is governed by membership and role in the operation, not by point authorship.
- Sectors and assignments.
- Clues and hazards.
- Coverage/POD as a planned capability.
- Online and offline map layers without relying on unrestricted public tile scraping.

### Field operations
- GPS tracking with accuracy, altitude, speed and timestamp.
- Offline queue.
- Local cache.
- Retry and synchronization.
- Task execution.
- Clue reporting with coordinates and photos.
- Check-in.
- Emergency/SOS state.
- Device battery and network status where available.

### Intelligence and evidence
- Witness records with restricted access.
- Clues and observations.
- Photos and attachments.
- Hypotheses and decision support as a future module.

Medical notes on a search subject are not collected or displayed until data-at-rest encryption is in place.

### Communications
- Operational notifications.
- Broadcast alerts.
- Acknowledgement state.
- Future integrations with external communications systems.

### Resources
- Vehicles.
- K9.
- UAV and aircraft.
- Radios.
- Medical and other equipment.
- Resource status and assignment.

### Archive and analytics
- Immutable operational history where appropriate.
- Search replay/history.
- Coverage and task statistics.
- Post-operation analytics.

### AI assistance
AI may summarize, classify, detect inconsistencies and provide recommendations. AI must never silently become the operational decision-maker. Human command authority remains explicit.

## Non-functional requirements

- Offline-first field workflows.
- Safe recovery after network loss.
- Idempotent synchronization.
- Secure defaults.
- No secrets in source control.
- Database migrations must be repeatable.
- API contracts must be versioned.
- Important state changes must be auditable.
- Production deployment must support backup and tested restore.
- The application must remain usable under stress and degraded connectivity.

## Data ownership

Where each domain entity lives — server, client or both — is fixed by [ADR-0001](adr/0001-data-ownership-server-vs-local.md) and summarized in [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md). The server is the source of truth; the local database is a cache plus an outbound command queue and never stores authorizing roles.

## Current implementation gap

The repository already implements the MVP foundation: authentication/RBAC, searches, members, tasks, events, GPS ingestion, map display, mobile local storage and an offline command queue. The operational-domain migration adds the persistent data model for the next capability layer, but API, UI and field workflows still need incremental implementation and tests.

Two client implementations exist in parallel:

- `server/` (Fastify/TypeScript, PostgreSQL) is the authoritative contract and is extended, not replaced.
- `rebuild/` (Go/C, GTK4, SQLite) is the target desktop client. It implements a local workflow but is not yet connected to the server, and phone sign-in, role assignment, tasks, groups, intake, maps, media, notifications and synchronization are not implemented there yet.

`desktop/` (Tauri/React) is deprecated and is retained as a behavior reference until the Go/C client reaches feature parity.
