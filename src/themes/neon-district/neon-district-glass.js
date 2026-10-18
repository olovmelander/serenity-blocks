/**
 * Neon District — rain on the glass.
 *
 * The district is seen through a pane of glass in the rain. On it:
 *
 *  - beads: drops of two sizes on a jittered grid. Each is born (a raindrop lands), sits, and
 *    shrinks as it evaporates, then another lands somewhere else in its cell;
 *  - runners: heavier drops that slide down in jerks — stuck, then a sudden slide, then stuck
 *    again — along a wavering path, wiping a trail through the mist and leaving a line of tiny
 *    beads in it;
 *  - mist: fine condensation over the rest of the pane, which the trails wipe clear.
 *
 * Every drop is a small lens: through it the street is seen upside down and shrunk (the output
 * pass samples the scene at an offset AGAINST the drop's outward normal, scaled by its size), its
 * edge darkens where the light is turned away, and a glint of the neon behind it sits on its
 * shoulder. Everything is a function of screen position and time (and so of `seek`), drawn in
 * the post's one output pass: no particles, no extra geometry.
 *
 * Coordinates: `p` is the screen in screen HEIGHTS (x × aspect, y down from the top), so drops
 * keep their size and shape at any aspect ratio. Gravity is +y.
 *
 * Written for this theme (not adapted from another shader).
 */

import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec4,
} from 'three/tsl';
import { ndHash21, ndHash22 } from './neon-district-tsl.js';

/**
 * Beads: one candidate drop per grid cell, re-landing every few seconds.
 * Returns vec4(q.x, q.y, cover, r): q the point's place on the drop's disc (−1..1, outward), cover
 * its anti-aliased coverage, r the drop's radius in screen heights.
 */
export const ndGlassBeads = /* @__PURE__ */ Fn(([p, scale, density, time, seed]) => {
    const g = p.mul(scale);
    const id = floor(g);
    const f = fract(g);
    const h0 = ndHash21(id.add(vec2(seed, seed.mul(0.61))));
    // A cell's drop lands, sits and evaporates over its own lifetime, then lands again elsewhere.
    const life = h0.mul(14.0).add(9.0);
    const cycle = time.div(life).add(h0.mul(17.0));
    const gen = floor(cycle);
    const age = fract(cycle);
    const hj = ndHash22(id.add(vec2(gen.mul(7.13), gen.mul(3.71)).add(seed)));
    const present = step(float(1.0).sub(density), ndHash21(id.add(vec2(gen.mul(1.31), seed.mul(2.17)))));
    const size = ndHash21(id.add(vec2(seed.mul(0.37), gen.mul(5.3))));
    const grow = smoothstep(0.0, 0.015, age).mul(float(1.0).sub(smoothstep(0.55, 1.0, age).mul(0.7)));
    const rCell = size.mul(size).mul(0.3).add(0.07).mul(grow)
        .mul(present);
    const centre = hj.mul(0.56).add(0.22);
    const q = f.sub(centre).div(max(rCell, 1e-3));
    const d = length(q);
    const aa = float(1.5).div(scale.mul(max(rCell, 1e-3)).mul(1080.0));
    const cover = smoothstep(float(1.0).add(aa), float(1.0).sub(aa), d).mul(step(0.004, rCell));
    return vec4(q.mul(cover), cover, rCell.div(scale));
}).setLayout({
    name: 'nd_glassBeads',
    type: 'vec4',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'scale', type: 'float' }, { name: 'density', type: 'float' },
        { name: 'time', type: 'float' }, { name: 'seed', type: 'float' },
    ],
});

/** Where a column's runner is on its way down the pane (0 top .. ~1.15 below the frame): jerks. */
const runnerHead = (time, h) => {
    // A run takes 18-34 s; most of it is the drop stuck, then sliding a step, eight steps a run.
    const runs = time.div(h.mul(16.0).add(18.0)).add(h.mul(11.0));
    const s = fract(runs).mul(8.0);
    const stepIndex = floor(s);
    const slide = smoothstep(0.62, 0.92, fract(s));
    return stepIndex.add(slide).div(8.0).mul(1.3).sub(0.1);
};

/** The runner's path across its column at height y: it wanders as it goes. */
const runnerPathX = (y, h, colX, colW) => colX
    .add(sin(y.mul(h.mul(9.0).add(7.0)).add(h.mul(23.0))).mul(colW).mul(0.18))
    .add(sin(y.mul(31.0).add(h.mul(5.0))).mul(colW).mul(0.04));

/**
 * Runners: one heavy drop per column, sliding down in jerks, and the beads it leaves behind.
 * Returns vec4(q.x, q.y, cover, r) for the nearest drop (the head or a trail bead).
 */
