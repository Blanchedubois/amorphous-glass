# Smooth glass popups and open animations: plan

Status: plan only, waiting on the user's answers (end of this file). Nothing installed.

## What the user asked

Opening the quick settings panel ("Control Center"), its Wi-Fi and Power submenus, the calendar
and the other top bar menus is choppy. Make it smooth, and add opening animations, for example a
circle that pops out of the clicked icon and grows into the dropdown card.

## Why it is choppy today

Read from the installed Blur My Shell v76 + `config/bms-tahoe-glass.patch` (2026-10-19):

1. **Every glass piece is its own live pipeline.** Each popup glass surface is a `DynamicPipeline`
   (`render/dynamic_surface.js`): a `BackdropCaptureEffect` that blits the framebuffer behind it on
   every paint, then Dual Kawase blur, then the refraction shader (now also rim light and edge
   shadow). Quick settings without a card means one pipeline per toggle, slider and system button:
   roughly 15 to 20 captures, 15 to 20 blurs and 15 to 20 refraction passes per frame while it is open.
2. **The open animation makes all of them redo everything, every frame.** GNOME's `BoxPointer`
   opens a menu by easing opacity and a translation along the arrow side (about 150 ms). Each
   surface listens to `notify::opacity`, `notify::translation-*`, `notify::allocation` on the target
   and all its ancestors (`surface/signals.js`) and re-runs `update()` before each redraw: geometry
   walk, placement, opacity fade, and a full re-capture because the actor moved.
3. **Submenus resize the glass.** The Wi-Fi and Power submenus grow in height over about 200 ms and
   push every piece below them down. A blur whose size changes re-allocates or clears its texture
   (`ensureFramebuffer` in `render/backdrop/capture.js`), and every piece that moved re-captures.
4. **Damage cascades.** When a capture does not cover its whole rectangle, `queueBackdropRedraw`
   (`render/backdrop/damage.js`) queues a redraw of every glass surface overlapping it, transitively.
5. **Frame budget.** The monitor runs at 120 Hz (2560x1440, VRR modes available up to 200 Hz): 8.3 ms
   per frame for the whole shell. Twenty full-pipeline passes plus JS geometry work per frame on the
   main thread misses that during the animations, even on an RTX 3090; the GPU is rarely the limit,
   the shell's single main thread is.

Already in place from the earlier speed-up session (qs-perf): the `quick-settings-freeze` key
(pieces keep their blur while the panel moves, refresh 160 ms after it settles) and frame counters
in `conveniences/tahoe_prof.js` read by a temporary `tahoe-probe@cachyos-tahoe` extension. The key
is currently **off** on the real desktop and no probe log exists, so there is no measured baseline yet.

## The idea

An animation should never change the blurred texture. Capture and blur the backdrop **once, at the
popup's final size and place, just before it appears**; then animate only a cheap shape mask
(a signed-distance "reveal" shape inside the refraction shader) and the content's scale and opacity.
Per frame the GPU runs one composite shader per surface; nothing is captured, blurred or
re-allocated, and the JS side does no geometry walks. The glass goes live again once the animation
settles. This is also what makes the circle-to-card animation possible: the circle is just the
reveal shape with its corner radius at half its size.

## Phases

Each phase is built and screenshotted in the VM first, measured on the real desktop only with the
user's go-ahead, and shipped through `glass-bar.sh rebuild` plus a logout.

### Phase 0: measure (no visible change)

- Re-use the qs-perf probe: per open/close, log frame intervals from `global.stage` `after-paint`
  timestamps, dropped frames (interval > 1.5x refresh), and the `tahoe_prof` counters (captures,
  blits, Kawase renders, `surface.update` time, cascades).
- Scenarios: quick settings open/close, Wi-Fi submenu, Power submenu, calendar, an app indicator
  menu, the desktop right-click menu, a dock icon menu. Five runs each, freeze off and on.
- Output: a table in this file (median and worst frame time per scenario). This is the before.
- The user opens the menus; I do not drive the shell with synthetic input (it misfired before).

### Phase 1: make the existing animations smooth (looks the same)

