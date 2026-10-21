# Keeping the design through updates: inventory and impact analysis

Written 2026-10-20 for a new `tahoe-repair`. Phase 0 is the inventory of everything the design
depends on; Phase 1 measures today's `scripts/tahoe-repair.sh` against it. The design of the new
repair (Phase 2) follows after the user's review of these two.

Machine at the time: GNOME Shell 51.1, mutter 51.0, gtk3 3.24.52, gtk4 4.24.1, libadwaita 1.10.0,
gdm 51.1, glib2 2.90.1, gjs 1.90.1 (CachyOS). Live state file:
`enabled=1 bar=glass menus=on dock=on tint=light apps=on gtk=off mode=dark widgets=on
controlcenter=off motion=on lockscreen=on` (no `menubar` key).

## Phase 0: inventory

Owner: **user** = a file in the home folder; **repo** = generated from or linked into this checkout;
**pkg** = installed by pacman (pacman overwrites it); **root** = changed by hand with sudo, not
owned by any package. "Breaks when" uses these triggers:

- **P**: pacman update of gnome-shell, mutter, gtk3/4, libadwaita or gdm
- **G-min / G-maj**: GNOME minor (51.x) or major (52) bump
- **EGO**: an extension updated by GNOME's own updater from extensions.gnome.org at login
- **MT**: a MacTahoe theme reinstall (`install.sh`, `tweaks.sh`)
- **U**: the user changing it (GNOME Settings, Tweaks, quick settings)
- **R**: a repo change that was never installed (the installed copy lags `main`)

### A. Shell theme and CSS

