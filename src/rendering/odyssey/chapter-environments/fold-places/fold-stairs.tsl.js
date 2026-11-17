/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE STAIRS — the fold's fifth place (orb 54: Serenity Warp).
 *
 * Endless flights of glass stairs through indigo air, in three families that do not agree on
 * which way is down: one climbs the floor, one a wall, one the ceiling, each running on out of
 * sight both ways and passing through the others. Their steps run up them like an escalator's,
 * for ever; on a happening they melt into smooth ramps and form again, and while they are melted
 * the three families' glasses change places (so the stairs are not the same after it as before).
 *
 * Sphere-traced, solid. A family is one flight repeated across its own plane and from plane to
 * plane; in the frame turned 45 degrees its treads and risers are a zigzag with slopes of one, so
 * its distance is exact. The face that is hit is known from the distance's own parts, so there is
 * no normal to estimate. The eye rides the one line all three families leave clear.
 */
import {
    Break, If, Loop, abs, clamp, dot, exp, float, floor, int, max, min, mix, mod, smoothstep, step, vec3,
} from 'three/tsl';
import {
    film, frameRows, gauss, pick, sq, stroke, turn,
} from './fold-tools.tsl.js';

export const STAIRS = Object.freeze({
    frame: [-24, -11, 7],
    tread: 0.8,
    width: 3.4,
    thick: 0.5,
    /** Flights of one family stand `apart` in their own plane, in planes `planes` apart. */
    apart: 19,
    planes: 21,
    reach: 110,
    fog: 0.021,
    /** The steps' climb, in steps a second. */
    climb: 0.05,
    /** The three downs' glasses (violet, aqua, rose), as they stand after no, one, two and three
     * happenings: each a whole colour, handed round, and as at first again after the fourth. */
    glass: Object.freeze([
        Object.freeze([[0.46, 0.34, 1.0], [0.10, 0.80, 0.86], [1.0, 0.42, 0.50], [1.0, 0.42, 0.50]]),
        Object.freeze([[0.10, 0.80, 0.86], [1.0, 0.42, 0.50], [0.46, 0.34, 1.0], [0.10, 0.80, 0.86]]),
        Object.freeze([[1.0, 0.42, 0.50], [0.46, 0.34, 1.0], [0.10, 0.80, 0.86], [0.46, 0.34, 1.0]]),
    ]),
});

const ROWS = frameRows(STAIRS.frame);
const PERIOD = STAIRS.tread * Math.SQRT2;

/**
 * One family at a point given in its own frame `f` (x along the run, y up, z across): its
 * distance and that distance's parts.
 */
function family(f, vOff, shift, melt) {
    const V = STAIRS;
    const u = f.x.add(f.y).mul(Math.SQRT1_2).toVar();
    const v0 = f.y.sub(f.x).mul(Math.SQRT1_2).add(vOff);
    const v = v0.sub(floor(v0.div(V.apart).add(0.5)).mul(V.apart)).toVar();
    const w = f.z.sub(floor(f.z.div(V.planes).add(0.5)).mul(V.planes)).toVar();
    const ph = u.div(PERIOD).add(shift).toVar();
    const fr = ph.sub(floor(ph)).toVar();
    const tri = abs(fr.sub(0.5)).toVar();
    const zig = tri.mul(4).sub(1).mul(V.tread * 0.35355).mul(melt);
    const top = v.sub(zig).mul(Math.SQRT1_2).toVar();
    const under = v.add(V.thick).negate().toVar();
    const sides = abs(w).sub(V.width / 2).toVar();
    return {
        d: max(max(top, under), sides).toVar(), top, under, sides, fr, tri, v, u,
    };
}

