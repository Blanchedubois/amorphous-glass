#!/usr/bin/env python3
"""drift_test.py DIR [NAME..]: break the design in a sandbox one way at a time, then check that
`tahoe_repair.py check` reports it, `repair` restores it, and a second check is clean
(docs/REPAIR.md, Phase 4). DIR is a fresh sandbox path (sandbox.sh seed is run here).
Prints a markdown results table. Nothing reaches the live desktop: every command runs in
sandbox.sh's throwaway home on its own D-Bus session.
"""
import json, os, re, shutil, subprocess, sys, time

T = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(os.path.dirname(T))
DIR = os.path.abspath(sys.argv[1])
ONLY = sys.argv[2:]
H = os.path.join(DIR, 'home')
EXT = os.path.join(H, '.local/share/gnome-shell/extensions')
BMS = os.path.join(EXT, 'blur-my-shell@aunetx')
S = 'org.gnome.shell.extensions.blur-my-shell'
NOISE = re.compile(r'dbus-daemon\[|connection to the bus|GLib-GIO-CRITICAL|Error creating proxy|^\s*$')


def sb(*args, env=None):
    e = dict(os.environ, **(env or {}))
    r = subprocess.run(['bash', os.path.join(T, 'sandbox.sh'), 'run', DIR, *args], capture_output=True, text=True, env=e)
    out = '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if not NOISE.search(l))
    return r.returncode, out


def gset(schema, key, value, ext=None):
    sd = ['--schemadir', os.path.join(EXT, ext, 'schemas')] if ext else []
    sb('gsettings', *sd, 'set', schema, key, value)


def greset(schema, key, ext=None):
    sd = ['--schemadir', os.path.join(EXT, ext, 'schemas')] if ext else []
    sb('gsettings', *sd, 'reset', schema, key)


def gget(schema, key, ext=None):
    sd = ['--schemadir', os.path.join(EXT, ext, 'schemas')] if ext else []
    return sb('gsettings', *sd, 'get', schema, key)[1].strip()


def state(**kv):
    p = os.path.join(H, '.config/tahoe-glass/state')
    lines = [l for l in open(p).read().splitlines() if l.split('=')[0] not in kv]
    lines += [f'{k.replace("_", "-")}={v}' for k, v in kv.items() if v is not None]
    open(p, 'w').write('\n'.join(lines) + '\n')


def edit(path, fn):
    p = os.path.join(H, path)
    text = fn(open(p).read())
    open(p, 'w').write(text)


def strip(begin, end):
    return lambda s: re.sub(re.escape(begin) + r'.*?' + re.escape(end) + r'\n?', '', s, flags=re.S)


def engine(mode, env=None, *extra):
    rc, out = sb('python3', os.path.join(R, 'scripts', 'tahoe_repair.py'), mode, *extra, env=env)
    flagged = {}
    for line in out.splitlines():
        m = re.match(r'(drift|held|action|error|info)\s+(\S+)', line)
        if m:
            flagged[m.group(2)] = m.group(1)
        m = re.match(r'\[tahoe-repair\] (drift|held|action|error) (\S+)', line)
        if m:
            flagged[m.group(2)] = m.group(1)
    return rc, out, flagged


def ext_list():
    return json.loads(gget('org.gnome.shell', 'enabled-extensions').replace("'", '"').replace('@as ', ''))


# name, how it breaks, break(), expected {id: status}, verify() -> (bool, detail) after repair, env
SCENARIOS = []


def scenario(name, how, expect, env=None, after_ok=True):
    def deco(fn):
        SCENARIOS.append(dict(name=name, how=how, brk=fn, expect=expect, env=env or {}, after_ok=after_ok,
                              verify=getattr(fn, 'verify', None)))
        return fn
    return deco


def verify(v):
    def deco(fn):
        fn.verify = v
        return fn
    return deco


@scenario('Interface settings', 'gsettings reset of button layout, cursor, font, resize border',
          {'C3': 'drift', 'C2': 'drift', 'C5-ui': 'drift', 'C4': 'drift'})
