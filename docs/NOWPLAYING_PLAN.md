# Now Playing screensaver: plan (Phase 0)

A full-screen "Now Playing" view for the GNOME Shell desktop, opened with a hotkey. It looks like
Apple Music's full-screen lyrics view: the cover and player on the left, live lyrics on the right,
all over the cover's colour swirl, with the time in Liquid Glass at the top. It is the Extra Large
Wide Music widget made into a full screen, and it borrows the lock screen's music mode (swirl
background, glass clock).

Status: **plan only, nothing built.** The questions at the end need answers before Phase 1.

Mockups (made with HTML/CSS in `docs/nowplaying/mock/`, rendered by `render.sh`; the cover is
original CSS art and the lyrics are made up). They show layout and timing. The real glass is the
repo's shader, which bends the swirl; CSS can only blur it.

| | |
|---|---|
| ![with lyrics](nowplaying/mock/out/layout-lyrics-notes.png) | ![no lyrics](nowplaying/mock/out/layout-nolyrics-notes.png) |
| With lyrics | No lyrics: one centred column |
| ![enter](nowplaying/mock/out/enter.png) | ![exit](nowplaying/mock/out/exit.png) |
| Enter storyboard | Exit storyboard |
| ![swap](nowplaying/mock/out/swap.png) | ![tilt](nowplaying/mock/out/tilt.png) |
| Lyrics to no lyrics | Cover tilt |

---

## 1. Design decisions

### Where it lives: a new extension `tahoe-nowplaying@cachyos-tahoe`

It follows the lock screen's approach: the extension carries **exact copies** of the shared
modules in `widgets/`. They are listed in `tools/nowplaying/shared.list`, and
`tools/nowplaying/sync-shared.sh` copies them over. `check-shared.sh` fails on any drift, and the
install script refuses to install a stale copy. It copies these files:
`mpris.js`, `palette.js`, `music.js` (the lyrics view and the transport), `glass.js` (mode only),
`stylesheet.css`, `icons/`, and from tahoe-lockscreen `bgswirl.js` and `glassclock.js`, plus
tahoe-gdm's `glass.js`, the SDF Liquid Glass pane, as `paneglass.js`.

Why not inside tahoe-widgets:
- **Its own on/off switch.** A crash or a GNOME update disables only this extension, never the desktop widgets.
- **Its own repair feature.** It gets its own entry and state key.
- **It matches the lock screen,** which already ships this way.

The cost is a second MPRIS reader and a second lrclib cache while the view is open. The view
fetches lyrics only while it is shown, so that is one request per track.

Phase 3 makes small changes to the shared sources:
- `LyricsView` gets options: line scale 1, a blur by distance, the sung line placed lower.
- `mpris.js` gains Volume, Shuffle, LoopStatus and Seek.

After each such change, both copies (lock screen and Now Playing) are re-synced in the same commit.

### How it covers the screen

- **The overlay.** `NowPlayingOverlay` is one `St.Widget` added at the top of
  `Main.layoutManager.uiGroup`. It spans all monitors, above the bar, the dock and notifications.
- **Input.** `Main.pushModal(overlay, {actionMode: Shell.ActionMode.SYSTEM_MODAL})` takes all
  input. The overlay's own key handler implements the key map (§2), and pointer events go to the controls or to "exit".
- **Monitors.** The player sits on the monitor the pointer is on when the view opens. Every other
  monitor gets the blurred snapshot, the swirl and the clock only. A monitor change
  (`monitors-changed`) closes the view instantly, with no animation.
- **Never trapping the user.** Seven rules, each tested in Phase 1:
  1. Escape always closes, in any state, even mid-animation (it jumps to the end of the exit).
  2. Every handler, timer and frame callback runs through `guard()`. An exception logs, then calls
     `teardown()`, which pops the modal and destroys the overlay with no animation.
  3. A watchdog: if the enter or exit animation has not finished 3 s after it started, it jumps to the end state.
  4. `disable()`, the screen locking (`Main.screenShield` `locked-changed`) and a session-mode change all close the view instantly.
  5. If `pushModal` fails (another grab holds input), the view does not open at all.
  6. During the exit, the modal is released **at the first frame**, and the overlay goes
     non-reactive. Clicks and keys reach the desktop while the blur is still sharpening.
  7. The hotkey pressed again while the view is open closes it.

