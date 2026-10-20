# GDM login screen: Tahoe look

Goal: the login screen after boot or logout (GDM's greeter) gets the look of the new lock screen
(extensions/tahoe-lockscreen@cachyos-tahoe, docs/LOCKSCREEN_PLAN.md). Phased, each phase approved by
the user. Every write outside the repo needs root and the user's OK in chat, with the exact commands
shown first.

## Recovery first (read before any phase)

If the login screen is broken (blank, crashing, no password field):

1. Press **Ctrl+Alt+F3** (F4/F5/F6 also work) and log in on the text console as `blanched`.
2. Put the previous theme back and restart the login screen:

   ```bash
   sudo cp /usr/share/gnome-shell/gnome-shell-theme.gresource.pre-gdm-tahoe /usr/share/gnome-shell/gnome-shell-theme.gresource
   sudo systemctl restart gdm
   ```

   Phase 1 also added greeter settings (time-only clock, no logo) and maybe a font; to remove them:
   ```bash
   sudo rm -rf /etc/dconf/db/gdm.d /etc/dconf/db/gdm /etc/dconf/profile/gdm
   sudo dconf update
   sudo rm -rf /usr/local/share/fonts/SpaceGrotesk && sudo fc-cache -f
   ```
   (`restart gdm` ends any graphical session, so run it only from the text console.)
   `scripts/gdm-theme.sh commands` prints the same undo block.
3. Stock GNOME theme instead (what Arch ships): `sudo pacman -S gnome-shell` reinstalls the package
   file. The stock file is also kept at `gnome-shell-theme.gresource.bak` (MacTahoe's backup, Oct 14).
4. Phase 2 only (extension): also
   ```bash
   sudo rm -rf /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe
   sudo rm -rf /etc/dconf/db/gdm.d /etc/dconf/db/gdm /etc/dconf/profile/gdm
   sudo dconf update
   sudo systemctl restart gdm
   ```
5. If even the text console is unusable: in the Limine boot menu, edit the entry and add
   `systemd.unit=multi-user.target` to the kernel command line. That boots without GDM; log in and do
   step 2, then `sudo systemctl isolate graphical.target` or reboot.

Before phase 1 is installed: check once that Ctrl+Alt+F3 gives a login prompt and the sudo password
works there.

## Phase 0: how GDM is themed today (research, no changes)

- GNOME 51.1, gdm 51.1, Wayland, `graphical.target`, bootloader Limine.
- `/usr/share/gnome-shell/gnome-shell-theme.gresource` (1.5 MB, Oct 18) is MacTahoe's GDM build,
  installed with `sudo ./tweaks.sh -g -i apple -c Dark` from `~/.local/src/MacTahoe-gtk-theme`
  (git 1e45e19, fish history). So: Apple logo option, dark variant, **default background (MacTahoe's
  wallpaper) blurred and darkened** (no `-nb`/`-nd`), panel opacity 15 %, 32 px panel.
  The background is baked into the gresource as a **1280×720** `background.png`, blurred, set on
  `#lockDialogGroup` in CSS. On a 2560×1440 screen that is upscaled 2×.
- The original GNOME file is beside it as `.bak` (Oct 14, 641 KB, 8 files).
- The file belongs to the `gnome-shell` package (`pacman -Qkk gnome-shell` flags it as modified).
  **Every gnome-shell update overwrites it with the stock theme**, silently, which undoes MacTahoe's
  GDM look today and would undo ours too. Fix (optional, asked separately): a pacman hook that
  reapplies our file after gnome-shell upgrades.
- The **same file** is also the base theme of the **lock screen** (User Themes is off while locked,
  see the lock-screen notes) and sits under the MacTahoe user theme on the desktop. So every rule we
  add must be scoped to the greeter (`.login-dialog`, `#panel.login-screen`), never to
  `.unlock-dialog` or bare classes, or it changes the lock screen and the desktop as well.
- Login-screen settings: the CachyOS logo at the bottom comes from
  `zz_cachyos.org.gnome.login-screen.gschema.override` (`logo='/usr/share/icons/cachyos.svg'`).
  No `/etc/dconf/profile/gdm`, no `/etc/dconf/db/gdm.d` yet. Wallpaper is
  `/usr/share/backgrounds/gnome/fold-l.jxl` (same for the lock screen).

### How the greeter lays itself out (GNOME 51 `gdm/loginDialog.js`, `ui/sessionMode.js`)

- Session mode `gdm`: `isGreeter`, panel = `dateMenu` in the centre (one line, "Oct 20 1:26 PM"),
  quick settings at the right; `panelStyle: 'login-screen'` (so `#panel.login-screen` in CSS).
- `LoginDialog.vfunc_allocate` places everything in JS: the user list is centred and stretched to
  fill the height; the password prompt (`_authPrompt`: avatar, name, entry) is centred 50 px below
  the middle; the logo sits at the bottom centre; the a11y/session buttons at the bottom corners;
  a banner (if any) under the panel. There is **no clock** in the dialog; only the panel's one-line
  date and time.
- The arrow covers the eye icon here too: same `login-dialog-default-button-well` and
  `login-dialog-prompt-entry` as the lock screen, and the MacTahoe build drops the padding.

### Theme only vs. a gdm-mode extension

| | Theme only (phase 1) | gdm-mode extension (phase 2) |
|---|---|---|
| What changes | one file: the theme gresource (CSS and the background picture) | new folder `/usr/share/gnome-shell/extensions/<uuid>`, `session-modes: ["gdm"]`, enabled through a gdm dconf profile + `/etc/dconf/db/gdm.d` |
| Password capsule, arrow/eye fix, avatar, colours | yes | yes |
| Sharp background | yes (a full-size picture in the gresource) | yes |
| Prompt lower on the screen | probably, with margins on the prompt (to verify) | yes, exact |
| Clock | only restyle the panel's clock: bigger, but **one line, date and time side by side**, at the top; GNOME can hide the date (`clock-show-date=false` for the gdm user) for a big time only | the real Tahoe clock: date above, big Space Grotesk time, glass (glassclock.js) |
| Fonts | system fonts only, unless Space Grotesk/SF Pro are installed in `/usr/share/fonts` (root) | same |
| Glass | none (no Blur My Shell on GDM): translucent fills only | a port of glassclock.js; no BMS for menus |
| Survives gnome-shell updates | no (package overwrites it) unless a pacman hook reapplies it | yes for the extension; breaks on a GNOME major version → version pin |
| Failure mode | looks wrong; a broken file can blank the greeter | JS error in the greeter → login screen crashes or loops |
| Risk | low | medium: our code runs in the login path (as user gdm, not root) |

Neither can touch authentication: CSS cannot, and the extension only restyles GNOME's own dialog
(the same rule as the lock screen: never replace the auth prompt).

### Testing without the real login

Done in phase 0: a throwaway headless gnome-shell in `--mode=gdm` (own XDG and runtime dirs, keyfile
settings, `GNOME_SHELL_DATADIR` pointing at a folder of symlinks to `/usr/share/gnome-shell` with our
gresource swapped in) renders the greeter at 2560×1440 and a gdm-mode test extension screenshots it.
No root, nothing installed. Limit: there is no GDM daemon, so the user list and password prompt stay
empty; phase 1 adds a test driver that shows them (AccountsService is reachable). The real login is
checked last, by the user, after approving screenshots.

## Phase 1: theme only (built and tested headless, not installed)

Files: `gdm/tahoe-gdm.css` (the greeter rules), `scripts/gdm-theme.sh build|commands`,
`tools/gdm/run.sh` + `tools/gdm/gdm-shot@local` (harness). Shots: `docs/gdm/phase1-login.png`,
`docs/gdm/phase1-prompt-zoom.png`.

- `build` takes the base theme (the `.pre-gdm-tahoe` backup once installed, else the installed file;
  refuses a base that is already ours), appends `gdm/tahoe-gdm.css` to every stylesheet, adds the
  lock picture (`org.gnome.desktop.screensaver picture-uri`, fold-l) cropped to 2560×1440 as
  `tahoe-gdm-background.jpg`, and compiles `build/gdm/gnome-shell-theme.gresource` (2.1 MB). No root.
- Clock: GNOME's panel clock, time only (gdm dconf `clock-show-date=false`), in the lock screen's
  type, size and place from main's tahoe-lockscreen (12 % digits, `CLOCK.digits 0.12`): Space
  Grotesk SemiBold 237 px, digits measured at y 207–380 (173 px), the lock screen's exact spot.
  Translucent white (0.58) instead of the lock screen's glass (no shader in the greeter).
  GNOME's 12 h clock always shows "PM" (the lock screen leaves it out); 24 h for the login screen
  only is an option (`GDM_CLOCK_FORMAT=24h`).
- Avatar 64 px and the password capsule from lockscreen.css (48/24 capsule, 32/16 arrow 8 px in,
  eye left of the arrow), avatar centre at 82.5 % like the lock screen. The user list sits at the
  same height.
- No distribution logo (gdm dconf `org.gnome.login-screen logo=''`): it sat behind the password field.
- Findings on the way:
  - St drops a quoted font-family list ("Couldn't parse family"); unquoted works. The lock screen's
    lockscreen.css uses quoted lists (only its fallback labels, hidden under the glass).
  - LoginDialog moves the prompt into a right-hand column when the prompt's box reaches into the
    banner area under the panel and the prompt is narrower than a third of the screen. The prompt
    is padded to 907 px wide (empty sides) so it stays centred. St ignores negative margins.
  - Fonts: the greeter only sees system fonts. Without Space Grotesk the clock falls back to Adwaita
    Sans (shot 4). `GDM_FONTS=1 scripts/gdm-theme.sh commands` adds copying Space Grotesk (OFL)
    to `/usr/local/share/fonts`. SF Pro is not copied (Apple's licence); the name label falls back.
- Lock screen check: main's tahoe-lockscreen rendered with the old and the new gresource
  (tools/lockscreen/run.sh dark, `GNOME_SHELL_DATADIR` swapped): clock, entry and full screenshots
  identical (0 pixels differ).
- The user's choice (2026-10-20): 24 h clock on the login screen, Space Grotesk installed
  system-wide (`GDM_CLOCK_FORMAT=24h GDM_FONTS=1 scripts/gdm-theme.sh commands`).
- Install: `scripts/gdm-theme.sh commands` (with the options chosen) prints the commands; the user
  runs them (they need the sudo password). Shows at the next logout or boot.

## Phase 2: gdm-mode extension (only if wanted after phase 1)

Port of tahoe-lockscreen (frame.js safety design, shell-version pin, transactional enable,
watchdog) with `session-modes: ["gdm"]`, installed system-wide, fonts in `/usr/share/fonts`, no
access to the user's home. Planned after phase 1.

## Workshop, 2026-10-20: Liquid Glass controls, weather and calendar (test shells only)

### Liquid Glass password field and account rows (phase 2 prototype)

`extensions/tahoe-gdm@cachyos-tahoe` (session mode gdm, GNOME 51 only, not installed):
- `glass.js`: tahoe-lockscreen's glass clock shader over a shape instead of glyphs (a cairo mask
  of a rounded rect: coverage, depth, bend), a little more frost for text on it. Backdrop: the
  theme's background picture (read from `#lockDialogGroup`'s theme node) at monitor size, offset
  under the pane, or a clone of a live background actor (lock screen). No Blur My Shell.
- Password capsule: a glass pane as the first child of AuthPrompt's `_entryArea` (a BinLayout that
  holds the entry; GNOME's password/text entry swap uses replace_child, which keeps ours).
- Account rows: each UserListItem's content goes into a BinLayout box over a glass pill; the row's
  padding moves onto the content, so glass and hover fill are one pill, concentric with the
  64 px avatar (41 = 32 + 9).
- `stylesheet.css` clears the flat fills while `.tahoe-gdm-glass` is on the dialog.
- Safety: every change is recorded and undone on disable or on any error. Fault test
  (`GDM_FAIL_MASK=1 tools/gdm/run.sh`): the mask fails, everything is put back (no style class,
  0 panes, rows back to GNOME's own), the password field stays where it was with phase 1's capsule.
- Still to do before installing: a watchdog like tahoe-lockscreen's frame.js (entry visible,
  on screen, clickable), the lock screen's capsule in the same glass (tahoe-lockscreen), real-login check.
- Edges: drawn edge to edge, the bend sampled past the pane and the rim was cut flat (the user:
  "the rounding is clipped"). The glass is now an inner layer PAD (bend + 4) px bigger than its
  slot on every side, the mask the shape plus that margin, so the anti-aliased edge and the rim
  lie inside the texture. (A clip on the pane instead does not resize the effect's texture.)
  The widget cards' CSS rim (`.tahoe-widget-content` border) is off on this glass: the shader's
  rim is the only edge.
- Shots: `docs/gdm/phase2-glass-controls.png`, `docs/gdm/phase2-corners.png` (before/after, 6x).

### Weather and calendar widgets

What Apple does (checked 2026-10-20):
- **macOS Tahoe** lock screen and login window: date, the big clock (font and weight under
  System Settings > Wallpaper > Clock Appearance, glass look), avatar and password. Apple's own
  documentation describes no widgets there; Mac widgets live on the desktop and in Notification
  Center (one vendor blog claims lock screen widgets on macOS 26; not confirmed by Apple or reviews).
- **iPad / iPhone** (iPadOS 17+, iOS 16+, Liquid Glass in 26): a row of small widgets under the
  clock and an inline line by the date (weather, next event); iOS 26 can also put them at the
  bottom; translucent glass look; a "Glass" clock option.
So widgets under the clock are iPad, not Mac; nothing at all on Apple's login window.

Tested (`tools/gdm/widgets-test.sh OUTDIR lock|gdm KINDS`, `tools/gdm/widgets-test@local`):
tahoe-widgets' WeatherSmall, CalendarDay and CalendarMonth on the glass panes above, under the clock.
- Lock screen (main's tahoe-lockscreen): works. Real weather (the user's location, Cleveland),
  today's date with the rest of today's events. Events on the lock screen are visible to anyone at
  the machine, so that would be an opt-in.
- Login screen: works in the test shell, with limits on the real greeter: it runs as user gdm, so
  it has no calendars (date or month grid only) and no weather location; weather needs the
  location set system-wide (gdm dconf `org/gnome/shell/weather`), shows the city to anyone at the
  login screen and makes the login screen fetch weather over the network.
- Legibility: white text on the glass is fine on the darker parts of the wallpaper, weak on the
  bright yellow (weekend dates in the month, the calendar's red weekday on magenta).
- With music (lock harness `TAHOE_LOCK_PLAYER=1`): Now Playing (wide, 1.5x, 534 px) with the two
  small widgets under it (356 px): the row is narrower than the card, and Now Playing's glass is
  Blur My Shell's while the widgets use this shader; both would need matching.
- Music on the login screen: not possible in a useful way: nobody is logged in, so no player runs,
  and the greeter (user gdm) cannot see a user session's players.
- Shots: `docs/gdm/widgets-workshop.png`.

### Lock screen music mode (workshop, test only)

The idea (user, 2026-10-20): while music plays, the whole lock screen background becomes the Music
widget's album-colour swirl, the cover sits large in the centre, and the widgets stack on the left
as on the iPad.

What Apple does (checked 2026-10-20):
- **iPad, landscape** (iPadOS 17+): the clock and date sit at the top left with a column of
  widgets (sidebar) under them on the left; portrait has up to four widgets under the clock and
  one above. Portrait and landscape keep separate widget sets. iPadOS 26 can stretch the clock.
- **iPhone, iOS 26** (iPad coverage is thin): while media plays the lock screen shows the artwork
  full screen, animated (Apple Music's animated art; MPMediaItemAnimatedArtwork for other apps),
  in sync with the playback controls.
- **Mac**: nothing like it; Now Playing stays a small card.
So the swirl background + big centre cover is iOS 26's music lock screen, and the left column is
iPad landscape; together they are a blend, not a copy of one Apple screen.

Prototype: `tools/gdm/lockmusic-test.sh OUTDIR [dark|light]` (`LOCKMUSIC_LAYOUT=centre|ipad`,
`tools/gdm/lockmusic-test@local`), over main's installed tahoe-lockscreen with a fake player:
- the swirl is an effect on GNOME's lock background actor (the wave field from swirl.js, the
  cover's colours from palette.js, 14 % deeper for white text, cross-faded in over 1.2 s, 25 fps),
  so the glass clock and the glass widgets, which copy that actor, bend the swirl too;
- the cover (30 % of the height, 38 % in the iPad layout) with title, artist and transport
  buttons in the centre; the Now Playing card steps aside;
- widgets (weather, today, month) on the glass panes, in a column at 4.5 % from the left;
  in the iPad layout the clock moves to the top left over the column.
Findings: works headless (`docs/gdm/music-mode-workshop.png`). For a real build: the date should
be left-aligned with the time in the iPad layout; the glass clock must be re-aimed when moved (the
prototype only translates it); the cover's rounded corners need a mask (St draws picture corners
without anti-aliasing); the swirl must stop when idle or dimmed and with animations off, as Now
Playing's does, and its cost (a full-screen shader at 25 fps plus the glass re-rendering) measured.
This belongs in tahoe-lockscreen (another session's extension), not in the GDM work.
- The user's pick (2026-10-20): **A**, the clock stays centred at the top, the cover in the
  centre, the widgets stacked on the left.

### Any monitor size (2026-10-20)

The user asked that all of this works on other monitor sizes and ratios.
- **Theme (phase 1)**: CSS cannot size by the screen, and the first version (clock 237 px, prompt
  pushed 966 px) was tuned to 1440: on a 768 or 1080 screen it would push the password field off
  the screen. `gdm/tahoe-gdm.css` is now a safe baseline for any monitor from 720 px tall (clock at
  the 720 px size, prompt only a little low, no side padding), and the extension sets the exact
  proportions.
- **tahoe-gdm `layout.js`**: the clock from the monitor's height (digits 12 %, top 14.4 %), the
  prompt and the account rows placed by measuring where GNOME put the avatar and correcting the
  padding (avatar centre at 82.5 %, never closer than 4 % to the bottom), the prompt widened past
  a third of the screen so LoginDialog keeps one column on any width, refit on monitor changes; a
  watchdog fails the extension (everything undone) if the password field is ever off the monitor.
- **Glass**: each pane's backdrop lines up with the real background wherever the pane is (the
  cloned actor's own place, or the login screen's whole group for the theme's picture), and a
  pane re-aims when any ancestor moves (found here: the layout moving the prompt left the glass
  showing the background from the old place).
- Measured (`GDM_MONITOR=WxH tools/gdm/run.sh`), with the extension:

  | monitor | clock digits top / height | avatar centre | password field bottom |
  |---|---|---|---|
  | 1366x768 | 14.45 % / 11.98 % | 74.9 % (bottom margin) | 697 / 768 |
  | 1920x1080 | 14.44 % / 12.13 % | 81.0 % (bottom margin) | 997 / 1080 |
  | 2560x1440 | 14.31 % / 12.08 % | 82.5 % | 1310 / 1440 |
  | 2560x1600 | 14.31 % / 12.06 % | 82.5 % | 1442 / 1600 |
  | 3440x1440 | 14.31 % / 12.08 % | 82.5 % | 1310 / 1440 |

  All centred (clock x 50.1 %). Without the extension (baseline) the avatar sits at 53-56 % on
  every size, password field always on screen. Shots: `docs/gdm/login-sizes.png`.
- **Music mode A** (`LOCK_MONITOR=WxH tools/gdm/lockmusic-test.sh`, a patched temp copy of main's
  lock harness): the card fits the room between the clock and the password page's avatar on each
  monitor (the cover shrinks on short screens, a long title is ellipsized at the cover's width),
  the widget column keeps as many widgets as fit. Shots: `docs/gdm/music-mode-sizes.png`.
- Music mode, the user's request: the cover, title, artist and buttons in one Liquid Glass card
  (plain glass, no swirl of its own; it bends the swirling background), corners concentric with
  the cover (48 = 24 + 24). Shot: `docs/gdm/music-mode-card.png`.
- Not covered: two monitors at once (GDM shows the prompt on the primary one; the theme's picture
  spans the whole stage), and fractional or 2x scaling (worked out in logical px, untested).
