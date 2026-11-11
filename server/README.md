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

This is not the complete agreed process. SMS, an outbox/retry/delivery and complete contact authorization are **not implemented**; there is no
client interface, offline idempotency for close/reopen, complete status model,
or secure unified authorization on legacy routes and audit events. A repeated
close or reopen returns 409 rather than a delivery receipt. Other experimental
workflows are not yet frozen when a search is closed. Do not enable for real
personal data or use it as evidence of production readiness.

The closure API also provides `GET /api/v1/search-closure/searches/:id/audit`
for an active eligible coordinator assigned to that search. It returns only
closure confirmation, close and reopen audit entries in descending event-ID
order, using `limit` (1–100, default 50) and the returned `nextCursor` as
`before`. Reasons can be sensitive, so field participants and unrelated users
cannot read this endpoint. It is not a general audit viewer. Until permissions
for other workflow events are defined, the legacy events and snapshot routes
expose an explicit allowlist of legacy event types, not experimental or future
unknown event types; those entries remain stored. The legacy event payloads and
other routes still need a full privacy review and are not safe for real data.

The application error handler logs a request identifier and status for server
errors without serializing raw exceptions, which can contain database values.
This deliberately reduces diagnostic detail; other components and logging paths
still require review, and this is not a comprehensive data-protection guarantee.


## Experimental applicant-contact grants (development only)

Migration 021 and `KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS=true` enable
a narrow, separate API outside production. An active assigned coordinator
may grant a current active search member access to the contact from one
linked report, with a mandatory reason. This per-report scope is deliberately
more restrictive when multiple applicants are linked to one search; it does
not automatically grant the contact from every report. No complete report
or other applicant fields are returned to the grantee.

Under `/api/v1/contact-access/searches/:id/reports/:reportId`, POST `/grants`
with `{userId, reason}`, POST `/revoke` with `{userId}`, and GET `/contact`
are authenticated and `no-store`. Duplicate grant or missing revoke returns
an error, not an offline retry receipt. `GET /api/v1/contact-access/searches/:id/audit`
shows explicit grant/revoke events to assigned eligible coordinators only, with
`limit` and `before` paging as in the closure audit. Contact values are not
copied into events. Membership removal cascades grants; the user deactivation
API removes them in its transaction, so rejoining or reactivation does not
restore them. Closure removes all grants in its transaction and reopen never
restores them. Closure records the number removed; membership/user changes are
recorded by the existing events, not as per-grant revoke entries.

Important limitations: accepted field leads do not automatically become legacy
search members; no safe participant administration is implemented yet.
Deactivation outside the application API is not a supported administrative
workflow. The experiment does not fix the legacy role matrix, other endpoints,
offline copies or application UI, and cannot ensure data already viewed is
erased. SMS and end-to-end production safeguards remain incomplete. Do not use
real applicant data.

Authentication checks a valid JWT against the session database on every request.
If that database is unavailable, protected endpoints fail closed with HTTP 503
rather than reporting a revoked session as 401. No raw database error is returned.
An actually invalid or revoked session still receives 401. This distinction
helps clients report outages without treating them as a credential failure.

## Experimental leadership and eligibility management

Migration 022 introduces `leadership_eligibility`, empty by default. An active
user with that explicit authority can grant or revoke `COORDINATOR` and
`FIELD_LEAD` operational eligibility through the development-only flag
`KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY=true`. A legacy `LEADER` or system admin
role alone does not imply it. There is no production bootstrap or interface for
this authority; integration tests seed it directly into a disposable database.
Do not establish it by modifying a real database.

Authenticated `GET /api/v1/eligibility/users/:id` returns the target's active
and two eligibility flags. `POST .../grant` and `POST .../revoke` accept
`{"kind":"COORDINATOR"}` or `{"kind":"FIELD_LEAD"}`. Mutations and audit
events are transactional; repeats without a change do not duplicate events.
Grant requires an active target. All responses are `no-store`.

**Temporary restriction:** revocation returns 409 if the target has relevant
assignments or pending proposals/transfers; grant similarly refuses stale
assignments left by out-of-band removal. This avoids silently breaking a
handover or reviving old authority, but is not the complete agreed role-change
process: current flows do not offer a safe removal for every situation,
particularly unavailable coordinators. The authenticated `GET /api/v1/eligibility/audit` endpoint lets an active
leader page through grant/revoke audit entries; it has no client UI yet. This is not a role-administration UI or a complete access matrix,
and existing endpoints still use legacy permissions. Do not use real data.

## Experimental field groups (development only)

Migration 023 and `KUKLA_ENABLE_EXPERIMENTAL_GROUPS=true` enable a partial
server workflow outside production. The current active, eligible field lead can
create a group and propose its lead from active search members. The candidate
must accept before becoming group lead; rejection leaves the group without one,
and the field lead can propose another candidate. Acceptance also adds the
lead to the approved group roster. A coordinator does not create groups or
approve rosters through this API.

The confirmed, active group lead can propose adding an active search member or
removing a search member, including one who has been deactivated. The field lead can approve or reject the proposal, or directly
change the roster. Proposals alone never alter membership; approval rechecks
that the proposer is still the active lead. The group lead cannot be removed
through the roster operation. All changes and audit events are transactional.
Legacy search-member removal returns 409 while the member is referenced by a
group or group proposal; database constraints also prevent dangling references.
Deleting an entire search still cascades its groups.

