# Liquid Glass

macOS Tahoe's Liquid Glass for GNOME 51 (Wayland), split out of
[cachyos-tahoe-theme](https://github.com/Blanchedubois/cachyos-tahoe-theme) so the glass can be
standardised in one place. Built and tested on CachyOS with an NVIDIA RTX 3090 at 2560x1440, 120 Hz.

The glass is drawn by a patched Blur My Shell v76 (`config/bms-tahoe-glass.patch`): a floating
pill top bar through Open Bar, quick settings drawn as separate glass capsules, glass menus, dock,
app windows and GTK header bars. One recipe in `glass_params()` in `scripts/glass-bar.sh` sets
tint, blur, rim light and edge shadow for every surface, in light, dark and milky modes.

## Layout

| Path | What it is |
|---|---|
| `config/bms-tahoe-glass.patch` | Blur My Shell patch: per-piece quick settings, refraction shader with rim light and edge shadow, profiling counters, the quick-settings freeze key, GTK app glass |
| `config/gnome-shell-overrides.css` | Shell CSS on top of MacTahoe (menu rows, quick settings, Now Playing) |
| `config/rwc-gnome51/` | Rounded Window Corners fixes for GNOME 51 |
| `scripts/glass-bar.sh` | Apply, rebuild and mode switching for all glass surfaces |
| `scripts/tahoe-repair.sh` | Keeps the design through updates: `check` (read-only) and `repair` (at login); see Keeping the design below |
| `scripts/tahoe_repair.py`, `scripts/repair_manifest.py`, `config/repair-manifest.json` | The repair engine and its expected state, generated from `tokens/` |
| `config/systemd/`, `config/pacman/` | Optional triggers for the repair: a user path unit and a pacman hook that only records changes |
| `scripts/glass-app-ids.py` | Which apps get window glass |
| `scripts/gnome-setup.sh`, `scripts/sf-fonts.sh` | Base GNOME setup and SF Pro from the user's own Apple download |
| `extensions/tahoe-widgets@cachyos-tahoe` | Desktop widgets in glass (live): clocks, calendar, weather, music; see Widgets below |
| `extensions/tahoe-control-center@cachyos-tahoe` | Tahoe Control Center panel (built, switched off) |
| `extensions/tahoe-menu-bar@cachyos-tahoe` | Tahoe menu bar contents (built, not applied) |
| `tokens/` | Radius, glass colour and palette tokens (`scripts/glass-tokens.py` reads them) |
| `docs/STANDARD.md` | The Liquid Glass standard: radius, gap, rows, tint and edge per surface |
| `docs/liquid-glass.md` | Measured macOS Tahoe glass values |
| `docs/gnome-tahoe/` | Refraction shader study, menu bar and Control Center port, animation plan |
| `docs/GLASS_MENUS_PLAN.md` | Plan for glass menus in GTK apps |
| `docs/HANDOVER.md` | Where things stand and what to standardise next |
| `docs/REPAIR.md` | tahoe-repair: how to run it, the inventory of what the design depends on, and the drift test results |
| `tools/` | Frame probe extension and A/B script used to measure menu smoothness; `tools/widgets-stress/` headless widget screenshots and stress test |

## Widgets

Right-click the desktop for Add Widget; drag to move, it snaps to an 8 px grid. Sizes are Tahoe's:
small 170, medium 356 x 170, large 356 x 356 (logical px), all on the 24 px glass card of
`docs/STANDARD.md`, in light, dark and milky. Sheet: `docs/shots/widgets-light.png`, `widgets-dark.png`.
Stress and idle-cost results (spam clicks, fast drags, lock cycles, leaks): `docs/widgets.md`.

| Widget | Sizes | Module | Data |
|---|---|---|---|
| Analog Clock (numerals), Marks (Clock II), Quarters (Clock III) | small | `clocks.js` | local time |
| Digital Clock, Date & Time | small, medium | `clocks.js` | local time |
| Glass Text Clock (the digits are the glass) | medium | `glasstext.js` | local time; a shader cuts Blur My Shell's glass to the glyphs |
| Calendar: Today, Month, Today and Month | small, small, medium | `calendar.js` | Evolution Data Server events |
| Weather, Next Hours, Week | small, medium, large | `weather.js` | the shell's WeatherClient (libgweather), location from GNOME Weather, refreshed every 30 min |
| Music, Wide, Large (356 x 504), Lyrics, Extra Large Wide (728 x 504), Extra Large Tall (356 x 864) | small, medium, large, large, extra large | `music.js`, `mpris.js`, `swirl.js`, `palette.js` | MPRIS; synced lyrics from a `.lrc` next to a local file, else lrclib.net (Lyrics widget only, once per track); the glass is tinted by a slow swirl of the cover's colours; the app icon raises the player's window (sheets `docs/shots/music-all-{light,dark}.png`) |

Clock II and III, Glass Text, Weather and Music follow the designs of
[liquidglass-kde-widgets](https://github.com/jaxparrow07/liquidglass-kde-widgets) by jaxparrow07
(GPL-3.0), redrawn for GNOME Shell; no code, fonts or icons are taken from it (its fonts and icons
are Apple's). Where the KDE look differs from the glass standard (weather-coloured cards, its own card
glass), the standard wins.

The Music widgets' album-colour swirl follows the technique of the background renderer in
[applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) by Steve-xmh
(AGPL-3.0) and of [Adaptive Palette](https://pub.dev/documentation/adaptive_palette/latest/) (MIT):
dominant colours by k-means, a heavily blurred field turning slowly, a cross-fade per track. The
shader and the colour code here are written for this repo (GPL-3.0); no code is taken from either.

## Keeping the design

GNOME, extension and theme updates undo parts of the design (GNOME's updater swaps the patched Blur
My Shell for the stock one, a gnome-shell update replaces the login screen theme, a MacTahoe
reinstall drops the CSS overrides). `scripts/tahoe-repair.sh` checks about 190 items against
`config/repair-manifest.json` and puts back what drifted at every login. A feature you switched off
stays off, and it never runs sudo; a root step or a logout it cannot do comes as a notification.

```bash
bash scripts/tahoe-repair.sh check    # read-only report, exit 0 ok / 1 drift / 2 needs you
bash scripts/tahoe-repair.sh repair   # fix only the drift, logged and backed up
bash scripts/tahoe-repair.sh status   # versions, switches, hold mode
```

On a GNOME major it was not tested on, it holds back the 51-only patches instead of forcing them.
Details, switches and the test results: `docs/REPAIR.md`.

## Where this came from

A snapshot taken 2026-10-19 from the cachyos-tahoe-theme checkout:

- branch `glass-bar` at d59a58d, plus its uncommitted work from several sessions (the state on screen);
- branch `claude/gnome-tahoe-refraction-5f4a87` at 6868d3b (shader study, Control Center, menu bar);
- branch `claude/glass-tuning-6c0530` at 66dc563 (animation plan, menu row radii).

Left out: the KDE Plasma theme, Kvantum, Konsole and the Tahoe-Material icon theme. The scripts
skip the icon theme when it is missing; it still lives in cachyos-tahoe-theme.

The live desktop runs from this repo: the login autostart runs `scripts/tahoe-repair.sh` here, and
Blur My Shell is built from `config/bms-tahoe-glass.patch` here. The glass standard is
`docs/STANDARD.md`; its radii and colours are in `tokens/`.

## SF glyphs

The two menu bar glyphs in `extensions/tahoe-menu-bar@cachyos-tahoe/icons/` are traced from
SF Symbols and are not committed. Make them locally from your own SF download the same way the
icon set is made in cachyos-tahoe-theme (`scripts/fetch-glyphs.py` there).

## Licence

GPL-3.0, as cachyos-tahoe-theme and Blur My Shell. Glyphs and brand marks keep their upstream licences.