export function placeStairs({
    rd, tm, zEye, pix, mood, event, eventAge, turns, steps, jitter,
}) {
    const V = STAIRS;
    const r = turn(rd, ROWS).toVar();
    const eye = vec3(V.planes / 2, V.planes / 2, zEye).toVar();
    const t = float(1.5).add(jitter.mul(0.5)).toVar();
    const hit = float(0).toVar();
    const shift = tm.mul(V.climb).toVar();
    const melt = float(1).sub(event.mul(0.9)).toVar();
    const families = (p) => [
        family(p, V.apart / 2, shift, melt),
        family(p.yzx, V.apart / 3, shift.add(0.37), melt),
        family(p.zxy, 0, shift.add(0.71), melt),
    ];
    const marchSteps = Math.round(steps * 1.3);
    Loop({
        start: int(0), end: int(marchSteps), type: 'int', condition: '<', name: 'stairStep',
    }, () => {
        const p = eye.add(r.mul(t)).toVar();
        const [a, b, c] = families(p);
        const d = min(min(a.d, b.d), c.d).toVar();
        If(d.lessThan(t.mul(pix).mul(0.75).add(0.002)), () => {
            hit.assign(1);
            Break();
        });
        t.addAssign(d);
        If(t.greaterThan(V.reach), () => {
            Break();
        });
    });
    // The air between: indigo, a soft light high on one side, a cooler one low on the other.
    const hi = clamp(dot(r, vec3(-0.48, 0.62, 0.62)), 0.0, 1.0);
    const lo = clamp(dot(r, vec3(0.6, -0.5, 0.62)), 0.0, 1.0);
    const air = vec3(0.005, 0.004, 0.018)
        .add(mix(vec3(0.15, 0.075, 0.34), vec3(0.26, 0.10, 0.28), mood.x).mul(sq(hi).mul(hi)).mul(0.55))
        .add(vec3(0.008, 0.055, 0.095).mul(sq(lo)).mul(0.6))
        .toVar();
    const col = air.toVar();
    If(hit.greaterThan(0.5), () => {
        const p = eye.add(r.mul(t)).toVar();
        const [a, b, c] = families(p);
        // The family that is hit: the nearest of the three.
        const isA = step(a.d, min(b.d, c.d)).toVar();
        const isB = float(1).sub(isA).mul(step(b.d, c.d)).toVar();
        const of = (key) => mix(mix(c[key], b[key], isB), a[key], isA).toVar();
        const top = of('top');
        const under = of('under');
        const sides = of('sides');
        const tri = of('tri');
        const fr = of('fr');
        const v = of('v');
        const u = of('u');
        const onTop = step(max(under, sides), top).toVar();
        const onSide = step(max(under, top), sides).toVar();
        // The three downs, each its own glass; every happening hands the glasses round (the
        // clock's turns, eased through the happening: as at first again after four).
        const stood = floor(turns).toVar();
        const handing = turns.sub(stood).toVar();
        const glassOf = (i) => mix(pick(stood, V.glass[i]), pick(mod(stood.add(1), 4.0), V.glass[i]), handing);
        const glass = mix(mix(glassOf(2), glassOf(1), isB), glassOf(0), isA).toVar();
        const aa = t.mul(pix).mul(1.5).toVar();
        // Each step is lit along itself: bright at its nosing, falling into the corner; a tread
        // more than a riser. The happening sends a wave of light climbing every flight.
        const lift = smoothstep(0.0, 0.5, tri).toVar();
        const tread = step(fr, 0.5).toVar();
        const climbing = gauss(u.mul(0.045).sub(eventAge.mul(0.35)).add(2.0)).mul(event);
        const stepLight = mix(lift.mul(0.040).add(0.010), lift.mul(0.20).add(0.050), tread)
            .mul(climbing.mul(1.6).add(1.0));
        const nosing = stroke(float(0.5).sub(tri).mul(PERIOD), 0.022, aa).mul(onTop).mul(melt);
        const rail = stroke(abs(sides), 0.04, aa).mul(max(onTop, onSide));
        // A side shows the glass's depth: lighter under the steps, darker toward the underside.
        const sideLight = smoothstep(-STAIRS.thick, 0.3, v).mul(0.05).add(0.012);
        const face = glass.mul(stepLight).mul(onTop)
            .add(glass.mul(sideLight).mul(onSide))
            .add(glass.mul(0.007).add(vec3(0.002, 0.002, 0.007)));
        const sheen = film(v.mul(0.5).add(u.mul(0.03)).add(mood.y.mul(0.3))).mul(float(1).sub(onTop)).mul(0.016);
        const lines = mix(glass, vec3(1, 1, 1), 0.5).mul(nosing.mul(0.7).add(rail.mul(0.42)));
        const fog = exp(t.mul(-V.fog));
        col.assign(mix(air, face.add(sheen).add(lines), fog));
    });
    return col;
}
