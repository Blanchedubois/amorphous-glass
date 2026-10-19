# Goal 2: menu bar and Control Center in the floating capsule

## What the desktop has now

The top bar is Open Bar's floating pill (`bartype=Floating`, height 38, margin 4.8, radius 50
clamped to a pill, border 0.8 px white at 16 %, font SF Pro Text 10) with Blur My Shell v76's
static rounded blur and the Liquid Glass effect behind it (`bar_blur` in `scripts/glass-bar.sh`).
Left: Activities (dash dot) and nothing else; centre: date and clock; right: Vitals, Now Playing,
app indicators, the quick settings indicator. Quick settings open as GNOME's own panel without a
card, every toggle, slider, system button and opened submenu blurred on its own as a capsule
(`config/bms-tahoe-glass.patch`: `find_quick_settings_pieces`, radius 9999, `tahoe-glass.css`).
A sibling session added desktop widgets; another the light/dark follow service.

## What GNOME-Tahoe's menu bar is

Not a capsule. A full-width, fully transparent panel (Kiwi: transparency level 0, panel blur off,
"panel gradient" on, which paints a dark fade at the top of the screen as macOS does over a bright
wallpaper). Its contents, left to right in `docs/screenshots/desktop.png`:

| Item | Extension | Notes |
|---|---|---|
| Apple logo menu | Kiwi Menu (`kiwimenu@kemma`, v34, GNOME 45 to 51) | About, System Settings, App Store command, Recent Items, Force Quit, Sleep/Restart/Shut Down, Lock, Log Out, user switcher |
| Finder, File, Edit, View, Go, Window, Help | Global Menu for GNOME (`globalmenu@ShiroOSL.github.io`, v15, declares GNOME 45 to 50) | real menus over D-Bus (`org.gtk.Menus`, `org.gtk.Actions`) when the app exports them, else a shortcut catalogue of 169 apps ported from orbit-global-menu, else Window/View built from the window; app name in bold |
| (centre) nothing | Just Perfection hides the Activities button and the stock date menu position | |
| recording dot, keyboard layout, Spotlight glass, battery %, Control Center glyph, clock | Kiwi (`topbarStatusIcons.js`: Focus moon, airplane), `volume-percentage-quick-settings`, `spotlight@nin`, `display-brightness-ddcutil`, Kiwi `quickSettingsButton.js` with `assets/icons/controlcenter.png`, Kiwi `topbarClock.js` | clock text is `Вс 11 окт 0:50` (Russian abbreviations hard-coded) |
| ordering | Top Bar Organizer | |

Nothing in that list is glass. The capsule the desktop already has is the Tahoe menu bar look over
a wallpaper; what is missing from it is contents and the clock format.

## What GNOME-Tahoe's Control Center is

`kiwi@kemma/apps/tahoeQuickSettings.js` (2,915 lines, GPL-3.0-or-later, micronixxx's module in the
Kiwi fork) replaces GNOME's quick settings with its own overlay. Geometry from its header, in px:

| | |
|---|---|
| panel | 320 wide, padding 14, two columns of 137 with an 18 gap, 12 between rows; opens 12 px from the right edge, 10 px under the panel |
| pills (Wi-Fi, Bluetooth, AirDrop, Focus) | 137 x 80, radius 40: a 62 px circle with the glyph, title, subtitle |
| circles (Dark, Lock, screenshot, logout, theme) | 62, radius 31 |
| media card | 137 x 152, radius 28: art, title, prev/play/next |
| slider cards (Display, Sound) | full width, 96 tall, radius 28: title, slider, end button |
| privacy pill (mic/camera in use) | radius 18, only when active |
| Edit Controls pill | 28 tall, radius 15, bottom centre |
| panel background | an `St.Widget` under the glass with `box-shadow: 0 4px 22px rgba(0,0,0,.15), 0 12px 70px rgba(0,0,0,.10)` |

