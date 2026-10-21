# Liquid Glass

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: light)" srcset="docs/showcase/media/title-still-light.webp">
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/showcase/media/title-still-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="docs/showcase/media/title-light.webp">
    <img src="docs/showcase/media/title-dark.webp" width="100%" alt="amorphous glass: a clear capsule of the desktop's glass glides over the words, refracting and melting the letters, and settles over the word glass">
  </picture>
</p>

**macOS Tahoe's Liquid Glass, rebuilt for GNOME 51 on Wayland.** Real refracting glass on the top bar,
dock, every menu, quick settings, the calendar, GTK apps, desktop widgets and the lock screen, with
macOS-style motion: popups grow out of the icon you clicked as a circle of glass.

![The Liquid Glass desktop: a floating glass top bar, Music and Lyrics widgets playing Nude by Radiohead, weather, schedule and clock widgets, and the glass dock](docs/showcase/media/desktop.webp)

<p align="center">
  <img src="docs/showcase/media/quick-settings-motion.webp" width="49%" alt="Quick settings opening as a circle of glass from its icon, then the Wi-Fi submenu">
  <img src="docs/showcase/media/menu-slide-motion.webp" width="49%" alt="Sliding across the top bar: the calendar hands over to quick settings and back">
</p>

Built and tested on CachyOS with GNOME 51.1, an NVIDIA RTX 3090 at 2560x1440 and 120 Hz. Everything
installs into your home folder; only the optional login screen needs `sudo`. Screenshots and clips
are of the real desktop, recorded with GNOME's own screencast. Personal details are blurred.

