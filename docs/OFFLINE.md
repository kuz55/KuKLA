# Offline-first clients and synchronization

> The server/local boundary is fixed by [ADR-0001](adr/0001-data-ownership-server-vs-local.md);
> the per-entity breakdown is in [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md).

## Principle

The server remains the source of truth. The client's local store (SQLite) serves two purposes:

1. **read cache** — data received from the server, so the interface works without connectivity;
2. **outbound command queue** — actions performed offline, waiting to be sent.

The local store is not a second source of truth and does not hold roles.

## Local queue (outbox)

- Each command is written in a single transaction together with its action and a local audit record.
- A command contains: UUID, idempotency key, type, target entity, client-created time, author, entity version and payload.
- An action performed offline is not lost: the interface shows the queue and the time of the last attempt.
- Re-sending with the same idempotency key does not create a duplicate.

## Retry and acknowledgement

- Only transient network and file errors are retried, with exponential backoff and jitter.
- Business conflicts are not retried automatically.
- Synchronization statuses: `RECEIVED`, `APPLIED`, `REJECTED`, `CONFLICT`.
- An explicit server acknowledgement closes the queue entry.

## Conflicts

- A server record **never silently overwrites** a local one.
- Both versions are kept; resolution is made by an authorized user and audited.
- Last-write-wins is **not** applied to SOS, search status, assignments, witnesses, geometries or evidence.

## Limits of the offline mode

A fully offline client cannot:

- deliver an SOS or alert to an external recipient;
- show other members' positions in real time;
- receive data that is not already in the local cache.

When connectivity is lost the application stores the event locally, visibly marks it as **undelivered**, and does not report a false acknowledgement to the sender or recipient. SOS delivery acceptance is verified separately on a real channel; a simulator is not evidence of delivery.

## Identifiers and time in transit

- Identifiers are exchanged as UUID text.
- `recorded_at` (observation time) is stored separately from `received_at` (receipt time), so delayed and offline points can be replayed without rewriting history.
- Time is UTC; local time is used for display only.

## Position source

The `source` field distinguishes `DEVICE`, `MANUAL`, `SIMULATION` and `IMPORT`. An imported or simulated position is **never** presented as a live device GPS reading.

## Mobile client

The mobile app caches search lists and tasks in SQLite. GPS and task-status commands are written to a local queue when network requests fail; a background timer attempts to flush the queue while the app is running.

For production, add platform background execution, durable sync cursors and explicit server acknowledgements before relying on unattended background tracking.

## Open decisions

The following are **not yet decided** and require the project owner:

- retention period for the local cache and queue;
- maximum local storage size before mandatory cleanup;
- conflict-resolution rules per entity type;
- GPS point and track retention period (see also [`OPERATIONS.md`](OPERATIONS.md)).
