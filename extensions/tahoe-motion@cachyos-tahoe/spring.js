// Spring curves for tahoe-motion: progress from 0 to 1 over a duration, as a damped spring.
// Open: slightly underdamped (a small overshoot, about 3 %). Close: critically damped (no
// overshoot, faster). Both are exactly 1 at the end of their duration.

const SETTLE = 5.3; // e^-5.3: the spring is within 0.5 % of rest at the end of the duration

/// underdamped spring, damping ratio `zeta` < 1
export function springOpen(t, duration, zeta = 0.75) {
    if (t <= 0)
        return 0;
    if (t >= duration)
        return 1;
    const omega = SETTLE / (zeta * duration);
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));
}

/// critically damped spring
export function springClose(t, duration) {
    if (t <= 0)
        return 0;
    if (t >= duration)
        return 1;
    const omega = 7 / duration;
    return 1 - (1 + omega * t) * Math.exp(-omega * t);
}

export function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}
