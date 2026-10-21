# Montage rewrite: one zoom, the cursor locked in the middle (plan, waiting for approval)

The user, 2026-10-21, on the montage now on main: "the constant zooming in and zooming out while
following the mouse is disorienting. I would like you to always keep the cursor in the center of
the screen. Also two clips that are similar feel a bit too jarring when seeing them together.
Re screenwrite the animation again. I would like you to also try to get a good video of the lock
screen. The whole idea is you follow the cursor. Ignore the zooming and zooming out. Just keep it
zoomed in following the cursor."

Also asked of this rewrite: no real song lyrics anywhere new (the Lyrics widget showed Radiohead's
"Nude"), and a sharper hero (the 854x480 WebP is soft and grainy in the purple gradients).

Storyboard stills (the existing footage through the new camera; the blue cross is the frame's
exact centre, where the cursor always is):

- `storyboard/locked-inside.webp`: the cursor inside what it opened (quick settings with the
  Wi-Fi menu, a widget being dragged). This is the montage at its best: the action fills the frame.
- `storyboard/locked-edges.webp`: the cursor on the top bar and the dock. A locked camera puts
  the screen's edge through the middle of the frame: half of it is beyond the screen. Left
  column A (the screen's own edge, blurred), right column B (the wallpaper continuing, the screen a
  card on it with rounded corners, a shadow and a hairline).
- `storyboard/locked-zoom.webp`: 2.0x (left) against 1.6x (right).

## Phase 1: screenplay and cut list

**Rules.** No two neighbours of the same kind (P panel from the top bar, M menu, W window or app,
D desktop and widgets, O overview, S system). The cursor is the subject: every shot's choreography
is written for a camera that cannot leave it. It spends as little time as it can on the top bar
and the dock: it clicks and moves at once into what opened, so the content fills the frame.

| # | Kind | Shot | Cursor choreography | s |
|---|---|---|---|---|
| 0 | | In from the title | the title's dissolve lands on the home screen with the cursor in the middle of the wallpaper (section "Joins") | |
| 1 | D | Drag the clock widget | grab it, drag it across the desktop, it snaps into the grid | 3.0 |
| 2 | P | Quick settings | up to the icon, click: the circle of glass grows; straight down onto Wi-Fi's arrow, the submenu opens | 3.5 |
| 3 | W | A window opens | a dock click (cut in on the click), then up with the opening window to its header bar | 3.0 |
| 4 | M | Its window menu | right-click on the header bar; glide down the glass menu | 2.5 |
| 5 | O | Overview and search | Super, type "calc": results on raised glass panels; down over them | 3.0 |
| 6 | D | Music widget | over Now Playing: the album-colour swirl, hover the controls (placeholder lyrics) | 3.0 |
| 7 | P | Calendar | click the clock: the calendar; down over its concentric cards | 2.5 |
| 8 | S | Volume | the cursor rests over the dock's middle; volume keys: the capsule OSD | 1.5 |
| 9 | M | Desktop menu | right-click the wallpaper; down to Add Widget | 2.5 |
| 10 | O | App grid and a folder | Super twice, click a folder: tiles and popup on one glass | 3.0 |
| 11 | S | Lock screen | Super+L: the glass clock, widgets, the Now Playing swirl; the cursor wakes the prompt; typing (field blurred) | 4.5 |
| 12 | | Back home | unlock to the home screen; the cursor returns to where shot 1 began; dissolve to the title | 1.0 |

About 33 s. Kinds in order: D P W M O D P S M O S; no neighbours repeat.

**Transitions.** The cursor is at the same place in every frame, so every cut is a match cut on
it. Each cut lands where the cursor is still on both sides (the out-point after it stops, the
in-point before it moves) or continues the same direction of motion. A 6-frame dissolve where the
brightness jumps (into the overview, into the lock screen, out of a dark app window).

## Phase 2: the camera rig (edit.py v2)

- One zoom for the whole montage: **1.6x** (recommended; 2.0x reads larger but upscales 1.5x and
  shows less of what opened). The cursor's hotspot is the exact centre of every frame: no spring,
  no dead zone, no zoom move.
