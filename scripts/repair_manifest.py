#!/usr/bin/env python3
"""The expected state of the Liquid Glass desktop, for tahoe-repair (docs/REPAIR.md, Phase 2).

  python3 scripts/repair_manifest.py > config/repair-manifest.json   regenerate the manifest
  python3 scripts/repair_manifest.py --check                         exit 1 if the committed one is stale

Every item is one thing the design needs. 'when' is the state-file condition it applies under
(scripts/tahoe_repair.py reads ~/.config/tahoe-glass/state): a value, a list of values, or
{"not": value}. Keys: glass (true when enabled=1), mode (light|dark|milky), bar, menus, dock, apps,
widgets, motion, lockscreen, controlcenter, menubar. 'enforce': false items are reported, never fixed.
'guard': "tested" items are fixed only on a GNOME major listed in TESTED_SHELL (else held).
Radii, edge alpha and the GTK block markers come from tokens/, so a token change changes the manifest.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(ROOT, 'tokens')
RADIUS = json.load(open(os.path.join(TOKENS, 'radius.json')))
GLASS = json.load(open(os.path.join(TOKENS, 'glass.json')))
MODES = ['light', 'dark', 'milky']
TESTED_SHELL = ['51']

BMS = 'blur-my-shell@aunetx'
DOCK = 'dash-to-dock@micxgx.gmail.com'
OPENBAR = 'openbar@neuromorph'
RWC = 'rounded-window-corners@fxgn'
NOWPLAYING = 'nowplaying@epogonii.github.io'
VITALS = 'Vitals@CoreCoding.com'
KIWI = 'kiwimenu@kemma'
EXT = '~/.local/share/gnome-shell/extensions'


def radius(path):
    value = RADIUS
    for part in path.split('.'):
        value = value[part]
    return value


items = []


def item(id, feature, check, fix=None, when=None, **extra):
    d = {'id': id, 'feature': feature, 'check': check}
    if fix:
        d['fix'] = fix
    if when:
        d['when'] = when
    d.update(extra)
    items.append(d)


def gs(id, feature, schema, key, value, when=None, ext=None, fix=None, **extra):
    check = {'type': 'gsetting', 'schema': schema, 'key': key, 'value': value}
    if ext:
        check['ext'] = ext
    item(id, feature, check, fix or {'type': 'set'}, when, **extra)


def run(*cmd, backup=(), logout=False):
    d = {'type': 'run', 'cmd': list(cmd)}
    if backup:
        d['backup'] = list(backup)
    if logout:
        d['logout'] = True
    return d


GLASS_ON = {'glass': True}
GTK4 = '~/.config/gtk-4.0'
GTK3_CSS = '~/.config/gtk-3.0/gtk.css'
SHELL_CSS = ['~/.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css', '~/.themes/MacTahoe-Light/gnome-shell/gnome-shell.css']
GTK4_CSS = [f'{GTK4}/gtk-Dark.css', f'{GTK4}/gtk-Light.css']


def mode_name(m):
    return 'Light' if m == 'light' else 'Dark'


# ---- A. shell theme and CSS -------------------------------------------------------------------
item('A1', 'MacTahoe Dark shell theme present', {'type': 'exists', 'path': SHELL_CSS[0]},
     {'type': 'mactahoe-install', 'logout': True})
item('A1-content', 'MacTahoe Dark shell theme is whole (not emptied by a failed install)',
     {'type': 'contains', 'path': SHELL_CSS[0], 'text': ['#panel', '.popup-menu-content']},
     {'type': 'mactahoe-install', 'logout': True})
item('A1-light', 'MacTahoe Light shell theme present (light mode)', {'type': 'exists', 'path': SHELL_CSS[1]},
     {'type': 'mactahoe-install', 'logout': True}, {'mode': 'light'})
for m in MODES:
    gs(f'A2-{m}', 'Shell theme for the mode', 'org.gnome.shell.extensions.user-theme', 'name',
       f"'MacTahoe-{mode_name(m)}'", {'mode': m}, fix={'type': 'set', 'reload_theme': True})
item('A2-loaded', 'Shell theme actually loaded (not the Adwaita fallback)', {'type': 'theme-loaded'},
     {'type': 'reload-theme'})
item('A3', 'Shell CSS overrides rendered from config/gnome-shell-overrides.css with tokens/',
     {'type': 'overrides'}, run('glass-bar.sh', 'overrides', backup=SHELL_CSS))
item('A5', 'GTK3 windows rounded on all four corners',
     {'type': 'absent-text', 'glob': '~/.themes/MacTahoe-*/gtk-3.0/gtk*.css', 'text': 'border-radius: 24px 24px 0 0'},
     {'type': 'replace', 'old': 'border-radius: 24px 24px 0 0', 'new': 'border-radius: 24px'})
item('A6', 'Tahoe login screen theme in the system gresource (when installed)', {'type': 'gdm-gresource'})

# ---- B. GTK apps ------------------------------------------------------------------------------
for m in MODES:
    light = m == 'light'
    gs(f'B1-gtk-{m}', 'GTK3 theme for the mode', 'org.gnome.desktop.interface', 'gtk-theme',
       f"'MacTahoe-{mode_name(m)}-solid'", {'mode': m})
    gs(f'B1-scheme-{m}', 'Colour scheme for the mode', 'org.gnome.desktop.interface', 'color-scheme',
       "'default'" if light else "'prefer-dark'", {'mode': m})
    item(f'B2-{m}', 'libadwaita stylesheet link for the mode',
         {'type': 'symlink', 'path': f'{GTK4}/gtk.css', 'target': f'{GTK4}/gtk-{mode_name(m)}.css', 'if_target': True},
         {'type': 'symlink'}, {'mode': m})
r, gap, row = radius('app_menu.radius'), radius('app_menu.gap'), radius('app_menu.row')
for m in ['light', 'dark']:
    f = f'{GTK4}/gtk-{mode_name(m)}.css'
    item(f'B3-{m}', 'GTK4 glass block for the mode, with the menu radii from tokens/',
         {'type': 'contains', 'path': f, 'text': [f'mode: {m}; menus: glass;',
                                                   f'border-radius: {r}px; padding: {gap}px;',
                                                   f'modelbutton.flat {{ border-radius: {row}px; }}']},
         run('glass-bar.sh', 'apps', 'on', backup=GTK4_CSS + [GTK3_CSS]), {'glass': True, 'apps': 'on', 'mode': m})
    item(f'B4-{m}', 'GTK3 glass block for the mode, with the menu radii from tokens/',
         {'type': 'contains', 'path': GTK3_CSS, 'text': ['/* tahoe-glass-gtk3: managed by glass-bar.sh */\n/* mode: ' + m + ' */',
                                                        f'border-radius: {r}px; padding: {gap}px;',
                                                        f'menuitem {{ border-radius: {row}px;']},
         run('glass-bar.sh', 'apps', 'on', backup=GTK4_CSS + [GTK3_CSS]), {'glass': True, 'apps': 'on', 'mode': m})
item('B3-milky', 'No GTK4 glass block in milky mode',
     {'type': 'absent-text', 'glob': f'{GTK4}/gtk-[DL]*.css', 'text': 'tahoe-glass-gtk4'},
     run('glass-bar.sh', 'apps', 'on', backup=GTK4_CSS + [GTK3_CSS]), {'glass': True, 'apps': 'on', 'mode': 'milky'})
item('B6-content', 'libadwaita stylesheets are whole (MacTahoe gtk-4.0 files)',
     {'type': 'contains', 'path': f'{GTK4}/gtk-Dark.css', 'text': ['headerbar', 'popover']},
     {'type': 'mactahoe-install', 'logout': True})
item('B5', 'No old GTK4 popover translucency block',
     {'type': 'absent-text', 'glob': f'{GTK4}/gtk-Dark.css', 'text': 'tahoe-gtk4-overrides:'},
     {'type': 'strip-block', 'begin': '/* tahoe-gtk4-overrides:', 'end': '/* end tahoe-gtk4-overrides */'})

# ---- C. desktop settings ------------------------------------------------------------------------
I = 'org.gnome.desktop.interface'
gs('C1', 'Tahoe-Material icon theme', I, 'icon-theme', "'Tahoe-Material'",
   {'path': '~/.local/share/icons/Tahoe-Material/index.theme'})
gs('C2', 'MacTahoe cursor', I, 'cursor-theme', "'MacTahoe-dark'")
gs('C3', 'Window buttons on the left', 'org.gnome.desktop.wm.preferences', 'button-layout', "'close,minimize,maximize:'")
gs('C4', 'Window corners grabbable past the 24 px clip', 'org.gnome.mutter', 'draggable-border-width', '28')
SF = {'font': 'SF Pro Text'}
gs('C5-ui', 'SF Pro Text as the interface font', I, 'font-name', "'SF Pro Text 10'", SF)
gs('C5-doc', 'SF Pro Text as the document font', I, 'document-font-name', "'SF Pro Text 11'", SF)
gs('C5-title', 'SF Pro Text Bold window titles', 'org.gnome.desktop.wm.preferences', 'titlebar-font', "'SF Pro Text Bold 10'", SF)
gs('C6-aa', 'Greyscale antialiasing as macOS', I, 'font-antialiasing', "'grayscale'", SF)
gs('C6-hint', 'Slight hinting', I, 'font-hinting', "'slight'", SF)
item('C7', 'Extension version validation off only on a tested GNOME', {'type': 'version-validation'})
gs('C8', 'User extensions not switched off', 'org.gnome.shell', 'disable-user-extensions', 'false')
item('C9', 'The design\'s extensions enabled (and the switched-off ones off)', {'type': 'extensions'})
item('C9-state', 'Enabled extensions running (not ERROR or OUT OF DATE)', {'type': 'extension-state'})
gs('C11', 'Clock with the weekday (menu bar)', I, 'clock-show-weekday', 'true', {'menubar': 'on'})

# ---- D. Blur My Shell -------------------------------------------------------------------------
item('D1', 'Blur My Shell is the patched glass build', {'type': 'bms-patched'},
     {'type': 'bms-rebuild', 'logout': True}, GLASS_ON, guard='tested')
item('D1-stamp', 'Blur My Shell built from the repo\'s current patch', {'type': 'bms-stamp'},
     {'type': 'bms-rebuild', 'logout': True}, GLASS_ON, guard='tested')
item('D1-pending', 'No pending upstream update that would drop a patch', {'type': 'pending-updates',
     'patched': [BMS, RWC, KIWI]}, {'type': 'quarantine-updates'})

S = 'org.gnome.shell.extensions.blur-my-shell'


def bs(id, feature, section, key, value, when=None, fix=None, **extra):
    gs(id, feature, S + ('.' + section if section else ''), key, value, when, ext=BMS, fix=fix, **extra)


def has_pipeline(id, feature, name, when, fix):
    item(id, feature, {'type': 'gsetting-contains', 'schema': S, 'key': 'pipelines', 'ext': BMS, 'text': name},
         fix, when)


APPS_ON = {'glass': True, 'apps': 'on'}
APPS_OFF = {'glass': True, 'apps': {'not': 'on'}}
NO_GLASS = {'glass': False}
bs('D2-app-blur', 'Window blur on', 'applications', 'blur', 'true')
bs('D2-app-all', 'Window blur on the whitelist only', 'applications', 'enable-all', 'false')
bs('D2-app-custom', 'Window blur customised', 'applications', 'customize', 'true')
item('D4', 'Window blur whitelist: every installed GTK app', {'type': 'gsetting', 'schema': S + '.applications',
     'key': 'whitelist', 'ext': BMS, 'value_from': 'app-ids'}, {'type': 'set'})
bs('D2-app-live', 'Glass apps: live blur', 'applications', 'static-blur', 'false', APPS_ON)
bs('D2-app-rc', 'Glass apps: rounded per window', 'applications', 'rounded-corners', '0', APPS_ON)
bs('D2-app-max', 'Glass apps: square when maximised', 'applications', 'corner-when-maximized', 'false', APPS_ON)
bs('D2-app-pipe', 'Glass apps pipeline', 'applications', 'pipeline', "'pipeline_glassbar_apps'", APPS_ON,
   run('glass-bar.sh', 'apps', 'on', backup=GTK4_CSS + [GTK3_CSS]))
has_pipeline('D2-app-pipes', 'Glass apps pipeline defined', 'pipeline_glassbar_apps', APPS_ON,
             run('glass-bar.sh', 'apps', 'on', backup=GTK4_CSS + [GTK3_CSS]))
bs('D2-app-op', 'Glass apps opaque (translucent backgrounds come from GTK)', 'applications', 'opacity', '255',
   {'glass': True, 'apps': 'on', 'mode': ['light', 'dark']})
bs('D2-app-op-milky', 'Milky apps at 215', 'applications', 'opacity', '215', {'glass': True, 'apps': 'on', 'mode': 'milky'})
for when in (APPS_OFF, NO_GLASS):
    tag = 'plain' if when is APPS_OFF else 'noglass'
    bs(f'D2-app-static-{tag}', 'Static window blur', 'applications', 'static-blur', 'true', when)
    bs(f'D2-app-r-{tag}', 'Window blur radius 16', 'applications', 'corner-radius', '16', when)
    bs(f'D2-app-op-{tag}', 'Windows at 215', 'applications', 'opacity', '215', when)
bs('D2-app-pipe-plain', 'Default window pipeline', 'applications', 'pipeline', "'pipeline_default'", APPS_OFF)
bs('D2-app-pipe-noglass', 'Default rounded window pipeline', 'applications', 'pipeline', "'pipeline_default_rounded'", NO_GLASS)
bs('D2-hacks', 'No hacks', '', 'hacks-level', '0', NO_GLASS)
bs('D2-app-sigma', 'Window sigma 30', 'applications', 'sigma', '30', NO_GLASS)
bs('D2-app-bright', 'Window brightness 0.6', 'applications', 'brightness', '0.6', NO_GLASS)

# top bar
for key, value in [('blur', 'true'), ('static-blur', 'true'), ('override-background', 'true'), ('style-panel', '0'),
                   ('corner-radius', '50'), ('rounded-corners', '0'), ('unblur-in-overview', 'true')]:
    bs(f'D2-bar-{key}', f'Glass bar: {key}', 'panel', key, value, GLASS_ON)
for bar, sub in [('glass', 'on'), ('plain', 'off')]:
    when = {'glass': True, 'bar': bar if bar == 'plain' else {'not': 'plain'}}
    bs(f'D2-bar-pipe-{bar}', f'Top bar pipeline ({bar})', 'panel', 'pipeline', f"'pipeline_glassbar_{bar}'", when,
       run('glass-bar.sh', 'glass', sub))
    has_pipeline(f'D2-bar-pipes-{bar}', f'Top bar pipeline defined ({bar})', f'pipeline_glassbar_{bar}', when,
                 run('glass-bar.sh', 'glass', sub))
for key, value in [('blur', 'false'), ('override-background', 'true'), ('unblur-in-overview', 'true')]:
    bs(f'D2-bar0-{key}', f'Plain top bar: {key}', 'panel', key, value, NO_GLASS)
bs('D2-ov-blur', 'Overview blurred', 'overview', 'blur', 'true')
bs('D2-ov-style', 'Overview components unstyled', 'overview', 'style-components', '0')
bs('D2-af-blur', 'App folders blurred', 'appfolder', 'blur', 'true')
bs('D2-af-style', 'App folder dialogs styled', 'appfolder', 'style-dialogs', '1')
bs('D2-af-sigma', 'App folder sigma 30', 'appfolder', 'sigma', '30', NO_GLASS)

# dock
DOCK_ON = {'glass': True, 'dock': 'on'}
DOCK_OFF = {'dock': {'not': 'on'}}
for key, value in [('blur', 'true'), ('static-blur', 'false'), ('override-background', 'true'),
                   ('style-dash-to-dock', '0'), ('unblur-in-overview', 'true')]:
    bs(f'D2-dock-{key}', f'Glass dock: {key}', 'dash-to-dock', key, value, DOCK_ON)
bs('D2-dock-pipe', 'Glass dock pipeline', 'dash-to-dock', 'pipeline', "'pipeline_glassbar_dock'", DOCK_ON,
   run('glass-bar.sh', 'dock', 'on'))
has_pipeline('D2-dock-pipes', 'Glass dock pipeline defined', 'pipeline_glassbar_dock', DOCK_ON, run('glass-bar.sh', 'dock', 'on'))
for key, value in [('blur', 'true'), ('static-blur', 'true'), ('override-background', 'false'), ('unblur-in-overview', 'true')]:
    bs(f'D2-dock0-{key}', f'Plain dock: {key}', 'dash-to-dock', key, value, DOCK_OFF)
bs('D2-dock0-pipe', 'Plain dock pipeline', 'dash-to-dock', 'pipeline', "'pipeline_default'", {'glass': True, 'dock': {'not': 'on'}})
bs('D2-dock0-pipe-ng', 'Plain dock pipeline', 'dash-to-dock', 'pipeline', "'pipeline_default_rounded'", NO_GLASS)

# menus
MENUS_ON = {'glass': True, 'menus': 'on'}
MENUS_RUN = run('glass-bar.sh', 'menus', 'on')
for key, value in [('blur', 'true'), ('static-blur', 'false'), ('override-background', 'true'),
                   ('preserve-shell-theme', 'false')]:
    bs(f'D2-menu-{key}', f'Glass menus: {key}', 'popup', key, value, MENUS_ON)
bs('D2-menu-freeze', 'Quick settings glass held still while it moves (motion-freeze)', 'popup', 'motion-freeze', 'true', MENUS_ON)
bs('D2-menu-style-light', 'Light menu style', 'popup', 'style-popup', '1', {'glass': True, 'menus': 'on', 'mode': 'light'})
bs('D2-menu-style', 'Automatic menu style', 'popup', 'style-popup', '3', {'glass': True, 'menus': 'on', 'mode': ['dark', 'milky']})
bs('D2-menu-pipe', 'Glass menus pipeline', 'popup', 'pipeline', "'pipeline_glassbar_menus'", MENUS_ON, MENUS_RUN)
has_pipeline('D2-menu-pipes', 'Glass menus pipeline defined', 'pipeline_glassbar_menus', MENUS_ON, MENUS_RUN)
has_pipeline('D2-search-pipes', 'Search glass pipeline defined', 'pipeline_glassbar_search', MENUS_ON, MENUS_RUN)
bs('D2-af-pipe', 'App folder popup in the menus glass', 'appfolder', 'pipeline', "'pipeline_glassbar_menus'", MENUS_ON)
for target, source in RADIUS['blur_my_shell'].items():
    section, key = target.split('/')
    bs(f'D3-{section}-{key}', f'Glass radius {target} = {source} (tokens/radius.json)', section, key, str(radius(source)),
       MENUS_ON, run('glass-bar.sh', 'radii'))
bs('D2-menu-off', 'Menus not blurred', 'popup', 'blur', 'false', {'menus': {'not': 'on'}})

# ---- D6-D12. other extensions -------------------------------------------------------------------
DD = 'org.gnome.shell.extensions.dash-to-dock'
for key, value in [('apply-custom-theme', 'false'), ('transparency-mode', "'DEFAULT'"),
                   ('custom-background-color', 'false'), ('dock-position', "'BOTTOM'")]:
    gs(f'D6-{key}', f'Dock: {key}', DD, key, value, ext=DOCK)
for key, value in [('dock-fixed', 'false'), ('intellihide', 'true'), ('intellihide-mode', "'FOCUS_APPLICATION_WINDOWS'"),
                   ('autohide', 'true'), ('dash-max-icon-size', '48'), ('icon-size-fixed', 'true'),
                   ('show-trash', 'true'), ('show-mounts', 'false'), ('running-indicator-style', "'DOTS'"),
                   ('click-action', "'minimize-or-previews'"), ('scroll-action', "'cycle-windows'")]:
    gs(f'D6-{key}', f'Dock: {key} (gnome-setup.sh; reported only)', DD, key, value, ext=DOCK, enforce=False)
item('D6-css', 'Dash to Dock stylesheet present (MacTahoe tweaks -d renames it)',
     {'type': 'exists', 'path': f'{EXT}/{DOCK}/stylesheet.css', 'if_dir': f'{EXT}/{DOCK}'},
     {'type': 'rename', 'from': f'{EXT}/{DOCK}/stylesheet.css.bak', 'logout': True})

OB = 'org.gnome.shell.extensions.openbar'
for key, value in [('bartype', "'Floating'"), ('menustyle', 'false'), ('apply-menu-shell', 'false'),
                   ('apply-menu-notif', 'false'), ('apply-all-shell', 'false'), ('apply-accent-shell', 'false'),
                   ('apply-gtk', 'false'), ('apply-flatpak', 'false'), ('gtk-popover', 'false'),
                   ('set-yarutheme', 'false'), ('set-notifications', 'false'), ('set-notif-position', 'false'),
                   ('set-overview', 'false'), ('wmaxbar', 'false')]:
    gs(f'D7-{key}', f'Open Bar draws only the pill: {key}', OB, key, value, GLASS_ON, ext=OPENBAR)
gs('D7-font', 'Open Bar font = the interface font', OB, 'font', None, GLASS_ON, ext=OPENBAR,
   fix={'type': 'set', 'openbar_reload': True})
items[-1]['check']['value_from'] = 'interface-font'
for m in MODES:
    gs(f'D7-edge-{m}', f'Top bar edge at {GLASS[m]["edge_alpha"]} (tokens/glass.json)', OB, 'balpha',
       str(GLASS[m]['edge_alpha']), {'glass': True, 'mode': m}, ext=OPENBAR)
    fg = "['0.11', '0.11', '0.12']" if m == 'light' else "['1.0', '1.0', '1.0']"
    gs(f'D7-fg-{m}', 'Top bar text colour for the mode', OB, 'fgcolor', fg, {'glass': True, 'mode': m}, ext=OPENBAR)

item('D9-port', 'Rounded Window Corners: the GNOME 51 port of its shader files',
     {'type': 'absent-text', 'glob': f'{EXT}/{RWC}/effect/rounded_corners_effect.js', 'text': 'gi://Shell'},
     {'type': 'copy', 'from': '{ROOT}/config/rwc-gnome51', 'to': f'{EXT}/{RWC}/effect', 'logout': True}, guard='tested')
item('D9-meta', 'Rounded Window Corners metadata lists the tested GNOME', {'type': 'metadata-shell', 'uuid': RWC},
     {'type': 'metadata-shell'}, guard='tested')
RW = 'org.gnome.shell.extensions.rounded-window-corners-reborn'
gs('D9-skip', 'Rounded corners skip libadwaita apps', RW, 'skip-libadwaita-app', 'true', ext=RWC)
gs('D9-border', 'Rounded corners: no border', RW, 'border-width', '0', ext=RWC)
gs('D9-black', 'Rounded corners: games left alone', RW, 'blacklist', "['steam', 'VRChat.exe', 'vrmonitor']", ext=RWC)
WIN = radius('window.radius')
gs('D9-global', f'Rounded corners at {WIN} px (tokens/radius.json window.radius)', RW,
   'global-rounded-corner-settings',
   "{'padding': <{'left': uint32 0, 'right': uint32 0, 'top': uint32 0, 'bottom': uint32 0}>, "
   "'keepRoundedCorners': <{'maximized': false, 'fullscreen': false}>, 'borderRadius': <uint32 " + str(WIN) + ">, "
   "'smoothing': <0.0>, 'borderColor': <(0.5, 0.5, 0.5, 1.0)>, 'enabled': <true>}", ext=RWC)

NP = 'org.gnome.shell.extensions.nowplaying'
for key, value in [('location', "'panel'"), ('panel-box', "'right'"), ('panel-text', "'none'"), ('panel-icon', 'true'),
                   ('card-layout', "'full'"), ('cover-size', "'large'"), ('show-progress', 'true'),
                   ('show-volume', 'false'), ('show-loop-shuffle', 'false'), ('equalizer-accent', 'false')]:
    gs(f'D10-{key}', f'Now Playing: {key}', NP, key, value, ext=NOWPLAYING)
VT = 'org.gnome.shell.extensions.vitals'
gs('D11-sensors', 'Vitals: the four readings', VT, 'hot-sensors',
   "['__temperature_max__', '_processor_usage_', '_gpu#1_utilization_', '_memory_usage_']", ext=VITALS)
gs('D11-gpu', 'Vitals: GPU', VT, 'show-gpu', 'true', ext=VITALS)
gs('D11-ip', 'Vitals: no public IP lookup', VT, 'include-public-ip', 'false', ext=VITALS)
item('D12', 'Kiwi Menu patched for GNOME 51 (St.BoxLayout vertical)',
     {'type': 'absent-text', 'glob': f'{EXT}/{KIWI}/src/userSwitcher.js', 'text': 'vertical: true,'},
     {'type': 'replace', 'old': 'vertical: true,', 'new': 'orientation: Clutter.Orientation.VERTICAL,', 'logout': True},
     {'menubar': 'on'}, guard='tested')
KW = 'org.gnome.shell.extensions.kiwimenu'
gs('D12-icon', 'Kiwi Menu: the Apple logo', KW, 'icon', '10', {'menubar': 'on'}, ext=KIWI)
gs('D12-act', 'Kiwi Menu: no Activities', KW, 'activity-menu-visibility', 'false', {'menubar': 'on'}, ext=KIWI)

# ---- E. icons and fonts ----------------------------------------------------------------------------
# the icons live in cachyos-tahoe-theme: the author's checkout, or the copy install.sh fetches
ICON_HOMES = ['~/Projects/cachyos-tahoe-theme/icons', '~/.local/src/cachyos-tahoe-theme/icons']
item('E1', 'Tahoe-Material icon theme link', {'type': 'symlink', 'path': '~/.local/share/icons/Tahoe-Material',
     'target': [f'{h}/Tahoe-Material' for h in ICON_HOMES], 'need': 'index.theme'}, {'type': 'symlink'})
item('E2', 'Tahoe-Material-KDE icon theme link', {'type': 'symlink', 'path': '~/.local/share/icons/Tahoe-Material-KDE',
     'target': [f'{h}/Tahoe-Material-KDE' for h in ICON_HOMES], 'need': 'index.theme'}, {'type': 'symlink'})
# optional fonts: reported, never a notification (SF Pro is the user's own download)
item('E4', 'SF Pro installed (optional: your own Apple download, bash scripts/sf-fonts.sh)', {'type': 'font', 'family': 'SF Pro Text'})
item('E5', 'Space Grotesk installed (optional: the lock screen clock)', {'type': 'font', 'family': 'Space Grotesk'},
     when={'lockscreen': 'on'})

# ---- F. tahoe extensions -----------------------------------------------------------------------------
for key, uuid, script in [('widgets', 'tahoe-widgets@cachyos-tahoe', 'tahoe-widgets.sh'),
                          ('motion', 'tahoe-motion@cachyos-tahoe', 'tahoe-motion.sh'),
                          ('lockscreen', 'tahoe-lockscreen@cachyos-tahoe', 'tahoe-lockscreen.sh'),
                          ('controlcenter', 'tahoe-control-center@cachyos-tahoe', 'tahoe-control-center.sh'),
                          ('menubar', 'tahoe-menu-bar@cachyos-tahoe', 'tahoe-menu-bar.sh')]:
    item(f'F-{key}', f'{uuid} installed (switched on)', {'type': 'tahoe-installed', 'uuid': uuid},
         run(script, 'on', logout=True), {key: 'on'}, guard='tested')

# ---- H. the repair's own entry points -----------------------------------------------------------
item('H1', 'Login autostart runs this checkout\'s repair', {'type': 'contains', 'path': '~/.config/autostart/tahoe-repair.desktop',
     'text': ['Exec={ROOT}/scripts/tahoe-repair.sh']}, {'type': 'template', 'from': '{ROOT}/config/tahoe-repair.desktop.in'})
item('H2', 'tahoe-repair command links to this checkout', {'type': 'symlink', 'path': '~/.local/bin/tahoe-repair',
     'target': '{ROOT}/scripts/tahoe-repair.sh'}, {'type': 'symlink'})
item('H6', 'Packages changed since the last run (pacman hook stamp)', {'type': 'packages-changed'})
item('H7', 'The running shell is the installed one', {'type': 'shell-restart'})
item('H8', 'The committed manifest matches the tokens', {'type': 'manifest-fresh'})

MANIFEST = {
    'about': 'Generated by scripts/repair_manifest.py from tokens/; do not edit by hand (docs/REPAIR.md).',
    'version': 1,
    'tested_shell': TESTED_SHELL,
    'core_extensions': ['user-theme@gnome-shell-extensions.gcampax.github.com', DOCK, BMS,
                        'appindicatorsupport@rgcjonas.gmail.com', RWC, NOWPLAYING, VITALS],
    'glass_extensions': [OPENBAR],
    'switched_extensions': {'widgets': ['tahoe-widgets@cachyos-tahoe'], 'motion': ['tahoe-motion@cachyos-tahoe'],
                            'lockscreen': ['tahoe-lockscreen@cachyos-tahoe'],
                            'controlcenter': ['tahoe-control-center@cachyos-tahoe'],
                            'menubar': ['tahoe-menu-bar@cachyos-tahoe', KIWI]},
    'patched_extensions': [BMS, RWC, KIWI],
    'validation_needed_by': [OPENBAR, RWC],
    'items': items,
}


def render():
    return json.dumps(MANIFEST, indent=1) + '\n'


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        path = os.path.join(ROOT, 'config', 'repair-manifest.json')
        same = os.path.exists(path) and open(path).read() == render()
        print('manifest current' if same else 'manifest stale: python3 scripts/repair_manifest.py > config/repair-manifest.json')
        sys.exit(0 if same else 1)
    sys.stdout.write(render())
