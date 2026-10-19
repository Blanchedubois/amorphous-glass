# Smooth glass popups and open animations: plan

Status: Phases 1 to 4 installed; Phase 5 round 1 (drop, rows, quick settings stagger) installed
after the user's notes. Phase 1 installed on the real desktop (rebuilt from branch `claude/glass-motion-3a54fe`,
not merged into main) and measured: quick settings and its submenus are smooth. Open: frames of
20 to 33 ms while sliding across the top bar between menus (below). Phases 3 and 4 next.

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

### Phase 1 result (headless shell, 2026-10-19)

What changed in `config/bms-tahoe-glass.patch`:

- `components/popup/surface/motion.js` (new): one motion group per popup, keyed on its BoxPointer
  (quick settings submenus, which sit in an overlay beside the BoxPointer, join it through the
  menu's `_boxPointer`; banners on the message tray's banner bin). It starts when one of the
  popup's own transitions starts (BoxPointer opacity, translation, scale; a submenu's height or
  rows' opacity; a banner's position) and ends on the frame where none is left (checked each
  frame, no timer; the panel's dimming keeps it going while it runs). Meanwhile one
  `BEFORE_REDRAW` callback per popup moves every surface: a transform from the geometry of the
  last full update, no geometry walk; signals from ancestors are ignored.
- A surface only runs its full update when it appears, or changes size or clip (a growing
  submenu); such a surface stays live for the rest of the motion, with its textures grown once to
  the view's size instead of by a quarter at each step (`_bms_texture_hold`).
- Freeze (`popup motion-freeze`, default on; replaces `quick-settings-freeze`, which now does
  nothing): while the popup moves, no capture, no blur, no refraction pass. A popup that was hidden
  captures its backdrop once, over its whole rectangle, at the place it comes to rest (the
  BoxPointer's translation and scale taken out), blurs it once at full strength, and only its
  actor's opacity fades. Live again when the motion ends. Banners stay live (they slide in from
  off screen). Frozen surfaces neither cause nor receive cascaded redraws.
- A quick settings piece no longer walks the whole panel's tree looking for transitions.
- A hidden popup keeps its blur textures (a blur at strength 0 freed them, so every open rebuilt
  13 sets of Kawase textures: 9 ms of the first frame).
- Shader warm-up: 4 s after the shell starts, a 48 px glass at 1/255 opacity is drawn for three
  frames under everything, with the menu and app pipelines, so their programs exist.
- `tahoe-repair.sh` keeps `motion-freeze` on.

Measured with `tools/headless/run.sh`: a throwaway headless gnome-shell (`--headless
--virtual-monitor 2560x1440@120`, own XDG dirs, keyfile settings, own D-Bus session) on the RTX 3090,
with the user's Blur My Shell settings and theme, driven by `tahoe-motion-test@local` (opens and
closes each popup five times, logs frame intervals and the `tahoe_prof` counters, screenshots each
popup once it has settled). The real desktop is never touched. Before = the live patch (3513705).

| Scenario | Kind | Frame p95 before → after (ms) | Worst frame | Slow frames in 5 runs | BMS JS per open (ms) |
|---|---|---|---|---|---|
| Quick settings | open | 46.2 → **11.7** | 53 → 30 (first open after start) | 26 → 4 | 198 → **12** |
| Quick settings | close | 60.8 → **9.3** | 61 → 9.7 | 30 → 0 | 267 → **3** |
| QS submenu | open | 45.0 → **10.4** | 55 → 13 | 35 → 0 | 265 → **12** |
| QS submenu | close | 53.4 → **10.1** | 56 → 49 (once, after the motion) | 12 → 0 | 302 → **19** |
| Calendar | open | 9.2 → 9.1 | 17 → 18 | 1 → 1 | 4.5 → 1.7 |
| Desktop menu | open | 9.2 → 8.9 | 9.7 → 9.2 | 0 → 0 | 3.4 → 0.9 |

Still screenshots of quick settings, a submenu, the calendar and the desktop menu once settled:
identical to the before, pixel for pixel (no pixel differs by more than 2/255).