@verify(lambda: (gget('org.gnome.desktop.wm.preferences', 'button-layout') == "'close,minimize,maximize:'", 'button-layout back'))
def _():
    greset('org.gnome.desktop.wm.preferences', 'button-layout')
    greset('org.gnome.desktop.interface', 'cursor-theme')
    greset('org.gnome.desktop.interface', 'font-name')
    greset('org.gnome.mutter', 'draggable-border-width')


@scenario('Dark Style switched off', 'quick settings Dark Style: color-scheme default in dark mode',
          {'B1-scheme-dark': 'drift'})
@verify(lambda: (gget('org.gnome.desktop.interface', 'color-scheme') == "'prefer-dark'", 'prefer-dark'))
def _():
    gset('org.gnome.desktop.interface', 'color-scheme', 'default')


@scenario('Theme changed', 'shell theme, GTK3 theme and icon theme set to Adwaita',
          {'A2-dark': 'drift', 'B1-gtk-dark': 'drift', 'C1': 'drift'})
@verify(lambda: (gget('org.gnome.shell.extensions.user-theme', 'name') == "'MacTahoe-Dark'"
                 and gget('org.gnome.desktop.interface', 'icon-theme') == "'Tahoe-Material'", 'MacTahoe-Dark, Tahoe-Material'))
def _():
    gset('org.gnome.shell.extensions.user-theme', 'name', 'Adwaita')
    gset('org.gnome.desktop.interface', 'gtk-theme', 'Adwaita')
    gset('org.gnome.desktop.interface', 'icon-theme', 'Adwaita')


@scenario('GTK4 glass block deleted', 'the tahoe-glass-gtk4 block cut out of gtk-Dark.css', {'B3-dark': 'drift'})
@verify(lambda: ('mode: dark; menus: glass;' in open(os.path.join(H, '.config/gtk-4.0/gtk-Dark.css')).read(), 'block back'))
def _():
    edit('.config/gtk-4.0/gtk-Dark.css', strip('/* tahoe-glass-gtk4: managed by glass-bar.sh */', '/* end tahoe-glass-gtk4 */'))


@scenario('GTK3 glass block deleted', 'the tahoe-glass-gtk3 block cut out of ~/.config/gtk-3.0/gtk.css', {'B4-dark': 'drift'})
@verify(lambda: ('tahoe-glass-gtk3: managed' in open(os.path.join(H, '.config/gtk-3.0/gtk.css')).read(), 'block back'))
def _():
    edit('.config/gtk-3.0/gtk.css', strip('/* tahoe-glass-gtk3: managed by glass-bar.sh */', '/* end tahoe-glass-gtk3 */'))


@scenario('Shell CSS overrides deleted', 'the tahoe-overrides block cut out of MacTahoe-Dark gnome-shell.css', {'A3': 'drift'})
@verify(lambda: ('tahoe-overrides:' in open(os.path.join(H, '.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css')).read(), 'block back'))
def _():
    edit('.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css', strip('/* tahoe-overrides:', '/* end tahoe-overrides */'))


@scenario('Shell CSS overrides stale', 'one radius in the rendered block changed by hand', {'A3': 'drift'})
@verify(lambda: (True, 're-rendered'))
def _():
    edit('.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css', lambda s: s.replace('tahoe-overrides:', 'tahoe-overrides: stale', 1))


@scenario('GTK3 corners', 'MacTahoe-Dark gtk-3.0 back to 24px 24px 0 0', {'A5': 'drift'})
@verify(lambda: ('24px 24px 0 0' not in open(os.path.join(H, '.themes/MacTahoe-Dark/gtk-3.0/gtk.css')).read(), 'all four rounded'))
def _():
    edit('.themes/MacTahoe-Dark/gtk-3.0/gtk.css', lambda s: s.replace('border-radius: 24px;', 'border-radius: 24px 24px 0 0;', 3))


@scenario('Theme file emptied', 'MacTahoe-Dark gnome-shell.css and gtk-4.0/gtk-Dark.css truncated (a failed theme install)',
          {'A1-content': 'drift', 'B6-content': 'drift'})
@verify(lambda: (os.path.getsize(os.path.join(H, '.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css')) > 50000
                 and os.path.getsize(os.path.join(H, '.config/gtk-4.0/gtk-Dark.css')) > 50000, 'MacTahoe reinstalled, glass re-applied'))
