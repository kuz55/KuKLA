# Build matrix

## Server
Node.js 22+

```bash
cd server
npm install
npm run build
npm test
```

## Desktop
Node.js 22+, Rust stable, Tauri 2 Linux dependencies.

```bash
cd desktop
npm install
npm run check
npm run build
npm run tauri build
```

## Mobile
Flutter 3.24+ and Android SDK.

```bash
cd mobile
flutter create .
flutter pub get
flutter analyze
flutter build apk --dart-define=API_URL=http://SERVER_IP:8080/api/v1
```

The source repository intentionally does not vendor platform SDKs, node_modules, Cargo registry data or Flutter caches.
