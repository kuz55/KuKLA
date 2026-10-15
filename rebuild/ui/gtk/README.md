# Native GTK desktop client

The operations page starts a Go engine next to the UI binary and communicates over a per-instance local IPC endpoint. It can create/list searches stored in SQLite; the profile page edits a consent-based local questionnaire, and the role page explains the current role catalog. Role assignment and account review remain disabled until verified phone authentication is connected.

## Linux build prerequisites

- GTK 4 development headers and libraries
- C compiler (GCC or Clang)
- `pkg-config`
- JSON-GLib development headers and library

Build the engine and UI into the same `build/` directory so the UI can launch the engine. Run `make build-engine build-ui` from `rebuild/`. CI compiles the Linux UI and creates a Windows portable ZIP containing the GTK runtime and third-party notices. The ZIP is a test artifact, not a signed installer.

The map panel is an empty-state page until the later WebView adapter is implemented: WebKitGTK on Linux, WebView2 on Windows. Both must load bundled/local resources only.