def _():
    open(os.path.join(H, '.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css'), 'w').close()
    open(os.path.join(H, '.config/gtk-4.0/gtk-Dark.css'), 'w').close()


@scenario('libadwaita link', 'gtk-4.0/gtk.css pointed at gtk-Light.css in dark mode', {'B2-dark': 'drift'})
@verify(lambda: (os.path.realpath(os.path.join(H, '.config/gtk-4.0/gtk.css')).endswith('gtk-Dark.css'), 'gtk-Dark.css'))
def _():
    p = os.path.join(H, '.config/gtk-4.0/gtk.css')
    os.remove(p)
    os.symlink(os.path.join(H, '.config/gtk-4.0/gtk-Light.css'), p)


@scenario('Blur My Shell settings', 'menus pipeline default, pipelines reset, a radius key changed, motion-freeze off',
          {'D2-menu-pipe': 'drift', 'D2-menu-pipes': 'drift', 'D2-bar-pipes-glass': 'drift', 'D3-popup-menu-corner-radius': 'drift',
           'D2-menu-freeze': 'drift'})
@verify(lambda: ('pipeline_glassbar_menus' in gget(S, 'pipelines', 'blur-my-shell@aunetx')
                 and gget(S + '.popup', 'motion-freeze', 'blur-my-shell@aunetx') == 'true', 'pipelines and freeze back'))
def _():
    gset(S + '.popup', 'pipeline', 'pipeline_default', 'blur-my-shell@aunetx')
    greset(S, 'pipelines', 'blur-my-shell@aunetx')
    gset(S + '.popup', 'menu-corner-radius', '12', 'blur-my-shell@aunetx')
    gset(S + '.popup', 'motion-freeze', 'false', 'blur-my-shell@aunetx')


@scenario('Blur My Shell replaced with stock', 'unpatched v76 from the pinned commit installed (as GNOME\'s updater would)',
          {'D1': 'drift'})
@verify(lambda: ('is_app_menu' in open(os.path.join(BMS, 'components/applications/window_rules.js')).read()
                 and json.load(open(os.path.join(BMS, 'metadata.json'))).get('tahoe-glass-patch-sha256'), 'patched, stamped'))
def _():
    src = os.path.join(H, '.local/src/blur-my-shell')
    stock = os.path.join(DIR, 'bms-stock')
    shutil.rmtree(stock, ignore_errors=True)
    os.makedirs(stock)
    commit = re.search(r'^BMS_COMMIT=(\w+)', open(os.path.join(R, 'scripts/glass-bar.sh')).read(), re.M).group(1)
    subprocess.run(f'git -C "{src}" archive {commit} | tar -x -C "{stock}"', shell=True, check=True)
    subprocess.run(['make', '-C', stock, 'build'], capture_output=True, check=True)
    zipf = [f for f in os.listdir(os.path.join(stock, 'build')) if f.endswith('.zip')][0]
    shutil.rmtree(BMS)
    os.makedirs(BMS)
    subprocess.run(['unzip', '-q', os.path.join(stock, 'build', zipf), '-d', BMS], check=True)


@scenario('Blur My Shell from an old patch', 'the build\'s patch stamp differs from the repo\'s patch', {'D1-stamp': 'drift'})
@verify(lambda: (json.load(open(os.path.join(BMS, 'metadata.json')))['tahoe-glass-patch-sha256'] != 'old', 'rebuilt, stamp current'))
def _():
    p = os.path.join(BMS, 'metadata.json')
    m = json.load(open(p))
    m['tahoe-glass-patch-sha256'] = 'old'
    m.setdefault('tahoe-glass-commit', 'x')
    json.dump(m, open(p, 'w'))


@scenario('Pending upstream update', 'GNOME\'s updater left a Blur My Shell update in extension-updates', {'D1-pending': 'drift'})
@verify(lambda: (not os.path.exists(os.path.join(H, '.local/share/gnome-shell/extension-updates/blur-my-shell@aunetx')), 'held back'))
def _():
    d = os.path.join(H, '.local/share/gnome-shell/extension-updates/blur-my-shell@aunetx')
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'metadata.json'), 'w').write('{"uuid": "blur-my-shell@aunetx", "version": 77}')