Routes are under `/api/v1/field-groups/searches/:id`. The field lead creates a
group with `POST /groups` (`requestId`, `title`, `candidateId`). Migration 029
stores an immutable creation receipt: retrying identical data with the same
client-generated UUID returns the original group and proposal IDs, even after
the proposal is resolved, without repeating the creation event. Reusing the
key with changed data returns 409. The key is scoped to search and creator;
retries require current field-lead access and an open search. The returned
proposal ID is a historical receipt, not proof that it is still pending.
Groups predating migration 029 have no such receipt. A candidate reads
`GET /my-lead-proposals` and decides with `POST /groups/:groupId/lead-response`
(`proposalId`, `accept`). The field lead can propose another candidate with
`POST /groups/:groupId/lead-proposals` (`requestId`, `candidateId`). Migration
031 retains the proposal receipt: an identical authorized retry returns the
same proposal ID even after resolution, and a changed group or candidate under
the same key returns 409. Earlier proposals have no such receipt. Field lead and confirmed group leads
can list their authorized groups (`GET /groups`, `limit`, `after`) and inspect
`GET /groups/:groupId`; roster changes use `POST .../members/change`,
`POST .../member-proposals` and `POST .../member-decision`. Current field and
group leads can read `GET /groups/:groupId/audit` with `before` (event ID) and
`limit`, returning only selected group event types and fields. See the route
schemas for exact bodies. Responses are `no-store`.

This is **not a complete group process**: confirmed-lead replacement/removal,
notifications, a group-event audit UI, offline retry for roster changes
and client screens are missing. The separate task experiment below is incomplete.
Migration 030 retains the candidate's lead-proposal response: the same candidate
may repeat the same acceptance or rejection while still an active search member
and the search is open. Repeating the opposite decision returns 409. This is a
historical receipt and does not reinstate an old lead or proposal; proposals
resolved before migration 030 have no receipt. Search membership is
still the legacy model, not the final participant admission process. Groups
are inaccessible through this experimental API while the search is closed;
other legacy routes and complete access policy remain unreviewed. Do not use
real data or treat this as an operational system.

## Experimental group tasks (development only)

Migration 024 and `KUKLA_ENABLE_EXPERIMENTAL_TASKS=true` expose an independent,
non-production API using groups from migration 023. The active field lead assigns
an active group lead's group a task with description, explicit-offset deadline
and `NORMAL`, `HIGH` or `URGENT` priority. The group lead accepts, submits a
nonempty text result, and the field lead accepts it or returns it with a required
reason. Returned results remain in history. A group member can read the group's
tasks, but result history is restricted to the current group and field leads.
The computed `overdue` flag is true when the deadline has passed and the task
is not accepted; it does not change the task status. Audit events are written
in the same transaction without copying description, result or return reason
into the generic event log. All responses are `no-store`.

Under `/api/v1/field-tasks/searches/:id`: `POST /groups/:groupId/tasks`
accepts a client-generated UUID `requestId`, `description`, `priority`, and
`dueAt` (ISO 8601 with timezone); `GET` on the same path lists tasks. While the
search is open, a currently authorized field lead repeating the same request ID
and task data receives the original task ID without another task or audit event.
The key is scoped to the search and creator; reuse with different task data
returns 409. Equivalent timestamps with different offsets compare equal.
Existing tasks created before migration 026 have no creation receipt.

`POST /tasks/:taskId/accept` requires a client-generated UUID `requestId`;
`POST .../results` requires `requestId` and `result`. With migrations 027–028,
repeating the same request by the same currently authorized group lead returns
the original acceptance/result receipt without another transition or event.
A changed result using the same key returns 409. `POST .../decision` accepts
`resultId`, `approve`, and `reason` only for rejection. The same current field
lead can repeat the exact decision on that result; a different decision or
reason returns 409. Responses are historical receipts, **not current task
status**; read the task list to obtain current status. Previously accepted
tasks and results without request IDs cannot gain these receipts retroactively.
All retries recheck current permissions and require an open search.
`GET .../results` lists review history. These list endpoints support UUID
cursor `after` and `limit` up to 100. `GET .../audit` lets the current field or
group lead page task-specific transition events using `before` (event ID) and
`limit`; it returns actor, event type and time, not generic event payloads.
These limited receipts and audit are not an offline queue or a way to preserve
and resolve conflicting versions.

Migration 025 adds a private overdue inbox. With both the tasks flag and
`KUKLA_ENABLE_EXPERIMENTAL_TASK_REMINDERS=true`, a best-effort in-process
worker scans every 30 seconds while the application runs. It creates at most
one entry per overdue task and current active lead recipient, including both
the field lead and group lead when available. Concurrent scans deduplicate;
failed transactions can retry. `GET /api/v1/field-tasks/notifications` lists
currently applicable unread entries, and `POST /api/v1/field-tasks/notifications/:id/acknowledge`
acknowledges one. Entries contain identifiers, not task text; they are hidden
when the task is accepted, search closed, or the recipient loses the role.
An acknowledged entry is not reissued to that recipient for the same task.
This is **not notification delivery**: no push, client UI, delivery retry,
read guarantee or monitoring exists, and the worker does nothing when stopped.
The period is a development polling interval, not an agreed service level.

**Not a complete task system:** there is no notification delivery, task
edit/cancellation, individual work distribution, offline queue or conflict
resolution, UI or urgent text/icon presentation. Closed searches
are inaccessible through this experimental API; requests without an applicable
receipt or with changed content can return 409. Legacy task routes remain separate and do not
enforce this workflow. Do not use real personal data or operationally depend on
this API.
