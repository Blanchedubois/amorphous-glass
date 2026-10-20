# A macOS Tahoe lock screen for GNOME 51: plan

Branch `claude/tahoe-lockscreen-7d95b6`. Nothing here is installed on the real desktop. Every phase
is tried in the headless lock harness (`tools/lockscreen/run.sh OUTDIR light|dark`), which locks a
throwaway shell, never the user's session, and screenshots it in light and dark.

Scope, decided 2026-10-20 after the [risk assessment](lockscreen/widget-risks.md): **the Liquid
Glass clock and Now Playing only.** No calendar, weather or other widgets. The look to match is
Apple's macOS Tahoe press image the user picked (see "The target" below).

| Phase | What | Status |
|---|---|---|
| 0 | Research, possibility report, risk assessment | done (d225f3a, 24db9fe) |
| 1 | The unlock arrow covered the password eye | done (7b28b83), not installed |
| 2 | Safety frame: guards and tests, nothing visible changes | done, not installed |
| 3 | Tahoe layout with a plain clock: date above time at the top, prompt at the bottom | done, not installed; waiting on the user's look |
| 4 | The Liquid Glass clock | in the workshop: clear glass, sharp wallpaper, dark-mode tint |
| 5 | Now Playing: GNOME's own media card as a Tahoe glass card | |
| 6 | Motion: lock, page change and unlock animations | |
| 7 | Shipping: VM check, install, tahoe-repair, merge | each step needs the user's go-ahead |

The detailed plan for phases 2 to 7 is in
[Implementation plan: clock and Now Playing](#implementation-plan-clock-and-now-playing) at the end.

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

### Privacy rules (the earlier widget proposal, superseded by the scope above)

The full risk assessment, with fault-injection results, is in
[lockscreen/widget-risks.md](lockscreen/widget-risks.md).

| Widget | While locked |
|---|---|
| Clocks, Glass Text clock | shown |
| Weather | shown (location name and conditions) |
| Music | Title, artist and art shown, as GNOME already shows the player on its lock screen; lyrics off. Option: "hide track details while locked". |
| Calendar | Date only by default; event titles hidden ("2 events" plus times). Option to show titles. |
| Notifications | GNOME's own rules (the per-app "show on lock screen" and "show details" switches), restyled only |

## Questions asked with Phase 0, and where they stand

1. Route: a separate `tahoe-lockscreen` extension. Settled by the scope: no widget modules are
   needed, so nothing is copied from tahoe-widgets except the glass text technique (Phase 4).
2. Widgets: settled. The clock and Now Playing only.
3. Privacy: settled by the scope. Now Playing follows GNOME's own per-app switch (see Phase 5).
4. Clock: the user sent the look (Apple's Tahoe press image). The remaining details are workshop
   questions in Phase 3 and 4.
5. Phase 1 on the real desktop: deferred to Phase 7, installed together with the rest.

## Implementation plan: clock and Now Playing

### The target

Apple's macOS Tahoe press image (MacBook Pro, "Tue Apr 1 / 9:41"; [copy](lockscreen/shots/reference-tahoe-press.png), Apple's, for reference only). Measured on it and scaled to
2560×1440:

| Element | In the image | At 2560×1440 |
|---|---|---|
| Date | one short line, "Tue Apr 1", semibold, white, centred; top at about 11 % of the screen height | "Tue Oct 20", about 32 px type, top near 158 px |
| Time | "9:41", no AM/PM, heavy SF, about 10 % of the screen height tall, about 4 px gap under the date line per 100 px of digit | digits about 140 px tall (about 200 px type) |
| Time material | milky white glass: the wallpaper's colour shows through, low contrast, the wave line refracts behind the "4", a soft bright rim | the shader in Phase 4 |
| Avatar | small, round, at about 83 % down | about 64 px |
| Under it | the name, then a small "Touch ID or Enter Password" line | name plus the password capsule |

### Rules that keep this from breaking anything

What we never touch:
- GNOME's authentication (`AuthPrompt`, `UserVerifier`, the shield's lock state, key handling);
- GNOME's layout manager on the dialog. The fault tests showed that replacing it can blank the
  prompt. We only add our own actors and move GNOME's with `translation_y`, which leaves GNOME's
  own geometry intact;
- every other part of this repo the other sessions work on: the Blur My Shell patch, tahoe-motion,
  tahoe-widgets, `config/gnome-shell-overrides.css`, `tokens/`;