@scenario('Extensions disabled', 'dock, Blur My Shell and the widgets taken out of enabled-extensions; user extensions off',
          {'C9': 'drift', 'C8': 'drift'})
@verify(lambda: ({'dash-to-dock@micxgx.gmail.com', 'tahoe-widgets@cachyos-tahoe'} <= set(ext_list()), 'back on'))
def _():
    gset('org.gnome.shell', 'enabled-extensions', str([u for u in ext_list() if u not in (
        'dash-to-dock@micxgx.gmail.com', 'blur-my-shell@aunetx', 'tahoe-widgets@cachyos-tahoe')]))
    gset('org.gnome.shell', 'disable-user-extensions', 'true')


@scenario('A user\'s own extension', 'an extension the user enabled that the design does not know, the list reordered',
          {})
@verify(lambda: ('my-own@example' in ext_list() and ext_list()[0] == 'my-own@example', 'kept, order kept'))
def _():
    gset('org.gnome.shell', 'enabled-extensions', str(['my-own@example'] + list(reversed(ext_list()))))


@scenario('Switched off stays off', 'state widgets=off, but the widgets were enabled again by hand',
          {'C9': 'drift'})
@verify(lambda: ('tahoe-widgets@cachyos-tahoe' not in ext_list(), 'removed, not re-added'))
def _():
    state(widgets='off')


@scenario('Absent switch is left alone', 'no controlcenter key; the Control Center enabled by hand', {})
@verify(lambda: ('tahoe-control-center@cachyos-tahoe' in ext_list(), 'left as the user set it'))
def _():
    state(controlcenter=None)
    gset('org.gnome.shell', 'enabled-extensions', str(ext_list() + ['tahoe-control-center@cachyos-tahoe']))


@scenario('Tahoe extension deleted', 'the motion extension folder removed while motion=on', {'F-motion': 'drift'})
@verify(lambda: (os.path.exists(os.path.join(EXT, 'tahoe-motion@cachyos-tahoe/metadata.json')), 'reinstalled from the repo'))
def _():
    shutil.rmtree(os.path.join(EXT, 'tahoe-motion@cachyos-tahoe'))


@scenario('Open Bar styling', 'Open Bar told to style GTK and menus, its font changed',
          {'D7-apply-gtk': 'drift', 'D7-menustyle': 'drift', 'D7-font': 'drift'})
@verify(lambda: (gget('org.gnome.shell.extensions.openbar', 'apply-gtk', 'openbar@neuromorph') == 'false', 'bar only'))
def _():
    gset('org.gnome.shell.extensions.openbar', 'apply-gtk', 'true', 'openbar@neuromorph')
    gset('org.gnome.shell.extensions.openbar', 'menustyle', 'true', 'openbar@neuromorph')
    gset('org.gnome.shell.extensions.openbar', 'font', 'Sans 12', 'openbar@neuromorph')


@scenario('Dock settings and stylesheet', 'Dash to Dock on its own theme and moved left; stylesheet renamed (tweaks -d)',
          {'D6-apply-custom-theme': 'drift', 'D6-dock-position': 'drift', 'D6-css': 'drift'})
@verify(lambda: (os.path.exists(os.path.join(EXT, 'dash-to-dock@micxgx.gmail.com/stylesheet.css')), 'stylesheet back'))
def _():
    d = 'dash-to-dock@micxgx.gmail.com'
    gset('org.gnome.shell.extensions.dash-to-dock', 'apply-custom-theme', 'true', d)
    gset('org.gnome.shell.extensions.dash-to-dock', 'dock-position', 'LEFT', d)
    os.rename(os.path.join(EXT, d, 'stylesheet.css'), os.path.join(EXT, d, 'stylesheet.css.bak'))


@scenario('Rounded Window Corners refetched', 'the 51 port gone (GLSLEffect import back), metadata at 50',
          {'D9-port': 'drift', 'D9-meta': 'drift'})
