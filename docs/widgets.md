# Calendar: Schedule, today's events from a Google Calendar ICS link (2026-10-20)

**Status: done on the branch (phases 0 to 6), not yet merged or installed.** How to set your link:
README, "Calendar: Schedule: setting your calendar link". Sheets: `docs/shots/schedule-{light,dark,milky}.png`
and `schedule-states.png` (made-up events only). Tests, all passing:

```bash
gjs -m tools/widgets-stress/ics-test.js                    # ICS parsing, 24 hand-checked cases
gjs -m tools/widgets-stress/schedule-test.js               # what the rows say, 19 checks
bash tools/widgets-stress/ics-feed-test.sh /tmp/ics-feed   # link, fetch, cache, keyring, 32 checks
DRIVER=widget-sched@local bash tools/widgets-stress/run.sh /tmp/sched tools/widgets-stress/layout-schedule.json
STRESS_ONLY=schedule DRIVER=widget-stress@local bash tools/widgets-stress/run.sh /tmp/stress tools/widgets-stress/layout-schedule-stress.json
```

Your picks at Phase 0: small layout A,
Large as mocked up, one colour per event by its UID, no "Tomorrow" line, one link, dots on the
week strip. Two new widgets, "Calendar:
Schedule" (small, 170 x 170) and "Calendar: Schedule Large" (356 x 356, two widget cells each
way, which fits most of the iOS Calendars widget). Both show what is left of today from your Google Calendar's
private ICS address. The existing Calendar widgets (Evolution Data Server) stay as they are.
It is desktop only: it is not in `tools/lockscreen/shared.list`, so the lock screen never shows it.

## The link is a password

Google's "Secret address in iCal format" lets anyone who has it read the whole calendar. So:
- It lives only in the GNOME keyring (libsecret, schema `org.cachyos.tahoe.Calendar`, attribute
  `feed=default`), or, if there is no keyring, in `~/.config/tahoe-glass/calendar-url` (0600). Never
  in the repo, in `widgets.json`, in logs, in screenshots or in docs.
- You set it yourself: `scripts/tahoe-widgets.sh calendar-url` asks for it with hidden input (or
  reads it from a pipe), checks it looks like an `https://` ICS address, stores it and tells the
  widget to reload. `calendar-url --clear` removes it. Nothing is ever pasted into a chat.
- Logs and the widget's error line say only "calendar.google.com", the HTTP status or the
  GLib error code, never the address.
- The last good copy of the feed is kept in `~/.cache/tahoe-glass/calendar.ics` (0600, it holds
  your events), with its ETag and Last-Modified next to it.
- The keyring is read once at start and when the script says the link changed. If the keyring is
  still locked, the widget does not ask to unlock it; it shows "Calendar locked" and tries again
  at the next refresh.

## Small layout (170 x 170, 16 px top and bottom, 18 px sides, radius 24)

Mockups (shown in the session; ASCII here):

```
A: list (recommended)   B: up next             C: big day
+------------------+    +------------------+   +------------------+
| TUESDAY 20       |    | TUE 20 OCT       |   | 20  October      |
| | 10:30 · in 8 m |    | | 10:30 · in 8 m |   |     Tuesday      |
| | Gym            |    | | Gym with the   |   | | 10:30 · in 8 m |
| | 1:15 PM        |    | | running club   |   | | Gym            |
| | Lunch with Sam |    |                  |   | | 1:15 PM        |
| | 2:30 PM        |    | • 1:15 PM Lunch  |   | | Lunch with Sam |
| | Design review  |    | • 2:30 PM Review |   |                  |
+------------------+    +------------------+   +------------------+
 3 events               1 big + 2 short         2 events
```

Layout A in detail (138 px of height inside the padding):
- Header, 16 px: the weekday in the widgets' red accent (`.tahoe-widget-accent`, 13 px bold), the
  day number after it in the text colour, as the Calendar: Today widget's accent line.
- Up to 3 events, 30 px each, 8 px apart: a 3 px bar in the event's colour (radius 2, as
  `.tahoe-cal-event-bar`), then two lines: the start time, 11 px secondary (`10:30 AM`, or `10:30`
  in 24 h), and the title, 13 px semibold, one line, ellipsized. SF Pro Text (all under 20 px).
- The next event's time line adds the relative time, in italics: `· in 8 min` under an hour,
  `· in 2 h` up to 6 h, nothing later. Start times only: a range and a relative time do not fit
  in 134 px at 11 px.
- An event in progress: its time line reads `Now · until 11:45` in its bar colour, semibold.
- All-day events come first as one line `All day · Holiday` (bar included), and count as one of
  the 3 rows; several all-day events give `All day · Holiday +1`.
- More events than fit: the last row becomes `+2 more`, 11 px secondary.
- Past events leave the list at their end time.

States:
- **Empty**: `No more events today`, 13 px semibold, at the bottom; optional second line
  `Tomorrow 9:30 AM` (question 3).
- **Offline with a cache**: the cached events as usual and a footer `Can't reach calendar · 9:41`
  (the time of the last good copy) in place of the third event. After 24 h without a good copy the
  footer reads `Last updated Mon 9:41`.
- **Offline, no cache**: `Can't reach calendar` with `Will retry` under it.
- **No link set**: `No calendar link` with `tahoe-widgets.sh calendar-url` under it.
- **Keyring locked**: `Calendar locked` with `Unlock to show events`.

## Large layout (356 x 356, same padding and radius)

320 x 324 px inside the padding; the same row style as the small one, bigger:

```
+--------------------------------------+
| 20  October                          |
|     Today, Tuesday                   |
|                                      |
| MON TUE WED THU FRI SAT SUN          |
|  19 (20) 21  22  23  24  25          |
|  .       .       .       .           |
|--------------------------------------|
| | 10:30 AM - 11:45 AM   in 8 min     |
| | Gym                                |
| | 1:15 - 2:15 PM                     |
| | Lunch with Sam                     |
| | 2:30 - 2:45 PM                     |
| | Design review                      |
| | 4:00 - 5:00 PM                     |
| | Dentist                            |
| +1 more                              |
+--------------------------------------+
```

- Header, 48 px: the day number, SF Pro Display 46 px semibold; beside it the month (15 px
  semibold) over `Today, Tuesday` (15 px secondary).
- Week strip, about 50 px: this week from GNOME's first weekday (as `calendar.js` `weekStart()`),
  weekday labels 11 px bold, numbers 15 px; today in the widgets' red circle (28 px, as the
  month widget's today), weekend days dimmer. A small dot under a day that has events, from the
  helper's 7-day list (days before today in this week: question 5).
- A separator (the mode's separator colour), then up to 4 events, 38 px each, 10 px apart: a
  4 px bar, the time range 12 px secondary with the relative time after it in italics, and the
  title 15 px semibold. A range fits here: `10:30 AM - 11:45 AM   in 8 min` is about 200 px.
- All-day, in progress, `+N more`, past events and every state: as the small one; the footer
  (`Can't reach calendar · updated 9:41`, `+1 more`) sits on the bottom line.
- Empty: `No more events today` (15 px semibold) centred in the event area, with tomorrow's first
  event under it if question 3 says so. The header and week strip stay.

Both sizes share one feed client, one helper run and one event list; only the rows differ
(`ScheduleSmall` and `ScheduleLarge` in `schedule.js`).

Colours (both sizes), in order: the event's own `COLOR` (RFC 7986), the calendar's `COLOR`,
`X-APPLE-CALENDAR-COLOR` or `X-OUTLOOK-COLOR`, then a stable palette of Apple's system colours
(orange, green, blue, purple, pink, teal, yellow, indigo) picked by a hash of the event's UID, so a
recurring event always has the same colour. Google's feeds carry no colour, so in practice it is
the palette (question 2). Colours are the same in light, dark and milky; the text follows the
mode as on every widget.

## How it is built

New files only: `schedule.js` (the widget), `icsfeed.js` (link, fetch, cache, refresh),
`ics-expand.js` (a small helper program, below) and `vendor/ical.js`. One rule block is added to
`stylesheet.css`; it is a shared file, so `tools/lockscreen/sync-shared.sh` runs after it (the
rules do nothing on the lock screen). `calendar.js`, `clocks.js` and the other shared files are
not changed.

**Parser: ical.js 2.2.1** (Mozilla/Thunderbird's, MPL-2.0, 268 KB unminified, no dependencies).
Checked in GJS 1.90 in Phase 0: it loads as an ES module unmodified, and on a fixture it got
TZID with a VTIMEZONE, a weekly RRULE, EXDATE, a moved RECURRENCE-ID, a folded line and the
25 October DST change right. MPL-2.0 is file-level and allows a GPL-3.0 larger work (MPL 2.0
section 3.3), so the file is vendored unmodified with its licence header and credited in the
README. Writing our own parser for RRULE (BYDAY, BYSETPOS, UNTIL in UTC vs local, COUNT with
exceptions) would be more code and more risk.

**Parsing happens in a helper process, not in the shell.** A real Google feed holds every event
since the calendar began, often 1 to 5 MB; ical.js needs hundreds of milliseconds for that, which
would freeze the shell. So the shell fetches and saves the file, then runs
`gjs -m ics-expand.js <cache file>` with `Gio.Subprocess` (async, 10 s limit, killed on disable).
The helper expands every event into its occurrences from yesterday to 7 days ahead in the local
time zone and prints a small JSON list (start, end, all-day, title, colour, uid). The shell
keeps that list in memory and in `~/.cache/tahoe-glass/calendar.json` (0600). The helper runs only
when the feed changed, the day changed past the 7-day window, or the time zone changed. The link
is never passed to the helper.

Event rules in the helper:
- Times: TZID from the feed's VTIMEZONE; a TZID with no VTIMEZONE (some feeds) falls back to the
  system's tz database by name; UTC and floating times as RFC 5545 says.
- All-day: DTSTART as a DATE; DTEND exclusive (a one-day event on the 20th ends on the 21st).
- Multi-day: an event that started before today and ends later shows today, `All day` if it
  covers the whole day, else its time with `until 3 PM` or `from 9 PM`.
- RRULE with EXDATE, RDATE and RECURRENCE-ID overrides (moved and cancelled single occurrences),
  `STATUS:CANCELLED` dropped, `TRANSP` ignored. Long-running recurrences are iterated from
  their start, capped at 20 000 steps a series.
- Titles: the SUMMARY only, no description, location or attendees.

**Fetching (`icsfeed.js`, one client for all Schedule widgets, made once per shell session like
the weather client, timers stopped when the last widget goes):**
- Soup 3 `send_and_read_async` on its own `Soup.Session` (timeout 20 s, a user agent, at most
  16 MB), with `If-None-Match` and `If-Modified-Since`; 304 keeps the cache. `webcal://` becomes
  `https://`; plain `http://` is allowed for localhost only (the tests).
- Every 15 min (with up to 60 s jitter), at start, on resume from suspend (logind
  `PrepareForSleep`, through the shell's `LoginManager`) and when the network comes back
  (`Gio.NetworkMonitor`), at most once a minute.
- On errors: retry after 1, 2, 4, 8 and 15 min, then every 15 min; a 401, 403 or 404 means the
  link is wrong or was reset, so the widget says `Calendar link not valid` and stops retrying
  until the link changes.
- No fetch while the screen is locked (the desktop widgets are off then anyway).

**The minute tick stays cheap:** `tick(now)` runs on the extension's minute tick (the widget wants
no seconds). It filters the in-memory list for today, picks up to 3 rows and builds a short key
from them; the labels change only when the key changes. No file reads, no network, no parsing on
the tick. Under a fullscreen window the extension does not tick at all, as for the other widgets.
Midnight is a key change (new day), so the list rolls over on the first tick after 00:00.

## Phase 1: what was built (2026-10-20)

- `scripts/tahoe-widgets.sh calendar-url`: hidden prompt (or a pipe), checks for an `https://` or
  `webcal://` address, stores it with `secret-tool` through stdin (never an argument), else in
  `calendar-url` (0600), clears the other store and the old calendar's cache, and writes
  `calendar-source` (`store=keyring|file|none`, 0600), which the widgets watch. `--file` forces the
  file, `--clear` forgets the link and the cache; `status` says where the link is.
- `icsfeed.js`: one feed per shell session (`acquireFeed()`, `release()`); signals
  `status-changed` and `data-changed`; `status` (none, locked, loading, ok, offline, invalid),
  `updated` (last good answer), `hasCopy`, `cacheFile`. The keyring is searched with
  `LOAD_SECRETS` and without `UNLOCK`, so a locked keyring gives `locked`, never a prompt; the
  libsecret proxy is dropped after each lookup. A whole request has a 20 s deadline of its own
  (Soup's timeout is per read). `message.status_code`, not `get_status()`, which throws on codes
  Soup has no name for (429). Cache writes are `GLib.Bytes` through `write_bytes_async` (a plain
  array given to `write_all_async` is not kept alive by GJS).
- Test: `bash tools/widgets-stress/ics-feed-test.sh OUT` (headless shell, `widget-ics@local`,
  `ics-server.py` on 127.0.0.1, a throwaway keyring with `TEST_KEYRING=1` in `run.sh`). 25 checks:
  no link, file link, private cache (0600 files, 0700 folder), validators sent and 304, 500 with
  backoff, recovery on network change, resume from suspend, at most one try a minute, 429 with
  Retry-After, a dropped connection, a sign-in page with 200, 404, over 16 MB, a server that never
  answers (gives up at 20 s), a new link drops the old validators, release and re-acquire,
  keyring link, locked keyring with no prompt. It fails if the link's test marker shows in a log.

## Phase 2: what was built (2026-10-20)

- `vendor/ical.js`: ical.js 2.2.1 unmodified, with its MPL-2.0 licence and source (`vendor/README.md`).
- `ics-expand.js FILE --from D --to D`: run by the feed with `Gio.Subprocess` (`TZ` set to the
  shell's zone, 30 s limit, stopped with the feed); prints the occurrences overlapping the local
  days [from, to) as JSON. The feed asks for today - 7 to today + 9 (any week holding today, and
  tomorrow), runs it after each new copy, and again only when today's needs (today - 6 to today + 8)
  leave that window or the zone changes; the answer is kept in `calendar.events.json` (0600), so
  a new shell shows events at once. A feed the helper can't read sets `invalid` and keeps nothing.
- Rules: lines unfolded as bytes (a fold may split a UTF-8 character); TZID through the feed's
  VTIMEZONE, else the tz database by name, floating times local; DTEND exclusive, all-day without
  DTEND one day, zero-length events kept; overrides (RECURRENCE-ID) shown on their own, moved,
  retitled or cancelled, and the occurrence they replace skipped (also when moved in from outside
  the window, or with no series in the feed); STATUS:CANCELLED dropped; colours: the event's
  `COLOR`, else the calendar's (`COLOR`, `X-APPLE-CALENDAR-COLOR`, `X-OUTLOOK-COLOR`), hex or a CSS
  name only.
- **Speed.** A made-up 5 MB feed (`tools/widgets-stress/ics-bigfeed.py`: 12 290 events since 2012,
  1 072 series) first took 18.5 s. Two causes: `new ICAL.Event(component)` looks through every
  VEVENT of the calendar for overrides (quadratic; fixed by passing `{exceptions: []}`, as the
  helper handles overrides itself), and long series walked from 2012. Simple series (DAILY, or
  WEEKLY by weekday, no COUNT) now start a whole number of periods before the window, in wall-clock
  time. **0.62 s** now (161 MB peak, in the helper only), with exactly the same 4 560 occurrences as
  the full walk. The shell never parses.
- Tests: `gjs -m tools/widgets-stress/ics-test.js`, 24 cases over 9 fixtures in
  `tools/widgets-stress/ics/` (made-up events only), expected results worked out by hand in
  `ics/expected.json`: Berlin and New York summer time ends (25 Oct and 1 Nov 2026), the same feed
  seen from Berlin and Tokyo, a TZID with no VTIMEZONE, quoted TZID, floating and UTC, all-day and
  multi-day, overnight, EXDATE, moved and cancelled overrides, an orphan override, RDATE, BYDAY=3TU,
  BYSETPOS=-1, COUNT, UNTIL in UTC on the boundary, yearly, a series since 2001, the skip-ahead (interval 3
  days since 2015 with old EXDATEs, every other week from a start day off its BYDAY days), colours,
  and two broken files. A deliberately wrong skip-ahead fails 3 cases. `ics-feed-test.sh` now has
  32 checks, the reader's among them (window, re-runs, private cache, a new shell, an unreadable feed).

## Phase 3: what was built (2026-10-20)

- `schedule.js`: `ScheduleSmall` (`schedule-small`, "Calendar: Schedule") and `ScheduleLarge`
  (`schedule-large`, "Calendar: Schedule Large") in Add Widget. Both sit on the same `GlassCard` as
  every other widget, so the glass is the same (Blur My Shell blur and tint, rim light, edge shadow,
  drop shadow, the 1 px edge, radius 24); the mockups above were flat HTML and showed only the edge.
  Checked: each corner at 4x beside Calendar: Today and Weather: Week, in light and dark.
- All-day events are one row like the others ("All day" over the title, `+1` for more), not the
  one-line form planned. The week strip starts on GNOME's first weekday; today is the red circle,
  the other days with events get a dot.
- The minute tick: `schedule(events, now)` (pure) picks the rows; the header is rebuilt once a day
  or when the events change, the rows only when a row's text changes.
- Screenshots (made-up calendar served from 127.0.0.1, placed around the current time):
  `docs/shots/schedule-{light,dark,milky}.png`, beside Calendar: Today, the digital clock and
  Weather: Week. `SHOT_ICS=1` in `widget-shot@local` (with `SHOT_ICS_EVENTS=now|none|nolink` for
  other states) and `tools/widgets-stress/layout-schedule.json`.
- `stylesheet.css` gained the `tahoe-sched-*` rules; `tools/lockscreen/sync-shared.sh` copied them
  to the lock screen's `widgets.css` (they do nothing there; the lock screen has no Schedule widget).

## Phase 4: what was built (2026-10-20)

- `schedule-model.js` (GLib only) says what the rows show; `schedule.js` only draws it.
  - Rows: one for all-day events (with `+N`), timed events covering the whole day included (a
    trip), then what has not ended, by start. An event leaves at its end; a zero-length one at its
    time. Midnight: the header and rows roll over on the first tick after 00:00, multi-day events
    becoming all-day rows on their middle days.
  - The next event not yet started gets `in N min` under an hour, then `in N h` (rounded), none
    from 6 h. Events going on: `Now · until 11:45 AM`, or `until Fri` when they end on a later day
    than tomorrow; their time line is semibold in the event's colour on dark and milky glass, in the
    full text colour on light glass (a darker orange was still hard to read on a bright wallpaper),
    the bar keeping the colour. Large: ranges (`10:30 – 11:45 AM`, `10:30 AM – 12:45 PM`),
    `From 11:00 PM` for one running past midnight; small: start times.
  - Footers: offline with a copy `Can't reach calendar` with `updated 8:09 PM` (or `Mon 8:09 PM`
    from another day; two lines on the small card, one on the Large), `Calendar locked`,
    `Calendar link not valid`; with nothing left today they go under `No more events today`.
    Without a copy: `Can't reach calendar / Will retry`, `Calendar locked / Unlock to show events`,
    `Loading calendar…`; no link: `No calendar link / tahoe-widgets.sh calendar-url`.
- The widgets refresh on the minute tick and on the feed's signals, reading the time then (after
  a suspend the next tick can be up to a minute late, as for the clocks). A removed link no longer
  re-reads the old copy still on disk (found by the test below).
- Tests: `gjs -m tools/widgets-stress/schedule-test.js` (17 checks, worked out by hand, one made-up
  Tuesday in New York: before, at and after starts and ends, rounding, multi-day, midnight,
  24-hour clock, colours, the week dots). `DRIVER=widget-sched@local bash tools/widgets-stress/run.sh
  OUT tools/widgets-stress/layout-schedule.json` (add `SCHED_SHOTS=1` for screenshots): the real
  widgets with a fake clock (`setClockForTests`) over a made-up calendar dated today from
  127.0.0.1, 14 checks: the rows at 09:21:30, 09:30, 09:45, 16:00, 23:59:59 to 00:00:30, overflow,
  offline, locked, link removed, and an idle tick (100 ticks in one minute rebuild nothing; about
  47 µs a tick; 12:00 to 12:01 rebuilds nothing, 12:50 to 12:51 once, for "in N min").
- Sheet: `docs/shots/schedule-states.png` (next event, going on, offline, nothing left, no link;
  dark and light; Calendar: Today beside them for comparison).

## Phase 5: stress and performance (2026-10-20)

`STRESS_ONLY=schedule DRIVER=widget-stress@local bash tools/widgets-stress/run.sh OUT
tools/widgets-stress/layout-schedule-stress.json`: six Schedule widgets (3 small, 3 Large), a
digital clock and Calendar: Today, one 5 MB made-up feed (`ics-bigfeed.py`, 5 046 occurrences in
the 16-day window: far busier than a real calendar) from 127.0.0.1, the main loop watched by a
1 ms timeout (the longest gap between its runs is the longest stall).

| Check | Found first | Now |
|---|---|---|
| One feed for six widgets | 1 request, 1 reader run | same |
| Longest main-loop gap, at rest (the headless shell's own) | 21 to 30 ms | same |
| Longest gap while the 5 MB feed is fetched, saved and read | 24.5 ms: the six widgets rebuilt in one main-loop pass when the events came (GLib runs every ready idle source of one priority in the same pass) | **12.6 ms**: one shared idle source, one widget per pass; the 5 MB body kept as the `GLib.Bytes` chunks it came in, never copied in JS |
| Idle minute tick, per widget | 285 µs: every event filtered and every row of the day formatted | **65 µs**: the day's events and the week's dots worked out once for all widgets (`feed.memo`), only the rows that can show formatted |
| The shell's own work on the reader's answer | | `JSON.parse` of 547 KB: 0.8 ms |
| Idle 65 s | | 1 tick (the minute) |
| Under a fullscreen window | | 0 ticks |
| 6 lock cycles, each while a new copy is being read, then 6 disable/enable cycles | | timers 2 and 2 (the clock tick, the feed's refresh), D-Bus subscriptions 0 and 0, match rules 86 and 86, actors 3 234 and 3 230, no reader process left running, events kept |

The reader (`ics-expand.js`) parses outside the shell, so the shell never does: 0.6 s for this
feed in its own process. What is left in the gaps above is building the rows' actors (about
3.5 ms per widget, only when the words change) and painting them.

Rerun after the changes, all passing: `ics-test.js` (24), `schedule-test.js` (19), `ics-feed-test.sh`
(32), `widget-sched@local` (14), and the full widget stress (`layout-all.json`) with the same
counts as before this work (timers 3, 2, 2, 2, 2; D-Bus subscriptions 1; match rules 89 to 87;
the logged errors are the date menu's DBusProxy ones listed below, none from the Schedule files).

## Phases (one commit each, on this branch)

0. **Plan and mockups** (this). Your picks, then on.
1. **Link and fetch.** `calendar-url` in `scripts/tahoe-widgets.sh` (keyring through `secret-tool`,
   else the 0600 file); `icsfeed.js` with lookup, fetch, ETag and Last-Modified, 0600 cache, refresh,
   backoff, resume and network triggers. Tested in the headless shell against a local fixture
   server (`tools/widgets-stress/ics-server.py`, 127.0.0.1 only) that can answer 200, 304, 404,
   slow and dropped; the test shell has its own D-Bus session, so it never sees the real keyring.
2. **Parsing.** `vendor/ical.js`, `ics-expand.js`, and fixtures written for this repo with made-up
   events only, in `tools/widgets-stress/ics/`: folded lines, VTIMEZONE and DST, a TZID without
   VTIMEZONE, all-day and multi-day, weekly, monthly BYDAY and BYSETPOS, COUNT and UNTIL, EXDATE,
   moved and cancelled overrides, `STATUS:CANCELLED`, a 5 MB generated feed for timing, a broken
   file. `tools/widgets-stress/ics-test.js` runs the helper with a fixed "today" and time zone
   (`TZ=` and a `--today` flag) and compares with expected JSON.
3. **The widgets, small and Large**, light, dark and milky, in the headless shell with fixture data.
4. **Live behaviour:** next event and relative time, now and past, midnight rollover, all-day and
   overflow, empty, offline-with-cache, offline, no link, locked keyring and invalid link states.
   The harness can set the clock (`STRESS_NOW=`) for the rollover check.
5. **Performance and stress:** `STRESS_ONLY=schedule` in `tools/widgets-stress`: ticks per minute,
   timers and subscriptions before and after lock and disable cycles, no shell stall over 5 ms
   while a 5 MB feed is parsed, a slow and a dropped server, many Schedule widgets sharing one
   client.
6. **Docs and screenshots** with fixture data only (`docs/shots/schedule-{light,dark}.png`), the
   README widget table, ical.js credit, and how to set your link. Then I ask you before merging into
   main, installing (`tahoe-widgets.sh on`) or logging out.

## Questions at Phase 0 (answered: see the picks at the top)

1. Small layout A, B or C? And the Large one as mocked up, or changes?
2. Bar colours: one colour per event by its UID (as in the mockup), or one colour for the whole
   calendar (your Google calendar's colour, which the feed does not include, set by hand)?
3. Empty state: also show tomorrow's first event (`Tomorrow 9:30 AM`), or only "No more events today"?
4. One calendar link, or several (work and personal) merged in one list? One is planned; several
   is small extra work in Phase 1.
5. Large week strip: dots on days that have events (past days of this week too, which needs the
   helper to keep the whole week), or no dots?

# App button and Extra Large music widgets (2026-10-20)

**Status: done.** Your picks: the app button on the Music widgets only; Extra Large Wide with the
cover and player on the left and lyrics on the right; Extra Large Tall with the player on top and
lyrics under it. The lyrics are also a bit faster (380 ms drift). Sheets:
`docs/shots/music-all-{light,dark}.png`. Tests: `STRESS_ONLY=app` (a fake player in its own
process and window is focused from behind another window, from minimised and from another
workspace) and `tools/widgets-stress/layout-xl.json` for the big cards. Not checked: whether
Firefox and Chromium switch to the playing tab on Raise. That needs a real browser playing audio,
which the headless test shell can't do; the button calls Raise in any case.

The plan as agreed:

## Part A: the app button ("open where the audio comes from")

**What it does.** A small app icon on each Music widget. Clicking it brings the player's window
to the front and, for browsers, the tab that is playing.

**How (checked against the running Spotify):** MPRIS gives each player `DesktopEntry`
(`spotify`), `Identity` (`Spotify`), `CanRaise` (true) and a `Raise` method; D-Bus gives the
process that owns the player's name (`GetConnectionUnixProcessID`).
- Icon: `Shell.AppSystem` looks up `<DesktopEntry>.desktop`; if there isn't one, the app of the
  player's process (`Shell.WindowTracker`); else a generic audio icon.
- Click: call `Raise` first. Firefox and Chromium switch to the playing tab on `Raise`; this is
  the only way to reach the tab, and it is checked per browser in A3. Then the shell itself
  activates the window, because Wayland focus-stealing prevention can turn a player's own
  `Raise` into a "ready" notification. The window chosen is the player's window that just asked
  for attention, else its most recently used one (by process, else by app). The window is
  focused on its own workspace, and minimised windows are restored.
- Shown only while there is a player. The tooltip is the player's name. The button takes the
  click, so the card is not dragged.

**Where on each widget:**

| Widget | Place | Size |
|---|---|---|
| Small | badge on the cover's bottom-right corner, overlapping it (as iOS widgets) | 20 px |
| Wide | top-right corner of the card, level with the title (title ellipsizes before it) | 20 px |
| Large | right of the title and artist, level with the title | 24 px |
| Lyrics | badge on the small cover's corner (the play button keeps the top right) | 18 px |
| Extra Large Wide / Tall | as Large, on the player column | 24 px |

Phases:
- **A1** `mpris.js`: per player `desktopEntry`, `identity`, `canRaise`, owner `pid` (read once
  when the player appears); `raise()` with the focus fallback. Public API only gains fields.
- **A2** `AppButton` in `music.js`: icon lookup, click, tooltip, hidden with no player.
- **A3** placement per size, then tests: a fake player in its own process with its own window
  (headless) proves the click focuses it, minimised and on another workspace too. Firefox and
  Chromium tab switching is checked on the real players, without touching your session.
- **A4** (optional, see question) the same idea on the other widgets: clock opens Clocks,
  calendar opens Calendar, weather opens Weather. A whole-card click would fight dragging, so it
  would be a small corner icon as well.

## Part B: Extra Large: the Large widget and the Lyrics widget in one card

Two new sizes in Add Widget: "Music: Extra Large Wide" and "Music: Extra Large Tall". Both use
the same swirl, ink, tint, fonts, lyrics motion and 16 px spacing as the others.

```
Extra Large Wide, 728 x 504                    Extra Large Tall, 356 x 864
+--------------------+--------------------+    +--------------------+
| +----------------+ | lyrics (dim)       |    | +----------------+ |
| |                | | SUNG LINE (big)    |    | |                | |
| |   cover 324    | | lyrics (dim)       |    | |   cover 324    | |
| |                | | lyrics (dim)       |    | |                | |
| |                | | lyrics (dim)       |    | +----------------+ |
| +----------------+ | lyrics (dim)       |    | Title          [A] |
| Title          [A] | lyrics (dim)       |    | Artist             |
| Artist             | lyrics (dim)       |    | ======------ times |
| ======------ times | lyrics (dim)       |    |   |<<  ||  >>|     |
|   |<<  ||  >>|     |                    |    |--------------------|
+--------------------+--------------------+    | lyrics (dim)       |
 left: the Large layout; right: the lyrics,    | SUNG LINE (big)    |
 full height, 16 px gutter                     | lyrics ...         |
                                               +--------------------+
                                                lyrics under the player, ~9 lines
```

- Sizes on the 8 px grid: Wide 728 (two large widths plus the 16 px gap) x 504 (the Large
  height); Tall 356 x 864. Both fit the 2560 x 1440 desktop.
- The lyrics area is bigger, so lyrics are 26 px (Wide) and 24 px (Tall), with more lines shown.
- Cost: the swirl shader is per pixel, and Wide is about 2.9 times a Large's area: still a few
  hundred microseconds a frame at 25 fps. Rechecked in the stress run.

Phases:
- **B1** sizes: `extension.js` gets a free size per class (width as well as height), so
  placing, snapping and Add Widget's free-spot search work with big cards.
- **B2** Extra Large Wide layout, reusing the Large column and `LyricsView`.
- **B3** Extra Large Tall layout.
- **B4** tests: screenshots per mode and cover, lyrics motion frame by frame, the swirl stress
  run with Extra Large cards, drags and snapping near the screen edges.

## Part C: docs, merge, install, push

One commit per phase, a light and dark sheet of every music size, merged into main, installed,
pushed. It loads at the next login, as usual.

# Music widgets: album-colour swirl (2026-10-20)

The Music widgets (small, wide, large, lyrics) tint their glass with a slow swirl made from the
album cover's main colours, the way Apple Music's full-screen lyrics background moves. The glass
stays glass: blur, rim light, edge shadow and the 1 px edge from `docs/STANDARD.md` still read.

## Phase 0: how Apple Music does it, and the source

Apple Music (and every open clone) does the same few things: take 4 or 5 dominant colours (or the
cover itself), blur them into a soft field with no hard edges, and let it turn and drift very
slowly; a new track cross-fades over about a second. A light dither hides banding.

Compared:

| Source | Licence | What it does | Verdict |
|---|---|---|---|
| [Steve-xmh/applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) (AMLL), `packages/core/src/bg-render` | **AGPL-3.0-only** (all packages, checked at df0d8d8) | Mesh renderer: the cover downscaled to 32 px, on a Bezier patch mesh whose control points drift, rotated, dithered, vignetted. Older Pixi renderer: four rotating copies of the cover, huge blur, 1 s cross-fade. Palette: k-means vs octree in Lab, picked by spread | Best reference, but not GPL-3.0 as assumed: porting its code would put AGPL terms into this repo. Used as the reference for the technique only, no code copied |
| [Adaptive Palette](https://pub.dev/documentation/adaptive_palette/latest/) (Flutter) | MIT | Layered blurred image shaders on orbital paths, weighted k-means, cross-fade | Same idea; confirms the recipe |
| [HypnoticCanvas](https://klibs.io/project/mikepenz/HypnoticCanvas) (Compose) | MIT, shaders per their own licences | Mesh gradient shader | Licence per shader unclear: not used |
| Shadertoy "fluid gradients" | mostly CC BY-NC-SA | | Not GPL compatible |

**Pick:** an original GLSL shader written for this repo (GPL-3.0), after AMLL's technique: four
colour fields whose centres orbit at different slow rates, a slow overall turn and a light domain
warp, mixed with Gaussian weights (that is the "heavily blurred mesh"), plus a dither. A
fragment-only shader with no texture reads beyond the glass. Credits for AMLL (AGPL-3.0,
technique) and Adaptive Palette (MIT, technique) go in the README.

## What was built (phases 1 to 8, 2026-10-20)

- **Colours** (`palette.js`): the cover read once per track at 40 px (async), k-means (k = 5,
  deterministic seed) in OkLab, the 4 most present and colourful kept; ~2 ms a cover, cached per
  cover (32). No cover: a neutral grey field at half strength. `tools/widgets-stress/covers.js`
  makes the test covers (dark, bright, monochrome, blue and orange) and prints their palettes.
- **The cover's own colours, the same in every mode** (user, mid-way): no per-mode remapping.
- **Text ink** (user follow-up: black text on vaguely light swirls was hard to read): the glass
  keeps most of its own lightness under the swirl, so the shown lightness is about
  0.62 x glass + 0.38 x swirl. Dark text only when that is over 0.70, which in practice means
  light glass with a light cover; white otherwise. The swirl then guarantees contrast: under white
  text nothing is lighter than mid grey, under dark text nothing darker than 74 %. Without a cover,
  the mode's own text.
- **Controls**: the widget's own filled icons (`icons/`, SF-like), recoloured with the text.
  Tahoe-Material's media icons have a stroke the shell does not recolour, which left a light
  outline on dark text. The headless harness now uses the user's icon theme.
- **Waves, not blobs** (user, mid-way): a three-step sine domain warp folds two smooth waves that
  mix the four colours into long ribbons, the plane turning at 0.04 rad/s; the warps move at
  0.08 to 0.23 rad/s, so a ribbon takes about half a minute to roll over. Dithered.
- **Inside the glass, translucent, highlights only** (user, mid-way): a `Clutter.OffscreenEffect`
  on the card's glass backdrop. The glass takes the swirl's hue at its own lightness (70 %), then
  moves 38 % towards the swirl's colour: the wallpaper's blur still shows through. Across the 14 px
  edge band the glass is read from just inside the band and only what is brighter at the edge (the
  rim light) is added back: no inner shadow or refraction bevel, no "3D emboss". The 1 px edge is
  CSS over everything, unchanged. Without Blur My Shell (fallback card) there is no swirl.
- **Large**: the cover 324 x 324 (356 less 16 px each side), radius 8 (24 - 16); title, artist,
  progress with times and controls under it; the card is 356 x 504 (a widget class can set a
  `static height`, `extension.js` `dims()`).
- **Wide**: 16 px padding on every side and between cover and column; the cover 138 x 138 (170 less
  two gaps); title and artist at its top right. **Controls**: right-aligned in the column to the
  right of the cover, just above the progress bar, which ends level with the cover's bottom edge.
  The hover circle of the last button (not its icon) ends on the column's edge, as the bar does.
- **Lyrics** and **small** share the same swirl (all music cards are `MusicWidget`s); every music
  card now has 16 px padding.
- **Lyrics drift, Apple Music style** (user, 2026-10-20 follow-ups): every line of the song sits in
  one column. The sung line is full size and bright, the others at 84 % and dim. At each line's
  time the lines drift up one by one (380 ms, ease-out quart; user: sharper, then a bit faster), each 22 ms after the one above it,
  so the text flows like a wave; the old line shrinks and dims as it goes up and the new one grows
  into its place (270 ms). Only scale, translation and opacity move, so the column never reflows;
  lines more than 10 away are not drawn. The eases run on the compositor between lines only, and
  end at once with GNOME animations off. Checked frame by frame (`SHOT_BURST=count,ms`).
- **Text in the cover's tint** (user follow-up): the text, artist, times, progress bar, lyrics
  and control icons take the cover's most colourful colour, very light (OkLab L 0.96, a little
  chroma) under white text and deep (L 0.27) under dark text; a cover without real colour gives
  plain white or near-black. The lyrics were Liquid Glass text for a while; the user found it
  too prominent, and at a subtle setting it only made the text look washed out next to the tint,
  so it was removed (solid tinted text, one fewer render pass).
- **Fonts** (same follow-up): Apple's SF throughout, Text under 20 px and Display from 20 px. Song
  titles are bigger: small 15, wide 17, lyrics 16, large 22 (SF Pro Display); artists 13 to 16. The
  large card grew to 356 x 504 to fit.
- **Public API unchanged**: `MusicSmall`, `MusicMedium`, `MusicLarge`, `MusicLyrics` keep their
  constructors, `size`, `setMode`, `tick`, `wantsSeconds`, `requestTick`, `destroy`; added
  `attachCard(card)` (optional: without it no swirl) and `MusicLarge.height`.

### Performance (headless shell, real GPU via gbm, 2560x1440, 4 music widgets, `STRESS_ONLY=swirl`)

| State | Stage paints/s | Swirl timer | Shell CPU |
|---|---|---|---|
| Playing | 26 | on (25 fps, one timer for all) | 2.7 % |
| Paused | 0 | off | 0.7 % (settling) |
| Track change while paused | 11 for 1.2 s | on for the cross-fade only | 2.7 % for 1.2 s |
| After that cross-fade | 0 | off | 0.2 % |
| Playing, GNOME animations off | 1 (the progress second) | off, still gradient | 0.3 % |
| Playing, under a fullscreen window | 0 | off | 0.2 % |
| Playing, locked | 0 | off (the extension is off while locked) | 0.6 % |
| Unlocked / animations back on | 26 | on again | 2.7 to 3 % |
| Idle baseline: paused from the start | 0 | off | **0.2 %, same as main without the swirl** |

The swirl paints at 25 fps whatever the refresh rate (120 Hz on the desktop: the frame clock only
draws when the timer damages the cards). Each frame only re-runs the shader over the glass already
rendered in the effect's texture (`queue_repaint` on the effect), so Blur My Shell's blur does
not run again. A window covering the whole card is checked on `restacked` and once a second while
playing. Full stress (`layout-all.json`): every scenario ok, timers 3, 2, 2, 2, 2, D-Bus subscriptions 1, actors
3466 to 3462, match rules 89 to 87 over lock and disable cycles: no leaks. The remaining logged
errors are the date menu's DBusProxy ones listed below.

Rerun: `STRESS_COVERS=a.png,b.png STRESS_ONLY=swirl DRIVER=widget-stress@local bash
tools/widgets-stress/run.sh OUT tools/widgets-stress/layout-music.json`. Screenshots:
`SHOT_FAKE_PLAYER=1 SHOT_ART=cover.png|none bash tools/widgets-stress/run.sh OUT
tools/widgets-stress/layout-music.json` (`SHOT_MOTION=ms` adds a later shot). The harness now uses
its own `XDG_RUNTIME_DIR`, so it never touches the session's crash guard file.

Sheets: `docs/shots/music-swirl-light.png`, `music-swirl-dark.png` (dark, bright, blue and no cover).

# Desktop widgets: stress and impact check (2026-10-19)

`extensions/tahoe-widgets@cachyos-tahoe`, tested in a throwaway headless gnome-shell
(`tools/widgets-stress/run.sh`, 2560x1440, the installed Blur My Shell and its settings, all 16
widget kinds on screen, 4 of them music). Input is scripted: button `clicked` signals, a Clutter
virtual pointer for drags, scrolls and right clicks, fake MPRIS players on their own D-Bus
connections (40 ms reply), session-mode pushes for lock/unlock, a real fullscreen GTK window.
Counted from inside the shell: the extension's live GLib timers and D-Bus signal subscriptions
(by call site), stage actors, and the shell connection's D-Bus match rules.

## Results

| Check | What was done | Before the fixes | Now |
|---|---|---|---|
| Spam clicks | play/pause, next, previous: 75 clicks each on 4 music widgets, 0-8 ms apart | every click a D-Bus call with no timeout, every property change a position Get | 4 calls per button reach the player (one in flight per button, clicks meanwhile dropped), 12 position Gets; icons and titles match the player afterwards |
| Rapid track changes | 40 metadata changes ~5 ms apart | one lrclib.net lookup per track for the lyrics widget | all titles end on the last track; one position Get at a time; lyrics looked up only once a track stays 1 s |
| Players appearing and leaving | a second player owns and drops its name 30 times, 0-18 ms apart | a proxy finished after its player left could stay as a ghost player | back to the first player; the second one shows when it stays; no ghost |
| Fast drags | 20 drags with a virtual pointer, the next one during the 150 ms snap | a drag cancelled mid-snap stayed off the grid; the right and bottom edge clamp was not on the 8 px grid | every widget on the grid, inside the work area, layout file saved with all 16 |
| Fast scrolling | 120 wheel and touchpad scroll events over every widget | | nothing moves, no errors (the widgets take no scroll input) |
| Right-click spam | 20 right clicks, 0-15 ms apart | | no errors |
| Lock / unlock | 16 cycles, 50-400 ms each | each one made a new shell WeatherClient (never freed) and destroyed the calendar event source, sometimes mid start-up ("Gio.DBusProxy already disposed" from calendar.js) | timers 2, D-Bus subscriptions 1, match rules 87, actors 3488 before and after; the weather client and calendar source are made once per shell session |
| Disable / enable | `disableExtension` / `enableExtension` 10 times, 0-300 ms apart | as above | same counts before and after |
| Idle, minute widgets only | digital, glass text, calendars, weather for 65 s | 65 ticks (every second) | 1 tick (on the minute) |
| Idle, second hands or music playing | analog faces, music progress | 1 tick a second | 1 tick a second (they show seconds) |
| Covered by a fullscreen window | real fullscreen GTK window for 5 s | ticked every second underneath | 0 ticks; ticking resumes when it closes |

The two long-lived timers are the clock tick and the 30-minute weather refresh.

## Left as they are (not the widgets)

- "Unhandled promise rejection" during rapid track changes and player flicker: the shell's own
  media controls; they happen with the widgets switched off too (control run).
- "Gio.DBusProxy already disposed" at calendar.js:239 on lock cycles under ~400 ms: every one comes
  from the shell's date menu swapping its own calendar source (`dateMenu.js:976`), not from the widgets.
- "Can't update stage views actor ... needs an allocation" while dragging: Blur My Shell's glass
  pieces inside the dragged card; the code from before this round logs the same (19 against 24 per run).
  Harmless.

## Rerun

```bash
DRIVER=widget-stress@local bash tools/widgets-stress/run.sh /tmp/widgets-stress tools/widgets-stress/layout-all.json
```

`STRESS_ONLY=drags`, `idle` or `control` runs one part; `DRIVER=widget-shot@local` (with
`SHOT_FAKE_PLAYER=1`) takes the light/dark/milky screenshots. The fake players have no artist, so
the test never asks lrclib.net.

## Shared with the lock screen (2026-10-20)

The lock screen extension (`extensions/tahoe-lockscreen@cachyos-tahoe`, docs/LOCKSCREEN_PLAN.md)
shows the wide Music widget under its clock. It carries exact copies of `glass.js`, `mpris.js`,
`swirl.js`, `music.js`, `palette.js` and `stylesheet.css` in its `widgets/` folder
(`tools/lockscreen/shared.list`). After changing any of them, run `tools/lockscreen/sync-shared.sh`;
`tools/lockscreen/check-shared.sh` fails when they have drifted.

Two opt-in changes made for it, which do nothing on the desktop:
- `mpris.js`: `fetchBytes`, the only network call (web covers, lyrics), refuses while the screen is
  locked. The desktop widgets are off while locked anyway.
- `swirl.js`: `new Swirl({lockScreen, gate})`, passed through `new MusicMedium({swirl: {...}})`. With
  `lockScreen` the swirl may run while locked (no window checks there) and `gate()` decides; by
  default it still holds still while locked.