### How the desktop blur is done

- **Enter.**
  - `Shell.Screenshot.screenshot_stage_to_content()` takes one snapshot of the stage per monitor at the moment the hotkey is pressed. Nothing flashes: frame 0 is identical to the desktop.
  - The snapshot sits in an `St.Widget` with a `Shell.BlurEffect` (mode ACTOR). Its `radius`
    springs from 0 to 48 px and `brightness` from 1 to 0.88.
  - The snapshot is a still image, so after the blur settles it costs nothing per frame.
- **The swirl over it.** `bgswirl.js` (`BackgroundSwirl`, the lock screen's music-mode effect) sits on the
  same snapshot actor. Its `lm_amount` going from 0 to 1 is the "swirl slowly takes over the
  blurred desktop" step, the same code the lock screen uses.
- **Exit.**
  - The desktop under the overlay may have changed while the view was open: a video, a new window,
    a notification. So the exit fades into a **live** backdrop: a `Clutter.Clone` of
    `global.window_group` (wallpaper and windows), plus clones of the panel box and the dock,
    under one `Shell.BlurEffect`.
  - These clones exist only for the ~600 ms of the exit.
  - If the live clone costs too much (measured in Phase 7), the exit falls back to the enter snapshot.
- **Why not Blur My Shell.** The Blur My Shell pipeline is built for static wallpaper backdrops and per-surface glass. Running it over a full-stage snapshot with an animated radius would mean new BMS code. `Shell.BlurEffect` is GNOME's own, cheap (it downsamples) and animatable.

### The swirl

- **Code.** It uses `bgswirl.js`, the full-screen variant of the widget's wave field: the four
  cover colours from `palette.js`, read once per track.
- **Track change.** The four colours cross-fade from the old palette to the new one over 1.2 s, with
  the same timing as the widget's `FADE`. The colours are interpolated in JS (Oklab) and sent to the
  shader as uniforms. There is no second shader pass.
- **Cost.**
  - The field is smooth, so it renders on a **quarter-resolution** actor (640x360 per 2560x1440
    monitor), scaled up with linear filtering. That is 16 times fewer fragments.
  - It runs at 25 fps in the steady state (the widget's `FPS`). During enter, exit, the swap and
    the cross-fade, it runs on the stage frame clock (120 Hz) so fades stay smooth.
  - When the view is closed, there is no actor, no effect and no timer.
- **Nothing playing.** The neutral grey palette (`swirlPalette(null)`).

### Liquid Glass on every control (docs/STANDARD.md)

- **The material.** Controls are `GlassPane`s (tahoe-gdm `glass.js`, shared as `paneglass.js`): exact
  SDF capsules and circles, the backdrop bending toward the edge, a crisp 2 px rim lit from the top
  left with a 5 px glow, and an edge shadow.
- **What the glass bends.** Each pane's backdrop is a `Clutter.Clone` of the swirl layer, so the
  glass bends the swirl, as the lock screen's glass bends its swirl.
- **No Blur My Shell.** The swirl is our own actor, and the panes need no BMS pipeline.
- **Shapes** (logical px at 2560x1440; they scale with monitor height):

| Piece | Shape | Size |
|---|---|---|
| Cover card | rounded rect, radius **36** = cover 24 + gap 12 (concentric) | 640 (cover 612) |
| Play / pause | circle | 112 |
| Previous, next | circle | 80 |
| Shuffle, repeat (when the player supports them) | circle | 56 |
| ⋯ (open the player app, then exit) | circle | 56 |
| Progress track | capsule, white fill, scrubbable | 640 × 14 |
| Volume track | capsule | 520 × 12 |
| Chevron | capsule | 104 × 48 |

- **Hover and press.** These follow tahoe-motion's liquid buttons: on hover the pane lifts and its rim brightens; on press it squishes on `EXPRESSIVE.spatial.fast`.

### The 3D tilt on the cover

- **Geometry.**
  - The card (glass and cover together) gets `rotation_angle_x/y` about its centre, at most **8°**
    per axis toward the pointer.
  - It also gets `translation_z` +20 px and a drop shadow that moves away from the pointer.
  - The stage's own perspective gives the depth.
- **Motion.** Two `Spring`s (`EXPRESSIVE.spatial.default`) drive the angles on the frame clock,
  only while the pointer is over the card or the springs have not settled. On leave they retarget
  to 0 and the card springs back flat with a small overshoot.
- **The sheen.** A small shader over the cover:
  - a soft radial highlight at the pointer, mirrored across the centre so it reads as a reflection;
  - a diagonal band that slides with the tilt;
  - a rim that brightens on the side tilted toward the light.
  It is drawn additively, so dark covers stay dark.
- **Known compromise.** The glass rim samples the swirl at the untilted position. At 8° on a smooth
  field the mismatch cannot be seen.

### Lyrics

- **Source.** The same as the widget: a `.lrc` next to a local file, else lrclib.net (`mpris.js`
  `lyrics()`), looked up once per track after `LOOKUP_DELAY`. The lookup runs only while the view is open.
- **Style** (the reference):
  - Every line is the **same size**: SF Pro Display Heavy, 74 px at 1440p, left-aligned, wrapping.
  - The sung line is white. Lines next to it are 34 % white, those further off 26 %.
  - Lines away from the sung one are blurred by distance: 3 px, then 4.4 px, then 6 px. This is a
    `Shell.BlurEffect` per visible line, about 7 lines, re-blurred only when the line changes.
  - The sung line sits at about 42 % of the height.
- **Motion.** The widget's wave glide (`DRIFT_MS`, `STAGGER_MS`): each line drifts up a little
  after the one above it. Long gaps show three breathing dots (♪ in the widget).
- **States.**
  - **Looking:** the layout the view already has stays for up to 2.5 s, so the column does not jump
    on every track change before lrclib answers.
  - **Synced lyrics found:** two columns.
  - **None found, plain unsynced lyrics only, or the lookup fails:** centred.
- **Copyright.** Committed screenshots, fixtures and docs use only original placeholder lines
  (`docs/nowplaying/mock`, `tools/nowplaying/fixtures/*.lrc`). Live lrclib lyrics appear only on the user's screen.

### The clock

- **Code.** The lock screen's Glass Text clock (`glassclock.js`): Space Grotesk SemiBold, the
  subtler material A. Its backdrop is a clone of the swirl layer instead of the lock background.
- **Size and place.** Smaller than the lock screen's: the time at about 9 % of the height (132 px
  at 1440p), with the date under it in SF Pro Text Semibold 30 px at 62 % white, centred at the top.
- **Updates.** The glyph mask is redrawn once a minute, as on the lock screen.

### Nothing playing (proposal, see question 3)

- **From the hotkey:** the view opens with a placeholder. That is the neutral swirl, the clock, an
  empty glass card with a music-note glyph, and "Not Playing". The controls are disabled, and play
  starts the last player if MPRIS still lists one.
- **After idle:** the view never opens when nothing plays.
- **A player stops or goes away while the view is open:** the view stays and becomes the placeholder.
  If another player appears, it is picked up as it would be in the widget.

### Fullscreen apps and video

- **The hotkey** always works. The user asked for it, even over a fullscreen app.
- **Idle start** (if wanted) is skipped in two cases:
  - a fullscreen window is on the target monitor (`global.display.get_monitor_in_fullscreen`);
  - the session has an idle inhibitor (`org.gnome.SessionManager.IsInhibited(8)`), as a playing
    video or a game would set.
- **Locking.** The view never keeps the screen awake by itself, so GNOME's own blanking and lock
  still happen; on lock the view closes underneath. This desktop's `idle-delay` is 300 s, so an idle
  start has to come earlier (default 120 s).

---

## 2. Key and pointer map

The view is modal, so **every key is swallowed** and nothing reaches the app underneath.

| Input | Action | Stays open? |
|---|---|---|
| **Escape** | close | no (always works, in every state) |
| **The hotkey** (default `Super+Shift+M`) | close | no |
| **Space** | play / pause | yes |
| `XF86AudioPlay` / `Pause` / `Stop` | play / pause / stop | yes |
| **Right**, `XF86AudioNext` | next track | yes |
| **Left**, `XF86AudioPrev` | previous (restarts if past 3 s, as Apple Music does) | yes |
| **Shift+Right / Shift+Left** | seek +10 s / −10 s | yes |
| **Up / Down** | system output volume +5 % / −5 % (the glass slider moves; GNOME's OSD is not shown) | yes |
| `XF86AudioRaiseVolume` / `LowerVolume` / `Mute` | passed to GNOME (system volume, its OSD) | yes |
| Modifier keys alone (Shift, Ctrl, Alt, Super) | nothing, so Shift+arrow works and a stray Super does not close | yes |
| `Print` | GNOME's screenshot UI over the view (it stacks its own modal) | yes |
| `Super+L` | GNOME locks; the view closes underneath | no |
| **Any other key** (letters, Enter, Tab, F-keys…) | close, the key swallowed | no |
| **Click** on a control (buttons, progress, volume, ⋯) | that control | yes (⋯ raises the player and closes) |
| **Click** anywhere else, the cover included, any button | close | no |
| **Scroll** over the volume slider | volume | yes |
| **Scroll** elsewhere | nothing | yes |
| Pointer motion | tilt when over the cover; never closes | yes |
| Pointer still for 3 s | the cursor hides; it comes back on motion | yes |

---

## 3. Motion (springs from `tahoe-motion/spring.js`)

One `FrameTicker` per open view runs on the overlay's frame clock (`Clutter.Timeline` with no
duration). It advances every live spring by real elapsed time, and it stops when every spring has
settled and only the 25 fps swirl is left. The view does no layout during animation: everything
moves with translation, scale, opacity and shader uniforms.

**Enter** (storyboard above; the times are where each spring is about 90 % settled):

| t | What |
|---|---|
| 0 | Snapshot taken, overlay up, modal pushed. The frame is identical to the desktop. |
| 0–350 ms | Blur radius 0 → 48, brightness 1 → 0.88 (`effects.slow`, critically damped) |
| 100 ms | A Liquid Glass drop (64 px circle) appears at the card's centre: tahoe-motion's `Drop` geometry (fall, stretch, spread), drawn as a `GlassPane` whose rect and radius follow the drop each frame |
| 150–550 ms | The drop pours into the 640 px card; its corners relax to radius 36 (`spatial.slow`, the popup's elastic grow from 0.92) |
| 350–700 ms | The cover fades in inside the glass, scale 0.94 → 1 |
| 200–1400 ms | Swirl `lm_amount` 0 → 1 (slow ease, so the gradient creeps over the blurred desktop) |
| 500–900 ms | Title, progress, controls and volume rise 40 px into place, an eased stagger (`stagger()`, inQuad, 24 ms); the clock and chevron fade in; the lyrics glide in line by line |

**Exit:**

| t | What |
|---|---|
| 0 | Modal popped, overlay non-reactive: the desktop already takes input. The live backdrop clones are built. |
| 0–180 ms | Lyrics, controls, clock and chevron fade out; the card gathers back into the drop, which shrinks away (the popup's close) |
| 80–450 ms | Swirl `lm_amount` 1 → 0: the swirl fades into the blurred live desktop |
| 350–700 ms | Blur 48 → 0, brightness back to 1 |
| ~700 ms | Overlay destroyed; every effect, clone, timer and MPRIS listener released |

Any key or click during the exit jumps to its end. Opening again during the exit reverses the
springs from where they are, keeping their velocity. With GNOME animations off, both are instant.

**Track change.** The swirl palette cross-fades over 1.2 s. The cover cross-fades in place:
- the old cover on top fades out over 300 ms;
- the new one under it scales 0.97 → 1 on `spatial.default`;
- the title and artist slide up 8 px and fade.

**Lyrics to no lyrics:**
- **Column.** One spring (`spatial.slow`) moves its x from the left position to the centre.
- **Lyrics.** They fade out over the first 150 ms, drifting 120 px to the right, before the column
  has moved far. On the way back the column moves first and the lyrics fade in behind it.
- **Interruptions.** A change while the spring is still moving retargets it and keeps its velocity.

---

## 4. Performance budget and how it is measured

The harness is `tools/headless` and `tools/widgets-stress` with a new driver,
`nowplaying-stress@local`, and the fake MPRIS player `fake-player-app.js`. Never the lock or GDM harnesses.

| | Budget |
|---|---|
| Closed | 0 actors, 0 timers, 0 MPRIS listeners, 0 network |
| Enter / exit frames at 120 Hz | p95 frame time < 8.3 ms, no frame > 16.6 ms (stage `after-paint` timestamps) |
| Steady state, playing, with lyrics | shell CPU < 3 % (the swirl at 25 fps, quarter resolution) |
| Line change | one ease, < 2 ms of JS |
| Tilt while hovering | < 1 ms of JS per frame |
| After 50 open/close cycles | actor count, GLib source count and modal depth back to baseline; RSS within +5 MB |

---

## 5. Phases

Each phase is one commit or more on `claude/music-screensaver-257249`, and each passes its gate headless first.
- **Never without asking:** installing on the real desktop, logging out, merging into main or pushing.
- **After any change to a shared file:** `sync-shared.sh`, and `check-shared.sh` must pass for both tahoe-lockscreen and tahoe-nowplaying.

### Phase 0: plan and mockups (this document)
- Mockups of both layouts, the enter and exit storyboards, the swap, the tilt, and the key map.
- **Gate:** the user's answers to §6.

### Phase 1: the overlay skeleton
- **The extension.** New `extensions/tahoe-nowplaying@cachyos-tahoe/`: `metadata.json`,
  `extension.js`, `overlay.js` (open, close, guard, teardown, watchdog), `keys.js` (the §2 map) and
  `schemas/org.gnome.shell.extensions.tahoe-nowplaying.gschema.xml`. These settings keys:
  - `toggle` (`as`, default `['<Super><Shift>m']`);
  - `idle-start` (`u` seconds, 0 = off);
  - `when-nothing-plays` (`placeholder` | `stay-closed`).
- **The hotkey.** `Main.wm.addKeybinding('toggle', settings, NONE, NORMAL | OVERVIEW | POPUP, …)`.
  It is removed in `disable()`.
- **What it shows.** A plain dark overlay, every exit rule wired up, and the glass chevron.
- **Tools.** `tools/nowplaying/run.sh`, a wrapper around the widgets-stress harness with the new
  extension and driver. Driver tests:
  - every row of the key map;
  - click on and off controls;
  - an exception thrown in a handler, which must tear down;
  - `disable()` while the view is open;
  - a lock request while the view is open;
  - `pushModal` refused;
  - the watchdog.
- **Gate:** every test passes. After each one: `Main.modalCount === 0`, no overlay actor left, no
  JS errors in the test shell's log.

### Phase 2: layout and the glass clock
- **`layout.js`.** It places the clock, the left column, the lyrics column and the chevron from the
  monitor's size (the §1 sizes at 1440p, scaled by height, clamped for 1080p and 4K). It has two
  states (two columns and centred) and one blend value between them, so Phase 4 only animates that value.
- **Placeholders.** Static stand-ins for the cover, the lyrics and the controls.
- **The clock.** `glassclock.js` (shared) over a temporary flat swirl.
- **Gate:** headless screenshots at 2560x1440, 1920x1080 and 3840x2160, in both layouts, compared
  side by side with the mockups. No overlap and no clipping (an automated box check, as the lock
  screen's `addCheck`).

### Phase 3: player and lyrics wired to MPRIS
- **`mpris.js`.** Volume, Shuffle, LoopStatus, `SetPosition` / `Seek`, CanSeek. Shared, so re-synced.
- **The player.** Cover, title, artist, scrubbable progress, transport, shuffle and repeat (hidden
  when unsupported). The volume slider is the system output (`Volume.getMixerControl()` default sink).
- **Lyrics.** `LyricsView` with the full-screen options; the looking / found / none states.
- **Nothing playing.** The placeholder.
- **Fixtures.** `tools/nowplaying/fixtures/` holds original placeholder `.lrc` files: one long song,
  one with gaps, one plain (unsynced), and one track with none.
- **Gate:** the fake player drives play, pause, seek, next and previous, with and without lyrics.
  Screenshots match the layout. The lyrics line is in step with the position (±100 ms). Nothing
  reaches lrclib in the harness: the test shell has no network.

### Phase 4: swirl and transitions
- **The swirl.** Full-screen `bgswirl.js` on the snapshot actor, at quarter resolution, with the
  Oklab palette cross-fade on track change.
- **Transitions.** The cover and title cross-fade. The lyrics-to-centred swap moves on one spring.
- **`FrameTicker`.** It runs on the frame clock and goes back to 25 fps when everything has settled.
- **Gate:** these recordings, made headless with `tools/record-screen.js`:
  - track change, lyrics to none, none to lyrics;
  - a change mid-swap, where the spring must retarget smoothly.
  Frame timing is within budget.

### Phase 5: glass buttons and the 3D tilt
- **Glass.** Every control is a `GlassPane` over a clone of the swirl, with hover lift and press squish.
- **The tilt.** Rotation springs, the sheen shader, the moving shadow, and spring-back on leave.
- **Gate:**
  - Close-ups checked against STANDARD.md: the rim, the edge shadow, concentric radii.
  - A scripted tilt sweep: pointer motion across the card, then leave, recorded. It must stay in the tilt budget.

### Phase 6: enter and exit animations
- **Enter.** The snapshot, the blur spring, tahoe-motion's `Drop` geometry drawn with a `GlassPane`,
  the cover fading in, the swirl taking over, the staggered content.
- **Exit.** The modal released at once, the live backdrop clones, the swirl fading out, the blur
  sharpening, then teardown.
- **Interruptions.** Interrupt and reverse; with animations off, instant.
- **Gate:** headless recordings of enter and exit at 120 Hz. Frame times within budget. The first
  frame matches a desktop screenshot pixel for pixel, so there is no flash. Input is accepted on the
  desktop at the exit's first frame.

### Phase 7: performance and stress
These driver scenarios run in the headless shell:
- spam the hotkey: 50 toggles at random 30–400 ms gaps;
- rapid track changes, 20 at 300 ms;
- players appearing and disappearing while the view is open and mid-animation;
- lyrics arriving late (a delayed fixture);
- a monitor added or removed while open;
- `disable()` / `enable()` mid-enter.
Also: the live exit clone measured against the snapshot fallback (§1), and the steady-state CPU measured.
- **Gate:** the §4 budget table, written into `docs/nowplaying/perf.md`.

### Phase 8: docs, install switch, repair entry
- **`docs/nowplaying.md`.** What it is, the key map, the settings keys, how to change the hotkey:

  ```
  gsettings --schemadir … set org.gnome.shell.extensions.tahoe-nowplaying toggle "['<Super><Shift>m']"
  ```

  It also gets a section in `docs/widgets.md` that points to it.
- **`scripts/tahoe-nowplaying.sh on|off|status`,** as `tahoe-lockscreen.sh`: check-shared, copy,
  compile the schema, enable, and write state key `nowplaying` to `~/.config/tahoe-glass/state`.
- **The repair manifest.** A feature entry `F-nowplaying` in `config/repair-manifest.json`, an
  extension group `"nowplaying": ["tahoe-nowplaying@cachyos-tahoe"]`, and a state key. A
  `scripts/tahoe_repair.py` test (tools/repair-test) checks that it is re-enabled after a GNOME update.
- **README.** At most one line in the features list. Any showcase media follows the showcase rules
  (16:9, placeholder lyrics, OCR check before pushing).
- **Then ask:** install on the real desktop (needs a logout on Wayland), merge into main, push.

---

## 6. Questions for the user

1. **Idle start.** Should the view also open by itself after idle, like a real screensaver?
   *Proposal:* yes, opt-in. `idle-start` defaults to 0 (off); when set (e.g. 120 s), the view opens only while music
   plays, never over a fullscreen app or an idle-inhibited session, and well before GNOME's 300 s
   blank. Or: on by default at 120 s, or no idle start at all.
2. **Hotkey.** `Super+Shift+M` (free on this desktop; GNOME uses `Super+M` / `Super+V` for the
   calendar). Is that OK, or would you rather use another key?
3. **Nothing playing, from the hotkey.** Show the placeholder ("Not Playing", neutral swirl, clock),
   or not open at all (the hotkey does nothing)?
4. **The clock.** The time with the date under it (as mocked), or the time alone?
5. **Clicking the cover.** You said everything except the controls closes the view, so a click on the cover closes it too.
   Should it instead do nothing, so the tilt can be played with without accidentally leaving?
6. **Extra buttons.** Shuffle, repeat and the ⋯ (open the player app) are in the mock. Do you want
   a lyrics on/off glass button (bottom right, as in the reference) to force the centred layout?
