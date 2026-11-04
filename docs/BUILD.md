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

## Target desktop: Tauri + React

`desktop/` is the cross-platform native desktop client. React/Vite supplies the interface and Tauri packages it as a native application; Vite's browser dev server is a development tool, not the product delivery target. Windows and Linux native bundles are checked in CI; macOS packaging is planned but not yet verified. Build with Node.js 22+, Rust and the platform-specific Tauri prerequisites:

```bash
cd desktop
npm ci
npm run check
npm run test
npm run build
npm run tauri -- build
```

The packaged client defaults to the local Compose API at `http://localhost:18080/api/v1`; override it with `VITE_API_URL` when building against another server. In Vite development mode, the client uses relative `/api/v1` requests and the dev server proxies them to `VITE_DEV_API_TARGET` (default `http://127.0.0.1:18080`), so browser requests stay same-origin.

On Ubuntu, install Tauri's Linux dependencies: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev` and `librsvg2-dev`. For a specific package, use `npm run tauri -- build --bundles deb` on Linux or `npm run tauri -- build --bundles msi` on Windows.

## Go/C + GTK prototype

`rebuild/` is an experimental local-only prototype, not the target desktop client. It persists locally in SQLite and does not yet authenticate to or synchronize with the server. Its separate Go and GTK checks remain useful for that prototype.

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
