# Title scene: "amorphous glass" (plan, waiting for approval)

The front page of the README opens on the project's name, **amorphous glass** (Liquid Glass inside
the repo), set in Space Grotesk over the desktop wallpaper. A capsule of the desktop's own glass
moves over the word; under it the melted letters are refracted back into focus, and it settles over
"glass" as the logo. Scope now: this scene and its loop-back. The montage comes later, from the VM
recordings the showcase session (branch `claude/showcase`) is making.

Storyboard stills, from a throwaway WebGL prototype (the real shader port, three variants):

- `storyboard/variants.png`: the first three variants (dropped, see section 2).
- `storyboard/pass-endings.png`: the chosen move, with the "clear" and "dissolve" endings.
- `storyboard/logo-dark-light.png`: the end frame (the logo) over fold-d and fold-l.

## 1. The look

| | Choice | Why / source |
|---|---|---|
| Word | `amorphous glass`, lowercase, one line, 184 px at 1920x1080, tracking -4 px | the user's wording |
| Font | Space Grotesk **600** (variable; installed axis `wght` 300 to 700 only, so 700 is the boldest) | system font; OFL 1.1, so the TTF and `OFL.txt` ship next to the page |
| Text colour | white, 0.96, a soft 22 % shadow under it (as on the lock screen clock) | legible on both fold wallpapers |
| Wallpaper | `fold-d.jxl` (dark) and `fold-l.jxl` (light), from `picture-uri-dark` / `picture-uri`, decoded with `djxl`, cropped 4096² to 16:9 | the user's own wallpaper (GNOME 51 default, package gnome-backgrounds, **CC BY-SA 3.0**: the title media must credit it and be CC BY-SA; see Risks) |
| Glass | the BMS recipe, ported line by line from `refraction.glsl` (the installed, patched shader) with `glass_params()`: strength 0.8, edge 12, falloff 2.4, rim width 3, fringing 0.06, gloss 0.8, fresnel 45 (+90), rim light 0.55 / 0.45, edge shadow 0.30 / 0.20, drop shadow 0.20, **but no tint** (user, 2026-10-21: clear glass) | the logo is the OS's own glass, clear |
| Hero scale | the capsule is 270 px tall, about 7x the 38 px bar: the edge band is scaled x8 (12 → 96 px), so the refraction reaches most of the way in and visibly bends the letters; `backdrop_zoom` 1.07 so the lens magnifies a little; refraction strength rises with speed (up to x1.6) | user, 2026-10-21: more refraction |
| Capsule | pill (radius = height / 2) over "glass": the word's width + 75 px each side, 270 tall, centred on the word's ink (ascender to descender). The g's descender reaches the refraction band on purpose: even at rest you see the glass bend it | STANDARD.md: capsules are 9999 |
| Word gap | "amorphous" ends 36 px before the capsule edge (the capsule must not cut the s) | |

Open look questions for the user (defaults in bold):

1. Weight: 500 / **600** / 700.
2. ~~Tint~~: decided, none (clear glass).
3. Melted letters: **liquid goo** (blur + threshold, letters run together) or only blurred/warped.

## 2. The motion (user, 2026-10-21: "the glass moves across the text and as it does the text dissolves", with inertia and elasticity)

Variants A to C of the first storyboard (`storyboard/variants.png`) are dropped. One move instead:

1. 0 to 0.3 s: the word, crisp, over the wallpaper.
2. 0.3 to 2.3 s: a capsule of glass slides in from the left and across the word. Under the lens the
   letters are refracted and **melt** (warp + goo), and they run in its wake.
3. Ending, one of two (`storyboard/pass-endings.png`):
   - **clear**: the wake heals behind it, the glass lands on "glass", and everything comes back to
     clarity: the logo frame.
   - **dissolve**: the letters behind it are gone, and the glass slides off and leaves the bare
     wallpaper. This is the dissolve into the montage. It can also follow "clear" as the scene's
     exit: logo, hold, then a second pass that dissolves it.

**Inertia and elasticity.** A guide travels the path (ease in-out). The glass follows it through an
under-damped spring (damping 0.55, stiffness 90), so it lags as it sets off, overshoots where it
stops and swings back. Its shape is a second, springier spring (0.35 / 260), driven by speed and
acceleration: speeding up stretches it along the motion, slowing down squashes it (shorter, taller),
and it jiggles back to a round capsule. Area is kept: height = rest height / sqrt(1 + stretch). The
refraction gets stronger and the blur under it a little heavier with speed. These two springs are
softer than the OS tokens (the OS settles in a fraction of a second, too fast to read across a
1900 px title); they go through the same `Spring` class from spring.js.

