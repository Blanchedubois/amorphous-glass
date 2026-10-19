# Smooth glass popups and open animations: plan

Status: answers in (see "Decisions" at the end), Phase 0 measured (freeze off), Phase 1 in progress
in the `claude/glass-motion-3a54fe` worktree. Nothing installed.

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

### Phase 0 result: the before (real desktop, 120 Hz, freeze off, 2026-10-19)

From the probe session of 19:46 to 20:43 (the user opening the menus by hand; 222 records in
`~/.cache/tahoe-probe.jsonl`). Each record is the 700 ms after an open or the 450 ms after a close.
"Slow frames" counts frames over 12.5 ms (1.5x the 8.3 ms period) in the first 300 ms.

| Scenario | Kind | Runs | First frame ms | Frame p50 | Frame p95 | Worst frame | Dropped / run | Slow frames | BMS JS (`surface.update`) per open, ms |
|---|---|---|---|---|---|---|---|---|---|
| Quick settings | open | 19 | **32.7** | 8.3 | **36.7** | 91 | 7 | **32 %** | **210** |
| Quick settings | close | 19 | **36.3** | 8.4 | **56.6** | 77 | 6 | **36 %** | **257** |
| QS submenu (Wi-Fi, Power) | open | 8 | 7.0 | 8.3 | **42.7** | 56 | 7 | **27 %** | **217** |
| QS submenu | close | 8 | 3.9 | 8.3 | **42.0** | 59 | 3 | 6 % | 159 |
| App indicator menus | open | 23 | 7.6 | 8.3 | **31.7** | 73 | 6 | 10 % | **195** |
| App indicator menus | close | 23 | 9.3 | 8.3 | 14.7 | 73 | 3 | 10 % | 126 |
| Calendar | open | 15 | 4.2 | 8.3 | 9.5 | 88 | 2 | 3 % | 10 |
| Calendar | close | 15 | 5.0 | 8.3 | 9.5 | 56 | 0 | 2 % | 5 |
| Vitals menu | open | 14 | 4.4 | 8.3 | 9.7 | 73 | 2 | 3 % | 20 |
| Desktop right-click | open | 21 | 2.8 | 8.3 | 9.3 | 114 | 1 | 1 % | 7 |
| Desktop right-click | close | 21 | 2.8 | 8.3 | 9.5 | 60 | 1 | 3 % | 6 |
| Window menu | open | 9 | 5.7 | 8.3 | 9.7 | 18 | 1 | 3 % | 5 |
| Dock icon menu | close | 1 | 3.8 | 8.3 | 8.9 | 15 | 1 | 3 % | 5 |

Freeze on: not measured yet (asked).

What the numbers say:

- **The stall is Blur My Shell's JavaScript, not the GPU.** Quick settings opening runs about 137
  `surface.update` calls at about 1.1 ms each (210 ms in all) during the 150 ms slide, so its first
  four or five frames take 31 to 41 ms each (raw: 50, 36, 42, 36 ms ...). These updates run in
  `BEFORE_REDRAW` laters, before the probe's `before-update` mark, which is why the probe's own
  "CPU per frame" column (2 ms) missed them. All the GPU-side work together (capture blits, Kawase,
  refraction) is under 0.6 ms per frame.
- The cost per update is the geometry and transition walk: on a geometry change each surface calls
  `transitions.complete_state()`, which walks **every descendant** of its target and root actor
  looking for running transitions; for a quick settings piece the root is the whole panel, so the
  13 to 15 pieces each walk the whole panel tree, several times per frame (one update per signal).
- Menus with one glass surface (calendar, desktop menu, Vitals, window menu) are already smooth at
  p95; their single worst frames (56 to 114 ms) are one-off hitches, most likely first paints
  allocating textures and linking shaders.
- The freeze key cannot fix this: it stops re-blurring but every piece still runs `update()`.

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

### App dropdowns (scope added 2026-10-19 evening, user: "the animation should apply to dropdowns aswell")

GTK4 popovers and popover menus (Files' ⋯ and right-click menus, header bar menus), GtkDropDown
lists (Settings) and GTK3 popup menus. They are Wayland `xdg_popup` windows of their own, glassed
by the patch's `is_app_menu()` path in `components/applications/` (not by the popup component),
so none of the BoxPointer work above reaches them.

- **Today:** GNOME 51's `WindowManager._mapWindow` animates only normal windows and dialogs; menu,
  dropdown, popup-menu and combo windows map and unmap at once (no fade). So they cannot be choppy
  in motion; the risk is the first frame: every popup is a new window, so the patch builds a new
  glass pipeline (capture, Kawase levels, refraction target) for each one.
- **Phase 0:** probe v3 (`tools/tahoe-probe@cachyos-tahoe`) also records these windows on the window
  manager's `map` and `destroy` signals, labelled `app:<app id>:<window type>`. Needs a measuring
  round on the real desktop (the user opens Files ⋯, Files right-click, a Settings drop-down, a GTK3
  context menu). User's choice: no separate before for these; probe v3 loads with the Phase 1
  logout and records their after (GNOME does not animate them today).
- **Phase 1:** reuse the app-menu glass pipeline between popups (a small pool keyed by size class)
  instead of building one per window; warm its shaders at startup with the shell's.
- **Phase 3:** the reveal shape is the same refraction uniforms, on the app-menu pipeline.
- **Phase 4:** `tahoe-motion` hooks the window manager's `map` / `destroy` for these window types
  (only when `is_app_menu` is true), drives the window actor's content (opacity, scale from 0.96)
  and the glass reveal on the same spring, and calls `completed_map` / keeps the actor for the close.
- **Where the circle starts:** Mutter keeps the popup's anchor rectangle (the clicked widget, from
  `xdg_positioner`) private; JS gets only the popup window, its parent and the pointer. User's choice
  (2026-10-19): start the circle at the pointer when the popup opened from a click
  (the pointer is on the clicked widget), clamped to the popup edge that faces it (the arrow side:
  the edge nearest the pointer, usually the top); with the keyboard, from the middle of that edge.
  Circle size fixed at a header-button capsule (about 34 px), since the widget's size is unknown.

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

## Decisions (user, 2026-10-19; final)

1. "Control Center" is GNOME's quick settings panel. The Tahoe Control Center extension stays off.
2. Style: the circle morph only. A glass circle the size of the clicked icon's capsule pops out
   under the icon and grows into the card, corners relaxing to the card radius; the content fades
   in and scales from about 0.96 once the shape is about 60 % open. Close morphs back into the
   icon, faster. No macOS-fade alternative.
3. Feel: a slight springy overshoot, fast: about 260 ms open, 160 ms close.
4. The blurred backdrop is frozen for the quarter second of the animation (to be pointed out
   when showing results).
5. Scope: top bar dropdowns, app dropdowns (GTK popovers, popover menus, drop-down lists, GTK3
   popup menus; added later the same evening), the quick settings panel (pieces pop in with a small stagger), QS
   submenus (the card grows out of its toggle, rows below slide on the same spring), dock icon
   menus, the desktop right-click menu, notification banners. Reduced motion (GNOME animations
   off) = appear at once.
6. Where: Phases 1 to 3 in the Blur My Shell patch; Phase 4 in a new `tahoe-motion@cachyos-tahoe`
   extension that can be switched off on its own.
7. Extra Phase 1 items: capture once at the final geometry, pre-allocate textures at the final
   size, unfreeze on the transition's `completed` (no timer), warm the shaders at startup so the
   first open does not hitch, no per-frame JS allocations.
