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

   (`restart gdm` ends any graphical session, so run it only from the text console.)
3. Stock GNOME theme instead (what Arch ships): `sudo pacman -S gnome-shell` reinstalls the package
   file. The stock file is also kept at `gnome-shell-theme.gresource.bak` (MacTahoe's backup, Oct 14).
4. Phase 2 only (extension): also
   ```bash
   sudo rm -f /etc/dconf/db/gdm.d/90-tahoe-gdm
   sudo dconf update
   sudo rm -rf /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe
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

## Phase 1: theme only (proposed, waiting for OK)

1. Copy the current gresource's files into `gdm/theme/` in the repo (generated, or extracted by a
   script), append `gdm/tahoe-gdm.css` scoped to the greeter: capsule 48 px with the concentric
   32 px arrow and the eye fix (from lockscreen.css, `.login-dialog` instead of `.unlock-dialog`),
   64 px avatar and SF/system name label, prompt moved toward the bottom, panel clock large and
   centred near the top, transparent panel, sharp background (fold-l converted to a 2560×1440 PNG).
2. `scripts/gdm-theme.sh build` compiles the gresource into the repo's build folder (no root);
   `tools/gdm/run.sh` takes screenshots for the user.
3. After the user approves the screenshots, install (needs OK, commands shown first):
   ```bash
   sudo cp -a /usr/share/gnome-shell/gnome-shell-theme.gresource /usr/share/gnome-shell/gnome-shell-theme.gresource.pre-gdm-tahoe
   sudo install -m 644 build/gdm/gnome-shell-theme.gresource /usr/share/gnome-shell/gnome-shell-theme.gresource
   ```
   It shows at the next logout or boot (the lock screen uses it from the next lock; checked with
   tools/lockscreen/run.sh first). Undo: recovery step 2.

## Phase 2: gdm-mode extension (only if wanted after phase 1)

Port of tahoe-lockscreen (frame.js safety design, shell-version pin, transactional enable,
watchdog) with `session-modes: ["gdm"]`, installed system-wide, fonts in `/usr/share/fonts`, no
access to the user's home. Planned after phase 1.