- the system theme gresource.

Everything lives in `extensions/tahoe-lockscreen@cachyos-tahoe` and `tools/lockscreen`. The
extension is enabled only while the screen is locked.

What every phase must pass before it is shown to the user (the gates):

| Gate | What it checks | Tool |
|---|---|---|
| G1 unlock path | Typing from the clock page puts every key into the password field. The field is visible, on screen, at full opacity, and is what a click at its centre hits; the eye and the arrow hit themselves. Still locked (the fake password is never submitted). | `tools/lockscreen/run.sh` |
| G2 fault suite | The seven injected faults, plus the same faults raised inside our own extension's code paths. The watchdog must restore GNOME's stock dialog, so G1 passes again. | `TAHOE_LOCK_FAULT=…` |
| G3 off switch | With our extension absent, the lock screen is pixel-identical to the stock baseline. | harness, image diff |
| G4 churn | 50 lock and unlock cycles: actors, signal handlers and memory flat, no JS errors. | harness loop |
| G5 looks | Light and dark screenshots of the clock page and the prompt page. Every corner zoomed, per [STANDARD.md](STANDARD.md). | harness, `docs/lockscreen/shots/` |
| G6 real machine | Real password unlock, a wrong password (shake), suspend and resume, two monitors, scale 2. | VM, in Phase 7 only |

The real session is never locked by us. Nothing is installed, enabled or merged without the
user's explicit go-ahead.

### Phase 2: safety frame (nothing visible changes)

The extension gets its JavaScript side, but draws nothing new yet:

- **Version pin:** the extension reads `Config.PACKAGE_VERSION` and does nothing unless the major
  version is 51. `disable-extension-version-validation` is on, so GNOME's own check doesn't
  protect us.
- **Shape check:** before touching anything, it checks that every private member it will use
  exists (`Main.screenShield._dialog`, `_stack`, `_clock`, `_promptBox`, `_authPrompt`,
  `_backgroundGroup`). If anything is missing, it does nothing.
- **Transactional enable:** everything is built inside one try block. On any error, `disable()`
  runs and removes every actor, signal and translation we added. This fixes the leftover-actor
  case from the fault tests.
- **Watchdog:**
  - When to check: after each page change and each dialog allocation, debounced to one check per
    frame.
  - The check: the password field (when shown) must be mapped, inside the monitor, at least
    200×30, at full opacity, and the actor a click at its centre hits.
  - If it fails: our actors are removed, GNOME's clock is unhidden and all translations are reset.
    One warning goes to the journal, and the extension stays dormant until the next lock.
- **Harness fixes:**
  - The harness gets its own runtime directory, so it can't leave GNOME's crash-guard file in the
    real session's runtime directory.
  - G2 learns to inject faults inside our extension.
  - G3 and G4 are added.

Exit: G1 to G4 pass, and the screenshots are identical to Phase 1's.

**Result (2026-10-20).** `frame.js` holds the frame; `extension.js` pins the version and enables
transactionally; the stylesheet is now `lockscreen.css`, loaded by the frame, so the shell never
loads it on an untested version. Design points that came out of building it:
- The frame undoes changes through destroy-signal watches, so undo never touches an actor GNOME
  already destroyed at unlock.
- **GNOME animates some properties itself.** It sets the prompt box's and the clock's opacity,
  scale and `translation_y`, and the bottom buttons' opacity and scale, on every crossfade frame.
  The frame refuses changes to those: such a change would be overwritten and undone to a stale
  value. Asking for one counts as a failure.
- **The watchdog** runs 450 ms after each page change, dialog allocation, or change of ours. While
  a fade is still running it waits, up to about 3.6 s.

Gates, all headless (`tools/lockscreen/run.sh`; `TAHOE_LOCK_GATE=ours-<fault>|churn`):

