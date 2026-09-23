# Thermy — extensão do GNOME Shell

Mostra a temperatura da CPU na barra superior, ao lado da bateria.

- Texto normal abaixo de `alto − 15 °C`, **amarelo** entre esse ponto e o
  limite "alto" do processador, **vermelho** acima do limite (87 °C neste
  MacBook Pro 9,2, lido de `temp1_max`).
- Ao clicar, o menu mostra: pacote e cada núcleo, pico da sessão, frequência
  média e máxima, limites alto/crítico, ventoinhas (RPM, % do máximo, modo
  manual) e um submenu com os demais sensores (Apple SMC, bateria…).
- Lê tudo direto de `/sys/class/hwmon`, a cada 2 s; não depende do lm-sensors.
- Funciona com `coretemp` (Intel), `k10temp`/`zenpower` (AMD) e, na falta
  deles, com a zona térmica `x86_pkg_temp`.

## Instalação

```sh
./install.sh
```

Cria um link em `~/.local/share/gnome-shell/extensions/thermy@alexandro` e
habilita a extensão. No Wayland é preciso **sair e entrar de novo na sessão**
na primeira vez (e depois de cada alteração no código).

Para testar sem sair da sessão:

```sh
dbus-run-session -- gnome-shell --nested --wayland
```

## Pacote .deb

```sh
./build-deb.sh                      # gera dist/gnome-shell-extension-thermy_<versão>_all.deb
sudo apt install ./dist/gnome-shell-extension-thermy_1_all.deb
```

Instala em `/usr/share/gnome-shell/extensions/` para todos os usuários. Cada
usuário ainda precisa habilitá-la (app Extensões ou
`gnome-extensions enable thermy@alexandro`). Para uma nova versão, aumente
`version` em `metadata.json` antes de gerar o pacote.

### Release no GitHub

Ao enviar uma tag `vN` (igual ao `version` do `metadata.json`), o GitHub
Actions gera o `.deb` e o `.zip` da extensão e publica um release:

```sh
git tag v2 && git push origin main v2
```

O `.zip` pode ser instalado com `gnome-extensions install thermy@alexandro.v2.shell-extension.zip`.

Se o link criado pelo `install.sh` existir, ele tem prioridade sobre o pacote.

## Desinstalar

```sh
gnome-extensions disable thermy@alexandro
rm ~/.local/share/gnome-shell/extensions/thermy@alexandro
```

## Ajustes

Constantes no topo de `extension.js`: `REFRESH_SECONDS`, `DEFAULT_HIGH`,
`WARM_MARGIN` e os nomes das chaves do SMC em `APPLE_SMC_LABELS`.

Logs de erro: `journalctl -f -o cat /usr/bin/gnome-shell`.
