/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Aurora Dreams — an arctic night on the shore of a still lake, the northern lights over a snow range.
 *
 * The sky is seen through a painted camera standing on the shore: every pixel is a view ray
 * (azimuth and elevation tangents), so everything recedes in true perspective toward one horizon.
 * The aurora is a set of luminous vertical sheets hung at increasing distances. Each sheet bows away
 * toward the sides and folds as it runs across the sky, so its bright lower hem snakes in perspective;
 * where a fold turns edge-on the eye looks along the sheet and it blazes (the path through it is
 * longer). Rays run straight up each sheet (along the field lines), the hem burns green-white over a
 * thin rose fringe, and the body fades through green to violet and magenta at the top. Far sheets
 * crowd down toward the horizon and dim in the air; near ones hang overhead.
 *
 * Behind the curtains, stars and a faint Milky Way, lost wherever the aurora burns. Below them: two
 * jagged snow ranges, the far one sunk in the air. Their skylines also shape their faces (each crest
 * runs on down the face as a ridge that wanders as it descends), and an eroded crag field bump-lights
 * them: snow fills the gullies, ledges and aprons and catches the aurora's green-teal light, bare rock
 * ribs stand dark, the shadowed faces sink into blue. A dark forested far shore; then a glass-still
 * lake that mirrors all of it (reflected view rays, Fresnel, slow ripples that only stir the near
 * water). Spruce forest on snowy banks frames both sides, rows of trees standing on the ground plane
 * in perspective (young ones at the water's edge), each reflected about its own foot. Snow falls, a
 * few flakes drifting out of focus past the lens.
 *
 * Inhale: the curtains brighten, climb and ripple faster (a wave travels along them). Full: they
 * glow and shimmer in place. The long exhale: they dim, sink and slow, and the lake follows.
 */
import {
    Fn, If, cos, dot, exp, float, floor, fract, max, mix, sin, smoothstep, sqrt, vec2, vec3, vec4,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fresnel, gnoise, hash21, softStep, starfield,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

/** Focal length of the painted camera in hero units (the short half-axis is 1). */
const LENS = 1.6;
/** Eye height above the lake in metres: the perspective of the shore, the forest and the ripples. */
const EYE = 1.5;
/** Parallax of the ground: a thing this many metres away moves with the hero plane (k = 1). */
const NEAR = 8;

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const SKY_ZENITH = vec3(0.0011, 0.0022, 0.0075);
const SKY_HORIZON = vec3(0.0035, 0.0085, 0.018);
const AIRGLOW = vec3(0.008, 0.045, 0.032);
const MILKY = vec3(0.02, 0.023, 0.033);
// The aurora's emission: a green-white hem, the green oxygen body, violet and magenta tops, rose fringe.
const HEM = vec3(0.62, 1.0, 0.6);
const GREEN = vec3(0.13, 0.88, 0.44);
const VIOLET = vec3(0.36, 0.2, 0.9);
const MAGENTA = vec3(0.7, 0.14, 0.52);
const ROSE = vec3(0.95, 0.3, 0.5);
// What the aurora casts on snow, the night sky's own blue fill, and the dark of rock and spruce.
const AURORA_LIGHT = vec3(0.1, 0.165, 0.16);
const SKY_LIGHT = vec3(0.0045, 0.0085, 0.02);
const RIM = vec3(0.2, 0.75, 0.5);
const MIST = vec3(0.015, 0.05, 0.048);
const WATER_TINT = vec3(0.78, 0.9, 0.96);
const WATER_DEEP = vec3(0.0005, 0.0015, 0.003);
const SPRUCE = vec3(0.0007, 0.0015, 0.0021);
const SPRUCE_SNOW = vec3(0.022, 0.048, 0.056);
const FAR_FOREST = vec3(0.0008, 0.0016, 0.0026);
/** A unit vector, normalised once in JS rather than in every pixel. */
const unit = (...v) => {
    const l = Math.hypot(...v);
    return vec3(v[0] / l, v[1] / l, v[2] / l);
};
/** On the ranges the aurora is the key light: high on the left and in front of them (screen axes). */
const LIGHT_DIR = unit(-0.74, 0.56, 0.38);
/** On the shore the curtains hang ahead and above: light from up, a little left and from beyond. */
const GROUND_LIGHT = unit(-0.35, 0.8, 0.49);

/**
 * The curtains, near to far. `z`: distance of the sheet straight ahead; `arch`: how fast it bows
 * away toward the sides; `base`: altitude of its lower hem (sky units, the same as `z`); `fold`:
 * two meanders in azimuth [frequency, depth, frequency, depth]; `rays` per sky unit along it;
 * `tall`: its height scale; `gain`: brightness; `solid`: how much of it survives its gaps; `lean`:
 * how much nearer (higher) its left end hangs than its right, so bands cross on a slant.
 * `overhead` sheets hang above a landscape frame and only show on tall screens; `optional` ones drop
 * out on the lightest tiers.
 */
const CURTAINS = [
    {
        z: 1.1,
        arch: 0.08,
        base: 1.25,
        seed: 1.7,
        fold: [3.1, 0.2, 7.9, 0.06],
        rays: 10,
        tall: 1.1,
        gain: 0.8,
        solid: 0.5,
        lean: 0.1,
        overhead: true,
    },
    {
        z: 1.6,
        arch: 0.16,
        base: 1.05,
        seed: 7.3,
        fold: [4.3, 0.18, 10.9, 0.05],
        rays: 12,
        tall: 1.05,
        gain: 0.85,
        solid: 0.5,
        lean: -0.15,
        overhead: true,
    },
    {
        z: 2.3,
        arch: 0.3,
        base: 1.0,
        seed: 4.3,
        fold: [5.6, 0.17, 13.7, 0.05],
        rays: 13,
        tall: 1.0,
        gain: 1.0,
        solid: 0.15,
        lean: 0,
    },
    {
        z: 3.8,
        arch: 0.2,
        base: 1.0,
        seed: 8.9,
        fold: [7.4, 0.15, 17.1, 0.05],
        rays: 12,
        tall: 0.9,
        gain: 0.75,
        solid: 0,
        lean: -0.32,
    },
    {
        z: 6.4,
        arch: 0.16,
        base: 0.95,
        seed: 2.6,
        fold: [10.1, 0.12, 23.3, 0.04],
        rays: 10,
        tall: 0.85,
        gain: 0.65,
        solid: 0,
        lean: 0.28,
        optional: true,
    },
    {
        z: 11,
        arch: 0.18,
        base: 0.9,
        seed: 6.2,
        fold: [13.9, 0.1, 31.7, 0.035],
        rays: 8,
        tall: 0.8,
        gain: 0.6,
        solid: 0,
        lean: -0.12,
    },
];

/**
 * Two snow ranges, far to near: parallax k, crest base and height above the horizon, skyline
 * frequency, how much air lies in front, and the scale and depth of the crags on their faces.
 */
const RANGES = [
    {
        k: 0.05, base: 0.02, height: 0.3, freq: 2.1, seed: 21.3, haze: 0.34, rim: 0.7, crag: 11, bump: 0.07,
    },
    {
        k: 0.11, base: -0.012, height: 0.42, freq: 1.25, seed: 4.6, haze: 0.06, rim: 1.0, crag: 14, bump: 0.085,
    },
];

/** Rows of spruce on the banks, far to near: distance (m), cell width (m), seed. The near rows frame the lake. */
const ROWS = [
    { z: 80, cell: 2.8, seed: 1.3 },
    { z: 56, cell: 2.8, seed: 2.9 },
    { z: 40, cell: 2.9, seed: 4.7 },
    { z: 28, cell: 3.0, seed: 6.1 },
    { z: 20, cell: 3.1, seed: 8.3 },
    { z: 14, cell: 3.3, seed: 9.7 },
    { z: 10, cell: 3.6, seed: 12.1 },
];

/** Hoskins' hash without sine: stable on every GPU. */
const hash11 = /* @__PURE__ */ Fn(([x]) => {
    const p = fract(x.mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'aur_hash11', type: 'float', inputs: [{ name: 'x', type: 'float' }] });

/** 1D quintic value noise in 0..1 and its derivative: (value, d value / dx). */
const noise1 = /* @__PURE__ */ Fn(([x]) => {
    const i = floor(x).toVar();
    const f = x.sub(i).toVar();
    const a = hash11(i).toVar();
    const rise = hash11(i.add(1)).sub(a).toVar();
    const w = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
    const g = f.sub(1);
    const dw = f.mul(f).mul(g.mul(g)).mul(30);
    return vec2(a.add(rise.mul(w)), rise.mul(dw));
}).setLayout({ name: 'aur_noise1', type: 'vec2', inputs: [{ name: 'x', type: 'float' }] });

/** 2D quintic value noise in 0..1 with its gradient: (value, d/dx, d/dy). */
const noise2 = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p).toVar();
    const f = p.sub(i).toVar();
    const w = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
    const dw = f.mul(f).mul(f.mul(f.sub(2)).add(1)).mul(30);
    const a = hash21(i).toVar();
    const k1 = hash21(i.add(vec2(1, 0))).sub(a).toVar();
    const k2 = hash21(i.add(vec2(0, 1))).sub(a).toVar();
    const k4 = hash21(i.add(vec2(1, 1))).sub(a).sub(k1).sub(k2)
        .toVar();
    const value = a.add(k1.mul(w.x)).add(k2.mul(w.y)).add(k4.mul(w.x).mul(w.y));
    return vec3(value, dw.mul(vec2(k1.add(k4.mul(w.y)), k2.add(k4.mul(w.x)))));
}).setLayout({ name: 'aur_noise2', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * Eroded crags: three octaves of value noise where each octave is damped on the slopes of the ones
 * before it (sharp ridges, smooth gullies, as in iq's terrains). `fine` (0..1) keeps the last octave:
 * the caller fades it out before it would alias. Returns (height, gradient) in the coordinates of
 * `p`, so a face can be bump-lit from it.
 */
const crags = /* @__PURE__ */ Fn(([p, fine]) => {
    const q = vec2(p).toVar();
    const height = float(0).toVar();
    const grad = vec2(0).toVar();
    const slopes = vec2(0).toVar();
    // The octave matrix M = [[1.6, -1.2], [1.2, 1.6]] (a turn and a doubling); a gradient found in
    // octave i's coordinates comes back to p's through (M^T)^i.
    const back = (g, times) => {
        let r = g;
        for (let k = 0; k < times; k++) r = vec2(r.x.mul(1.6).add(r.y.mul(1.2)), r.x.mul(-1.2).add(r.y.mul(1.6)));
        return r;
    };
    let amplitude = 0.5;
    for (let i = 0; i < 3; i++) {
        const n = noise2(q).toVar();
        slopes.addAssign(n.yz);
        const weight = i === 2 ? fine.mul(amplitude) : float(amplitude);
        const damp = float(1).div(dot(slopes, slopes).mul(0.6).add(1)).toVar();
        height.addAssign(n.x.mul(damp).mul(weight));
        grad.addAssign(back(n.yz, i).mul(damp).mul(weight));
        q.assign(vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(vec2(3.1, 1.7)));
        amplitude *= 0.5;
    }
    return vec3(height, grad);
}).setLayout({
    name: 'aur_crags', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }, { name: 'fine', type: 'float' }],
});

/**
 * One auroral curtain seen along a view ray. `ray` = (azimuth, elevation) tangents.
 * form (distance, arch, hem altitude, seed); fold (freq, depth, freq, depth);
 * flow (travelling-wave phase, drift, shimmer clock, shimmer amount);
 * state (hem lift, height scale, brightness, one pixel per unit distance); look (ray density, tall, gain, solid);
 * lean (how much nearer its left end hangs than its right).
 * Pure: every changing value comes in through the parameters.
 */
const curtain = /* @__PURE__ */ Fn(([ray, form, fold, flow, state, look, lean]) => {
    const a = ray.x.toVar();
    const b = ray.y.toVar();
    const reach = form.x;
    const seed = form.w;
    // The sheet bows away toward the sides (its apex a little off centre) and folds; the second
    // meander travels along it with the breath.
    const bow = a.sub(fract(seed).sub(0.5).mul(0.4)).toVar();
    const ph1 = a.mul(fold.x).add(seed).add(flow.y.mul(0.6)).sub(flow.x.mul(0.35))
        .toVar();
    const ph2 = a.mul(fold.z).add(seed.mul(2.3)).sub(flow.x).toVar();
    // The big meander is skewed (a long sweep, then a sharp turn), the way a curtain folds over.
    const turn = ph1.add(sin(ph1).mul(0.8)).toVar();
    // `lean` swings one end of the sheet nearer than the other, so it crosses the sky on a slant.
    const z = reach.mul(float(1).add(form.y.mul(bow).mul(bow)).add(lean.mul(a)).add(sin(turn).mul(fold.y))
        .add(sin(ph2).mul(fold.w)))
        .max(reach.mul(0.3))
        .toVar();
    const dz = reach.mul(form.y.mul(bow).mul(2).add(lean)
        .add(cos(turn).mul(cos(ph1).mul(0.8).add(1)).mul(fold.y).mul(fold.x))
        .add(cos(ph2).mul(fold.w).mul(fold.z)))
        .toVar();
    // Looking along a sheet (a fold turned edge-on) crosses more of it, so it blazes; soft cap.
    const tx = z.add(a.mul(dz));
    const edgeOn = sqrt(tx.mul(tx).add(dz.mul(dz)).mul(a.mul(a).add(b.mul(b)).add(1))).div(z);
    const blaze = edgeOn.div(edgeOn.mul(0.25).add(0.75));
    // Where this ray meets the sheet: along it, and at what altitude.
    const s = a.mul(z).toVar();
    const altitude = b.mul(z);
    const pxw = state.w.mul(z).toVar();
    // The hem undulates a little and climbs with the breath.
    const hem = form.z.add(state.x)
        .add(sin(s.mul(1.9).add(seed.mul(3.1)).sub(flow.x.mul(1.4))).mul(0.045))
        .add(noise1(s.mul(0.8).add(seed.mul(5.3))).x.sub(0.5).mul(0.16))
        .add(noise1(s.mul(4.3).add(seed.mul(2.9)).add(flow.y)).x.sub(0.5).mul(0.035));
    const dh = altitude.sub(hem).toVar();
    // Rays: soft striations that run straight up the sheet, gathered into brighter bundles. The
    // finer ones fade out before they could alias.
    const coarseLod = fadeOut(0.22, 0.5, look.x.mul(pxw));
    const fineLod = fadeOut(0.22, 0.5, look.x.mul(2.7).mul(pxw));
    const bundle = noise1(s.mul(look.x.mul(0.3)).add(flow.y.mul(0.8)).add(seed.mul(5))).x.toVar();
    const ray1 = noise1(s.mul(look.x).add(flow.y.mul(1.5)).add(seed.mul(11))).x.toVar();
    const ray2 = gnoise(vec2(s.mul(look.x.mul(2.7)).sub(flow.y.mul(2.2)), flow.z.add(seed.mul(3))));
    const rays = bundle.mul(bundle).mul(0.7).add(0.5)
        .mul(mix(float(1), ray1.mul(0.7).add(0.65), coarseLod))
        .add(ray2.sub(0.5).mul(fineLod).mul(flow.w.mul(0.35).add(0.25)))
        .max(0)
        .toVar();
    // Tall rays, and bright bundles, reach higher than their neighbours.
    const scale = state.y.mul(look.y).mul(ray1.mul(0.45).add(bundle.mul(0.35)).add(0.55));
    const up = dh.max(0).div(scale).toVar();
    // The sheet starts at a sharp lower edge (about a pixel soft at any distance).
    const edge = pxw.mul(1.5).max(0.016);
    const onset = smoothstep(edge.negate(), edge, dh).toVar();
    const body = exp(up.mul(-1.45)).mul(onset);
    // The hem burns brightest just above that edge and fades up into the body; its brilliance
    // gathers where the rays bundle.
    const hemW = pxw.mul(2.5).max(0.05);
    const hemLine = onset.mul(exp(dh.max(0).div(hemW).negate())).mul(bundle.mul(0.6).add(0.55))
        .mul(ray1.mul(0.4).add(0.8));
    const profile = body.mul(rays).mul(0.62).add(hemLine.mul(0.8));
    const roseW = pxw.mul(2).max(0.026);
    const below = dh.add(roseW.mul(1.3));
    // The rose fringe shows only along the stronger stretches of the hem.
    const fringe = smoothstep(0.45, 0.85, noise1(s.mul(0.45).add(seed.mul(13))).x);
    const rose = exp(below.mul(below).div(roseW.mul(roseW)).negate()).mul(fringe).mul(0.32).mul(rays);
    // Colour by height above the hem: green-white hem, green body, violet then magenta tops.
    const tint = mix(HEM, GREEN, smoothstep(0.0, 0.3, up)).toVar();
    tint.assign(mix(tint, VIOLET, smoothstep(0.3, 1.0, up)));
    tint.assign(mix(tint, MAGENTA, smoothstep(0.8, 1.8, up)));
    // Curtain segments come and go along the sheet.
    const segment = noise1(s.mul(0.33).add(seed.mul(7.7)).add(flow.y.mul(0.25))).x;
    const patch = mix(look.w, float(1), smoothstep(0.28, 0.72, segment));
    // The air between: far sheets dim and sink into the horizon.
    const air = exp(z.mul(-0.035)).mul(smoothstep(0.0, 0.05, b));
    const veil = exp(up.mul(-0.8)).mul(smoothstep(-0.06, 0.05, dh)).mul(0.06);
    const light = tint.mul(profile.add(veil)).add(ROSE.mul(rose));
    return light.mul(patch.mul(blaze).mul(air).mul(state.z).mul(look.z));
}).setLayout({
    name: 'aur_curtain',
    type: 'vec3',
    inputs: [
        { name: 'ray', type: 'vec2' }, { name: 'form', type: 'vec4' }, { name: 'fold', type: 'vec4' },
        { name: 'flow', type: 'vec4' }, { name: 'state', type: 'vec4' }, { name: 'look', type: 'vec4' },
        { name: 'lean', type: 'float' },
    ],
});

/**
 * A snow-laden spruce as a soft mask. `local` = metres from the foot of the trunk (x across, y up);
 * form = (height, seed, edge width in metres, -). Snow country grows slim spires: drooping whorls of
 * branches every half metre or so, lumpy with needle clumps and snow, under a thin leader.
 * Returns (mask, snow on the branches).
 */
const spruce = /* @__PURE__ */ Fn(([local, form]) => {
    const h = form.x;
    const seed = form.y;
    const t = local.y.div(h).toVar();
    const ax = local.x.abs().toVar();
    const taper = float(1).sub(t).max(0).toVar();
    const crown = taper.mul(float(1.3).sub(taper.mul(0.45))).mul(h).mul(0.088).toVar();
    // Whorls: tier boundaries slope down toward the tips (the branches droop under the snow);
    // their spacing wanders, so no two tiers and no two trees repeat.
    const side = local.x.sign().mul(0.5).add(0.5);
    const spacing = noise1(local.y.mul(0.55).add(seed.mul(3.7))).x.mul(1.5);
    const tc = local.y.mul(2.1).add(spacing).add(ax.mul(1.1)).add(seed)
        .toVar();
    const tf = fract(tc).toVar();
    const jitter = hash21(vec2(floor(tc).add(side.mul(57)), seed.mul(13.1))).toVar();
    const tip = float(1).sub(tf);
    // Needle clumps and snow loads make the outline lumpy; fine needles serrate it.
    const lump = noise1(local.y.mul(1.3).add(side.mul(31)).add(seed.mul(5))).x.toVar();
    const needles = noise1(local.y.mul(9.0).add(side.mul(13)).add(seed.mul(7))).x;
    const width = crown.mul(tip.mul(tip).mul(tip).mul(0.42).add(0.62)).mul(jitter.mul(0.32).add(0.82))
        .mul(lump.mul(0.4).add(0.78))
        .mul(needles.mul(0.12).add(0.94));
    const leader = h.mul(0.006).mul(taper.mul(4).saturate());
    const reach = max(width, leader).toVar();
    const mask = fadeOut(reach.sub(form.z), reach.add(form.z), ax).mul(fadeOut(0.985, 1.0, t))
        .mul(smoothstep(-0.02, 0.0, t));
    // Snow clumps on the upper face of each whorl, thicker toward the tips.
    const snow = smoothstep(0.02, 0.14, tf).mul(fadeOut(0.3, 0.55, tf))
        .mul(smoothstep(0.35, 0.85, ax.div(reach.max(1e-3))))
        .mul(smoothstep(0.35, 0.75, jitter.mul(0.6).add(lump.mul(0.5))));
    return vec2(mask, snow.mul(mask));
}).setLayout({
    name: 'aur_spruce', type: 'vec2', inputs: [{ name: 'local', type: 'vec2' }, { name: 'form', type: 'vec4' }],
});

/**
 * The two banks, in metres across at distance z (metres): each runs in from beyond the frame's edge,
 * closest at mid distance, and swings out again toward the horizon, so the near water fills the
 * bottom of the frame and the lake opens wide. [a, b, c, d] of b + c z + d z^2 - a / z, and a cove seed.
 */
const BANKS = { left: [13.04, 8.0, 0.155, 0.0076, 3.3], right: [15.57, 9.09, 0.114, 0.0085, 7.9] };

/** How far a bank reaches out (metres, before its coves) at distance `z`, for a screen-width `scale`. */
function bankReach(z, [a, b, c, d], scale) {
    const zc = z.max(3);
    return zc.mul(zc).mul(d).add(zc.mul(c)).add(b)
        .sub(float(a).div(zc))
        .mul(scale);
}

/** How far inland a point `x` metres across at distance `z` stands: > 0 on a bank, < 0 on the water. */
const inland = /* @__PURE__ */ Fn(([x, z, scale]) => {
    const cove = (seed) => noise1(z.mul(0.11).add(seed)).x.sub(0.5).mul(z.mul(0.22).add(1.5));
    const left = bankReach(z, BANKS.left, scale).negate().add(cove(BANKS.left[4]));
    const right = bankReach(z, BANKS.right, scale).add(cove(BANKS.right[4]));
    return max(left.sub(x), x.sub(right));
}).setLayout({
    name: 'aur_inland',
    type: 'float',
    inputs: [{ name: 'x', type: 'float' }, { name: 'z', type: 'float' }, { name: 'scale', type: 'float' }],
});

/**
 * One row of the bank forest under a pixel. `q`: the pixel in the row's own layer; `row`: (distance m,
 * cell width m, seed, -); `scene`: (horizon, bank scale, one pixel, ripple shake). Each cell holds a
 * spruce a little off the row's depth, standing only on land: young ones at the water's edge, old ones
 * further in. Its reflection is the same tree turned about its own foot. Returns (mask, snow, upright).
 */
const grove = /* @__PURE__ */ Fn(([q, row, scene]) => {
    const z = row.x;
    const seed = row.z;
    const id = floor(q.x.mul(z).div(LENS).div(row.y).add(seed)).toVar();
    const r1 = hash21(vec2(id, seed)).toVar();
    const r2 = hash21(vec2(id.add(17.1), seed)).toVar();
    const r3 = hash21(vec2(id.add(41.7), seed)).toVar();
    // The trunk (screen x, from the row's depth) and the tree's own depth, a little off the row.
    const trunk = id.add(0.5).add(r1.sub(0.5).mul(0.3)).sub(seed).mul(row.y)
        .mul(LENS)
        .div(z)
        .toVar();
    const zt = r3.sub(0.5).mul(0.24).add(1).mul(z)
        .toVar();
    const metres = zt.div(LENS).toVar();
    const foot = scene.x.sub(float(LENS * EYE).div(zt));
    const ground = inland(trunk.mul(metres), zt, scene.y).toVar();
    const presence = smoothstep(0.15, 0.6, ground).mul(smoothstep(0.06, 0.1, r3));
    const height = r2.mul(r2).mul(8).add(8).mul(smoothstep(0.0, 9.0, ground).mul(0.6).add(0.45));
    const ly = q.y.sub(foot).mul(metres).toVar();
    const lx = q.x.sub(trunk).add(scene.w).mul(metres);
    const edge = scene.z.mul(1.3).mul(metres).toVar();
    const tree = spruce(vec2(lx, ly.abs()), vec4(height, r1.mul(13).add(seed), edge, 0));
    return vec3(tree.x.mul(presence), tree.y, smoothstep(edge.negate(), edge, ly));
}).setLayout({
    name: 'aur_grove',
    type: 'vec3',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'row', type: 'vec4' }, { name: 'scene', type: 'vec4' }],
});

