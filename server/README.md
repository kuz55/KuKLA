# KuKLA Server

Fastify API. Run locally with `npm install && npm run dev`. Environment variables are documented in `.env.example`.

## Experimental intake foundation (development only)

Migrations 010–013 add storage and an internal handoff audit for initial
reports. The experimental API is **disabled by default and cannot be enabled
when `NODE_ENV=production`**. Setting `KUKLA_ENABLE_EXPERIMENTAL_INTAKE=true`
registers the routes in non-production environments only. It must only be used
with synthetic data: it is not a finished or security-audited intake system.

Authentication is required and no existing role receives access automatically.
Intake operator and registrar operations check an explicit `intake_permissions` entry, under a row lock
inside the transaction: `RECORD` for creating a report and handing off a report
created by that actor, `REGISTER` for listing and viewing handed-off reports.
The table starts empty and there is intentionally no administration UI/API yet.
The intended future role mapping and permission management require approval.

Experimental endpoints (all responses use `Cache-Control: no-store`):

- `POST /api/v1/intake/reports`: all six fields `applicantName`,
  `applicantContact`, `missingPersonName`, `lastSeenTime`, `lastSeenPlace`,
  `situation` must be present; each is a nonblank string or `null` (unknown).
  Server storage determines the receipt time. Returns only ID and time.
  Requires an `Idempotency-Key` header containing a UUID generated once per
  logical creation and reused on retry. Same actor, key and normalized input
  returns the original result; a different payload with that key returns 409.
  Different actors have independent key namespaces. The keyed fingerprint is
  derived using the current `JWT_SECRET`; changing the secret causes old retries
  to return 409 rather than create duplicates. Production key management and
  rotation still require design before enabling this workflow.
- `POST /api/v1/intake/reports/:id/handoff`: author hands off once; a repeated
  call by the same authorized author returns the original result without a
  duplicate audit event. An unknown or foreign report returns 404. Create and
  handoff write non-PII audit records atomically with the change.
- `GET /api/v1/intake/my-reports/:id`: a `RECORD`-permitted operator can view their own report, including before handoff; foreign IDs return 404. This does not grant access to other operators’ reports.
- `GET /api/v1/intake/searches/:id/reports?limit=100&after=<report-id>`: active, eligible assigned coordinators can view handed-off reports linked to that search, including applicant contact; foreign searches return 404. The eligibility and assignment are checked within the read transaction. Pagination limit is 1–100. The route is experimental, requires intake to be enabled and does not grant access to legacy search APIs.
- `GET /api/v1/intake/queue?limit=100&after=<report-id>`: registrar view, only
  IDs and timestamps for unresolved handed-off reports, cursor pagination (limit 1–100).
- `GET /api/v1/intake/reports/:id`: registrar can view a handed-off report;
  drafts are inaccessible to registrars. Unknown and draft IDs return 404.
- `POST /api/v1/intake/reports/:id/link-search` with `{ "searchId": "…" }`:
  link a handed-off unresolved report to an existing search already accessible
  to the registrar. Unknown and inaccessible searches are indistinguishable.
- `POST /api/v1/intake/reports/:id/create-search` with `{ "title": "…" }`:
  create a planned search, add the registrar as a member, and link the report.
- `POST /api/v1/intake/reports/:id/close` with `{ "reason": "…" }`: close an
  unresolved handed-off report without a search; a nonblank reason is required.
  The reason and actor are included in the restricted report audit.

Resolution is atomic: a report can be resolved only once, with a search link
or a close reason. Competing requests are serialized by a row lock; the loser
gets 409. Creating a search, membership, event, linking, and report audit are
committed or rolled back together. Resolved reports leave the unresolved queue;
a previously issued pagination cursor remains usable after resolution.

The workflow has no client UI, registrar UI and follow-up processing,
SMS, report editing, inbox notifications, offline sync and idempotency for other operations,
production deployment controls, retention, or full authorization model. The
existing database is not a substitute for a verified PII protection strategy.
No real applicant information should be entered. PGlite tests exercise SQL and
HTTP behaviour in isolation; PostgreSQL CI tests separately exercise the
migration runner, concurrent resolution, and the HTTP intake workflow against a real PostgreSQL database. This is not a security or concurrency audit.

## Experimental coordination foundation (development only)

Migrations 014–015 add explicit coordinator eligibility, per-search assignments,
pending transfers and a private notification inbox. No user is eligible automatically, including users with
existing system role `COORDINATOR`. There is no approved mapping or role-grant
administration yet. `KUKLA_ENABLE_EXPERIMENTAL_COORDINATION=true` registers the
routes only outside production. Use synthetic data only.

- `POST /api/v1/coordination/searches/:id/claim` lets an eligible coordinator
  claim an unclaimed search. Concurrent claims yield one primary; the loser
  receives HTTP 409 and the primary's ID. Retrying the winner is harmless.
- `GET /api/v1/coordination/searches/:id` lists assignments only for an eligible
  assigned coordinator; `POST .../additional` adds another eligible coordinator.
- `POST .../transfer` requests transfer with `userId`, `retainPrevious` and a
  nonblank `reason`. Main and additional coordinators can initiate it. The old
  primary remains until the target accepts. Explicit `retainPrevious` controls
  whether the former primary remains as an additional coordinator.
- The eligible target can view, accept or decline a pending transfer via
  `GET .../transfer`, `POST .../transfer/accept` and `POST .../transfer/decline`.
  An assigned coordinator can cancel via `POST .../transfer/cancel` with a
  nonblank `reason`. A revoked initiator cannot complete a pending transfer.
