# Title scene: amorphous glass

The opening of the showcase video and the README's hero loop: "amorphous glass" in Space Grotesk
over the Fold wallpaper, with a capsule of the desktop's own glass passing over it. The plan,
storyboard and decisions are in [PLAN.md](PLAN.md).

| File | What |
|---|---|
| `index.html`, `main.js` | the page: the word, the textures, two WebGL2 passes, live / still / render modes |
| `timeline.js` | the beats (`SEQ`), the glass's glide (inertia, squash and stretch), the camera; springs from `extensions/tahoe-motion@cachyos-tahoe/spring.js` |
| `scene.glsl` | pass 1: wallpaper or plate under the camera, the word, the melt |
| `glass.glsl` | pass 2: the Blur My Shell refraction recipe (`config/bms-tahoe-glass.patch`, `glass_params()`), clear |
| `render.py` | stills, MP4 and looping WebP, through headless Chromium and ffmpeg |
| `fonts/` | Space Grotesk (SIL OFL 1.1) |
| `plates/` | the wallpaper and the stand-in montage frames, with their credits |

The page imports `spring.js` from the extension, so serve the repository root, not this folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/docs/showcase/title/` (add `?theme=light`, or `?t=5.4` for one
frame). It needs WebGL2.

Render:

```bash
docs/showcase/title/render.py still 5.4 -o logo.png --theme dark
```

```bash
docs/showcase/title/render.py clip -o docs/showcase/title/renders/title-dark.mp4 --webp docs/showcase/media/title-dark.webp
```

`renders/` (the 60 fps masters, the logo PNGs, the social preview) is not in git.

The rendered frames show the Fold wallpaper (GNOME Design Team, CC BY-SA 3.0), so the videos and
images are shared under CC BY-SA 3.0; the code is GPL-3.0 like the rest of the repository.
