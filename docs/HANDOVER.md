# Hand-over: standardising the Liquid Glass design

Written 2026-10-19 at the split from cachyos-tahoe-theme, for the next chat.

## The goal

Every glass surface follows one standard: shell menus, quick settings and its submenus, the
calendar, dock menus, the desktop right-click menu, GTK app popovers and context menus (Files,
Text Editor, ...), app windows and header bars, widgets, the top bar and the dock.

## Status (end of 2026-10-19)

Items 1 to 4 below are done: `docs/STANDARD.md` is the approved standard, radii come from
`tokens/radius.json` and colours from `tokens/glass.json` through `scripts/glass-tokens.py`, and the
live desktop runs from this repo (tahoe-repair autostart and the Blur My Shell build). The GTK menu
glass geometry (Phase 2) is in `docs/GLASS_MENUS_PLAN.md`.

## What the standard had to fix (seen 2026-10-19)

1. **GTK popovers draw two layers.** Files' right-click and ⋯ menus and Text Editor's main menu
   show the theme's opaque square-cornered menu on top of a rounded glass card. Wanted: one glass
   surface, contents transparent, the contents radius equal to the glass radius. The Files glass
   session started on this at 15:47 (GTK3 popup menus now transparent, 20 px card, 16 px rows);
   GTK4 popovers are not done. Plan: `docs/GLASS_MENUS_PLAN.md`.
2. **Hover rows concentric with their card.** Row radius = card radius minus the gap around the
   row. Shell menus: card 20 px (Blur My Shell `menu-corner-radius`), 4 px padding, rows 16 px.
   Quick settings submenus: CSS card 32 px, 12 px padding, rows 20 px. Applied live in
   `config/gnome-shell-overrides.css`; an older 10 px rule above it (another session's) is now dead code.
3. **Radii disagree across layers.** Blur My Shell rounds quick settings submenus at 36 px
   (`submenu-corner-radius`) while their CSS outline is 32 px; the calendar glass is 30 px while
   its CSS is 20 px. One radius table (tokens/radius.json) should drive both the CSS and Blur My
   Shell's keys, and tahoe-repair should keep them.
4. **Tint and edge per surface.** Shell menus use the Blur My Shell glass tint; the CSS still
   paints `rgba(70, 65, 66, 0.8)` cards on quick settings submenus and an inner glow. Decide one
   tint per mode and one edge (1 px white at 12 %?) everywhere.

## Smoothness (Phase 0 of docs/gnome-tahoe/animations.md)

Measured on the real desktop with `tools/tahoe-probe@cachyos-tahoe` at 120 Hz:

| Quick settings opening | Typical frame | Worst 5 % | First frame |
|---|---|---|---|
| Liquid Glass (now) | 8.4 ms | 37 to 53 ms | about 33 ms |
| No menu blur | 8.3 ms | 10 ms | 3 to 4 ms |

The shell's own work per frame stays at 4 to 9 ms, so the stall is GPU-side or a sync point,
most likely the per-piece backdrop copies (about 13 glass surfaces live while quick settings is
open). Not measured yet: the freeze key on, and plain blur without refraction. Re-run with
`tools/abrun.sh` while opening the menus, then `python3 tools/analyze.py`.

The user chose the circle-from-the-icon morph for the open animation, a calm ease with no
overshoot, frozen glass during the animation, and wants it on the dock menus and the desktop
right-click menu too. Phases 1 to 5 are in `docs/gnome-tahoe/animations.md`.

## Keeping it through updates (2026-10-20)

`scripts/tahoe-repair.sh` is now a check and repair against a manifest generated from `tokens/`
(`docs/REPAIR.md`). A new feature needs its items added to `scripts/repair_manifest.py`, or the repair
will not keep it.

## Rules the user set

- Leave the menu bar contents and icons alone; keep the quick settings layout.
- The Tahoe Control Center extension stays off.
- Test in the VM first, show screenshots, apply to the real desktop only with a go-ahead.
- A new Blur My Shell build only loads after a logout (the shell caches modules and shaders).

## Housekeeping left on the machine

- `tahoe-probe@cachyos-tahoe` is enabled on the real desktop (logs to ~/.cache/tahoe-probe.jsonl).
  Disable with `gnome-extensions disable tahoe-probe@cachyos-tahoe` when done measuring.
- The live desktop runs from this repo since 2026-10-19 evening. The icon theme still links into
  ~/Projects/cachyos-tahoe-theme/icons, which stays the home of the icon generator.
