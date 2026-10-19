# Motion workshop: making the glass animations smooth

Written 2026-10-19 after the user tried the drop animation live: "something feels off, like it's
too forced". This is the thinking; `motion-implementation.md` is the plan that follows from it.
The Liquid Glass look (tint, blur, rim, radii, docs/STANDARD.md) does not change: only motion.

## What the user asked for

- Smoother animations overall; study anime.js and Material 3's motion system.
- A more dramatic stagger.
- Elasticity at the end of the card: the glass card overshoots its final size slightly and
  returns to it.
- Icon transitions (pressing a button, turning something on or off): SF Symbols if a library
  exists, otherwise Material icons, outlined and rounded.

## Why the current motion feels forced

How it works today (`extensions/tahoe-motion@cachyos-tahoe`, round 1): each popup runs one frame
clock timeline. Every stage (fall, spread into a bar, open, each row, each button) is a spring
**curve of time** with a fixed start and a fixed duration, cut to exactly 1 when the duration ends.

1. **No velocity.** A curve of time has no momentum to hand on. The fall stops, the spread starts
   on its own clock; the overlap fakes inertia. Each stage ends with a small snap (the curve is
   forced to 1 at its deadline, even if the spring has not settled).
2. **Too many rhythms.** Six springs with six damping values (0.55 to 0.72) and six durations
   in 400 ms: it reads as choreography, not as one material.
3. **Content moves on its own.** Rows drop, scale and bounce on their own springs, unrelated to
   the glass that carries them.
4. **The elastic hits a wall.** The reveal cannot grow past the glass actor, so the overshoot of
   the opening stroke is clipped: the card stops dead at its edge.
5. **Size-blind.** A three-row right-click menu takes as long as the calendar.
6. **Opacity overshoots** in places (the content fade rides spatial springs), which reads as a
   flicker rather than a bounce.

## What the references teach

### Material 3 motion (M3 Expressive, May 2025)

