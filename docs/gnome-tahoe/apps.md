# Goal 3: Files, Settings and the other system apps

## Finding: the same base, nothing to port

GNOME-Tahoe does not theme applications. Its installer prints "please install the MacTahoe themes
and icons before running this script" and copies only extensions, two icons and wallpapers; no
GTK CSS, no Nautilus or Settings changes, no icon theme of its own. "Finder" in its screenshots is
Nautilus under MacTahoe, and the Finder word in its menu bar comes from Global Menu's app-name
label. The user's desktop runs the same MacTahoe GTK and shell theme, with more on top: the
generated SF icon theme, the GTK4 and GTK3 glass layers (`gtk_glass`, `gtk3_glass` in
`scripts/glass-bar.sh`), live blur behind every GTK window, rounded corners on every window.

What GNOME-Tahoe has around apps, and whether the desktop has it:

| GNOME-Tahoe | Where | Desktop now |
|---|---|---|
| macOS traffic lights in GTK apps | Kiwi `enable-app-window-buttons`: a managed `@import` block in `~/.config/gtk-4.0/gtk.css` | MacTahoe draws them already (see `docs/screenshots/hero.png`) |
| Window controls in the top bar for maximised windows | Kiwi `windowControls.js`, PNG icons | not present; macOS does not do this either |
| gtk.css follows the colour scheme | `gtk-theme-sync@micronix` (98 lines) | the light/dark follow service and `gtk_theme()` do this, with the glass block kept |
| Firefox and Thunderbird CSD styling | Kiwi | the browser in use is Brave; not applicable |
| Launchpad-style Applications window with categories | Kiwi `tahoeApps.js` (1,595 lines) replaces the app grid | GNOME's app grid, with the icon theme |
| macOS-style polkit dialog | Kiwi `polkit-dialog-macos` | GNOME's dialog, blurred by the menus module |
| Transparent windows while moving | `transparent-window-moving` | not present |
| Rounded corners | `Rounded_Corners@lennart-k` | `rounded-window-corners@fxgn`, GNOME 51 port in `config/rwc-gnome51` |
| Glass behind app windows | liquid-glass application glass (whitelist, content opacity) | Blur My Shell apps pipeline, every GTK app, with the translucent chrome layer |

Files and Settings are therefore effectively the same, and the desktop's app layer goes further
than GNOME-Tahoe's. Skipped.

## Optional items noticed, not in the plan

If wanted later, each is small and independent:

- The Launchpad window (categories, search field, pills) as a replacement for the app grid; a
  rewrite in our own code, since Kiwi's is 1,600 lines tied to the liquid-glass snapshot.
- Kiwi's macOS-style polkit dialog.
- Transparent window moving (a stock extension, GNOME 51 unknown).
