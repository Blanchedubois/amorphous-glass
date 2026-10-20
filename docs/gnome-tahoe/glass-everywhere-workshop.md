# Liquid Glass everywhere: workshop

The question (user, 2026-10-19): where else on the desktop can Liquid Glass go? Menus, window
headers, app folders, folder selection, and so on. This is the list to pick from. It is
implemented later in phases.

## How this was studied

`tools/headless/run.sh` with `TAHOE_TEST_ONLY=survey` and `TAHOE_TEST_USERLOOK=1` runs a
throwaway GNOME Shell. It uses the user's settings, shell theme, icons, GTK glass layer and
extensions (dock, widgets, Vitals, Open Bar, rounded corners), with no real screen captured. It
takes a still of every shell surface, then opens Files, Text Editor, Calculator, Settings, a
folder picker and a GTK dialog inside the test shell and takes stills of those. Stills are in
`shots/workshop-*.jpg`. The lock screen is left out: a separate session works on it.

## What has glass today

| Surface | Glass | How |
|---|---|---|
| Top bar | Liquid Glass (static) | Blur My Shell panel, Open Bar pill |
| Dock | Liquid Glass | Blur My Shell dash-to-dock |
| Top bar menus, dock menus, desktop menu, window menu | Liquid Glass, animated | patched popup module, tahoe-motion |
| Quick settings, its submenus, calendar, notification banners | Liquid Glass, animated | same |
| Alt-Tab switcher, workspace switcher, volume/brightness OSD, resize popup | Liquid Glass, not animated | popup module (`switcher-list`, `osd-window`, …) |
| Modal dialogs (Power Off, polkit, run dialog), screenshot toolbar, input method popup, on-screen keyboard | Liquid Glass, not animated | popup module (`modal-dialog`, `run-dialog`, …) |
| GTK4 popovers and menus, GTK3 context menus (every app) | Liquid Glass, animated open | app-menu glass, tahoe-motion |
| App windows of about 120 whitelisted apps | live blur behind the whole window. Chrome is translucent (the GTK glass layer), content nearly opaque | Blur My Shell applications, `gtk_glass` |
| Desktop widgets | Liquid Glass | tahoe-widgets |
| Overview background, app folder popup | plain blur only (`pipeline_migrated_dynamic_blur`), no Liquid Glass rim or tint | Blur My Shell overview, appfolder |

## Candidates

Each row says what the survey showed, what Liquid Glass would look like there, how it would be
done, and its effort and risk. The mechanisms are:

- **S (shell CSS):** the shell overrides (`config/gnome-shell-overrides.css`) and tokens on a
  surface that already has glass.
- **P (patch):** a new style class in the patched Blur My Shell popup module (`targets.js`).
  The surface then gets the full glass shader, with no new rendering code.
- **G (GTK CSS):** the GTK glass layer (`gtk_glass`). GTK cannot run the shader, so a GTK surface
  shows the window's blur through translucent areas and draws its rim in CSS.
- **M (motion):** tahoe-motion morphs for surfaces that appear today without the liquid
  animation.

### A. Overview and launching apps