Correction (same evening): the runs above, before and after alike, had the default Blur My Shell
settings (Kawase blur only), because `run.sh` asked dconf for the user's settings after pointing
`XDG_CONFIG_HOME` at the throwaway folder. Fixed; rerun with the user's real glass (refraction
pipeline, Liquid Glass tint, rim and shadow): quick settings open p95 46.2 → 11.9 ms, close
59.5 → 9.4, submenu open 41.7 → 10.2, close 50.9 → 9.7, quick settings ↔ calendar switching
58.9 / 43.9 → 9.7 / 11.9; calendar and desktop menu unchanged at 9 ms. Settled screenshots again
identical to the before (the one submenu difference seen came from a sub-pixel layout difference
between runs: the before differs from itself the same way).

Not at the exit criterion yet:
- The first quick settings open after the shell starts has one 30 ms frame: every piece's textures
  are built then. Later opens keep them.
- Quick settings opens still have about one frame in a few at 12 to 13 ms: the first appearance
  of 13 pieces (about 0.5 ms of JS each) and their fresh capture and blur in the same frame.
  Phase 4's staggered pop-in spreads these over several frames; Phase 2 (one shared blur) would
  cut the blur part. Decide after the real-desktop numbers.
- A growing submenu's own glass stays live while it grows (10 ms frames): Phase 3's reveal shape
  lets it freeze at its final size.
- The headless shell paces frames by a timer, not the monitor; the real after needs the desktop.

### Phase 1 result on the real desktop (120 Hz, 2026-10-19, after a logout)

The user opened the menus by hand; probe v3 (`tahoe-repair` had switched the probe off at login:
it now keeps it on). 81 records.

| Scenario | Kind | Runs | Frame p95 before → after (ms) | Worst frame | Dropped / run |
|---|---|---|---|---|---|
| Quick settings | open | 6 | 36.7 → **10.1** | 91 → 22 | 7 → 1 |
| Quick settings | close | 7 | 56.6 → **9.9** | 77 → 32 | 6 → 1 |
| QS submenus (Wi-Fi, Power) | open | 23 | 42.7 → **10.3** | 56 → 96 (once) | 7 → 1 |
| QS submenus | close | 23 | 42.0 → **10.8** | 59 → 58 (once) | 3 → 1 |
| Desktop right-click | open | 2 | 9.3 → 9.6 | 114 → 17 | 1 → 2 |
| Files menus (app dropdown, new) | open | 3 | (none) → 8.8 | 15 | 1 |
| Now Playing menu | open | 2 | (none) → 10.4 | 19 | 2.5 |
| Calendar, Vitals: sliding from one to the other | open / close | 1 to 2 | 9.5 → 14 to 28 | 33 | 9 to 19 |

- Quick settings and submenus: from about a third of frames late to about one frame per open.
  Blur My Shell's JS per open is 9 to 16 ms (was 160 to 260).
- **Open issue: sliding across the top bar** (Vitals → calendar while the first closes). Frames of
  20 to 33 ms come about 150 ms in, after the motion has ended, with the shell's CPU at 2 ms per
  frame, so they are waits (GPU or a sync), not JS. Each such window counts 20 to 30 cascaded
  redraws and about 10 capture blits per frame. The before table has no menu switching to compare
  with, and the headless shell (no Vitals, no Open Bar) does not show it: quick settings ↔ calendar
  switching there is p95 44 to 63 ms before, 9.8 to 11.5 ms after, and also with Vitals, Open Bar
  and the dock loaded (p95 11.4 ms). An A/B on the desktop (`tools/abslide.sh`: frozen, live while
  moving, plain blur, no glass) gave nothing: the probe records no open when a menu is reached by
  sliding from another (only quick settings, then nothing). The user then slid across Vitals, the
  calendar, Now Playing and quick settings by eye: smooth. Left as unexplained; the probe needs to
  record `PopupMenuManager` switches before it can measure this.
- First open after login, dock menus and Settings drop-downs: not in this round.

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

### Phase 3 result (headless shell with the user's glass, 2026-10-19)

- `refraction.glsl`: uniforms `reveal_x`, `reveal_y`, `reveal_width`, `reveal_height`,
  `reveal_radius`, `reveal_feather`. When set, the reveal rectangle and radius replace the glass's
  own bounds and corner radius for everything the shader draws: the refraction band, the rim light,
  the inner shadow, the bottom shade and the anti-aliased edge, so a growing circle is lit and
  shaded glass at every frame. Outside it the glass is transparent. Circle mode (the shader's
  special case for round buttons) is off while a reveal is on, so the rim band does not jump when
  the circle stops being round. A negative width (the default, uploaded at every first paint) is
  the whole surface. No extra texture fetch.
