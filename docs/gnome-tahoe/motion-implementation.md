# Motion implementation: liquid, spring-driven glass

The plan that follows from `motion-workshop.md`. Everything is in
`extensions/tahoe-motion@cachyos-tahoe` (the Blur My Shell patch already exposes what is needed:
reveal shape, frozen backdrop at rest, glass that ignores the target's own fade and transform).
Each phase is tried in the headless shell (`tools/headless/run.sh`) with stills and frame times,
committed, then installed for the user with one logout at the end.

## Phase A: the spring engine (`spring.js`)

- `Spring`: position, velocity, target; mass, stiffness, damping ratio (M3 / anime.js semantics).
  Advanced by real elapsed time with the exact solution of the damped oscillator from the current
  position and velocity (under-, critically and over-damped cases), so frame drops do not change
  the motion. `settled` when |x - target| < 0.001 of the travel and |v| small. `retarget(t)` keeps
  the velocity.
- Tokens: `EXPRESSIVE.spatial.{fast,default,slow}` = (0.6, 800), (0.8, 380), (0.8, 200);
  `EXPRESSIVE.effects.{fast,default,slow}` = (1, 3800), (1, 1600), (1, 800); a `LIQUID` mass of
  1.15 for the glass body.
- `stagger(index, count, { base, ease, from })`: anime.js-style eased stagger delays.
- `speedFor(width, height)`: fast below 200 x 200, default up to 600 x 500, slow above.
- Result (`tools/headless/spring-test.js`): spatial fast overshoots 9.4 % and settles in 400 ms,
  default 1.5 % / 467 ms, slow 1.5 % / 617 ms; effects 0 % / 175, 250, 342 ms (with the liquid
  mass 1.15, about 5 % slower); a retargeted spring keeps its velocity (6.29 before and after);
  the path is the same at 120 and 30 Hz.
- Exit: a GJS self-test prints each token's overshoot and settle time (spatial fast should
  overshoot about 9 to 10 %, default and slow about 1.5 %, effects 0 %), and a retargeted spring
  keeps its velocity.

## Phase B: the liquid card (`morph.js`, `CardPiece`)

- **One body, four edges.** The glass shape is four edge springs (left, right, top, bottom) plus a
  radius spring. Stage 1, the drop: the edges hold a circle around a falling centre (centre on a
  spatial spring), stretched along the fall and narrowed across it by the centre's velocity
  (volume kept). Stage 2 starts when the fall has covered 55 % of its way: the edges retarget to
  the card, the leading edge (away from the origin) on a stiffer spring than the trailing one, the
  sides in between, each starting from its current velocity. The radius stays round (a slow
  effects spring) and relaxes to the card's radius as the edges settle.
- **Elastic settle.** The popup itself (BoxPointer, banner bin) grows from 0.92 to 1 about the
  origin on an expressive spatial spring: it overshoots to about 1.02, and its width and height
  wobble out of phase (the height a little short while the width is long), then settle.
- **Rows.** Each row starts when the edge reaches it, but no sooner than the eased stagger allows
  (base 50 ms, eased `inQuad`, the whole spread capped at 240 ms); it rises 16 px and grows from 0.85 on a spatial spring (fast in small
  menus, default otherwise), its fade on an effects spring.
- **Close.** Retarget everything back: rows fade together (effects fast), the edges gather to the
  drop (no overshoot: critically damped spatial), the drop rises into its origin and fades.
- Exit: headless stills (slowed) show drop, liquid spread and the overshoot-settle; frame times as
  before (p95 under 12 ms); no snap at the end of any stage.

### Phase B result (headless, 2026-10-19)

Built as planned with one change, found in the stills: the elastic overshoot is carried by
scale, not by the shape's edges. A shape's edge cannot pass its glass, so an edge spring that
overshoots stops dead at the boundary. The edges now settle smoothly (damping 0.9), and the
popup (BoxPointer, banner bin, app menu window) grows from 0.86 about its origin on an elastic
spring (damping 0.55), overshooting by about 2 %, its height giving way while its width is past
its size (jelly). Rows also wait until the glass is 85 % wide, so text never shows outside it.
Stills: `shots/motion3-calendar.png`, `motion3-desktop.png`.

## Phase C: quick settings, liquid and staggered

