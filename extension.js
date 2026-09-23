// Thermy — mostra a temperatura da CPU na barra superior do GNOME Shell.
//
// Lê diretamente do sysfs (/sys/class/hwmon), sem depender de lm-sensors.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const REFRESH_SECONDS = 2;
const DEFAULT_HIGH = 85; // usado quando o driver não informa tempN_max
const WARM_MARGIN = 15; // "morno" começa a (high - WARM_MARGIN) °C

const CPU_HWMON_NAMES = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'];

// Nomes conhecidos das chaves do SMC da Apple (aproximados).
const APPLE_SMC_LABELS = {
    TA0P: 'Ar ambiente',
    TB0T: 'Bateria',
    TB1T: 'Bateria 1',
    TB2T: 'Bateria 2',
    TC0E: 'CPU (die)',
    TC0F: 'CPU (die, filtrada)',
    TC0P: 'CPU (proximidade)',
    TC1C: 'CPU núcleo 1',
    TC2C: 'CPU núcleo 2',
    TCXC: 'CPU (PECI)',
    TCSA: 'CPU system agent',
    TCGC: 'GPU integrada',
    TG1D: 'GPU (die)',
    TM0P: 'Memória (proximidade)',
    TM0S: 'Memória (slot)',
    TPCD: 'Chipset (PCH)',
    Th1H: 'Dissipador',
    Ts0P: 'Apoio de mãos',
    Ts0S: 'Superfície inferior',
};

const decoder = new TextDecoder();

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

function readInt(path) {
    const text = readText(path);
    if (text === null)
        return null;
    const value = parseInt(text, 10);
    return Number.isFinite(value) ? value : null;
}

function listDir(path) {
    const names = [];
    try {
        const dir = GLib.Dir.open(path, 0);
        let name;
        while ((name = dir.read_name()) !== null)
            names.push(name);
        dir.close();
    } catch {
        // diretório inexistente
    }
    return names.sort();
}

// Alguns drivers antigos (ex.: applesmc) expõem os arquivos em hwmonN/device/
// em vez de hwmonN/.
function hwmonDirs() {
    return listDir('/sys/class/hwmon').map(n => {
        const dir = `/sys/class/hwmon/${n}`;
        const hasInputs = listDir(dir).some(f => /^(temp|fan)\d+_input$/.test(f));
        return hasInputs ? dir : `${dir}/device`;
    });
}

// Sensores de temperatura (tempN_input) de um diretório hwmon.
function tempSensors(dir) {
    const sensors = [];
    for (const file of listDir(dir)) {
        const m = file.match(/^temp(\d+)_input$/);
        if (!m)
            continue;
        const n = m[1];
        sensors.push({
            index: parseInt(n, 10),
            input: `${dir}/${file}`,
            label: readText(`${dir}/temp${n}_label`) ?? `temp${n}`,
            max: readInt(`${dir}/temp${n}_max`),
            crit: readInt(`${dir}/temp${n}_crit`),
        });
    }
    return sensors.sort((a, b) => a.index - b.index);
}

function fanSensors(dir) {
    const fans = [];
    for (const file of listDir(dir)) {
        const m = file.match(/^fan(\d+)_input$/);
        if (!m)
            continue;
        const n = m[1];
        fans.push({
            input: `${dir}/${file}`,
            label: readText(`${dir}/fan${n}_label`) || `Ventoinha ${n}`,
            min: readInt(`${dir}/fan${n}_min`),
            max: readInt(`${dir}/fan${n}_max`),
            manual: `${dir}/fan${n}_manual`,
        });
    }
    return fans;
}

function discover() {
    let cpu = null;
    const others = [];
    const fans = [];

    for (const dir of hwmonDirs()) {
        const name = readText(`${dir}/name`) ?? '';
        const temps = tempSensors(dir);
        fans.push(...fanSensors(dir));

        if (!cpu && CPU_HWMON_NAMES.includes(name) && temps.length > 0) {
            const primary = temps.find(t => /^(Package|Tctl|Tdie)/.test(t.label)) ?? temps[0];
            cpu = {
                name,
                primary,
                cores: temps.filter(t => t !== primary),
            };
            continue;
        }

        for (const t of temps) {
            // Sensores do SMC que não medem nada retornam ~0 °C.
            if ((readInt(t.input) ?? 0) < 5000)
                continue;
            const nice = name === 'applesmc'
                ? APPLE_SMC_LABELS[t.label] ?? t.label
                : `${name} ${t.label}`;
            others.push({...t, label: nice});
        }
    }

    // Fallback: zona térmica genérica do pacote da CPU.
    if (!cpu) {
        for (const zone of listDir('/sys/class/thermal')) {
            const dir = `/sys/class/thermal/${zone}`;
            if (readText(`${dir}/type`) === 'x86_pkg_temp') {
                cpu = {
                    name: 'thermal',
                    primary: {input: `${dir}/temp`, label: 'Pacote', max: null, crit: null},
                    cores: [],
                };
                break;
            }
        }
    }

    return {cpu, others, fans};
}

