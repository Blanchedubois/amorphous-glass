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

// every button on screen: its box, its content's box (the label or icon), the gaps on each side
function buttonGaps() {
    const out = [];
    const content = b => {
        let best = null;
        const walk = a => {
            if (!a.mapped) return;
            if (a instanceof St.Label || a instanceof St.Icon) { best ??= a; return; }
            a.get_children().forEach(walk);
        };
        b.get_children().forEach(walk);
        return best;
    };
    const visit = a => {
        if (!a.mapped || a.get_paint_opacity() === 0) return;
        const isButton = a instanceof St.Button || a.has_style_class_name?.('panel-button');
        if (isButton) {
            const [bx, by] = a.get_transformed_position();
            const [bw, bh] = a.get_transformed_size();
            const c = content(a);
            let gaps = null;
            if (c) {
                // a label's text: its layout's ink width, centred as St draws it
                const [cx, cy] = c.get_transformed_position();
                const [cw, ch] = c.get_transformed_size();
                let tx = cx, tw = cw;
                if (c instanceof St.Label) {
                    const [, logical] = c.clutter_text.get_layout().get_pixel_extents();
                    tw = logical.width;
                }
                gaps = {left: Math.round(tx - bx), right: Math.round(bx + bw - (tx + tw)), top: Math.round(cy - by), bottom: Math.round(by + bh - (cy + ch))};
            }
            out.push({cls: a.style_class, box: [bx, by, bw, bh].map(Math.round), gaps});
        }
        a.get_children().forEach(visit);
    };
    visit(global.stage);
    return out;
}

function buttonActors() {
    const out = [];
    const w = a => {
        if (a.mapped && (a instanceof St.Button || a.has_style_class_name?.('panel-button')))
            out.push(a);
        a.get_children().forEach(w);
    };
    w(global.stage);
    return out;
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
        buttonGaps: buttonGaps(),
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

        // GDM_SHOT_HOVER=1: every button in its hover state (the prompt page), then the list page
        if (GLib.getenv('GDM_SHOT_HOVER')) {
            const hoverAll = on => buttonActors().forEach(b => on ? b.add_style_pseudo_class('hover') : b.remove_style_pseudo_class('hover'));
            hoverAll(true);
            await wait(0.6);
            await shot('hover-prompt');
            hoverAll(false);
            d._authPrompt.cancel?.();
            d._showUserList();
            await wait(1.5);
            hoverAll(true);
            await wait(0.6);
            await shot('hover-list');
            hoverAll(false);
        }

        // GDM_SHOT_MENUS=1: the calendar, the system menu and the accessibility menu, open
        if (GLib.getenv('GDM_SHOT_MENUS')) {
            const menus = [['calendar', Main.panel.statusArea.dateMenu?.menu],
                ['system', Main.panel.statusArea.quickSettings?.menu],
                ['a11y', d._a11yMenuButton?._menu]];
            for (const [name, menu] of menus) {
                if (!menu)
                    continue;
                if (name === 'system' && GLib.getenv('TAHOE_QS_SLIDERS')) {
                    const w = a => { if (a.has_style_class_name?.('quick-slider')) { a.show(); a.get_parent()?.show(); } a.get_children().forEach(w); }; w(menu.box);
                }
                menu.open(true);
                await wait(1.2);
                record(name, d);
                if (name === 'system') {
                    const out = []; const w = a => { const c = ['quick-toggle-has-menu', 'quick-slider', 'icon-button'].find(k => a.has_style_class_name?.(k)) ?? (a.has_style_class_name?.('quick-toggle') && !a.get_parent()?.get_parent()?.has_style_class_name?.('quick-toggle-has-menu') ? 'quick-toggle' : null);
                        if (c && a.mapped) { out.push({kind: c, box: box(a)}); return; } a.get_children().forEach(w); }; w(menu.box);
                    Gio.File.new_for_path(`${OUT}/${TAG}-pieces.json`).replace_contents(new TextEncoder().encode(JSON.stringify(out)), null, false, 0, null);
                }
                if (name === 'system') {
                    const out = []; const w = a => { if (a.mapped && (a.has_style_class_name?.('quick-toggle-has-menu') || (a.has_style_class_name?.('quick-toggle') && !a.get_parent()?.get_parent()?.has_style_class_name?.('quick-toggle-has-menu')))) {
                        const b = box(a); let icon = null, arrow = null; const f = x => { if (!icon && x.has_style_class_name?.('quick-toggle-icon') && x.mapped) icon = box(x); if (!arrow && x.has_style_class_name?.('quick-toggle-menu-button') && x.mapped) arrow = box(x); x.get_children().forEach(f); }; f(a);
                        out.push({box: b, iconGaps: icon ? [icon[0] - b[0], icon[1] - b[1], b[1] + b[3] - icon[1] - icon[3]] : null, arrowGaps: arrow ? [b[0] + b[2] - arrow[0] - arrow[2], arrow[1] - b[1], b[1] + b[3] - arrow[1] - arrow[3]] : null}); }
                        a.get_children().forEach(w); }; w(menu.box);
                    const f2 = Gio.File.new_for_path(`${OUT}/${TAG}-insets.json`); f2.replace_contents(new TextEncoder().encode(JSON.stringify(out)), null, false, 0, null);
                }
                await shot(name);
                // the system menu: its first submenu open too (Wi-Fi or Power Mode)
                if (name === 'system') {
                    const toggles = [];
                    const w = a => { if (a.menu && a.has_style_class_name?.('quick-toggle-has-menu') === false && a.menu.open) toggles.push(a); a.get_children().forEach(w); };
                    const w2 = a => { if (a.menu?.open) toggles.push(a); a.get_children().forEach(w2); };
                    w2(menu.box);
                    const t = toggles.find(x => x.mapped && x.menu?.open && !x.has_style_class_name?.('quick-slider') && !x.get_parent()?.has_style_class_name?.('quick-slider'));
                    if (t) {
                        t.menu.open(true);
                        await wait(1.2);
                        await shot('system-sub');
                        t.menu.close(false);
                        await wait(0.4);
                    }
                }
                menu.close(false);
                await wait(0.5);
            }
        }
    }

    disable() {}
}
