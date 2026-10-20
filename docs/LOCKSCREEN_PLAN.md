# A macOS Tahoe lock screen for GNOME 51: plan

Branch `claude/tahoe-lockscreen-7d95b6`. Nothing here is installed on the real desktop. Every phase
is tried in the headless lock harness (`tools/lockscreen/run.sh OUTDIR light|dark`), which locks a
throwaway shell, never the user's session, and screenshots it in light and dark.

| Phase | What | Status |
|---|---|---|
| 0 | Research and the possibility report (this file) | done, waiting on the questions at the end |
| 1 | The unlock arrow covered the password eye | done (7b28b83), not installed |
| 2 | Tahoe layout: clock and date at the top centre, avatar, name and password capsule at the bottom, blurred wallpaper, notifications and media, bottom-right buttons | waiting on the questions |
| 3 | The Liquid Glass clock: time and date cut out of the glass | |
| 4 | Lock screen widgets, with privacy rules | |
| 5 | Unlock animation (tahoe-motion springs) and polish | |
| 6 | Shipping: `scripts/tahoe-lockscreen.sh`, tahoe-repair, real-desktop check | needs the user's go-ahead |

## Phase 0: findings

### How GNOME 51 draws the lock screen

- The lock screen is the same gnome-shell process in session mode `unlock-dialog`.
  `Main.screenShield` puts an `UnlockDialog` into `Main.layoutManager.screenShieldGroup`. The
  dialog has two pages on an `St.Adjustment`:
  - the clock page (`UnlockDialogClock`: time, date, "Click or press a key");
  - the prompt page (`AuthPrompt`: avatar, name, password entry, the "Switch User…" button at the
    bottom right).

  The wallpaper behind both is `Shell.BlurEffect` with radius 90 and brightness 0.65, faded in as
  the page slides. Blur My Shell's lockscreen component replaces it with its own pipeline.
- **Extensions:** extensions without `"session-modes": [..., "unlock-dialog"]` are disabled when
  the screen locks. The harness log shows this on this machine:
  - **User Themes is disabled while locked.** The lock screen therefore draws with the **system
    shell theme**, `/usr/share/gnome-shell/gnome-shell-theme.gresource`.
    - That file was replaced on Oct 18 by MacTahoe's GDM build; the original is beside it as
      `.bak`.
    - Our `config/gnome-shell-overrides.css` never reaches the lock screen.
  - **Blur My Shell stays enabled.** It lists unlock-dialog and keeps its pipelines alive.
- **Where lock screen CSS can live:**
  - An extension's `stylesheet.css` is loaded while that extension is enabled. An unlock-dialog
    extension is therefore the one place our lock screen CSS can live without touching root-owned
    files.
  - Editing the system gresource would need root, and an update or a MacTahoe reinstall
    overwrites it.
- **Precedent:** WACK (Sonoma lock screen, vendored in micronixxx/GNOME-Tahoe) shows the pattern.
  It patches the dialog *instance* (`Main.screenShield._dialog`), swaps the clock for its own,
  replaces the dialog's layout manager, and leaves the auth prompt alone.

### macOS Tahoe's lock screen