Length: about 3.5 s to the logo, 0.6 s hold, about 1.3 s for the dissolve pass.

## 3. Tech

`docs/showcase/title/` (next to the README's `docs/showcase/media/`):

```
index.html, main.js   the page: no build step, no dependencies
timeline.js           the beats, the glide (inertia, squash and stretch), the camera, as pure functions of t
scene.glsl            wallpaper or plate + the word, the melt field (warp, pre-blurred letters, goo threshold)
glass.glsl            the refraction port (keeps the BMS / liquidass licence header: GPL-3 by grant)
render.py             stills, MP4, looping WebP (headless Chromium + ffmpeg)
fonts/                SpaceGrotesk-Variable.ttf + OFL.txt
plates/               fold-d.webp, fold-l.webp, the stand-in desktop frames, CREDITS.md
```

`timeline.js` imports `extensions/tahoe-motion@cachyos-tahoe/spring.js` directly (one copy of the
springs), so the page is served from the repository root.

Two WebGL2 passes: (1) wallpaper + text texture, melted per pixel by the variant's melt field, into a
mipmapped framebuffer; (2) the capsule's SDF, edge direction, displacement, 7-tap dispersion, magnification,
highlight, edge shadow, rim light, drop shadow, sampling pass 1 (blur = mip level).
Parameters by query string so every frame is reproducible: `v` (variant), `theme`, `t` (a still),
`w`/`h` (output size), `plate` (an image to use instead of the wallpaper), `cam` (scale,x,y),
`phase` (in / logo / out).

## 4. README: GitHub can't run JS

| Output | Use | Notes |
|---|---|---|
| **Animated WebP**, 1280x720, 30 fps, loop forever, q≈80 | the hero, top of the README | autoplays and loops on GitHub; same format as the README's other clips; gradients stay smooth (GIF bands them at 256 colours); target < 3 MB each |
| `<picture>` dark / light | `title-dark.webp`, `title-light.webp` | GitHub honours `prefers-color-scheme` sources |
| Still PNG/WebP of the logo frame | `prefers-reduced-motion` source, social preview image (repo Settings → 1280x640) | |
| **MP4** H.264 1920x1080 60 fps (CRF 18, ~2 MB) | the full video later (title + montage), uploaded by drag-and-drop into the README in the GitHub editor (user-attachments URL, ≤ 10 MB on free plans) | shows as a player: no autoplay, no loop; that is fine for the long version |
| GitHub Pages (optional) | the live WebGL page | needs Pages turned on (a user decision) |

Embed, to slot in as the first thing under the `# Liquid Glass` heading of the showcase README
(replacing nothing; the desktop screenshot stays as the next image):

```html
<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/showcase/media/title-still.webp">
    <source media="(prefers-color-scheme: light)" srcset="docs/showcase/media/title-light.webp">
    <img src="docs/showcase/media/title-dark.webp" width="100%" alt="amorphous glass: a capsule of refracting glass passes over the melted words and brings them into focus">
  </picture>
</p>
```

Render pipeline (no Node here; Chromium, ffmpeg with libx264 and libwebp are installed):
`render.py` serves the repository on 127.0.0.1 and accepts POSTed frames; the page, opened in headless
Chromium (`--use-angle=swiftshader`, so it is the same on any machine), steps `t` by 1/fps, draws,
and POSTs each canvas as PNG. Then ffmpeg: frames → MP4 (libx264, yuv420p, CRF 18) and → WebP
(libwebp_anim, loop 0). Deterministic: the springs are stepped from 0 for every frame.

## 5. How it joins the montage (prototyped with a stand-in, `storyboard/loop-dark.mp4`)

The title is one 9 s loop that starts and ends on a frame of the desktop (the "plate"). Until the VM
recordings exist the plate is the showcase branch's `desktop.webp` (same fold wallpaper, same
centre crop), so the crossfade changes only the bar, the dock and the widgets.

| Time (s) | Beat |
|---|---|
| 0 to 1.3 | **In from the montage.** The camera zooms in 1.00 → 1.12 (ease in-out); bar, dock and widgets fade out (0 to 0.7 s), leaving the bare wallpaper |
| 1.0 to 1.4 | the word fades in, crisp |
| 1.4 to 5.0 | **Clearing pass**, left to right, with inertia and squash and stretch; the letters melt under the lens and in its wake, then heal; the glass lands on "glass" |
| 5.0 to 5.8 | **Logo** hold |
| 5.8 to 7.4 | **Dissolving pass**, back right to left: the glass sets off from "glass" (stretching as it speeds up), and the letters it has passed melt and are gone |
| 7.3 to 8.8 | **Out to the montage.** The camera zooms out 1.12 → 1.00; bar, dock and widgets fade back in |
| 8.8 to 9.0 | the plate, still: the montage's first frame takes over |

