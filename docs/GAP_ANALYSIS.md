# KuKLA capability gap analysis

This document maps the proposed operational capability model to the current repository state.

Legend:
- **DONE**: usable foundation exists.
- **PARTIAL**: foundation exists, but important operational behavior is missing.
- **MISSING**: no implemented product capability found.
- **FOUNDATION**: data model added in the operational-domain migration; API/UI still required.

| Capability | Current state | Next implementation |
|---|---|---|
| Authentication | PARTIAL | harden secrets, sessions, rate limits, lifecycle |
| RBAC | PARTIAL | resource-level authorization and organization scope |
| Search lifecycle | DONE | formal incident model and transitions |
| Subject profile | MISSING | subject API/UI and privacy policy |
| Organizations | MISSING | organization and membership model |
| Operational periods | FOUNDATION | API, briefing/debriefing UI |
| Teams | FOUNDATION | team API, membership and status workflows |
| Search sectors | FOUNDATION | geometry editor, assignment and status |
| Coverage / POD | MISSING | GIS coverage engine and reporting |
| Tasks | PARTIAL | team/sector assignments and workflow rules |
| GPS ingestion | DONE | device identity, deduplication, realtime fan-out |
| Realtime map | PARTIAL | WebSocket event model and reconnect strategy |
| Offline mobile | PARTIAL | durable sync protocol, conflict handling, device identity |
| Clues | FOUNDATION | field capture, photos, workflow and audit |
| Witnesses | FOUNDATION | restricted access, API/UI and audit |
| Resources | FOUNDATION | resource registry, assignment and status |
| Check-in | FOUNDATION | periodic check-in service and escalation |
| SOS | MISSING | emergency event, escalation and delivery acknowledgement |
| Notifications | FOUNDATION | delivery adapters and acknowledgement |
| External trackers | MISSING | adapter interface and provider integrations |
| Offline maps | PARTIAL | managed map packages/cache and provider policy |
| Hazards | MISSING | GIS hazard layer and field reporting |
| Public locator | MISSING | privacy-preserving temporary location session |
| Public portal | MISSING | sanitized read-only incident view |
| Archive | PARTIAL | formal close/archive and immutable history |
| Analytics | MISSING | operational metrics and reports |
| AI assistance | MISSING | isolated advisory module with human approval |
| Backup/restore | FOUNDATION | automated verification and recovery drills |
| CI/CD | PARTIAL | unified GitHub Actions pipeline and mobile build |
| Automated tests | PARTIAL | API, integration, mobile and sync tests |

## Implementation order

### Wave 1: operational core
- subject
- sectors
- teams
- task assignments
- operational periods
- clues
- resources

### Wave 2: field safety and resilience
- check-ins
- SOS
- notifications
- realtime event protocol
- durable offline sync
- device health

### Wave 3: GIS operations
- sector geometry
- coverage
- POD
- hazards
- managed offline maps

### Wave 4: organization and interoperability
- organizations
- mutual aid
- external trackers
- public locator
- public portal

### Wave 5: analysis and assistance
- archive
- analytics
- historical replay
- AI advisory services

Every wave requires API tests, authorization tests, migration tests and an explicit field acceptance scenario before being treated as operational.
