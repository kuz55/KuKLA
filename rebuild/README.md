# KuKLA Go/C desktop (first local workflow)

This directory is the parallel implementation of the approved local desktop architecture. Existing TypeScript/Rust/Flutter/PostgreSQL sources remain intact as reference material until feature parity and migration gates are passed.

## Current scope

Implemented in this increment:

- Go domain value types for known search/task statuses and field-position sources;
- validation for known coordinate ranges, title length and task-priority range;
- application-level search creation preserving known defaults: `PLANNED`, creator becomes a search member, and `SEARCH_CREATED` audit is part of the same database transaction;
- SQLite storage with checksummed, ordered migrations, foreign keys, WAL, bounded search listing, and search/member/audit persistence;
- XDG/AppData path resolution, a private Unix socket on Linux, and an owner-only Windows named pipe;
- local HTTP API over IPC for health, create/list/read search, and orderly shutdown;
- consent-based local user questionnaire (name, date, city, skills, transport and emergency contact), with review status reset after edits;
- the eight role identifiers and tested role-management policy matching the existing server contract;
- C/GTK4 desktop screens that start the Go engine, create/list local operations, and edit the local questionnaire.

Not implemented yet: phone/SMS sign-in, authenticated role assignment and review, task/group APIs and screens, map renderer/offline map packages, request intake, media pipeline, notifications, sync, backup/restore, and database encryption. The roles endpoint is a catalog, not an authorization boundary; authenticated user identity is required before role assignment can be enabled. Medical notes are deliberately excluded until encryption at rest is implemented. The profile is local to the current OS account and its database is not encrypted.

## Project layout

```text
rebuild/
  cmd/kukla-engine/              Go engine entry point
  internal/domain/               typed operational models and validation
  internal/application/           use cases and repository/unit-of-work ports
  internal/config/                XDG/AppData paths
  internal/ipc/                   local IPC platform adapter
  internal/httpapi/                private local API
  internal/storage/sqlite/         SQLite repositories and migrations
  ui/gtk/                          C GTK4 desktop shell
  Makefile
```

## Build and test (development machine)

Go 1.27.x, `make`, a C compiler, GTK4 development libraries, `pkg-config`, and JSON-GLib development files are required to build the full desktop client. Go module dependencies are pinned by `go.mod`/`go.sum`; no dependency is fetched while the app runs.

```sh
cd rebuild
make test
make vet
make build-engine
make build-engine-windows
make build-ui
```

On Ubuntu, install `build-essential`, `make`, `pkg-config`, `libgtk-4-dev`, and `libjson-glib-dev`. On Windows, use an MSYS2 UCRT64 environment with GTK4, JSON-GLib, GCC, `make`, and `pkgconf`. The CI workflow tests the Go engine on Windows and Linux, builds the GTK client on both platforms, and stages a portable Windows runtime bundle. GitHub Actions publishes the ZIP as a 14-day build artifact; it is not a signed installer.

Run the local engine on Linux:

```sh
./build/kukla-engine
./build/kukla-ui
```

The UI starts a per-window Go engine instance and closes it when the window exits. The engine uses a private Unix socket or a named pipe restricted to the current owner-rights SID; it does not open TCP ports. The API is local to this desktop process and does not yet provide application-user authentication or roles.

The first workflow creates a search with status `PLANNED`; the local installation is added as a member and a `SEARCH_CREATED` audit event is written in the same transaction. The search and questionnaire survive application restarts in local SQLite. Saving a profile requires explicit consent and clears its review flag. Role names and assignment policy are defined and tested, but there is intentionally no role-changing endpoint or UI until phone authentication can identify and authorize the actor.

## Data paths

Linux:

- config: `~/.config/kukla/`
- data/database: `~/.local/share/kukla/`
- media/maps: subdirectories under the data root
- cache: `~/.cache/kukla/`
- logs/state: `~/.local/state/kukla/`

Windows data files are stored below `%LOCALAPPDATA%\KuKLA`; credential storage, database encryption, and installer signing remain follow-on tasks. The portable Windows package is staged under `rebuild/build/windows/KuKLA` and launched with `KuKLA.cmd`.