| Gate | Result |
|---|---|
| G1 | Light and dark: frame running, the eye and the arrow each hit themselves, password field crops pixel-identical to Phase 1's. |
| G2, our own code | All seven pass: a cover over the capsule, the prompt off screen, the prompt hidden, a GNOME-animated property, an exception, a failed check, a failed `enable()`. Each time the frame failed safe, with one journal line naming the cause. Stylesheet unloaded, none of our actors left, translations and opacity back. Then every typed key reached the field, which was visible and what a click hits, still locked. |
| G2, foreign faults | The seven faults from the risk assessment, with the frame present: still locked, every key arrives. Where foreign code broke the prompt, the frame noticed and stood down. It cannot repair someone else's code. |
| G3 | Covered by G2: after a failure nothing of ours is left (stylesheet, actors, translations, opacity). |
| G4 | 50 lock and unlock cycles: frame running at every lock; after every unlock the extension is off, its stylesheet unloaded and none of its actors left. Actors flat (about 2,560). Memory grew 6.5 MB, against 8.2 MB in the same run without the extension, so the growth is GNOME's own. No JS errors. |

The only JS error in the logs is GNOME's own "incorrect pop", raised when the harness ends a shell
that is still locked; it appears without the extension too.

**Harness fix:** the test shells now get their own runtime directory. They no longer share
`/run/user/1000` with the real session (GNOME's crash-guard file lives there), and the test
session's document portal mount is unmounted at the end.

Not tested: the version pin and the shape check are in place but untested. Faking a different
GNOME version or a reshaped dialog needs a VM image or a GNOME 52 build, so it waits for Phase 7.

### Phase 3: Tahoe layout with a plain clock

- **Clock always on top:**
  - Our own clock actor shows the date above the time, at the target sizes and positions. It is a
    child of the dialog, placed with constraints on the primary monitor.
  - It stays visible on both pages, as Tahoe's does; GNOME crossfades its own clock away.
  - GNOME's clock is hidden by hiding its labels, not by removing it from the stack.
  - In this phase our clock is plain white text, so the layout can be judged before the glass.
- **Time and date format:** the time comes from GNOME's `WallClock`, so it follows the 12h/24h
  setting, without AM/PM as in the image. The date is short, "Tue Oct 20", in the locale's order.
- **Prompt at the bottom:**
  - The prompt is shifted down with `translation_y` on GNOME's `_stack` so that the avatar sits at
    about 83 % of the height. Not on `_promptBox`: GNOME animates that box's opacity, scale and
    `translation_y` on every crossfade frame, so the frame refuses changes there (Phase 2).
  - The shift is recomputed when GNOME re-allocates, for example when notifications appear.
- **Prompt styling, in CSS:**
  - avatar 64 px;
  - the name in semibold;
  - no blue focus ring;
  - the capsule as a white glass fill per `tokens/glass.json`;
  - "Switch User…" as a glass capsule at the bottom right.
- **Hint:** "Click or press a key" goes, as Tahoe has none. Workshop question below.
- **Background:** the wallpaper keeps GNOME's (or Blur My Shell's) blur on the prompt page, as
  today.

Workshop: screenshots of both pages in light and dark against the reference; the user picks the
sizes and positions. Exit: G1 to G5.

**Result (2026-10-20).** `layout.js`, run by the frame for each unlock dialog:
- **Clock:** our own actor is a child of the dialog, pinned to the primary monitor, above GNOME's
  layout and non-reactive. It shows the date above the time on both pages, follows the 12h/24h
  setting (12h without AM/PM) and ticks with GNOME's `WallClock`, once a minute.
- **Placement by the letters:** the clock is placed by its letters, not its line boxes, and
  measured on the screenshots:

  | | Ours | Reference |
  |---|---|---|
  | Date letters top | 10.8 % of the height | 10.8 % |
  | Date letter height | 1.8 % | about 1.75 % |
  | Digits top | 14.0 % | 14.3 % |
  | Digit height | 9.8 % | 9.8 % |
  | Gap, date to digits | 1.46 % | 1.4 % |
- **GNOME's clock:** its time, date and "Click or press a key" labels are hidden (`visible`
  false), not the clock box, which GNOME animates.
- **Prompt:** moved down by translating GNOME's `_stack`, computed from GNOME's own allocations so
  the avatar centre sits at 82.5 %. It is clamped above the bottom margin and above GNOME's
  notification column, and re-placed when the stack or a new prompt is re-allocated.
- **CSS:**
  - avatar 64 px;
  - the name in SF Pro Text semibold;
  - the capsule in white glass (fill white 0.14, 0.18 when focused, 1 px white 0.16 edge), with no
    blue focus ring;
  - "Switch User…" as a glass capsule.
- **Watchdog clock check:** the clock must be shown, not cut off (allocation at least the text's
  own width) and on screen. Otherwise GNOME's clock comes back.

