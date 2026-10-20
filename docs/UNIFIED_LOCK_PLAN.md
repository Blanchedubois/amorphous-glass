# One Liquid Glass lock screen: workshop and plan (2026-10-20)

What the user asked for: when the PC starts, one Liquid Glass lock screen, the same one as Super+L;
the login screen's time in Liquid Glass with real refraction; Super+L in dark mode; music shown
(the user is the only user and does not mind it being visible); the swirl whenever music plays;
glass that is sharp, with a thinner outline. This is the workshop: findings with evidence, the
options, a phased plan and the decisions needed. Nothing here is built yet.

## Findings

### 1. "Two lock screens on Super+L": the watchdog's false alarm (a bug, found in the real log)

The user's session logged, at 16:12:26:

    tahoe-lockscreen: something covers the password field (St_BoxLayout.login-dialog-button-box
    < St_BoxLayout.login-dialog-input-well < AuthPrompt ...); back to GNOME's lock screen until the
    next lock

So the Tahoe lock screen showed first, then the watchdog swapped in GNOME's stock lock screen. The
actor it hit is GNOME's own row around the password field, not anything of ours. When a password
is submitted, GNOME makes the field insensitive while it checks the password, so the hit test
lands on the field's parent and the watchdog reads that as "covered". The test shells never
submit a password (no PAM: the harness's guard), which is why no gate caught it.
Fix: "covered" only if the hit actor is outside GNOME's prompt (an ancestor of the field inside
the prompt is fine), and no hit test while the prompt is verifying. New gate: submit a password
in the test shell with a fake verifier that answers late (the field insensitive meanwhile).

GNOME has two screens by design, and they stay two whatever we build:
- the lock screen (Super+L, idle, suspend): part of the user's session; all of our lock screen
  work lives here;
- the login screen (GDM): after boot, logout or Switch User; a separate shell running as a system
  account (`gdm-greeter`), with no access to the user's session or home folder.

### 2. Super+L is light: the glass, not the picture (corrected while building)

