# Goal 1: real-time refraction

What GNOME-Tahoe's glass is made of, how it compares with the patched Blur My Shell v76 on the
desktop now, what it would cost, and what to do.

## Where the glass comes from

GNOME-Tahoe draws no glass itself. Its `extensions/liquid-glass@thinkingcoding1231.gmail.com` is a
snapshot of [ryohsuke1231/liquid-glass](https://github.com/ryohsuke1231/liquid-glass) (MIT, TypeScript,
built to `dist/`), taken before that project's October restructuring. Everything in GNOME-Tahoe that
refracts goes through one class from it, `LiquidEffect`:

| Surface in GNOME-Tahoe | Drawn by |
|---|---|
| Dock, calendar menu, other top bar menus, notifications, OSDs, app windows | liquid-glass's own managers (`dockManager.ts`, `uiManager.ts`, `panelMenuManager.ts`, ...) |
| Control Center, Launchpad window, Tahoe OSDs and notifications | micronixxx's Kiwi fork, which `import()`s `dist/liquidEffect.js` and `dist/utils.js` out of the liquid-glass folder by absolute path |
| Desktop widgets | `tahoe-widgets@micronix`, same borrowed classes |
| Top bar | nothing: Kiwi makes the panel transparent with a dark gradient; liquid-glass's quick settings glass is switched off in the recommended settings (the Kiwi Control Center replaces quick settings) |

Blur My Shell is also installed (v74, unmodified) for the overview and the panel, with popups left
to the glass.

## How liquid-glass renders a piece of glass

Two parts: getting the pixels behind the glass, and the shader.

### Backdrop: snapshot vs upstream

The GNOME-Tahoe snapshot (`src/utils.ts`, 4,544 lines, and `src/liquidEffect.ts`, 3,880 lines)
builds, under each glass actor, a copy of the desktop out of Clutter clones: a `BackgroundMirror` of
the wallpaper group, a `Clutter.Clone` of every window actor (`WindowCloneManager`), and clones of
the other `uiGroup` children such as the top bar (`UILayerSampler`), with the glass's own subtree
excluded. A `Clutter.OffscreenEffect` subclass captures that subtree, blurs it and composites. The
author's own measurements in the source: with a dock and three glass windows, the dock clones
every window and each window clones the ones below it, so the blur chain ran 22.6 times per frame
for four surfaces before same-frame reuse was added. Most of the file is repair code for what
clones break: Mutter clipping cloned windows to the frame's damage region, actors that stop being
allocated, nested glass blanking the outer capture.

Upstream replaced this in October 2026 (`src/rendering/stageCopy.ts`, `backdropGlass.ts`,
`relays.ts`): while the stage is painted, a `Clutter.BlitNode` copies the rectangle behind the glass
out of the stage view's framebuffer into an offscreen texture, reused when the frame's redraw clip
does not cover the whole rectangle, with "relays" that widen the redraw clip whenever anything
behind the glass changes. That is the same idea as Blur My Shell v76's `render/backdrop/capture.js`
(`BackdropCaptureEffect`: blit the painted view's framebuffer, per damage rectangle, before the
surface paints). Both therefore show whatever is really behind the glass, every frame, with no
clone tree. The clone machinery is still used upstream for clones and screenshots, where the
framebuffer does not hold the backdrop.

### Blur

Snapshot and upstream: Dual Kawase, four downsample passes (5 taps, to 1/16) and three tent
upsamples (8 taps) at half resolution, limited to the glass's own rectangle plus margin
(`blur_rect_*`), optionally Gaussian in the snapshot. Blur My Shell v76: its own Dual Kawase effect
placed before the refraction in the pipeline (`refraction-blur` role, `blur_radius` param, max 48).
Equivalent.

### The shader (`shaders/glass.frag`, 1,156 lines in the snapshot)

Per pixel, with `d` the signed distance to a rounded rectangle (`sdRoundRect`):

1. **Shape**: one rectangle (`dock_*` uniforms) or, in multi-region mode, up to 16 rectangles
   sharing one blurred texture (`region_*` arrays), each with its own base colour. Edge
   anti-aliasing with `edge_smoothing`.
2. **Height field**: depth normalised over `corner_radius`, then a superellipse profile
   `h = (1 - (1 - t)^n)^(1/n)` scaled by `max_z`; the surface is vertical at the edge and flat
   inside. `profile_shape_n` (Kiwi uses 7) sets how fast it flattens.
