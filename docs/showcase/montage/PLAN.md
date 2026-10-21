# Montage: the features and the design (plan, waiting for approval)

The middle of the showcase video. The title (`docs/showcase/title/`) zooms out of the wallpaper onto
the home screen. The montage takes over from that frame, follows the cursor through the desktop's
features with cuts between them, returns to the same home screen, and the title zooms back in: one
loop. It is about 40 s; title + montage + title-out comes to about 50 s.

Storyboard: `storyboard/footage.webp` (one frame of every usable clip) and `storyboard/zoom-2x.webp`
(what a 2x cursor camera sees).

## 1. What footage exists

The showcase shoot (`tools/showcase/shoot.py`, branch claude/showcase, now on main) recorded the
real desktop with GNOME's screencast: 2560x1440, the cursor drawn in, variable frame rate (about
44 fps), personal details blurred by `tools/showcase/redact.py`. The redacted sources live in
that session's scratch folder under /tmp, so they **must be copied out before a reboot**
(step M0: done 2026-10-21, copied to `~/Videos/liquid-glass-showcase/pub-src`).

| Clip | Length | Feature | Design point it shows |
|---|---|---|---|
| quick-settings-open | 7.6 s | Quick settings, Wi-Fi submenu | popups grow from the icon as a circle of glass; capsule toggles |
| menu-slide | 7.8 s | Sliding across the top bar | the calendar hands over to quick settings, one glass surface morphing |
| calendar-open | 4.3 s | Calendar and notifications | concentric radii: 32 outer, 20 cards, 12 gap |
| dock-menu | 5.4 s | Dock menu | the same glass on every menu |
| desktop-menu | 3.8 s | Desktop right-click, Add Widget | |
| window-open | 7.7 s | An app window opening | window motion, 24 px corners, glass header bar |
| files-menu | 4.2 s | Files and its GTK menu | GTK apps get the same glass |
| overview | 6.3 s | Overview and search | raised glass search panels |
| app-grid | 7.3 s | App grid and a folder | the folder tile and popup share one glass |
| widget-drag | 8.5 s | Dragging a widget, snapping | widgets are glass, they snap to a grid |
| music-swirl | 14.8 s | Music widget | album-colour swirl under the glass |
| volume-osd | 4.9 s | Volume OSD | a capsule over the dock |
| lock-screen, sign-in | 52 s, 7 s | Lock and login screens | 1920x1080 30 fps, from the lock shoot |

Stills (lossless PNG, 2560x1440): desktop, light-desktop, light-quick-settings, light-calendar,
light-files, search, app-folder, music, the lock and login screens.

**Gaps.** No clip of switching light / dark / milky (the strongest "design" beat). No clip of
search being typed. No notification arriving. The lock clips are 1080p30, lower than the rest.

## 2. Decision: where the footage comes from

At 2x the redaction blurs become obvious smears (`zoom-2x.webp`: the quick settings user and
Wi-Fi tiles). Three ways:

