#!/usr/bin/env bash
# Instala a extensão Thermy criando um link simbólico para esta pasta.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
UUID="$(basename "$SRC")"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
    echo "Já existe uma cópia (não link) em $DEST; remova-a primeiro." >&2
    exit 1
fi
ln -sfn "$SRC" "$DEST"
echo "Link criado: $DEST -> $SRC"

gnome-extensions enable "$UUID" 2>/dev/null || \
    gsettings set org.gnome.shell enabled-extensions \
        "$(python3 -c "import ast,sys; l=ast.literal_eval(sys.argv[1]); u=sys.argv[2]; print(l+[u] if u not in l else l)" \
            "$(gsettings get org.gnome.shell enabled-extensions | sed 's/^@as //')" "$UUID")"

cat <<MSG
Extensão habilitada.
No Wayland o GNOME Shell só carrega extensões novas após sair e entrar
de novo na sessão. Depois disso ela aparece ao lado do ícone da bateria.
MSG