/** A range's skyline along x (its own units): a broad massif and four ridged octaves (sharp crests at random places). */
function skyline(x) {
    const ridge = (n) => float(1).sub(n.x.sub(0.5).mul(2).abs());
    const r1 = ridge(noise1(x.mul(1.1).add(3.7))).toVar();
    const r2 = ridge(noise1(x.mul(2.6).add(9.2))).toVar();
    const r3 = ridge(noise1(x.mul(6.1).add(1.9)));
    const r4 = ridge(noise1(x.mul(13.3).add(7.4)));
    return noise1(x.mul(0.45)).x.mul(0.36).add(r1.mul(r1).mul(0.32)).add(r2.mul(r2).mul(0.2))
        .add(r3.mul(0.09))
        .add(r4.mul(0.035));
}

/**
 * The lateral slope of a range's face (d skyline / dx) at `x`, `depth` (in x units) below the crest.
 * Each crest runs on down the face as a ridge that rounds a little as it descends (a smooth |c| whose
 * softness grows with depth), and the smaller crags fade out further down.
 */
function faceSlope(x, depth) {
    const n1 = noise1(x.mul(1.1).add(3.7)).toVar();
    const n2 = noise1(x.mul(2.6).add(9.2)).toVar();
    const c1 = n1.x.sub(0.5).mul(2).toVar();
    const c2 = n2.x.sub(0.5).mul(2).toVar();
    const soft1 = depth.mul(0.5).add(0.03).toVar();
    const soft2 = depth.mul(1.2).add(0.03).toVar();
    const a1 = sqrt(c1.mul(c1).add(soft1.mul(soft1))).toVar();
    const a2 = sqrt(c2.mul(c2).add(soft2.mul(soft2))).toVar();
    const r1 = float(1).sub(a1).add(soft1);
    const r2 = float(1).sub(a2).add(soft2);
    // d(r^2)/dx = 2 r dr/dx, dr/dx = -(c / |c|soft) dc/dx, dc/dx = 2 dn/dx * frequency
    const g1 = c1.div(a1).mul(n1.y).mul(r1).mul(-2 * 2 * 1.1 * 0.32);
    const g2 = c2.div(a2).mul(n2.y).mul(r2).mul(-2 * 2 * 2.6 * 0.2)
        .mul(exp(depth.mul(-6)));
    return noise1(x.mul(0.45)).y.mul(0.45 * 0.36).add(g1).add(g2);
}

