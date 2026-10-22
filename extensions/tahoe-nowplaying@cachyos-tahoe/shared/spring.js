// Springs for tahoe-motion (docs/gnome-tahoe/motion-workshop.md).
//
// A Spring has a position, a velocity and a target, and moves by the exact solution of a damped
// harmonic oscillator (mass, stiffness, damping ratio: the model of Material 3's motion physics
// and anime.js's spring). It is advanced by real elapsed time, so a dropped frame does not change
// the path, and it is done when it has settled, not at a deadline. Retargeting keeps its velocity:
// an interrupted animation carries on from where, and how fast, it was moving.

/// Material 3 Expressive spring tokens (damping ratio, stiffness), mass 1
/// (https://m3.material.io/styles/motion/overview/specs)
export const EXPRESSIVE = {
    spatial: {
        fast: { damping: 0.6, stiffness: 800 },
        default: { damping: 0.8, stiffness: 380 },
        slow: { damping: 0.8, stiffness: 200 },
    },
    effects: {
        fast: { damping: 1, stiffness: 3800 },
        default: { damping: 1, stiffness: 1600 },
        slow: { damping: 1, stiffness: 800 },
    },
};

/// the glass's mass (1.15 felt too silky on the desktop; M3's own is 1)
export const LIQUID_MASS = 1.0;

const REST_DISTANCE = 0.0015;
const REST_SPEED = 0.02;

export class Spring {
    /// `token`: { damping, stiffness }; `mass` defaults to 1
    constructor(value, token, { mass = 1, velocity = 0 } = {}) {
        this.value = value;
        this.target = value;
        this.velocity = velocity;
        this.setToken(token, mass);
    }

    setToken(token, mass = this.mass ?? 1) {
        this.mass = mass;
        this.omega = Math.sqrt(token.stiffness / mass);
        this.zeta = token.damping;
    }

    /// a new target; the velocity is kept (`span`: the size of a unit of travel, for settling)
    retarget(target, span = null) {
        this.target = target;
        this.span = span ?? Math.max(1e-6, Math.abs(target - this.value));
        this.settled = false;
    }

    /// moves the spring on by `dt` seconds
    step(dt) {
        if (this.settled || dt <= 0)
            return this.value;
        const w = this.omega;
        const z = this.zeta;
        const u0 = this.value - this.target;
        const v0 = this.velocity;
        let u;
        let v;
        if (z < 1) {
            const wd = w * Math.sqrt(1 - z * z);
            const decay = Math.exp(-z * w * dt);
            const cos = Math.cos(wd * dt);
            const sin = Math.sin(wd * dt);
            u = decay * (u0 * cos + ((v0 + z * w * u0) / wd) * sin);
            v = decay * (v0 * cos - ((z * w * v0 + w * w * u0) / wd) * sin);
        } else if (z === 1) {
            const decay = Math.exp(-w * dt);
            const b = v0 + w * u0;
            u = (u0 + b * dt) * decay;
            v = (v0 - w * b * dt) * decay;
        } else {
            const root = Math.sqrt(z * z - 1);
            const r1 = -w * (z - root);
            const r2 = -w * (z + root);
            const c1 = (v0 - r2 * u0) / (r1 - r2);
            const c2 = u0 - c1;
            const e1 = Math.exp(r1 * dt);
            const e2 = Math.exp(r2 * dt);
            u = c1 * e1 + c2 * e2;
            v = c1 * r1 * e1 + c2 * r2 * e2;
        }
        this.value = this.target + u;
        this.velocity = v;
        const span = this.span ?? 1;
        if (Math.abs(u) < REST_DISTANCE * span && Math.abs(v) < REST_SPEED * span) {
            this.value = this.target;
            this.velocity = 0;
            this.settled = true;
        }
        return this.value;
    }
}

/// anime.js-style stagger: the delay of item `index` of `count`, `base` ms apart on average,
/// distributed by `ease` over the whole spread (inQuad: the first items follow each other
/// quickly, the tail fans out)
export function stagger(index, count, { base, ease = 'inQuad' } = {}) {
    if (count <= 1)
        return 0;
    const t = index / (count - 1);
    const shaped = EASES[ease]?.(t) ?? t;
    return shaped * base * (count - 1);
}

const EASES = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    inSine: t => 1 - Math.cos(t * Math.PI / 2),
};

/// M3: small things move fast, things covering part of the screen at the default speed, large
/// ones slow
export function speedFor(width, height) {
    if (width <= 200 && height <= 200)
        return 'fast';
    if (width <= 600 && height <= 500)
        return 'default';
    return 'slow';
}

export function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

// --- round 1 helpers (curves of time), kept until morph.js has moved to Spring ---

const SETTLE = 5.3;

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

export function springClose(t, duration) {
    if (t <= 0)
        return 0;
    if (t >= duration)
        return 1;
    const omega = 7 / duration;
    return 1 - (1 + omega * t) * Math.exp(-omega * t);
}
