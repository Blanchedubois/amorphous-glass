// The key map (docs/NOWPLAYING_PLAN.md §2). The view is modal, so every key reaches it; decide()
// says what a key does. Escape and the hotkey always close; the player's keys act and keep the view
// open; keys GNOME should still see (volume, brightness, Print) pass; any other key closes.
// Pure: no shell state, so the test driver checks every row directly.

import Clutter from 'gi://Clutter';

export const Action = Object.freeze({
    CLOSE: 'close',
    NONE: 'none',             // nothing, stay open (a modifier alone)
    PASS: 'pass',             // GNOME's: not ours, stay open, let it through
    PLAY_PAUSE: 'play-pause',
    PAUSE: 'pause',
    STOP: 'stop',
    NEXT: 'next',
    PREVIOUS: 'previous',
    SEEK_FORWARD: 'seek-forward',
    SEEK_BACK: 'seek-back',
    VOLUME_UP: 'volume-up',
    VOLUME_DOWN: 'volume-down',
});

const M = Clutter.ModifierType;
const SHIFT = M.SHIFT_MASK;
const CONTROL = M.CONTROL_MASK;
const ALT = M.MOD1_MASK;
const SUPER = M.SUPER_MASK | M.MOD4_MASK;   // Mutter reports Super as either
const MODIFIERS = SHIFT | CONTROL | ALT | SUPER;

const K = name => Clutter[`KEY_${name}`];

// a modifier on its own does nothing, so Shift+arrow works and a stray Super does not close
const MODIFIER_KEYS = new Set(['Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R',
    'Meta_L', 'Meta_R', 'Super_L', 'Super_R', 'Hyper_L', 'Hyper_R', 'ISO_Level3_Shift',
    'ISO_Level5_Shift', 'Caps_Lock', 'Num_Lock'].map(K).filter(Boolean));

// GNOME's own keys: they keep working (gsd media keys, the screenshot UI) and the view stays
const PASS_KEYS = new Set(['AudioRaiseVolume', 'AudioLowerVolume', 'AudioMute', 'AudioMicMute',
    'MonBrightnessUp', 'MonBrightnessDown', 'KbdBrightnessUp', 'KbdBrightnessDown', 'Print']
    .map(K).filter(Boolean));

const PLAYER_KEYS = new Map([
    ['AudioPlay', Action.PLAY_PAUSE],
    ['AudioPause', Action.PAUSE],
    ['AudioStop', Action.STOP],
    ['AudioNext', Action.NEXT],
    ['AudioPrev', Action.PREVIOUS],
].map(([name, action]) => [K(name), action]).filter(([k]) => k));

// a key as a comparable token: the lower-case character for printable keys, else the keyval
function token(keyval) {
    const u = Clutter.keysym_to_unicode(keyval);
    return u > 32 ? String.fromCodePoint(u).toLowerCase() : keyval;
}

const ACCEL_MODS = {shift: SHIFT, control: CONTROL, ctrl: CONTROL, primary: CONTROL, alt: ALT, mod1: ALT, super: SUPER, mod4: SUPER, meta: SUPER};

// '<Super><Shift>m' as {mods, key}; null if it cannot be read
export function parseAccelerator(text) {
    let mods = 0;
    const rest = text.replace(/<([^>]+)>/g, (_m, name) => {
        mods |= ACCEL_MODS[name.toLowerCase()] ?? 0;
        return '';
    }).trim();
    if (!rest)
        return null;
    const keyval = rest.length === 1 ? null : K(rest);
    const key = rest.length === 1 ? rest.toLowerCase() : keyval && token(keyval);
    return key ? {mods, key} : null;
}

// the same modifier groups held (Super as either mask)
function sameMods(state, mods) {
    const held = state & MODIFIERS;
    const group = mask => Boolean(held & mask) === Boolean(mods & mask);
    return group(SHIFT) && group(CONTROL) && group(ALT) && group(SUPER);
}

// keyval and modifier state of a key press, and the hotkey's parsed accelerators
export function decide(keyval, state, accelerators = []) {
    if (keyval === Clutter.KEY_Escape)
        return Action.CLOSE;
    if (accelerators.some(a => a && a.key === token(keyval) && sameMods(state, a.mods)))
        return Action.CLOSE;
    if (MODIFIER_KEYS.has(keyval))
        return Action.NONE;
    if (PASS_KEYS.has(keyval))
        return Action.PASS;
    if (PLAYER_KEYS.has(keyval))
        return PLAYER_KEYS.get(keyval);

    // the plain keys act only alone or with Shift; with Ctrl, Alt or Super they close
    const mods = state & MODIFIERS;
    if (mods & ~SHIFT)
        return Action.CLOSE;
    const shift = Boolean(mods & SHIFT);
    switch (keyval) {
    case Clutter.KEY_space:
        return Action.PLAY_PAUSE;
    case Clutter.KEY_Right:
        return shift ? Action.SEEK_FORWARD : Action.NEXT;
    case Clutter.KEY_Left:
        return shift ? Action.SEEK_BACK : Action.PREVIOUS;
    case Clutter.KEY_Up:
        return Action.VOLUME_UP;
    case Clutter.KEY_Down:
        return Action.VOLUME_DOWN;
    default:
        return Action.CLOSE;
    }
}
