# KuKLA Mobile (Flutter)

Minimal field-client prototype for authentication, search listing, task status updates and foreground GPS. The local cache/command queue is only a foundation: task/GPS snapshots, conflict handling, secure token storage, background GPS and offline maps are not complete.

Build on a workstation with Flutter and the Android SDK:

```bash
flutter pub get
flutter analyze
flutter build apk --dart-define=API_URL=https://your-domain.example/api/v1
```

The default development URL targets an Android emulator and a local Compose API at `http://10.0.2.2:18080/api/v1`. Set `API_URL` explicitly for other devices. Use HTTPS for remote deployments.
