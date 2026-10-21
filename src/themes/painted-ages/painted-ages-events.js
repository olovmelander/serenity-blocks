/**
 * Painted Ages — what gameplay does to the light (TSL, read by the land and the sky).
 *
 *  - ribbonLight: each lock's pigment running along its bed (the light's front races out from
 *    where the piece landed; behind it the bed glows and fades);
 *  - waveLight: each clear's band of light climbing the strata through the whole land;
 *  - rainbow: the bow over the valley after a chain (primary, and a secondary on long ones);
 *  - showerVeil: the rain hanging under the clouds while a chain holds;
 *  - sparkle: back-to-back's glints of mica and gypsum on the sunlit rock.
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
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { paHash21 } from './painted-ages-tsl.js';
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
        const near = exp(d.div(70.0).negate()).mul(exp(age.div(0.8).negate())).mul(3.2);
        const amount = inBed.mul(head.add(trail).add(near)).mul(reach).mul(fade).add(ring.mul(reach));
        // Lifted toward white a little, so a red ribbon still glows over red rock.
        sum.addAssign(mix(c.xyz, vec3(c.xyz.x.max(c.xyz.y).max(c.xyz.z)), 0.22).mul(c.w).mul(amount));
    });
    return sum;
}

/** The waves' light: bands of geological height climbing through the land. */
export function waveLight(u, g, gw) {
    const sum = vec3(0.0).toVar();
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
        sum.addAssign(c.xyz.mul(a.w).mul(band.add(passed)).mul(fade));
    });
    return sum;
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
    return primary.add(secondary).mul(strength).mul(crown).mul(0.42);
}

/** Rain hanging under the clouds while a chain holds: vertical veils, thicker toward the front. */
export function showerVeil(u, dir) {
    const az = atan(dir.x, dir.z.negate());
    const streaks = fract(sin(floor(az.mul(160.0)).mul(91.7)).mul(43758.5));
    const cols = smoothstep(0.35, 0.95, streaks.mul(0.6).add(sin(az.mul(9.0).add(u.time.mul(0.05))).mul(0.4).add(0.4)));
    const low = smoothstep(0.16, 0.0, dir.y).mul(smoothstep(-0.02, 0.02, dir.y));
    return cols.mul(low).mul(u.showerPower);
}

/** Back-to-back: mica and gypsum glinting on the sunlit rock (a few bright cells that twinkle). */
export function sparkle(u, xz, dist, lit) {
    const cell = floor(xz.div(max(dist.mul(0.0016), 0.35)));
    const h = paHash21(cell);
    const twinkle = sin(u.time.mul(2.3).add(h.mul(40.0))).mul(0.5).add(0.5);
    const on = smoothstep(0.985, 1.0, h).mul(twinkle).mul(u.sheen);
    return on.mul(lit).mul(6.0);
}

/**
 * Distance from a point to the river's course and how far along the course (metres from its
 * source) the nearest point lies: the polyline's segments unrolled as constants.
 */
export const paRiver = /* @__PURE__ */ Fn(([p]) => {
    const best = float(1e9).toVar();
    const along = float(0.0).toVar();
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
        best.assign(min(best, d));
    }
    return vec2(best, along);
}).setLayout({ name: 'pa_river', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * The water in the valley: a thin braided stream along the river's course, and on four lines the
 * flash flood (wide, turbid with the cleared rows' pigment, foaming at its front). Returns
 * vec4(colour, how much of the point is water). `above` = height over the river's bed.
 */
export function riverWater(u, noise, texture, xz, above, dist, view) {
    const out = vec4(0.0).toVar();
    If(dist.lessThan(9000.0).and(above.lessThan(6.0)), () => {
        const r = paRiver(xz);
        const wiggle = texture(noise, xz.div(70.0)).r.sub(0.5);
        const stream = float(3.4).add(wiggle.mul(4.0)).max(1.2);
        const flooding = u.flood.y;
        const behind = smoothstep(30.0, -30.0, r.y.sub(u.flood.x));
        const floodW = float(30.0).add(wiggle.mul(22.0)).mul(flooding).mul(behind);
        const width = max(stream, floodW);
        const lowEnough = float(1.0).sub(smoothstep(0.8, mix(float(2.2), float(4.5), flooding), above));
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
            // The flood carries the four cleared rows' pigments down the river, one after another in
            // pulses, streaked by the current.
            const streak = sin(r.y.mul(0.045).add(r.x.mul(0.35)).sub(t.mul(4.0))).mul(0.5).add(0.5);
            const phase = fract(r.y.div(140.0).sub(t.mul(0.75))).mul(4.0);
            const lane = floor(phase);
            const blend = smoothstep(0.72, 1.0, fract(phase));
            const rowA = u.floodRows.element(int(lane)).xyz;
            const rowB = u.floodRows.element(int(lane.add(1.0).mod(4.0))).xyz;
            const pulse = mix(rowA, rowB, blend);
            // A clear stream shows the sky; the flood is opaque with the rows' pigment, streaked
            // down the current, white where it breaks over the bars and at its front.
            const pigment = mix(pulse.mul(0.6).add(0.03), pulse.mul(1.05).add(0.06), streak);
            // A clear braided stream is silty, a little teal over its gravel, and its gravel shows
            // through the shallows at its edges.
            const shallow = smoothstep(width.mul(0.25), width, r.x).mul(float(1.0).sub(flooding));
            const clear = mix(vec3(0.09, 0.12, 0.115), vec3(0.24, 0.22, 0.18), shallow.mul(0.7));
            const body = mix(clear, pigment, flooding);
            const sunk = u.sun.mul(u.sunUp).mul(clamp(u.sunDir.y, 0.15, 1.0)).mul(0.55).add(u.fill.mul(1.2));
            const churn = texture(noise, vec2(r.y.mul(0.012).sub(t.mul(0.55)), r.x.mul(0.05))).b;
            const foam = smoothstep(0.62, 0.78, churn).mul(flooding).mul(0.8)
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
