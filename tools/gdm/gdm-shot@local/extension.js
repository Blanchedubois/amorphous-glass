import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const OUT = GLib.getenv('GDM_SHOT_OUT');
export default class {
  enable() {
    GLib.timeout_add_seconds(0, 8, () => { this._shot().catch(e => log('SHOT ERR ' + e)); return false; });
  }
  async _shot() {
    const file = Gio.File.new_for_path(`${OUT}/gdm.png`);
    const stream = file.replace(null, false, 0, null);
    const s = new Shell.Screenshot();
    await new Promise((res, rej) => s.screenshot(false, stream, (o, r) => { try { o.screenshot_finish(r); res(); } catch (e) { rej(e); } }));
    await new Promise(r => stream.close_async(0, null, () => r()));
    log('SHOT OK mode=' + Main.sessionMode.currentMode);
    GLib.timeout_add_seconds(0, 1, () => { Main.layoutManager; global.context.terminate(); return false; });
  }
  disable() {}
}