- [Tour](#tour) · [Animations](#animations) · [Widgets](#widgets) · [Lock screen](#lock-and-login-screens)
- [Requirements](#requirements) · [Install](#install) · [Keeping it through updates](#keeping-it-through-updates)
- [Credits and inspirations](#credits-and-inspirations) · [Licence](#licence)

## Tour

### The glass

One recipe draws every surface: tint, blur, refraction, rim light and an inner edge shadow, from
`glass_params()` in `scripts/glass-bar.sh`. The radii and colours come from `tokens/`, and
`docs/STANDARD.md` is the standard every surface follows.

The glass is drawn by a patched [Blur My Shell](https://github.com/aunetx/blur-my-shell) v76
(`config/bms-tahoe-glass.patch`). CSS draws only the rows and the text.

| Quick settings | Calendar and notifications |
|---|---|
| ![Quick settings in glass capsules, with the Wi-Fi submenu open](docs/showcase/media/quick-settings.webp) | ![The calendar and a notification on the same glass](docs/showcase/media/calendar.webp) |

### Menus everywhere

Top bar menus, dock menus, the desktop right-click menu, window menus and GTK app menus are all the
same glass, rounded concentrically with their rows.

| Desktop menu | Dock menu | Window menu |
|---|---|---|
| ![The desktop right-click menu with Add Widget](docs/showcase/media/desktop-menu.webp) | ![A dock icon's menu](docs/showcase/media/dock-menu.webp) | ![A window's title bar menu](docs/showcase/media/window-menu.webp) |

![Files with its right-click menu in glass, and the glass header bar](docs/showcase/media/files.webp)

### Overview, search and folders

| Search | App folder |
|---|---|
| ![Search results on raised glass panels](docs/showcase/media/search.webp) | ![An app folder opening over the app grid in glass](docs/showcase/media/app-folder.webp) |

### Light, dark and milky

`bash scripts/glass-bar.sh mode light|dark|milky` switches the whole desktop: shell, GTK and libadwaita apps, and every glass tint.

| Light desktop | Light quick settings |
|---|---|
| ![The desktop in light mode](docs/showcase/media/light-desktop.webp) | ![Quick settings in light mode](docs/showcase/media/light-quick-settings.webp) |
| ![The calendar in light mode](docs/showcase/media/light-calendar.webp) | ![Files in light mode](docs/showcase/media/light-files.webp) |

## Animations

The motion comes from the `tahoe-motion` extension.

- **Popups:** they grow from the icon you clicked as a circle of glass, with a calm ease and no
  overshoot.
- **Glass under motion:** the glass stays live while a popup moves or resizes.
- **Menu to menu:** moving between top bar menus hands one over to the next.
- **Windows:** they open with a short spring.

Design notes: `docs/gnome-tahoe/animations.md`.

| Calendar | Desktop menu | Dock menu |
|---|---|---|
| ![The calendar growing out of the clock](docs/showcase/media/calendar-motion.webp) | ![The desktop menu growing from the pointer](docs/showcase/media/desktop-menu-motion.webp) | ![The dock name label, then the dock menu](docs/showcase/media/dock-menu-motion.webp) |

| A window opening, then its menu | Files and its menu |
|---|---|
| ![Calculator opening, then its title bar menu](docs/showcase/media/window-open-motion.webp) | ![Files opening its right-click menu](docs/showcase/media/files-menu-motion.webp) |

| Overview and search | App grid and a folder |
|---|---|
| ![The overview, then search](docs/showcase/media/overview-motion.webp) | ![The app grid, then a folder opening](docs/showcase/media/app-grid-motion.webp) |

| Volume | Moving a widget |
|---|---|
| ![The volume OSD capsule](docs/showcase/media/volume-osd-motion.webp) | ![The clock widget dragged beside the Schedule widget, snapping to the grid, and back](docs/showcase/media/widget-drag-motion.webp) |

## Widgets

Right-click the desktop for **Add Widget**. Drag a widget to move it: it snaps to an 8 px grid. The sizes are Tahoe's: small 170, medium 356 x 170, large
356 x 356 (logical px). Every widget sits on the 24 px glass card of `docs/STANDARD.md`, in light, dark
and milky.

<p align="center">
  <img src="docs/showcase/media/music-swirl-motion.webp" width="32%" alt="The Music widget and the synced Lyrics widget playing Nude by Radiohead, the glass tinted by a slow swirl of the album's colours">
  <img src="docs/showcase/media/music.webp" width="32%" alt="The Music and Lyrics widgets, a still">
  <img src="docs/showcase/media/widget-snapped.webp" width="32%" alt="The clock snapped beside the Schedule widget">
</p>

The Music widgets tint their glass with a slow swirl of the album's colours. The Lyrics widget scrolls
synced lyrics, from a `.lrc` next to a local file or from lrclib.net. Above: *Nude*, Radiohead, *In Rainbows*.

| Widget | Sizes | Module | Data |
|---|---|---|---|
| Analog Clock (numerals), Marks (Clock II), Quarters (Clock III) | small | `clocks.js` | local time |
| Digital Clock, Date & Time | small, medium | `clocks.js` | local time |
| Glass Text Clock (the digits are the glass) | medium | `glasstext.js` | local time; a shader cuts Blur My Shell's glass to the glyphs |
| Calendar: Today, Month, Today and Month | small, small, medium | `calendar.js` | Evolution Data Server events |
| Calendar: Schedule, Schedule Large | small, large | `schedule.js`, `schedule-model.js`, `icsfeed.js`, `ics-expand.js` | today's events from a calendar's private ICS link (Google Calendar's "Secret address in iCal format"), refreshed every 15 min, cached for offline; desktop only, not on the lock screen (sheets `docs/shots/schedule-{light,dark,milky}.png`, `schedule-states.png`) |
| Weather, Next Hours, Week | small, medium, large | `weather.js` | the shell's WeatherClient (libgweather), location from GNOME Weather, refreshed every 30 min |
| Music, Wide, Large (356 x 504), Lyrics, Extra Large Wide (728 x 504), Extra Large Tall (356 x 864) | small, medium, large, large, extra large | `music.js`, `mpris.js`, `swirl.js`, `palette.js` | MPRIS; synced lyrics from a `.lrc` next to a local file, else lrclib.net (Lyrics widget only, once per track); the glass is tinted by a slow swirl of the cover's colours; the app icon raises the player's window (sheets `docs/shots/music-all-{light,dark}.png`) |


### Schedule widgets: setting your calendar link

The Schedule widgets read one calendar through its private ICS address. In Google Calendar on the
web: Settings, pick the calendar under "Settings for my calendars", Integrate calendar, copy
**Secret address in iCal format**. Then, in a terminal:

```bash
bash scripts/tahoe-widgets.sh calendar-url
```

Paste the address at the hidden prompt and press Enter. The widgets load it within a second.

- The address is a password: anyone with it can read the whole calendar. It is stored in the
  GNOME keyring (or, without one, in `~/.config/tahoe-glass/calendar-url`, readable only by you),
  never in this repo, and never logged. Don't paste it into chats, issues or screenshots. If it
  leaks, use "Reset" next to it in Google Calendar and set the new one.
- `bash scripts/tahoe-widgets.sh calendar-url --clear` forgets it and the cached events;
  `bash scripts/tahoe-widgets.sh status` says where it is kept.
- The last copy is cached privately in `~/.cache/tahoe-glass/calendar.*` (mode 0600) so the widgets
  work offline. Google updates these feeds on its own schedule, sometimes hours after a change.
- One calendar at a time. Colours: the feed's own if it has them (Google's has none), otherwise a
  fixed colour per event, so a series keeps its colour.

The ICS parsing uses [ical.js](https://github.com/kewisch/ical.js) 2.2.1 by Mozilla and Philipp
Kewisch (MPL-2.0), vendored unmodified in `extensions/tahoe-widgets@cachyos-tahoe/vendor/` with its
licence. It runs in its own process (`ics-expand.js`), never inside the shell.

## Lock and login screens

The `tahoe-lockscreen` extension puts the Tahoe layout on GNOME's own unlock dialog:

- a glass clock;
- your widgets;
- Now Playing over the album-colour swirl;
- glass on the top-right menu and on the password field.

GNOME's own prompt and password check are unchanged. On any fault it falls back to GNOME's own lock screen.

<p align="center">
  <img src="docs/showcase/media/lock-screen-motion.webp" width="100%" alt="The lock screen: a large glass clock, weather and calendar widgets, and Now Playing over a swirl of In Rainbows' colours">
</p>

| The menu | Signing in |
|---|---|
| ![The lock screen's glass menu](docs/showcase/media/lock-menu.webp) | ![The glass password field while typing](docs/showcase/media/sign-in-typing.webp) |

The login screen gets the same glass from `scripts/gdm-theme.sh` (optional, needs `sudo`):

- a theme for GDM;
- a greeter extension with the glass clock, the widgets, glass account rows and the password field.

**Switch User** on the lock screen leads straight to it. These shots come from a fresh test VM
(`tools/vm`) installed with `./install.sh`, at 2560x1440.

![The login screen: the glass clock, weather and calendar widgets, and a glass account row](docs/showcase/media/login-screen.webp)

| Switch User on the lock screen | Two accounts | The password |
|---|---|---|
| ![The Switch User button beside the lock screen prompt](docs/showcase/media/lock-switch-button.webp) | ![The login screen listing two accounts on glass rows](docs/showcase/media/switch-user.webp) | ![The login screen's glass password field](docs/showcase/media/login-prompt.webp) |

## Requirements

| | |
|---|---|
| **Desktop** | GNOME 51 on **Wayland** (gnome-shell and mutter 51.x, GTK 4.24, libadwaita 1.10). The extensions refuse other GNOME versions, and the repair holds back on them |
| **Distribution** | Arch-based: CachyOS, Arch, EndeavourOS. The installer uses pacman. Other distributions can follow the manual steps, untested |
| **Graphics** | A GPU with solid OpenGL. Tested on NVIDIA (RTX 3090, proprietary driver) at 2560x1440 and 120 Hz. AMD and Intel should work; untested |
| **Packages** | `gnome` and `gnome-shell-extensions` (User Themes); `git`, `make`, `gettext`, `glib2`, `python-gobject`, `curl`, `unzip`; `7zip` only for SF Pro |
| **Fonts** | SF Pro from your own download at [developer.apple.com/fonts](https://developer.apple.com/fonts/) (Apple's licence; never shipped here). Space Grotesk (OFL) for the lock screen clock, optional |
| **Network** | The first install clones Blur My Shell, MacTahoe and the icon theme from GitHub, and fetches extensions from extensions.gnome.org |
| **Optional** | An MPRIS player (Spotify, Rhythmbox, a browser) for the Music widgets; GNOME Weather with a location for Weather; a calendar in GNOME Calendar or an ICS link for the calendar widgets; `sudo` for the login screen |

## Install

Everything goes into your home folder, and an uninstall puts back what was there.

```bash
git clone https://github.com/Blanchedubois/liquid-glass ~/Projects/liquid-glass
```

```bash
cd ~/Projects/liquid-glass && ./install.sh --check
```

`--check` changes nothing. It lists what is missing and the exact `pacman` line to fix it. Then:

```bash
./install.sh
```

The installer:

1. backs up your current GNOME settings (`~/.local/share/glass-backup`);
2. installs the MacTahoe theme and icons;
3. installs the extensions from extensions.gnome.org;
4. builds the patched Blur My Shell;
5. turns on the glass, the widgets, the motion and the lock screen;
6. sets up `tahoe-repair` to run at every login.

**Log out and back in** when it finishes: GNOME on Wayland loads new extensions only at login.

Tested from scratch on a fresh Arch Linux VM with GNOME 51.1 (`tools/vm/vm.sh`). The first login after
the install looks like this, before you add widgets:

![A fresh install after the first login: the glass bar, the glass dock and the Tahoe icons](docs/showcase/media/fresh-install.webp)

Optional steps, after it:

```bash
bash scripts/sf-fonts.sh ~/Downloads/SF-Pro.dmg
```

```bash
bash scripts/gdm-theme.sh install
```

The first sets SF Pro as the system font, from your own download. The second installs the login
screen and asks for your `sudo` password; `bash scripts/gdm-theme.sh undo` reverses it.

Switch any piece off and on later:

- `bash scripts/tahoe-widgets.sh off`
- `bash scripts/tahoe-motion.sh off`
- `bash scripts/tahoe-lockscreen.sh off`
- `bash scripts/glass-bar.sh menus off`, `dock off`, `apps off`, `mode light`

To remove everything:

```bash
./install.sh --uninstall
```

## Keeping it through updates

GNOME, extension and theme updates undo parts of the design:

- GNOME's updater swaps the patched Blur My Shell for the stock one;
- a gnome-shell update replaces the login screen theme;
- a MacTahoe reinstall drops the CSS overrides.

`scripts/tahoe-repair.sh` runs at every login, checks about 190 items against
`config/repair-manifest.json` and puts back what drifted. A feature you switched off stays off, and it
never runs sudo. A root step or a logout it cannot do comes as a notification.

```bash
bash scripts/tahoe-repair.sh check
```

```bash
bash scripts/tahoe-repair.sh repair
```

`check` is a read-only report; its exit code is 0 when all is well, 1 when there is drift and 2 when
something needs you. `repair` fixes only the drift, logged and backed up.

On a GNOME major it was not tested on, it holds back the 51-only patches instead of forcing them.
Details, the switches and the drift test results: `docs/REPAIR.md`.


## Credits and inspirations

Liquid Glass stands on other people's work. Thank you.

**Extensions it uses**

| Extension | By | Used for |
|---|---|---|
| [Blur My Shell](https://github.com/aunetx/blur-my-shell) | aunetx and contributors | Every glass surface. Built from v76 with this repo's patch (`config/bms-tahoe-glass.patch`) |
| [Open Bar](https://github.com/neuromorph/openbar) | neuromorph | The floating pill top bar (its other styling stays off) |
| [Dash to Dock](https://micheleg.github.io/dash-to-dock/) | micheleg and contributors | The dock |
| [Rounded Window Corners Reborn](https://github.com/flexagoon/rounded-window-corners) | flexagoon, from yilozt's original | 24 px window corners; the GNOME 51 port follows its upstream PR 175 |
| [AppIndicator and KStatusNotifierItem Support](https://github.com/ubuntu/gnome-shell-extension-appindicator) | Ubuntu, rgcjonas, 3v1n0 | Tray icons |
| [Now Playing Card](https://github.com/epogonii/nowplaying-card) | epogonii | The Now Playing card in the top bar |
| [Vitals](https://github.com/corecoding/Vitals) | corecoding | System readings in the top bar |
| Kiwi Menu (extensions.gnome.org, `kiwimenu@kemma`) | kemma | The Apple menu (optional menu bar extras) |
| [User Themes](https://gitlab.gnome.org/GNOME/gnome-shell-extensions) | GNOME | Loading the shell theme |

**Themes, icons and fonts**

- [MacTahoe GTK theme, icon theme and wallpapers](https://github.com/vinceliuice/MacTahoe-gtk-theme) by vinceliuice: the GTK and shell base, the cursors and the wallpapers.
- [GNOME-macOS-Tahoe](https://github.com/kayozxo/GNOME-macOS-Tahoe) by kayozxo: the Open Bar preset the bar starts from.
- Tahoe-Material icons from this project's parent, [cachyos-tahoe-theme](https://github.com/Blanchedubois/cachyos-tahoe-theme).
- [Space Grotesk](https://github.com/floriankarsten/space-grotesk) by Florian Karsten (OFL): the lock screen clock and the title.
- Fold, the GNOME 51 wallpaper, by the GNOME Design Team (CC BY-SA 3.0): the background of the title animation.
- SF Pro and SF Symbols by Apple: used only from your own download, never shipped.

**Libraries and services**

- [ical.js](https://github.com/kewisch/ical.js) by Mozilla and Philipp Kewisch (MPL-2.0), vendored for the Schedule widgets.
- [lrclib.net](https://lrclib.net): synced lyrics for the Lyrics widget.

**Inspirations**

- Apple's macOS Tahoe and its Liquid Glass design language: the look this recreates (measured values in `docs/liquid-glass.md`).
- [liquidglass-kde-widgets](https://github.com/jaxparrow07/liquidglass-kde-widgets) by jaxparrow07 (GPL-3.0): the designs of Clock II and III, Glass Text, Weather and Music, redrawn for GNOME Shell. No code, fonts or icons are taken from it.
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) by Steve-xmh (AGPL-3.0) and [Adaptive Palette](https://pub.dev/documentation/adaptive_palette/latest/) (MIT): the technique behind the album-colour swirl. The shader and colour code here are written for this repo; no code is taken from either.

## Repository layout

| Path | What it is |
|---|---|
| `install.sh` | Install, check and uninstall |
| `config/bms-tahoe-glass.patch` | The Blur My Shell patch: refraction, rim light and edge shadow, per-piece quick settings, popup and app glass, the motion API |
| `config/gnome-shell-overrides.css` | Shell CSS over MacTahoe, rendered with `tokens/` |
| `scripts/glass-bar.sh` | Apply, rebuild and switch every glass surface and mode |
| `scripts/tahoe-repair.sh`, `scripts/tahoe_repair.py`, `scripts/repair_manifest.py` | The repair and its manifest (`docs/REPAIR.md`) |
| `scripts/tahoe-*.sh` | The on/off switches of each Tahoe extension |
| `extensions/` | `tahoe-widgets`, `tahoe-motion`, `tahoe-lockscreen`, `tahoe-gdm` (login screen), `tahoe-menu-bar` and `tahoe-control-center` (built, off) |
| `tokens/`, `docs/STANDARD.md` | The glass standard: radius, gap, tint and edge per surface |
| `docs/` | Plans, measurements and workshop notes for every part |
| `docs/showcase/title/` | The title animation: a WebGL page with the desktop's glass shader and springs, and its renderer |
| `tools/` | Headless test shells, stress tests, the repair's drift tests, the showcase shoot |

## Licence

GPL-3.0, as Blur My Shell and cachyos-tahoe-theme. Glyphs, fonts and brand marks keep their upstream
licences. The title animation's images and videos (`docs/showcase/media/title-*`) show the Fold
wallpaper and are shared under CC BY-SA 3.0. macOS, Liquid Glass and SF Pro are Apple's; this project is not affiliated with Apple.