- `GET /api/v1/coordination/notifications` returns the eligible user's unread
  transfer notifications, paged by `limit` and `after`. A notification can be
  acknowledged through `POST /api/v1/coordination/notifications/:id/acknowledge`;
  retries return the original acknowledgement timestamp. It cannot be accessed
  by another recipient. The inbox copies no applicant details or reasons.
  Transfer request, acceptance, decline and cancellation create the relevant
  inbox entries transactionally alongside state changes and audit events. Each
  alert includes a transfer ID to distinguish stale alerts from later requests.

Changes and events are transactional; the primary is unique per search.
Coordinator eligibility is independently checked on every request. **These
experimental assignments do not grant access to the existing search API** and
are not a full role model: administration of eligibility, push/SMS delivery, client polling and display,
revocation/replacement of an unavailable primary, client UI, retry-safe transfer
acceptance and the complete search closure process are not implemented. They do not change legacy
search permissions or enforce the agreed closure policy. Full authorization,
security review and real PostgreSQL production checks are required before use.
The stored inbox is not a push channel, proof of reading or a delivery guarantee.

## Experimental field-lead foundation (development only)

Migration 016 introduces separate field-lead eligibility, one confirmed field
lead and at most one pending proposal per search. No eligibility is granted
automatically and no administration UI exists. Set
`KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD=true` outside production to register the
following authenticated endpoints (all responses are `no-store`):

- `POST /api/v1/field-lead/searches/:id/proposals` with `candidateId`: a
  registrar with explicit `REGISTER` permission can propose the initial lead;
  a registrar or assigned eligible coordinator can propose a replacement.
- `GET .../proposals/mine`: the proposed user can view their pending proposal.
- `POST .../proposals/accept` or `.../decline` with `proposalId`: only the
  candidate can decide; an old proposal ID cannot decide a newer proposal.
  Acceptance checks that the candidate is still active and eligible. The old
  lead remains assigned until acceptance; decline does not change assignment.
- `POST .../exceptional-removal` with nonblank `reason`: an active assigned
  coordinator can remove the current lead, and the reason is audited.

Transitions, search locking and audit are transactional. This is an incomplete
foundation: delivery, UI, administrative grants and access integration with groups/tasks are missing. Pending proposals to unavailable or ineligible candidates require manual cancellation. There is no verified check that
an exception is warranted; the responsible coordinator supplies the reason.
Do not use for real operations. No real personal data should be entered.


## Field-lead retries and notifications (experimental)

Migrations 017–019 add acceptance receipts, a private event inbox and a best-effort reminder worker. Acceptance retries return the original historical receipt and do not restore an old assignment. A registrar or assigned eligible coordinator can cancel a pending proposal with a reason through `POST /api/v1/field-lead/searches/:id/proposals/cancel` (`proposalId`, `reason`); the current lead is unaffected.

`GET /api/v1/field-lead/notifications` and `POST /api/v1/field-lead/notifications/:id/acknowledge` provide private cursor-paginated unread events and idempotent acknowledgement. Candidate eligibility or manager rights are rechecked on reads. The inbox contains IDs and types, never report details or reasons. Proposal, acceptance, decline and cancellation notifications are written transactionally with their respective changes. Acceptance and decline notify the proposer, assigned coordinators and active registrars who resolved linked reports. If a search has no linked report and was proposed by a coordinator, there is no reliable designated registrar to notify.

When the experimental field-lead API is enabled outside production, a worker polls every 30 seconds for proposals unanswered for at least ten minutes and records `NO_RESPONSE` events in the inbox. The reminder is recorded once per proposal with its marker in one transaction; a failure rolls back and can be retried. Execution depends on a running server and database, and may be delayed after outages or backlog. An inbox entry is not push delivery, proof of reading or a guarantee that an active registrar received it. Entries can become stale; clients must query current state. There is no delivery UI, agreed registrar assignment model, full notification escalation, production deployment or security audit. Never use with real personal data.

**Search status safety:** the legacy `PATCH /api/v1/searches/:id` rejects any
request containing `status` with HTTP 409, including mixed metadata/status
updates. This is a temporary fail-closed restriction, not an implementation of
the agreed close/reopen process. Other search and task endpoints are still
experimental and do not yet enforce the complete approved workflow; do not use
this server for real searches or personal data.

## Experimental search closure (development only)

Migration 020 and `KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE=true` enable a
separate API only outside production. It relies on the explicit coordinator and
field-lead eligibility/assignment tables; the flag does not configure those
roles or enable their other APIs. All responses are `no-store`:

- `POST /api/v1/search-closure/searches/:id/confirm` with `{}` records readiness
  from the current active, eligible field lead. A retry for the same assignment
  does not create another event. Replacement, including a later reappointment
  of the same person, invalidates the old confirmation.
- `POST .../close` with `{}` closes only with a valid confirmation; alternatively
  provide `exceptionReason` (nonblank) when no valid confirmation exists. An
  active, eligible coordinator assigned to this search, primary or additional,
  must perform it. Closure sets `COMPLETED`, records the actor and confirmation
  or exception, and consumes confirmation in the same transaction.
- `POST .../reopen` with a nonblank `reason` requires the same coordinator
  authority. This experiment restores the exact previous open status rather than
  assuming activation. A legacy `COMPLETED` search without a closure record cannot
  be reopened through this API. A new confirmation is required to close again.

This is not the complete agreed process. SMS, an outbox/retry/delivery and
contact-grant/revocation functionality are **not implemented**; there is no
client interface, offline idempotency for close/reopen, complete status model,
or secure unified authorization on legacy routes and audit events. A repeated
close or reopen returns 409 rather than a delivery receipt. Other experimental
workflows are not yet frozen when a search is closed. Do not enable for real
personal data or use it as evidence of production readiness.