- `RefractionEffect.set_reveal()`, uploaded with cached uniform locations (not through the
  uniform map, which re-uploads every uniform); `DynamicPipeline.set_reveal()`;
  `PopupBlurSurface.set_reveal()` takes the target's own coordinates.
- `globalThis.__tahoeGlass` (version 1), for `tahoe-motion`: `root_of(actor)`, `surfaces(root)`
  (each with its `target`, `corner_radius` and `set_reveal`), `hold(root)` / `release(root)` to
  freeze a popup's glass for an animation of its own. An actor flagged `_tahoe_glass_opacity_free`
  can fade without fading its glass (the content fades, the glass is shaped by the reveal).
- Checked: a full-size reveal and no reveal are identical pixel for pixel; circle, half-grown and
  full stages on the calendar and on each quick settings piece in `shots/reveal-calendar.png` and
  `shots/reveal-quick-settings.png` (the circle has its own rim light and inner shadow).

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

### Phase 4 result (headless shell with the user's glass, 2026-10-19; not installed yet)

`extensions/tahoe-motion@cachyos-tahoe` (`scripts/tahoe-motion.sh on|off|status`, kept on by
`tahoe-repair` while switched on). It wraps `BoxPointer.open/close`, the quick settings submenus'
`open/close` (prototype taken from a live toggle, GNOME 51 does not export it) and the message
tray's banner show and hide, and listens to the window manager's `map` for app menus. One
`Clutter.Timeline` per popup on its frame clock; springs in `spring.js` (open: damping 0.75, about
3 % overshoot, 260 ms; close: critically damped, 160 ms); durations follow GNOME's slow-down factor.
With animations off, reduced motion, or no glass API, GNOME's own code runs.

