# Vendored code

| File | What | Version | Licence | Source |
|---|---|---|---|---|
| `ical.js` | iCalendar parser and recurrence expansion (Mozilla, Thunderbird) | 2.2.1, `dist/ical.js`, unmodified | MPL-2.0 (`ical.js.LICENSE`) | <https://github.com/kewisch/ical.js>, npm `ical.js-2.2.1.tgz`, sha512 `yK/UlPbEs316igb/tjRgbFA8ZV75rCsBJp/hWOatpyaPNlgw0dGDmU+FoicOcwX4xXkeXOkYiOmCqNPFpNPkQg==` |

MPL-2.0 is a file-level licence: `ical.js` stays under it, and the rest of this extension (GPL-3.0)
uses it as a larger work (MPL-2.0 section 3.3). It runs only in the Schedule widgets' helper
process (`ics-expand.js`), never inside the shell.
