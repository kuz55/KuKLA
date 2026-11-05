# Subject-profile manager workflow — acceptance script

**Status:** test script prepared; operator/field review is still required before the Subject roadmap item can be completed.

> Use synthetic records only. Do not enter real identifying or medical information until privacy/retention rules and production database/backup protections have been approved and verified.

## Preconditions

- A staging/test server with the current migrations and Tauri desktop build.
- A manager account with access to one test search.
- A `REGIONAL_MANAGER` explicitly assigned to one test search and not assigned to an unrelated search.
- A second manager without access to the test search, plus a `SEARCHER` and `VIEWER` who are members of it.
- An unrelated search with its own test subject profile.
- Synthetic values only; no photos or real medical details.

## Manager flow

1. Sign in as the manager with access to the test search and open **Профили пропавших**.
2. Confirm that the list is scoped to the selected search and that an empty search shows the empty state.
3. Open **＋ Добавить профиль**. Submit an empty form and confirm the validation message; enter only one coordinate and confirm it is rejected.
4. Enter a synthetic name/description and, if needed, a complete latitude/longitude pair. Save and confirm the new profile is shown.
5. Select **Изменить**, update the description, and clear a nullable field. Save and confirm the values returned by the server are shown.
6. Switch to another search and back. Confirm each search displays only its own profiles; the UI must not retain profiles from the previous search.
7. Confirm there is no photo-upload control or delete action.

## Authorization and audit checks

1. As a `SEARCHER` and as a `VIEWER` who belong to the search, try to list, create, and update a profile. Each operation must be denied by the server.
2. As the assigned `REGIONAL_MANAGER`, confirm the profile list and manager-only subject audit events are visible only in the explicitly assigned search.
3. As the unrelated manager and as the unassigned regional manager, request the profile list for the test search. The response must not reveal whether an inaccessible search exists.
4. Inspect the event log and snapshot as a manager: subject events may include the subject ID and updated field names, but never profile values.
5. Inspect the event log and snapshot as a non-manager member: subject events must be absent.
6. Attempt the documented API surface for photo upload and hard deletion. Neither capability is exposed; the existing `photo_url` column must remain untouched by this slice.

## Online-only failure checks

1. Load the profile list while the server is unavailable. The UI must show an error and must not display stale or offline-cached profiles.
2. During a save or post-save refresh failure, confirm that no request is queued for later replay. A failed refresh clears the in-memory list; no offline cache or command queue is supported.
3. Restore connectivity and reload explicitly. Confirm that only the server response is displayed.

## Sign-off still required

- A manager/operator reviews the end-to-end command workflow and accepts the UI wording and validation.
- The organization approves privacy, retention, and deletion rules for identifying and medical information.
- PostgreSQL, production backups, and audit/retention behavior are verified against the approved deployment configuration.
- The online-only degraded-network contract is reviewed before any real data or field use.

This script does not authorize field/mobile access, photo upload, hard deletion, or offline use. Those remain outside the current slice.
