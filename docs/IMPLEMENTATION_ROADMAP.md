# KuKLA implementation roadmap

This roadmap converts the product requirements and gap analysis into executable development waves.

## Wave 1 - Operational Core

- [x] Database foundation: subjects, operational periods, sectors, teams, assignments, clues, witnesses, resources, check-ins, notifications, sync operations.
- [x] Organization/device/hazard/evidence/emergency/AI job schema foundation.
- [ ] Subject API and command-center UI.
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
- [ ] Mobile and desktop build checks.
- [ ] Security scanning.
- [ ] Backup and restore drills.
- [ ] Observability and structured logs.
- [ ] Disaster-recovery runbook.
- [ ] Contributor documentation.

## Development rule

A capability is not considered complete when its database table exists. It is complete only when API, authorization, UI/field workflow, tests, audit behavior and degraded-network behavior are implemented and verified.
