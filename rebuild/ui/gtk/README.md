# Native GTK desktop shell

The first C milestone provides the native window/navigation shell only. It intentionally contains no synthetic operation records and does not claim that operational workflows are already implemented.

## Linux build prerequisites

- GTK 4 development headers and libraries
- C compiler (GCC or Clang)
- `pkg-config`

Build from `rebuild/` with `make build-ui`. The GTK UI is planned as the common C toolkit on Linux and Windows; Windows packaging requires a native Windows GTK build and runtime bundle and is not validated by this Linux target.

The map panel is an empty-state page until the later WebView adapter is implemented: WebKitGTK on Linux, WebView2 on Windows. Both must load bundled/local resources only.
