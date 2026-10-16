# KuKLA Go/C rebuild (foundation stage)

This directory is the parallel implementation of the approved local desktop architecture. Existing TypeScript/Rust/Flutter/PostgreSQL sources remain intact as reference material until feature parity and migration gates are passed.

## Current scope

Implemented in this foundation increment:

- Go domain value types for known search/task statuses and field-position sources;
- validation for known coordinate ranges, title length and task-priority range;
- application-level search creation contract preserving the known defaults: `PLANNED`, creator becomes a search member, and `SEARCH_CREATED` audit is part of the same unit of work;
- XDG/AppData path resolution and owner-only directory creation on POSIX;
- private Unix-domain listener and a minimal non-sensitive health endpoint;
- C/GTK4 desktop shell with navigation and explicit empty states.

Not implemented yet: SQLite/SQLCipher persistence, full RBAC, operations/tasks APIs, map renderer, actual report templates, media pipeline, notifications, sync, and Windows named-pipe/WebView2 adapters. Empty-state pages are not substitutes for those features.

## Project layout

```text
rebuild/
  cmd/kukla-engine/              Go engine entry point
  internal/domain/               typed operational models and validation
  internal/application/           use cases and repository/unit-of-work ports
  internal/config/                XDG/AppData paths
  internal/ipc/                   local IPC platform adapter
  internal/httpapi/                private health endpoint
  ui/gtk/                          C GTK4 desktop shell
  Makefile
```

## Build and test (development machine)

Go 1.27.x and the target platform C/GTK4 development libraries are required. No dependency is fetched at runtime.

```sh
cd rebuild
make test
make vet
make build-engine
make build-engine-windows
make build-ui
```

The current execution sandbox does not contain Go, GTK4 headers, or `pkg-config`, and package downloads are unavailable here; these commands have not been run in this sandbox. Install dependencies on an isolated developer/build VM before treating this milestone as build-verified.

Run the local engine on Linux:

```sh
./build/kukla-engine
```

The engine binds only to `$XDG_RUNTIME_DIR/kukla/engine.sock` (or a private fallback under the app state directory); it does not open TCP ports. Its only route in this milestone is `GET /v1/health` over the private socket. The Windows listener is deliberately a compile-time placeholder and must be replaced by an ACL-protected named pipe before Windows runtime acceptance.

## Data paths

Linux:

- config: `~/.config/kukla/`
- data/database: `~/.local/share/kukla/`
- media/maps: subdirectories under the data root
- cache: `~/.cache/kukla/`
- logs/state: `~/.local/state/kukla/`

Windows path policy is implemented in the resolver for `%APPDATA%` and `%LOCALAPPDATA%`; NTFS ACL, Credential Manager/DPAPI, GTK runtime, WebView2 and installer integration remain follow-on tasks.
