# Lock and login screens: one Liquid Glass with the desktop widgets (workshop, 2026-10-20)

The user, after the first real look at both screens in dark mode: the outline is too thick on
every card (widgets, account rows); the glass looks low resolution and pixelated; it should match
the desktop widgets; "Not listed?" is not aligned or symmetrical; the top-right menu's buttons look
off and are not Liquid Glass; the clock dark or plain clear blur; double-width widgets; every
button tested and compared with the widgets. Work in phases, each workshopped with shots.

## Findings (evidence in docs/unified/consistency/)

### 1. Two different glass recipes

| | Desktop widgets (docs/STANDARD.md, Blur My Shell) | Lock and login screens today (glass.js shader) |
|---|---|---|
| Backdrop | frosted: wallpaper blurred (menus 18, widgets similar) | clear: 0.5 px softening only |
| Edge | 1 px white line, 16 % in dark | 2 px bright line + 5 px glow at 35 % |
| Rim light | 0.55 over 0.45 of the edge band, soft | strong, top-left |
| Bend (refraction) | small | 9 px at the edge, 10 px bevel |
| Tint (dark) | rgb 34,34,38 at 0.42 | the same (dark look) |
| Edge shadow | 0.30 over 0.20 of the band | 0.05 |

`corners-desktop-lock-login-4x.png`: desktop weather card, lock weather card, login account row,
same corner at 4x. The desktop edge is a hairline; ours is a thick lit band.

### 2. "Low resolution and pixelated": the clear glass shows the wallpaper's grain

- The wallpaper is fine: `fold-d.jxl` is 4096 px, 16 bit; display scale 1 (monitors.xml).
- GNOME's fold wallpapers carry a deliberate film grain. Through clear glass (no blur), with the
  9 px bend magnifying the edge band and the contrast/saturation of the glass, that grain reads as
  pixels. The desktop widgets blur the wallpaper (frosted), which hides it.
- Checked and ruled out: texture filtering of the glass's own copy (smooth vs default sampling
  changes nothing visible in the bend band), the login picture's dither (no grid; the grain is the
  wallpaper's own).
- So the fix for "pixelated" and for "consistent with the widgets" is the same: frosted glass.

### 3. "Not listed?"

Measured (2560x1440): the rows span x 1116 to 1443 (centre 1280); "Not listed?" spans 1102 to 1218:
left-aligned, and 14 px left of the rows' edge. `not-listed-now.png`.

### 4. The top-right menu (system menu)

On the login screen its toggles are flat translucent fills on one frosted pane; on the desktop each
toggle is its own glass capsule with the 1 px edge (and on Super+L too, via Blur My Shell). So the
login screen's menu looks unlike both. `menus-now.png`.

### 5. Every button and menu, per screen

| | Login screen | Super+L |
|---|---|---|
| Account rows | glass capsules (thick edge) | - |
| Not listed? | glass capsule, misaligned | - |
| Back arrow | glass circle | glass circle (shown when GNOME shows it) |
| Next arrow (inside the field) | GNOME's own circle | GNOME's own circle |
| Password field | glass capsule, thin edge | glass capsule, thin edge |
| Session gear (after picking a user) | glass circle (not yet seen in a shot) | - |
| Accessibility (bottom right) | glass circle | - |
| Switch User | - | glass capsule |
| Top-right status pill (panel) | GNOME's pill, not glass | GNOME's pill, not glass |
| Calendar menu | frosted pane, light day buttons | - (GNOME has no clock menu while locked) |
| System menu | frosted pane, flat toggles | frosted pane + per-toggle glass |
| Accessibility menu | frosted pane, flat toggles | - |
| Music card | glass (thick edge) | glass (thick edge) |
| Widgets | glass (thick edge) | glass (thick edge) |
| Clock | clear glass digits | clear glass digits |

## Phases (each: build in the test shells, shots of both screens next to the desktop widgets at
1x and 4x corners, the user picks, then the next phase)

### Phase A: the desktop widgets' glass on both screens (the main fix)

