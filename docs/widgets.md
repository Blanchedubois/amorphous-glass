# Music widgets: album-colour swirl (2026-10-20)

The Music widgets (small, wide, large, lyrics) tint their glass with a slow swirl made from the
album cover's main colours, the way Apple Music's full-screen lyrics background moves. The glass
stays glass: blur, rim light, edge shadow and the 1 px edge from `docs/STANDARD.md` still read.

## Phase 0: how Apple Music does it, and the source

Apple Music (and every open clone) does the same few things: take 4 or 5 dominant colours (or the
cover itself), blur them into a soft field with no hard edges, and let it turn and drift very
slowly; a new track cross-fades over about a second. A light dither hides banding.

Compared:

| Source | Licence | What it does | Verdict |
|---|---|---|---|
| [Steve-xmh/applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) (AMLL), `packages/core/src/bg-render` | **AGPL-3.0-only** (all packages, checked at df0d8d8) | Mesh renderer: the cover downscaled to 32 px, on a Bezier patch mesh whose control points drift, rotated, dithered, vignetted. Older Pixi renderer: four rotating copies of the cover, huge blur, 1 s cross-fade. Palette: k-means vs octree in Lab, picked by spread | Best reference, but not GPL-3.0 as assumed: porting its code would put AGPL terms into this repo. Used as the reference for the technique only, no code copied |
| [Adaptive Palette](https://pub.dev/documentation/adaptive_palette/latest/) (Flutter) | MIT | Layered blurred image shaders on orbital paths, weighted k-means, cross-fade | Same idea; confirms the recipe |
| [HypnoticCanvas](https://klibs.io/project/mikepenz/HypnoticCanvas) (Compose) | MIT, shaders per their own licences | Mesh gradient shader | Licence per shader unclear: not used |
| Shadertoy "fluid gradients" | mostly CC BY-NC-SA | | Not GPL compatible |

**Pick:** an original GLSL shader written for this repo (GPL-3.0), after AMLL's technique: four
colour fields whose centres orbit at different slow rates, a slow overall turn and a light domain
warp, mixed with Gaussian weights (that is the "heavily blurred mesh"), plus a dither. A
fragment-only shader with no texture reads beyond the glass. Credits for AMLL (AGPL-3.0,
technique) and Adaptive Palette (MIT, technique) go in the README.

## What was built (phases 1 to 8, 2026-10-20)

- **Colours** (`palette.js`): the cover read once per track at 40 px (async), k-means (k = 5,
  deterministic seed) in OkLab, the 4 most present and colourful kept; ~2 ms a cover, cached per
  cover (32). No cover: a neutral grey field at half strength. `tools/widgets-stress/covers.js`
  makes the test covers (dark, bright, monochrome, blue and orange) and prints their palettes.
- **The cover's own colours, the same in every mode** (user, mid-way): no per-mode remapping.
  The text ink follows the swirl instead of the mode: dark text when the palette's mean luma is
  over 0.56, white otherwise (the mode's text without a cover), with a 20 % scrim on that side.
- **Waves, not blobs** (user, mid-way): a three-step sine domain warp folds two smooth waves that
  mix the four colours into long ribbons, the plane turning at 0.04 rad/s; the warps move at
  0.08 to 0.23 rad/s, so a ribbon takes about half a minute to roll over. Dithered.
- **Inside the glass, translucent, highlights only** (user, mid-way): a `Clutter.OffscreenEffect`
  on the card's glass backdrop. The glass takes the swirl's hue at its own lightness (70 %), then
  moves 38 % towards the swirl's colour: the wallpaper's blur still shows through. Across the 14 px
  edge band the glass is read from just inside the band and only what is brighter at the edge (the
  rim light) is added back: no inner shadow or refraction bevel, no "3D emboss". The 1 px edge is
  CSS over everything, unchanged. Without Blur My Shell (fallback card) there is no swirl.
- **Large**: the cover 324 x 324 (356 less 16 px each side), radius 8 (24 - 16); title, artist,
  progress with times and controls under it; the card is 356 x 496 (a widget class can set a
  `static height`, `extension.js` `dims()`).
- **Wide**: 16 px padding on every side and between cover and column; the cover 138 x 138 (170 less
  two gaps); title and artist at its top right. **Controls**: right-aligned in the column to the
  right of the cover, just above the progress bar, which ends level with the cover's bottom edge.
  The hover circle of the last button (not its icon) ends on the column's edge, as the bar does.
- **Lyrics** and **small** share the same swirl (all music cards are `MusicWidget`s); every music
  card now has 16 px padding.
- **Public API unchanged**: `MusicSmall`, `MusicMedium`, `MusicLarge`, `MusicLyrics` keep their
  constructors, `size`, `setMode`, `tick`, `wantsSeconds`, `requestTick`, `destroy`; added
  `attachCard(card)` (optional: without it no swirl) and `MusicLarge.height`.

### Performance (headless shell, real GPU via gbm, 2560x1440, 4 music widgets, `STRESS_ONLY=swirl`)

| State | Stage paints/s | Swirl timer | Shell CPU |
|---|---|---|---|
| Playing | 26 | on (25 fps, one timer for all) | 2.7 % |
| Paused | 0 | off | 0.7 % (settling) |
| Track change while paused | 11 for 1.2 s | on for the cross-fade only | 2.7 % for 1.2 s |
| After that cross-fade | 0 | off | 0.2 % |
| Playing, GNOME animations off | 1 (the progress second) | off, still gradient | 0.3 % |
| Playing, under a fullscreen window | 0 | off | 0.2 % |
| Playing, locked | 0 | off (the extension is off while locked) | 0.6 % |
| Unlocked / animations back on | 26 | on again | 2.7 to 3 % |
| Idle baseline: paused from the start | 0 | off | **0.2 %, same as main without the swirl** |

The swirl paints at 25 fps whatever the refresh rate (120 Hz on the desktop: the frame clock only
draws when the timer damages the cards). Each frame only re-runs the shader over the glass already
rendered in the effect's texture (`queue_repaint` on the effect), so Blur My Shell's blur does
not run again. A window covering the whole card is checked on `restacked` and once a second while
playing. Full stress (`layout-all.json`): every scenario ok, timers 3, 2, 2, 2, 2, D-Bus subscriptions 1, actors
3466 to 3462, match rules 89 to 87 over lock and disable cycles: no leaks. The remaining logged
errors are the date menu's DBusProxy ones listed below.

Rerun: `STRESS_COVERS=a.png,b.png STRESS_ONLY=swirl DRIVER=widget-stress@local bash
tools/widgets-stress/run.sh OUT tools/widgets-stress/layout-music.json`. Screenshots:
`SHOT_FAKE_PLAYER=1 SHOT_ART=cover.png|none bash tools/widgets-stress/run.sh OUT
tools/widgets-stress/layout-music.json` (`SHOT_MOTION=ms` adds a later shot). The harness now uses
its own `XDG_RUNTIME_DIR`, so it never touches the session's crash guard file.

Sheets: `docs/shots/music-swirl-light.png`, `music-swirl-dark.png` (dark, bright, blue and no cover).

# Desktop widgets: stress and impact check (2026-10-19)

`extensions/tahoe-widgets@cachyos-tahoe`, tested in a throwaway headless gnome-shell
(`tools/widgets-stress/run.sh`, 2560x1440, the installed Blur My Shell and its settings, all 16
widget kinds on screen, 4 of them music). Input is scripted: button `clicked` signals, a Clutter
virtual pointer for drags, scrolls and right clicks, fake MPRIS players on their own D-Bus
connections (40 ms reply), session-mode pushes for lock/unlock, a real fullscreen GTK window.
Counted from inside the shell: the extension's live GLib timers and D-Bus signal subscriptions
(by call site), stage actors, and the shell connection's D-Bus match rules.

## Results

| Check | What was done | Before the fixes | Now |
|---|---|---|---|
| Spam clicks | play/pause, next, previous: 75 clicks each on 4 music widgets, 0-8 ms apart | every click a D-Bus call with no timeout, every property change a position Get | 4 calls per button reach the player (one in flight per button, clicks meanwhile dropped), 12 position Gets; icons and titles match the player afterwards |
| Rapid track changes | 40 metadata changes ~5 ms apart | one lrclib.net lookup per track for the lyrics widget | all titles end on the last track; one position Get at a time; lyrics looked up only once a track stays 1 s |
| Players appearing and leaving | a second player owns and drops its name 30 times, 0-18 ms apart | a proxy finished after its player left could stay as a ghost player | back to the first player; the second one shows when it stays; no ghost |
| Fast drags | 20 drags with a virtual pointer, the next one during the 150 ms snap | a drag cancelled mid-snap stayed off the grid; the right and bottom edge clamp was not on the 8 px grid | every widget on the grid, inside the work area, layout file saved with all 16 |
| Fast scrolling | 120 wheel and touchpad scroll events over every widget | | nothing moves, no errors (the widgets take no scroll input) |
| Right-click spam | 20 right clicks, 0-15 ms apart | | no errors |
| Lock / unlock | 16 cycles, 50-400 ms each | each one made a new shell WeatherClient (never freed) and destroyed the calendar event source, sometimes mid start-up ("Gio.DBusProxy already disposed" from calendar.js) | timers 2, D-Bus subscriptions 1, match rules 87, actors 3488 before and after; the weather client and calendar source are made once per shell session |
| Disable / enable | `disableExtension` / `enableExtension` 10 times, 0-300 ms apart | as above | same counts before and after |
| Idle, minute widgets only | digital, glass text, calendars, weather for 65 s | 65 ticks (every second) | 1 tick (on the minute) |
| Idle, second hands or music playing | analog faces, music progress | 1 tick a second | 1 tick a second (they show seconds) |
| Covered by a fullscreen window | real fullscreen GTK window for 5 s | ticked every second underneath | 0 ticks; ticking resumes when it closes |

The two long-lived timers are the clock tick and the 30-minute weather refresh.

## Left as they are (not the widgets)

- "Unhandled promise rejection" during rapid track changes and player flicker: the shell's own
  media controls; they happen with the widgets switched off too (control run).
- "Gio.DBusProxy already disposed" at calendar.js:239 on lock cycles under ~400 ms: every one comes
  from the shell's date menu swapping its own calendar source (`dateMenu.js:976`), not from the widgets.
- "Can't update stage views actor ... needs an allocation" while dragging: Blur My Shell's glass
  pieces inside the dragged card; the code from before this round logs the same (19 against 24 per run).
  Harmless.

## Rerun

```bash
DRIVER=widget-stress@local bash tools/widgets-stress/run.sh /tmp/widgets-stress tools/widgets-stress/layout-all.json
```

`STRESS_ONLY=drags`, `idle` or `control` runs one part; `DRIVER=widget-shot@local` (with
`SHOT_FAKE_PLAYER=1`) takes the light/dark/milky screenshots. The fake players have no artist, so
the test never asks lrclib.net.