| # | Surface | Today (survey) | Liquid Glass version | How | Effort / risk |
|---|---|---|---|---|---|
| A1 | **App folder popup** ("System" etc.) | a dark plain-blur card, no rim, its own radius (`workshop-overview-folder.jpg`) | the menus' Liquid Glass at the calendar radius (32): tint, rim light, edge line in dark mode. App icons stay as they are | P: switch the appfolder pipeline to `pipeline_glassbar_menus`, radius key; S: clear its CSS fill | small / low |
| A2 | **App folder opening** | GNOME's zoom from the folder icon | the folder icon (a glass tile) pours into the popup, with the drop and the row stagger of the menus | M: a CardPiece on the folder dialog, origin the folder icon | medium / medium (the dialog has its own zoom to replace) |
| A3 | **Folder tiles in the app grid** | GNOME's translucent rounded square behind the mini icons | small Liquid Glass tiles, the widgets' 24 radius | P: style class `app-folder` on the icon's background; S | medium / perf: up to about 20 tiles on screen, frozen while the grid scrolls |
| A4 | **Overview search field** | a flat translucent strip (`workshop-search.jpg`) | a glass capsule like Spotlight's | P: `search-entry` class; S: capsule radius, no fill | small / low |
| A5 | **Search results** | bare icons and text floating on the wallpaper | one glass panel behind the results (Spotlight's result list), rows at the menu row radius | P: `search-results` / `list-search-results` class | medium / medium (the panel grows with results; follows like a resizing menu) |
| A6 | **Window titles in the overview** (hover caption under a window) | GNOME's dark pill | small glass capsules | P: `window-caption` class | small / low |
| A7 | **Workspace thumbnails strip** | wallpaper thumbnails with no frame | a glass tray behind the strip, like the dock | P or S | medium / low |
| A8 | **App grid page dots and "Show Apps"** | flat dots | glass dots (only if A3 is done) | S | small / low |

### B. Window chrome (headers, sidebars, dialogs)

| # | Surface | Today (survey) | Liquid Glass version | How | Effort / risk |
|---|---|---|---|---|---|
| B1 | **Header bar controls** (back/forward, path bar, view buttons, menu) | flat dark chips on an opaque header (`workshop-files-header.jpg`) | macOS Tahoe's floating toolbar: button groups as glass capsules with a rim, over the window's blur | G: capsule radius, translucent fill, inset rim highlight on `headerbar button`, `linked`, the path bar | medium / medium (every app's headers; Files is outside the layer today, a choice to revisit) |
| B2 | **Header bar itself** | opaque in Files, transparent over a dark window in others | transparent, so content scrolls under the floating capsules (Tahoe) | G | medium / medium (readability over busy content) |
| B3 | **Floating sidebar** (Files, Settings, Text Editor, file picker) | Files: glass sidebar to the window edge. Settings and the file picker: near-opaque dark (`workshop-settings.jpg`) | Tahoe's inset sidebar: a glass panel with a margin and the window radius minus the margin, the same in every app | G: one sidebar rule for all apps (Files included), tokens for the inset | medium / medium (libadwaita split views differ per app) |
| B4 | **Folder selection / file picker** (the portal dialog used by every app) | opaque dark, sidebar and header included (`workshop-file-chooser.jpg`) | same chrome as Files: glass sidebar, glass toolbar capsules, an OK capsule button | G (B1 and B3 applied to the picker); check that `xdg-desktop-portal-gnome` windows get the blur (they are on the whitelist) | small once B1 and B3 exist / low |
| B5 | **GTK alert dialogs** (questions, confirmations: zenity, "Discard changes?") | a small opaque dark box, square-ish buttons (`workshop-gtk-dialog.jpg`) | a glass sheet with capsule buttons, as macOS Tahoe alerts | G for dialogs that are their own window. Dialogs drawn inside their parent window (libadwaita `AdwDialog`) cannot be blurred separately: a translucent fill over the parent at most | small / low (separate windows), not possible (in-window) |
| B6 | **Window title buttons** (traffic lights) | MacTahoe's | unchanged; macOS keeps them plain | none | — |
| B7 | **Toasts and in-window popups** (GTK4 toasts, GTK3 popovers) | opaque | cannot be blurred: they are drawn inside the window, and GTK has no backdrop blur | out of scope | — |

### C. Shell overlays

| # | Surface | Today (survey) | Liquid Glass version | How | Effort / risk |
|---|---|---|---|---|---|
| C1 | **Volume and brightness OSD** | a small dark pill sitting on the dock (`workshop-osd.jpg`) | macOS Tahoe's HUD: a glass capsule under the menu bar on the right, icon and level bar | S: move and restyle `osd-window`; it already has glass | small / low |
| C2 | **OSD appearing** | fades in | the capsule drops and pours out of the volume icon in the menu bar | M | small / low |
| C3 | **Alt-Tab switcher** | glass panel, but the selection is a dark square (`workshop-alt-tab.jpg`) | the selection as a concentric rounded glass lift (radius = panel radius minus gap), app name under it | S | small / low |
| C4 | **Alt-Tab and workspace switcher appearing** | instant | a quick pour (partial mode, as menu skimming) | M | small / medium (must stay instant on fast Alt-Tab) |
| C5 | **Run dialog** (Alt+F2) | dark box, flat field with a blue ring (`workshop-run-dialog.jpg`) | a Spotlight-style glass bar: one capsule with the field inside, no box | S: `run-dialog` restyle | small / low |
| C6 | **Power Off, polkit and other system dialogs** | glass box, flat buttons | capsule buttons, standard radii, the dialog pours in | S + M | small / low |
| C7 | **Screenshot toolbar** | glass panel, flat mode buttons | buttons as glass chips like the quick settings capsules | S | small / low |
| C8 | **Dock labels** (app name on hover) and running dots | dark pill labels | small glass capsules | P: `dash-label` class | small / low |
| C9 | **Tooltips** (shell and apps) | plain | unchanged: macOS keeps tooltips plain (`docs/STANDARD.md`) | none | — |

### D. Bigger ideas

| # | Idea | Notes |
|---|---|---|
| D1 | **Launchpad**: the app grid as one glass sheet with categories and a search capsule | `apps.md` noted Kiwi's 1,600-line version. A rewrite of our own; a project on its own |
| D2 | **Overview background as glass**: the workspace sits on a frosted Liquid Glass backdrop instead of the blurred wallpaper | P: overview pipeline to the glass recipe; cost: the whole screen through the refraction shader, measure first |
| D3 | **Notification Center** as a separate glass column (macOS), split from the calendar | layout work in the date menu; glass already there |
| D4 | **Login screen (GDM)** | system-wide, needs root and a GDM theme; outside this home-folder setup |
| D5 | **Browser and Electron apps** (Brave, Discord, Steam) | they draw their own menus and chrome; only the window blur behind them is possible (Spotify is already on the whitelist) |

## Suggested phases

1. **Quick shell wins (S, P):** A1 app folder glass, A4 search capsule, A6 overview captions,
   C1 OSD HUD, C3 Alt-Tab selection, C5 run bar, C7 screenshot chips, C8 dock labels. These are
   restyles of surfaces that already have glass, or one new style class each. Measured with the
   stress suite, like the menus.
2. **Window chrome (G):** B1 toolbar capsules, B3 floating sidebar, B4 file picker, B5 alert
   dialogs, B2 transparent header last. Shot per app (Files, Settings, Text Editor, the picker)
   in light and dark.
3. **Overview depth (P):** A3 folder tiles, A5 search results panel, A7 workspace tray, A8 dots.
4. **Motion for the new surfaces (M):** A2 folder pour, C2 OSD drop, C4 switcher pour, C6 dialog
   pour, reusing tahoe-motion's CardPiece.
5. **Bigger ideas, one at a time if wanted:** D1, D2, D3.

## Questions for the user

- Should Files join the GTK glass layer (B1, B3), so all apps share one chrome? Today Files
  deliberately keeps the theme's own look.
- B2 transparent headers: content scrolling under floating capsules is the Tahoe look, but it is
  busier to read. Try it?
- C1: OSD at the top right under the menu bar (macOS Tahoe), or keep it at the bottom above the
  dock?
- D1 Launchpad and D2 glass overview: worth their cost?

## Phase 1 result (2026-10-20, headless; not installed yet)

| # | Surface | Done | Before → after |
|---|---|---|---|
| A1 | App folder popup | Blur My Shell's app folder glass on the menus' Liquid Glass pipeline (`glass-bar.sh menus on`, kept by `tahoe-repair.sh`), radius 32 from the CSS, no fill, dark edge | `shots/phase1-folder.jpg` |
| A4 | Overview search field | glass-look capsule in CSS: tint, 1 px edge, top highlight, no focus ring | `shots/phase1-search.jpg` |
| A6 | Overview window captions | glass-look capsules in CSS (`chip` tokens; they sit over thumbnails) | — (hover only) |
| C8 | Dock app names | real glass capsules: `dash-label` is a popup glass target in the patch | `shots/phase1-dock-label.jpg` |
| C3 | Alt-Tab, workspace switcher | glass and CSS both 28 (the glass was 28 under a 24 shape), items 20, selected a glass lift instead of the accent | `shots/phase1-alt-tab.jpg` |
| C5 | Run dialog field | a large glass capsule, no accent ring (the ring came from Blur My Shell's own popup styles, which outrank the theme; fixed in the patch's styles for this field only, so password fields keep their focus ring) | `shots/phase1-run.jpg` |
| C7 | Screenshot toolbar | mode and pointer buttons as glass chips; the photo/video switch keeps Blur My Shell's segmented look | `shots/phase1-screenshot.jpg` |
| A3 | Folder tiles in the app grid (user asked, 2026-10-20) | glass look in CSS at the folder popup's 32 px: lit from the top (white gradient 0.20 → 0.07), rim, top highlight, soft lift; one recipe for every mode, since the grid always sits on the blurred wallpaper | `shots/phase1-folder-tiles.jpg` |
| C1 | Volume / brightness OSD | a glass capsule (glass 9999, it was 48 under a 24 shape), lifted clear of the dock, white level bar; kept at the bottom (top right under the bar is a later choice) | `shots/phase1-osd.jpg` |

Tokens: `switcher`, `osd`, `folder` radii and their Blur My Shell keys in `tokens/radius.json`, `chip` and `chip_text` in `tokens/glass.json`; `docs/STANDARD.md` lists the new surfaces.

Stress, current main → phase 1, same harness run side by side:

| Case | Frame p95 | Slow frames | Handlers, actors |
|---|---|---|---|
| dock label hover ×30 | 9.0 → 9.0 ms | 0 → 1 | flat |
| volume OSD ×30 | 9.5 → 9.3 ms | 1 → 1 | flat |
| app folder open/close ×20 (with the overview) | 11.0 → 11.1 ms | 82 → 84 (the overview's own animation, both) | flat |
| desktop right-click ×50 | 9.1 → 9.1 ms | 1 → 1 | flat |

Full suite on phase 1: nothing stuck, no JS errors. Found on the way: the "desktop right-clicks stop" of
earlier stress runs was the test shell itself. GNOME sometimes opens the overview at startup,
and over the desktop it took the desktop's clicks. The driver now closes it before each case.
