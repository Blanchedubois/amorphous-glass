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
| `scripts/tahoe-repair.sh` | Runs at login and puts drifted settings back |
| `scripts/glass-app-ids.py` | Which apps get window glass |
| `scripts/gnome-setup.sh`, `scripts/sf-fonts.sh` | Base GNOME setup and SF Pro from the user's own Apple download |
| `extensions/tahoe-widgets@cachyos-tahoe` | Desktop widgets in glass (live) |
| `extensions/tahoe-control-center@cachyos-tahoe` | Tahoe Control Center panel (built, switched off) |
| `extensions/tahoe-menu-bar@cachyos-tahoe` | Tahoe menu bar contents (built, not applied) |
| `tokens/` | Radius and palette tokens |
| `docs/liquid-glass.md` | Measured macOS Tahoe glass values |
| `docs/gnome-tahoe/` | Refraction shader study, menu bar and Control Center port, animation plan |
| `docs/GLASS_MENUS_PLAN.md` | Plan for glass menus in GTK apps |
| `docs/HANDOVER.md` | Where things stand and what to standardise next |
| `tools/` | Frame probe extension and A/B script used to measure menu smoothness |

## Where this came from

A snapshot taken 2026-10-19 from the cachyos-tahoe-theme checkout:

- branch `glass-bar` at d59a58d, plus its uncommitted work from several sessions (the state on screen);
- branch `claude/gnome-tahoe-refraction-5f4a87` at 6868d3b (shader study, Control Center, menu bar);
- branch `claude/glass-tuning-6c0530` at 66dc563 (animation plan, menu row radii).

Left out: the KDE Plasma theme, Kvantum, Konsole and the Tahoe-Material icon theme. The scripts
skip the icon theme when it is missing; it still lives in cachyos-tahoe-theme.

The live desktop still runs from `~/Projects/cachyos-tahoe-theme`. tahoe-repair, the login
autostart and the Blur My Shell build all point there. Moving them to this repo is a separate step.

## SF glyphs

The two menu bar glyphs in `extensions/tahoe-menu-bar@cachyos-tahoe/icons/` are traced from
SF Symbols and are not committed. Make them locally from your own SF download the same way the
icon set is made in cachyos-tahoe-theme (`scripts/fetch-glyphs.py` there).

## Licence

GPL-3.0, as cachyos-tahoe-theme and Blur My Shell. Glyphs and brand marks keep their upstream licences.
