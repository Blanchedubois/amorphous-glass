# The Liquid Glass standard

One table for every glass surface on the GNOME 51 desktop. Radii live in `tokens/radius.json`;
the CSS (`config/gnome-shell-overrides.css`, `gtk_glass`, `gtk3_glass`) and Blur My Shell's radius
keys are written from it. Tint, rim light and edge shadow come from `glass_params()` in
`scripts/glass-bar.sh`, the edge from `glass_edge_alpha()`. Values in logical px at 1x.

## The rule

- **One owner per layer.** Blur My Shell draws the glass (blur, tint, rim light, edge shadow).
  CSS draws only the rows and the text. No surface paints a fill of its own over the glass.
- **No outline on dropdowns.** Menus, popovers, the calendar, quick settings submenus and
  notifications have no CSS border or ring: the shader's rim light is their only edge (user, 2026-10-19:
  the outline was thick and fought the glass). Rows draw no focus outline either. The 1 px edge line
  stays only on the bar, the dock, the quick settings capsules and the widgets.
- **One shape.** The CSS shape (rows, hit area) and the glass under it have the same radius, from the same token.
- **Concentric rows.** A row or card inside a surface is rounded at the surface radius minus the
  gap around it. A row can be no rounder than a capsule (half its height), so the surface radius
  follows the row: radius = min(row, row height / 2) + gap. Measured row heights: shell menu rows
  about 28 px (capsule 14), GTK menu rows 26 px (13), quick settings submenu rows 32 px (16).

## Radius per surface

| Surface | Radius | Padding (gap) | Rows / cards inside | Blur My Shell key | CSS |
|---|---|---|---|---|---|
| Top bar | pill (half its 38 px height) | | | `panel corner-radius` 50 (clamped) | Open Bar `bradius` 50 |
| Dock | 28 | | | follows the dock's own outline | theme `.dash-background` 28 |
| Shell menus: top bar menus, dock menus, desktop right-click menu | **18** | 4 | rows **14** | `popup menu-corner-radius` 18 | `.popup-menu-content` 18 (theme draws 14) |
| Calendar | **32** | 12 | cards (events, weather, clocks, notifications) **20** | `popup calendar-corner-radius` 32 (30 today) | `.datemenu-popover` 32 (20 today) |
| Notification banners | **20** | | | `popup notification-corner-radius` 20 (18 today) | `.notification-banner`, `.message` 20 (theme 14) |
| Quick settings toggles, sliders, round buttons | capsule / circle | | | 9999 (patch) | 9999 |
| Quick settings submenus | **32** (a 64 px toggle's end) | 16 | rows **16** | `popup submenu-corner-radius` 32 (36 before) | `.quick-toggle-menu` 32 |
| GTK4 popovers and menus (Files, Text Editor, every app) | **17** | 4 | rows **13** | `applications menu-corner-radius` 17 (patch key) | `popover > contents` 17, no fill, popover node clear |
| GTK3 context menus (popup windows) | **17** | 4 | rows **13** | `applications menu-corner-radius` 17 | `window.popup menu` 17 |
| GTK3 popovers (inside their window, cannot blur) | 17 | 4 | rows 13 | none | opaque popover token |
| App windows and header bars | **24** | | buttons pill | `applications corner-radius` 24 | theme `window.csd` 24, Rounded Window Corners 24 |
| Desktop widgets | **24** | 16 to 18 | | widgets extension `RADIUS` 24 | `.tahoe-widget` 24 |
| Tooltips | 8, not glass | | | | |

## Glass per mode (every surface above, one recipe)

| | light | dark | milky |
|---|---|---|---|
| Tint (Blur My Shell) | white at 0.18 | rgb 34,34,38 at 0.42 | white at 0.12 |
| Fill painted by CSS on any glass surface | none | none | none |
| Edge line on dropdowns (menus, popovers, calendar, submenus, notifications) | none | none | none |
| Edge line on bar, dock, quick settings capsules, widgets | 1 px white at 0.25 | 1 px white at 0.16 | 1 px white at 0.12 |
| Rim light | 0.55 over 0.45 of the edge band | same | same |
| Edge shadow (inner AO band) | 0.30 over 0.20 of the band | same | same |
| Drop shadow | 0.20 | same | same |
| Row hover / pressed | black 0.06 / 0.10 | white 0.12 / 0.18 | white 0.12 / 0.18 |
| Separator (inset to the text, 10 px each side in GTK menus) | black 0.10 | white 0.10 | white 0.10 |
| Text | dark (0.11, 0.11, 0.12) | white | white |

Blur strength per surface: bar 12, menus and dock 18, app windows 24.

## What was fixed (2026-10-19, VM shots in `docs/shots/standard-dark.png`, `standard-light.png`)

| Where | Before | Standard |
|---|---|---|
| GTK4 popovers (Files ⋯ and right-click, Text Editor) | the theme's opaque square-ish menu (#333, 12 px) over the glass card | contents clear, 20 px, rows 16 |
| Quick settings submenus | glass 36, CSS outline 32, CSS fill rgba(70,65,66,0.8) + inner glow | glass and shape 32, no fill, no outline |
| Calendar | glass 30, CSS 20, its own darker fill rgba(54,49,50,0.86), cards at 12 | 32 / cards 20, no fill |
| Shell menus | glass 20, theme outline 14, CSS fill rgba(70,65,66,0.8), 0.30 edge | shape 20, no fill, no outline |
| Notification banners | glass 18, theme 14 | 20 |
| Quick settings pieces | CSS fill rgba(70,65,66,0.8) under the glass (hidden only while the menu glass is on) | no fill |
| Old 10 px row rule | not in the snapshot any more | nothing to do |
| `tokens/radius.json` | old KDE scale (window 20, menu_item 3) | this table |
