#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${KUKLA_BUILD_DIR:-$repo_root/rebuild/build}"
bundle="$build_dir/windows/KuKLA"
mingw_prefix="$(cygpath -u "${MINGW_PREFIX:-/ucrt64}")"

for binary in kukla-ui.exe kukla-engine.exe; do
  test -f "$build_dir/$binary" || {
    echo "Missing Windows binary: $build_dir/$binary" >&2
    exit 1
  }
done
for helper in gspawn-win64-helper.exe gspawn-win64-helper-console.exe gdk-pixbuf-query-loaders.exe; do
  test -f "$mingw_prefix/bin/$helper" || {
    echo "Missing GLib runtime helper: $mingw_prefix/bin/$helper" >&2
    exit 1
  }
done
for directory in share/glib-2.0/schemas share/icons/Adwaita share/icons/hicolor; do
  test -d "$mingw_prefix/$directory" || {
    echo "Missing GTK runtime resources: $mingw_prefix/$directory" >&2
    exit 1
  }
done

# A clean staging directory prevents obsolete DLLs and resources from earlier builds.
rm -rf "$bundle"
mkdir -p "$bundle/bin" "$bundle/etc/gtk-4.0" "$bundle/share" "$build_dir"
cp "$build_dir/kukla-ui.exe" "$bundle/bin/"
cp "$build_dir/kukla-engine.exe" "$bundle/bin/"
# g_spawn_async needs these executables in addition to the DLL dependency graph.
cp "$mingw_prefix/bin/gspawn-win64-helper.exe" "$mingw_prefix/bin/gspawn-win64-helper-console.exe" "$bundle/bin/"

# Resolve transitive PE imports, copying only MSYS2 runtime DLLs. The output can
# contain spaces, so capture everything up to the final address rather than the
# first whitespace. System DLLs must remain supplied by Windows itself.
bundle_dependencies() {
  local binary="$1" dependencies dependency
  if ! dependencies="$(ntldd -R "$binary")"; then
    echo "Unable to inspect Windows dependencies: $binary" >&2
    return 1
  fi
  while IFS= read -r dependency; do
    if [[ "$dependency" =~ ^[A-Za-z]: ]]; then
      dependency="$(cygpath -u "$dependency")"
    fi
    [[ "$dependency" == "$mingw_prefix"/* ]] || continue
    [[ -f "$dependency" ]] || { echo "Missing runtime dependency: $dependency" >&2; return 1; }
    cp -n "$dependency" "$bundle/bin/"
  done < <(printf '%s\n' "$dependencies" | sed -nE 's/.*=>[[:space:]]+(.+)[[:space:]]+\(0x[[:xdigit:]]+\).*/\1/p')
}

for binary in "$bundle/bin/kukla-ui.exe" "$bundle/bin/kukla-engine.exe" \
  "$bundle/bin/gspawn-win64-helper.exe" "$bundle/bin/gspawn-win64-helper-console.exe"; do
  bundle_dependencies "$binary"
done

# Preserve the directory below share/: GTK looks for schemas and icon themes in
# their nested locations, not directly under share/.
for relative in gtk-4.0 glib-2.0/schemas icons/Adwaita icons/hicolor licenses; do
  if [[ -d "$mingw_prefix/share/$relative" ]]; then
    mkdir -p "$bundle/share/$(dirname "$relative")"
    cp -a "$mingw_prefix/share/$relative" "$bundle/share/$(dirname "$relative")/"
  fi
done
"$mingw_prefix/bin/glib-compile-schemas.exe" "$bundle/share/glib-2.0/schemas"
test -f "$bundle/share/glib-2.0/schemas/gschemas.compiled"

loader_source="$mingw_prefix/lib/gdk-pixbuf-2.0/2.10.0/loaders"
shopt -s nullglob
loaders=("$loader_source"/*.dll)
shopt -u nullglob
if (( ${#loaders[@]} == 0 )); then
  echo "No GdkPixbuf loader modules found in $loader_source" >&2
  exit 1
fi
loader_dir="$bundle/lib/gdk-pixbuf-2.0/2.10.0/loaders"
mkdir -p "$loader_dir"
cp -a "${loaders[@]}" "$loader_dir/"
for loader in "$loader_dir"/*.dll; do
  bundle_dependencies "$loader"
done

# The query tool derives its relocatable prefix from its own location. Running
# it out of the MSYS2 prefix records absolute build-machine paths in the cache.
# Run a temporary copy inside the bundle instead so the cache remains portable.
cp "$mingw_prefix/bin/gdk-pixbuf-query-loaders.exe" "$bundle/bin/"
bundle_dependencies "$bundle/bin/gdk-pixbuf-query-loaders.exe"
(
  cd "$bundle"
  PATH="$bundle/bin:$mingw_prefix/bin:$PATH" ./bin/gdk-pixbuf-query-loaders.exe \
    lib/gdk-pixbuf-2.0/2.10.0/loaders/*.dll \
    > lib/gdk-pixbuf-2.0/2.10.0/loaders.cache
)
rm "$bundle/bin/gdk-pixbuf-query-loaders.exe"
if grep -qE '^"[A-Za-z]:[/\\\\]' "$bundle/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"; then
  echo 'GdkPixbuf cache contains an absolute build-machine path' >&2
  exit 1
fi

cat > "$bundle/etc/gtk-4.0/settings.ini" <<'SETTINGS'
[Settings]
gtk-theme-name=Adwaita
gtk-font-name=Segoe UI 10
SETTINGS

# The launcher sets relocatable runtime paths, then starts the GTK UI without a
# console window. The UI locates the Go engine next to itself in bin/.
(
  cd "$repo_root"
  windres rebuild/ui/windows/launcher.rc -O coff -o "$build_dir/windows-launcher-res.o"
)
"${CC:-gcc}" -std=c11 -Wall -Wextra -Werror -O2 -static -mwindows \
  "$repo_root/rebuild/ui/windows/launcher.c" "$build_dir/windows-launcher-res.o" \
  -luser32 -o "$bundle/KuKLA.exe"

cp "$repo_root/rebuild/ui/windows/README.txt" "$bundle/README.txt"
cp "$repo_root/LICENSE" "$bundle/LICENSE.txt"
cat > "$bundle/THIRD_PARTY_NOTICES.txt" <<'NOTICES'
KuKLA portable Windows package includes runtime libraries from the MSYS2 UCRT64
GTK4 package repository. GTK and several bundled dependencies are distributed
under GNU and other open-source licenses. License texts for installed runtime
packages are retained under share/licenses where supplied by the packages.
Corresponding source code is available from the MSYS2 package repositories;
see https://www.gtk.org/docs/installations/windows/ and https://packages.msys2.org/.
NOTICES
pacman -Q > "$bundle/THIRD_PARTY_VERSIONS.txt"

echo "Portable package staged at $bundle"