- The montage cuts in on that plate and, at its end, returns to the same home screen, so its last
  frame is the title's first: the full video loops title → montage → title.
- Parameterised for the montage: `plate=` (the frame to start and end on; two parameters,
  `plateIn` and `plateOut`, once the montage's first and last frames differ), `cam` (zoom),
  and the SEQ beat times, all in one object at the top of `timeline.js`.
- The README WebP is the same loop with the plate held for 0.5 s at each end.
- Asks for the VM recordings: the fold wallpaper, 16:9 at 1920x1080 or 2560x1440, dark and
  light runs, each take starting and ending on about 2 s of the clean home screen with the cursor
  still, a fixed theme mode per take.

## Phase 2 fixes (user, 2026-10-21: "choppy, artifacts in the refraction, jumpy between scenes")

- **Refraction artifacts.** At 8x the desktop's edge band, the shader's quartz profile (steep at the
  rim) folded the image back on itself and mirrored the letters above and below the capsule. The
  title uses a quadratic edge displacement capped so it cannot fold (`edgeDisplacement()` in
  glass.glsl); the mip-level speed blur, which looked boxy, is gone.
- **Choppy.** 60 fps, and each frame adds up 6 moments across half its time (a 180 degree shutter):
  real motion blur. The sum is kept in a float texture and dithered, so the gradients don't band.
- **Jumpy.** The dissolving pass melted the right half of "glass" in one frame; its melt now eases
  in over 0.35 s. The camera zooms on a sine ease (peak speed half the cubic's) over 1.8 s, the bar,
  dock and widgets fade while it moves, and the word appears only as the zoom settles. Measured on
  the render: no frame-to-frame change stands out from its neighbours; the loop seam is at
  encoding noise. The loop is now 9.4 s.

## Phase 4: the renders (2026-10-21)

| File | Size | Notes |
|---|---|---|
| `docs/showcase/media/title-dark.webp`, `title-light.webp` | 2.5 MB each | 1280x720, 30 fps, 9.4 s, loops forever; encoded with Pillow (libwebp), checked by decoding with libwebp |
| `docs/showcase/media/title-still-dark.webp`, `title-still-light.webp` | 22 to 24 KB | the logo frame (t = 5.8 s), for `prefers-reduced-motion` |
| `docs/showcase/title/renders/title-{dark,light}.mp4` | 2.7 / 2.5 MB | 1920x1080, 60 fps, motion blur; masters, not in git (upload by hand) |
| `docs/showcase/title/renders/social-preview.png` | 0.5 MB | 1280x640, for the repo's Settings → Social preview; not in git |

Later (2026-10-21): the README's hero became the full loop, title + montage
(`docs/showcase/media/amorphous-glass.webp`, built by `docs/showcase/montage/loop.sh`). The montage
footage is dark, so the light loop and still were removed; `render.py clip --theme light` still makes
them.

ffmpeg's `libwebp_anim` was dropped: its output built up blocky smears over the gradients.
`render.py webp MASTER.mp4 -o LOOP.webp` re-encodes a loop from a master.

## 6. Phases, and what I show at each

| # | Phase | Show the user |
|---|---|---|
| 1 | Storyboard (this) | the stills and clips above; pick an ending and answer the open look questions |
| 2 | Shader prototype | the live page in the browser pane, side by side with a real desktop glass screenshot at the same params; one tuned still per theme |
| 3 | Timing polish | MP4 previews of the chosen variant at 2 or 3 spring settings; the dissolve |
| 4 | Render pipeline | `render.py` committed; title-dark/light.webp + still + MP4 with sizes |
| 5 | README embed | the `<picture>` block handed to the showcase session (or a patch on its branch, with its OK); a preview of the README with it |
| 6 | Montage (after the VM recordings) | cut list, zoom/follow on the cursor, the in/out joins, the full MP4 |

Commits on `claude/amorphous-title-17fb4e`; no merge into main and no push without the user's OK.

## Risks

- **Wallpaper licence.** fold is CC BY-SA 3.0 (gnome-backgrounds). The title media are adaptations:
  credit "fold, GNOME Design Team, CC BY-SA 3.0" in the README credits and license the media
  CC BY-SA. The code stays GPL-3.
- **Shader licence.** The port descends from liquidass (CC BY-NC 4.0 upstream), re-licensed GPL-3 for
  Blur My Shell by its author's grant, which extends to reuse from that repository. Keep its header.
- SwiftShader rendering is slow (a few seconds a frame at 1080p): about 5 to 10 min per render.