/**
 * A snow range's face under a pixel. `q`: the pixel in the range's own layer; `shape`: (crest base
 * above the horizon, height, skyline frequency, seed); `rock`: (crag scale, bump depth, crest rim,
 * top of the forest belt); `scene`: (horizon, peak scale, aurora glow, one pixel). Ridges run down
 * from the crests and wander as they descend; an eroded crag field stretched down the fall line
 * bump-lights the face; snow fills the gullies, the ledges and the aprons at the foot while the crag
 * ribs and the steepest upper flanks stay bare rock; dark forest climbs the foot. The aurora is the
 * key light (green-teal on the faces turned to it); the night sky fills the shadows with blue.
 * Returns (colour, coverage).
 */
const snowFace = /* @__PURE__ */ Fn(([q, shape, rock, scene]) => {
    const horizon = scene.x;
    const glow = scene.z;
    const px = scene.w;
    const base = shape.y;
    const freq = shape.z;
    const seed = shape.w;
    const height = base.mul(scene.y).toVar();
    const x = q.x.mul(freq).add(seed).toVar();
    const rise = q.y.sub(horizon).toVar();
    const depth = horizon.add(shape.x).add(skyline(x).mul(height)).sub(q.y).toVar();
    const inside = smoothstep(px.mul(-1.5), px.mul(1.5), depth);
    const d = depth.max(0).toVar();
    // Ridges run down from the crests and wander as they descend.
    const dx = d.mul(freq).toVar();
    const wander = noise1(x.mul(0.8).add(dx.mul(2.5)).add(seed)).x.sub(0.5);
    const xf = x.add(dx.mul(wander).mul(1.2)).toVar();
    const slope = faceSlope(xf, dx).mul(height).mul(freq).toVar();
    // Crags: an eroded height field on the face, stretched down the fall line, bump-lights it.
    const stretch = rock.x.mul(freq).mul(0.5).toVar();
    // The finest crags (four cycles per crag unit) fade out before they would alias.
    const fine = fadeOut(0.18, 0.35, rock.x.mul(freq).mul(4).mul(px));
    const crag = crags(vec2(x.mul(rock.x), q.y.mul(stretch)).add(seed), fine).toVar();
    const bump = crag.yz.mul(vec2(rock.x.mul(freq), stretch)).mul(rock.y).toVar();
    const normal = vec3(
        slope.negate().sub(bump.x),
        mix(float(0.32), float(0.8), smoothstep(0.0, base.mul(0.8), d)).sub(bump.y),
        0.62,
    ).normalize().toVar();
    const lit = dot(normal, LIGHT_DIR).max(0);
    // Snow fills the gullies, the ledges and the aprons at the foot; the crag ribs and the steepest
    // upper flanks stay bare rock.
    const apron = smoothstep(base.mul(0.25), base.mul(0.7), d);
    const rib = crag.x.add(slope.abs().mul(0.15)).add(bump.length().mul(0.25))
        .add(fadeOut(0.0, base.mul(0.3), d).mul(0.03))
        .sub(apron.mul(0.12));
    // Ledges: snow dusting the tilted strata across the rock (faded out before they would alias).
    const strata = q.y.mul(freq).mul(24).add(x.mul(2.2)).add(noise1(x.mul(2.3)).x.mul(3));
    const ledgeLod = fadeOut(0.12, 0.25, freq.mul(24).mul(px));
    const ledge = smoothstep(0.6, 0.85, noise1(strata).x).mul(ledgeLod);
    const snow = fadeOut(0.47, 0.56, rib).max(ledge.mul(0.55)).toVar();
    // Dark forest climbs the foot of the range.
    const forest = fadeOut(0.012, rock.w, rise.sub(crag.x.mul(0.03)));
    const albedo = mix(float(0.13), float(0.9), snow).mul(float(1).sub(forest.mul(0.92)));
    // Gullies sit in their own shade.
    const hollow = crag.x.mul(0.8).add(0.55).toVar();
    const fill = normal.y.mul(0.45).add(0.55).mul(hollow);
    const face = AURORA_LIGHT.mul(glow).mul(lit).mul(hollow).add(SKY_LIGHT.mul(fill))
        .mul(albedo)
        .toVar();
    // The crest catches the curtains burning behind the range.
    face.addAssign(RIM.mul(exp(d.div(px.mul(2.5)).negate())).mul(glow).mul(rock.z.mul(0.08)));
    return vec4(face, inside);
}).setLayout({
    name: 'aur_snowFace',
    type: 'vec4',
    inputs: [
        { name: 'q', type: 'vec2' }, { name: 'shape', type: 'vec4' }, { name: 'rock', type: 'vec4' },
        { name: 'scene', type: 'vec4' },
    ],
});

