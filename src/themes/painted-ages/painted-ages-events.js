/**
 * Painted Ages — what gameplay does to the light (TSL, read by the land and the sky).
 *
 *  - ribbonLight: each lock's pigment running along its bed (the light's front races out from
 *    where the piece landed; behind it the bed glows and fades);
 *  - waveLight: each clear's band of light climbing the strata through the whole land;
 *  - rainbow: the bow over the valley after a chain (primary, and a secondary on long ones);
 *  - showerVeil: the rain hanging under the clouds while a chain holds;
 *  - goldVeins: back-to-back's veins of gold cutting ACROSS the beds, a flare running out
 *    along them;
 *  - riverWater: the river, and four lines' flood of paint poured into it.
 *
 * Inline builders (they read the uniform tables).
 */
import {
    Fn,
    If,
    Loop,
    abs,
    acos,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { RIVER, RIVER_ALONG } from './painted-ages-plan.js';
import { skyColour } from './painted-ages-light.js';

const DEG = Math.PI / 180;
/** x², as a product: pow() of a negative base is NaN in WGSL. */
const sq = (x) => x.mul(x);

/**
 * The ribbons' light at a land point: `g` its geological height, `gw` how much g changes across a
 * pixel there (a bed thinner than a pixel is drawn a pixel wide, dimmer).
 */
export function ribbonLight(u, xz, g, gw) {
    const sum = vec3(0.0).toVar();
    Loop({
        start: int(0), end: u.ribbonCount, type: 'int', condition: '<', name: 'rb',
    }, ({ rb }) => {
        const a = u.ribbons.element(rb.mul(3));
        const c = u.ribbons.element(rb.mul(3).add(1));
        const s = u.ribbons.element(rb.mul(3).add(2));
        const age = u.time.sub(a.w);
        // The bed's light is a line a few pixels wide wherever the bed crosses the land (on a gentle
        // slope a bed metres thick would cover a field), with a faint glow of the bed's own width.
        const line = gw.mul(4.0).max(0.2);
        const inBed = exp(sq(g.sub(a.z).div(line)).negate())
            .add(exp(sq(g.sub(a.z).div(max(s.x, line))).negate()).mul(0.4));
        const d = length(xz.sub(a.xy));
        const front = age.mul(s.y);
        // The racing front, the glow it leaves, and the source.
        const ahead = d.sub(front);
        const head = exp(sq(ahead.div(26.0)).negate()).mul(2.2);
        // Bounded before it is masked: a far point would otherwise give e^(huge) × 0 = NaN.
        const trail = smoothstep(14.0, -6.0, ahead).mul(exp(max(front.sub(d), 0.0).div(160.0).negate()).mul(0.6).add(0.3));
        const reach = float(1.0).sub(smoothstep(s.z.mul(0.7), s.z, d));
        const fade = smoothstep(0.0, 0.05, age).mul(exp(age.div(1.6).negate()).mul(0.7).add(0.3))
            .mul(float(1.0).sub(smoothstep(2.4, 3.6, age)));
        // A hard drop also sends a ring of light out along the ground itself.
        const ring = exp(sq(ahead.div(6.0)).negate()).mul(s.w).mul(exp(age.div(0.8).negate())).mul(0.9);
        const near = exp(d.div(70.0).negate()).mul(exp(age.div(0.8).negate())).mul(2.0);
        // Where the piece landed, a stain of its pigment blooms on the rock and sinks in (the
        // bed's light is a thin line: alone, a lock far off was hard to find).
        const stain = exp(sq(d.div(30.0)).negate()).mul(smoothstep(0.0, 0.06, age)).mul(exp(age.div(0.75).negate())).mul(0.24);
        const amount = inBed.mul(head.add(trail).add(near)).mul(reach).mul(fade).add(ring.mul(reach))
            .add(stain);
        // Lifted toward white a little, so a red ribbon still glows over red rock.
        sum.addAssign(mix(c.xyz, vec3(c.xyz.x.max(c.xyz.y).max(c.xyz.z)), 0.22).mul(c.w).mul(amount));
    });
    return sum;
}

/**
 * Light above `knee` (its brightest channel) eases toward knee + room instead of piling up: many
 * overlapping glows stay a colour rather than climbing to white. Below the knee it is untouched.
 */
function softKnee(c, knee, room) {
    const m = max(c.x, max(c.y, c.z)).max(1e-4);
    const over = m.sub(knee).max(0.0);
    const eased = m.sub(over).add(over.div(over.div(room).add(1.0)));
    return c.mul(eased.div(m));
}

/** The waves' light: bands of geological height climbing through the land. */
export function waveLight(u, g, gw) {
    const sum = vec3(0.0).toVar();
    const after = vec3(0.0).toVar();
    Loop({
        start: int(0), end: u.waveCount, type: 'int', condition: '<', name: 'wv',
    }, ({ wv }) => {
        const a = u.waves.element(wv.mul(2));
        const c = u.waves.element(wv.mul(2).add(1));
        const age = u.time.sub(a.z);
        const at = a.x.add(a.y.mul(max(age, 0.0)));
        // A line a few pixels wide where the band meets the land, over a faint glow of its width.
        const line = gw.mul(2.8).max(0.12);
        const band = exp(sq(g.sub(at).div(line)).negate()).add(exp(sq(g.sub(at).div(max(c.w, line))).negate()).mul(0.18));
        // Below the band, the beds it has passed keep a little of its light for a moment.
        const passed = smoothstep(line, line.negate().mul(2.0), g.sub(at)).mul(exp(max(at.sub(g), 0.0).div(30.0).negate())).mul(0.12);
        const fade = smoothstep(0.0, 0.1, age).mul(float(1.0).sub(smoothstep(2.8, 4.2, age)));
        const light = c.xyz.mul(a.w).mul(fade);
        sum.addAssign(light.mul(band));
        after.addAssign(light.mul(passed));
    });
    // A chain keeps many bands climbing at once: their afterglow is held under a ceiling (one
    // band's own stays as it was), so the land keeps its colours instead of washing out.
    return sum.add(softKnee(after, 0.3, 0.25));
}

/**
 * The bow over the valley (an artist's placement: its centre stands below the horizon straight
 * ahead, so its two legs come down on both sides of the board). `bow` = (strength, secondary,
 * age). Returns light to add.
 */
export function rainbow(u, dir) {
    // The centre stands 32° below the horizon ahead: a low arc across the valley whose legs come
    // down on the hills on both sides of the board.
    const centre = normalize(vec3(u.camFwd.x, -0.62, u.camFwd.z));
    const theta = acos(clamp(dot(normalize(dir), centre), -1.0, 1.0)).div(DEG);
    const band = (radius, width, flip) => {
        const x = theta.sub(radius).div(width);
        // Red outside (flip = 1 for the primary), violet inside; the secondary is reversed.
        const t = flip ? x.mul(0.5).add(0.5) : float(0.5).sub(x.mul(0.5));
        const red = exp(sq(t.sub(0.9).div(0.16)).negate());
        const green = exp(sq(t.sub(0.5).div(0.18)).negate());
        const blue = exp(sq(t.sub(0.12).div(0.17)).negate());
        const violet = exp(sq(t.sub(-0.05).div(0.1)).negate()).mul(0.5);
        const within = smoothstep(1.25, 0.95, abs(x));
        return vec3(red.add(violet), green.add(red.mul(0.35)), blue.add(violet)).mul(within);
    };
    const primary = band(41.5, 1.7, true);
    const secondary = band(51.5, 2.3, false).mul(u.bow.y).mul(0.45);
    // Alexander's band: the sky darkens a little between the two bows.
    const strength = u.bow.x.mul(smoothstep(0.0, 1.5, u.bow.z));
    // Fainter toward its crown (the drops thin out up there), as a real bow is.
    const crown = smoothstep(0.32, 0.05, dir.y).mul(0.6).add(0.4);
    // A far shower shows only a shard of it: the foot of the bow on the shower's side, where
    // its curtains hang (bowLeg ±1). A chain's bow or a perfect clear's stands whole (0).
    const side = atan(dir.x, dir.z.negate()).mul(u.bowLeg.sign());
    const shard = smoothstep(0.22, 0.4, side).mul(smoothstep(0.2, 0.08, dir.y));
    const whole = mix(float(1.0), shard, abs(u.bowLeg));
    return primary.add(secondary).mul(strength).mul(crown).mul(whole)
        .mul(0.42);
}

/**
 * The weather's far shower: curtains of rain hanging on one side of the view, slanting with the
 * wind and thinning as they fall. `az` is the bearing (radians right of the view axis), `lift`
 * a height along the curtain (a direction's y in the sky, a fraction of it on the land) the
 * slant runs with. `u.virga` = (bearing, amount, slant). Returns 0..1.
 */
export function virgaVeil(u, noise, az, lift) {
    const rel = az.sub(u.virga.x);
    const window = exp(sq(rel.div(0.17)).negate());
    const s = rel.add(lift.mul(u.virga.z));
    const broad = texture(noise, vec2(s.mul(1.9), u.time.mul(0.004).add(0.37))).r;
    const fine = texture(noise, vec2(s.mul(9.0), u.time.mul(0.007).add(0.81))).b;
    const curtains = smoothstep(0.3, 0.62, broad.mul(0.7).add(fine.mul(0.3)));
    return curtains.mul(window).mul(u.virga.y);
}

/** Rain hanging under the clouds while a chain holds: vertical veils, thicker toward the front. */
export function showerVeil(u, dir) {
    const az = atan(dir.x, dir.z.negate());
    const streaks = fract(sin(floor(az.mul(160.0)).mul(91.7)).mul(43758.5));
    const cols = smoothstep(0.35, 0.95, streaks.mul(0.6).add(sin(az.mul(9.0).add(u.time.mul(0.05))).mul(0.4).add(0.4)));
    const low = smoothstep(0.16, 0.0, dir.y).mul(smoothstep(-0.02, 0.02, dir.y));
    return cols.mul(low).mul(u.showerPower);
}

/**
 * Back-to-back: veins of gold. Two families of thin seams cut ACROSS the beds (their
 * coordinates lean on the geological height, so on a slope a vein crosses the stripes at a
 * slant, where every other light of play runs along them), wandering a little, a pixel or two
 * wide and gone where the eye cannot resolve them. A run's level (`u.sheen`) holds a soft glow in
 * them; `u.veins` = (a back-to-back clear's flare, the flare's run in metres from the eye) is a
 * front of light racing out along the seams. Returns light to add (kept to the rock by the caller).
 */
export function goldVeins(u, noise, xz, g) {
    const out = vec3(0.0).toVar();
    If(u.sheen.add(u.veins.x).greaterThan(0.004), () => {
        const wander = texture(noise, xz.div(900.0)).rg.sub(0.5);
        const c1 = xz.x.mul(0.82).add(xz.y.mul(0.57)).add(g.mul(1.3)).add(wander.x.mul(210.0))
            .div(340.0)
            .toVar();
        const c2 = xz.x.mul(-0.5).add(xz.y.mul(0.87)).sub(g.mul(1.1)).add(wander.y.mul(210.0))
            .div(470.0)
            .toVar();
        const seam = (c) => {
            const d = abs(fract(c).sub(0.5));
            const w = fwidth(c).mul(1.1).clamp(0.0016, 0.5);
            return float(1.0).sub(smoothstep(w, w.mul(2.2), d)).mul(smoothstep(0.3, 0.1, w));
        };
        const seams = seam(c1).add(seam(c2).mul(0.7));
        const run = length(xz.sub(u.eye.xz)).sub(u.veins.y);
        // The front, and the light it leaves in the seams behind it for a moment.
        const front = exp(sq(run.div(240.0)).negate()).add(smoothstep(200.0, -200.0, run).mul(0.22));
        const shimmer = sin(c2.mul(31.0).add(u.time.mul(1.6))).mul(0.25).add(0.75);
        out.assign(vec3(1.55, 1.12, 0.46).mul(seams).mul(u.sheen.mul(0.55).mul(shimmer).add(u.veins.x.mul(front).mul(5.0))));
    });
    return out;
}

/**
 * Distance from a point to the river's course, how far along the course (metres from its
 * source) the nearest point lies, and which bank the point is on (±1): the polyline's segments
 * unrolled as constants.
 */
export const paRiver = /* @__PURE__ */ Fn(([p]) => {
    const best = float(1e9).toVar();
    const along = float(0.0).toVar();
    const side = float(1.0).toVar();
    for (let i = 0; i < RIVER.length - 1; i += 1) {
        const [ax, az] = RIVER[i];
        const [bx, bz] = RIVER[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const len2 = dx * dx + dz * dz;
        const rel = p.sub(vec2(ax, az));
        const t = clamp(rel.x.mul(dx).add(rel.y.mul(dz)).div(len2), 0.0, 1.0);
        const d = length(rel.sub(vec2(dx, dz).mul(t)));
        const closer = d.lessThan(best);
        along.assign(select(closer, t.mul(Math.sqrt(len2)).add(RIVER_ALONG[i]), along));
        // Which bank: the sign of the cross product with the reach's direction.
        side.assign(select(closer, rel.x.mul(dz).sub(rel.y.mul(dx)).sign(), side));
        best.assign(min(best, d));
    }
    return vec3(best, along, side);
}).setLayout({ name: 'pa_river', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * The water in the valley: a thin braided stream along the river's course, and on four lines the
 * flash flood (wide, turbid with the cleared rows' pigment, foaming at its front). Returns
 * vec4(colour, how much of the point is water). `r` = paRiver at the point (the land reads it
 * once, for the fields too), `above` = height over the river's bed.
 */
export function riverWater(u, noise, xz, r, above, dist, view) {
    const out = vec4(0.0).toVar();
    If(dist.lessThan(9000.0).and(above.lessThan(8.0)), () => {
        const wiggle = texture(noise, xz.div(70.0)).r.sub(0.5);
        // The stream: a main thread a few metres wide that swells and pinches.
        const stream = float(5.2).add(wiggle.mul(6.5)).max(1.6);
        const flooding = u.flood.y;
        const behind = smoothstep(30.0, -30.0, r.y.sub(u.flood.x));
        const floodW = float(40.0).add(wiggle.mul(26.0)).mul(flooding).mul(behind);
        const width = max(stream, floodW).toVar();
        const lowEnough = float(1.0).sub(smoothstep(0.8, mix(float(2.2), float(6.0), flooding), above));
        const wet = float(1.0).sub(smoothstep(width, width.add(max(dist.mul(0.004), 1.2)), r.x)).mul(lowEnough);
        If(wet.greaterThan(0.01), () => {
            // Ripples: streaks drawn down the current (the river's own coordinates: along, across),
            // a metre or two long, as two taps of the noise's slope. Where a ripple is narrower
            // than a few pixels it is faded (it would alias into a twisted rope), and what the eye
            // cannot resolve roughens the mirror instead, so the sun's glitter widens. The flood's
            // surge is the same field, deeper and faster.
            const t = u.time;
            const footprint = dist.mul(u.pixelAngle);
            const unresolved = smoothstep(0.06, 0.4, footprint);
            const flowAt = vec2(r.y.sub(t.mul(mix(float(1.1), float(6.0), flooding))).div(64.0 * 2.2), r.x.div(64.0 * 0.7));
            const h0 = texture(noise, flowAt).a;
            const hA = texture(noise, flowAt.add(vec2(0.25 / 64.0, 0.0))).a;
            const hX = texture(noise, flowAt.add(vec2(0.0, 0.25 / 64.0))).a;
            const rip = vec2(hX.sub(h0), hA.sub(h0)).mul(mix(float(1.6), float(3.5), flooding))
                .mul(float(1.0).sub(unresolved));
            const n = normalize(vec3(rip.x, 1.0, rip.y));
            const v = normalize(view);
            const cosv = clamp(dot(n, v.negate()), 0.0, 1.0);
            const m = float(1.0).sub(cosv);
            const fres = float(0.02).add(m.mul(m).mul(m).mul(m).mul(m)
                .mul(0.98));
            const reflected = v.sub(n.mul(dot(v, n).mul(2.0)));
            const mirrored = skyColour(u, reflected, { withSun: false });
            // The sun's glitter: a tight lobe on near, resolved water; a broad, dimmer path far off.
            const toSun = clamp(dot(normalize(reflected), u.sunDir), 0.0, 1.0);
            const lobe = pow(toSun, mix(float(900.0), float(70.0), unresolved));
            const twinkle = texture(noise, xz.div(2.6).add(vec2(t.mul(0.21), t.mul(-0.17)))).a;
            const glint = lobe.mul(mix(smoothstep(0.55, 0.85, twinkle).mul(5.0), float(0.9), unresolved))
                .mul(float(1.0).sub(flooding.mul(0.7)));
            // The flood carries the four cleared rows' pigments down the river as paint poured
            // into water: marbled, drawn out into long streaks by the current and folding into
            // each other, a pale seam where two paints meet. (Laid one after another in lanes,
            // they read as a strip of coloured tiles.)
            const s = r.y.sub(t.mul(46.0)).div(520.0);
            const cs = r.z.mul(r.x).div(max(width, 1.0));
            const fold = texture(noise, vec2(s.mul(0.55), cs.mul(0.22).add(s.mul(0.07)))).rg;
            const marble = fold.x.mul(1.9).add(cs.mul(0.42)).add(s.mul(0.6)).add(fold.y.mul(0.5));
            const phase = fract(marble).mul(4.0).toVar();
            const lane = floor(phase);
            const part = fract(phase);
            const blend = smoothstep(0.3, 0.7, part);
            const rowA = u.floodRows.element(int(lane)).xyz;
            const rowB = u.floodRows.element(int(lane.add(1.0).mod(4.0))).xyz;
            const pulse = mix(rowA, rowB, blend).toVar();
            const fibre = texture(noise, vec2(s.mul(3.1), cs.mul(1.7).add(fold.y))).a;
            const seam = exp(sq(part.sub(0.5).div(0.08)).negate());
            // A clear stream shows the sky; the flood is opaque with the rows' pigment, white
            // where it breaks over the bars and at its front.
            const pigment = mix(pulse.mul(mix(float(0.5), float(1.12), fibre)).add(0.03), vec3(0.86, 0.8, 0.68), seam.mul(0.32));
            // A clear braided stream is silty, a little teal over its gravel, and its gravel shows
            // through the shallows at its edges.
            const shallow = smoothstep(width.mul(0.25), width, r.x).mul(float(1.0).sub(flooding));
            const clear = mix(vec3(0.09, 0.12, 0.115), vec3(0.24, 0.22, 0.18), shallow.mul(0.7));
            const body = mix(clear, pigment, flooding);
            const sunk = u.sun.mul(u.sunUp).mul(clamp(u.sunDir.y, 0.15, 1.0)).mul(0.55).add(u.fill.mul(1.2));
            const churn = texture(noise, vec2(r.y.mul(0.012).sub(t.mul(0.55)), r.x.mul(0.05))).b;
            // Foam where the flood breaks over the bars, along its banks and at its front.
            const banks = smoothstep(0.7, 0.98, abs(cs)).mul(smoothstep(0.35, 0.7, churn));
            const foam = smoothstep(0.62, 0.78, churn).mul(flooding).mul(0.8)
                .add(banks.mul(flooding).mul(0.9))
                .add(exp(sq(r.y.sub(u.flood.x).div(40.0)).negate()).mul(flooding).mul(1.4));
            const sheen = fres.mul(mix(float(1.0), float(0.35), flooding)).add(float(1.0).sub(flooding).mul(0.3));
            const water = mix(body.mul(sunk), mirrored, sheen)
                .add(u.sun.mul(glint).mul(u.sunUp))
                .add(vec3(0.95, 0.93, 0.88).mul(foam.min(1.0)).mul(sunk))
                // The pigment glows a little of its own, so the flood reads in any light.
                .add(pulse.mul(flooding).mul(0.35));
            out.assign(vec4(water, wet.mul(float(1.0).sub(smoothstep(5000.0, 9000.0, dist)))));
        });
    });
    return out;
}

export {
    cos, min, mix, pow,
};
