# Glass menus for GTK apps: plan

GTK app menus (Files' context menu, the header bar `⋯` menu, every `GtkPopoverMenu`) should be
one Liquid Glass surface, like the shell's menus. Today each shows as two layers: the theme's
own menu drawn on top of a glass card behind it.

## What happens today

The in-progress work (uncommitted on 2026-10-19) has two halves:

1. **Blur My Shell** (`config/bms-tahoe-glass.patch`, `is_app_menu` in `window_rules.js`): a
   GTK4 popover is a Wayland `xdg_popup`, so it is a window of its own (DROPDOWN_MENU /
   POPUP_MENU / MENU). The patch gives those windows the menus' pipeline at a 20 px radius.
2. **GTK4 CSS** (`gtk_glass` in `glass-bar.sh`): `popover > contents` and `popover > arrow` get
   no fill, a 20 px radius, 4 px padding and an inset 1 px edge, so the glass behind shows through.

Both halves are installed (the patched BMS since 15:12, the `menus: glass` block in
`~/.config/gtk-4.0/gtk-Dark.css`). Zoomed, the screenshots show why the result still reads as
two layers:

| Symptom | Cause |
|---|---|
| The glass card is taller than the menu, by about one arrow's height on the side facing the button (`⋯` menu) | `place_dynamic_blur` sizes the blur to `get_frame_rect()`. For a GTK4 popover the frame (xdg window geometry) is the whole popover widget: **contents plus the arrow strip**. The arrow is drawn clear, but the glass still fills its strip. GTK4 hardcodes the tail height (`TAIL_HEIGHT` in `gtkpopover.c`), and the app decides `has-arrow`, so CSS cannot remove the strip. |
| An inner rounded box with its own edge sits inside the card | Measured in Phase 0: **no fill**, only edges. The theme's `popover > arrow, popover > contents { border: 1px solid … }` (grey at about 96 %) is never reset by the block, and our inset white edge sits 1 px inside it. Add the pipeline's own rim and that makes three rims. The darker band around the box is the card's own edge region (and, on the `⋯` menu, the arrow strip). |
| A pill outline on the first row | `popover.menu modelbutton:focus { box-shadow: inset 0 0 0 2px … }`: GTK focuses the first row when a menu opens. |
| Card corners and menu corners don't line up | The card is rounded at 20 px on the frame. The contents are rounded at 20 px, but inset from it. |
| (expected) Submenus (`Open ›`, `Scripts ›`) leave stale glass | `GtkPopoverMenu` resizes in place when it slides to a submenu. The blur has to follow the frame's `size-changed`. |

So the fix is mostly **geometry** (the glass must cover exactly the contents box) plus
**one owner per layer** (the pipeline owns fill and rim, GTK owns only the rows).

## Phases

Each phase ends with a check on Files' context menu, Files' `⋯` menu, a `GtkDropDown`
(Settings) and a GTK3 menu (Disks), in dark and light mode, before the next phase starts.

### Phase 0: measure (no visual change)

- Run `GTK_DEBUG=interactive nautilus` and open the `⋯` menu. In the Inspector, record which
  rule paints `popover > contents` (CSS tab, *background-color* origin) and the popover's
  allocation compared with its contents' allocation (the arrow strip and any margins).
- Add a debug log behind `tahoe_prof.js`'s flag to the patched BMS. For every `is_app_menu`
  window, log the frame rect, the buffer rect, the parent's frame rect and the window type.
- Result: the exact tail height and contents inset per side, and the rule that still paints the
  fill. Write them into this doc.

**Results (2026-10-19).** Measured off-screen, without touching the desktop:
`tools/popover_probe.py` runs a libadwaita window (with Files' `.nautilus-window` class) on
GTK's Broadway backend. It loads the live `~/.config/gtk-4.0` CSS (`XDG_CONFIG_HOME` points at
a copy for experiments) and dumps each popover's render nodes and widget bounds. GTK 4.24.1,
libadwaita 1.10, dark mode.

| | `⋯` menu (has-arrow) | Context menu (no arrow) |
|---|---|---|
| Popover (= frame rect on Wayland) | 163 × 167 | 157 × 155 |
| Contents box inside it | x 1, y 13, 161 × 153 | x 1, y 1, 155 × 153 |
| Inset: arrow side / other sides | **12 px** (+1) / **1 px** | – / **1 px** |
| Fill painted | none | none |
| Edges painted | theme border 1 px rgba(71,71,74,0.96), our inset white 0.16, arrow outline (white 0.16, in a cairo node), first-row focus ring white 0.06 | the same, minus the arrow |

- The 1 px inset on every side is GTK's own layout. It stays with `margin: 0`, `border: none`
  and `box-shadow: none`, so Phase 2 has to inset the glass by it, not CSS.
- Candidate Phase 1 rules, verified in the probe: `border: none` on `contents` and `arrow`
  removes the grey ring and the arrow outline, and `box-shadow: none` on
  `popover.menu modelbutton:focus` removes the row pill. Before/after:
  `docs/shots/gtk-popover-phase0.png`. The yellow outline there is the frame rect, which is
  where Blur My Shell puts the card today.
- Not measured yet: the frame rect as Mutter sees it. Use the BMS debug log above, in the VM,
  since a BMS build needs a logout. The expected value is the popover size, which the
  screenshots support: the `⋯` card overhangs the menu by about 12 px at the top. Light mode
  is also not measured, because `gtk-Light.css` has no glass block while the mode is dark.

### Phase 1: one fill, one rim (CSS only)

- Add `border: none` to the block's `popover.background > contents` and `> arrow` rules, and
  `box-shadow: none` on `popover.menu modelbutton:focus`. Phase 0 found no fill to fight, so the
  `--popover-bg-color` and `box-shadow` ideas are unnecessary.
- Drop our inset edge on `contents`, since the glass pipeline already draws a rim. Keep it only
  if Phase 2 cannot make the shapes coincide.
- Rows: Tahoe's hover is a soft white lift (white 0.10 dark / black 0.06 light), not the accent
  blue. Use 16 px rows (20 px card − 4 px padding) and make separators the same hairline as the
  shell menus.
- Check: with the glass off (`glass-bar.sh menus off`), the menu must be fully clear except
  its text. That proves GTK paints nothing of its own.

**Phase 1a result (VM, 2026-10-19).** `gtk_glass` in `scripts/glass-bar.sh` now adds `border: none` to
the contents and arrow rules (the arrow lost its outline colour) and
`window popover.menu modelbutton:focus { box-shadow: none; }`. Off-screen, the probe shows only our
inset edge and the separators left, with an empty arrow layer. In the VM (mirror user, dark), Files'
`⋯` and background menus went from a bordered box inside the card, with a pill on the first row, to
one glass shape: `docs/shots/gtk-popover-phase1-vm.png` (top: before, bottom: after). Left for Phase
2: on the `⋯` menu the glass still fills the empty 12 px arrow strip. Still open in Phase 1: the
inset edge (kept until Phase 2), Tahoe row hover, and the `menus off` check. The real desktop is
not changed yet.

### Phase 2: the glass covers the contents, not the frame (BMS patch)

- In `place_dynamic_blur` (and the static path), for `is_app_menu` windows, inset the blur
  rect to the contents box:
  - **Arrow side**: the side of the popup's frame that faces the parent's anchor (compare the
    popup frame with the parent's frame or the pointer position). Inset by the tail height from
    Phase 0.
  - **Other sides**: the uniform contents inset from Phase 0, if there is one.
  - Context menus (`has-arrow` false, Files' right-click) need no arrow inset. Detect this as "no
    strip": the frame matches the contents size from Phase 0, or the popup sits at the pointer
    rather than flush with a widget.
- Re-place the blur on the popup's `size-changed` / `position-changed` so submenu slides keep the
  card matched.
- Check: Inspector overlay of the contents box against a screenshot of the card. Corners must be
  concentric, with no glass in the arrow strip.

### Phase 3 (fallback, only if Phase 2's heuristics misfire): the menu's own shape as the mask

- Give `contents` an almost-invisible fill (`rgba(0,0,0,0.01)`) and mask the blur with the
  popup surface's alpha in the pipeline shader (the window texture as a second layer:
  `glass where alpha > 0`). The glass then follows whatever GTK draws: arrow, corners, odd
  shapes, GTK3 menus, Firefox/Electron menus. This costs more (an extra texture sample per
  menu), but it ends the geometry guessing.
- Decide at the end of Phase 2. Pick this only if the inset rules need per-app exceptions.

### Phase 4: the rest of the menu family

- **GTK3 menus** (`gtk3_glass`): they are popup windows too, so the same geometry check applies.
  The `decoration` shadow margin is in the buffer, not the frame. Verify the inset is zero.
- **GTK3 popovers** are drawn inside their window, so no blur is possible. Keep the opaque
  `popover_bg` token for them (already the case) and note it in `liquid-glass.md`.
- **Tooltips**: decide whether they get glass (Tahoe: yes, small) or stay solid.
  `window.tooltip` is already excluded in GTK3.
- **Light mode**: rerun every check with `glass-bar.sh mode light` (dark text, brighter rim).

### Phase 5: land it

- `tahoe-repair` keeps enforcing it (the `menus: glass;` marker and the `is_app_menu` check are
  already in the uncommitted diff).
- Add a "Menus" row to the layer table in `docs/liquid-glass.md`. Commit per phase: Phase 1 is
  CSS only, Phase 2 is the BMS patch only.

## Phase 2 result (VM, light mode, 2026-10-19)

- **Blur My Shell** (`config/bms-tahoe-glass.patch`, `applications/window_geometry.js` and `index.js`):
  an app menu's glass is placed on the menu box, not the popup frame: GTK's 12 px arrow strip is cut
  off on the side facing the pointer. With the block's contents at `box-shadow: none` the menu is
  flush with the frame on the other sides (the 1 px of Phase 0 came from our old inset-edge shadow),
  so nothing else is cut and the rows sit exactly the menu gap (4 px) in from the glass edge
  (`docs/shots/gtk-popover-inset-corner.png`). That side is read on the
  menu's first real frame, because the window is still 0 × 0 when its glass is created. Context
  menus open at the pointer (0 to 1 px away), so they get no strip cut; a menu button's popover
  sits at least 3 px past the clicked button.
- **CSS** (`gtk_glass`): `popover.background` itself is now clear. The scoped `.background` window
  rule had painted every popover outside Files with the window tint: the square-cornered card
  behind Settings' and Text Editor's menus.
- **Radii**: the card (20) is the contents radius, the row (16) plus the gap (4), from
  `tokens/radius.json`. With the glass on the menu box, the hover capsule sits concentric in the
  card corner.
- Shots: `docs/shots/gtk-popover-phase2-vm.png` (Files ⋯ and right-click, Settings ⋯, Text Editor ☰).
- **Known limits**: GTK tooltips are popups of the same Mutter type, and no window property told
  them apart from menus, so a tooltip below its widget also gets the top cut. The tooltip's own
  opaque box covers its glass, so it does not show today; revisit if tooltips become glass. An
  arrow menu opened from the keyboard while the pointer is elsewhere keeps its strip.
- **App-menu radius (follow-up)**: GTK menu rows are 26 px tall, so a 16 px row radius clamps to
  13, and a 20 px card around it was too round. GTK menus now have their own token,
  `app_menu` {radius 17, gap 4, row 13} in `tokens/radius.json`, and their own Blur My Shell key,
  `applications/menu-corner-radius`. The GTK4 and GTK3 menu CSS read the same token. Shell menus
  keep `menu` (20 / 4 / 16). Shot: `docs/shots/gtk-popover-radius-corner.png`.