Gates:

| Gate | Result |
|---|---|
| G1 | Light and dark: frame running, every key in the field, the eye and the arrow each hit themselves; capsule at y 1265 to 1313 of 1440. |
| G2 | All eight own-code faults fail safe, the clock-cut-off case included. After each: our clock gone, GNOME's labels back, stack translation 0, stylesheet unloaded, password usable. |
| G4 | 50 cycles: frame running and the prompt usable at every lock, clean after every unlock, actors flat (2,597 from cycle 10 on), no JS errors. Memory over 100 cycles: with the extension, a one-off +18 MB over the first 25 locks (most likely font caches for the 190 px digits), then +4.5 MB over the next 50, the same rate as without the extension (+4.6 MB from lock 1 to 75). The steady growth is GNOME's own. |
| G5 | [phase3-layout.png](lockscreen/shots/phase3-layout.png) (reference, both pages, light and dark). Capsule, arrow and Switch User corners checked at 4x: round, concentric, 1 px edge. |

Two things found while building it:
- **The clock check had a gap:** a label given a fixed width reports that width as its natural
  width, so the check now measures the text inside the label.
- **The `cover` fault test** had been placing its cover where the prompt used to be. It now covers
  the field wherever the layout puts it.

For the user to decide (workshop): on Tahoe the avatar and "Enter Password" already show on the
clock screen. GNOME shows the prompt only after a key press or click, because that is when it
starts the password conversation. Keeping GNOME's behaviour is the safe default.

### Phase 4: the Liquid Glass clock

The look: the digits and the date are glass. The wallpaper shows through them, a little lighter
and milkier, bent at the edges of each stroke, with a soft rim.

- **Starting point:**
  - We take the technique of our own Glass Text widget (`tahoe-widgets/glasstext.js`), not the
    module: a new file in the lock screen extension, with credit.
  - The glyph mask is drawn with cairo and Pango, once a minute: red is coverage, green is how far
    inside the stroke.
  - A Cogl shader samples what is behind and refracts it near the stroke edges, using the slope
    of the green channel.
- **What is behind:**
  - A `Clutter.Clone` of the dialog's own background actor, cropped to the clock's box. The shader
    runs on that clone.
  - So the glass always shows exactly the lock picture under it: sharp on the clock page, blurred
    on the prompt page. No copy goes stale.
  - It repaints only when the background or the time changes.
- **The recipe**, from the closest open-source match found: Kyant0/AndroidLiquidGlass
  (Apache-2.0), whose catalog has a lock screen glass clock built from a glyph distance field.
  We take the idea, written as our own Cogl GLSL and credited:
  - **The milky base:** the picture behind is darkened slightly (brightness -0.1), flattened
    (contrast 0.75), made more colourful (saturation 1.5), blurred a little, then about 25 %
    white is laid over it. This gives the low-contrast, wallpaper-tinted white in the reference.
  - **Refraction:**
    - A dome profile across the stroke: `circleMap(x) = 1 - sqrt(1 - x²)` of the distance from
      the edge.
    - The sample is pushed along the edge normal by that amount. The normal is the slope of our
      green channel.
  - **Rim:** a narrow bevel (3 to 4 px) brighter toward a top-left light and a little on the
    opposite side.
  - **Chromatic split:** a slight one, red and blue sampled a pixel apart along the normal. This
    is an idea from the KDE widgets' glass text shader (GPL-3.0; the idea only, no code).
  - **Clipping:** everything is multiplied by the red coverage, for clean antialiased edges.

  Other repos looked at: Riu-F/liquid-glass-text (MIT, WebGL),
  iyinchao/liquid-glass-studio (MIT, Fresnel and dispersion maths), and
  DanielCrompton123/LiquidGlassText (Apple's own `glassEffect` on a text path; no licence, a visual
  reference only). None targets GNOME.
- **Material constants**, tuned with the user against the reference:
  - the milky mix: how much white over the refracted picture;
  - how much of the wallpaper tint comes through;
  - refraction strength and bevel width;
  - rim strength and direction;
  - a small chromatic split;
  - a soft shadow under the digits, so they stay readable on light wallpapers.

  These are kept as named constants in one file during the workshop.
- **Font:** SF Pro Display in a heavy weight to match the image, with SF Pro Rounded as the
  alternative. Both are installed.
