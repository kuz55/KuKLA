#!/usr/bin/env bash
# Exercise the portable layout and failure paths without requiring Windows/MSYS2.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export KUKLA_BUILD_DIR="$tmp/build dir"
export MINGW_PREFIX="$tmp/MSYS prefix"
export MOCK_PREFIX="$MINGW_PREFIX"
export PATH="$tmp/tools:$PATH"
mkdir -p "$KUKLA_BUILD_DIR" "$MINGW_PREFIX/bin" "$tmp/tools" \
  "$MINGW_PREFIX/share/glib-2.0/schemas" "$MINGW_PREFIX/share/icons/Adwaita" \
  "$MINGW_PREFIX/share/icons/hicolor" "$MINGW_PREFIX/share/gtk-4.0" \
  "$MINGW_PREFIX/share/licenses/gtk4" "$MINGW_PREFIX/lib/gdk-pixbuf-2.0/2.10.0/loaders"
touch "$KUKLA_BUILD_DIR/kukla-ui.exe" "$KUKLA_BUILD_DIR/kukla-engine.exe" \
  "$MINGW_PREFIX/bin/gspawn-win64-helper.exe" "$MINGW_PREFIX/bin/gspawn-win64-helper-console.exe" \
  "$MINGW_PREFIX/bin/dependency.dll" "$MINGW_PREFIX/lib/gdk-pixbuf-2.0/2.10.0/loaders/loader.dll" \
  "$MINGW_PREFIX/share/glib-2.0/schemas/test.xml" \
  "$MINGW_PREFIX/share/icons/Adwaita/index.theme" "$MINGW_PREFIX/share/icons/hicolor/index.theme" \
  "$MINGW_PREFIX/share/licenses/gtk4/COPYING"
cat > "$tmp/tools/cygpath" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$2"
SCRIPT
cat > "$tmp/tools/ntldd" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "${MISSING_DLL:-}" == yes ]]; then
  printf 'missing.dll => %s/bin/missing.dll (0x0001)\n' "$MOCK_PREFIX"
else
  printf 'dependency.dll => %s/bin/dependency.dll (0x0001)\n' "$MOCK_PREFIX"
  printf 'kernel32.dll => C:/Windows/System32/kernel32.dll (0x0002)\n'
fi
SCRIPT
cat > "$tmp/tools/windres" <<'SCRIPT'
#!/usr/bin/env bash
while (( $# )); do
  if [[ "$1" == -o ]]; then touch "$2"; exit 0; fi
  shift
done
exit 1
SCRIPT
cp "$tmp/tools/windres" "$tmp/tools/gcc"
cat > "$tmp/tools/pacman" <<'SCRIPT'
#!/usr/bin/env bash
printf 'gtk4 1.0\n'
SCRIPT
cat > "$MINGW_PREFIX/bin/glib-compile-schemas.exe" <<'SCRIPT'
#!/usr/bin/env bash
touch "$1/gschemas.compiled"
SCRIPT
cat > "$MINGW_PREFIX/bin/gdk-pixbuf-query-loaders.exe" <<'SCRIPT'
#!/usr/bin/env bash
[[ "$PWD" == "$KUKLA_BUILD_DIR/windows/KuKLA" ]]
if [[ "${ABSOLUTE_CACHE:-}" == yes ]]; then
  printf '"C:/build/machine/loader.dll"\n'
else
  printf '"lib/gdk-pixbuf-2.0/2.10.0/loaders/loader.dll"\n'
fi
SCRIPT
chmod +x "$tmp/tools/"* "$MINGW_PREFIX/bin/glib-compile-schemas.exe" \
  "$MINGW_PREFIX/bin/gdk-pixbuf-query-loaders.exe"

package="$repo_root/.github/scripts/package-windows.sh"
bundle="$KUKLA_BUILD_DIR/windows/KuKLA"
bash "$package"
for relative in KuKLA.exe bin/kukla-ui.exe bin/kukla-engine.exe bin/dependency.dll \
  bin/gspawn-win64-helper.exe bin/gspawn-win64-helper-console.exe \
  share/glib-2.0/schemas/gschemas.compiled share/icons/Adwaita/index.theme \
  share/icons/hicolor/index.theme share/licenses/gtk4/COPYING \
  lib/gdk-pixbuf-2.0/2.10.0/loaders/loader.dll \
  lib/gdk-pixbuf-2.0/2.10.0/loaders.cache README.txt LICENSE.txt; do
  test -f "$bundle/$relative" || { echo "Missing packaged file: $relative" >&2; exit 1; }
done
test ! -e "$bundle/bin/gdk-pixbuf-query-loaders.exe"
test ! -e "$bundle/share/schemas"
test ! -e "$bundle/share/Adwaita"

touch "$bundle/bin/obsolete.dll"
bash "$package"
test ! -e "$bundle/bin/obsolete.dll"

if ABSOLUTE_CACHE=yes bash "$package"; then
  echo 'Absolute build paths in the loader cache were accepted' >&2
  exit 1
fi
if MISSING_DLL=yes bash "$package"; then
  echo 'A missing runtime dependency was accepted' >&2
  exit 1
fi
rm "$MINGW_PREFIX/bin/gspawn-win64-helper.exe"
if bash "$package"; then
  echo 'A missing GLib spawn helper was accepted' >&2
  exit 1
fi
echo 'Windows packaging fixture tests passed'