Each radius group is one `LiquidEffect` in multi-region mode (`_makeGlassStack`: pill, disc,
card, music, priv, edit, and a "backdrop" stack that is pure blur, radius 82, fading over 60 px, so
the whole panel sits on a soft blur). Material in dark mode: tint rgb 0.16,0.16,0.18 at 0.12,
brightness 1.0 (1.3 in light), saturation 0.85, blur 8, refraction scale 92, IOR 2.4, chroma
0.006, edge 2, profile 7, depth 25, rim 0.08 at width 5. Per-region fill under each element
rgb 0.05,0.05,0.07 at 0.10 (dark) or 0.78,0.78,0.80 at 0.10 (light); a circle that is on is white
at 0.45.

Behaviour: non-modal (the session stays usable while it is open, a click outside closes it and
passes through), Escape closes; Wi-Fi toggles NM, Bluetooth the adapter, Focus is Do Not Disturb,
Dark flips the colour scheme, media is MPRIS, Display is brightness, Sound is Gvc, the privacy pill
polls PipeWire for mic and camera users; an edit mode drags controls around and resizes them.

What it gives up against GNOME's quick settings: the Wi-Fi network list, Bluetooth device list,
power profiles, night light, background apps, screen cast, the battery and power menu, and
anything other extensions add as toggles. The desktop's current quick settings keep all of those.

## The port

### Menu bar contents (phase 5), into the existing capsule

Keep Open Bar's pill and its glass. Add, each a switch in `glass-bar.sh` and enforced by
`tahoe-repair.sh`:

1. **Clock format**. macOS Tahoe shows `Sun 19 Oct 18:16`. GNOME's clock with
   `clock-show-weekday` and `clock-show-date` on gives `Sun Oct 19 18:16` in an en_US locale; the
   month-day order follows the locale. A 40-line override of the date menu label, as Kiwi's
   `topbarClock.js` does, sets the exact string. Goes into the small extension of phase 4 so there
   is one extension to enforce.
2. **Apple menu**. Kiwi Menu from extensions.gnome.org (GNOME 51 is declared), index 0 on the
   left, Activities hidden, icon from our SF glyph set; its own menu gets the glass menus already
   on. Its Recent Items and user switcher read files the user may want off; both are settings.
3. **Control Center glyph**. One SF `switch.2` glyph in place of GNOME's network, volume and power
   indicator icons, as macOS and GNOME-Tahoe show; a CSS rule for the indicator plus one icon file,
   the way the icon theme already replaces shell glyphs. Battery percentage next to it when a
   battery exists (not on this desktop).
4. **Global menus**: not by default. Global Menu for GNOME does not declare GNOME 51, needs
   `disable-extension-version-validation` (already on for Open Bar), and on GTK4 apps shows
   prettified action names, which is not what macOS shows. Try it in the VM in phase 5 and let the
   user see it before deciding.
5. **Focus moon and airplane glyphs**: cheap, from DND and NM state, with the clock override.

Text stays SF Pro Text Regular, white (dark text in light mode, as `shell_theme()` already does).

### Control Center (phase 4): an exact copy, with the Now Playing card