1. **Freeze on open and close, for every popup.** Generalise `quick_settings_motion` into a
   popup-wide "settling" state: when a BoxPointer starts opening or closing, or a quick settings
   submenu starts expanding, all its surfaces stop capturing (`set_live(false)`) and go live
   after the transition ends (not a fixed 160 ms timer: listen for the transition's `completed`).
2. **Capture once at the final geometry.** On `open-state-changed(true)`, compute each surface's
   final rectangle (the allocation without the BoxPointer translation) and capture there. While the
   menu slides, the texture moves with the actor, not re-captured.
3. **No re-allocation during resize.** For a growing submenu, allocate the texture at the final
   size up front (we know it: the menu's preferred height), and draw a sub-rectangle while it grows.
4. **Cut the JS per frame.** While a surface is settling, ignore `notify::*` on ancestors and run one
   transform update per frame from a single frame-clock callback for the whole popup, not one
   `BEFORE_REDRAW` later per surface per signal.
5. **Stop the cascade between frozen surfaces**: frozen surfaces neither trigger nor receive
   `queueBackdropRedraw`.
6. Only if Phase 0 shows the GPU side still matters: during the animation, use a lower blur radius
   or a lower Kawase level, restored when live.

Exit criterion: no frame over 8.3 ms in any Phase 0 scenario at 120 Hz, glass identical in still
screenshots before and after.

### Phase 2: shared backdrop for quick settings (only if Phase 1 is not enough)

One capture and one blur of the whole quick settings rectangle; each piece runs only its refraction,
rim and edge shadow on its own sub-rectangle of that shared blurred texture. 20 blurs become 1.
Looks the same because every piece already uses the same pipeline and radius. Bigger change to the
patch, so it waits on Phase 0 and 1 numbers.

### Phase 3: the reveal shape in the shader

- New refraction uniforms: `reveal_rect` (x, y, w, h in the surface's pixels), `reveal_radius`,
  `reveal_feather`. Pixels outside the reveal shape are transparent; the rim light and edge shadow
  follow the reveal shape's edge instead of the surface's, so the morphing shape looks like real
  glass at every frame (lit top edge, shadowed rim) rather than a cropped card.
- Default reveal = the whole surface, so nothing changes until Phase 4 drives it.
- Cost: one extra SDF per pixel, no extra texture fetch.

### Phase 4: the opening animations

A small motion module drives the reveal uniforms and the content actor from one frame-clock
timeline per popup, with a spring (critically damped by default; a small overshoot if the user wants
it). It replaces GNOME's BoxPointer slide-and-fade for glass popups only.

- **Top bar menus (calendar, app indicators, Vitals, Now Playing, the desktop right-click menu):**
  a glass circle the size of the clicked icon's capsule appears under the icon, then grows into the
  menu card while its corners relax from round to the card's radius. The menu's content fades in
  and scales from 0.96 once the shape is about 60 % open. About 260 ms open, 160 ms close
  (the close runs the morph back into the icon, faster).
- **Quick settings panel:** the same morph for the panel's outline, then the existing pieces pop
  in with a 12 ms stagger, each from a small circle at its own centre to its capsule. The layout
  does not change, only how the pieces arrive.
- **Wi-Fi, Bluetooth, Power submenus:** the submenu card grows out of its toggle's capsule (the
  capsule's shape is the starting reveal shape), while the pieces below slide down on the same
  spring. Closing collapses it back into the toggle.
- **Dock menus and notifications:** optional, same mechanism; listed in the questions.
- **Reduced motion:** when GNOME's animations switch is off, popups appear at once, as now.

### Phase 5: tune by eye, then real desktop

Durations, spring stiffness, the circle's start size, and the content fade point, tuned with the
user from VM recordings and then on the real screen at 120 Hz. Re-run Phase 0's measurements as
the after. Ship through `glass-bar.sh rebuild`, apply in the live glass-bar checkout (own lines
only), record in the shared notes, and have `tahoe-repair.sh` keep any new keys.

## Where the code would go

- Phases 1 to 3: `config/bms-tahoe-glass.patch` (popup surfaces, backdrop capture, refraction
  shader). They are inside Blur My Shell's rendering and cannot live elsewhere.
- Phase 4: either more of the same patch, or a separate `tahoe-motion@cachyos-tahoe` extension that
  wraps BoxPointer's open and close and talks to the glass surfaces through a small shared global
  (as `tahoe_prof` does). The separate extension can be switched off on its own; the patch is
  simpler to keep in step with the glass. My preference is the separate extension.

## Out of scope

The menu bar's contents and icons, the quick settings layout, the Tahoe Control Center extension
(stays off), and the glass's look itself (tint, rim, blur), which this plan keeps as it is.

## Questions for the user

1. "Control Center" means GNOME's quick settings panel that is on now, not the switched-off
   Tahoe Control Center extension?
2. Animation style for the top bar menus: the circle-from-the-icon morph, a macOS-faithful
   quick fade and small scale from the bar (Tahoe's own menus do this), or both with a switch?
3. Feel: a slight springy overshoot, or a calm ease with no overshoot? Roughly how fast?
4. Is it fine that the glass behind a popup is frozen for the quarter second of the animation
   (a video playing behind it would pause in the glass only during the open)?
5. Which surfaces besides the top bar menus and quick settings: dock icon menus, desktop
   right-click menu, notification banners?
