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
| An inner rounded box with its own lighter fill and edge sits inside the card | The contents still paint something: a fill from a rule the block does not outrank (libadwaita's `--popover-bg-color` path, the `contents:backdrop` or `.menu` variants, or the theme's `0 0 0 1px @headerbar_darker_shade_color` shadow ring), plus our own inset edge drawn on top of the pipeline's rim. Two rims, two shapes. |
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

### Phase 1: one fill, one rim (CSS only)

- Make the block's popover rules win over whatever Phase 0 found. Scope them to
  `popover.background > contents` *and* the libadwaita variable (`--popover-bg-color:
  transparent` on `popover`), and clear the theme's `box-shadow` ring (`box-shadow: none`).
- Drop our inset edge on `contents`, since the glass pipeline already draws a rim. Keep it only
  if Phase 2 cannot make the shapes coincide.
- Rows: Tahoe's hover is a soft white lift (white 0.10 dark / black 0.06 light), not the accent
  blue. Use 16 px rows (20 px card − 4 px padding) and make separators the same hairline as the
  shell menus.
- Check: with the glass off (`glass-bar.sh menus off`), the menu must be fully clear except
  its text. That proves GTK paints nothing of its own.

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