- Beyond the screen's edge: **B, the wallpaper continuing** (the Fold wallpaper at the screen's
  scale), the screen a card with 28 px corners, a soft shadow and a 1 px light edge; A (blurred
  edge) as the fallback.
- The camera moves exactly as fast as the cursor, so fast moves are whip pans: the reshoot moves the
  cursor on eased paths of at least 0.6 s, and the edit adds motion blur along the camera's path
  (several camera positions per frame over the same source frame).
- Cursor positions: logged by the new shoot (exact, no jitter); the template-matching tracker
  (track.py) stays as the fallback, smoothed over 3 frames so it cannot shake the frame.
- Prototype on the existing footage first (quick settings, widget drag): a short preview.

## Phase 3: recording

- **Re-shoot the montage on the real desktop** with tools/showcase/shoot.py: new shot functions
  for the screenplay, and every pointer move and click logged with its time (shoot.jsonl). It drives
  the desktop for about five minutes: the user starts it and leaves the mouse alone.
- **Lyrics:** an original placeholder .lrc for the song that plays, shared with the widget-showcase
  session (it needs one too), so the Lyrics widget shows our own words. Nothing new shows real lyrics.
- **Lock screen** (the current lock clips are about one frame a second: the shell's screencast does
  not record while locked). To try, in order:
  1. a nested development shell (`gnome-shell --devkit`) through the tools/gdm/sysbus.sh harness
     (never the real PAM: a test password, see the memory note on faillock), locked inside its
     window and recorded at 60 fps by the host's own screencast;
  2. the test VM (tools/vm), recorded through QEMU: a throwaway account, but software rendering;
  3. the real lock screen with the showcase driver's frame grab (as now), at the best rate it holds.
  The password field stays blurred in every case.
- What the shots may show (user, 2026-10-21): the city, the weather, the Wi-Fi name, the login name
  and picture. Still blurred: the password field, other apps' notifications and windows, the home
  path, the user's real name. redact.py, then scan.py on every clip.

## Phase 4: the edit

The cut list as edit.json v2 (in and out points from the logged clicks); a contact sheet and a
low-resolution preview for review.

## Phase 5: the render (check in with the user first)

- The montage at 1080p60 with the camera's motion blur; the title joins (below); scan.py.
- **Hero quality.** The README loop as **animated AVIF**, 1280x720 (or 1600x900), 24 to 30 fps,
  10-bit, encoded from lossless frames rather than from the MP4: a test encode of today's loop at
  1280x720 24 fps is 1.6 MB (against 7 MB for the 854x480 WebP), so there is room for a much higher
  quality setting within about 8 MB. `<picture>` keeps a WebP fallback (`type="image/avif"`
  first). Before relying on it: a test on a scratch branch that GitHub's README shows an AVIF from
  this private repository (it serves raw files with nosniff, which some browsers may block for
  AVIF).
- The title keeps its dissolve.

## Joins with the title

The title's opening (zoom out of the wallpaper onto the home screen) and its ending stay. The
montage no longer starts wide, so the hand-over is a **dissolve, not a zoom**: the title's last
frame (the home screen, whole) dissolves over 0.5 s into the montage's first frame (1.6x, the cursor
in the middle of the wallpaper). At the end, the montage's last frame dissolves into the title's
first. The cursor sits on the wallpaper at both joins, so nothing jumps under it.

## Phase 6: README swap (check in with the user before pushing)

The hero `<picture>` swapped to the new AVIF + WebP; the release MP4 replaced. Whether to also
remake the existing stills that show real lyrics (desktop.webp, music.webp, the title's desktop
plate) is the user's call: asked separately.

## Open questions for the user

1. Zoom: 1.6x (recommended) or 2.0x?
2. Beyond the screen's edge: B, the wallpaper (recommended), or A, the blurred edge?
3. The reshoot drives the desktop for about five minutes; the lock screen method needs a test first.
   When can it run?
4. Remake the existing stills that show real lyrics (desktop, music, the hero's plate), or only the
   montage?
