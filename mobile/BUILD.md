# Mobile platform setup

The Dart source is complete. Generate the standard Flutter platform folders on the build workstation with:

```bash
flutter create .
flutter pub get
```

Then merge the location/network permissions from `android/app/src/main/AndroidManifest.xml` if Flutter regenerated the manifest.
