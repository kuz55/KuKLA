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
- Tracks.
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

## Current implementation gap

The repository already implements the MVP foundation: authentication/RBAC, searches, members, tasks, events, GPS ingestion, map display, mobile local storage and an offline command queue. The operational-domain migration adds the persistent data model for the next capability layer, but API, UI and field workflows still need incremental implementation and tests.