- **Fallback:** if the shader or the mask fails, the clock draws as Phase 3's plain white text.
  If the clock fails as a whole, the watchdog unhides GNOME's clock. It is never blank.
- **Cost:**
  - one mask a minute;
  - the shader only when that box repaints;
  - nothing ticking while the screen is off (the clock pauses on the shield's lightbox and on
    monitor power-save).

Workshop: side-by-side sheets (reference, ours on the same Tahoe-like wallpaper, ours on the
user's fold wallpaper) in light and dark; the material is tuned in rounds. Exit: G1 to G5.

**Workshop so far (2026-10-20):**

- **First glass:** `glassclock.js`. A `Clutter.Clone` of GNOME's own lock background, cropped to
  the clock's box, is run through one shader with a glyph mask (Cairo/Pango, redrawn once a
  minute). The Phase 3 labels stay underneath as the fallback, and hide only after the glass has
  really painted. A glass failure brings back the plain clock, not GNOME's lock screen.
- **The user's choices so far:**
  - **Clearer glass:** "less tinted, more glass-like, transparent". The material is now clear:
    contrast 1, saturation 1, milk 0.06, no blur. The shape comes from the bend at the stroke
    edges (22 px) and the rim, lit from the top left.
  - **Sharp wallpaper:** "not a blurred background". While locked, the frame switches off the
    lock background's effects, Blur My Shell's `DualKawaseBlurEffect` or GNOME's own blur and
    dimming, and switches them back on at unlock or on any failure. The user's Blur My Shell
    settings are untouched.
  - **Font:** first "SF Pro Display Bold" (picked from
    [phase4-font-options.png](lockscreen/shots/phase4-font-options.png)), then "heavy and slightly
    rounded". The default is now SF Pro Display Heavy with its corners softened 2.5 px: the mask
    grows the glyphs with round joins. SF Pro Rounded Heavy is the alternative. See
    [phase4-clear-glass.png](lockscreen/shots/phase4-clear-glass.png).
  - **Darker in dark mode:** with GNOME's dark style, the glass is pulled 16 % toward black, and
    the rim stays bright. It follows the setting live.
    [phase4-dark-tint.png](lockscreen/shots/phase4-dark-tint.png).
- **The date:** its strokes are much thinner than the digits', so it gets 0.3 of their bevel,
  bend and rim, plus a little frost to stay legible. The mask's blue channel carries each glyph's
  scale.
- **Fixed on the way:** the glass now picks the primary monitor's background by position. Blur My
  Shell inserts the backgrounds in reverse order.

Gates with the glass:
- **G2:** all eight own-code faults fail safe.
- **G1:** the frame is running with our two actors (the clock and the glass).
- **Unlock time:** it is the same with and without the extension (median 2.80 s against 2.78 s
  over 10 cycles in the throwaway shell). The glass does not slow unlocking. The churn test now
  waits for the real unlock instead of a fixed 1.2 s, which was too short there.

Later the same day:
- **Corners:** "not softened" (corner softening off, the font's own corners).
- **Dark-mode tint:** "tinted light since it's hard to see". Dark mode now gets a light tint
  (milk 0.24, brightness +0.07) in place of the darker tint; light mode is unchanged.
  [phase4-glass-clock.png](lockscreen/shots/phase4-glass-clock.png).

More gates:
- **Glass failure:** with the mask forced to fail (test switch `_failForTest`), the journal gets
  one line, the plain clock shows at full opacity, the glass is removed, and the rest of the lock
  screen keeps running with the password usable.
- **G4 with the glass:** 50 cycles, all clean.
  - at every lock: the frame running with both actors and the password usable;
  - at every unlock: clean;
  - actors flat;
  - unlock median 2.81 s, the same as without the extension;
  - no JS errors.
- **Frame cost, 10 clock-to-password round trips:**

  | | With the glass | Without the extension |
  |---|---|---|
  | Stage update p95 | 1.34 to 1.39 ms | 1.63 to 1.72 ms |
  | Worst frame | 3.0 to 3.3 ms | 14 to 17 ms |

  Switching the blur off saves more than the glass costs.

Then:
- **Font:** "Space Grotesk" (SemiBold, chosen by the user over SF Pro). It was downloaded with the
  user's OK from its official repository (floriankarsten/space-grotesk, OFL-1.1, variable TTF,
  sha256 acad6de1…) and installed in `~/.local/share/fonts/SpaceGrotesk` with its licence. Pango
  gets SemiBold from the weight axis (`@wght=600`). The date is in the same face. The plain
  fallback labels' CSS is `"Space Grotesk", sans-serif`: a list with two quoted names was ignored
  by St, which fell back to the interface font.