[How it works](https://m3.material.io/styles/motion/overview/how-it-works),
[specs](https://m3.material.io/styles/motion/overview/specs).

- Motion is **springs, not easing and duration**: stiffness, damping and initial velocity.
  Springs handle interruptions and retargeting naturally (they carry their velocity).
- Two kinds of spring: **spatial** (position, size, rotation, corner radius) overshoot and bounce
  into place; **effects** (opacity, colour) never overshoot.
- Three speeds: **fast** for small things (buttons, switches), **default** for things that cover
  part of the screen (menus, sheets), **slow** for full-screen ones.
- Two schemes: **expressive** (overshoots, for hero moments) and **standard** (functional).
  Most of a product should use one scheme.
- Expressive tokens (mass 1):

  | Token | Damping ratio | Stiffness | Web curve equivalent |
  |---|---|---|---|
  | spatial fast | 0.6 | 800 | cubic-bezier(0.42, 1.67, 0.21, 0.90), 350 ms |
  | spatial default | 0.8 | 380 | cubic-bezier(0.38, 1.21, 0.22, 1.00), 500 ms |
  | spatial slow | 0.8 | 200 | cubic-bezier(0.39, 1.29, 0.35, 0.98), 650 ms |
  | effects fast | 1.0 | 3800 | 150 ms |
  | effects default | 1.0 | 1600 | 200 ms |
  | effects slow | 1.0 | 800 | 300 ms |

  (Standard scheme: spatial 0.9 with 1400 / 700 / 300; same effects.)

### anime.js (v4)

[Spring](https://animejs.com/documentation/easings/spring),
[stagger](https://animejs.com/documentation/stagger/stagger-parameters/stagger-use),
[4.2.0 release](https://newreleases.io/project/npm/animejs/release/4.2.0).

- A spring is **mass, stiffness, damping, velocity**; higher mass is heavier and slower, higher
  stiffness snappier, higher damping less bounce. Since 4.2 a spring can also be given by
  perceived **bounce** (-0.5 to 0.5) and **duration**.
- **Stagger** is a function, not a constant: a base delay, `from` (first, last, centre, an index),
  a `grid` (`[columns, rows]`, delays by distance from `from` in 2D), and an **ease applied to the
  delays** (for example `outQuad`), so the first items leave quickly and the tail spreads out:
  that is what makes a stagger read as a wave instead of a metronome.
- Timelines place animations at **positions relative to each other** ('<', '+=50'), not at
  absolute times.
- Can anime.js run in GNOME Shell? Its engine is built for the browser (it ticks on
  `requestAnimationFrame` and animates DOM and CSS targets). GNOME Shell has neither; its frame
  clock is Clutter's. What we need from it is its model, which is plain maths (a damped harmonic
  oscillator, eased stagger distributions). **Decision: implement the same model natively** in
  `spring.js`, ticked by Clutter's frame clock, keeping anime.js's parameter names and semantics.
  No vendored browser code in the shell.

### Liquid morphs

[liquid_glass_widgets LiquidMorphPhysics](https://pub.dev/documentation/liquid_glass_widgets/0.22.1/utils_liquid_morph_physics/LiquidMorphPhysics-class.html),
[motion design principles for cards](https://playbooks.com/skills/dylantarre/animation-principles/cards-containers).

- One drop travels and expands into the target; squash and stretch only on small shapes;
  containers move first and content trails it by 20 to 40 ms.

### Icons

- **SF Symbols:** the symbol effects (Bounce, Pulse, Replace / Magic Replace, Draw On / Off,
  Wiggle, Rotate, Breathe) are Apple framework features
  ([SF Symbols 7](https://developer.apple.com/sf-symbols)). There is **no open-source library**
  that brings them to Linux or the web
  ([SwiftUI animated symbols](https://designcode.io/swiftui-ios17-animated-sf-symbols-5),
  [Expo Symbols](https://docs.expo.dev/versions/latest/sdk/symbols.md) wraps the native ones), and
  Apple's licence limits SF Symbols to Apple platforms. Not an option.
- **Material Symbols Rounded** (Apache 2.0): a variable font with FILL (0 outlined to 1 filled),
  wght, GRAD and opsz axes; Google's own guidance is to animate FILL for a state change such as
  on / off ([Material Symbols](https://9to5google.com/2022/04/21/google-fonts-material-symbols/),
  [axes](https://fonts.grida.co/material-symbols-rounded)). GNOME's text stack (Pango 1.58 here)
  can set variable axes per frame (`Material Symbols Rounded 20 @FILL=0.4`), so an outline icon
  can fill in smoothly when a toggle turns on. Needs the font file (not installed; a download the
  user approves).
- **Effects that work with any icon** (and with the current icons): a press **bounce** (scale
  down, spring back past 1 and settle), and a **replace** when a toggle's state or icon changes
  (the old icon shrinks and fades as the new one grows in, on a fast spatial spring). These are
  the SF Symbols Bounce and Replace effects, built natively.

## Liquid, not rigid (user: "this is liquid glass, it should feel liquid like")

What makes motion read as liquid rather than as a box that scales:

- **Volume.** A liquid keeps its volume: when it stretches one way it thins the other. The drop
  lengthens and narrows as it falls; when the card overshoots in width it is a touch shorter, and
  the other way round, so the settle is a **jelly wobble** (width and height oscillate out of
  phase and decay) instead of a uniform pulse.
- **Viscosity.** Its edges do not move as one. The edge leading the motion (away from the origin)
  runs ahead; the trailing edge, held by the origin, follows a beat later; the sides catch up.
  Four edges on four springs of slightly different stiffness give that pull and catch-up.
- **Surface tension.** While it moves it stays round: the corner radius stays large during the
  motion and relaxes to the card's radius last, on a slower effects spring, as the liquid comes
  to rest.
- **Mass.** A little heavier than a UI panel: a slightly higher mass (1.15) so it starts softly
  and settles without a hard stop, never a linear or abrupt motion.
- **Continuity.** One body throughout: the drop, the bar and the card are the same shape on the
  same springs; nothing appears or snaps between stages.

## Decisions

1. **One physics engine.** `spring.js` becomes a real spring: position and velocity, integrated
   exactly (closed-form damped oscillator with initial velocity), mass / stiffness / damping ratio
   as in M3 and anime.js, finished when it has settled (not at a deadline). Retargeting keeps the
   velocity, so an interrupted open or close continues from where and how fast it was moving.
2. **One scheme: M3 Expressive.** Glass shape and positions use spatial springs (default for
   menus and cards, fast for small menus and buttons, slow for the calendar); opacity uses effects
   springs, so nothing flickers.
3. **A chain, not a clock.** Each stage of the card (drop, bar, card) starts when the previous one
   has travelled far enough (a progress threshold), and inherits its velocity. The drop's motion
   carries into the spread for real.
4. **Elastic, liquid settle with real overshoot.** The card's reveal reaches the full card on
   its edge springs (it cannot pass the glass's edge); the elastic is carried by the popup itself:
   it grows from 0.92 to 1 about its origin (the icon or pointer) on an expressive spatial spring,
   overshooting to about 1.02, and its width and height wobble out of phase (volume kept) as it
   settles. Blur My Shell already captures the backdrop where the popup rests (the BoxPointer's
   scale is taken out), so the glass stays right.
9. **Liquid shape.** Four edge springs (leading edge ahead, trailing edge a beat behind), the
   corner radius held round until the end, mass 1.15, and the drop's stretch and squash kept
   volume-true.
5. **Content rides the glass.** Rows trail the growing edge (they start as it passes them) and
   settle on the same spatial spring as the card; their fade is an effects spring.
6. **A dramatic stagger, eased.** Stagger delays follow anime.js's eased distribution: a larger
   base gap (50 ms between rows, 70 ms between quick settings rows), eased `outQuad` so the first
   items come quickly and the tail fans out; rows travel further (16 px) and start smaller (0.85).
7. **Icons: effects now, Material Symbols as an option.** Bounce on press and Replace on toggle
   for the quick settings icons with the current icon set. Material Symbols Rounded (outlined,
   FILL animated on toggle) as a separate, switchable phase once the user approves the font
   download.
8. **Size-aware speed.** A card's spring speed follows its area: fast below 200 x 200 px,
   default up to 600 x 500, slow above.

## Out of scope

The glass look, radii and layout (docs/STANDARD.md); the menu bar's own icons; GTK app menu
closing (GNOME destroys those windows at once).