function cpuFrequencies() {
    const freqs = [];
    for (const name of listDir('/sys/devices/system/cpu')) {
        if (!/^cpu\d+$/.test(name))
            continue;
        const khz = readInt(`/sys/devices/system/cpu/${name}/cpufreq/scaling_cur_freq`);
        if (khz !== null)
            freqs.push(khz / 1000);
    }
    return freqs;
}

const fmtTemp = milli => milli === null ? '--' : `${Math.round(milli / 1000)} °C`;

const ThermyIndicator = GObject.registerClass(
class ThermyIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Thermy');

        this._sensors = discover();
        this._peak = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box thermy-box'});
        box.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extension.path}/icons/thermy-symbolic.svg`),
            style_class: 'system-status-icon thermy-icon',
        }));
        this._label = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'thermy-label',
        });
        box.add_child(this._label);
        this.add_child(box);

        this._buildMenu();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._update();
        });

        this._update();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _addRow(menu, title) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(new St.Label({text: title, x_expand: true}));
        const value = new St.Label({text: '--', style_class: 'thermy-row-value'});
        item.add_child(value);
        menu.addMenuItem(item);
        return value;
    }

    _buildMenu() {
        const {cpu, others, fans} = this._sensors;
        this._rows = [];

        if (!cpu) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Nenhum sensor de CPU encontrado', {reactive: false}));
            return;
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('CPU'));
        for (const s of [cpu.primary, ...cpu.cores])
            this._rows.push({sensor: s, value: this._addRow(this.menu, s.label)});

        this._peakValue = this._addRow(this.menu, 'Pico nesta sessão');
        this._freqValue = this._addRow(this.menu, 'Frequência (média / máx)');

        const {max, crit} = cpu.primary;
        if (max !== null || crit !== null) {
            const limits = this._addRow(this.menu, 'Limites (alto / crítico)');
            limits.text = `${fmtTemp(max)} / ${fmtTemp(crit)}`;
        }

        this._fanRows = [];
        if (fans.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Ventoinhas'));
            for (const f of fans)
                this._fanRows.push({fan: f, value: this._addRow(this.menu, f.label)});
        }

        this._otherRows = [];
        if (others.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const sub = new PopupMenu.PopupSubMenuMenuItem('Outros sensores');
            for (const s of others)
                this._otherRows.push({sensor: s, value: this._addRow(sub.menu, s.label)});
            this.menu.addMenuItem(sub);
        }
    }

    _update() {
        const {cpu} = this._sensors;
        if (!cpu) {
            this._label.text = 'N/D';
            return;
        }

        const temp = readInt(cpu.primary.input);
        this._label.text = temp === null ? '--' : `${Math.round(temp / 1000)}°C`;
        this._applyLevel(temp);

        if (temp !== null && (this._peak === null || temp > this._peak))
            this._peak = temp;

        // O menu só precisa ser atualizado enquanto está aberto.
        if (!this.menu.isOpen)
            return;

        for (const row of this._rows)
            row.value.text = fmtTemp(readInt(row.sensor.input));
        this._peakValue.text = fmtTemp(this._peak);

        const freqs = cpuFrequencies();
        if (freqs.length > 0) {
            const avg = freqs.reduce((a, b) => a + b, 0) / freqs.length;
            this._freqValue.text = `${Math.round(avg)} / ${Math.round(Math.max(...freqs))} MHz`;
        }

        for (const row of this._fanRows) {
            const rpm = readInt(row.fan.input);
            const manual = readInt(row.fan.manual) === 1 ? ' (manual)' : '';
            const pct = rpm !== null && row.fan.max ? ` · ${Math.round(100 * rpm / row.fan.max)}%` : '';
            row.value.text = rpm === null ? '--' : `${rpm} RPM${pct}${manual}`;
        }

        for (const row of this._otherRows) {
            row.value.text = fmtTemp(readInt(row.sensor.input));
        }
    }

    _applyLevel(temp) {
        const high = this._sensors.cpu.primary.max ?? DEFAULT_HIGH * 1000;
        const warm = high - WARM_MARGIN * 1000;

        this.remove_style_class_name('thermy-warm');
        this.remove_style_class_name('thermy-hot');
        if (temp === null)
            return;
        if (temp >= high)
            this.add_style_class_name('thermy-hot');
        else if (temp >= warm)
            this.add_style_class_name('thermy-warm');
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        super.destroy();
    }
});

export default class ThermyExtension extends Extension {
    enable() {
        this._indicator = new ThermyIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
