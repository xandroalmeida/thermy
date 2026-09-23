#!/usr/bin/env bash
# Gera dist/gnome-shell-extension-thermy_<versão>_all.deb
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
UUID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uuid"])' "$SRC/metadata.json")"
PKG=gnome-shell-extension-thermy
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/metadata.json")"
MAINTAINER="Alexandro Almeida <xandroalmeida@gmail.com>"

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
ROOT="$BUILD/${PKG}_${VERSION}_all"
EXT="$ROOT/usr/share/gnome-shell/extensions/$UUID"
DOC="$ROOT/usr/share/doc/$PKG"

# Só os arquivos da extensão; scripts e README ficam de fora.
install -d "$EXT/icons" "$DOC" "$ROOT/DEBIAN"
install -m 644 "$SRC"/{metadata.json,extension.js,stylesheet.css} "$EXT/"
install -m 644 "$SRC"/icons/*.svg "$EXT/icons/"
install -m 644 "$SRC/README.md" "$DOC/"

cat > "$ROOT/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: gnome
Priority: optional
Architecture: all
Depends: gnome-shell (>= 45)
Conflicts: gnome-shell-extension-cpu-temp
Replaces: gnome-shell-extension-cpu-temp
Maintainer: $MAINTAINER
Installed-Size: $(du -sk "$ROOT/usr" | cut -f1)
Description: Thermy - CPU temperature in the GNOME Shell top bar
 Displays the CPU package temperature next to the system indicators,
 turning yellow and red as it approaches the processor's high limit.
 The menu lists per-core temperatures, session peak, CPU frequency,
 fan speed and other hwmon sensors (Apple SMC names are translated).
EOF

mkdir -p "$SRC/dist"
OUT="$SRC/dist/${PKG}_${VERSION}_all.deb"
fakeroot dpkg-deb --build --root-owner-group "$ROOT" "$OUT" >/dev/null
echo "Pacote gerado: $OUT"
