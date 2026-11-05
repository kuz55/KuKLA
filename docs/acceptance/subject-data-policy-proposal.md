# Subject data handling — policy proposal

**Status:** proposed engineering baseline; not legal advice, a privacy approval, or authorization to use real data. Product directions recorded on 2026-11-05: manager-only target; three-year retention from profile creation; regional manager to define deletion/anonymization; audit access requested for the project author/superuser and regional manager across all projects/regions; regional-manager onboarding by invitation. The operator was described as an NGO/volunteer search group, but its exact legal entity and mandate were not provided. A responsible data owner and counsel must validate the policy before real-data collection.

A software-only release using synthetic data may precede the legal review. Real identifying or medical information must not be collected until the applicable legal basis, notice, retention/deletion rules, and production safeguards are approved and verified. The request to use real data before legal review is not authorized by this proposal.

## Scope

This proposal applies only to the current online, manager-only subject-profile slice: search-scoped list, create, and update. It does not authorize field/mobile access, photo uploads, hard deletion, offline caching, or command queuing.

## Proposed safeguards

1. **Purpose limitation:** collect information only to support the specific active search. Use synthetic records in development, CI, demos, and acceptance testing.
2. **Data minimization:** use only the fields in the current API. Do not add new identifiers or attachments without a separate review.
3. **Access control:** allow only server-authorized management roles that also have access to the relevant search. Interface hiding is not an authorization control.
4. **Audit minimization:** subject audit metadata may contain the subject ID and changed field names, never profile values. Keep subject audit entries hidden from non-manager event and snapshot readers.
5. **Audit access request:** project author/superuser and regional manager were requested as audit readers across all projects/regions. This global scope needs a least-privilege, privacy, and security review before implementation. Audit-log retention and review frequency are separate decisions and remain open.
6. **Online-only handling:** fetch from the server; do not persist Subject profiles in a desktop cache or retry queue. If a list refresh fails, clear the in-memory list and show an error.
7. **Medical information hold:** do not enter real medical notes until production PostgreSQL storage and backup protections have been verified and the organization has approved the privacy and retention rules.
8. **No deletion claim:** the current API has no delete endpoint. Do not claim that data is deleted on search closure or provide a manual deletion workaround until an approved retention/deletion procedure exists. The regional manager is nominated to define the procedure, but that role, its invitation-based onboarding, and the procedure are not yet implemented.

## Decisions and verification required before real data

| Decision | Current status | Required owner action |
|---|---|---|
| Legal basis and notice for identifying/medical data | Open; operator described only as an NGO/volunteer search group; exact entity, authority, data subjects, and source are unknown | Organization counsel and the responsible data owner must determine and document an applicable basis and notice for each data category. Review applicable personal-data rules (including Federal Law 152-FZ) and, for health information, applicable health-data/medical-confidentiality rules (including Federal Law 323-FZ). This proposal does not select a legal basis. |
| Profile retention period | Product direction: 3 years from profile creation; not yet validated by the responsible data owner/counsel | Confirm applicability to active and closed searches and define the action at expiry. This duration does not set audit-log retention. |
| Deletion/anonymization procedure | Regional manager nominated as the person to define it; procedure and role are not implemented; no delete endpoint exists | Define the procedure, triggers, access and evidence. Implement and verify it before any real-data collection; do not imply deletion is already supported. |
| Regional-manager onboarding | Invitation-based onboarding requested; role and client flow are not complete | Implement controlled, approved invitation and role assignment; do not enable unrestricted self-join. Define the manager’s region and project scope. |
| Audit access, retention, and review | Global access requested for project author/superuser and regional manager; audit retention is unspecified | Complete least-privilege/privacy/security review, define audit retention and review responsibility, then verify against the actual deployment. |
| PostgreSQL and backup encryption/access controls | Not verified | Verify against the actual production deployment. |
| Real-data launch authorization | Not granted | Require all applicable legal decisions and technical/operational verification to be complete. |

## Draft direction for counsel — not an approved legal basis

The operator’s stated NGO/volunteer status and search purpose alone are insufficient to establish a lawful basis. Counsel should identify the actual data controller and its authority, the subjects and sources of the records, the purpose and categories processed, and whether consent can validly be obtained from the subject or a legally authorized representative. Any statutory mandate or exception must be tied to the specific legal entity and activity; health-related data require a separate review. Do not treat this draft checklist as legal advice, and do not process real data until counsel and the responsible organization owner record their decision.

Until these decisions are recorded and verified, this proposal is an implementation guardrail only. The Subject roadmap item must remain **PARTIAL**.