3. **Normal**: one central difference of the height along the SDF gradient direction.
4. **Refraction**: GLSL `refract()` with `eta = 1/ior` (Kiwi uses 2.4), scaled by
   `displacement_scale` over the shorter screen side, clamped to 0.30 of the texture, damped at the
   edge; chromatic aberration as a per-channel offset in pixels (`chroma_strength`), 12 fetches
   when active, 4 otherwise; 4-tap rotated-grid supersampling of the blurred texture.
5. **Colour**: brightness, contrast, saturation; the region's base colour; the tint colour at
   `tint_strength`.
6. **Inner shadow**: an ambient-occlusion band of `ao_radius` px inside the edge, strength
   `ao_intensity`.
7. **Lighting**, gated by `surface_light_enabled`: a Fresnel rim (`1 - dot(N, view)` to the power
   `rim_power`, masked to `rim_width` px, weighted by the light direction `light_angle_deg`), a
   specular lobe (`pow(dot(reflect(-L, N), view), shininess)`), a sheen (`pow(dot(N, L), 1.65)`),
   all screen-blended with a hue-preserving clamp.
8. **Drop shadow** outside the edge: umbra and penumbra with quintic falloff, extended away from
   the light, bluish `(0.03, 0.04, 0.08)`, premultiplied. Off in multi-region mode.
9. **Early exits** for "beyond the shadow" and "flat interior", where everything collapses to
   constants.

Upstream's `glass.frag` keeps this and adds a continuous-corner ("squircle") option and an
outline pass; the structure is the same.

### Blur My Shell v76's "Liquid Glass" (`effects/refraction/refraction.glsl`, 390 lines)

A GLSL port of winaviation's liquid-ass 0.1.1b, relicensed GPL-3 for Blur My Shell:

1. **Shape**: the actor's rectangle (or a clip), `corner_radius` with top/bottom switches, a
   circle special case for square actors.
2. **Displacement**: within a bezel of `edge_size` px (the desktop uses 12), a fixed profile
   `1 - sqrt(t(2 - t))` of the distance to the edge, times `strength`, blended with an optional
   Snell-style S-curve (`refraction_style`, 0 on the desktop). No normal, no index of refraction, no
   height; the bend direction is the edge normal.
3. **Dispersion**: 7 extra samples along the displacement, weighted per channel
   (`rgb_fringing`, 0.06 on the desktop).
4. **Colour**: tint colour at `tint`; the Blur My Shell pipeline's brightness lives in the blur
   effect before it.
5. **Highlight**: one ring at the edge, decaying over about a quarter of the bezel, lit from
   `fresnel_angle` (45 degrees on the desktop) with `gloss` (0.8), capped at 0.22, plus an optional
   specular lobe (off).
6. **Inner shadow**: a vertical gradient darkening the lower part by up to 20 % of `shadow` (0.2).
7. A fast path for the flat interior.

### Side by side

| | liquid-glass (upstream) | Blur My Shell v76 patched (desktop now) |
|---|---|---|
| Backdrop | stage framebuffer copy, damage-aware, relays | stage framebuffer copy, damage-aware |
| Blur | Dual Kawase, half res, region-limited | Dual Kawase, per surface |
| Bend model | height field, surface normal, Snell with IOR | fixed edge profile, edge normal |
| Bend reach | `corner_radius` px, flat beyond | `edge_size` px (12), flat beyond |
| Dispersion | per-channel pixel offset | 7-sample weighted smear |
| Rim | Fresnel from the normal, directional, width and power | one fixed ring, directional, capped |
| Specular, sheen | yes | optional specular lobe only |
| Inner darkening | AO band from the edge | bottom gradient |
| Drop shadow | yes, directional | none (CSS shadows only) |
| Several pieces, one blur | yes (16 regions) | no: one surface, one capture, one blur each |
| Adaptive text colour | yes (samples the backdrop) | no |
| Squircle corners | yes | no |
| Surfaces covered | top bar (pill or islands), calendar and other panel menus, notifications, OSDs, quick settings (whole or per toggle), dock, app windows, desktop widgets, launcher, glass app icons | panel, popups (per piece with our patch), dock, app windows, overview, lock screen, alt-tab, screenshot UI, app folders, window list |
| GNOME 51 | declared and handled (`shellVersion.ts`) | yes |
| Distribution | GitHub only, no releases, dev branch moves daily | GitHub, pinned commit, our patch on top |
| Size | about 40,000 lines TS + GLSL | the effect is 390 + 500 lines inside Blur My Shell |

What the eye sees: on the desktop's thin pieces (a 38 px bar, 48 px toggles) the two bends are
hard to tell apart, since both only act in the outer 12 to 20 px. The lit rim, the AO band and
the drop shadow are what make GNOME-Tahoe's pieces look like separate objects on the wallpaper;
those are the parts worth having. The reference screenshot
(`docs/screenshots/quick-settings.png` in GNOME-Tahoe) shows them most clearly on the Wi-Fi pill
and the white Dark circle.

