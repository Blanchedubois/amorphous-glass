# Porting GNOME-Tahoe's glass, menu bar and Control Center: overview and phase plan

Branch `claude/gnome-tahoe-refraction-5f4a87`, cut from `glass-bar`. Nothing here is installed
on the real desktop; every phase is tried in the disposable VM first.

Studied on 2026-10-19:

| Source | What it is | Licence |
|---|---|---|
| [micronixxx/GNOME-Tahoe](https://github.com/micronixxx/GNOME-Tahoe) (commit badb046, 2026-10-10) | a GNOME 50 desktop kit: 25 bundled extensions, wallpapers, two icons, an installer that copies them | GPL-3.0, third-party extensions keep theirs |
| [ryohsuke1231/liquid-glass](https://github.com/ryohsuke1231/liquid-glass) (upstream of the glass, commit b14a1cc, 2026-10-18) | the real-time refraction extension GNOME-Tahoe bundles an older snapshot of | MIT |
| [kem-a/kiwi-kemma](https://github.com/kem-a/kiwi-kemma) as modified by micronixxx ("Kiwi (is not Apple), modded") | the menu bar tweaks and the 1:1 Tahoe Control Center | GPL-3.0-or-later |

The three goal documents:

1. [refraction.md](refraction.md): how GNOME-Tahoe draws live refracting glass, compared with the
   patched Blur My Shell v76 on the desktop now, and the decision.
2. [menu-bar-control-center.md](menu-bar-control-center.md): the menu bar and the Control Center,
   and how they go into the floating capsule.
3. [apps.md](apps.md): Files, Settings and the other system apps.

Next: [glass-everywhere-workshop.md](glass-everywhere-workshop.md), every other surface Liquid Glass
could go on (app folders, search, window headers, sidebars, the folder picker, dialogs, OSDs),
with phases.

## Findings in one page

**GNOME-Tahoe is an assembly, not a theme engine.** It ships no shader of its own. The glass comes
from the `liquid-glass` extension; the Control Center, the Launchpad window, the OSDs and the
notifications come from micronixxx's fork of Kiwi, which borrows liquid-glass's effect classes at
runtime; the Apple menu is Kiwi Menu; the File/Edit/View menus are Global Menu for GNOME; the dock is
Dash2Dock Motion plus Cupertino Dock Lite; the icons and GTK look are MacTahoe, which its installer
asks you to install first. Its own code is the Kiwi fork (about 7,400 lines of Tahoe modules), a
widgets extension and a 98-line GTK theme sync.

**The refraction is a different design from Blur My Shell's, and a heavier one.** liquid-glass
models each glass piece as a height field: a superellipse edge profile gives a surface normal, Snell's
law with a real index of refraction bends the sampling coordinate, and on top of that it lights the
surface (directional Fresnel rim, specular lobe, sheen), darkens an ambient-occlusion band inside the
edge and draws a drop shadow outside it. Blur My Shell v76's "Liquid Glass" (a port of winaviation's
liquid-ass) displaces by a fixed edge profile, adds dispersion and one Fresnel ring highlight, with
no lighting model, no shadow and no per-region mode. Both bend only within a bezel at the edge; the
interior is flat blur plus tint in both. The visible differences are the lit rim and the shadow.

**The backdrop sampling has converged.** GNOME-Tahoe's bundled snapshot rebuilds the desktop behind
each glass out of Clutter clones (wallpaper mirror, every window actor, the top bar) inside an
offscreen, which is why its Kiwi fork carries hundreds of lines of allocation-rescue and clone-culling
code. Upstream liquid-glass has since switched to copying the stage framebuffer while it is painted
(`rendering/stageCopy.ts`), the same mechanism Blur My Shell v76's `BackdropCaptureEffect` uses. So
"reads what is really behind it, live" is true of both today.

**GNOME 51 only works with upstream.** The bundled snapshot declares GNOME 49 and 50 and still calls
`Clutter.get_default_backend()`, which GNOME 51 removed; the Kiwi fork's Control Center imports that
snapshot's `dist/liquidEffect.js` and `dist/utils.js` by path, files that no longer exist upstream.
Upstream declares 46 to 51 and already has a top bar mode that draws the bar as one floating pill.

**The menu bar is not a capsule in GNOME-Tahoe.** It is a full-width transparent bar (Kiwi panel
transparency at 0, Kiwi's "panel gradient" for a dark fade at the top, no blur), with the Apple menu,
the global menus and the macOS clock format on the left and Kiwi's status glyphs on the right. The
capsule the user has (Open Bar's floating pill with Blur My Shell's glass) is already closer to
Tahoe's menu bar over a wallpaper than GNOME-Tahoe's; what GNOME-Tahoe adds is the contents.

**The Control Center is a rewrite, not a restyle.** Kiwi's `tahoeQuickSettings.js` replaces GNOME's
quick settings with its own 320 px panel: Wi-Fi, Bluetooth and AirDrop pills, a media card, Dark and
Lock circles, a Focus pill, Display and Sound slider cards, a privacy pill and an edit mode, each piece a
glass region. The user's current quick settings keep GNOME's own toggles and give each one its own
Blur My Shell glass capsule. The two share the layout idea (pieces, no card); the port is the pieces'
sizes, grouping, slider cards and media card, done in the user's style, not a copy of the Kiwi panel.

**Apps are the same base.** GNOME-Tahoe themes no app. Files is Nautilus under MacTahoe, Settings is
GNOME Settings under MacTahoe. The only app-side differences are Kiwi's window-control icons and
Firefox/Thunderbird CSS, and the user's desktop already has MacTahoe's traffic lights and its own
glass window layer. Nothing to port there.

## Decision (after phase 1, 2026-10-19)

Phase 1 ran: upstream liquid-glass in the VM, side by side with the current glass
(`shots/compare-*.png`). The user judged it much worse. So: **keep Blur My Shell v76 as the
renderer** and port the shader parts worth having (lit rim, inner AO band, drop shadow) into
`config/bms-tahoe-glass.patch`; see the phase 1 result at the end of [refraction.md](refraction.md).

The user also asked for the **Control Center to be an exact copy** of the Tahoe one, with the
currently playing player in it as a card. Phase 4 below is rewritten for that.

## Phases

Each phase ends with VM screenshots in `docs/gnome-tahoe/shots/` and a note here. Nothing touches the
real desktop before the user says so, and then `scripts/tahoe-repair.sh` on `glass-bar` has to learn
the new pieces (coordinated with the user, since other sessions edit there).

| Phase | What | Test |
|---|---|---|
| 0 | Docs (this), approval | - |
| 1 | done: liquid-glass vs Blur My Shell side by side in the VM; verdict: keep Blur My Shell | VM |
| 2 | done (commit bb7e203): shader port into the Blur My Shell patch: a height-field normal at the edge, a directional Fresnel rim, an AO band inside the edge, a drop shadow outside it, each a parameter in `glass_params()`; the bar first, then menus, quick settings pieces, dock, apps through the same effect | VM |
| 3 | Tune the three modes (light, dark, milky) against the macOS references in `docs/liquid-glass.md` | VM |
| 4 | done: Control Center, exact copy: our own extension reproducing Kiwi's Tahoe panel (320 px, two columns; Wi-Fi, Bluetooth and a third pill; Now Playing card from the installed Now Playing extension's MPRIS data, art, title, prev/play/next; Dark and Lock circles; Focus pill; Display and Sound slider cards; privacy pill; Edit Controls), each piece a Blur My Shell glass capsule, with GNOME's real submenus reachable from the pills' arrows | VM |
| 5 | done in the VM: menu bar contents: macOS clock format, Apple menu (Kiwi Menu), optional global menus, status glyphs; decide per item with the user | VM |
| 6 | `glass-bar.sh` and `tahoe-repair.sh`: the switches, the state keys, the login enforcement; measure GPU on the RTX 3090 | real desktop, with go-ahead |

Phase 4 and 5 are independent of 1 to 3 once the renderer choice is settled; they can run in their
own sessions.

## Credits to carry into the repo

- liquid-glass: MIT, (c) ryohsuke1231. Copy the licence file next to anything taken from it.
- Kiwi (is not Apple) and micronixxx's Tahoe modules: GPL-3.0-or-later; a reimplementation of the
  Control Center layout in our own code is fine, verbatim copies need the licence header kept.
- Blur My Shell: GPL-3; the refraction shader is a GPL-relicensed port of winaviation's liquid-ass,
  per the header in `effects/refraction/refraction.glsl`.
- GNOME-Tahoe itself: GPL-3.0; its own code is the Kiwi fork and the widgets extension.

## Status after the real-desktop apply (2026-10-19)

Phase 2 (rim light and edge shadow) is live on the desktop on every glass surface. Phase 4's
Control Center was tried and switched off at the user's choice; the per-piece quick settings stay.
Phases 3 (mode tuning), 5 (menu bar contents) and 6 (measurements) remain open.

Phase 5 (menu bar contents) is on the branch only: the user asked that the menu bar and its
icons be left as they are. Nothing from it is installed on the desktop.
