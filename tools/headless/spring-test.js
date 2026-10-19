// Self-test of tahoe-motion's springs: overshoot and settle time per M3 token, velocity kept on
// retarget, frame-rate independence, stagger spread. Run: gjs -m tools/headless/spring-test.js
import { Spring, EXPRESSIVE, LIQUID_MASS, stagger } from '../../extensions/tahoe-motion@cachyos-tahoe/spring.js';
const dt = 1 / 120;
for (const kind of ['spatial', 'effects']) {
    for (const speed of ['fast', 'default', 'slow']) {
        for (const mass of [1, LIQUID_MASS]) {
            const s = new Spring(0, EXPRESSIVE[kind][speed], { mass });
            s.retarget(1);
            let t = 0, peak = 0;
            while (!s.settled && t < 3) { s.step(dt); t += dt; peak = Math.max(peak, s.value); }
            print(`${kind} ${speed} mass ${mass}: overshoot ${((peak - 1) * 100).toFixed(1)} %, settled ${(t * 1000).toFixed(0)} ms`);
        }
    }
}
// retarget mid-flight keeps velocity
const s = new Spring(0, EXPRESSIVE.spatial.default);
s.retarget(1);
for (let i = 0; i < 12; i++) s.step(dt);
const v = s.velocity;
s.retarget(0);
print(`retarget: velocity before ${v.toFixed(2)}, after ${s.velocity.toFixed(2)}, next value moves on: ${s.value.toFixed(3)} -> ${s.step(dt).toFixed(3)}`);
// frame-rate independence
const a = new Spring(0, EXPRESSIVE.spatial.fast); a.retarget(1);
const b = new Spring(0, EXPRESSIVE.spatial.fast); b.retarget(1);
for (let i = 0; i < 24; i++) a.step(1 / 120);
for (let i = 0; i < 6; i++) b.step(1 / 30);
print(`120 Hz vs 30 Hz after 200 ms: ${a.value.toFixed(5)} vs ${b.value.toFixed(5)}`);
print(`stagger 8 rows base 50 inQuad: ${[...Array(8).keys()].map(i => stagger(i, 8, { base: 50 }).toFixed(0)).join(' ')}`);