## Can it apply to all live blurs

Yes, on the surfaces liquid-glass has a manager for (table above), which is every glass surface the
desktop uses today: bar, menus, quick settings pieces, dock, app windows. Blur My Shell stays for
the overview, the lock screen and the other shell blurs liquid-glass does not touch, with its popups
module off, since both would otherwise blur the same menus (upstream warns about this in its
preferences and offers to switch it off).

Two things on the desktop are tied to Blur My Shell's pipelines and would stay there or need
moving: the desktop widgets (`extensions/tahoe-widgets@cachyos-tahoe` reuses Blur My Shell's
`RoundedPipeline` on `pipeline_glassbar_dock`, read-only) and the light/dark follow service, which
drives everything through `glass_params()` in `scripts/glass-bar.sh` and Blur My Shell's gsettings.
liquid-glass has its own gsettings keys per surface (`top-bar-tint-color`,
`quick-settings-toggle-tint-strength`, ...), so the mode switch would write those too.

## GPU cost on the RTX 3090

Per frame, per glass surface, both do: one blit of the rectangle behind the surface, seven blur
passes at half resolution over that rectangle, one composite pass. liquid-glass's composite reads
up to 12 texels per pixel at the edge and 4 inside; Blur My Shell's reads 8 at the edge and 1
inside. On a 2,560 x 1,440 desktop the bar is 2,500 x 38 px and a menu about 400 x 600; these are
small fractions of the frame and a 3090 will not notice either. App windows are the costly case
in both: a full window rectangle re-blurred every frame while something moves behind it, times
the number of glass windows. liquid-glass's multi-region mode is cheaper than our per-piece quick
settings (one blur for all toggles instead of one per toggle, about a dozen today).

The CPU side differs more: liquid-glass runs per-frame JavaScript sync loops (`BEFORE_REDRAW`
laters per manager) to track geometry; the snapshot's clone version was measured by its author at
dozens of paints per frame. Upstream ships `tools/perf/glass-monitor.sh` (GPU, shell CPU, frames,
copies and paints per glass, per second) and a bench extension; that is what phase 6 uses on the
real desktop. It cannot be measured in the VM: the VM has QEMU's VGA device and llvmpipe, so VM
runs validate the look and the code paths, not the frame time.

The one known NVIDIA risk is the framebuffer blit itself. This repo's README still records that Blur
My Shell's dynamic mode "renders surfaces opaque on NVIDIA with GNOME 51"; that was before v76,
whose blit-based capture is what the desktop runs live today for menus, dock and apps, so the same
mechanism in liquid-glass should work, but it is the first thing to check on the real GPU.

## Is GNOME-Tahoe's refraction better

