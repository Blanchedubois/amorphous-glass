# Showcase README and installer: plan

Written 2026-10-20. The goal: a README that shows the Liquid Glass desktop off (screenshots and
short videos of the real desktop, with the animations), a requirements section, an install tutorial
anyone on a GNOME 51 machine can follow, and credits for every extension, theme and inspiration.

## What we can capture, and how

- **Screen capture:** GNOME's own screencast service (`tools/record-screen.js`) records the real
  2560x1440 screen at 120 fps to MP4 with no extra software. Tested 2026-10-20. Screenshots are
  single frames of it; videos are cut and converted to WebM and GIF with ffmpeg (GitHub shows both).
- **Opening things:** apps can be opened from a script (`gio launch`, `gtk-launch`). Shell UI
  (quick settings, calendar, menus, the overview, app folders, the right-click menu, Alt-Tab) has no
  command-line switch. Two ways:
  - **A. You drive, I record.** A cue script shows a notification ("Open quick settings now"),
    records 6 s, then the next cue. No logout needed. The timing is yours, so takes vary.
  - **B. A showcase driver extension** (`tools/showcase@local`, dev only, never part of the
    install). It adds a D-Bus method per shot: open quick settings, open a submenu, open the
    calendar, slide across the top bar menus, open the dock and desktop menus, open the overview,
    the app grid and a folder, Alt-Tab, the volume OSD. Every take then opens at the same moment
    at the same speed, which is what makes the animations look good side by side. It needs **one
    logout** to load, and is switched off again after the shoot.
  Recommended: B for the shell UI, A for what only you can do (below).
- **Only you can do:** lock and unlock (Super+L, then type your password: Claude never types
  passwords), and start Nude by Radiohead (In Rainbows) on Spotify. The track starts with a long
  instrumental, so the lyrics widget is filmed from a lyric line onward.

## Phases

1. **Shot list and staging** (no changes to the desktop). The shot list with which feature each shot
   proves:
   - the desktop with the widgets;
   - the glass bar and dock;
   - quick settings and its submenus;
   - the calendar with notifications;
   - the top bar, dock and desktop menus;
   - GTK apps (Files, Settings, Text Editor) with their glass menus;
   - the overview, search and app folders;
   - light, dark and milky modes;
   - the music widgets in all sizes with Nude, the Lyrics widget;
   - the lock screen clock and the swirl, the login screen (from its existing shots).

   Staging: a clean wallpaper, a "showcase" Files folder with neutral names, and Do Not Disturb so no
   real notification appears. Then a demo notification of our own.
2. **Driver** (option B): write `tools/showcase@local` and a shoot script; test it in the headless
   shell first (no PAM, no lock), then you log out once to load it on the real desktop.
3. **Shoot** on the real desktop: screenshots, then the animation clips (circle morph from the
   icon, menu-to-menu slide, quick settings submenu, dock menu, the window menu, mode switch, widget
   drag and snap, the swirl turning on the Music widget). Your part: Nude playing, and Super+L
   for the lock screen swirl and clock.
4. **Clean up sensitive info.** Every frame and clip is reviewed for:
   - names and the account picture;
   - the weather city;
   - real calendar events;
   - file and folder names;
   - notification text;
   - the Claude window;
   - browser tabs;
   - Discord or Telegram content;
   - IPs in Vitals;
   - anything in a terminal.

   Each is blurred with ffmpeg boxes over the exact region and time (a list per file, kept in
   `docs/showcase/redactions.json` so a re-run gives the same result). A second review pass on the
   output frames, then you approve the set before anything is committed.
5. **Installer.** `install.sh` at the repo root, plus a short `curl` one-liner that only clones the
   repo and prints the next step (no piping a script into a shell):
   - it checks the requirements (GNOME 51 on Wayland, pacman or another package manager, git, make,
     gettext, glib2, python-gobject, curl, 7z for SF Pro);
   - it installs the MacTahoe theme, the extensions from extensions.gnome.org, the patched Blur My
     Shell, Open Bar, the tahoe extensions and the icon theme (cloned from cachyos-tahoe-theme);
   - it applies glass mode;
   - it sets up the repair autostart;
   - SF Pro comes from your own Apple download, and the login screen is an optional sudo step.

   `install.sh --uninstall` puts it all back (`glass-bar.sh undo`, the off switches). It is tested in
   a throwaway user or a VM, never on your account.
6. **README.** Hero image and a 10 s animation montage at the top, then:
   - features, each with its shot or clip;
   - the animations;
   - widgets;
   - lock and login screens;
   - requirements;
   - install tutorial;
   - keeping it through updates (tahoe-repair);
   - credits and inspirations;
   - licence.

   Videos sit in `docs/showcase/` (WebM under 10 MB each, GIF previews under 5 MB).
7. **Ship:** you review the README rendered on GitHub from a branch, then merge and push.

## Credits to list (from the repo and the docs)

- Blur My Shell (aunetx) — patched for the glass.
- Open Bar (neuromorph).
- Dash to Dock (micheleg).
- Rounded Window Corners Reborn (flexagoon), with the GNOME 51 port from its PR 175.
- AppIndicator Support (rgcjonas, 3v1n0).
- Now Playing (epogonii).
- Vitals (corecoding).
- Kiwi Menu (kemma).
- User Themes (GNOME).
- MacTahoe GTK, icon and wallpaper themes (vinceliuice).
- The Open Bar Tahoe preset from GNOME-macOS-Tahoe (kayozxo).
- liquidglass-kde-widgets (jaxparrow07), the designs of several widgets.
- applemusic-like-lyrics (Steve-xmh) and Adaptive Palette, the album-colour swirl technique.
- ical.js (Mozilla, Philipp Kewisch).
- lrclib.net, the lyrics.
- Space Grotesk (Florian Karsten, OFL).
- SF Pro and SF Symbols (Apple, the user's own download, never shipped).
- Apple's macOS Tahoe Liquid Glass, the inspiration.
- cachyos-tahoe-theme (this project's parent).