- **Size:** "much bigger", then "15 %, not 20 %". Space Grotesk's digits are 0.730 em, so the time
  type is 0.2055 of the height (296 px at 1440: digits 216 px, measured 15.00 %). The date (54 px)
  and the gap scale in proportion. The bevel and the bend scale with the type size (given at
  192 px). Measured: date letters at 10.8 %, digits from 15.3 % to 30.3 %, far above the prompt
  (78 %).
- **Harness bug found:** run.sh gives the test shell its own `XDG_DATA_HOME`, which also hid
  `~/.local/share/fonts` from fontconfig. Every in-shell screenshot before this round fell back to
  **Noto Sans**: the Phase 3 layout sheet and the earlier glass sheets. (The font options sheet
  was drawn outside the shell and is right.) Fixed by linking the user's fonts into the test
  shell. The driver now logs the font Pango really resolved for the clock, not just the name asked
  for.

[phase4-glass-clock.png](lockscreen/shots/phase4-glass-clock.png): both pages in light and dark.

Still to do in Phase 4 (superseded by the next request):
- the user's pick of face A or B;
- a full G4 churn with the glass;
- a G2 case for the glass failing to paint (plain clock takes over);
- a check of frame cost while the clock repaints.

### Phase 5: Now Playing

- **What it is:** GNOME's own lock screen media card (`MediaMessage` in the notifications box),
  restyled as a Tahoe glass card. No player code of our own and no network.
- **Safety it inherits from GNOME:**
  - The card cannot open the music app while locked (`vfunc_clicked` returns early when locked).
  - It is hidden when the player's app has "Show on lock screen" off in Settings → Notifications.
    That is the privacy switch, and it already exists.
- **Glass:** the same background-clone glass as the clock, rounded at the widget radius
  (`tokens/radius.json`, widget 24). The card gets art, title, artist and the three buttons in
  Tahoe sizes.
- **Placement:** a workshop question. Options are under the clock (iPhone style), or just above
  the avatar. Moving it is again a translation on GNOME's notifications box, guarded by the
  watchdog, so it can never cover the prompt.

Exit: G1 to G5, with a fake MPRIS player in the harness (the widgets port already has one).

### Phase 6: motion

- **Page change:**
  - The prompt rises and fades in.
  - The clock stays put and its glass picks up the blur; it repaints with the background.
  - The spring numbers are copied from tahoe-motion's tuned curves. Its code is not imported.
- **Unlock:** the clock and prompt lift and fade while the blur clears.
  - It only animates our own actors, inside GNOME's existing unlock fade.
  - It never delays GNOME's `finish()` callback.
- **Wrong password:** GNOME's own shake, kept as is.

Exit: G1 to G5, plus frame times in the harness (p95 under 8.3 ms at 120 Hz).

### Phase 7: shipping (each step only with the user's go-ahead)

1. **VM (G6):**
   - a real password;
   - a wrong password;
   - fingerprint if available;
   - suspend and resume;
   - two monitors;
   - scale 2.
2. **Install:** `scripts/tahoe-lockscreen.sh on|off` copies and enables the extension; `off` puts
   back the stock lock screen.
3. **First real lock:**
   - Install, log out, log in, then you lock the screen yourself while I'm here.
   - Recovery, if anything looks wrong:
     - type the password blind and press Enter;
     - or press Ctrl+Alt+F3 and run `loginctl unlock-sessions`;
     - then `scripts/tahoe-lockscreen.sh off`.
4. **tahoe-repair:** it learns the switch as an opt-in state key, so a login never enables the
   lock screen on its own.
5. **Merge into main.**

### Workshop questions

- **Phase 3:**
  - Drop the "Click or press a key" hint, as Tahoe has none?
  - Short date "Tue Oct 20", or long "Tuesday 20 October"?
  - 12h without AM/PM, as in the image?
- **Phase 4:**
  - SF Pro Display heavy (closest to the image) or SF Pro Rounded?
  - How milky? Picked from screenshots.
- **Phase 5:** Now Playing under the clock, or above the avatar?