One material for every card, row, capsule and menu, from docs/STANDARD.md and tokens/glass.json:
frosted backdrop (blur 18), dark tint 34,34,38 at 0.42, 1 px white edge at 16 %, the soft rim light
and edge shadow, a small bend. Workshop: 3 variants on the same widget, row and capsule, each next to
the desktop widget:
- A1 frosted, no bend (closest to the desktop widgets);
- A2 frosted with a 3 px bend (a touch of liquid at the edge);
- A3 frosted with today's bend (9 px) but the hairline edge.
Gate: 4x corners of every surface on both screens, no grain visible at 1x.

### Phase B: the clock

Two variants next to each other: dark glass digits (the Phase A material on the glyphs), or plain
clear blur (frosted, no tint, no rim: the digits as a window onto the blurred picture).

### Phase C: buttons and alignment

- "Not listed?" centred under the rows, the same capsule height as the back button's circle row,
  symmetric padding (measured: equal space left and right of its text).
- Every button from the table above: same material and edge, concentric with what holds it;
  the top-right status pill as a glass capsule; the next arrow as a glass circle inside the field
  (concentric: field radius minus the gap).
- Gate: a measured table (each button's box, its text box, left/right and top/bottom gaps) on
  both screens; hover and pressed shots.

### Phase D: the system menu and other menus

- The login screen's system menu as the desktop's: each toggle, slider and round button its own
  glass capsule (the same per-piece approach as Super+L's, with our shader instead of Blur My
  Shell, which the login screen does not have), on the frosted menu pane; submenus (Wi-Fi, Power
  Mode) at the standard's 32 radius, rows 16.
- The accessibility and keyboard menus the same; the calendar's day buttons per the standard
  (calendar 32, cards 20).
- Gate: every toggle on and off, every submenu open, on both screens, next to the desktop's.

### Phase E: double-width widgets

The desktop has medium (2 x 1, 356 x 170) widgets: Weather with the hourly forecast, Calendar (day +
month), Clock (digital + analogue), Music. Options for the column (left side, as iPad):
- E1: Weather medium on top, the month small under it (stays one column wide at the top);
- E2: Weather medium + Calendar medium (day and month), stacked, two rows of 356;
- E3: a 2 x 2 grid of smalls (weather, month, clock, world time).
Calendar events stay hidden (the user's rule); fit rules for small monitors (fall back to smalls).
Gate: every monitor size from 1280x720 to 3840x2160, both screens.

### Phase F: check everything together

Both screens side by side with the desktop widgets; every surface at 4x; the fault, churn,
music-idle and verifying gates; then install (lock screen: `scripts/tahoe-lockscreen.sh on`;
login screen: `scripts/gdm-theme.sh install`, the user's sudo).

## Phase A results (2026-10-20, test shells)

Built: the desktop widgets' edge model in the glass shader (glass.js `desk`: inner edge shadow,
rim light, 1 px hairline anti-aliased over a whole pixel, darker toward the bottom), the desktop's
dark tint, and a frosted backdrop (GNOME Shell's blur, radius 18, one shared copy per backdrop,
read by every pane). The old edge's line is now anti-aliased over a whole pixel too (it stepped
on curves). Variants by `TAHOE_GLASS_VARIANT` in the test shells only (installed screens unchanged
until the user picks): A1 no bend, A2 3 px, A3 9 px.
Sheets: `phaseA-weather-1x.png`, `phaseA-corner-4x.png` (desktop widget, today, A1, A2, A3),
`phaseA-row-3x.png`, `phaseA-screens.png`. No errors in any variant on either screen.
- The user's pick (2026-10-20): A1 (frosted, no bend) on both screens; now the default in glass.js.

## Phase B workshop (2026-10-20)

Clock variants on the login screen (`TAHOE_CLOCK_VARIANT`, the same type, size and place as
Super+L's clock): B1 dark glass (the cards' A1 glass on the glyphs: frosted, dark tint, hairline,
rim light) and B2 clear blur (the picture blurred through the digits, a little lighter, no tint,
only the hairline), next to today's clear glass. Sheets: `phaseB-clock.png`, `phaseB-clock-3x.png`.
The pick then goes on Super+L too (its clock is drawn by glassclock.js today).
- The user's pick (2026-10-20): B2 clear blur on both screens. The clock's panes are one module
  now (tahoe-gdm clockpanes.js, an exact copy in the lock screen's widgets/): Super+L no longer uses
  glassclock.js. `phaseB-both-clocks.png`: Super+L and the login screen, the same.