Changed after phase 1 at the user's request: the Control Center is to be copied exactly, with the
currently playing player present as a card. So the panel is rebuilt as Kiwi's is, in our own
extension `extensions/tahoe-control-center@cachyos-tahoe` (GPL-3, crediting micronixxx's
`tahoeQuickSettings.js` where its structure is followed): the geometry table above to the pixel,
a 320 px panel 12 px from the right edge and 10 px under the bar, non-modal with click-through
dismissal, and in the right column the 137 x 152 media card fed by MPRIS (the same source the
installed Now Playing extension uses: art, title, artist, previous, play/pause, next, the active
player chosen as Now Playing chooses it). GNOME's own quick settings stay installed and reachable:
the Wi-Fi, Bluetooth and power pills open GNOME's corresponding submenus from their arrow, so the
network list, device list and power profiles are not lost. Each piece is a Blur My Shell glass
capsule through the existing per-piece patch (the pieces get the patch's style classes), with the
shader port of phase 2 giving them the rim and shadow.

The earlier plan, kept here for reference, was to rearrange GNOME's toggles instead:

Rearrange them into Tahoe's grid with a small extension of our own,
`extensions/tahoe-control-center@cachyos-tahoe` (GPL-3), so every toggle keeps its menu and
function and the per-piece Blur My Shell glass keeps working (it finds pieces by style class and
by `QuickMenuToggle` type, both unchanged by reparenting):

1. Width 320 and padding 14 on `.quick-settings`; the grid replaced by two `St.BoxLayout`
   columns of 137 with the 18 gap.
2. Wi-Fi, Bluetooth and the third `QuickMenuToggle` (power mode here, where macOS has AirDrop) as
   80 px pills in the left column: GNOME's toggles already carry title and subtitle; CSS makes them
   taller, moves the icon into a 62 px circle and keeps the arrow as the capsule's right end.
3. Right column: a 152 px media card made from the Now Playing extension's card (already
   installed and restyled as macOS's Now Playing) or GNOME's MPRIS section from the calendar, then
   a row of 62 px circles: Dark Style (GNOME's toggle), lock (system item), screenshot.
4. Focus (Do Not Disturb) as a 62 px pill across the right column; the remaining toggles (Night
   Light, Background Apps, others) in a row of circles under it so nothing is lost.
5. The brightness and volume `QuickSlider`s as 96 px full-width cards with a title label added
   above the slider; GNOME's slider actors keep their behaviour.
6. The system row (settings, lock, power) becomes the circles above; the power menu stays reachable
   from the power circle.
7. Reflow on `child-added` and on open (the Blur My Shell patch already re-scans on open), so
   toggles added later by extensions land in the circles row.
8. The panel background and shadow: no card, as now; optionally Kiwi's soft shadow under the whole
   group through a pure-blur backdrop if phase 1 picks liquid-glass.

Radii: pills and circles stay 9999 (capsule), cards 28, as the Blur My Shell per-piece radius
rules already allow (`QUICK_SETTINGS_ROUND_STYLE_CLASSES`, one new class for cards).

### Mechanics to keep from the current quick settings

The user liked the current quick settings; the port keeps: GNOME's toggles and submenus, the
per-piece capsule glass and its edge, the dark/light handling in `tahoe-glass.css`, the white
"on" fill with accent text, and the split toggle drawn as one capsule.

## Risks

- Reparenting GNOME's quick settings grid: `QuickSettingsMenu` adds items through `addItem` with
  column spans and expects its `QuickSettingsLayout`; an extension that adds a toggle after ours
  must still land somewhere sensible. Mitigated by reflowing on `child-added` and by leaving the
  original grid in place, hidden, as the registry.
- Kiwi Menu on GNOME 51: declared, but it is the unmodified EGO build, not micronixxx's fork; the
  fork's changes are elsewhere (the Tahoe modules), so nothing is lost.
- Open Bar is not GNOME 51 validated either; it already runs with validation off.
- Clock override: Kiwi's hard-codes Russian; ours formats from the locale and `WallClock`.

## Test plan

VM, mirror user, screenshots in `docs/gnome-tahoe/shots/`:

1. Bar: capsule with Apple menu, clock format, Control Center glyph; compare with
   GNOME-Tahoe's `desktop.png` crop and macOS Tahoe references in `docs/liquid-glass.md`.
2. Control Center open: measure pill and circle sizes in the screenshot against the table above
   (within 2 px), check every GNOME toggle is still present and opens its submenu
   (`click.sh` on Wi-Fi's arrow, Bluetooth's arrow), sliders move.
3. Disable and re-enable the extension: quick settings back to GNOME's grid with nothing missing.
4. Light mode: dark text on the pills, as `tahoe-glass.css` does for split toggles.


## Phase 4 result (VM, 2026-10-19)

`extensions/tahoe-control-center@cachyos-tahoe` (GPL-3, our own code) opens in place of GNOME's
quick settings and reproduces the reference the user supplied (macOS Tahoe's Control Center as
GNOME-Tahoe shows it), piece for piece:

| Piece | Backed by |
|---|---|
| Wi-Fi pill | NetworkManager: wireless on/off, the connection name as subtitle, blue glyph when on |
| Bluetooth pill | GnomeBluetooth: adapter power |
| AirDrop pill | a plain toggle (nothing on Linux to drive) |
| player card | MPRIS: the playing player, else the first; art, title, artist, previous / play-pause / next |
| Dark Style circle (white when on) | `color-scheme` |
| windows circle | the overview |
| screen circle (blue) | GNOME Settings, Displays |
| camera circle | GNOME's screenshot UI |
| Focus pill | Do Not Disturb (`show-banners`) |
| Display card | gsd-power screen brightness (greyed when there is no backlight, as in the VM) |
| Sound card | Gvc default sink, mute button |
| Edit pill | opens GNOME's own quick settings, so every submenu and extension toggle stays reachable |

Every piece is a button with a BinLayout: Blur My Shell's live dynamic surface (the popup
module's `DynamicPipeline`, on `pipeline_glassbar_menus`, so the glass is the same recipe as the
menus, rim and edge shadow included) at index 0, a fill layer above it for the hairline and the
"on" white, the content on top. Without Blur My Shell the fill layer shows a translucent fill.
The panel is 320 px, 12 px from the right edge, 10 px under the bar, non-modal: a click outside
closes it and goes through to what was clicked; Escape closes it.

Screenshots: `shots/cc-04.png` (open), compared against the user's reference. Found on the way:
GNOME 51's `St.BoxLayout` has no `vertical` property (use `orientation`), St accepts one
`box-shadow`, and a glass actor on a piece with no explicit width makes Blur My Shell's capture
fail to allocate its texture.

`scripts/tahoe-control-center.sh on|off|status` installs and switches it, state key
`controlcenter=on`; tahoe-repair needs the same two-line hunk the widgets have (keep the uuid in
WANT while installed and on), to be added on glass-bar with the user.

## On the real desktop (2026-10-19)

Installed with the shader port; after one login the user preferred the previous quick settings
layout (GNOME's toggles as per-piece capsules, now with the rim and edge shadow). The Control
Center is switched off (`tahoe-control-center.sh off`, state `controlcenter=off`, so tahoe-repair
leaves it off) and stays installed for `tahoe-control-center.sh on` later.

## Phase 5 result (VM, 2026-10-19)

`scripts/tahoe-menu-bar.sh on` gives the capsule its menu bar contents (`shots/mb-07-bar.png`,
`mb-02-applemenu.png`):

- **Apple menu**: Kiwi Menu v34 from extensions.gnome.org (GNOME 51 declared), icon 10 (the Apple
  logo), Activities hidden by its own setting. About This PC, System Settings, App Store, Recent
  Items, Force Quit, Sleep/Restart/Shut Down, Lock, Log Out, in the glass menus. Its user switcher
  button (shown when the machine has several user accounts, as the VM and the desktop do) still
  used `St.BoxLayout`'s `vertical`, removed in GNOME 51; the install script makes the one-word
  change to `orientation` after installing it, and the journal is clean (`shots/mb-08-switcher.png`).
- **Clock**: GNOME's own weekday setting on, "Mon Oct 19  7:29 PM", which is macOS's US format.
- **Control Center glyph** and **Focus moon**: `extensions/tahoe-menu-bar@cachyos-tahoe`, SF
  Symbols `switch.2` and `moon.fill` as symbolic SVGs. A panel button lays out only its first
  child, so the quick settings indicators box is detached (the indicators keep adding themselves to
  it) and the glyph takes its place; disable puts the box back.
- **Global menus**: not installed, as planned; Global Menu for GNOME does not declare GNOME 51.

State key `menubar=on`; tahoe-repair needs the same WANT hunk for both uuids as the widgets have.