The shader is richer, and the parts that matter (lit rim, inner AO, shadow, per-region rendering)
are real improvements. The sampling is not better; it is the same technique. The extension around
the shader is large, unpublished and moving fast, and it would take over surfaces that this repo
styles through Blur My Shell today (the per-piece quick settings patch, Open Bar's bar, the modes).

## Two ways to get the look, and the recommendation

**A. Adopt upstream liquid-glass** as the renderer for the shell's glass. Pin a commit, install
from `~/.local/src`, drive its gsettings from `glass-bar.sh`, switch Blur My Shell's popups off.
Gains the whole feature set (menus growing out of their button, adaptive text, top bar pill,
squircles, glass icons). Costs: Open Bar and liquid-glass both want to shape the panel (its pill
mode adds its own margins and makes the panel transparent), so one of them goes; the per-piece
quick settings patch is replaced by liquid-glass's "individual buttons" mode, which has to be
re-tuned to the capsule radii; `tahoe-repair.sh` learns a second extension to build and enforce;
every upstream change is a merge.

**B. Port the lighting into the Blur My Shell refraction shader** through
`config/bms-tahoe-glass.patch`: a Fresnel rim from a height-field normal, the AO band, an outside
drop shadow (the surface actor already has margin for it in the popup component), and the
multi-region idea is not needed since each piece is its own surface. About 150 to 250 lines of
GLSL plus four or five parameters, GPL on GPL (the liquid-glass shader is MIT, so the maths can be
carried over with attribution). Keeps Open Bar, the per-piece quick settings, the modes, the
widgets' pipeline reuse and tahoe-repair as they are. Loses adaptive text and the menu animation.

Recommendation: run phase 1 as a comparison in the VM, since the decision is about how it looks
on this desktop, not about architecture. Install upstream liquid-glass in the VM beside the
current setup, draw the bar and one menu both ways, and screenshot them side by side. If the
liquid-glass pieces read clearly better, go A for the shell surfaces; if the difference is the rim
and shadow, go B, which gets those at a tenth of the surface area. My expectation from reading
both shaders is B, with A's screenshots as the target to tune against.

## Test plan

Phase 1 (VM, `asmirror.sh` as the mirror user):

1. `git clone` upstream at the pinned commit into `~/.local/src/liquid-glass`, `npm run build`
   is not needed (the repo ships `dist/`), copy the extension folder, enable it, Blur My Shell
   popups off. Log the journal for `[Liquid Glass]` errors on GNOME 51.
2. Top bar style `pill`, margins 4.8, corner radius 19, tint from `glass_params()` (dark: rgb
   34,34,38 at 0.42), blur 12, outline white 16 %. Screenshot. Then the same bar back on Blur My
   Shell. Screenshot. Crop both to the bar and compare at 2x.
3. Calendar menu open both ways, same crop.
4. Quick settings in "individual buttons" mode with toggle corner radius 24; compare with the
   current per-piece capsules.
5. `journalctl --user _COMM=gnome-shell` clean after 10 minutes of opening and closing menus.

Phase 6 (real desktop, after the go-ahead): `nvidia-smi dmon -s u` and upstream's
`glass-monitor.sh` for two minutes idle and two minutes dragging a window under the bar, before
and after.

## Phase 1 result (VM, 2026-10-19)

Upstream liquid-glass (commit b14a1cc) installed in the VM beside Blur My Shell v76, Open Bar
off, Blur My Shell popups and panel off, liquid-glass's top bar in pill mode with the capsule's
geometry and the dark mode tint, menus and quick settings in "individual buttons" mode. It loads
and runs clean on GNOME 51.1 (no liquid-glass lines in the journal; the shell needed a session
restart to see the new extension folder, which `gnome-extensions install` did not trigger).

Side by side, Blur My Shell first, liquid-glass second, in `shots/`:

| | |
|---|---|
| `compare-bar.png`, `compare-bar-zoom.png` | bar: both pills; liquid-glass's rim is a hard white line, the fill flatter and lighter |
| `compare-calendar.png` | calendar: one pale sheet with the rim; the calendar card painted pale by its own styling |
| `compare-qs.png` | quick settings: the theme's panel card still shows as translucent rectangles behind and between the pieces, "Dark Style" lost its white fill; the per-piece look needs the same CSS work our Blur My Shell patch already did |

The user's verdict on these: it looks much worse. The config was a first pass (tint, rim and
shadow untuned, llvmpipe in the VM), but the pieces that were supposed to sell it, the lit rim and
the separate-object look, did not read better than the current glass, and the quick settings
regressed. Decision: **option B**. Keep Blur My Shell v76 and the per-piece quick settings; port
only what is worth having from liquid-glass's shader (height-field rim light, AO band, drop
shadow) into `config/bms-tahoe-glass.patch`, tuned against the macOS references rather than
against liquid-glass's output. liquid-glass stays uninstalled; the VM is back on the Blur My Shell
and Open Bar setup.

## Phase 2: the shader port (VM, 2026-10-19)

Added to `config/bms-tahoe-glass.patch`, in `src/effects/refraction/`: two steps at the end of the
Liquid Glass shader's edge path, after liquid-glass's height-field lighting (MIT, ryohsuke1231):

- `rim_light`, `rim_light_width`: the glass edge as a superellipse slope (order 3.6) whose normal is
  lit from the existing `fresnel_angle`; a Fresnel term from that normal, masked to a band of
  `rim_light_width` times the refraction band, screen-blended. A light line along the top edge.
- `ao`, `ao_width`: an ambient-occlusion band inside the edge, darkening by `ao` over `ao_width`
  times the refraction band. The piece reads as a slab sitting on the wallpaper.

Both act only within the refraction band, so the shader's flat-interior fast path is untouched,
and both default to 0, so Blur My Shell's own pipelines look as before. The four show up in Blur My
Shell's effect editor too (`info.js`). `glass_params()` sets rim 0.55 over 0.45, edge shadow 0.3
over 0.2 for every glass surface. The user approved the look on the quick settings pieces
(`shots/p2-qs.png`, `p2-bar.png`, `p2-calendar.png`).

Gotcha found on the way: GNOME Shell caches ES modules and the shader source at import, so a new
Blur My Shell build only loads after a session restart; disabling and enabling the extension
re-runs the old code (`rebuild` already says to log out).