GNOME 51's lock screen draws the desktop background (its dark variant in dark mode), not
`org.gnome.desktop.screensaver picture-uri`, so the lock picture was already dark. What read as
light was the glass: a milky white material over a dark theme (the user: "the liquid glass in
dark mode, as the current theme"). Fixed: the glass follows GNOME's colour scheme, dark tint as
the desktop's dark glass (#222226). The login screen really was light: its picture came from the
screensaver setting; now built from the desktop's dark picture, and the login screen's colour
scheme set to dark (scripts/gdm-theme.sh).

### 3. Music and the swirl

- Spotify is the player; its notifications are allowed on the lock screen, so music mode does
  switch on while it plays (GNOME's own rule, kept).
- Spotify's covers are web URLs. While locked the lock screen does not use the network (a rule
  from the lock screen plan), so the swirl takes its colours only from covers the desktop's
  Music widget has already saved (`~/.cache/tahoe-widgets/art`, 44 so far). A song that starts
  while locked gets the grey fallback swirl until unlock. Fix (the user's call): fetch the cover,
  and only the cover, from the player's own URL while locked.
- After the watchdog's false alarm (1) the lock screen was GNOME's stock one, with no swirl:
  fixing 1 fixes that too.

### 4. Glass: soft, thick outline

The glass shape comes from a mask image drawn with cairo, and its lit rim fades in over 45 % of
a 10 px bevel, so the outline is a soft line about 4.5 px wide. Prototype: the shape computed
exactly in the shader (a rounded rectangle's signed distance: exact anti-aliasing at any
resolution, no mask image), a 1.25 px rim. `docs/unified/glass-edge-now-vs-exact.png`: top row
today, bottom row the prototype, 4x (the music card corner, a widget, the password capsule): a
crisp hairline, smooth corners.
For the clock's digits (a glyph shape, not a rectangle) the same thin rim, from a mask drawn at
twice the size.
The user found 1.25 px too thin (2026-10-20). Rim options rendered at 4x on the lock screen
(`docs/unified/glass-rim-options.png`): today's soft band, a crisp line of 1.25, 2 or 3 px, and
a 2 px line with a soft 5 px glow inside it. The user's pick (2026-10-20): C, a 2 px crisp line
with a soft 5 px glow inside it (glow strength 0.35). These become tokens in tokens/glass.json
(rim 2 px, glow 5 px at 0.35) for every glass surface on both screens.
The login screen's wallpaper was an 8-bit JPEG (soft colour edges): already replaced by a
lossless dithered PNG (1705842), 0.3 levels off the 16-bit picture instead of 1.5 to 2.7.

### 5. The login screen's time in Liquid Glass

Prototype (`docs/unified/login-glass-clock-prototype.png`): the digits as glass over the login
screen's picture, bending and lightening it along each stroke, in the lock screen's type, size
and place; GNOME's own clock stays, transparent. So refraction on the login screen works the way
it does on the lock screen.

## One lock screen at boot: two ways

| | A. The login screen made identical | B. Log in automatically, lock at once |
|---|---|---|
| What you see at boot | the login screen, looking like the lock screen: glass clock and date, widgets, glass password field | the Super+L lock screen itself (it is the same screen) |
| Password at boot | GDM's normal login | the lock screen's unlock |
| Music and swirl at boot | nothing plays at boot either way | nothing plays at boot either way |
| Weather on it | needs your location stored system-wide | your own setting |
| Keyring | unlocked at login, as now | unlocked at the first unlock (seen in the log: the lock screen's unlock unlocks it); apps that start with the session may ask for it before |
| Risk | low; GDM's own login stays | the session starts before the lock: the lock must be on before the first frame, and if it ever fails the session must log out at once. The disk is not encrypted, so someone at the machine can already read it with a USB stick; B does not change that |
| Logout or Switch User | this login screen | the login screen (A's look) |
| Work | port clock, widgets and layout to the login extension; two code bases to keep in step | an early lock in the session plus a fail-safe; A's look still for logout |

Recommendation: A first (it keeps the normal, safe login and is needed for logout in both), then
B as an option if the user wants the literal same screen at power-on. B needs its own tests:
the lock before the first frame on a real boot, and the fail-safe.

Music on the login screen: only possible when the session keeps running behind it (Switch
User), never at boot or after logout; display only (controls from the login screen would control
the user's session). With one account this case does not come up; left out unless asked.

## Plan (each phase tested headless behind the PAM guard and the bus filter, then on the real
machine by the user, before the next)

Phase 1, real-machine bugs (lock screen):
1. Watchdog: no false alarm while a password is checked (1); new "verifying" gate.
2. Dark mode: the lock picture follows the desktop's light/dark wallpaper (2).
3. Covers while locked: only if the user agrees (3).
Gates: G1 light/dark, the fault suite, churn, music-idle, the new verifying gate; the user locks
with Super+L, types the password, music playing.

Phase 2, sharp glass everywhere (lock and login screens):
1. One glass module for both screens: shapes computed exactly in the shader (cards, capsules,
   rows), a 1.25 px rim, the bevel and bend as now; glyphs (the clocks) from a 2x mask with the
   same thin rim. The rim width becomes a token (tokens/glass.json) so it is the same
   everywhere (docs/STANDARD.md: the shader's rim is the only edge).
2. Zoom every corner of every surface at 4x in light and dark before showing screenshots.

Phase 3, the login screen identical to the lock screen (A):
1. The glass clock with the date above it, in the lock screen's type, size and place, the time
   format as the user's (12 h without AM/PM like the lock screen, or 24 h; written into the
   login screen's settings, since it cannot read the user's).
2. The widget column: the month calendar (no private data), the weather if the user agrees to
   the location being stored system-wide.
3. The dark picture, the same as the lock screen's; the glass password field and account rows
   as now.
4. Side-by-side shots of lock and login screen at five monitor sizes.

Phase 4 (only if the user wants B): automatic login with an early lock and a fail-safe logout.

## Decisions needed from the user

0. The rim: decided, C (2 px line, 5 px glow).
1. A, or A then B?
2. Login screen clock: 12 h without AM/PM (as the lock screen) or 24 h?
3. Weather on the login screen (location stored system-wide)?
4. Fetch the cover while locked (only the cover, from the player's URL)?
5. Music on the login screen for Switch User: leave out (recommended with one account)?

## Already done and installed (appended, so this plan stands on it)

On local main (not pushed; the lock screen session reviewed and approved the lock screen parts):
- Lock screen (installed, `scripts/tahoe-lockscreen.sh on`): music mode (the swirl over the
  background, the player on plain glass, the biggest Music card that fits), the widget column
  (weather and month, no event titles: the user's choice), the glass password field, rounding
  from tokens (cards 24, padding 16, cover 8, capsules), any monitor size.
- Login screen (`bash scripts/gdm-theme.sh install`, sudo): the theme (sharp PNG wallpaper,
  the clock in the lock screen's place and size as GNOME's panel clock), the login extension
  (glass password field and account rows, unclipped; the empty banner left out of the layout;
  Tahoe proportions on any monitor), Space Grotesk system-wide, 24 h, no logo. Undo:
  `bash scripts/gdm-theme.sh undo`.
- Test harnesses never reach the real GDM or PAM (tools/gdm/sysbus.sh plus the lock screen
  session's driver guard): earlier runs had locked the user's account through pam_faillock.
- Details: docs/GDM_PLAN.md.

## Progress

- Phase 1 and 2 built and tested (2026-10-20), lock screen installed:
  - the watchdog false alarm fixed; gate `verifying` (main's code before the fix fails it with
    the user's exact log line, the fix passes);
  - music mode's race fixed: it missed GNOME's media card appearing after the player, so it could
    stay off (Now Playing's `wanted` now notifies it); 3 of 3 runs on;
  - glass: exact shapes in the shader, rim C (2 px line, 5 px glow), dark material in dark mode,
    on the lock screen's panes and the login screen's; the login screen built from the dark
    picture with GDM in dark mode;
  - tests: G1 light and dark, verifying, music-idle, ours-cover/throw, churn 8 (actors flat,
    unlock median 94 ms), login screen glass and fail-safe; 0 PAM lines.
- Phase 3, part 1 (2026-10-20): the login screen's time and date in Liquid Glass (clock.js),
  the lock screen's type, size, place and material, the user's clock format (12 h without
  AM/PM); GNOME's clock transparent. Both clocks have the edge C now (glassclock.js too), and
  side by side the two screens' clocks match (docs/unified/...). The login harness read the
  user's colour scheme after replacing its settings (always light): fixed.
- Next: the widget column on the login screen, after the user's choices on weather and covers.
- 2026-10-20 evening, from the user's real Super+L (and a frame-by-frame recording of locking,
  tools/lockscreen gate `lockvideo`):
  - music playing at lock: the swirl from the first frame (it faded in over 1.2 s from the
    picture); covers are fetched while locked (only covers), so new songs get their colours;
  - the weather card no longer flashes "Loading…": it fades in once the forecast is there;
  - glass shapes are set during layout, there on the first frame (they came a frame late);
  - the plain clock labels hid 600 ms after the glass painted, so the date and time were drawn
    twice at first: now hidden on the glass's first paint (the 600 ms check stays for failures);
  - all glass light on both screens (paneglass GLASS_LOOK), the wallpaper stays dark (the user:
    light and dark glass together looked wrong);
  - the login screen: the widget column (weather from the login screen's own location
    setting, month), the glass clock.
  The user's session ran the lock screen installed at 15:25 (started 15:46): today's later fixes
  load at the next login.