| # | Item | Lives at | Owner | Set by | Breaks when | Notes |
|---|---|---|---|---|---|---|
| A1 | MacTahoe shell themes (Dark, Light, and the -solid GTK3 variants) | `~/.themes/MacTahoe-{Dark,Light}[-solid]/` | user (built from `~/.local/src/MacTahoe-gtk-theme`, unpinned clone) | `install.sh -b -l` (gnome-setup.sh 1, repair 1) | MT (deletes and recreates the folders, dropping A3 and A5) | A shell running while the folder is recreated falls back to Adwaita until the theme name is set again |
| A2 | User Themes extension and its key `user-theme name` = `MacTahoe-Dark` (light mode: `MacTahoe-Light`) | `/usr/share/gnome-shell/extensions/user-theme@…` (pkg gnome-shell-extensions), dconf | pkg + user | gnome-setup.sh 3, glass-bar.sh `shell_theme`, repair 5 | P (gnome-shell-extensions removed or not yet rebuilt for G-maj), U | User Themes is off while the screen is locked, so A3 never reaches the lock screen |
| A3 | Shell CSS overrides, rendered from `config/gnome-shell-overrides.css` with tokens, between `/* tahoe-overrides:` … `/* end tahoe-overrides */` | appended to both `~/.themes/MacTahoe-{Dark,Light}/gnome-shell/gnome-shell.css` | repo → user | `glass-bar.sh overrides`, repair 5b | MT, R, G-maj (class names in the shell change) | Rendered from whatever is checked out in the live checkout, so a branch's CSS applied by hand is replaced at the next login |
| A4 | Token rendering (`scripts/glass-tokens.py`: `render`, `get`, `bms`) | `tokens/{radius,glass,palette}.json` | repo | used by A3, C3, C4, D5 | R (token edited, nothing re-rendered) | `bms` prints 8 radius keys (D5) |
| A5 | GTK3 window corners: `24px 24px 0 0` → `24px` | `~/.themes/MacTahoe-*/gtk-3.0/gtk{,-dark}.css` | user | repair 5d, gnome-setup.sh | MT | All 8 files are fixed today |
| A6 | System shell theme gresource (the desktop's and lock screen's base theme as well as GDM's) | `/usr/share/gnome-shell/gnome-shell-theme.gresource` (now the Tahoe GDM build, 14 entries incl. `tahoe-gdm-background.png`); backups `.pre-gdm-tahoe` (MacTahoe GDM build), `.bak` (stock 51.1) | **pkg gnome-shell**, replaced by root | `scripts/gdm-theme.sh install` (sudo) | **P: every gnome-shell update overwrites it**, silently (GDM_PLAN.md:53-56); `pacman -Qkk gnome-shell` reports it modified | After a G-maj the `.pre-gdm-tahoe` base is the old shell's theme: rebuilding from it stacks old CSS on a new shell |

### B. GTK apps

| # | Item | Lives at | Owner | Set by | Breaks when | Notes |
|---|---|---|---|---|---|---|
| B1 | GTK3 theme `gtk-theme` = `MacTahoe-Dark-solid` (light: `-Light-solid`), `color-scheme` = `prefer-dark` (light: `default`) | dconf `org.gnome.desktop.interface` | user | glass-bar.sh `gtk_theme`, repair 5/9 | U (Settings' Style, quick settings Dark Style) | The mode in the state file decides both |
| B2 | libadwaita stylesheet: `gtk.css` → `gtk-Dark.css` (light: `gtk-Light.css`) | `~/.config/gtk-4.0/gtk.css` (symlink), `gtk-dark.css` | user (written by MacTahoe `-l`) | glass-bar.sh `gtk_theme`, repair 5 | MT (rewrites all of `~/.config/gtk-4.0`), U | Repair 1 rebuilds the whole theme if `gtk.css` is not a symlink |
| B3 | GTK4 glass block `/* tahoe-glass-gtk4` … marker `mode: dark; menus: glass;` (window tint, clear popovers, 17 px menus, 13 px rows) | inside `~/.config/gtk-4.0/gtk-{Dark,Light}.css` | repo → user | `glass-bar.sh apps on` (`gtk_glass`), repair 6 | MT, R (block from older tokens), mode change | Milky mode must have no block |
| B4 | GTK3 glass block `/* tahoe-glass-gtk3: managed by glass-bar.sh */` (window tint, clear header bar, 17/13 px popup menus) | `~/.config/gtk-3.0/gtk.css` | repo → user | `glass-bar.sh apps on` (`gtk3_glass`), repair 6 | U (any app or tool that writes `gtk.css`), R | `@import 'colors.css'` above it is MacTahoe's |
| B5 | Old GTK4 popover translucency block `tahoe-gtk4-overrides:` must stay absent | `~/.config/gtk-4.0/gtk-Dark.css` | user | repair 5b2 removes it | an old script run | Historic |
| B6 | Libadwaita window corners: Rounded Window Corners keeps 24 px on non-libadwaita windows | see D9 | | | | |

### C. Desktop settings (dconf)

| # | Item | Value | Set by | Breaks when |
|---|---|---|---|---|
| C1 | `interface icon-theme` | `Tahoe-Material` | gnome-setup.sh, repair 7 | U, a missing E1 link (GTK falls back silently) |
| C2 | `interface cursor-theme` | `MacTahoe-dark` | repair 9 | U |
| C3 | `wm.preferences button-layout` | `close,minimize,maximize:` | repair 9 | U |
| C4 | `mutter draggable-border-width` | 28 (corners grabbable past the 24 px clip) | repair 9 | U, G-maj (key removed or renamed) |
| C5 | Fonts: `font-name` `SF Pro Text 10`, `document-font-name` `SF Pro Text 11`, `titlebar-font` `SF Pro Text Bold 10` | | sf-fonts.sh, repair 9 (only when SF Pro is installed) | U |
| C6 | `font-antialiasing` `grayscale`, `font-hinting` `slight` | | sf-fonts.sh only | U (not checked today) |
| C7 | `shell disable-extension-version-validation` | true (Open Bar stops at 49, RWC port, tahoe-* say 51) | glass-bar.sh, repair 5e (every run) | G-maj: with it on, nothing stops 51-only code loading on 52 |
| C8 | `shell disable-user-extensions` | false | repair 4 | U (Extensions app master switch) |
| C9 | `shell enabled-extensions` | the set in D, plus the tahoe-* per state key | repair 4, the on/off scripts | U, EGO, scripts reordering it |
| C10 | `shell favorite-apps` (dock) | gnome-setup.sh list | gnome-setup.sh only | U (deliberately not enforced) |
| C11 | `interface clock-show-weekday` | true when `menubar=on` | tahoe-menu-bar.sh | U (not checked) |
| C12 | Wallpaper (`background picture-uri[-dark]`) | user's choice | gnome-setup.sh once | never enforced, by design |

### D. Extensions from extensions.gnome.org and their settings

All in `~/.local/share/gnome-shell/extensions/<uuid>` (user), settings in dconf
`/org/gnome/shell/extensions/<name>/` read through each extension's own `schemas/`.

| # | Extension (installed) | What the design needs | Breaks when | Notes |
|---|---|---|---|---|
| D1 | **Blur My Shell** `blur-my-shell@aunetx`, built from upstream commit `470ae2d` (v76) + `config/bms-tahoe-glass.patch` (29 files, +1613), labelled with EGO's version (76) | The patch markers (`is_app_menu` in `components/applications/window_rules.js`), the `tahoe-glass.css` stylesheet, `globalThis.__tahoeGlass` v1 API and `motion-freeze` key used by tahoe-motion, glass targets `tahoe-search-tile`, `search-section-content`, `app-folder`, `dash-label` | **EGO**: EGO now publishes v76; when it publishes v77, GNOME's updater swaps the patched build for stock at the next login. **G-maj**: the pinned commit may not run on 52, and the patch may not apply to a newer upstream. **R**: patch changed in the repo, not rebuilt | Build: `glass-bar.sh rebuild` (needs git, make, msgfmt; network for the clone/fetch). Loads only after a logout. Source checkout `~/.local/src/blur-my-shell` is left patched (dirty). Upstream master is 5+ commits past the pin. The patch applies cleanly to `470ae2d` today |
| D2 | BMS settings: panel, overview, appfolder, dash-to-dock, applications, popup sections; the `pipelines` dict with `pipeline_glassbar_{glass,plain,menus,search,dock,apps}` | key for key in repair 6 and glass-bar.sh `glass_params()`; `popup motion-freeze` true (quick settings only freezes, f641491); `popup style-popup` 3 (light 1) | EGO (stock build lacks the patch keys), U (BMS prefs), a stock reinstall resets the pipelines | `dconf` change notifications with 256+ keys abort the shell: write in batches (glass-bar.sh `dconf_apply`) |
| D3 | BMS radius keys from `tokens/radius.json` | popup `menu-corner-radius` 18, `submenu-corner-radius` 32, `calendar-corner-radius` 32, `notification-corner-radius` 20, `osd-corner-radius` 28, `osd-window-corner-radius` 9999; applications `menu-corner-radius` 17, `corner-radius` 24 | R, EGO | `glass-bar.sh radii` |
| D4 | BMS app whitelist | every installed GTK3/GTK4 app (`scripts/glass-app-ids.py`) | a new app installed (picked up at next login) | |
| D5 | BMS glass stylesheet edge alpha per mode (`shell_edges`) | the 1 px edges at `edge_alpha` | a rebuild resets them; mode change | Rebuild calls `shell_edges` |
| D6 | **Dash to Dock** v110 | `apply-custom-theme` false, `transparency-mode` DEFAULT, `custom-background-color` false, `dock-position` BOTTOM; `stylesheet.css` present (MacTahoe `tweaks.sh -d` renames it, which stops v110 loading); gnome-setup.sh's intellihide, 48 px icons, dots etc. | EGO, MT (`-d`), U | Only the first four keys are enforced |
| D7 | **Open Bar** v49 (`shell-version` stops at 49) | Floating pill (`bartype` Floating, `bradius` 50, `wmaxbar` false); every `apply-*`, `gtk-popover`, `set-*`, `menustyle` off; `font` = interface font; `balpha` = edge alpha; `fgcolor` per mode; preset from kayozxo/GNOME-macOS-Tahoe @6eb17c2 | G-maj (loads only because validation is off), EGO (a new build could change keys), U | Only in glass mode |
| D8 | **AppIndicator** v66 | enabled | EGO, G-maj | no settings |
| D9 | **Rounded Window Corners Reborn** v25 + `config/rwc-gnome51/*.js` port (Shell.GLSLEffect removed in 51), `metadata.json` shell-version forced to `["51"]` | `skip-libadwaita-app` true, `border-width` 0, blacklist steam/VRChat, 24 px, square when maximised | EGO (refetch drops the port), G-maj (port is 51-specific) | Port loads after a logout |
| D10 | **Now Playing** v14 | panel, right, icon only, full card, large cover, progress; no volume, loop, accent | EGO, U | the card's look is in A3 |
| D11 | **Vitals** v86 | hot-sensors (max temp, CPU, GPU#1, memory), `show-gpu` true, `include-public-ip` false (privacy) | EGO, U | |
| D12 | **Kiwi Menu** `kiwimenu@kemma` v34 (only with `menubar=on`; not installed now) | Apple logo `icon` 10, no Activities; `userSwitcher.js` patched `vertical:` → `orientation:` for 51 | **EGO undoes the patch**, G-maj | |

### E. Icons, fonts, desktop files

| # | Item | Lives at | Owner | Breaks when | Notes |
|---|---|---|---|---|---|
| E1 | Tahoe-Material icon theme | `~/.local/share/icons/Tahoe-Material` → `~/Projects/cachyos-tahoe-theme/icons/Tahoe-Material` | other repo | that repo moved, cleaned or checked out without the generated icons | Its generator and stamp (`.generated-from`) live in cachyos-tahoe-theme; this repo cannot regenerate it |
| E2 | Tahoe-Material-KDE + `kdeglobals [Icons] Theme` | `~/.local/share/icons/Tahoe-Material-KDE` → same repo | other repo | as E1 | |
| E3 | MacTahoe cursors | `~/.local/share/icons/MacTahoe-dark-cursors` (MacTahoe icon theme) | user | MacTahoe icon reinstall | |
| E4 | SF Pro (and SF Mono) | `~/.local/share/fonts/SF-Pro` | user (Apple's licence, never fetched) | font cache cleared; folder removed | Shell sees new fonts only after a logout |
| E5 | Space Grotesk (lock screen clock, GDM clock) | `~/.local/share/fonts/SpaceGrotesk` (user), `/usr/local/share/fonts/SpaceGrotesk` (root, for the gdm user) | user + root | | Not package-owned, survives updates |
| E6 | Desktop-entry overrides | `overrides/*.desktop` → `~/.local/share/applications` | repo | | `overrides/` is not in this repo (cachyos-tahoe-theme only), so repair 6b does nothing here |

### F. Tahoe extensions (this repo)

Installed by copying `extensions/<uuid>` to `~/.local/share/gnome-shell/extensions/<uuid>` with the
on/off script, which also sets the state key and edits `enabled-extensions`. A new install or a code
change loads only after a logout. All say `shell-version ["51"]`.

| # | Extension | State key (now) | GNOME internals it leans on | Breaks when | Notes |
|---|---|---|---|---|---|
| F1 | tahoe-widgets (clocks, calendar, weather, music, swirl, lyrics) | `widgets` (on) | `ui/main.js`, `ui/calendar.js` (EDS), `misc/weather.js` WeatherClient, MPRIS; BMS pipelines | G-maj, BMS stock (no glass), **R: the installed copy lags main today** (`mpris.js`, `music.js` differ) | Layout `~/.config/tahoe-glass/widgets.json`; covers `~/.cache/tahoe-widgets/art`; lrclib.net |
| F2 | tahoe-motion (circle morph, dock/app/window menus) | `motion` (on) | wraps `BoxPointer.open/close`, quick settings submenu open/close, message tray banners, `WindowManager` map, `PopupMenuManager._changeMenu`; BMS `__tahoeGlass` v1 | G-maj, BMS stock or API change | Without BMS it falls back to GNOME's animation |
| F3 | tahoe-lockscreen (glass clock, Now Playing, layout) | `lockscreen` (on) | `Main.screenShield._dialog`, `_stack`, `_clock`, `_promptBox`, `_authPrompt`, `_backgroundGroup`; checks `Config.PACKAGE_VERSION` major = 51 and does nothing otherwise | G-maj (it guards itself), BMS stock | `palette.js` etc. are copies of F1's (`tools/lockscreen/check-shared.sh` refuses a stale install); Space Grotesk (E5) |
| F4 | tahoe-control-center | `controlcenter` (off) | quick settings internals | G-maj | The user wants it off |
| F5 | tahoe-menu-bar (+ D12) | `menubar` (absent = off) | detaches the quick settings indicators box | G-maj | **Not in repair's WANT list** |
| F6 | tahoe-probe (tools/, measuring only) | none: kept only while already enabled | | | Logs to `~/.cache/tahoe-probe.jsonl`; still enabled on the real desktop |
| F7 | tahoe-gdm (login screen, gdm session mode) | none (root) | AuthPrompt `_entryArea`, `UserListItem`, LoginDialog layout | G-maj | `/usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe` (root, unpackaged, survives P) |

### G. GDM login screen (root)

| # | Item | Lives at | Breaks when | Notes |
|---|---|---|---|---|
| G1 | Tahoe GDM theme | A6 | **P** (gnome-shell update) | `gdm-theme.sh install`, sudo |
| G2 | Greeter settings: no date/weekday, 12 h, dark, no logo, `enabled-extensions ['tahoe-gdm@cachyos-tahoe']`, weather location | `/etc/dconf/profile/gdm` (adds `system-db:gdm`), `/etc/dconf/db/gdm.d/90-tahoe-gdm`, `locks/` | P of gdm (profile file is ours; a gdm package that ships one would conflict), `dconf update` not run | Without the locks the greeter account's own `disable-user-extensions` hides F7 |
| G3 | F7 installed system-wide | `/usr/share/gnome-shell/extensions/tahoe-gdm@…` | G-maj | |
| G4 | Space Grotesk system-wide | `/usr/local/share/fonts/SpaceGrotesk` | | |

### H. The repair itself

| # | Item | Lives at | Owner | Breaks when |
|---|---|---|---|---|
| H1 | Autostart entry, `Exec=~/Projects/liquid-glass/scripts/tahoe-repair.sh`, delay 8 s | `~/.config/autostart/tahoe-repair.desktop` (from `config/tahoe-repair.desktop.in`) | user | repo moved; runs as `app-tahoe\x2drepair@autostart.service` |
| H2 | Manual command `tahoe-repair` | `~/.local/bin/tahoe-repair` → **`~/Projects/cachyos-tahoe-theme/scripts/tahoe-repair.sh` (the old repo)** | user | already stale: running it by hand runs the pre-split script |
| H3 | State file (the user's switches) | `~/.config/tahoe-glass/state` | user | `glass-bar.sh undo` deletes it (glass mode off, by design) |
| H4 | Backup of the pre-glass settings and BMS v75 | `~/.local/share/glass-backup/original` → `20261018-230117-before-glass` | user | |
| H5 | Sources | `~/.local/src/{blur-my-shell,MacTahoe-gtk-theme,MacTahoe-icon-theme}` | user | removed; network needed to restore |

### Upcoming (on branches, not merged)

| Branch | What it adds to the inventory |
|---|---|
| `claude/recursing-bassi-aa41af` (9 ahead of main, 2 behind) | One glass for both screens: changes F3 and F7 (`widgets/glassmenus.js`, `paneglass.js`, `clockpanes.js`, `widgetlayout.js`; `menuglass.js` deleted). Installing needs `tahoe-lockscreen.sh on` and `gdm-theme.sh install` (sudo), so G1-G3 change. Plans a `/run/tahoe-nowplaying` runtime folder (tmpfiles.d, root) |
| `claude/ics-calendar-widget-2c71a5` (6 ahead) | F1 gains `schedule.js`, `icsfeed.js`, `ics-expand.js` (a `gjs` subprocess), `vendor/ical.js`. The feed link in the keyring (libsecret `org.cachyos.tahoe.Calendar`), else `~/.config/tahoe-glass/calendar-url` (0600) plus `calendar-source`; cache `~/.cache/tahoe-glass/calendar.{ics,json}`. Repair must never print or copy the link |

## Phase 1: impact analysis of today's tahoe-repair.sh

### What it checks and fixes

| Step | Inventory | Check | Fix |
|---|---|---|---|
| 1 | A1, B2 | `MacTahoe-Dark/gnome-shell/gnome-shell.css` exists and `gtk-4.0/gtk.css` is a symlink | clones MacTahoe (unpinned) and runs `install.sh -b -l` at login |
| 2 | D | each EXTS folder has `metadata.json` | downloads the EGO build for the running shell |
| 3 | D | `gnome-extensions info` knows it | D-Bus `InstallRemoteExtension` |
| 4 | C8, C9 | `enabled-extensions` equals WANT **as text, in order** | writes WANT; `gnome-extensions enable` on INACTIVE; logs ERROR |
| 5 | A2, B1, B2 | theme name; last theme load in the journal | toggles the theme name; sets gtk-theme; relinks gtk.css |
| 5b | A3 | always | re-renders the overrides (glass-bar.sh), reloads the theme if changed |
| 5b2 | D1, B5 | old patch markers | refetches stock BMS (5f then rebuilds) |
| 5c | D1 | `'modal-dialog'` in v75 surface lists | edits BMS in place, disables and enables it |
| 5d | A5 | `24px 24px 0 0` | sed |
| 5e | D9, C7 | `gi://Shell` in RWC | copies the port, forces `shell-version ["51"]`; **always** sets version validation off; sets RWC keys unconditionally |
| 5f | D1 | `is_app_menu` marker absent | `glass-bar.sh rebuild` |
| 6 | D2, D3, D4, B3, B4 | ~60 BMS keys by value; pipelines present; radii vs tokens; GTK blocks' mode markers | `gsettings set`, or the matching glass-bar.sh subcommand |
| 6b | E6 | `overrides/*.desktop` | copies (no-op here) |
| 7 | E1, E2, C1 | link and key | relinks to `$ROOT/icons/…` (absent here) |
| 8 | D | `shell-version` lists the running major | **`rm -rf` and refetch** from EGO |
| 9 | B1, C2-C5 | key values | `gsettings set` |
| 10, 11 | D6 | 4 keys; stylesheet renamed | set; rename back and reload |
| 12, 12b | E1 | generator present | no-op here (generator in cachyos-tahoe-theme) |
| 13, 14, 15 | D10, D11, D7 | listed keys | set; Open Bar reload |

### What it misses

| Inventory | Gap | Consequence |
|---|---|---|
| A6, G1-G4 | Nothing checks the login screen. `--gdm` still prints the old MacTahoe `tweaks.sh -g` commands, not `gdm-theme.sh` | Any gnome-shell update silently puts the stock (or MacTahoe-only) login screen back, and the user is not told |
| D1 (R) | No check that the installed BMS was built from the repo's current patch | A patch change on main stays uninstalled until someone runs `rebuild` |
| D1 (EGO) | 5f rebuilds after EGO swaps the build, but only logs it | The glass is gone until a logout the user does not know is needed |
| F1-F3 (R) | Installed tahoe-* copies are never compared with the repo | Today the widgets installed at 14:31 lack main's later Music changes |
| F1-F5 | A deleted tahoe-* folder makes the feature vanish from WANT silently | Feature lost with no message |
| F5, D12 | `menubar` is not a WANT key | If the user turns the menu bar on, step 4 removes it at every login (see below) |
| C6, C11 | antialiasing, hinting, weekday | not kept |
| D6 | the rest of the dock settings (intellihide, size, dots, clicks) | not kept |
| D7 | Open Bar shape keys (`bartype` only; not `bradius`, margins, colours) | partly kept |
| E1, E2 | the link target lives in another repo; repair "restores" to a path that does not exist here | broken icons are never reported |
| E4, E5 | fonts are only used if present | a lost SF Pro silently drops to Cantarell |
| H1, H2 | the autostart entry and `~/.local/bin/tahoe-repair` are not checked; H2 points at the old repo now | `tahoe-repair` typed by hand runs the pre-split script |
| — | no read-only mode, no exit codes, no backups before rewriting CSS, no notifications | the only record is the user journal |

### What it could break

1. **Overwrites any extension the user turns on.** Step 4 compares `enabled-extensions` with a fixed
   list and writes the fixed list. An extension the user enabled themself (or Kiwi Menu and
   tahoe-menu-bar after `tahoe-menu-bar.sh on`) is switched off at every login.
2. **Rewrites the list at every login because of order.** The comparison is text, so an
   on/off script appending at the end, or `glass-bar.sh mode` re-enabling BMS, makes it differ. The
   journal shows "enabling the extension set" at 17:30 and 18:17 today. Each rewrite sets
   `changed=1`, which also toggles the shell theme off and on (a visible flash at login).
3. **Force-loads incompatible code on a GNOME major bump.** Step 5e sets
   `disable-extension-version-validation` to true on every run and step 4 re-enables everything. On
   GNOME 52 nothing stops the 51-only tahoe-* extensions, Open Bar (49), the RWC port, Kiwi's patch or
   an old BMS build from loading; step 4 only logs ERROR. Only tahoe-lockscreen checks the version
   itself.
4. **Deletes the patched Blur My Shell on a version bump.** Step 8 `rm -rf`s any extension whose
   metadata lacks the running major and installs EGO's build; for BMS that is the stock build, then
   5f rebuilds the pinned 51-era commit with the patch. On 52 that build may not run, and validation
   is off, so it loads anyway. Nothing checks that the patch still applies before the old build is
   gone. RWC is the same: refetch, then the 51 port is copied over the new build and its metadata is
   forced to `["51"]`.
5. **Downloads and runs code at login without asking.** Steps 2, 5b2 and 8 fetch EGO zips and step 1
   clones MacTahoe's master and runs its installer, all unpinned and unverified, from an autostart
   with an 8 s delay. `InstallRemoteExtension` can also pop GNOME's install dialog.
6. **Races GNOME at login.** It runs 8 s after login, while extensions are still starting; a
   `gnome-extensions info` that fails then makes step 3 ask for a remote install. Step 5 reads the
   last theme load from the whole boot's journal, which is from an earlier login when the user logs
   out and back in (common here).
7. **Rewrites user choices made in GNOME's own UI.** Dark Style in quick settings, a font picked in
   Tweaks, the cursor, the button layout and the BMS preferences are reset at the next login with
   no record that they were changed. That is the intent for the design's keys, but the user gets no
   message and has no "keep my change" switch apart from editing the state file by hand.
8. **Re-renders shell CSS from whatever the live checkout holds.** A branch's CSS applied by hand
   is undone at the next login (seen by the glass-motion session), and an uncommitted edit in the
   checkout is applied live.
9. **Obsolete fixes stay armed.** 5c (modal dialogs) and 5b2 (old patch markers) target v75-era
   code; they do nothing on v76 today, but 5c would edit and reload any future BMS that lists
   `'modal-dialog'` in `blur_surface.js` again, and the dialogs are meant to be glass now.
10. **No backups.** Shell CSS, GTK CSS, BMS files and RWC metadata are rewritten in place; the only
    backup is glass-bar.sh's one-time pre-glass dump.

### On a GNOME version bump, today

| Bump | What happens | Wanted |
|---|---|---|
| 51.1 → 51.2 (minor) | Nothing is checked. The gresource (A6) is overwritten by the package, so the login screen reverts silently. Everything else keeps working unless the shell changed a private member | Detect the gresource change; notify that `gdm-theme.sh install` (sudo) is needed |
| 51 → 52 (major) | Step 8 replaces BMS, RWC, Dock etc. with EGO builds when they exist, then 5f/5e put the 51 patch and port back; with validation forced off and step 4 re-enabling the set, 51-only code runs on 52 | Detect the major change once. Leave stock EGO builds in place, do **not** reapply 51-only patches or ports, do not re-enable the tahoe-* extensions or Open Bar, turn validation back on, and notify the user with the list of what was held back and why |
| BMS v77 on EGO | GNOME's updater installs stock v77 at login; 5f rebuilds v76+patch; needs another logout, user not told | Detect it, try the patch on the pinned commit (and report if a newer upstream is needed), rebuild, notify "log out to get the glass back" |
| MacTahoe reinstall | Step 1 or the user reinstalls; 5b, 5d, 6 put the overrides, corners and GTK blocks back at the next run | Same, plus backups and a report |

### Conclusion for the new design

Keep every fix today's script has (they are all deterministic and mostly right), but:

- split **check** (read-only, exit code) from **repair** (only drifted items, logged, backed up);
- compare `enabled-extensions` as a set and only add or remove the design's own uuids, so other
  extensions and the order stay the user's;
- add the missing features: login screen, installed-vs-repo for BMS and tahoe-*, `menubar`,
  fonts, icon link, the repair's own entry points;
- gate everything on a recorded version stamp (gnome-shell major, BMS commit + patch hash, each
  tahoe-* tree hash) and **refuse instead of forcing** when the shell major changes or a patch no
  longer applies;
- tell the user with a desktop notification when a logout or a sudo step is needed;
- keep the on/off switches: a feature switched off stays off; the manifest decides what "on" means.

## Phase 2: design of the new repair

### Pieces

| File | What it is |
|---|---|
| `scripts/repair_manifest.py` | The expected state as code: every item of the inventory that can be checked, with the state-file condition it applies under. Radii, edge alpha and the GTK block markers come from `tokens/` through `glass-tokens.py`. `python3 scripts/repair_manifest.py > config/repair-manifest.json` |
| `config/repair-manifest.json` | The generated manifest, committed. `check` reports it as stale when the tokens or the generator changed and it was not regenerated |
| `scripts/tahoe_repair.py` | The engine: reads the state file and the manifest, probes versions, runs `check` or `repair` |
| `scripts/tahoe-repair.sh` | The entry point the autostart already runs. No argument = `repair` (as today); `check`, `repair`, `status`, `units on|off`, `--gdm` |
| `config/systemd/tahoe-repair.{service,path}` | Optional user units: run `repair` when the pacman hook's stamp or GNOME's pending extension updates change |
| `config/pacman/95-tahoe-repair.hook` | Optional root hook: after gnome-shell, mutter, gtk3/4, libadwaita, gdm or gnome-shell-extensions change, it only writes `/var/lib/tahoe-repair/packages-changed` (package names and time). It never touches the user session |

### Modes and exit codes

- `check`: read-only. Prints one line per item (`ok`, `drift`, `action`, `held`, `info`) and exits
  with the worst: 0 all good, 1 drift that `repair` can fix, 2 something needs the user (a logout,
  a sudo step, a held update), 3 the check itself failed.
- `repair`: runs `check`, fixes only the items in drift, then checks again and reports what is
  left. Every change is logged to the journal and `~/.local/state/tahoe-repair/log`. Every file is
  copied to `~/.local/state/tahoe-repair/backup/<time>/` before anything rewrites it (the Blur My
  Shell folder as a tar). A lock (`flock`) stops two runs at once (autostart and the path unit).
- Neither ever runs `sudo`. Root items (login screen) are checked and reported with the exact
  command for the user.

### The user's switches

- `~/.config/tahoe-glass/state` stays the source of the switches, read the same way as today
  (`enabled`, `bar`, `menus`, `dock`, `apps`, `mode`, old `tint`, `widgets`, `motion`,
  `lockscreen`, `controlcenter`, `menubar`). A feature whose key is `off` is kept off (its uuid
  is removed from `enabled-extensions` if it comes back); a key that is absent leaves the extension
  as the user has it.
- `enabled-extensions` is compared as a set, and only the design's own uuids are added or removed;
  other extensions and the order are the user's.
- New, optional: `repair-skip=C2,D6` in the state file leaves those manifest items alone (a user
  choice made in GNOME's own settings that should stick); `repair=off` stops the repair entirely.

### Version guards

- The manifest names the GNOME major it was tested on (`tested_shell: ["51"]`). On another major
  the repair goes into **hold**: it turns extension version validation back on (so only extensions
  that say they support the running shell load), does not reapply 51-only patches and ports (the
  RWC port, Kiwi's fix, the BMS build), does not enable tahoe-* extensions that do not list the
  running shell, and notifies the user once with what was held back.
- `~/.local/state/tahoe-repair/versions.json` records gnome-shell, mutter, gtk3, gtk4, libadwaita,
  gdm and the extension versions at the last run, so a change is reported once ("gnome-shell
  51.1 → 51.2"), and the running shell is compared with the installed package ("log out to finish
  the GNOME update").
- Blur My Shell: the build is stamped with the upstream commit and the patch's sha256
  (`glass-bar.sh build_bms` writes `tahoe-glass-commit` and `tahoe-glass-patch-sha256` to its
  metadata). Drift: the patch markers are missing (EGO swapped the build), or the stamp differs from
  the repo's patch. Before rebuilding, the patch is tried with `git apply --check` on the pinned
  commit; if it no longer applies, nothing is removed and the user is told. A build with no stamp
  (made before this) is reported as unverified, not rebuilt.
- GNOME's own updater downloads updates to `~/.local/share/gnome-shell/extension-updates/<uuid>` and
  installs them at the next login. For the patched extensions (Blur My Shell, Rounded Window
  Corners, Kiwi Menu) a pending update would drop the patch, so `repair` moves it to the backup
  folder and tells the user that a new upstream version is waiting for the patch to be rebased.
- The login screen: when `/etc/dconf/db/gdm.d/90-tahoe-gdm` exists (the user installed it), the
  system gresource must still hold `tahoe-gdm-background.png`; if a gnome-shell update replaced it,
  the user is notified with `bash scripts/gdm-theme.sh install`. After a major bump the old
  `.pre-gdm-tahoe` base is reported stale instead.

### Triggers

1. Login autostart, as now (`~/.config/autostart/tahoe-repair.desktop`). The engine waits up to
   60 s for the shell's extension system on the session bus before it checks extension state, and
   only toggles the shell theme when a theme file was rewritten or the name was wrong.
2. Optional `tahoe-repair.path` (user): watches `/var/lib/tahoe-repair/packages-changed` and
   `~/.local/share/gnome-shell/extension-updates`, starts `tahoe-repair.service` (`repair`).
   `bash scripts/tahoe-repair.sh units on` installs and enables them (asks nothing of root).
3. Optional pacman hook (root, the user installs it with sudo): only writes the stamp file.

### Notifications

`notify-send` (app name "Tahoe repair"), one per run, only for things the user has to do: log out
(a rebuilt Blur My Shell, a reinstalled extension, a GNOME update), run a sudo command (login
screen), or a held update (new GNOME major, patch no longer applies). The same message is not
repeated within a day (`~/.local/state/tahoe-repair/notified`).

### What stays from today's script

Every fix in the Phase 1 table, with the same commands (glass-bar.sh subcommands for the glass,
gsettings for keys), except: step 5c (v75 modal dialogs) and 5b2 (pre-v76 patch markers) become
checks with no automatic fix; step 8's `rm -rf` and refetch becomes "fetch only when the folder is
missing, and never for the patched extensions"; MacTahoe is rebuilt only when its theme folder is
missing, not when `gtk.css` is merely not a link.