| | Option | For | Against |
|---|---|---|---|
| A | **The redacted footage as it is** | no reshoot; ready now | smears where the camera zooms (quick settings, calendar's event, lock screen); no gap shots |
| B | **Reshoot on the real desktop with a demo profile** (recommended) | the real GPU glass at 60 fps; no redaction when the personal surfaces show demo data | needs a demo setup: a guest Wi-Fi name, a demo calendar feed, a neutral user name and avatar; about an hour with shoot.py |
| C | Reshoot in the test VM (tools/vm/vm.sh) | a clean, throwaway account; repeatable | software rendering: the glass and the motion are not what users see, and frames drop |

B also fills the gaps (mode switch, search typing, a notification) and lets shoot.py log the cursor
(section 4), which makes the camera exact.

## 3. Structure (about 40 s, three acts)

Each shot is 2 to 3.5 s, cut on the action (a click cuts to the next shot already moving).

**Act 1: One glass (about 14 s).** Every surface is the same material.
1. Home screen, wide (the title's last frame); the camera pushes in toward the top bar. 1.2 s
2. Quick settings opens as a circle of glass from its icon; Wi-Fi submenu. 3 s
3. Menu slide: calendar ↔ quick settings. 3 s
4. Calendar: hold on the concentric corners. 2 s
5. Dock menu → desktop right-click menu (match cut on the menu appearing). 2.5 s
6. Files with its GTK menu. 2.5 s

**Act 2: Motion (about 13 s).** Springs, not curves.
7. A window opens (cut on the dock click). 2.5 s
8. Overview, typing a search. 3 s
9. App grid → folder opening. 3 s
10. Volume OSD capsule over the dock. 1.5 s
11. Light / dark / milky switch (needs B). 3 s

**Act 3: A living desktop (about 13 s).**
12. Dragging a widget; it snaps. 3 s
13. Music widget: the album-colour swirl, slow push-in on the glass. 3.5 s
14. Lock screen → sign in. 4 s
15. Back to the home screen, wide, the cursor settles: the title's first frame. 2 s

**Design beats between the acts** (optional, 1.5 s each): a slow macro push-in on a lossless still
(the rim light on a quick settings capsule, the 32/20/12 calendar corners, the refraction at the
dock's edge), with a short caption on a small capsule of the same glass ("one glass recipe",
"concentric corners", "springs, not curves"). Captions are off by default; the user chooses.

## 4. The camera

- A virtual camera over the 2560x1440 source, output 1920x1080 60 fps. Zoom 1.0 (wide) to 2.2.
  At 1.33x the crop is native 1920 px; above that it is upscaled (2x = 1.5x upscale, Lanczos),
  acceptable for UI; above 2.2 the text goes soft.
- It follows the **cursor** on the desktop's own springs (spring.js, critically damped,
  `effects.slow`-like, so it never overshoots) with a dead zone: it moves only when the cursor
  leaves the middle 40 % of the frame, so small moves do not shake it.
- Zoom per shot: in on the action (the menu, its icon), out when the action is larger than the
  frame (window open, overview, app grid: 1.0 to 1.3). The zoom moves on a spring too.
- Cuts carry the camera: the next shot starts at the zoom and screen position of the last, where
  possible (match cuts), so the eye stays put.
- **Cursor track.** Option B logs every pointer move and click in shoot.jsonl (a small change to
  shoot.py: `move` and `click` already know their targets and durations). For option A the cursor
  is found in the frames by template matching the cursor sprite (numpy, no OpenCV here), with a
  hand-set keyframe where it fails (over busy widgets).

## 5. Joins with the title

- The montage's first and last frames are the clean home screen at camera zoom 1.0, held for half
  a second: they are `plateOut` and `plateIn` of the title (`render.py --plate-in/--plate-out`),
  so the title's zoom and the bar/dock/widgets fade line up pixel for pixel. Same wallpaper,
  same mode (dark), same widgets, same clock time where possible (the clock widget's hands would
  jump at the loop otherwise: shoot the first and last frames together, or redact the clock hands
  to the same time).
- Full video: title in (0 to 7.3 s, up to the end of the dissolving pass) → montage → title out
  (zoom into the wallpaper, the word, the logo). For the loop, the title's beats are already split
  at `SEQ.zoomOut` / `SEQ.zoomIn`.

## 6. Tech

`docs/showcase/montage/`:

```
edit.json      the cut: per shot the clip, in and out points, zoom keys, caption
edit.py        decode (ffmpeg) → constant 60 fps → camera crop per frame → encode; title joins
track.py       the cursor track (from shoot.jsonl, or template matching)
```

Python + ffmpeg + Pillow + numpy, all installed. The title renders with `--plate-in` /
`--plate-out` from the montage's own frames, then ffmpeg joins the three parts.

Outputs:

| File | For |
|---|---|
| `amorphous-glass.mp4`, 1920x1080 60 fps, about 50 s | the full video, uploaded by dragging into the README on GitHub (≤ 10 MB on a free plan: CRF ~24, or 1080p30 if larger); YouTube or a release asset otherwise |
| The README | keeps the title WebP as the hero; the full video goes under it, or in the Animations section |

No sound by default (README videos play muted); a music bed is optional, the user's choice and
licence.

## 7. Phases

| # | Phase | What I show |
|---|---|---|
| M0 | Copy the redacted sources out of /tmp into a folder outside the repo (they are personal footage) | the inventory |
| M1 | Storyboard (this) | `footage.webp`, `zoom-2x.webp`; decide A / B / C, captions on or off |
| M2 | Camera prototype on two shots (quick settings, menu slide): the cursor track, the follow spring, a match cut | a 6 s MP4 |
| M3 | Rough cut of all three acts with hard cuts | the 40 s MP4 |
| M4 | Polish: timing, design beats and captions if chosen, the title joins | the full 50 s loop |
| M5 | Final render, size check, README placement (with the showcase session) | the MP4, the README change for approval |

Reshoots for option B happen before M3 and need the user at the machine for the lock screen shots.
Nothing is merged or pushed without the user's OK.