- **Shape:** each glass surface's reveal goes from a circle to its card, corners from round to the
  card radius. Menus, calendar, dock and desktop menus: the circle is the clicked icon's capsule
  (24 to 48 px, 34 for the desktop menu's pointer), at the point of the card's edge nearest the
  icon. Quick settings: each piece from a circle half its height at its own centre, 12 ms apart,
  nearest the clicked icon first. Submenus: from the toggle's capsule, widening while the height
  opens on the same spring (the pieces below slide with it); GNOME's height ease and row fade are
  replaced. Banners: from a capsule at their top centre. App menus: from the pointer, pinned to the
  facing edge.
- **Content** (user's choice mid-way: morph with the glass rather than fade): the whole target,
  its own fill and edge included (a checked toggle's white fill, the capsules' 1 px line), is
  scaled with one uniform scale that fits inside the shape, centred on it; it fades only over the
  first quarter of the growth. Blur My Shell keeps the glass at rest under the scaled target
  (`_tahoe_glass_transform_free`: the target's own scale and translation are taken out while the
  glass is placed) and ignores the target's fade (`_tahoe_glass_opacity_free`).
- The popup's opacity fades over the first and last fifth, so the circle neither pops in nor out.
- Interrupting (reopening while closing, a banner dismissed while coming in) continues from where
  the shape is.
- **Cost:** frame times as Phase 1: quick settings open p95 11.6 ms, close 9.7, submenus 10.9 /
  10.3, calendar 8.8, desktop menu 8.8.
- **Not covered:** closing app menus (their windows are destroyed at once; animating it means
  taking over GNOME's window-destroy handling), and app menus are not tested headless (no app to
  click in the headless shell).
- Stills, animation slowed 10x: `shots/motion-calendar.png`, `motion-quick-settings.png`,
  `motion-submenu.png`, `motion-banner.png`.

### Phase 5, round 1: the user's notes after trying it live (2026-10-19 evening)

What the user asked for, after the first install:

1. Quick settings should open top to bottom, its pieces popping in one after another.
2. A dropdown should not just grow outwards with its content: a circle morphs into a bar, then the
   bar opens into the card while the rows pop in one after the other ("scatter and grow"). Not too
   fancy or slow; the morph itself was right, the timing was not.
3. Inside a button (the volume slider especially) the parts should stagger into place, not just
   grow with the glass.
4. The right-click menu should open out of the pointer; the same origin feel for every dropdown.
5. (Added while this was being built) the circle should drop lower and expand into the card;
   the motion should have inertia and be a bit elastic; it should read as a drop falling and
   morphing into the card.

Research behind the numbers: dropdowns open in about 200 to 250 ms and close in 150 to 200 ms,
items stagger 20 to 40 ms apart (below about 30 ms the stagger is not noticed, above about 80 ms it
drags) [dylantarre animation-principles, navigation menus; Emil Kowalski, stagger delays; Flutter
staggered menu cookbook]. Liquid morphs read best as one drop travelling and stretching away from
its source, then spreading into the target, with squash and stretch kept subtle on cards and
stronger on small shapes; content trails its container by 20 to 40 ms [liquid_glass_widgets
LiquidMorphPhysics; dylantarre cards-containers]. Apple's Liquid Glass menus expand from the
button that opens them.

What was built (`extensions/tahoe-motion@cachyos-tahoe`, now `extension.js` for the hooks,
`morph.js` for the choreography, `items.js` for rows and parts):

- **The drop.** A card opens from a glass circle at its origin (the clicked icon's capsule, 24 to
  48 px; an 18 px circle exactly at the pointer for the right-click menu and GTK app menus). The
  circle falls a little way into the card (18 % of its height, at most 40 px) on an elastic spring
  (180 ms, damping 0.58). Its back edge trails its front by 32 ms, so it lengthens as it pulls
  away and narrows to keep its volume; where the spring carries it past its landing point it
  squashes, wider and shorter, then settles round.
- **Bar, then card.** The strokes overlap so the fall's momentum carries on: from 60 ms the drop
  spreads into a bar across the card (230 ms, damping 0.66), from 115 ms the bar opens up and down
  into the card (290 ms, damping 0.64), corners relaxing from round to the card's radius. The
  overshoot is clipped by the card's own bounds, so the elastic is in the stroke and the edge stays
  clean.
- **Rows pop in.** The card's rows and blocks (split while taller than 40 % of the card; a grid
  such as the calendar's days, and buttons, arrive whole) appear as the growing edge reaches them,
  at least 22 ms apart: a quick fade, a scale from 0.9 and a 9 px drop into place on a bouncy
  spring (170 ms, damping 0.55).
- **Closing** reverses it in about 250 ms: the rows fade out together (70 ms), the card folds into
  the bar, the bar into the drop, and the drop rises back into its origin.
- **Quick settings** opens top to bottom: buttons arrive row by row (45 ms per row, 15 ms within a
  row), each growing from a circle at its centre into its capsule (260 ms, damping 0.62). Once a
  button is 30 % grown its parts follow 35 ms apart: icons pop from 0.35 on a bouncy spring, labels
  slide in from 12 px to the left, a slider's track grows from its start.
- **Submenus** grow out of their toggle the same way, without the fall; banners drop from a
  capsule at their top; the card's own 1 px dark-mode edge waits until the card is open
  (`.tahoe-morphing`).
- **The calendar** (user: "stagger the elements in the calendar ... in its own card"): its day grid
  arrives as a card of its own, the days popping in as a diagonal wave, week by week (30 ms a row,
  8 ms a column, the whole wave within 150 ms); the events, world clocks and weather cards step
  in one by one.
- Fixed on the way: a quick settings button hidden before its first layout kept opacity 0 after
  the animation (it saved its state too late); a submenu opened for the first time showed its rows
  without glass for one frame (not laid out yet: now fully hidden until it is).
- Headless, with the user's glass: p95 at or under 11.2 ms in every scenario (quick settings open
  11.2, close 8.9; submenus 10.6 / 10.9; calendar 8.8 / 8.8; desktop menu 8.9 / 8.5), the same as
  before this round. One frame in about 50 animations runs long (20 to 70 ms) with the shell's CPU
  idle; seen with and without the morphing style class; most likely a JS garbage collection.
  Watch for it on the desktop.
- Stills, slowed 12x: `shots/motion2-desktop.png` (from the pointer), `motion2-calendar-drop.png`
  (the drop's fall, close up), `motion2-calendar.png` (rows and the day wave),
  `motion2-quick-settings.png`, `motion2-submenu.png`, `motion2-banner.png`.

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