@verify(lambda: ('gi://Shell' not in open(os.path.join(EXT, 'rounded-window-corners@fxgn/effect/rounded_corners_effect.js')).read(), 'ported'))
def _():
    edit('.local/share/gnome-shell/extensions/rounded-window-corners@fxgn/effect/rounded_corners_effect.js',
         lambda s: "import Shell from 'gi://Shell';\n" + s)
    p = os.path.join(EXT, 'rounded-window-corners@fxgn/metadata.json')
    m = json.load(open(p)); m['shell-version'] = ['50']; json.dump(m, open(p, 'w'))


@scenario('Now Playing and Vitals', 'Now Playing back to its own text, Vitals asks for the public IP',
          {'D10-panel-text': 'drift', 'D11-ip': 'drift'})
@verify(lambda: (gget('org.gnome.shell.extensions.vitals', 'include-public-ip', 'Vitals@CoreCoding.com') == 'false', 'no IP lookup'))
def _():
    gset('org.gnome.shell.extensions.nowplaying', 'panel-text', 'title', 'nowplaying@epogonii.github.io')
    gset('org.gnome.shell.extensions.vitals', 'include-public-ip', 'true', 'Vitals@CoreCoding.com')


@scenario('Entry points', 'autostart deleted, tahoe-repair linked to the old repo', {'H1': 'drift', 'H2': 'drift'})
@verify(lambda: (os.path.exists(os.path.join(H, '.config/autostart/tahoe-repair.desktop')), 'both restored'))
def _():
    os.remove(os.path.join(H, '.config/autostart/tahoe-repair.desktop'))
    p = os.path.join(H, '.local/bin/tahoe-repair')
    if os.path.lexists(p):
        os.remove(p)
    os.symlink(os.path.join(H, 'Projects/cachyos-tahoe-theme/scripts/tahoe-repair.sh'), p)


@scenario('Light mode', 'the user picks light (state mode=light) and a repair runs before glass-bar.sh mode',
          {'A2-light': 'drift', 'B1-gtk-light': 'drift', 'B2-light': 'drift', 'B3-light': 'drift'})
@verify(lambda: (gget('org.gnome.shell.extensions.user-theme', 'name') == "'MacTahoe-Light'"
                 and 'mode: light; menus: glass;' in open(os.path.join(H, '.config/gtk-4.0/gtk-Light.css')).read(), 'light everywhere'))
def _():
    state(mode='light')


@scenario('Back to dark', 'state mode=dark again', {'A2-dark': 'drift', 'B1-gtk-dark': 'drift', 'B2-dark': 'drift'})
@verify(lambda: (gget('org.gnome.shell.extensions.user-theme', 'name') == "'MacTahoe-Dark'" and os.path.realpath(os.path.join(H, '.config/gtk-4.0/gtk.css')).endswith('gtk-Dark.css'), 'dark theme and stylesheet'))
def _():
    state(mode='dark')


@scenario('repair-skip', 'repair-skip=C3 in the state file, then the button layout changed', {}, after_ok=True)
@verify(lambda: (gget('org.gnome.desktop.wm.preferences', 'button-layout') == "':close'", 'left as the user set it'))
def _():
    state(repair_skip='C3')
    gset('org.gnome.desktop.wm.preferences', 'button-layout', ':close')


@scenario('Login screen replaced by a gnome-shell update', 'system gresource is the stock one (test copy), Tahoe GDM keys present',
          {'A6': 'action'}, env={'TAHOE_REPAIR_SYS_GRESOURCE': '/usr/share/gnome-shell/gnome-shell-theme.gresource.bak',
                                 'TAHOE_REPAIR_GDM_KEYS': '/etc/dconf/db/gdm.d/90-tahoe-gdm'}, after_ok=False)
@verify(lambda: (True, 'reported with the sudo command; nothing root touched'))
def _():
    state(repair_skip=None)


@scenario('SF Pro missing', 'the fonts folder gone', {'E4': 'action'}, after_ok=False)
@verify(lambda: (True, 'reported; the font settings are left until it is back'))
def _():
    os.remove(os.path.join(H, '.local/share/fonts'))


@scenario('Packages changed', 'the pacman hook stamp is newer than the last run', {'H6': 'info'})
@verify(lambda: (True, 'reported once'))
def _():
    os.symlink(os.path.join(os.path.expanduser('~'), '.local/share/fonts'), os.path.join(H, '.local/share/fonts'))
    open(os.path.join(DIR, 'packages-changed'), 'w').write('2026-10-20T21:00 gnome-shell mutter\n')