export const ndGlassRunners = /* @__PURE__ */ Fn(([p, cols, time, seed]) => {
    const colW = float(1.0).div(cols);
    const col = floor(p.x.mul(cols).add(seed));
    const h = ndHash21(vec2(col, seed.mul(1.7).add(3.0)));
    const live = step(0.38, h);
    const colX = col.sub(seed).add(0.5).mul(colW);
    const headY = runnerHead(time, h);
    const rHead = h.mul(0.016).add(0.013);
    const hx = runnerPathX(headY, h, colX, colW);
    // The head: a drop a little taller than wide, fuller at its foot.
    const dh = p.sub(vec2(hx, headY));
    const qh = vec2(dh.x, dh.y.mul(mix(float(0.78), float(1.0), step(0.0, dh.y)))).div(rHead);
    const dHead = length(qh);
    const aaH = float(1.5).div(rHead.mul(1080.0));
    const coverHead = smoothstep(float(1.0).add(aaH), float(1.0).sub(aaH), dHead).mul(live);
    // Trail beads: small drops strung along the path above the head, shrinking with distance.
    const behind = headY.sub(p.y);
    const spacing = rHead.mul(2.4);
    const k = floor(behind.div(spacing));
    const by = headY.sub(k.add(0.5).mul(spacing));
    const bx = runnerPathX(by, h, colX, colW);
    const hb = ndHash21(vec2(k, col.add(seed.mul(9.0))));
    const rBead = rHead.mul(hb.mul(0.35).add(0.18)).mul(exp(behind.mul(-1.6))).mul(step(0.35, hb));
    const qb = p.sub(vec2(bx, by)).div(max(rBead, 1e-4));
    const aaB = float(1.5).div(max(rBead, 1e-4).mul(1080.0));
    const coverBead = smoothstep(float(1.0).add(aaB), float(1.0).sub(aaB), length(qb))
        .mul(step(0.0, behind)).mul(step(0.0006, rBead))
        .mul(live);
    const useHead = step(coverBead, coverHead);
    const q = mix(qb, qh, useHead);
    const cover = max(coverHead, coverBead);
    return vec4(q.mul(cover), cover, mix(rBead, rHead, useHead));
}).setLayout({
    name: 'nd_glassRunners',
    type: 'vec4',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'cols', type: 'float' }, { name: 'time', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

/** How clear of mist a runner has wiped the glass at p (1 just behind the head, fading back in). */
export const ndGlassWipe = /* @__PURE__ */ Fn(([p, cols, time, seed]) => {
    const colW = float(1.0).div(cols);
    const col = floor(p.x.mul(cols).add(seed));
    const h = ndHash21(vec2(col, seed.mul(1.7).add(3.0)));
    const live = step(0.38, h);
    const colX = col.sub(seed).add(0.5).mul(colW);
    const headY = runnerHead(time, h);
    const rHead = h.mul(0.016).add(0.013);
    const behind = headY.sub(p.y);
    const px = runnerPathX(p.y, h, colX, colW);
    const across = abs(p.x.sub(px)).div(rHead.mul(0.95));
    // The mist grows back over the trail in a few seconds' worth of distance, and the whole trail
    // fades as its drop leaves the frame (the next run starts above it).
    return float(1.0).sub(smoothstep(0.55, 1.0, across)).mul(step(0.0, behind)).mul(exp(behind.mul(-2.4)))
        .mul(float(1.0).sub(smoothstep(1.02, 1.18, headY)))
        .mul(live);
}).setLayout({
    name: 'nd_glassWipe',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'cols', type: 'float' }, { name: 'time', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

/** Fine condensation: value noise, more of it toward the foot and the edges of the pane. */
export const ndGlassMist = /* @__PURE__ */ Fn(([p, st]) => {
    const g = p.mul(9.0);
    const i = floor(g);
    const f = fract(g);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = ndHash21(i);
    const b = ndHash21(i.add(vec2(1.0, 0.0)));
    const c = ndHash21(i.add(vec2(0.0, 1.0)));
    const d = ndHash21(i.add(vec2(1.0, 1.0)));
    const n = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    const edge = max(smoothstep(0.55, 1.0, st.y), smoothstep(0.35, 0.5, abs(st.x.sub(0.5))));
    return clamp(n.mul(0.6).add(0.4).mul(edge.mul(0.5).add(0.5)), 0.0, 1.0);
}).setLayout({
    name: 'nd_glassMist',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'st', type: 'vec2' }],
});

/**
 * The pane at a screen point: its lens offset (UV), how much drop covers it, how much mist, and
 * the drop's disc position for shading. `layers` = 1 (beads + one runner layer) or 2.
 * @returns {{ offset: object, cover: object, mist: object, q: object, z: object }}
 */
export function ndGlass(st, aspect, time, layers) {
    const p = vec2(st.x.mul(aspect), st.y);
    const elements = [
        ndGlassBeads(p, float(26.0), float(0.42), time, float(1.0)),
        ndGlassRunners(p, float(17.0), time, float(0.0)),
    ];
    let wipe = ndGlassWipe(p, float(17.0), time, float(0.0));
    if (layers > 1) {
        elements.push(ndGlassBeads(p, float(58.0), float(0.5), time, float(7.0)));
        elements.push(ndGlassRunners(p, float(11.0), time, float(0.37)));
        wipe = max(wipe, ndGlassWipe(p, float(11.0), time, float(0.37)));
    }
    // Combine: the most covering drop decides the shading; the lens offsets add (the strength is
    // ~3 drop radii at the rim: through a drop the street is seen inverted and shrunk).
    let lens = vec2(0.0);
    let cover = float(0.0);
    let q = vec2(0.0);
    elements.forEach((e) => {
        lens = lens.add(e.xy.mul(e.w).mul(5.0));
        q = mix(q, e.xy.div(max(e.z, 1e-3)), step(cover, e.z));
        cover = max(cover, e.z);
    });
    const r2 = min(dot(q, q), 1.0);
    // Drops gather the mist round them as they land: the glass is clearer near a drop.
    const mist = ndGlassMist(p, st).mul(float(1.0).sub(wipe)).mul(float(1.0).sub(cover));
    return {
        offset: vec2(lens.x.div(aspect), lens.y).negate(),
        cover,
        mist,
        q,
        z: sqrt(float(1.0).sub(r2)),
    };
}
