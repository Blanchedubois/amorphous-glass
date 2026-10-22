# Glass title: "amorphous glass" formed from a drop of liquid glass (plan)

A new title card for the showcase loop, beside the current one (the capsule gliding over plain
text, [PLAN.md](PLAN.md)). The user's brief (2026-10-22): the words themselves are liquid glass,
translucent like the lock screen's glass clock; a circle of liquid glass, without refraction,
drops in, spreads out and forms the title; the title holds and fades into the start of the
montage; the same springiness, elasticity and inertia as the desktop's other liquid-glass
animations.

Nothing of the old scene is deleted: the new page lives in `docs/showcase/title/glass/` and shares
the fonts, the plates and `render.py` (a `--scene glass` switch).

## 1. The look: the lock clock's glass on the words

The lock screen's clock is a glass pane shaped like its glyphs
(`extensions/tahoe-lockscreen@cachyos-tahoe/widgets/clockpanes.js`, variant **B2 clear blur**,
drawn by `widgets/paneglass.js`). Its material, ported to the title's WebGL2 shader:

| | Lock clock (B2, logical px at the lock's scale) | Title (1920x1080 px) |
|---|---|---|
| Type | Space Grotesk SemiBold | the same: `600 184px`, tracking -4 px, one line, centred (the old title's metrics) |
| Backdrop | the wallpaper, frosted: `Shell.BlurEffect` radius 18 | a Gaussian blur of pass 1 (wallpaper + plate), sigma ≈ 18 px, half-res two-pass |
| Colour | brightness +0.10, milk 0.10 (white over it), saturation 1.1, no tint | the same numbers |
| Bend | 0 (no refraction) | 0: the user asked for glass **without refraction** |
| Edge | the desktop widgets' edge model: band 8, rim light 0.35 (width 0.45 of the band, lit from the top left, `tahoe_lens_slope`), no inner shadow, a 1 px hairline at alpha 0.16 | the same, from the text's signed distance field (section 3) |
| Shadow | none on the clock | a soft drop shadow (0.20, as every desktop glass; the brief asks for "a soft shadow"); shown with and without in phase 1 |
| Anti-aliasing | cairo mask | exact from the SDF: coverage = clamp(0.5 - sd) |

The signed distance field of the word is computed once at load in JS (`sdf.js`): the text canvas
→ a two-pass exact Euclidean distance transform (Felzenszwalb), inside and outside, signed
(negative inside), uploaded as a float texture. The circle and the blob are analytic SDFs; the
whole animation is one field `sd(p, t)` that the material is drawn from, so the edge, the hairline
and the coverage are the same at every moment of the morph.

## 2. The motion

The springs are tahoe-motion's `Spring` (`extensions/tahoe-motion@cachyos-tahoe/spring.js`, the
exact damped oscillator), with the tokens the desktop already uses. No new easing curves.

| Beat | Source of the feel | Numbers |
|---|---|---|
| The fall | the Now Playing cover's drop (`tahoe-nowplaying@cachyos-tahoe/view.js`, 2bd1046): accelerating under its weight, `y = -fall · (1 - t²)`, stretched along its speed with the volume kept (`w = d / sqrt(1 + s)`, `h = d · sqrt(1 + s)`, s = speed · 0.00045, max 0.45), fading in as it starts (110 ms) | the circle appears above the word's line and falls to it; FALL 0.42 s (the Now Playing's 0.26 s, scaled to a fall about 1.6x longer in px) |
| The landing | the Now Playing's spread: width on `{damping 0.62, stiffness 420}` with velocity +0.9 × the landing speed, height on `{0.66, 320}` with -0.35 × it: the width leads and overshoots (~7 %), the height squashes first, both settle out of phase | the circle lands as a squashed ellipse that wobbles back round, then wider |
| The spread and the morph | the blob widens toward the word's extent on the same width spring (retargeted, velocity kept: inertia) while the field blends from the ellipse's SDF into the word's: `sd = mix(sd_blob, sd_text, m)` with a smooth union so the letters bud out of the blob rather than cut in; `m` on `EXPRESSIVE.spatial.default {0.8, 380}` (spring.js), from the moment the landing has peaked | the word is whole about 0.9 s after the landing; the width's overshoot carries into the word (a last elastic settle of the letters' outline) |
| Volume | the circle's area equals the word's ink area, measured from the text canvas at load (the diameter is not a guess), so what drops is what the letters are made of; the spread is the same area pulled wide | |
| Hold | still | ~1.1 s |
| The fade | the glass's coverage and the shadow fade out (0.55 s, `smooth`); the plate's bar, dock and widgets fade back in over the same beat (as the old title's `uiIn`) | ends on the montage's first frame |

Timeline (about 5.6 s; to be tuned in phase 5):

| Time (s) | |
|---|---|
| 0.00 | the montage's last frame (`plateIn`), whole: loop.sh's dissolve lands here |
| 0.05 – 0.55 | bar, dock and widgets fade out: the bare wallpaper (no camera zoom: the montage's camera is locked, REWRITE.md "Joins") |
| 0.45 | the circle appears above the line and starts to fall |
| 0.87 | it lands; the elastic landing |
| 1.10 – 2.1 | spread and morph into "amorphous glass" |
| 2.1 – 3.4 | hold (the overshoot's last settle during the first 0.3 s) |
| 3.4 – 4.0 | the glass fades; bar, dock and widgets fade back in |
| 4.0 – 5.6 | the montage's first frame (`plateOut`), whole: the hard cut into the montage. (Trimmed in phase 5 so the clip is about 5–6 s with the plate held at least 0.5 s at each end.) |

Every frame is computed from t = 0 (the springs are stepped at 240 Hz from the start), as in
`timeline.js`, so a still equals a frame of the video, and render.py's motion blur (6 moments per
frame, 180° shutter) works unchanged.

## 3. Tech

```
docs/showcase/title/glass/
  index.html        the page (fonts and plates from ../)
  main.js           the word, the SDF, the passes, the modes (live / t= / render=)
  sdf.js            exact Euclidean distance transform of the text canvas → float texture
  timeline.js       the beats and the springs: blob {cx, cy, w, h, m, fade}, wallpaper, plateOut
  scene.glsl        pass 1: wallpaper or plate (uiOut / uiIn), the backdrop
  blur.glsl         pass 2: the frost (separable Gaussian, half res)
  glass.glsl        pass 3: sd(p) = blend(ellipse, text), the B2 material, the hairline, the shadow
```

`render.py`: `--scene glass` picks `glass/index.html`; everything else (still, clip, webp, plates,
motion blur) is reused. Served from the repository root (spring.js is imported from extensions/).

Risks: WebGL2 float textures under SwiftShader (fallback: the SDF packed into two 8-bit channels);
the SDF mix of a circle and letters can pinch where letters are thin (the smooth union's radius and
a minimum "blob floor" under the letters during the morph take care of it; checked on the contact
sheet); SwiftShader render time (3 passes, 6 moments: ~10 min per clip, run in the background).

## 4. Phases, what is shown

| # | Phase | Shown to the user |
|---|---|---|
| 1 | The look: the static glass word at the hold frame, dark theme, over the bare wallpaper; the lock clock's B2 material | one 1920x1080 still, plus a 2-up (with / without the drop shadow) |
| 2 | The drop: the circle's fall and elastic landing (no morph yet: it holds as the landed ellipse) | a contact sheet of the landing (every 2 frames around it) and a short MP4 |
| 3 | The morph: ellipse → word, the width spring carrying into the letters | contact sheet + MP4 of 0.4 – 2.6 s |
| 4 | The joins: plate in, UI out / in, the fade; first and last frames checked against the plates pixel for pixel | contact sheet of both ends + the whole clip MP4 |
| 5 | Timing polish, the montage's final plates from the amorphous-title session, the final render | `docs/showcase/title/renders/title-glass.mp4` (1920x1080, 60 fps, silent, ~5–6 s); its path to the amorphous-title session for loop.sh |

Commits on this worktree's branch; renders stay out of git (`renders/` is ignored); no README or
hero changes here.
