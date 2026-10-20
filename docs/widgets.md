# Music widgets: album-colour swirl (plan, 2026-10-20)

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

## Plan

1. **Colour extraction** (`swirl.js`): the cover loaded once per track at 40x40 with GdkPixbuf
   (async), k-means (k = 5, a fixed seed so a track always gives the same palette) over the
   opaque pixels; clusters ranked by size and colourfulness, the top 4 kept. Cached per cover.
   Never per frame. No cover: a neutral grey palette at a lower strength.
2. **Swirl shader on a still card**: a `Clutter.OffscreenEffect` on the card's glass backdrop
   (like the glass text clock), so the glass is rendered once into the effect's texture and each
   swirl frame only re-runs the shader over it (`queue_repaint` on the effect, not the actor).
3. **Inside the glass**: the swirl colours the glass in a "colour" blend (the glass keeps its
   own light and dark, so the rim light and the edge shadow stay), plus a smaller pull towards
   the swirl's lightness, faded out across the refraction band at the edge. The palette is mapped
   per mode (dark and milky: deep colours under white text; light: pale ones under dark text).
   The 1 px edge is CSS on the content, over all of it.
4. **Large**: the cover across the full width inside the 16 px padding (radius 24 - 16 = 8),
   the widget taller to fit, title, artist, progress with times and controls under it.
5. **Wide**: 16 px on every side; the cover as tall as the card less the two gaps; title and
   artist at the top right of the cover; the controls right-aligned at the right of the column
   with the progress bar under them, level with the cover's bottom edge.
6. **Lyrics**: the same swirl.
7. **Performance**: about 24 fps from a GLib timer (the motion is slow; 120 Hz buys nothing), and
   no timer at all when paused or stopped, hidden or unmapped, under a fullscreen window, locked,
   or with GNOME animations off (a still gradient then). A track change while paused or with
   animations off cross-fades only when animations are on, then stops. Checked with
   `tools/widgets-stress`.
8. Docs and light/dark screenshots.

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
