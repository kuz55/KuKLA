# KuKLA implementation roadmap

This roadmap converts the product requirements and gap analysis into executable development waves.

## Wave 1 - Operational Core

- [x] Database foundation: subjects, operational periods, sectors, teams, assignments, clues, witnesses, resources, check-ins, notifications, sync operations.
- [x] Organization/device/hazard/evidence/emergency/AI job schema foundation.
- [ ] Subject API and command-center UI — **PARTIAL; do not mark complete yet.** The current scope is manager-only, search-scoped profile list/create/update in the desktop search view. PostgreSQL API tests cover authorization, audit privacy/rollback, and the desktop component tests cover search scoping, list/create/update, validation, and online-only failure states. Remaining gates:
  - [x] Prepare a synthetic-data manager workflow acceptance script (`docs/acceptance/subject-manager-workflow.md`).
  - [ ] Review and sign off the complete manager workflow and field acceptance scenario.
  - [ ] Have the responsible data owner and counsel approve the legal basis/notice, validate the product proposal of 3 years from profile creation, and approve deletion/anonymization rules; a software-only release may use synthetic data, but do not use real data before approval. Track decisions in the [policy proposal](acceptance/subject-data-policy-proposal.md) and [release approval checklist](acceptance/release-approval-checklist.ru.md).
  - [x] Add `REGIONAL_MANAGER` invitation-based onboarding and server-enforced scoped permissions. The role can manage only searches where it has explicit direct membership; organization membership alone is insufficient. Other non-privileged roles retain the existing active-organization access path. Regional managers cannot create searches, administer users/invitations, or bypass search access.
  - [ ] Define a structured region/project assignment model and review the requested global audit scope before granting cross-project audit or deletion-policy responsibilities; the current role does not confer these powers.
  - [x] Add desktop component tests for search-scoped list/create/update, validation, and online-only failure states; add API regression tests rejecting stored photo URLs and hard deletion.
  - [ ] Verify audit and retention behavior against PostgreSQL/production configuration; define separate audit-log retention and review responsibilities, then expand authorization and end-to-end tests.
  - [ ] Define the online-only degraded-network contract and test it before field use; no offline cache or command queue is in scope.
  - [ ] Only then revisit field/mobile access, photo handling, deletion, and operational readiness.
- [ ] Team API, membership and status lifecycle.
- [ ] Sector geometry API and editor.
- [ ] Assignment API linking team + sector + operational period + task.
- [ ] Briefing/debriefing workflow.
- [ ] Clue and witness API with restricted authorization.
- [ ] Resource registry and assignment.

## Wave 2 - Field Safety and Resilience

- [ ] Durable device registration.
- [ ] Idempotent sync protocol.
- [ ] Conflict detection and resolution.
- [ ] Live GPS reconnect and deduplication.
- [ ] Check-in scheduler and escalation.
- [ ] SOS/emergency workflow.
- [ ] Notification delivery and acknowledgement.
- [ ] Battery/network/GPS health reporting.

## Wave 3 - GIS Operations

- [ ] Sector drawing/editing.
- [ ] Search tracks and replay.
- [ ] Coverage calculation.
- [ ] POD model and reporting.
- [ ] Hazard layers.
- [ ] Managed offline map packages/cache.
- [ ] Map provider abstraction.

## Wave 4 - Organizations and Interoperability

- [ ] Organization management.
- [ ] Organization-scoped authorization.
- [ ] Mutual-aid invitations and permissions.
- [ ] External tracker adapter interface.
- [ ] Public locator with temporary, consent-based location sharing.
- [ ] Sanitized public incident portal.

## Wave 5 - Evidence, Archive and Analytics

- [ ] Evidence storage abstraction.
- [ ] Photo/video/audio metadata and integrity hashes.
- [ ] Search closeout.
- [ ] Immutable operational archive.
- [ ] Search replay.
- [ ] Coverage, task and response-time analytics.
- [ ] Exportable operational reports.

## Wave 6 - AI Assistance

- [ ] Secure OpenAI provider abstraction.
- [ ] Incident briefing generation.
- [ ] Operational event summarization.
- [ ] Contradiction and missing-information detection.
- [ ] Clue/photo classification assistance.
- [ ] Historical-search analysis.
- [ ] Human approval and audit for every operational recommendation.

## Wave 7 - Production Readiness

- [ ] Complete automated unit/integration/API tests.
- [ ] Migration verification in CI.
- [x] Verify native Tauri bundle CI for Windows MSI and Linux DEB.
- [ ] Run platform runtime smoke tests for native session-token storage through Windows Credential Manager and Linux Secret Service, including no plaintext fallback and unavailable-store behavior; CI bundle builds and desktop unit tests are not a substitute for exercising the actual OS stores.
- [ ] Mobile build checks, release signing, and macOS native packaging (planned for a later increment).
- [ ] Security scanning.
- [ ] Backup and restore drills.
- [ ] Observability and structured logs.
- [ ] Disaster-recovery runbook.
- [ ] Contributor documentation.

## Development rule

A capability is not considered complete when its database table exists. It is complete only when API, authorization, UI/field workflow, tests, audit behavior and degraded-network behavior are implemented and verified.
