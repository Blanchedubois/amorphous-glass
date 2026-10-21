#!/usr/bin/env python3
"""tahoe-repair: keep the Liquid Glass desktop as designed through updates (docs/REPAIR.md).

  tahoe_repair.py check      read-only report; exit 0 ok, 1 drift repair can fix, 2 needs you, 3 failed
  tahoe_repair.py repair     fix only what drifted (logged, backed up), then check again
  tahoe_repair.py status     versions and switches, no checks
  options: --wait N   wait up to N s for the shell's extension system (the login autostart)
           --only ID[,ID]   only these manifest items (prefix match, e.g. D2-menu)
           --verbose   print ok items too

The expected state is config/repair-manifest.json (scripts/repair_manifest.py, from tokens/).
The switches are ~/.config/tahoe-glass/state: a feature switched off stays off. Never runs sudo.
"""
import fcntl, glob, hashlib, json, os, re, shutil, subprocess, sys, tarfile, time

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
EXT_DIR = os.path.join(HOME, '.local/share/gnome-shell/extensions')
UPDATES_DIR = os.path.join(HOME, '.local/share/gnome-shell/extension-updates')
STATE_FILE = os.path.join(os.environ.get('XDG_CONFIG_HOME', os.path.join(HOME, '.config')), 'tahoe-glass', 'state')
OWN = os.path.join(os.environ.get('XDG_STATE_HOME', os.path.join(HOME, '.local/state')), 'tahoe-repair')
PKG_STAMP = os.environ.get('TAHOE_REPAIR_PKG_STAMP', '/var/lib/tahoe-repair/packages-changed')
SYS_GRESOURCE = '/usr/share/gnome-shell/gnome-shell-theme.gresource'
GDM_KEYS = '/etc/dconf/db/gdm.d/90-tahoe-gdm'
GDM_EXT = '/usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe'
BMS = 'blur-my-shell@aunetx'
PACKAGES = ['gnome-shell', 'mutter', 'gtk3', 'gtk4', 'libadwaita', 'gdm', 'gnome-shell-extensions', 'glib2', 'gjs']
STATES = {1: 'ACTIVE', 2: 'INACTIVE', 3: 'ERROR', 4: 'OUT OF DATE', 5: 'DOWNLOADING', 6: 'INITIALIZED',
          7: 'DEACTIVATING', 8: 'ACTIVATING'}

OK, INFO, SKIP, DRIFT, ACTION, HELD = 'ok', 'info', 'skip', 'drift', 'action', 'held'
EXIT = {OK: 0, INFO: 0, SKIP: 0, DRIFT: 1, ACTION: 2, HELD: 2}


def expand(p):
    return os.path.expanduser(p.replace('{ROOT}', ROOT)) if isinstance(p, str) else p


def sh(*cmd, input=None, check=False, env=None):
    try:
        r = subprocess.run(cmd, input=input, capture_output=True, text=True, env=env, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, '', str(e)
    if check and r.returncode:
        raise RuntimeError(f'{" ".join(cmd)}: {r.stderr.strip() or r.stdout.strip()}')
    return r.returncode, r.stdout, r.stderr


def read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


# ---- logging, backups, notifications ---------------------------------------------------------

class Log:
    def __init__(self, write):
        self.write = write
        self.stamp = time.strftime('%Y%m%d-%H%M%S')
        self.backup_dir = os.path.join(OWN, 'backup', self.stamp)
        self.changes = 0

    def __call__(self, msg):
        print(f'[tahoe-repair] {msg}', flush=True)
        if self.write:
            os.makedirs(OWN, exist_ok=True)
            with open(os.path.join(OWN, 'log'), 'a') as f:
                f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} {msg}\n')

    def backup(self, path):
        """Copy a file (or a folder, as a tar) into this run's backup folder before it changes."""
        path = expand(path)
        if not os.path.lexists(path):
            return
        rel = os.path.relpath(os.path.abspath(path), '/')
        dest = os.path.join(self.backup_dir, rel)
        if os.path.exists(dest) or os.path.exists(dest + '.tar'):
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.isdir(path) and not os.path.islink(path):
            with tarfile.open(dest + '.tar', 'w') as t:
                t.add(path, arcname=os.path.basename(path))
        else:
            shutil.copy2(path, dest, follow_symlinks=False)


def notify(log, lines, write):
    if not lines:
        return
    text = '\n'.join(dict.fromkeys(lines))
    key = hashlib.sha256((time.strftime('%Y%m%d') + text).encode()).hexdigest()
    seen = os.path.join(OWN, 'notified')
    if (read(seen) or '').strip() == key:
        return
    if os.environ.get('TAHOE_REPAIR_NOTIFY') == 'print':
        print('[tahoe-repair] NOTIFY: ' + text.replace('\n', ' | '))
    elif shutil.which('notify-send') and os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
        sh('notify-send', '--app-name=Tahoe repair', '--icon=preferences-desktop-theme', 'Liquid Glass needs you', text)
    if write:
        os.makedirs(OWN, exist_ok=True)
        open(seen, 'w').write(key + '\n')