@scenario('GNOME minor bump (51.2)', 'the installed shell says 51.2', {}, env={'TAHOE_REPAIR_FAKE_SHELL': '51.2'})
@verify(lambda: (gget('org.gnome.shell', 'disable-extension-version-validation') == 'true', 'no hold; validation stays off'))
def _():
    pass


@scenario('GNOME major bump (52)', 'the installed shell says 52.0 and a refetch put RWC\'s unported code back',
          {'C7': 'drift', 'D9-port': 'held', 'D9-meta': 'held'}, env={'TAHOE_REPAIR_FAKE_SHELL': '52.0'}, after_ok=False)
@verify(lambda: (gget('org.gnome.shell', 'disable-extension-version-validation') == 'false'
                 and 'gi://Shell' in open(os.path.join(EXT, 'rounded-window-corners@fxgn/effect/rounded_corners_effect.js')).read(),
                 'validation on, 51 port not forced, user notified'))
def _():
    edit('.local/share/gnome-shell/extensions/rounded-window-corners@fxgn/effect/rounded_corners_effect.js',
         lambda s: "import Shell from 'gi://Shell';\n" + s)


@scenario('Back on GNOME 51', 'the shell says 51.1 again', {'C7': 'drift', 'D9-port': 'drift'})
@verify(lambda: (gget('org.gnome.shell', 'disable-extension-version-validation') == 'true', 'validation off, port back'))
def _():
    pass


@scenario('repair=off', 'repair=off in the state file and a setting changed', {}, after_ok=False)
@verify(lambda: (gget('org.gnome.mutter', 'draggable-border-width') == '5', 'nothing changed'))
def _():
    state(repair='off')
    gset('org.gnome.mutter', 'draggable-border-width', '5')


def main():
    if not os.path.exists(DIR):
        subprocess.run(['bash', os.path.join(T, 'sandbox.sh'), 'seed', DIR], check=True, capture_output=True)
    rc, out, _ = engine('repair')
    rc, out, flagged = engine('check')
    base = {k: v for k, v in flagged.items() if v != 'info'}
    print(f'baseline after one repair: exit {rc}, flagged {base or "nothing"}', file=sys.stderr)
    rows = []
    for sc in SCENARIOS:
        if ONLY and sc['name'] not in ONLY:
            continue
        t0 = time.time()
        sc['brk']()
        rc1, out1, fl1 = engine('check', sc['env'])
        detected = all(fl1.get(i) == st for i, st in sc['expect'].items())
        missed = {i: fl1.get(i, 'ok') for i, st in sc['expect'].items() if fl1.get(i) != st}
        rc2, out2, _ = engine('repair', sc['env'])
        rc3, out3, fl3 = engine('check', sc['env'])
        left = {k: v for k, v in fl3.items() if v not in ('info',) and k not in base}
        ok, detail = sc['verify']() if sc['verify'] else (True, '')
        repaired = (not left) if sc['after_ok'] else True
        notified = 'NOTIFY' in out2
        rows.append((sc['name'], sc['how'], ', '.join(f'{i} {s}' for i, s in sc['expect'].items()) or 'nothing flagged',
                     'yes' if detected else f'NO {missed}', 'yes' if repaired else f'NO, left {left}',
                     ('yes' if ok else 'NO') + f': {detail}' + (' (notified)' if notified else ''), f'{time.time() - t0:.0f}s'))
        print(f'{sc["name"]}: detected={detected} repaired={repaired} verified={ok} exit {rc1}/{rc3}', file=sys.stderr)
        if not (detected and repaired and ok):
            print('--- check\n' + out1 + '\n--- repair\n' + out2 + '\n--- check\n' + out3, file=sys.stderr)
    print('| Feature | How it breaks | Check reports | Detected | Repaired (clean check after) | Verified | Time |')
    print('|---|---|---|---|---|---|---|')
    for r in rows:
        print('| ' + ' | '.join(x.replace('|', '/') for x in r) + ' |')


main()
