// Test driver for tools/gdm/run.sh: in a throwaway gnome-shell in session mode gdm (no GDM
// daemon behind it), shows the greeter's user list, then the password prompt for the first user,
// and screenshots each. It drives LoginDialog's own methods; nothing here talks to GDM or PAM.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OUT = GLib.getenv('GDM_SHOT_OUT');
const TAG = GLib.getenv('GDM_SHOT_TAG') ?? 'gdm';
const wait = s => new Promise(r => GLib.timeout_add(0, s * 1000, () => { r(); return false; }));

async function shot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${TAG}-${name}.png`);
    const stream = file.replace(null, false, 0, null);
    const s = new Shell.Screenshot();
    await new Promise((res, rej) => s.screenshot(false, stream,
        (o, r) => { try { o.screenshot_finish(r); res(); } catch (e) { rej(e); } }));
    await new Promise(r => stream.close_async(0, null, () => r()));
}

function box(actor) {
    if (!actor?.mapped) return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x, y, w, h].map(Math.round);
}

function record(label, d) {
    const ap = d._authPrompt;
    const info = {
        label, panel: box(Main.panel), clock: box(Main.panel.statusArea.dateMenu?._clockDisplay),
        clockText: Main.panel.statusArea.dateMenu?._clockDisplay?.text,
        userList: box(d._userList), prompt: box(ap), entry: box(ap._entry),
        arrow: box(ap._defaultButtonWell), logo: box(d._logoBin),
        glassClass: d.has_style_class_name('tahoe-gdm-glass'),
        glassPanes: (() => { let n = 0; const walk = a => { if (a.name === 'tahoe-gdm-glass') n++; a.get_children().forEach(walk); }; walk(d); return n; })(),
        rowsOriginal: [...d._userList._items.values()].every(i => i.child?.has_style_class_name?.('tahoe-gdm-row-content') !== true && !(i.child?.layout_manager instanceof Clutter.BinLayout)),
        promptAlloc: ap.get_allocation_box() ? [ap.get_allocation_box().x1, ap.get_allocation_box().y1] : null,
        promptTx: ap.translation_x, dialog: box(d), avatar: box(ap._userWell.get_child()?.get_first_child?.()),
        listItem: box([...d._userList._items.values()][0]),
        buttons: (() => { const out = []; const w = a => { if (a instanceof St.Button && a.mapped) out.push(`${a.style_class}|${a.name ?? ''}|${box(a)}|${a.get_parent()?.style_class ?? ''}`); a.get_children().forEach(w); }; w(global.stage); return out; })(),
        rowBox: box([...d._userList._items.values()][0]?.child),
        rowPane: box([...d._userList._items.values()][0]?.child?.get_first_child?.()),
        rowContent: box([...d._userList._items.values()][0]?.child?.get_last_child?.()),
        listBox: box(d._userList._box ?? d._userList.get_child?.()),
        itemPadding: (() => { const i = [...d._userList._items.values()][0]; const n = i?.get_theme_node?.(); return n ? [n.get_padding(St.Side.LEFT), n.get_padding(St.Side.RIGHT), n.get_border_width(St.Side.LEFT)] : null; })(),
    };
    const f = Gio.File.new_for_path(`${OUT}/${TAG}-log.jsonl`);
    const s = f.append_to(0, null);
    s.write_all(new TextEncoder().encode(`${JSON.stringify(info)}\n`), null);
    s.close(null);
}

export default class {
    enable() {
        this._run().catch(e => log(`GDM SHOT ERR ${e}\n${e.stack}`))
            .finally(() => GLib.timeout_add(0, 500, () => { global.context.terminate(); return false; }));
    }

    async _run() {
        await wait(5);
        const d = Main.screenShield._dialog;
        // GDM_FAIL_MASK=1: the next glass masks fail (tahoe-gdm must then put everything back)
        if (GLib.getenv('GDM_FAIL_MASK')) {
            const ext = Main.extensionManager.lookup('tahoe-gdm@cachyos-tahoe');
            const glass = await import(ext.dir.get_child('glass.js').get_uri());
            glass.MATERIAL._failForTest = true;
        }
        d._showUserList();
        await wait(2);
        record('list', d);
        await shot('list');

        const user = [...d._userList._items.values()][0]?.user ?? null;
        d._hideUserList();
        await wait(1);
        if (user) d._authPrompt.setUser(user);
        d._authPrompt._onAskQuestion({serviceName: 'gdm-password', question: 'Password:', secret: true, answerHandler: () => {}});
        d._authPrompt.updateSensitivity({sensitive: true});
        d._showPrompt();
        await wait(1.5);
        record('prompt', d);
        await shot('prompt');

        d._authPrompt._entry.text = 'correct horse';
        d._authPrompt._entry.grab_key_focus();
        await wait(1);
        record('typed', d);
        await shot('typed');

        // GDM_SHOT_MENUS=1: the calendar, the system menu and the accessibility menu, open
        if (GLib.getenv('GDM_SHOT_MENUS')) {
            const menus = [['calendar', Main.panel.statusArea.dateMenu?.menu],
                ['system', Main.panel.statusArea.quickSettings?.menu],
                ['a11y', d._a11yMenuButton?._menu]];
            for (const [name, menu] of menus) {
                if (!menu)
                    continue;
                menu.open(true);
                await wait(1.2);
                record(name, d);
                await shot(name);
                menu.close(false);
                await wait(0.5);
            }
        }
    }

    disable() {}
}