# ---- the world: state, versions, settings, the shell -------------------------------------------

def read_state():
    s = {}
    for line in (read(STATE_FILE) or '').splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            s[k.strip()] = v.strip()
    ctx = dict(s)
    ctx['glass'] = s.get('enabled') == '1'
    mode = s.get('mode') or ('dark' if s.get('tint') == 'dark' else 'milky')
    ctx['mode'] = mode if ctx['glass'] else 'milky'
    ctx['skip'] = {x.strip() for x in s.get('repair-skip', '').split(',') if x.strip()}
    return ctx


def installed_shell():
    fake = os.environ.get('TAHOE_REPAIR_FAKE_SHELL')
    if fake:
        return fake
    _, out, _ = sh('gnome-shell', '--version')
    m = re.search(r'(\d+(?:\.\w+)*)', out)
    return m.group(1) if m else ''


def package_versions():
    rc, out, _ = sh('pacman', '-Q', *PACKAGES)
    vers = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            vers[parts[0]] = parts[1]
    return vers


def metadata(uuid, base=EXT_DIR):
    try:
        return json.load(open(os.path.join(base, uuid, 'metadata.json')))
    except (OSError, ValueError):
        return None


class Shell:
    """The running shell on the session bus, or None parts when it is not there (tests, early login)."""

    def __init__(self, wait=0):
        self.proxy, self.exts, self.version = None, None, None
        deadline = time.time() + wait
        while True:
            self._connect()
            if self.exts is not None or time.time() >= deadline:
                break
            time.sleep(2)

    def _connect(self):
        if os.environ.get('TAHOE_REPAIR_NO_SHELL'):
            return
        try:
            self.proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, None,
                'org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell.Extensions', None)
            if not self.proxy.get_name_owner():
                self.proxy = None
                return
            v = self.proxy.get_cached_property('ShellVersion')
            self.version = v.unpack() if v else None
            r = self.proxy.call_sync('ListExtensions', None, Gio.DBusCallFlags.NONE, 5000, None)
            self.exts = {u: {k: v for k, v in d.items()} for u, d in r.unpack()[0].items()}
        except GLib.Error:
            self.proxy, self.exts = None, None

    def state(self, uuid):
        if self.exts is None:
            return None
        d = self.exts.get(uuid)
        return STATES.get(int(d.get('state', 0)), str(d.get('state'))) if d else 'NOT LOADED'


class Settings:
    """Gio settings for the system schemas and each extension's own schemas folder."""

    def __init__(self):
        self.sources = {}

    def get(self, schema, ext=None):
        if ext:
            d = os.path.join(EXT_DIR, ext, 'schemas')
            if not os.path.exists(os.path.join(d, 'gschemas.compiled')):
                return None, f'{ext} has no compiled schemas'
            if d not in self.sources:
                self.sources[d] = Gio.SettingsSchemaSource.new_from_directory(d, Gio.SettingsSchemaSource.get_default(), False)
            src = self.sources[d]
        else:
            src = Gio.SettingsSchemaSource.get_default()
        s = src.lookup(schema, True)
        if not s:
            return None, f'schema {schema} not installed'
        return (Gio.Settings.new_full(s, None, None), s), None


def same(a, b):
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) < 1e-6
        except (TypeError, ValueError):
            return False
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    return a == b


# ---- the engine ------------------------------------------------------------------------------