- Buttons arrive top to bottom with an eased stagger (70 ms between rows, 20 ms within a row);
  each is a small drop at its centre spreading into its capsule on the four-edge springs (the
  horizontal edges lead), with a small out-of-phase wobble as it settles.
- Inside each button the parts follow with an eased stagger (50 ms): icon pops (spatial fast),
  labels slide 16 px, a slider track grows from its start.
- Submenus: the toggle's capsule is the starting shape; the card pours down out of it (the bottom
  edge leads), the buttons below move with the submenu's height on the same spring.
- Exit: stills, frame times.

### Phase C result (headless, 2026-10-19)

A button is one liquid body: glass, fill, edge and content scale together (no reveal shape), its
width on a spatial fast spring and its height on spatial default, from a round blob 55 % of its
height. It widens ahead of growing taller and wobbles as the two settle out of step. (A first try
kept the glass on its own edge springs: the button's outline and parts reached full size before
its glass did.) The glass fades with the button; the panel itself does not fade. Blur My Shell
patch: a surface whose glass is fully faded no longer runs a full update on every frame (it did
260 updates per close). Buttons arrive in rows on an eased stagger (about 70 ms between rows,
20 ms within one), parts 50 ms apart. Stills: `shots/motion3-quick-settings.png`.

Frame times with the user's glass, p95 (max): quick settings open 9.9 (13.7), close 9.0 (9.8);
submenus 8.9 / 8.6; calendar 8.6 / 8.5; desktop menu 8.5 / 8.5; menu switching 9.0 / 9.5.

## Phase D: icon effects (with the current icons)

- **Bounce** on press: a quick-settings button's icon dips to 0.8 and springs back past 1 on
  spatial fast.
- **Replace** when a toggle turns on or off, or its icon changes: the icon shrinks to 0.6 and fades
  (effects fast) and grows back with the new state on spatial fast.
- Applied by watching the live quick settings toggles (`clicked`, `notify::checked`,
  `notify::icon-name` / `notify::gicon`); nothing else changes.
- Exit: stills of a toggle switching, no extra cost when nothing is pressed.

### Phase D result (headless, 2026-10-19)

`icons.js`: quick settings buttons are watched when the panel opens. Bounce gives the icon a push
(a velocity of -7 per second on spatial fast); Replace shrinks it to 0.55 and fades it to a quarter
(critically damped), then grows it back on spatial fast: measured, slowed 10x, it dips to 0.59 /
opacity 68, overshoots to 1.04 and settles, about 300 ms in real time. Icons that change on their
own get a small push at most every 400 ms. No effects while the panel itself is animating.

## Phase E (needs the user's go-ahead): Material Symbols Rounded

- Needs `MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf` from google/material-design-icons
  (Apache 2.0), installed for the user. Quick settings icons drawn from the font as outlined
  rounded glyphs (FILL 0), filling in (FILL 0 to 1 on an effects spring) as a toggle turns on.
  Switchable on its own; the default stays the current icons.

## Phase F: real desktop

- Install (`tahoe-motion.sh on`, logout), the user tries it, the probe measures the after; tune
  by eye from the user's notes.

## Round 2: the user's notes after trying it (2026-10-19 night)

1. "Looks great, just a bit slow ... too silky": everything one step faster. Cards use M3's
   spatial **fast** spring up to 600 x 500 px and default above (was default and slow); mass 1
   (was 1.15); the popup's elastic grows from 0.9 on damping 0.6 / stiffness 700 (was 0.86 on
   0.55 / 380); rows 30 ms apart, the whole stagger within 150 ms (was 50 / 240); quick settings
   rows 45 ms apart within 200 ms (was 70 / 320), parts 35 ms; the drop falls at most 32 px and
   spreads at 40 % of its fall.
2. "Opening Wi-Fi, Bluetooth or Power glitches": the submenu's height still followed the old
   progress value, which the liquid card no longer has: the height went to NaN (full at once),
   the buttons below jumped and their glass lagged a frame (ghost capsules). The height now
   follows the glass's poured edge; the card also gathers back into the toggle's own capsule (it
   gathered into a square). Stills: `shots/motion4-wifi-submenu.png`.
