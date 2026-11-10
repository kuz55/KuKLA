# Build matrix

The build matrix describes current code, not the full target product. In particular, `rebuild/` is still a local-only prototype and is not synchronized with the server.

## Server

Node.js 22+ and PostgreSQL for integration tests:

```bash
cd server
npm ci
npm run lint
npm run build
npm test
```

`npm test` includes database/API integration cases and expects a migrated PostgreSQL database plus a running server. The new config/validation/RBAC unit cases can be run independently after `npm run build`:

```bash
node --test test/config.test.mjs test/validation.test.mjs test/rbac.test.mjs
```

## Target desktop: Go/C + GTK4

Use the Go version specified by `rebuild/go.mod`, `make`, a C compiler, GTK4 and JSON-GLib development libraries:

```bash
cd rebuild
make test
make vet
make build-engine
make build-ui
```

The current desktop workflow persists locally in SQLite. It does not yet authenticate to or synchronize with the server.

### Windows x64 package

The [Windows build instructions](../rebuild/README.md#portable-windows-x64) describe the Go + MSYS2 UCRT64 prerequisites and packaging commands. A successful GitHub Actions run publishes the portable `KuKLA-windows-x64` artifact for 30 days. Extract it completely and launch `KuKLA.exe`; the package includes the GTK runtime and does not require a separate GTK installation. The build is unsigned, local-only, and its database is not encrypted.

## Legacy desktop: Tauri + React

`desktop/` is deprecated and retained as a behavior reference. Build the frontend with Node.js 22+; a native package also requires Rust and Tauri's platform dependencies:

```bash
cd desktop
npm ci
npm run check
npm run build
npm run tauri build
```

The local Compose API default is `http://localhost:18080/api/v1`; override it with `VITE_API_URL` when building against another server.

## Mobile: Flutter

Flutter and Android SDK are required. Platform-generated folders are not vendored in this repository:

```bash
cd mobile
flutter create .
flutter pub get
flutter analyze
flutter build apk --dart-define=API_URL=https://your-domain.example/api/v1
```

For an Android emulator connected to the local Compose stack, the default API URL is `http://10.0.2.2:18080/api/v1`. Remote devices must use the HTTPS endpoint of a configured deployment.
