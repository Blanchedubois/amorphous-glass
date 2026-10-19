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

## Phase E (needs the user's go-ahead): Material Symbols Rounded

- Needs `MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf` from google/material-design-icons
  (Apache 2.0), installed for the user. Quick settings icons drawn from the font as outlined
  rounded glyphs (FILL 0), filling in (FILL 0 to 1 on an effects spring) as a toggle turns on.
  Switchable on its own; the default stays the current icons.

## Phase F: real desktop

- Install (`tahoe-motion.sh on`, logout), the user tries it, the probe measures the after; tune
  by eye from the user's notes.
