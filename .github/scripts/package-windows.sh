#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="$repo_root/rebuild/build"
bundle="$build_dir/windows/KuKLA"
mingw_prefix="$(cygpath -u "${MINGW_PREFIX:-/ucrt64}")"

for binary in kukla-ui.exe kukla-engine.exe; do
  test -f "$build_dir/$binary" || {
    echo "Missing Windows binary: $build_dir/$binary" >&2
    exit 1
  }
done

mkdir -p "$bundle/bin" "$bundle/etc/gtk-4.0" "$bundle/share"
cp "$build_dir/kukla-ui.exe" "$bundle/bin/"
cp "$build_dir/kukla-engine.exe" "$bundle/bin/"

# Resolve the PE dependency graph recursively and bundle only MSYS2 runtime DLLs.
for binary in "$bundle/bin/kukla-ui.exe" "$bundle/bin/kukla-engine.exe"; do
  while IFS= read -r dependency; do
    if [[ "$dependency" =~ ^[A-Za-z]: ]]; then
      dependency="$(cygpath -u "$dependency")"
    fi
    [[ "$dependency" == "$mingw_prefix"/* ]] || continue
    [[ -f "$dependency" ]] || continue
    cp -n "$dependency" "$bundle/bin/"
  done < <(ntldd -R "$binary" | sed -nE 's/.*=> ([^ ]+) \(.*/\1/p')
done

if [[ -d "$mingw_prefix/share/licenses" ]]; then
  cp -a "$mingw_prefix/share/licenses" "$bundle/share/"
fi

for runtime_dir in \
  "$mingw_prefix/share/gtk-4.0" \
  "$mingw_prefix/share/glib-2.0/schemas" \
  "$mingw_prefix/share/icons/Adwaita" \
  "$mingw_prefix/share/icons/hicolor"; do
  if [[ -d "$runtime_dir" ]]; then
    mkdir -p "$bundle/share/$(dirname "${runtime_dir#"$mingw_prefix/share/"}")"
    cp -a "$runtime_dir" "$bundle/share/"
  fi
done

loader_source="$mingw_prefix/lib/gdk-pixbuf-2.0/2.10.0/loaders"
if [[ -d "$loader_source" ]]; then
  mkdir -p "$bundle/lib/gdk-pixbuf-2.0/2.10.0/loaders"
  cp -a "$loader_source"/*.dll "$bundle/lib/gdk-pixbuf-2.0/2.10.0/loaders/"
  while IFS= read -r -d '' loader; do
    while IFS= read -r dependency; do
      if [[ "$dependency" =~ ^[A-Za-z]: ]]; then
        dependency="$(cygpath -u "$dependency")"
      fi
      [[ "$dependency" == "$mingw_prefix"/* ]] || continue
      [[ -f "$dependency" ]] || continue
      cp -n "$dependency" "$bundle/bin/"
    done < <(ntldd -R "$loader" | sed -nE 's/.*=> ([^ ]+) \(.*/\1/p')
  done < <(find "$bundle/lib/gdk-pixbuf-2.0/2.10.0/loaders" -maxdepth 1 -name '*.dll' -print0)
  (
    cd "$bundle"
    "$mingw_prefix/bin/gdk-pixbuf-query-loaders.exe" \
      lib/gdk-pixbuf-2.0/2.10.0/loaders/*.dll \
      > lib/gdk-pixbuf-2.0/2.10.0/loaders.cache
  )
fi

cat > "$bundle/etc/gtk-4.0/settings.ini" <<'EOF'
[Settings]
gtk-theme-name=Adwaita
gtk-font-name=Segoe UI 10
EOF

"$mingw_prefix/bin/glib-compile-schemas.exe" "$bundle/share/glib-2.0/schemas"

cat > "$bundle/KuKLA.cmd" <<'EOF'
@echo off
setlocal
set "KUKLA_ROOT=%~dp0"
set "PATH=%KUKLA_ROOT%bin;%PATH%"
set "GTK_DATA_PREFIX=%KUKLA_ROOT%"
set "GTK_EXE_PREFIX=%KUKLA_ROOT%"
set "GSETTINGS_SCHEMA_DIR=%KUKLA_ROOT%share\glib-2.0\schemas"
set "GDK_PIXBUF_MODULEDIR=%KUKLA_ROOT%lib\gdk-pixbuf-2.0\2.10.0\loaders"
set "GDK_PIXBUF_MODULE_FILE=%KUKLA_ROOT%lib\gdk-pixbuf-2.0\2.10.0\loaders.cache"
cd /d "%KUKLA_ROOT%"
"%KUKLA_ROOT%bin\kukla-ui.exe"
endlocal
EOF

cat > "$bundle/THIRD_PARTY_NOTICES.txt" <<'EOF'
KuKLA portable Windows package includes runtime libraries from the MSYS2 UCRT64
GTK4 package repository. GTK and several bundled dependencies are distributed
under GNU and other open-source licenses. License texts for installed runtime
packages are retained under share/licenses where supplied by the packages.
Corresponding source code is available from the MSYS2 package repositories;
see https://www.gtk.org/docs/installations/windows/ and https://packages.msys2.org/.
EOF

pacman -Q mingw-w64-ucrt-x86_64-gtk4 mingw-w64-ucrt-x86_64-glib2 \
  mingw-w64-ucrt-x86_64-gcc-libs mingw-w64-ucrt-x86_64-gdk-pixbuf2 \
  mingw-w64-ucrt-x86_64-pango mingw-w64-ucrt-x86_64-cairo 2>/dev/null \
  > "$bundle/THIRD_PARTY_VERSIONS.txt" || true

echo "Portable package staged at $bundle"
