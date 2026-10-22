// SF Symbols, drawn as text from the SF Pro the user installed (scripts/sf-fonts.sh); nothing of
// Apple's is copied into the repo. The code points were found in SF Pro by shape and checked by eye
// (docs/NOWPLAYING_PLAN.md, "The controls"). Without SF Pro, or if it lacks a symbol, the control
// falls back to a symbolic icon (the Music widget's own SVGs, or the icon theme's).

import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

export const SYMBOLS = Object.freeze({
    'play.fill': 0x100284,
    'pause.fill': 0x100286,
    'backward.fill': 0x10028a,
    'forward.fill': 0x10028c,
    'shuffle': 0x10029d,
    'repeat': 0x10029e,
    'speaker.fill': 0x1002a1,
    'speaker.wave.3.fill': 0x1002a9,
    'ellipsis': 0x100360,
    'chevron.down': 0x100188,
});

const FAMILY = 'SF Pro Text';

// SF Pro is installed and draws the symbol itself (not a fallback font's box)
let hasFamily = null;
export function symbolAvailable(name) {
    const code = SYMBOLS[name];
    if (!code)
        return false;
    try {
        const map = PangoCairo.FontMap.get_default();
        hasFamily ??= map.list_families().some(f => f.get_name() === FAMILY);
        if (!hasFamily)
            return false;
        const layout = Pango.Layout.new(map.create_context());
        layout.set_font_description(Pango.FontDescription.from_string(`${FAMILY} 20`));
        layout.set_text(String.fromCodePoint(code), -1);
        return layout.get_unknown_glyphs_count() === 0;
    } catch {
        return false;
    }
}

// the symbol as a label (size in px), else the fallback icon
export function symbolActor(name, size, fallbackIcon) {
    if (symbolAvailable(name)) {
        const label = new St.Label({
            style_class: 'tahoe-np-symbol',
            text: String.fromCodePoint(SYMBOLS[name]),
            style: `font-family: "${FAMILY}"; font-weight: 600; font-size: ${size}px;`,
        });
        // a symbol is never shortened to "…" (a box a little narrower than the glyph)
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        return label;
    }
    return new St.Icon({style_class: 'tahoe-np-symbol', icon_name: fallbackIcon, icon_size: Math.round(size * 1.1)});
}

// changes a symbolActor() to another symbol (play and pause), keeping its size
export function setSymbol(actor, name, size, fallbackIcon) {
    if (actor instanceof St.Label && symbolAvailable(name))
        actor.text = String.fromCodePoint(SYMBOLS[name]);
    else if (actor instanceof St.Icon)
        actor.icon_name = fallbackIcon;
}