class Repair:
    def __init__(self, args, write):
        self.write = write
        self.log = Log(write)
        self.verbose = '--verbose' in args
        self.only = None
        if '--only' in args:
            self.only = args[args.index('--only') + 1].split(',')
        wait = int(args[args.index('--wait') + 1]) if '--wait' in args else 0
        self.state = read_state()
        self.manifest, self.manifest_stale = self.load_manifest()
        self.tested = self.manifest['tested_shell']
        self.shell_ver = installed_shell()
        self.major = self.shell_ver.split('.')[0]
        self.hold = self.major not in self.tested
        self.settings = Settings()
        self.shell = Shell(wait)
        self.notes = []          # lines for the one notification
        self.logout = []         # reasons a logout is needed
        self.reload_theme = False
        self.in_worktree = '/.claude/worktrees/' in ROOT + '/'

    def load_manifest(self):
        path = os.path.join(ROOT, 'config', 'repair-manifest.json')
        committed = read(path)
        try:
            gen = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'repair_manifest.py')],
                                 capture_output=True, text=True, check=True).stdout
        except subprocess.CalledProcessError:
            gen = None
        if committed is None and gen is None:
            raise SystemExit('no manifest: config/repair-manifest.json')
        stale = gen is not None and committed != gen
        # a stale manifest would fight the token-driven fixes: use the tokens' current one
        return json.loads(gen if stale else committed), stale

    # -- conditions
    def applies(self, item):
        for k, want in (item.get('when') or {}).items():
            if k == 'path':
                if not os.path.exists(expand(want)):
                    return False
                continue
            if k == 'font':
                if not self.font(want):
                    return False
                continue
            have = self.state.get(k)
            if isinstance(want, dict) and 'not' in want:
                if have == want['not']:
                    return False
            elif isinstance(want, list):
                if have not in want:
                    return False
            elif have != want:
                return False
        return True

    def font(self, family):
        _, out, _ = sh('fc-list', family, 'family')
        return bool(out.strip())

    def compatible(self, uuid):
        """Would this extension load on the running shell? Without validation, anything on a tested major."""
        m = metadata(uuid)
        if m is None:
            return False
        return self.major in [str(v).split('.')[0] for v in m.get('shell-version', [])] or not self.hold

    # -- checks: each returns (status, detail)
    def value_of(self, c):
        vf = c.get('value_from')
        if vf == 'app-ids':
            _, out, _ = sh(sys.executable, os.path.join(ROOT, 'scripts', 'glass-app-ids.py'))
            return out.strip()
        if vf == 'interface-font':
            s, _ = self.settings.get('org.gnome.desktop.interface')
            return GLib.Variant('s', s[0].get_string('font-name')).print_(False)
        return c['value']

    def c_gsetting(self, c):
        s, err = self.settings.get(c['schema'], c.get('ext'))
        if not s:
            return SKIP, err
        settings, schema = s
        if not schema.has_key(c['key']):
            return SKIP, f'{c["key"]} is not in this build of {c["schema"]}'
        vtype = schema.get_key(c['key']).get_value_type()
        want = GLib.Variant.parse(vtype, self.value_of(c), None, None)
        have = settings.get_value(c['key'])
        if same(have.unpack(), want.unpack()):
            return OK, have.print_(False)[:80]
        h, w = have.unpack(), want.unpack()
        if isinstance(h, list) and isinstance(w, list):
            extra, miss = [x for x in h if x not in w], [x for x in w if x not in h]
            return DRIFT, f'{c["key"]}: missing {miss[:8]}, extra {extra[:8]}' + (' (order differs)' if not extra and not miss else '')
        return DRIFT, f'{c["key"]} is {have.print_(False)[:120]}, want {want.print_(False)[:120]}'

    def c_gsetting_contains(self, c):
        s, err = self.settings.get(c['schema'], c.get('ext'))
        if not s:
            return SKIP, err
        if c['text'] in s[0].get_value(c['key']).print_(False):
            return OK, ''
        return DRIFT, f'{c["key"]} has no {c["text"]}'

    def c_exists(self, c):
        if c.get('if_dir') and not os.path.isdir(expand(c['if_dir'])):
            return SKIP, 'not installed'
        return (OK, '') if os.path.exists(expand(c['path'])) else (DRIFT, f'{c["path"]} missing')

    def c_absent_text(self, c):
        files = sorted(glob.glob(expand(c['glob'])))
        if not files:
            return SKIP, 'no such file'
        bad = [f for f in files if c['text'] in (read(f) or '')]
        return (DRIFT, 'found in ' + ', '.join(os.path.relpath(f, HOME) for f in bad)) if bad else (OK, '')

    def c_contains(self, c):
        text = read(expand(c['path']))
        if text is None:
            return DRIFT, f'{c["path"]} missing'
        miss = [expand(t) for t in c['text'] if expand(t) not in text]
        return (DRIFT, 'missing: ' + ' | '.join(m.replace('\n', ' ')[:70] for m in miss)) if miss else (OK, '')

    def c_symlink(self, c):
        path, target = expand(c['path']), expand(c['target'])
        if not os.path.exists(os.path.join(target, c['need']) if c.get('need') else target):
            if c.get('if_target'):
                return SKIP, 'target not there'
            if os.path.exists(path):
                return INFO, f'{c["target"]} is not there; the current {c["path"]} works'
            return ACTION, f'{c["path"]} is broken and {c["target"]} is not there to link to'
        if os.path.islink(path) and os.path.realpath(path) == os.path.realpath(target):
            return OK, ''
        if os.path.exists(path) and not os.path.islink(path) and os.path.isdir(path):
            return ACTION, f'{c["path"]} is a real folder; not replaced'
        return DRIFT, f'{c["path"]} -> {os.readlink(path) if os.path.islink(path) else "(not a link)"}'

    def rendered_overrides(self):
        """The overrides block each shell theme should hold (glass-bar.sh shell_overrides)."""
        mode = self.state['mode']
        out = {}
        for name, m in (('Dark', 'dark' if mode == 'light' else mode), ('Light', 'light')):
            css = os.path.join(HOME, '.themes', f'MacTahoe-{name}', 'gnome-shell', 'gnome-shell.css')
            if os.path.exists(css):
                _, block, _ = sh(sys.executable, os.path.join(ROOT, 'scripts', 'glass-tokens.py'), 'render',
                                 os.path.join(ROOT, 'config', 'gnome-shell-overrides.css'), m)
                out[css] = block.strip()
        return out

    def c_overrides(self, c):
        want = self.rendered_overrides()
        if not want:
            return SKIP, 'no MacTahoe shell theme'
        bad = []
        for css, block in want.items():
            m = re.search(r'/\* tahoe-overrides:.*?/\* end tahoe-overrides \*/', read(css) or '', flags=re.S)
            if not m or m.group(0).strip() != block:
                bad.append(os.path.relpath(css, HOME) + (' (missing)' if not m else ' (out of date)'))
        return (DRIFT, ', '.join(bad)) if bad else (OK, '')

    def c_theme_loaded(self, c):
        if self.shell.exts is None:
            return SKIP, 'no shell on this session bus'
        _, pids, _ = sh('pgrep', '-u', str(os.getuid()), '-x', 'gnome-shell')
        if not pids.split():
            return SKIP, 'no gnome-shell process'
        _, et, _ = sh('ps', '-o', 'etimes=', '-p', pids.split()[0])
        _, out, _ = sh('journalctl', '--user', '--no-pager', '-o', 'cat', '--since', f'-{int(et.strip() or 0) + 5}s')
        loads = [l for l in out.splitlines() if re.search(r'loading (user|default) theme', l)]
        if not loads:
            return OK, 'no theme load logged this login'
        return (DRIFT, loads[-1][:120]) if 'Adwaita' in loads[-1] or 'default theme' in loads[-1] else (OK, '')

    def c_gdm_gresource(self, c):
        if not os.path.exists(GDM_KEYS):
            return SKIP, 'the Tahoe login screen is not installed'
        cmd = f'bash {ROOT}/scripts/gdm-theme.sh install'
        try:
            Gio.Resource.load(SYS_GRESOURCE).lookup_data('/org/gnome/shell/theme/tahoe-gdm-background.png', 0)
        except GLib.Error:
            return ACTION, f'a gnome-shell update replaced the login screen theme: run {cmd} (sudo)'
        m = metadata('tahoe-gdm@cachyos-tahoe', os.path.dirname(GDM_EXT))
        if m and self.major not in m.get('shell-version', []):
            return HELD, f'tahoe-gdm says GNOME {m.get("shell-version")}, running {self.major}: the login screen extension does not load'
        base = SYS_GRESOURCE + '.pre-gdm-tahoe'
        _, info, _ = sh('pacman', '-Qi', 'gnome-shell')
        m2 = re.search(r'Install Date\s*:\s*(.+)', info)
        if os.path.exists(base) and m2:
            _, epoch, _ = sh('date', '-d', m2.group(1).strip(), '+%s')
            if epoch.strip().isdigit() and os.path.getmtime(base) < int(epoch) and self.hold:
                return INFO, 'the login screen base (.pre-gdm-tahoe) predates this GNOME major; rebuild it with MacTahoe first'
        return OK, ''

    def c_version_validation(self, c):
        s, _ = self.settings.get('org.gnome.shell')
        have = s[0].get_boolean('disable-extension-version-validation')
        want = not self.hold
        if have == want:
            return OK, f'{"off" if have else "on"}'
        if self.hold:
            return DRIFT, f'GNOME {self.major} is not tested ({", ".join(self.tested)}): turn version validation back on'
        return DRIFT, 'validation is on: Open Bar and the Rounded Window Corners port need it off on GNOME ' + self.major

    def ext_plan(self):
        m, st = self.manifest, self.state
        want_on = list(m['core_extensions']) + (m['glass_extensions'] if st['glass'] else [])
        want_off = [] if st['glass'] else list(m['glass_extensions'])
        for key, uuids in m['switched_extensions'].items():
            if st.get(key) == 'on':
                want_on += uuids
            elif st.get(key) == 'off':
                want_off += uuids
        if 'C9' in st['skip']:
            return [], [], []
        s, _ = self.settings.get('org.gnome.shell')
        cur = list(s[0].get_strv('enabled-extensions'))
        add = [u for u in want_on if u not in cur and self.compatible(u)]
        missing = [u for u in want_on if u not in cur and metadata(u) is None]
        held = [u for u in want_on if u not in cur and metadata(u) is not None and not self.compatible(u)]
        remove = [u for u in want_off if u in cur]
        return add, remove, missing + held

    def c_extensions(self, c):
        add, remove, absent = self.ext_plan()
        parts = []
        if add:
            parts.append('to enable: ' + ', '.join(add))
        if remove:
            parts.append('switched off but enabled: ' + ', '.join(remove))
        if add or remove:
            return DRIFT, '; '.join(parts)
        if absent:
            gone = [u for u in absent if metadata(u) is None]
            held = [u for u in absent if u not in gone]
            if held:
                return HELD, 'not for GNOME ' + self.major + ': ' + ', '.join(held)
            return INFO, 'not installed (see their own items): ' + ', '.join(gone)
        return OK, ''

    def c_extension_state(self, c):
        if self.shell.exts is None:
            return SKIP, 'no shell on this session bus'
        s, _ = self.settings.get('org.gnome.shell')
        bad = [(u, self.shell.state(u)) for u in s[0].get_strv('enabled-extensions')
               if self.shell.state(u) in ('ERROR', 'OUT OF DATE')]
        if not bad:
            return OK, ''
        text = ', '.join(f'{u} {st}' for u, st in bad)
        return (HELD if self.hold else ACTION), text + ' (a logout reloads changed code; ERROR that stays needs a fix)'

    def c_bms_patched(self, c):
        f = os.path.join(EXT_DIR, BMS, 'components/applications/window_rules.js')
        if 'is_app_menu' in (read(f) or ''):
            return OK, ''
        return DRIFT, 'Blur My Shell is missing' if metadata(BMS) is None else 'Blur My Shell is a stock build (no glass patch)'

    def patch_sha(self):
        return hashlib.sha256(open(os.path.join(ROOT, 'config', 'bms-tahoe-glass.patch'), 'rb').read()).hexdigest()

    def bms_commit(self):
        m = re.search(r'^BMS_COMMIT=([0-9a-f]+)', read(os.path.join(ROOT, 'scripts', 'glass-bar.sh')) or '', re.M)
        return m.group(1) if m else None

    def c_bms_stamp(self, c):
        m = metadata(BMS)
        if m is None or 'is_app_menu' not in (read(os.path.join(EXT_DIR, BMS, 'components/applications/window_rules.js')) or ''):
            return SKIP, 'not the patched build (D1)'
        have = m.get('tahoe-glass-patch-sha256')
        if not have:
            return INFO, 'built before builds were stamped: provenance unverified (the next rebuild stamps it)'
        if have != self.patch_sha() or m.get('tahoe-glass-commit') != self.bms_commit():
            return DRIFT, 'built from another patch or commit than the repo\'s'
        return OK, f'commit {m.get("tahoe-glass-commit", "")[:7]}, patch {have[:12]}'

    def c_pending_updates(self, c):
        pend = sorted(os.listdir(UPDATES_DIR)) if os.path.isdir(UPDATES_DIR) else []
        patched = [u for u in pend if u in c['patched']]
        if patched:
            return DRIFT, 'GNOME will install upstream builds of patched extensions at the next login: ' + ', '.join(patched)
        return (INFO, 'pending updates: ' + ', '.join(pend)) if pend else (OK, '')

    def c_metadata_shell(self, c):
        m = metadata(c['uuid'])
        if m is None:
            return SKIP, 'not installed'
        return (OK, '') if self.major in m.get('shell-version', []) else (DRIFT, f'shell-version {m.get("shell-version")}')

    def c_font(self, c):
        return (OK, '') if self.font(c['family']) else (ACTION, f'{c["family"]} not installed')

    def tree_hash(self, path):
        h = hashlib.sha256()
        for d, dirs, files in sorted(os.walk(path)):
            dirs.sort()
            for f in sorted(files):
                if f.endswith('.compiled'):
                    continue
                p = os.path.join(d, f)
                h.update(os.path.relpath(p, path).encode())
                h.update(open(p, 'rb').read())
        return h.hexdigest()

    def c_tahoe_installed(self, c):
        uuid = c['uuid']
        repo = os.path.join(ROOT, 'extensions', uuid)
        if metadata(uuid) is None:
            if self.hold and self.major not in (metadata(uuid, os.path.join(ROOT, 'extensions')) or {}).get('shell-version', []):
                return HELD, f'switched on but not installed, and the repo copy is for GNOME {self.tested}'
            return DRIFT, 'switched on but not installed'
        if os.path.isdir(repo) and self.tree_hash(repo) != self.tree_hash(os.path.join(EXT_DIR, uuid)):
            return INFO, 'installed copy differs from this checkout (its on script installs it; loads after a logout)'
        return OK, ''

    def c_packages_changed(self, c):
        if not os.path.exists(PKG_STAMP):
            return SKIP, 'no pacman hook stamp'
        last = self.prev.get('run', 0)
        if os.path.getmtime(PKG_STAMP) > last:
            return INFO, 'packages changed: ' + ' '.join((read(PKG_STAMP) or '').split())[:200]
        return OK, ''

    def c_shell_restart(self, c):
        if not self.shell.version:
            return SKIP, 'no shell on this session bus'
        if os.environ.get('TAHOE_REPAIR_FAKE_SHELL') or self.shell.version == self.shell_ver:
            return OK, self.shell.version
        return ACTION, f'running GNOME Shell {self.shell.version}, installed {self.shell_ver}: log out to finish the update'

    def c_manifest_fresh(self, c):
        return (INFO, 'config/repair-manifest.json is stale; using the tokens\' current values '
                      '(python3 scripts/repair_manifest.py > config/repair-manifest.json)') if self.manifest_stale else (OK, '')

    # -- fixes: each changes things and returns a short description
    def f_set(self, it):
        c = it['check']
        settings, schema = self.settings.get(c['schema'], c.get('ext'))[0]
        vtype = schema.get_key(c['key']).get_value_type()
        settings.set_value(c['key'], GLib.Variant.parse(vtype, self.value_of(c), None, None))
        Gio.Settings.sync()
        if it['fix'].get('reload_theme'):
            self.reload_theme = True
        if it['fix'].get('openbar_reload'):
            settings.set_boolean('trigger-reload', not settings.get_boolean('trigger-reload'))
            Gio.Settings.sync()
        return f'set {c["key"]}'

    def f_run(self, it):
        cmd = it['fix']['cmd']
        for b in it['fix'].get('backup', []):
            self.log.backup(b)
        rc, out, err = sh('bash', os.path.join(ROOT, 'scripts', cmd[0]), *cmd[1:])
        if rc:
            raise RuntimeError(f'{" ".join(cmd)} failed (exit {rc}): {(err.strip() or out.strip())[-300:]}')
        return 'ran ' + ' '.join(cmd)

    def f_reload_theme(self, it):
        self.reload_theme = True
        return 'shell theme reload queued'

    def f_replace(self, it):
        c, f = it['check'], it['fix']
        for p in glob.glob(expand(c['glob'])):
            t = read(p)
            if c['text'] in t:
                self.log.backup(p)
                open(p, 'w').write(t.replace(f['old'], f['new']))
        return 'replaced ' + f['old']

    def f_strip_block(self, it):
        c, f = it['check'], it['fix']
        for p in glob.glob(expand(c['glob'])):
            t = read(p)
            self.log.backup(p)
            t = re.sub(r'\n*' + re.escape(f['begin']) + r'.*?' + re.escape(f['end']) + r'\n?', '\n', t, flags=re.S)
            open(p, 'w').write(t)
        return 'removed the old block'

    def f_symlink(self, it):
        c = it['check']
        path, target = expand(c['path']), expand(c['target'])
        self.log.backup(path)
        if os.path.lexists(path):
            os.remove(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        os.symlink(target, path)
        return f'linked {c["path"]}'

    def f_copy(self, it):
        f = it['fix']
        src, dst = expand(f['from']), expand(f['to'])
        for name in os.listdir(src):
            self.log.backup(os.path.join(dst, name))
            shutil.copy2(os.path.join(src, name), os.path.join(dst, name))
        return f'copied {f["from"]}'

    def f_rename(self, it):
        src, dst = expand(it['fix']['from']), expand(it['check']['path'])
        if not os.path.exists(src):
            raise RuntimeError(f'{src} is not there to restore')
        os.rename(src, dst)
        return f'restored {os.path.basename(dst)}'

    def f_template(self, it):
        path = expand(it['check']['path'])
        self.log.backup(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w').write(read(expand(it['fix']['from'])).replace('@ROOT@', ROOT))
        return f'wrote {it["check"]["path"]}'

    def f_metadata_shell(self, it):
        p = os.path.join(EXT_DIR, it['check']['uuid'], 'metadata.json')
        self.log.backup(p)
        m = json.load(open(p))
        m['shell-version'] = [self.major]
        json.dump(m, open(p, 'w'), indent=4)
        self.logout.append(it['check']['uuid'] + ' metadata')
        return f'shell-version [{self.major}]'

    def f_version_validation(self, it):
        s, _ = self.settings.get('org.gnome.shell')
        s[0].set_boolean('disable-extension-version-validation', not self.hold)
        Gio.Settings.sync()
        if self.hold:
            self.notes.append(f'GNOME {self.major} is new to this design (tested on {", ".join(self.tested)}): '
                              'patches, ports and the Tahoe extensions are held back until they are updated for it.')
            self.logout.append('extension version checks back on')
        return 'version validation ' + ('on' if self.hold else 'off')

    def f_extensions(self, it):
        add, remove, _ = self.ext_plan()
        s, _ = self.settings.get('org.gnome.shell')
        cur = [u for u in s[0].get_strv('enabled-extensions') if u not in remove]
        s[0].set_strv('enabled-extensions', cur + [u for u in add if u not in cur])
        Gio.Settings.sync()
        return f'enabled {add or "-"}, disabled {remove or "-"}'

    def f_bms_rebuild(self, it):
        commit = self.bms_commit()
        src = os.path.join(HOME, '.local/src/blur-my-shell')
        if os.path.isdir(os.path.join(src, '.git')) and commit:
            tmp = os.path.join(OWN, 'bms-check')
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp)
            rc, _, err = sh('sh', '-c', f'git -C "$1" archive "$2" | tar -x -C "$3" && cd "$3" && git init -q . && '
                            f'git apply --check "$4"', 'x', src, commit, tmp,
                            os.path.join(ROOT, 'config', 'bms-tahoe-glass.patch'))
            shutil.rmtree(tmp, ignore_errors=True)
            if rc:
                self.notes.append(f'The glass patch no longer applies to Blur My Shell {commit[:7]}; the installed build was left as it is.')
                raise RuntimeError('patch does not apply: ' + err.strip()[-200:])
        self.log.backup(os.path.join(EXT_DIR, BMS))
        self.f_run({'fix': {'cmd': ['glass-bar.sh', 'rebuild']}})
        self.logout.append('Blur My Shell rebuilt with the glass patch')
        return 'rebuilt Blur My Shell'

    def f_quarantine_updates(self, it):
        moved = []
        for u in it['check']['patched']:
            p = os.path.join(UPDATES_DIR, u)
            if os.path.exists(p):
                self.log.backup(p)
                shutil.rmtree(p)
                moved.append(u)
        self.notes.append('Upstream updates of ' + ', '.join(moved) + ' were held back to keep the glass patches '
                          '(kept in ' + self.log.backup_dir + ').')
        return 'held back ' + ', '.join(moved)

    def f_mactahoe_install(self, it):
        src = os.path.join(HOME, '.local/src/MacTahoe-gtk-theme')
        if not os.path.isdir(src):
            sh('git', 'clone', '-q', '--depth', '1', 'https://github.com/vinceliuice/MacTahoe-gtk-theme', src, check=True)
        for d in glob.glob(os.path.join(HOME, '.config/gtk-4.0/gtk*.css')) + [os.path.join(HOME, '.config/gtk-3.0/gtk.css')]:
            self.log.backup(d)
        shutil.rmtree('/tmp/MacTahoe.lock', ignore_errors=True)
        sh('sh', '-c', 'cd "$1" && TERM=xterm-256color script -qfec "./install.sh -b -l" /dev/null', 'x', src)
        self.logout.append('MacTahoe theme reinstalled')
        return 'reinstalled MacTahoe'

    def f_notify(self, it):
        self.notes.append(expand(it['fix']['text']))
        return 'told the user'

    # -- the run
    def items(self):
        for it in self.manifest['items']:
            if self.only and not any(it['id'].startswith(o) for o in self.only):
                continue
            yield it

    def check_one(self, it):
        if it['id'] in self.state['skip'] or it['id'].split('-')[0] in self.state['skip']:
            return SKIP, 'repair-skip in the state file'
        if it['id'] in ('H1', 'H2') and self.in_worktree and not os.environ.get('TAHOE_REPAIR_ALLOW_WORKTREE'):
            return SKIP, 'running from a worktree: the entry points stay on the live checkout'
        if not self.applies(it):
            return SKIP, 'does not apply to your switches'
        fn = getattr(self, 'c_' + it['check']['type'].replace('-', '_'))
        try:
            st, detail = fn(it['check'])
        except Exception as e:  # noqa: BLE001  a check that fails is reported, never fatal
            return 'error', f'{type(e).__name__}: {e}'
        if st == DRIFT and it.get('enforce') is False:
            st = INFO
        if st == DRIFT and it.get('guard') == 'tested' and self.hold:
            st, detail = HELD, f'{detail} (held: GNOME {self.major} is not tested)'
        return st, detail

    def check_all(self, quiet=False):
        results = []
        for it in self.items():
            st, detail = self.check_one(it)
            results.append((it, st, detail))
            if not quiet and (st not in (OK, SKIP) or self.verbose):
                print(f'{st:6} {it["id"]:22} {it["feature"]}' + (f': {detail}' if detail else ''))
        return results

    ORDER = {'mactahoe-install': 0, 'bms-rebuild': 1, 'quarantine-updates': 1, 'copy': 2, 'rename': 2, 'replace': 2,
             'strip-block': 2, 'symlink': 2, 'template': 2, 'metadata-shell': 2, 'run': 3, 'set': 4,
             'version-validation': 5, 'extensions': 5, 'reload-theme': 6, 'notify': 7}

    def fix_of(self, it):
        if it['check']['type'] == 'version-validation':
            return {'type': 'version-validation'}
        if it['check']['type'] == 'extensions':
            return {'type': 'extensions'}
        return it.get('fix')

    def repair(self, results):
        todo = []
        for it, st, _ in results:
            fix = self.fix_of(it)
            if fix and (st == DRIFT or (st == ACTION and fix['type'] == 'notify')):
                order = self.ORDER[fix['type']]
                if fix['type'] == 'run' and not fix['cmd'][0].startswith('glass-bar'):
                    order = 2
                todo.append((order, it, fix))
        done_runs = set()
        for _, it, fix in sorted(todo, key=lambda t: t[0]):
            key = tuple(fix.get('cmd', [])) if fix['type'] in ('run', 'bms-rebuild', 'mactahoe-install') else None
            if fix['type'] == 'bms-rebuild':
                key = ('bms-rebuild',)
            if key and key in done_runs:
                continue
            try:
                desc = getattr(self, 'f_' + fix['type'].replace('-', '_'))(dict(it, fix=fix))
                self.log(f'{it["id"]}: {desc}')
                self.log.changes += 1
                if fix.get('logout') and fix['type'] != 'bms-rebuild':
                    self.logout.append(it['feature'])
            except Exception as e:  # noqa: BLE001
                self.log(f'{it["id"]}: fix failed: {e}')
            if key:
                done_runs.add(key)
        if self.reload_theme:
            s, _ = self.settings.get('org.gnome.shell.extensions.user-theme')
            name = s[0].get_string('name')
            s[0].set_string('name', '')
            Gio.Settings.sync()
            time.sleep(1)
            s[0].set_string('name', name)
            Gio.Settings.sync()
            self.log(f'reloaded the shell theme {name}')
            self.reload_theme = False

    def versions(self):
        v = {'shell': self.shell_ver, 'running': self.shell.version, 'packages': package_versions(), 'extensions': {}}
        for d in sorted(glob.glob(os.path.join(EXT_DIR, '*', 'metadata.json'))):
            m = metadata(os.path.basename(os.path.dirname(d))) or {}
            v['extensions'][m.get('uuid', os.path.basename(os.path.dirname(d)))] = m.get('version')
        return v

    def version_changes(self, now):
        out = []
        old = self.prev
        for name, ver in now.get('packages', {}).items():
            was = old.get('packages', {}).get(name)
            if was and was != ver:
                out.append(f'{name} {was} -> {ver}')
        for uuid, ver in now.get('extensions', {}).items():
            was = old.get('extensions', {}).get(uuid)
            if was is not None and was != ver:
                out.append(f'{uuid} v{was} -> v{ver}')
        if old.get('shell') and old['shell'].split('.')[0] != self.major:
            out.append(f'GNOME major {old["shell"]} -> {self.shell_ver}')
        return out


def main(argv):
    mode = argv[0] if argv and not argv[0].startswith('-') else 'repair'
    if mode not in ('check', 'repair', 'status'):
        sys.exit(__doc__)
    if 'repair=off' in (read(STATE_FILE) or '').splitlines() and mode == 'repair':
        print('[tahoe-repair] repair=off in the state file: nothing done')
        return 0
    write = mode == 'repair'
    if write:
        os.makedirs(OWN, exist_ok=True)
        lock = open(os.path.join(OWN, 'lock'), 'w')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print('[tahoe-repair] another run is going; nothing done')
            return 0
    r = Repair(argv[1:] if argv and argv[0] == mode else argv, write)
    try:
        r.prev = json.load(open(os.path.join(OWN, 'versions.json')))
    except (OSError, ValueError):
        r.prev = {}
    now = r.versions()
    if mode == 'status':
        print(json.dumps({'state': {k: v for k, v in r.state.items() if k != 'skip'}, 'hold': r.hold,
                          'tested_shell': r.tested, **now}, indent=1, default=list))
        return 0
    for line in r.version_changes(now):
        r.log(f'changed since the last run: {line}')
    if r.hold:
        r.log(f'GNOME {r.shell_ver} is not a tested major ({", ".join(r.tested)}): hold mode, nothing 51-only is reapplied')
    results = r.check_all(quiet=write)
    if write:
        for _ in range(2):
            if not any(st == DRIFT for _, st, _ in results) and not any(
                    st == ACTION and (r.fix_of(it) or {}).get('type') == 'notify' for it, st, _ in results):
                break
            r.repair(results)
            r.settings = Settings()
            results = r.check_all(quiet=True)
            if not any(st == DRIFT for _, st, _ in results):
                break
        for it, st, detail in results:
            if st in (DRIFT, ACTION, HELD, 'error'):
                r.log(f'{st} {it["id"]} {it["feature"]}: {detail}')
                if st in (ACTION, HELD):
                    r.notes.append(detail)
        if r.logout:
            r.notes.insert(0, 'Log out and back in to finish: ' + '; '.join(dict.fromkeys(r.logout)) + '.')
        notify(r.log, r.notes, write)
        now['run'] = time.time()
        json.dump(now, open(os.path.join(OWN, 'versions.json'), 'w'), indent=1)
        r.log(f'done: {r.log.changes} change(s)' + (f', backups in {r.log.backup_dir}' if os.path.isdir(r.log.backup_dir) else ''))
    worst = max([EXIT.get(st, 3) for _, st, _ in results] or [0])
    if any(st == 'error' for _, st, _ in results):
        worst = 3
    if not write:
        counts = {}
        for _, st, _ in results:
            counts[st] = counts.get(st, 0) + 1
        print('summary: ' + ', '.join(f'{v} {k}' for k, v in sorted(counts.items())) + f'; exit {worst}')
    return worst


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
