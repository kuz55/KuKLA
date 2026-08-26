# KuKLA Mobile
Flutter client for field participants. Build with `flutter pub get` then `flutter run --dart-define=API_URL=http://SERVER:8080/api/v1`.
Offline sync is designed as the next hardening layer; the API already separates commands/events so a local queue can be added without changing server contracts.