export function createAuroraWorld({ u, quality }) {
    const curtains = quality.detail >= 0.6 ? CURTAINS : CURTAINS.filter((c) => !c.optional);
    const rows = quality.detail >= 0.6 ? ROWS : ROWS.filter((_, index) => index % 2 === 0 || index === ROWS.length - 1);
    const mwOctaves = Math.max(2, quality.octaves - 2);

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        // Tall screens see more sky: the horizon sinks with the extra height (29% up a phone).
        const horizon = float(-0.44).sub(u.ext.y.sub(1).mul(0.6)).toVar();
        /** A painted layer under the breathing camera, zoomed about the vanishing point. */
        const view = (q, k) => q.sub(vec2(0, horizon)).div(u.zoom.sub(1).mul(k).add(1)).add(vec2(0, horizon))
            .add(u.pan.mul(k));
        const breath = u.breathSoft;
        // How brightly the sky burns: it lights the snow, the mist and the water too.
        const glow = mix(float(0.24), float(1.15), breath).toVar();

        // ── The lake: below the horizon the eye meets the sky in the water ─────────────────────
        const below = fadeOut(horizon.sub(u.px), horizon.add(u.px), p.y).toVar();
        const drop = horizon.sub(p.y).max(0.0015).toVar();
        const zw = float(LENS * EYE).div(drop).min(400).toVar();
        const xw = p.x.mul(zw).div(LENS).toVar();
        // Slow ripples stir only the near water; the far lake is a mirror.
        const wobble = vec2(0).toVar();
        If(below.greaterThan(0), () => {
            const windA = vec2(u.time.mul(0.05), u.time.mul(-0.12));
            const windB = vec2(u.time.mul(-0.07), u.time.mul(0.16));
            const rippleA = gnoise(vec2(xw.mul(0.5), zw.mul(1.4)).add(windA)).sub(0.5);
            const rippleB = gnoise(vec2(xw.mul(1.2).add(7.1), zw.mul(3.1)).add(windB)).sub(0.5);
            wobble.assign(vec2(rippleA.mul(0.3), rippleB).mul(exp(zw.mul(-0.05)).mul(0.03)));
        });
        const mirrored = vec2(p.x.add(wobble.x), horizon.mul(2).sub(p.y).add(wobble.y).max(horizon));
        const v = mix(p, mirrored, below).toVar();

        // ── The sky at v ─────────────────────────────────────────────────────────────────────
        const az = v.x.div(LENS).toVar();
        const el = v.y.sub(horizon).div(LENS).max(0.0004).toVar();
        const flow = vec4(
            u.breathInt.mul(0.75).add(u.time.mul(0.04)),
            u.time.mul(0.03),
            u.time.mul(0.45),
            smoothstep(0.8, 1.0, u.breath),
        ).toVar();
        // The hem climbs and the curtains grow taller and brighter with the breath.
        const state = vec4(breath.mul(0.24).sub(0.06), mix(float(0.42), float(1.3), breath), glow, u.px.div(LENS))
            .toVar();
        // How tall the frame is: phones see the sheets hanging overhead.
        const tall = smoothstep(1.25, 1.9, u.ext.y).toVar();
        const aurora = vec3(0).toVar();
        const ray = vec2(az, el).toVar();
        const hang = (c) => curtain(
            ray,
            vec4(c.z, c.arch, c.base, c.seed),
            vec4(...c.fold),
            flow,
            state,
            vec4(c.rays, c.tall, c.overhead ? tall.mul(c.gain) : c.gain, c.solid),
            c.lean,
        );
        curtains.filter((c) => !c.overhead).forEach((c) => aurora.addAssign(hang(c)));
        // Sheets overhead only enter tall frames: a landscape frame never pays for them.
        If(tall.greaterThan(0.001), () => {
            curtains.filter((c) => c.overhead).forEach((c) => aurora.addAssign(hang(c)));
        });
        const shine = dot(aurora, LUMA).toVar();

        const sky = mix(SKY_HORIZON, SKY_ZENITH, smoothstep(0.0, 0.9, el)).toVar();
        // Light the aurora scatters into the low air.
        sky.addAssign(AIRGLOW.mul(exp(el.mul(-6))).mul(glow));
        // The Milky Way: a faint band of unresolved stars with dark dust lanes.
        // It rises from the lower left through the darker middle of the sky.
        const band = vec2(0.55, 0.835);
        const rel = v.sub(vec2(-0.45, horizon.add(0.75)));
        const along = dot(rel, band);
        const across = dot(rel, vec2(-0.835, 0.55));
        const core = exp(across.mul(across).mul(-7)).toVar();
        const milky = vec3(0).toVar();
        If(core.greaterThan(0.004), () => {
            const clouds = fbm(vec2(along.mul(2.4), across.mul(5)).add(3.3), mwOctaves);
            const lanes = fbm(vec2(along.mul(4.6), across.mul(10)).add(9.1), mwOctaves);
            const dust = smoothstep(0.5, 0.72, lanes).mul(exp(across.mul(across).mul(-40)));
            milky.assign(MILKY.mul(core.mul(clouds.mul(1.3).sub(0.1).max(0))).mul(float(1).sub(dust.mul(0.75))));
        });
        // Stars: thicker in the band, lost in the bright curtains and in the air near the horizon.
        const stars = starfield(v, u, core.mul(0.9).add(0.75));
        const clear = exp(shine.mul(-2.5)).mul(smoothstep(0.01, 0.12, el));
        sky.addAssign(milky.add(stars).mul(clear));
        sky.addAssign(aurora);
        // What the far air looks like: the ranges and the far shore dissolve into it.
        const haze = SKY_HORIZON.mul(1.25).add(AIRGLOW.mul(glow).mul(0.35)).add(aurora.mul(0.02)).toVar();
        const col = sky.toVar();

        // ── Two snow ranges ──────────────────────────────────────────────────────────────────
        // Tall frames stand the ranges a little higher, so they still hold the lake's far shore.
        const peaks = mix(float(1), float(1.35), tall).toVar();
        const terrain = vec4(horizon, peaks, glow, u.px).toVar();
        RANGES.forEach((range) => If(v.y.lessThan(horizon.add(range.base + 0.04).add(peaks.mul(range.height))), () => {
            const q = view(v, range.k).toVar();
            const face = snowFace(
                q,
                vec4(range.base, range.height, range.freq, range.seed),
                vec4(range.crag, range.bump, range.rim, 0.035 + range.k * 0.3),
                terrain,
            ).toVar();
            // Air between: the far range sinks into the haze, and so does every foot.
            const foot = exp(q.y.sub(horizon).max(0).mul(-34));
            col.assign(mix(col, mix(face.xyz, haze, foot.mul(0.3).add(range.haze)), face.w));
            // Mist pooled at the foot of the range.
            const mist = gnoise(vec2(q.x.mul(3), u.time.mul(0.02).add(range.seed))).mul(0.6).add(0.4);
            col.addAssign(MIST.mul(foot).mul(mist).mul(glow).mul(0.3));
        }));

        // ── The far shore: a dark band of forest along the water, a thin snow line ──────────
        const fq = view(v, 0.2).toVar();
        const spikes = (scale, offset, lift) => {
            const cx = fq.x.mul(scale).add(offset).toVar();
            const tip = float(1).sub(fract(cx).sub(0.5).abs().mul(2));
            return tip.mul(tip).mul(hash11(floor(cx)).mul(0.7).add(0.3)).mul(lift);
        };
        const treeline = horizon.add(0.006).add(noise1(fq.x.mul(4).add(2.1)).x.mul(0.014))
            .add(max(max(spikes(95, 0, 0.013), spikes(61, 0.37, 0.019)), spikes(140, 0.71, 0.009)));
        const farShore = softStep(0, treeline.sub(fq.y), u);
        col.assign(mix(col, mix(FAR_FOREST, haze, 0.18), farShore));
        const lip = fq.y.sub(horizon).div(u.px.mul(1.6));
        col.addAssign(AURORA_LIGHT.mul(exp(lip.mul(lip).negate())).mul(glow).mul(0.05));

        // ── The water: a darker, cooler mirror with Fresnel ─────────────────────────────────
        const lookDown = drop.div(LENS);
        const slant = sqrt(p.x.div(LENS).mul(p.x.div(LENS)).add(lookDown.mul(lookDown)).add(1));
        const reflect = fresnel(lookDown.div(slant), 0.02).mul(0.85).add(0.08).toVar();
        const water = col.mul(WATER_TINT).mul(reflect).add(WATER_DEEP);
        col.assign(mix(col, water, below));

        // ── Snowy banks with spruce on both sides ───────────────────────────────────────────
        // Narrow screens pull the banks in so the trees still frame the lake.
        const bankScale = u.ext.x.div(1.78).clamp(0.55, 1.1).toVar();
        // The ground under this pixel: how far, how far across, and whether it is land.
        const land = float(0).toVar();
        If(below.greaterThan(0), () => {
            const groundK = float(NEAR).mul(drop).div(LENS * EYE).min(2.2);
            const gq = view(p, groundK).toVar();
            const zg = float(LENS * EYE).div(horizon.sub(gq.y).max(0.0015)).min(600).toVar();
            const xg = gq.x.mul(zg).div(LENS).toVar();
            const metre = u.px.mul(zg).div(LENS).toVar();
            const landEdge = inland(xg, zg, bankScale).toVar();
            land.assign(smoothstep(metre.mul(-1.5), metre.mul(1.5), landEdge).mul(below));
            If(land.greaterThan(0), () => {
                // Wind-packed drifts and sastrugi, bump-lit by the aurora ahead; the bank's low front
                // face stands in shadow under a snow lip.
                const drift = noise2(vec2(xg.mul(0.3), zg.mul(0.5))).toVar();
                const sastrugi = noise2(vec2(xg.mul(1.6), zg.mul(3.2)).add(4.4)).toVar();
                const groundNormal = vec3(
                    drift.y.mul(0.3 * 0.7).add(sastrugi.y.mul(1.6 * 0.12)).negate(),
                    1,
                    drift.z.mul(0.5 * 0.7).add(sastrugi.z.mul(3.2 * 0.12)).negate(),
                ).normalize();
                const groundLit = dot(groundNormal, GROUND_LIGHT).max(0);
                const lipWidth = zg.mul(0.02).add(0.25);
                const bankFace = fadeOut(0.25, 0.7, landEdge.div(lipWidth));
                // Deeper in, the snow lies in the forest's shade.
                const forestShade = smoothstep(1.0, 7.0, landEdge).mul(0.5).add(bankFace.mul(0.75)).min(0.85);
                const snowGround = AURORA_LIGHT.mul(glow).mul(groundLit).mul(0.3).add(SKY_LIGHT.mul(1.4))
                    .mul(drift.x.mul(0.3).add(0.75))
                    .mul(float(1).sub(forestShade));
                col.assign(mix(col, snowGround, land));
                const lipBank = landEdge.div(lipWidth).sub(0.85).mul(3);
                col.addAssign(AURORA_LIGHT.mul(exp(lipBank.mul(lipBank).negate())).mul(glow).mul(land).mul(0.06));
            });
        });
        const open = float(1).sub(land).mul(below).toVar();

        // The bank forest, far rows first; each row only where the frame's sides can hold its trees
        // (or their reflections): beyond the nearer of its shores, less the deepest cove and a crown.
        const scene = vec4(horizon, bankScale, u.px, wobble.x.mul(below)).toVar();
        rows.forEach((row) => {
            const q = view(p, Math.min(NEAR / row.z, 2.2)).toVar();
            const z = float(row.z);
            const shoreline = bankReach(z, BANKS.left, bankScale).min(bankReach(z, BANKS.right, bankScale))
                .sub(row.z * 0.11 + 0.75 + 1.8).max(0)
                .mul(LENS / row.z);
            If(q.x.abs().greaterThan(shoreline), () => {
                const tree = grove(q, vec4(row.z, row.cell, row.seed, 0), scene).toVar();
                const haziness = (1 - Math.exp(-row.z / 70)) * 0.4;
                const shade = mix(SPRUCE.add(SPRUCE_SNOW.mul(tree.y).mul(glow)), haze, haziness).toVar();
                col.assign(mix(col, shade, tree.x.mul(tree.z)));
                col.assign(mix(col, shade.mul(reflect).add(WATER_DEEP), tree.x.mul(float(1).sub(tree.z)).mul(open)));
            });
        });
        return col;
    })();

    return {
        backdrop,
        motes: {
            // Snow, a few flakes close to the lens and out of focus.
            motion: MOTE_MOTION.fall,
            count: 150,
            size: 0.018,
            speed: 0.55,
            spread: 1.05,
            depth: 2.6,
            bokeh: 0.2,
            colorA: [0.78, 0.9, 1.0],
            colorB: [0.7, 1.0, 0.86],
            gain: 0.4,
        },
        bloom: {
            strength: 0.4, radius: 0.7, threshold: 0.55, breath: 0.6,
        },
        grade: {
            shadows: [0.86, 0.97, 1.08], highlights: [1.0, 1.02, 0.98], saturation: 1.0, contrast: 1.07, vignette: 0.42,
        },
        camera: { dolly: 0.04, drift: [0.035, 0.012], period: 70 },
        exposure: 1.0,
    };
}
