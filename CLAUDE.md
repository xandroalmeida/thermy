# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Thermy is a GNOME Shell extension (GNOME 45–48, ESM `import` syntax) that shows the CPU temperature in the top bar and a menu with per-core temps, session peak, CPU frequency, fans and other hwmon sensors. The whole extension is `extension.js` + `stylesheet.css` + `metadata.json` + `icons/`. There is no build step, linter or test suite. User-facing text, comments and the README are in Portuguese (pt-BR), so keep that language.

## Commands

```sh
./install.sh        # symlink this folder into ~/.local/share/gnome-shell/extensions/<UUID> and enable it
./build-deb.sh      # build dist/gnome-shell-extension-thermy_<version>_all.deb (needs fakeroot, dpkg-deb)
dbus-run-session -- gnome-shell --nested --wayland   # test in a nested shell without logging out
journalctl -f -o cat /usr/bin/gnome-shell            # runtime errors / logs
```

- On Wayland the shell loads extension code only at login. Every code change needs a logout/login or a nested shell.
- Bump `version` in `metadata.json` before building a new `.deb`.
- The `install.sh` symlink in `~/.local` takes precedence over the system-wide `.deb` install in `/usr/share/gnome-shell/extensions/`.

## Naming constraints

- Both scripts derive the UUID from the **folder name** (`basename`), so the directory must stay named `thermy@alexandro` to match `uuid` in `metadata.json`.
- CSS classes use the `thermy-` prefix. `extension.js` adds and removes `thermy-warm`/`thermy-hot` on the panel button, and `stylesheet.css` styles the label and icon beneath it.
- The `.deb` declares `Conflicts`/`Replaces: gnome-shell-extension-cpu-temp` (the project's former name).

## Architecture (`extension.js`)

- **Sensor discovery runs once, in the indicator constructor** (`discover()`). It scans `/sys/class/hwmon` directly, without lm-sensors. It returns `{cpu, others, fans}` holding file *paths*, and the menu is built once from that result. Hot-plugged sensors are not picked up until the extension is re-enabled.
  - The CPU hwmon is the first one whose `name` is in `CPU_HWMON_NAMES`. Its primary sensor is the label matching `Package|Tctl|Tdie`, and the rest become cores.
  - The fallback when no CPU hwmon exists is the `x86_pkg_temp` thermal zone in `/sys/class/thermal`.
  - `hwmonDirs()` handles older drivers (e.g. `applesmc`) that expose files under `hwmonN/device/`.
  - Non-CPU sensors reading < 5 °C are dropped (dead SMC keys). `applesmc` labels are translated through `APPLE_SMC_LABELS`.
- **Update loop:** `_update()` runs every `REFRESH_SECONDS` and when the menu opens. The panel label and warm/hot level always update. Menu rows are refreshed only while the menu is open. The timer is removed in `destroy()`, which `disable()` calls.
- **Units:** sysfs values stay in millidegrees end to end (`fmtTemp` converts them). The "high" threshold comes from `tempN_max`, falling back to `DEFAULT_HIGH`. "Warm" starts at `high - WARM_MARGIN`.
- Tunables live at the top of the file: `REFRESH_SECONDS`, `DEFAULT_HIGH`, `WARM_MARGIN`, `CPU_HWMON_NAMES`, `APPLE_SMC_LABELS`.
