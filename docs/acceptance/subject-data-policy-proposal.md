# Subject data handling — policy proposal

**Status:** proposed engineering baseline; not legal advice, a privacy approval, or authorization to use real data. A responsible organization owner must approve the legal basis, retention period, and deletion procedure before production collection.

## Scope

This proposal applies only to the current online, manager-only subject-profile slice: search-scoped list, create, and update. It does not authorize field/mobile access, photo uploads, hard deletion, offline caching, or command queuing.

## Proposed safeguards

1. **Purpose limitation:** collect information only to support the specific active search. Use synthetic records in development, CI, demos, and acceptance testing.
2. **Data minimization:** use only the fields in the current API. Do not add new identifiers or attachments without a separate review.
3. **Access control:** allow only server-authorized management roles that also have access to the relevant search. Interface hiding is not an authorization control.
4. **Audit minimization:** subject audit metadata may contain the subject ID and changed field names, never profile values. Keep subject audit entries hidden from non-manager event and snapshot readers.
5. **Online-only handling:** fetch from the server; do not persist Subject profiles in a desktop cache or retry queue. If a list refresh fails, clear the in-memory list and show an error.
6. **Medical information hold:** do not enter real medical notes until production PostgreSQL storage and backup protections have been verified and the organization has approved the privacy and retention rules.
7. **No deletion claim:** the current API has no delete endpoint. Do not claim that data is deleted on search closure or provide a manual deletion workaround until an approved retention/deletion procedure exists.

## Decisions required before real data

| Decision | Proposed status | Required owner action |
|---|---|---|
| Legal basis and notice for identifying/medical data | Open | Approve with the responsible organization and counsel |
| Retention period for open and closed searches | Open; no duration is invented here | Set and record the period and the event that starts it |
| Deletion/anonymization procedure | Open; no API is provided | Approve a procedure consistent with the no-hard-delete feature boundary |
| PostgreSQL and backup encryption/access controls | Not verified | Verify against the actual production deployment |
| Audit retention and operational review | Not verified | Define, test, and record the production procedure |
| Real-data launch authorization | Not granted | Require all preceding decisions and verification to be complete |

Until these decisions are recorded and verified, this proposal is an implementation guardrail only. The Subject roadmap item must remain **PARTIAL**.