Sourced:
- **Clock material:** the large clock has the same Liquid Glass transparency as on iPhone and iPad.
  Its transparency is fixed, and users on plain dark wallpapers complain that it is hard to read.
  ([MacStories](https://www.macstories.net/stories/macos-tahoe-the-macstories-public-beta-preview/),
  [Apple Community](https://discussions.apple.com/thread/256155212))
- **Clock settings:** in System Settings > Wallpaper > Clock Appearance there are six typefaces and
  a weight slider, but no size control. Unlike iOS, the clock never tucks behind the subject of
  the photo. "Show large clock" can be set to Lock Screen, Lock Screen and Screen Saver, or Never.
  ([Apple feature list PDF](https://www.apple.com/os/pdf/All_New_Features_macOS_Tahoe_Sept_2025.pdf),
  [MacRumors](https://www.macrumors.com/guide/macos-tahoe-hidden-features),
  [iDownloadBlog](https://www.idownloadblog.com/2025/10/22/tips-to-customize-mac-lock-screen/))
- **Layout:** the Sonoma layout carries over. Date and time are at the top centre; a smaller avatar
  and the password field are at the bottom; an optional lock message can be shown.
  ([MacStories Sonoma review](https://www.macstories.net/stories/macos-sonoma-the-macstories-review/3/))
- **Widgets: macOS 26 has none on the lock screen.** Third-party apps exist to fill that gap.
  Widgets on our lock screen go beyond Tahoe, in the style of iPadOS.
  ([Digital Trends](https://www.digitaltrends.com/computing/this-free-mac-app-puts-stunning-glassy-widgets-on-your-lock-screen/))
- **Liquid Glass setting (26.1):** Clear or Tinted. Tinted makes lock screen notifications more
  opaque. ([MacRumors](https://www.macrumors.com/2025/11/03/apple-releases-macos-tahoe-26-1/))

Not confirmed by a source (from memory of screenshots; a reference screenshot from the user
would settle these):
- **Clock:**
  - The default face is a heavy, tall SF design.
  - The date is a small semibold line *above* the time.
  - The clock block is about 12 to 15 % of the screen height and starts about 8 to 10 % from the
    top.
- **Bottom of the screen:**
  - A small round avatar, the name, and an "Enter Password" capsule.
  - A circular → appears inside the capsule once you type.
  - There is no show-password eye.
  - ⇪ shows inside the capsule when Caps Lock is on.
  - A wrong password shakes the capsule.
- **Prompt state:** the wallpaper blurs and dims. On unlock, the clock and prompt fade out while
  the blur clears. No zoom.

### The reference repos (cloned read-only, nothing run)

| Repo | Lock screen work |
|---|---|
| micronixxx/GNOME-Tahoe | Vendors **WACK** (shell 46 to 50, `session-modes: ["unlock-dialog"]`): its own clock in flat white text at an alpha sampled from the wallpaper (not glass), a Sonoma layout, prompt blur that follows the slide, and blurred notification cards. Also Blur My Shell's lockscreen blur. Nothing styles the eye or the arrow. |
| kem-a/kiwi-kemma | None. It only listens to `active-changed` and adds Caps/Num Lock icons to the top bar. |
| ryohsuke1231/liquid-glass | None. There are no session-modes, so it is off while locked. Its Glass Clock is a desktop widget. |
| jaxparrow07/liquidglass-kde-widgets | None: no kscreenlocker or SDDM theme. Its `ios_*` faces are desktop clock styles. |

Nobody draws a glass clock on the GNOME lock screen. If "the previous GitHub" meant another repo,
it isn't one of these four.

### What is possible

- **Restyle and re-lay-out GNOME's own unlock dialog** from an unlock-dialog extension: CSS plus a
  layout manager on the dialog, as WACK does. This covers the clock position, the date above the
  time, the bottom prompt, the capsule, the buttons and the notification cards. Phase 1 already
  uses this route, CSS only.
- **The glass clock.** The tahoe-widgets Glass Text clock (`glasstext.js`) already cuts Blur My
  Shell's glass to glyphs:
  - a cairo mask, redrawn once a minute;
  - a shader that bends and lights each stroke.

  Scaled up to the lock clock, with the date line above it, it reads the lock wallpaper through
  the digits as Tahoe does. Its cost is one mask a minute plus the shader when that area repaints.
- **Glass on the lock screen.** The lock background is a still picture, so the widgets' approach
  (`glass.js`: a static copy of the wallpaper run through a Blur My Shell pipeline) is exactly
  right there. No live capture is needed, and Blur My Shell's pipelines stay alive while locked.
  - The copy must come from the *lock* background (`org.gnome.desktop.screensaver picture-uri`),
    not the desktop one.
  - It has to follow the clock-to-prompt blur. The plan is to redraw on page change rather than
    every frame.
- **Widgets.** The same modules (clocks, weather, music, calendar) can be built a second time
  inside the dialog's actor tree. The desktop widgets can't show through, because the shield
  covers the desktop layer.
- **Unlock animation:** reuse tahoe-motion's springs on the dialog's own fade and slide.

### What is not possible, or not worth it

- **The GDM login screen** after boot or logout. It is a separate shell running as the `gdm`
  user, with its own extensions and theme. This plan covers the lock screen of the running
  session only. GDM would be a separate project, through its theme or a system-wide extension.
- **Live refraction of moving content.** There is nothing moving behind the lock screen, so
  nothing is lost.
- **Exact Tahoe fonts or Touch ID.** We use SF Pro from `scripts/sf-fonts.sh`. Fingerprint unlock
  works through GNOME's own fprintd support, unchanged.

### Security rules (apply to every phase)

- **Never touch authentication.** GNOME's `AuthPrompt`, `UserVerifier`, `ScreenShield` lock state
  and key handling stay as they are. The extension only adds actors and restyles. If it fails,
  the stock dialog is what is left.
  - Patches go on the dialog *instance* after it exists, as WACK does, never on prototypes the
    prompt uses.
  - Each hook is wrapped so that an exception removes our actors and puts back the stock clock and
    layout.
  - An exception in `enable()` already leaves the extension in the ERROR state with the stock lock
    screen.
- **Nothing on the lock screen takes key focus.** Widgets are non-reactive. The exception is the
  media buttons, which take clicks only, as GNOME's own lock screen media controls already do. No
  text inputs, no menus, no right-click "Add widget" while locked.
- **No new services and no new network calls while locked.** Lyrics fetching is off. Weather uses
  the shell's own `WeatherClient`, the same as GNOME's lock screen panel.
- **Testing:** only in the headless harness. The real session is never locked by us.
- **One known gap, not ours:** code in an unlock-dialog extension runs in the shell with the same
  rights as in the user session. The extension adds no risk beyond what any installed extension
  already has. The risk it does add is breakage, which the fallback above covers.

### Privacy rules (Phase 4 proposal)

| Widget | While locked |
|---|---|
| Clocks, Glass Text clock | shown |
| Weather | shown (location name and conditions) |
| Music | Title, artist and art shown, as GNOME already shows the player on its lock screen; lyrics off. Option: "hide track details while locked". |
| Calendar | Date only by default; event titles hidden ("2 events" plus times). Option to show titles. |
| Notifications | GNOME's own rules (the per-app "show on lock screen" and "show details" switches), restyled only |

## Questions for the user (asked with Phase 0)

1. **Route:** a separate `tahoe-lockscreen` extension (recommended; Phase 1 already is one) that
   reuses the widget modules, copied in from `extensions/tahoe-widgets@cachyos-tahoe` by its
   install script so the repo keeps one source. The alternative is letting tahoe-widgets itself
   stay on through the lock, which makes widget bugs lock screen bugs.
2. **Widgets:** which ones on the lock screen, and where? Tahoe has none. Options:
   - a row under the clock (iPadOS style);
   - a column at the left;
   - only Now Playing above the prompt.
3. **Privacy:** are the defaults in the table above right (calendar titles hidden, music shown)?
4. **Clock:** the default face (heavy SF Pro, or SF Pro Rounded as in our Glass Text widget),
   12 or 24 h, and the date format ("Monday 19 October" above the time). A screenshot of the
   look you want would help, since the sources don't pin the default face down.
5. **Phase 1 on the real desktop now?** It needs `tahoe-lockscreen` installed and enabled and a
   logout, because the running shell does not pick up a new extension. It changes only the
   password capsule.