3. "Skimming the menu bar, the previous liquid glass collides with the next": GNOME opens and
   closes with a fade-only flag when the pointer slides from one menu to the next
   (`PopupMenuManager._changeMenu`). Those now hand over instead of morphing: the menu being left
   fades out on an effects spring (gone in about 50 ms), the next one is there at once, fading in
   from 35 % with a light elastic settle from 0.96 about its icon. The full pour stays for a
   click. Two liquid bodies never meet.
4. Material toggles, from material-web's switch (`switch/internal/_handle.scss`: the pressed
   handle changes size over 100 ms, the handle travels with an overshoot easing over 300 ms,
   colours over 67 ms): while a quick settings button is held, the whole button (glass included)
   gives a little, wider and shorter (1.035 x 0.92, critically damped, about 100 ms), and springs
   back past its size on release (spatial fast); the on / off fill crossfades (St
   `transition-duration: 120ms` in the shell overrides); the icon does its Replace.
5. Fast and slow use, tested headless through GNOME's own menu manager (`skim`: Vitals, calendar,
   quick settings and back, twice; Vitals and Open Bar loaded):

   | Pace | p95 (ms) | Worst | Frames over 12.5 ms |
   |---|---|---|---|
   | fast (a menu every 70 ms), first time in a session | 24.3 | 106.5 | 5 |
   | fast, again | 11.8 | 33.9 | 2 |
   | slow (every 450 ms) | 9.0 | 51 | 0 |

   The first fast skim after the shell starts pays once for quick settings' first open (its
   glass textures, GNOME's own first-open work); the one-time setup of tahoe-motion (23 ms) now
   runs while idle 3 s after the shell starts. Normal opens and closes, p95: quick settings
   9.7 / 9.3, submenus 10.2 / 10.2, calendar 9.0 / 8.6, desktop menu 9.0 / 8.5.

## Round 3: fast hands (2026-10-19 night)

The user's notes: a right-click repeated quickly opened the menu away from the pointer; skimming
the menu bar should still show the liquid animation, partly; "a tiny bit faster", the fade-out
faster; spamming a menu open and closed. Their screen was recorded while they skimmed
(`tools/record-screen.js`, GNOME's screencast service, 60 fps) and read frame by frame.

- **The artifact while skimming** (from the recording): the menu being left was still fading out
  (glass and rows at partial opacity) while the next one faded in over it; at skimming speed two
  or three translucent menus stacked for several frames. Now the menu left behind stays up for
  exactly the two frames the next one needs for its layout, then goes at once; the next one is
  fully opaque from its first frame and its pour only partly plays (it starts 55 % poured, the
  rows 12 ms apart, quick settings' row delays at 30 %). Never two menus, never a blank frame
  (stills: `shots/motion5-skim-handover.png`, each pair right after a switch and 30 ms later).
  Sliding back within those two frames keeps the menu.
- **The right-click away from the pointer** had two causes. The menu was opened while its close
  still played; and, measured, reading the source's place on screen as the menu opened made
  Clutter lay the stage out early, placing the menu at the previous pointer (one click behind,
  every time; GNOME alone places each one right). The origin is now read once the menu is laid
  out (frame two); the "same place?" check for a menu reopened while closing compares the
  source's own coordinates. A menu reopened while closing counts as closed: somewhere else it
  starts afresh there, at the same place it turns round from where its shape is (spamming).
  Stills: `shots/motion5-rightclick-spam.png`.
- **Faster:** card edges 15 % stiffer than M3's fast spatial; the popup's elastic from 0.92 at
  stiffness 900; rows 24 ms apart within 120 ms; quick settings rows 38 ms within 170 ms, parts
  28 ms. **Closing faster:** the fold, the rise and the buttons 50 % stiffer, the rows fade on a
  6000-stiffness critically damped spring, the elastic shrink on spatial fast.
- Headless, p95 (worst): skimming fast after the first time 12.6 (18.2), slow 8.9 (22.4);
  spamming the calendar every 60 ms 9.6 (29.0); right-clicking every 90 ms at new places 8.6
  (9.7); quick settings 9.7 / 9.3; submenus 9.4 / 10.6; calendar 8.7 / 8.6; desktop menu 8.9 / 8.5.
  The first fast skim of a session still pays once for quick settings' first open.
