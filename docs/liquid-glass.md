# Liquid Glass for the Tahoe GNOME desktop

How macOS Tahoe layers glass, measured from reference screenshots (System Settings
light and dark, Control Center light, Spotlight/Launchpad dark, Finder dark), and the
tokens `scripts/glass-bar.sh` uses to reproduce it on GNOME 51.

## The layer model

Tahoe separates two kinds of surface:

| Layer | What | Look |
|---|---|---|
| **Content** | window bodies, lists, file views, text | nearly opaque; a faint hint of what is behind |
| **Glass** | sidebars, toolbars, menus, popovers, Control Center, Spotlight, notifications, Dock, menu bar | translucent, live-blurred, a light rim on the edge |

Glass floats on content; a control sitting on glass (a toolbar button, a Control Center
toggle) adds no blur of its own, only a translucent fill and the rim.

## Measured (sRGB, sampled from the references)

| Surface | Light | Dark |
|---|---|---|
| Window content | 255,255,255 (opaque white) | 43,46,67 over a blue wallpaper: about 30,30,33 at 80-90 % |
| Sidebar (inset glass pane) | 244,246,244: white at about 75-85 % | 36,39,52: dark grey at about 85 %, lighter edge |
| Cards / grouped rows | 247,247,247 | 55,55,66: a white lift of about 6-8 % |
| Buttons (pills) | white glass with a rim | 106,106,117: white at about 25-30 % |
| Overlay glass (Control Center, widgets, Spotlight, popovers) | clear: the wallpaper's own colour shows, white tint about 15-20 %, white text | smoky: about 20-40 % dark grey over the blurred wallpaper, white text |
| Rim | bright white, strongest on the top edge | white at about 15 % |

## Tokens used here

| Token | light | dark | milky (the tuned look before modes) |
|---|---|---|---|
| Overlay glass tint (Liquid Glass) | white, 0.18 | rgb 34,34,38, 0.42 | white, 0.12 |
| Overlay edge (bar, menus, quick settings, Dock) | white 0.25 | white 0.16 | white 0.12 |
| App window chrome (window_bg: header and sidebar areas) | 250,250,252 at 0.62 | 36,36,40 at 0.62 | theme dark |
| App content (view_bg: lists, file views, text) | white at 0.95 | 30,30,33 at 0.90 | theme dark |
| App sidebar | white at 0.30 over the chrome | black at 0.12 over the chrome | theme |
| App cards | white 0.55 | white 0.06 | theme |
| App buttons | white 0.45 fill, white 0.6 rim | white 0.10 fill, white 0.14 rim | theme |
| App window outline | white 0.35 | white 0.12 | none |
| Shell text | white | white | white |

`light` and `dark` switch the GTK theme with them (MacTahoe Light or Dark, and the
system colour scheme); `milky` keeps dark apps under the milky glass shell.

Files (Nautilus) keeps the theme's own look in every mode.

Every GTK app gets the live blur behind its window, not only a hand-picked list. The glass layers
make GTK backgrounds translucent, so an app without the blur would show the bare desktop through
its header bar. `scripts/glass-app-ids.py` builds Blur My Shell's whitelist from the installed
desktop entries. An entry counts when its program links GTK 4 or GTK 3, or when it is a script
using GTK, libadwaita or pywebview (vut-map, for one). tahoe-repair rebuilds the list at each
login, so newly installed apps join it. GTK3 apps keep the solid theme for their content. A
marked block in `~/.config/gtk-3.0/gtk.css` gives their window background the window glass token
and makes the header bar clear over it, with the hairline under it.

## Switching modes

```bash
bash scripts/glass-bar.sh mode light   # Tahoe light: light glass and dark text, light apps
bash scripts/glass-bar.sh mode dark    # Tahoe dark: smoky glass and white text, dark apps
bash scripts/glass-bar.sh mode milky   # the pre-mode look: milky glass over dark apps
```

The mode applies at once; apps opened before the switch pick it up when reopened.
tahoe-repair keeps the chosen mode at every login: the shell theme (MacTahoe Light in light
mode, with the Dark theme's overrides carried over), the GTK theme and colour scheme, which
GTK4 stylesheet `gtk.css` points at, Blur My Shell's menu style, window opacity and the
GTK4 glass block.

In light mode Tahoe puts dark text on light glass; the light shell theme, dark top-bar
text and Blur My Shell's light menu style do that here.
