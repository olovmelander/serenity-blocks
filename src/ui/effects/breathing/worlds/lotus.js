/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Heart Glow — a luminous lotus afloat on a still pond at night.
 * Inhale: the petals open ring by ring, the golden heart swells, its light warms the water and a
 * ripple ring leaves the flower. Exhale: the petals fold and the light softens. No pauses: the
 * bloom never stops moving.
 *
 * The pond is painted in perspective (lotus-pond.js): everything on the water lives in plane
 * coordinates — round lily pads become ellipses, ripple rings flatten, mist lies along the surface
 * — and each depth gets its own parallax, so the pond tilts under the breathing camera. The water
 * is a dark mirror: it reflects the night and the far shore (smeared downward by a faint swell,
 * the lanterns' bokeh drawn out into glints), the flower's glow, and the flower itself (a mirrored
 * mesh, lotus-flower.js). A thin veil of mist sits over the flower's foot; reeds frame the edges
 * out of focus; fireflies drift and blink over the water.
 *
 * Moods: the rose lotus at night (the poster), a white lotus at misty dawn, a blue lotus under the
 * full moon (its path glittering on the water), and a lantern festival (paper lanterns afloat, sky
 * lanterns rising). Now and then a petal falls on the water and sends out a ring, and a koi glides
 * under the pads; both keep to the visit's own timetable (u.seed) and rest under reduced motion.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, cos, dot, exp, float, max, mix, positionWorld, select, sin, smoothstep, step, uniformArray, vec2,
    vec3,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, fbm3, fresnel, gnoise, hash21, hash22, layer, softStep, starfield,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION, MOTE_SHAPE } from '../stage/breath-motes.js';
import { createLotus } from './lotus-flower.js';
import {
    WATERLINE, createPadField, lookDown, pondPlane,
} from './lotus-pond.js';

const TAU = Math.PI * 2;
/** The camera's distance from the hero plane (breath-world-host.js). */
const CAMERA_DISTANCE = 6;
/** Ripple rings: spacing on the water (plane units). One ring leaves the flower per breath. */
const RING_GAP = 0.42;
/** breathInt gains about 5 over one 5·0·5·0 cycle (mean lung fill 0.5 over 10 s). */
const RING_PER_BREATH = 1 / 5;

/** A koi's length on the water (plane units). */
const KOI_LENGTH = 0.36;

/** Far-shore lanterns, far out of focus: x, height above the horizon, radius, colour, gain, phase. */
const LANTERNS = [
    [-1.62, 0.12, 0.11, [1.0, 0.55, 0.26], 0.22, 0.0],
    [-1.36, 0.05, 0.04, [1.0, 0.76, 0.42], 0.75, 1.7],
    [-1.22, 0.16, 0.065, [1.0, 0.45, 0.45], 0.3, 3.1],
    [-0.98, 0.06, 0.085, [1.0, 0.62, 0.32], 0.28, 4.4],
    [-0.7, 0.03, 0.028, [1.0, 0.82, 0.5], 0.9, 2.6],
    [-0.42, 0.11, 0.05, [0.8, 0.5, 1.0], 0.22, 2.2],
    [0.36, 0.035, 0.032, [1.0, 0.72, 0.4], 0.8, 5.3],
    [0.62, 0.14, 0.09, [1.0, 0.5, 0.36], 0.2, 0.9],
    [0.94, 0.05, 0.05, [1.0, 0.78, 0.46], 0.6, 2.8],
    [1.28, 0.1, 0.12, [0.9, 0.46, 0.6], 0.18, 4.0],
    [1.52, 0.04, 0.035, [1.0, 0.66, 0.36], 0.85, 1.2],
    [1.74, 0.18, 0.08, [1.0, 0.6, 0.3], 0.25, 3.6],
    [-1.08, 0.3, 0.06, [1.0, 0.7, 0.4], 0.35, 1.9],
    [1.1, 0.27, 0.05, [1.0, 0.56, 0.5], 0.3, 5.0],
];
/** Closed buds standing in the water beside the pads: x, depth, height, lean. */
const BUDS = [
    [-0.66, 1.4, 0.15, 0.12],
    [1.12, 1.3, 0.12, -0.18],
    [0.62, 0.52, 0.1, 0.1],
];
/**
 * Reeds rising from below the frame at its edges: side, inset from the edge, length, bend toward
 * the middle, width at the foot, parallax depth k (nearer is softer), and where a seed head sits
 * along the stem (0: none).
 */
const REEDS = [
    [-1, 0.0, 1.9, 0.24, 0.07, 2.0, 0.0],
    [-1, 0.13, 1.45, 0.07, 0.03, 1.8, 0.8],
    [-1, -0.08, 1.15, 0.55, 0.13, 2.6, 0.0],
    [-1, 0.26, 1.0, 0.18, 0.06, 1.7, 0.0],
    [1, 0.02, 1.75, -0.2, 0.065, 2.0, 0.0],
    [1, 0.18, 1.3, -0.42, 0.1, 2.3, 0.0],
    [1, -0.05, 2.05, -0.05, 0.03, 1.9, 0.84],
    [1, 0.3, 0.9, -0.14, 0.055, 1.7, 0.0],
];

/**
 * One reed blade as a soft mask: a tapering, curving stem from `foot` (below the frame) up
 * `length`. Returns the mask and the signed position across the blade (-1..1).
 */
function reedBlade(q, foot, length, bend, width, soft) {
    const t = q.y.sub(foot.y).div(length).toVar();
    const along = t.clamp(0, 1).toVar();
    const centre = foot.x.add(along.mul(along).mul(bend));
    const half = float(width).mul(float(1).sub(along).max(0).pow(0.55)).add(0.001).toVar();
    const offset = q.x.sub(centre).toVar();
    const mask = fadeOut(half.sub(soft), half.add(soft), offset.abs()).mul(fadeOut(0.985, 1.0, t)).toVar();
    return { mask, edge: offset.div(half.add(soft)).clamp(-1, 1) };
}

/**
 * A thin veil of mist lying on the water at the flower's depth, drawn over the flower's foot and its
 * image so the lotus sits in the mist rather than on top of it. Lit warm near the flower.
 */
function mistVeil(u, light, pal, amount) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
    const x = positionWorld.x.toVar();
    const y = positionWorld.y.sub(WATERLINE + 0.015).toVar();
    const layerShape = exp(y.mul(y).mul(-260)).toVar();
    const wisps = fbm3(vec3(x.mul(1.1).add(u.time.mul(0.03)).add(u.seed.mul(9.1)), y.mul(7), u.time.mul(0.04)), 2);
    const lit = exp(x.mul(x).mul(-2.2)).toVar();
    material.colorNode = pal.mist.mul(1.4).add(mix(pal.rose, pal.gold, 0.4).mul(lit).mul(light.glow).mul(0.14));
    material.opacityNode = layerShape.mul(smoothstep(0.3, 0.8, wisps).mul(0.7).add(0.3)).mul(lit.mul(0.3).add(0.25))
        .mul(Math.min(amount, 1.6));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.36, 1, 1), material);
    mesh.position.set(0, WATERLINE + 0.015, 0);
    mesh.renderOrder = 11;
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * Rows of vec4s read by index inside one shader loop: the loop body compiles once instead of once
 * per item (a fraction of the code, and of the pipeline's compile time, of the unrolled form).
 */
const rows = (items, ...pack) => pack.map((fn) => uniformArray(
    items.map((item, index) => new THREE.Vector4(...fn(item, index))),
    'vec4',
));

/**
 * Paper lanterns afloat on the festival night: x and depth on the water (plane units), size, phase.
 * Kept clear of the flower: to its sides, and in the near water below it.
 */
const FLOATERS = [
    [-3.3, 4.4, 1.0, 0.3],
    [2.95, 3.7, 1.0, 4.2],
    [-2.2, 2.6, 0.95, 1.9],
    [1.9, 2.25, 1.05, 2.6],
    [-1.45, 1.42, 0.9, 5.1],
    [1.28, 1.08, 0.85, 3.3],
    [-0.98, 0.78, 0.8, 0.9],
    [0.62, 0.64, 0.75, 2.2],
    [-0.36, 0.52, 0.7, 4.8],
];

/** Fireflies drifting low over the water, glowing for a few seconds and resting. */
const fireflies = (count, colorA, colorB, gain) => ({
    motion: MOTE_MOTION.wander,
    count,
    size: 0.026,
    speed: 0.45,
    spread: 0.92,
    band: [-0.75, 0.55],
    depth: 2.2,
    bokeh: 0.08,
    blink: 0.85,
    colorA,
    colorB,
    gain,
});
/** Loose petals drifting down past the lens on the breeze, turning over as they fall. */
const petals = (count, colorA, colorB, gain) => ({
    motion: MOTE_MOTION.fall,
    shape: MOTE_SHAPE.petal,
    blend: 'alpha',
    count,
    size: 0.034,
    speed: 0.32,
    spread: 1.0,
    depth: 1.8,
    bokeh: 0.3,
    spin: 0.5,
    tumble: 0.8,
    flutter: 1,
    colorA,
    colorB,
    gain,
});

/**
 * The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's.
 * Colours are linear RGB. night/haze: the sky overhead and at the horizon; shore: the far tree line;
 * deep: the water's own colour; rose/gold/warm/ember: the flower's light as it falls on things;
 * pads: green, teal, young (wine-red) and rim; ambient: what lights a koi or a petal away from the
 * flower; glow: the heart's brightness at empty and how much a breath adds; flower: the petals'
 * look (lotus-flower.js). Optional: moon, sun (a glow behind the far trees), floaters (paper
 * lanterns on the water). stars, lanterns (the far shore's bokeh) and mist are amounts.
 */
export const MOODS = Object.freeze([
    {
        id: 'rose-night',
        name: 'Rose Night',
        night: [0.0022, 0.0024, 0.017],
        haze: [0.021, 0.011, 0.04],
        shore: [0.004, 0.003, 0.008],
        deep: [0.0035, 0.0028, 0.009],
        mist: [0.055, 0.042, 0.09],
        rose: [1.0, 0.36, 0.52],
        gold: [1.0, 0.7, 0.34],
        warm: [1.0, 0.52, 0.43],
        ember: [1.0, 0.5, 0.42],
        pads: [[0.006, 0.018, 0.008], [0.004, 0.017, 0.013], [0.026, 0.007, 0.014], [0.034, 0.01, 0.018]],
        reed: [0.0018, 0.0026, 0.0026],
        ambient: [0.018, 0.014, 0.03],
        petal: [0.9, 0.3, 0.46],
        stars: 0.5,
        lanterns: 1,
        mistAmount: 1,
        glow: [0.8, 1.4],
        flower: {},
        motes: [
            fireflies(52, [0.92, 1.0, 0.42], [1.0, 0.78, 0.35], 1.25),
            petals(9, [0.42, 0.1, 0.2], [0.62, 0.2, 0.3], 0.75),
        ],
        shaftTint: [1.0, 0.76, 0.56],
        bloom: {
            strength: 0.42, radius: 0.72, threshold: 0.75, breath: 0.5,
        },
        grade: {
            shadows: [0.94, 0.9, 1.1], highlights: [1.06, 0.98, 0.92], saturation: 1.06, contrast: 1.05, vignette: 0.5,
        },
        exposure: 1.0,
    },
    {
        id: 'white-dawn',
        name: 'White Dawn',
        night: [0.07, 0.1, 0.2],
        haze: [0.3, 0.22, 0.27],
        shore: [0.05, 0.05, 0.075],
        deep: [0.012, 0.016, 0.026],
        mist: [0.26, 0.22, 0.27],
        rose: [1.0, 0.62, 0.62],
        gold: [1.0, 0.76, 0.42],
        warm: [1.0, 0.66, 0.5],
        ember: [1.0, 0.62, 0.48],
        pads: [[0.03, 0.06, 0.03], [0.022, 0.055, 0.042], [0.08, 0.026, 0.036], [0.09, 0.035, 0.045]],
        reed: [0.02, 0.022, 0.028],
        ambient: [0.22, 0.2, 0.24],
        petal: [0.96, 0.9, 0.9],
        sun: {
            x: -0.62, y: 0.05, color: [1.0, 0.58, 0.4], gain: 0.55,
        },
        stars: 0,
        lanterns: 0,
        mistAmount: 2.2,
        glow: [0.5, 1.0],
        flower: {
            gold: [1.0, 0.8, 0.42],
            skylight: [0.2, 0.19, 0.24],
            wrap: 0.75,
            imageTint: [0.82, 0.82, 0.92],
            halo: [1.0, 0.82, 0.62],
            pigments: [
                null,
                [[0.82, 0.8, 0.5], [0.94, 0.92, 0.88], [1.0, 0.9, 0.92]],
                [[0.84, 0.82, 0.52], [0.95, 0.93, 0.9], [1.0, 0.92, 0.93]],
                [[0.86, 0.82, 0.5], [0.96, 0.94, 0.9], [1.0, 0.95, 0.94]],
            ],
        },
        motes: [
            petals(14, [0.62, 0.55, 0.58], [0.8, 0.66, 0.68], 0.8),
            {
                // Dew and pollen hanging in the still dawn air, catching the light.
                motion: MOTE_MOTION.wander,
                count: 30,
                size: 0.012,
                speed: 0.2,
                spread: 0.95,
                band: [-0.6, 0.5],
                depth: 2.2,
                bokeh: 0.12,
                colorA: [1.0, 0.9, 0.75],
                colorB: [1.0, 0.8, 0.7],
                gain: 0.35,
            },
        ],
        shaftTint: [1.0, 0.86, 0.7],
        bloom: {
            strength: 0.3, radius: 0.7, threshold: 0.85, breath: 0.4,
        },
        grade: {
            shadows: [0.96, 0.98, 1.06],
            highlights: [1.05, 1.0, 0.96],
            saturation: 0.96,
            contrast: 1.02,
            vignette: 0.42,
        },
        exposure: 1.0,
    },
    {
        id: 'blue-moon',
        name: 'Blue Moon',
        night: [0.003, 0.006, 0.03],
        haze: [0.012, 0.02, 0.05],
        shore: [0.003, 0.004, 0.01],
        deep: [0.003, 0.004, 0.012],
        mist: [0.04, 0.055, 0.1],
        rose: [0.42, 0.52, 1.0],
        gold: [1.0, 0.8, 0.46],
        warm: [0.55, 0.64, 1.0],
        ember: [0.5, 0.56, 1.0],
        pads: [[0.005, 0.016, 0.014], [0.004, 0.015, 0.018], [0.014, 0.008, 0.024], [0.02, 0.014, 0.03]],
        reed: [0.0015, 0.0024, 0.0035],
        ambient: [0.03, 0.04, 0.07],
        petal: [0.45, 0.55, 1.0],
        moon: {
            x: 0.58, y: 0.4, r: 0.068, color: [0.86, 0.92, 1.0], gain: 0.98,
        },
        stars: 0.9,
        lanterns: 0,
        mistAmount: 1.2,
        glow: [0.75, 1.3],
        flower: {
            gold: [1.0, 0.82, 0.45],
            skylight: [0.03, 0.04, 0.08],
            wrap: 0.3,
            imageTint: [0.7, 0.8, 1.0],
            halo: [0.45, 0.55, 1.0],
            pigments: [
                null,
                [[0.8, 0.84, 0.95], [0.36, 0.5, 1.0], [0.26, 0.36, 0.95]],
                [[0.82, 0.86, 0.96], [0.42, 0.55, 1.0], [0.3, 0.42, 0.98]],
                [[0.86, 0.88, 0.96], [0.5, 0.62, 1.0], [0.38, 0.5, 1.0]],
            ],
        },
        motes: [
            fireflies(30, [0.7, 0.95, 0.75], [0.8, 0.9, 1.0], 1.0),
        ],
        shaftTint: [0.8, 0.86, 1.0],
        bloom: {
            strength: 0.45, radius: 0.72, threshold: 0.75, breath: 0.5,
        },
        grade: {
            shadows: [0.92, 0.96, 1.12], highlights: [1.0, 1.0, 1.02], saturation: 1.04, contrast: 1.06, vignette: 0.52,
        },
        exposure: 1.0,
    },
    {
        id: 'lantern-festival',
        name: 'Lantern Festival',
        night: [0.004, 0.0025, 0.013],
        haze: [0.04, 0.017, 0.03],
        shore: [0.005, 0.003, 0.006],
        deep: [0.0045, 0.003, 0.006],
        mist: [0.07, 0.045, 0.05],
        rose: [1.0, 0.42, 0.4],
        gold: [1.0, 0.72, 0.34],
        warm: [1.0, 0.58, 0.32],
        ember: [1.0, 0.55, 0.3],
        pads: [[0.008, 0.016, 0.006], [0.006, 0.015, 0.01], [0.03, 0.008, 0.01], [0.04, 0.014, 0.012]],
        reed: [0.003, 0.0024, 0.002],
        ambient: [0.03, 0.02, 0.016],
        petal: [1.0, 0.5, 0.36],
        floaters: true,
        stars: 0.35,
        lanterns: 1.5,
        mistAmount: 0.9,
        glow: [0.8, 1.4],
        flower: {
            halo: [1.0, 0.5, 0.4],
            pigments: [
                null,
                [[0.66, 0.06, 0.12], [1.0, 0.32, 0.3], [1.0, 0.74, 0.6]],
                [[0.7, 0.07, 0.13], [1.0, 0.38, 0.34], [1.0, 0.8, 0.66]],
                [[0.74, 0.1, 0.15], [1.0, 0.46, 0.4], [1.0, 0.86, 0.72]],
            ],
        },
        motes: [
            {
                // Sky lanterns, released somewhere along the shore, drifting up into the night.
                motion: MOTE_MOTION.rise,
                count: 12,
                size: 0.055,
                speed: 0.12,
                spread: 1.0,
                depth: 2.4,
                bokeh: 0.04,
                colorA: [1.0, 0.56, 0.22],
                colorB: [1.0, 0.72, 0.36],
                gain: 1.8,
            },
            fireflies(18, [1.0, 0.86, 0.45], [1.0, 0.7, 0.35], 0.9),
        ],
        shaftTint: [1.0, 0.72, 0.48],
        bloom: {
            strength: 0.46, radius: 0.74, threshold: 0.72, breath: 0.5,
        },
        grade: {
            shadows: [0.96, 0.9, 1.04], highlights: [1.08, 0.98, 0.9], saturation: 1.08, contrast: 1.05, vignette: 0.52,
        },
        exposure: 1.0,
    },
]);

export function createLotusWorld({ u, quality, mood }) {
    const { octaves, detail } = quality;
    const look = MOODS.find((entry) => entry.id === mood?.id) ?? MOODS[0];
    const pal = {
        night: vec3(...look.night),
        haze: vec3(...look.haze),
        shore: vec3(...look.shore),
        deep: vec3(...look.deep),
        mist: vec3(...look.mist),
        rose: vec3(...look.rose),
        gold: vec3(...look.gold),
        warm: vec3(...look.warm),
        ember: vec3(...look.ember),
        ambient: vec3(...look.ambient),
    };
    const [PAD_GREEN, PAD_TEAL, PAD_YOUNG, PAD_RIM] = look.pads.map((c) => vec3(...c));
    const {
        night: NIGHT, haze: HAZE, shore: SHORE, deep: DEEP, mist: MIST,
        rose: ROSE, gold: GOLD, warm: WARM, ember: EMBER,
    } = pal;
    const padField = createPadField();
    const lotus = createLotus(u, {
        waterline: WATERLINE, scale: 1.18, padField, look: look.flower,
    });
    const [lanternAt, lanternTint] = rows(
        LANTERNS,
        ([x, h, size, , gain]) => [x, h, 1 / size, gain * 0.5 * look.lanterns],
        ([, , , color, , phase]) => [...color, phase],
    );
    const [reedShape, reedLook] = rows(
        REEDS,
        ([side, inset, length, bend]) => [side, inset, length, bend],
        ([, , , , width, k, head], index) => [width, k, head, index * 1.9],
    );
    const [floaterAt] = look.floaters ? rows(FLOATERS, (floater) => floater) : [null];
    const { light } = lotus;
    const mistOctaves = detail >= 0.7 ? 3 : 2;

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const glow = light.glow.toVar();
        const {
            slope, horizon, below, depth, plane, planePx,
        } = pondPlane(p, u);
        const water = softStep(0, below, u).toVar();
        const rel = plane.sub(vec2(0, 1)).toVar();
        const r = rel.length().toVar();
        // How many pixels one plane unit spans vertically here: fine detail fades out before it aliases.
        const unitPx = slope.div(depth.mul(depth).mul(u.px)).toVar();

        // The swell: long, low wavelets that break reflections into horizontal glints.
        const drift = u.time.mul(0.04);
        const swellRaw = gnoise(vec2(plane.x.mul(1.4).add(drift), depth.mul(6.5).sub(u.time.mul(0.22))));
        const swell = mix(float(0.5), swellRaw, smoothstep(1.5, 5.0, unitPx.div(6.5))).toVar();
        const fineRaw = gnoise(vec2(plane.x.mul(4.5).sub(drift), depth.mul(22).add(u.time.mul(0.3))));
        const fine = mix(float(0.5), fineRaw, smoothstep(1.5, 5.0, unitPx.div(22))).toVar();

        // ---- The far shore and the sky above it, at infinity. The water shows the same view
        // mirrored about the horizon and drawn downward by the swell, so one lookup serves both. ----
        const hy = p.y.sub(horizon).max(0).add(below.max(0).mul(0.42)).toVar();
        const sx = p.x.add(swell.sub(0.5).mul(0.05).mul(water)).toVar();
        const sky = mix(HAZE, NIGHT, smoothstep(0.0, 0.7, hy)).toVar();
        // The flower's light lifts the haze behind it.
        sky.addAssign(EMBER.mul(exp(sx.mul(sx).mul(-1.4).sub(hy.mul(hy).mul(9)))).mul(glow.mul(0.008).add(0.003)));
        if (look.sun) {
            // Dawn: the sun still under the far trees warms the sky above them (gaussians: no cusps).
            const { sun } = look;
            const sd = sx.sub(sun.x).toVar();
            const sh = hy.sub(sun.y).toVar();
            sky.addAssign(vec3(...sun.color).mul(
                exp(sd.mul(sd).mul(-3.5).sub(sh.mul(sh).mul(30))).mul(0.6)
                    .add(exp(sd.mul(sd).mul(-0.45).sub(hy.mul(4.5))).mul(0.4)),
            ).mul(sun.gain));
        }
        if (look.moon) {
            // The full moon, its faint maria and a soft halo in the thin air round it.
            const { moon } = look;
            const md = vec2(sx.sub(moon.x), hy.sub(moon.y)).toVar();
            const mr = md.length().toVar();
            const disc = fadeOut(moon.r * 0.94, moon.r * 1.04, mr).toVar();
            const maria = smoothstep(0.45, 0.7, gnoise(md.mul(1.8 / moon.r).add(4.2))).mul(0.22)
                .add(smoothstep(0.5, 0.75, gnoise(md.mul(4 / moon.r).add(9.7))).mul(0.1));
            const limb = float(1).sub(mr.div(moon.r).saturate().pow(2).mul(0.25));
            const moonHalo = exp(mr.mul(mr).mul(-1 / (moon.r * moon.r * 6))).mul(0.12)
                .add(exp(mr.mul(mr).mul(-2.2)).mul(0.035));
            // In the water the disc itself breaks up into the glittering path (below), leaving its glow.
            const face = disc.mul(float(1).sub(maria)).mul(limb).mul(moon.gain).mul(float(1).sub(water));
            sky.addAssign(vec3(...moon.color).mul(face.add(moonHalo)));
        }
        // A low tree line, softer behind the flower and taller toward the sides, slightly out of focus.
        const ridge = fbm(vec2(sx.mul(1.15).add(3.7), 0.6), Math.min(octaves - 1, 3)).mul(0.15)
            .add(gnoise(vec2(sx.mul(6.5), 1.3)).mul(0.045))
            .add(gnoise(vec2(sx.mul(16), 4.1)).mul(0.014))
            .mul(smoothstep(0.0, 1.3, sx.abs()).mul(0.6).add(0.4))
            .add(0.008)
            .toVar();
        const shore = fadeOut(ridge.sub(0.008), ridge.add(0.008), hy).toVar();
        sky.assign(mix(sky, SHORE.add(HAZE.mul(exp(hy.mul(-24))).mul(0.5)), shore));
        // Lanterns among the far trees, far out of focus: soft discs with a brighter rim, breathing slowly.
        const lanterns = vec3(0).toVar();
        if (look.lanterns > 0) {
            Loop(LANTERNS.length, ({ i }) => {
                const at = lanternAt.element(i).toVar();
                const tint = lanternTint.element(i).toVar();
                const d = vec2(sx.sub(at.x), hy.sub(at.y)).length().mul(at.z).toVar();
                const disc = fadeOut(0.82, 1.0, d).mul(smoothstep(0.55, 0.97, d).mul(0.3).add(0.7));
                const halo = exp(d.mul(d).mul(-0.5)).mul(0.07);
                const breathe = sin(u.time.mul(0.29).add(tint.w)).mul(0.1).add(0.9);
                lanterns.addAssign(tint.xyz.mul(disc.add(halo)).mul(at.w).mul(breathe));
            });
        }

        // ---- The sky proper: a few stars high in the night, the lanterns, the haze. ----
        const skyColor = sky.add(lanterns).toVar();
        if (look.stars > 0) {
            skyColor.addAssign(starfield(p, u, 0.45 * (look.stars / 0.5)).mul(smoothstep(0.25, 0.8, hy)).mul(0.5));
        }

        // ---- The pond: a dark mirror. Grazing views reflect almost everything; the near water only
        // a little of the night, but bright things (the flower, the lanterns) still show in it. Long,
        // slow swells keep the still surface from reading as glass: the night's sheen drifts across it.
        const downward = below.max(0).toVar();
        const cosView = downward.div(downward.mul(downward).add(1).sqrt());
        const mirror = fresnel(cosView, 0.02).mul(0.6).add(0.4).toVar();
        const shimmer = swell.mul(0.6).add(fine.mul(0.4)).toVar();
        const glints = mix(float(0.3), smoothstep(0.42, 0.72, shimmer).mul(1.7), 0.85).toVar();
        const swells = fbm(vec2(plane.x.mul(0.5).add(u.time.mul(0.012)), depth.min(12).mul(1.4).sub(u.time.mul(0.025))), 3);
        const sheen = swells.mul(1.2).add(0.3).mul(shimmer.mul(0.5).add(0.75));
        const pond = DEEP.add(sky.mul(mirror).mul(sheen)).toVar();
        pond.addAssign(lanterns.mul(mirror).mul(glints));
        if (look.sun) {
            // The sun's warmth lies on the water below it: a faint path of glints toward us.
            const { sun } = look;
            const sunW = downward.mul(0.5).add(0.12);
            const off = p.x.sub(sun.x).div(sunW);
            const warmPath = exp(off.mul(off).negate()).mul(smoothstep(0.5, 0.8, shimmer)).mul(water)
                .mul(exp(downward.mul(-2.0)));
            pond.addAssign(vec3(...sun.color).mul(warmPath).mul(mirror).mul(0.22 * sun.gain));
        }
        if (look.moon) {
            // The moon's path: glints on the wavelets in a column under the moon, widening toward us.
            const { moon } = look;
            const pathW = downward.mul(0.3).add(0.05);
            const across = p.x.sub(moon.x).div(pathW);
            const sparkle = smoothstep(0.52, 0.8, shimmer).mul(1.6).add(smoothstep(0.86, 0.95, fine).mul(1.5));
            const path = exp(across.mul(across).negate()).mul(sparkle).mul(water)
                .mul(exp(downward.mul(-1.2)).mul(0.7).add(0.3));
            pond.addAssign(vec3(...moon.color).mul(path).mul(mirror).mul(0.45));
        }

        // The flower's image: its glow mirrored about the water, drawn downward and broken by the swell.
        const hq = layer(p, u, 1).toVar();
        const toHeart = hq.sub(light.screen).toVar();
        const imageY = float(WATERLINE * 2).sub(light.screen.y);
        const toImage = vec2(hq.x.mul(1.25), hq.y.sub(imageY).mul(0.5)).toVar();
        const imageReach = dot(toImage, toImage).toVar();
        const imageGlow = exp(imageReach.mul(-12)).mul(0.5).add(exp(imageReach.mul(-2.8)).mul(0.1)).toVar();
        const brokenImage = mix(float(0.55), smoothstep(0.3, 0.75, shimmer).mul(1.5), 0.7).toVar();
        pond.addAssign(mix(ROSE, GOLD, 0.45).mul(imageGlow).mul(brokenImage).mul(glow)
            .mul(0.2));
        // Glitter: wavelets near the flower catch its light in tiny points that drift and fade slowly.
        const glitterRaw = gnoise(vec2(plane.x.mul(22).add(u.time.mul(0.15)), depth.mul(60).sub(u.time.mul(0.4))));
        const glitter = smoothstep(0.84, 0.94, glitterRaw).mul(smoothstep(2.0, 5.0, unitPx.div(60))).mul(imageGlow);
        pond.addAssign(GOLD.mul(glitter).mul(glow).mul(0.4));
        // A warm pool where the flower's light falls on the water around its foot.
        pond.addAssign(WARM.mul(exp(r.mul(r).mul(-5))).mul(glow).mul(0.035));
        // Light: the flower's warmth falls off across the water.
        const padWarm = exp(r.mul(r).mul(-1.6)).mul(0.9).add(float(0.08).div(r.mul(r).mul(3).add(1))).toVar();

        // Ripple rings from the flower: one small wave packet leaves with each breath (breathInt runs
        // while the lungs fill), flattened by the perspective. Their slopes tip the mirror: crests catch
        // the flower's light — most on the near side, where it reflects toward us — troughs fall dark.
        const ringAge = r.mul(1 / RING_GAP).sub(u.breathInt.mul(RING_PER_BREATH)).sub(u.time.mul(0.01));
        const f = ringAge.fract().sub(0.5).toVar();
        const wave = sin(f.mul(TAU * 8)).mul(exp(f.mul(f).mul(-55))).toVar();
        const nearSide = fadeOut(-0.8, 0.5, rel.y.div(r.max(1e-3)));
        const ringFade = smoothstep(0.2, 0.38, r).mul(exp(r.mul(-0.95))).mul(smoothstep(2.0, 5.0, unitPx.mul(RING_GAP / 8)))
            .mul(nearSide.mul(0.65).add(0.35))
            .mul(swell.mul(0.9).add(0.55))
            .toVar();
        const crest = wave.max(0).mul(wave.max(0)).mul(ringFade).toVar();
        const ringLight = WARM.mul(exp(r.mul(r).mul(-1.2))).mul(glow).mul(0.07);
        pond.assign(pond.mul(wave.mul(ringFade).mul(0.6).add(1)).add(ringLight.mul(crest)));

        // ---- Now and then a koi glides by under the surface, across the pond and under the pads. ----
        const koi = eventWindow(u.time, float(43), float(18), float(0.8), u.seed.mul(29.7).add(5.3)).toVar();
        const koiShow = koi.x.mul(u.life).toVar();
        If(koiShow.greaterThan(0.001), () => {
            const heading = select(hash21(vec2(koi.z, 1.1)).greaterThan(0.5), float(1), float(-1)).toVar();
            const bend = hash21(vec2(koi.z, 4.4)).mul(TAU).toVar();
            const s = koi.y.mul(2).sub(1).toVar();
            // It crosses the near water, in front of the flower (where the open water lies), weaving a little.
            const koiAt = vec2(s.mul(1.6).mul(heading), mix(float(0.56), float(0.8), hash21(vec2(koi.z, 2.3)))
                .add(sin(s.mul(2.2).add(bend)).mul(0.1)));
            const forward = vec2(heading.mul(3.2), cos(s.mul(2.2).add(bend)).mul(0.1 * 2.2 * 2)).normalize().toVar();
            const kRel = plane.sub(koiAt).toVar();
            const kq = vec2(dot(kRel, forward), dot(kRel, vec2(forward.y.negate(), forward.x))).div(KOI_LENGTH * 0.5)
                .toVar();
            // It swims: a wave runs down the body toward the tail, larger toward the tail.
            const tailward = float(1).sub(kq.x).mul(0.5).saturate()
                .toVar();
            const ky = kq.y.sub(sin(u.time.mul(4.2).sub(kq.x.mul(2.6))).mul(0.12).mul(tailward.mul(tailward))).toVar();
            const along = kq.x.mul(0.5).add(0.5).toVar();
            const halfW = sin(along.saturate().pow(0.75).mul(Math.PI)).max(0).pow(0.8).mul(0.2)
                .toVar();
            const blur = planePx.div(KOI_LENGTH * 0.5).max(0.12).toVar();
            const body = fadeOut(halfW.sub(blur), halfW.add(blur), ky.abs()).mul(smoothstep(-1.02, -0.9, kq.x))
                .mul(fadeOut(0.96, 1.04, kq.x));
            // The tail fin fans out behind it; two small pectoral fins near the head.
            const finT = float(-0.92).sub(kq.x).div(0.45).toVar();
            const fin = fadeOut(finT.mul(0.24).add(0.02), finT.mul(0.24).add(0.02).add(blur), ky.abs())
                .mul(smoothstep(-0.05, 0.1, finT)).mul(fadeOut(0.85, 1.05, finT));
            const pecs = fadeOut(0.06, float(0.06).add(blur), vec2(kq.x.sub(0.35), ky.abs().sub(0.26)).length());
            const koiMask = max(body, max(fin.mul(0.7), pecs.mul(0.6))).toVar();
            const patch = smoothstep(0.48, 0.58, gnoise(kq.mul(vec2(1.7, 3.2)).add(koi.z.mul(37)))).toVar();
            const albedo = mix(vec3(0.86, 0.84, 0.78), vec3(0.95, 0.34, 0.07), patch);
            const kr = koiAt.sub(vec2(0, 1)).length();
            const koiLight = pal.ambient.add(WARM.mul(glow).mul(exp(kr.mul(kr).mul(-1.6)).mul(0.5).add(0.04)));
            // Seen through the water: dimmer, cooler, the surface's sheen over it.
            const seen = albedo.mul(koiLight).mul(0.55).add(DEEP);
            pond.assign(mix(pond, pond.mul(0.45).add(seen), koiMask.mul(koiShow).mul(0.8)));
            // A faint wake on the surface just behind it.
            const wakeR = vec2(kq.x.add(1.4), ky).length().toVar();
            const wakeRing = sin(wakeR.mul(9).sub(u.time.mul(3))).mul(exp(wakeR.mul(wakeR).mul(-1.2)))
                .mul(smoothstep(0.2, 0.6, wakeR)).mul(smoothstep(2.0, 4.0, unitPx.mul(KOI_LENGTH * 0.25)));
            pond.mulAssign(wakeRing.mul(koiShow).mul(0.25).add(1));
        });

        // ---- Lily pads, shaded once in the covering pad's own coordinates. ----
        const pads = padField(plane, planePx);
        pond.mulAssign(float(1).sub(pads.meniscus.mul(0.75)));
        const local = pads.local.toVar();
        const seed = pads.seed.toVar();
        const pd = local.length().toVar();
        const padAngle = local.y.atan(local.x).toVar();
        // Fine detail fades with the pad's size on screen.
        const padDetail = smoothstep(1.5, 4.0, unitPx.mul(0.05)).toVar();
        // Veins: sin of an integer multiple of the angle is seamless across atan's ±π jump. They fork
        // toward the rim.
        const veins = fadeOut(0.0, 0.12, sin(padAngle.mul(9)).abs()).mul(smoothstep(0.08, 0.35, pd)).mul(fadeOut(0.72, 0.95, pd))
            .add(fadeOut(0.0, 0.1, sin(padAngle.mul(18).add(0.4)).abs()).mul(smoothstep(0.5, 0.72, pd)).mul(fadeOut(0.82, 0.95, pd))
                .mul(0.6))
            .mul(padDetail)
            .toVar();
        const blotch = fbm(local.mul(1.3).add(seed.mul(7.3)), 3).toVar();
        const speck = gnoise(local.mul(7.0).add(seed.mul(2.1)));
        // The leaf is never flat: faint concentric undulations around its centre.
        const undulate = sin(pd.mul(15).add(blotch.mul(5))).mul(0.5).add(0.5).mul(padDetail);
        const hue = mix(PAD_GREEN, PAD_TEAL, seed.mul(0.37).fract());
        const leaf = mix(hue, PAD_YOUNG, pads.young).mul(blotch.mul(1.0).add(0.4)).mul(speck.mul(0.3).add(0.85))
            .mul(undulate.mul(0.25).add(0.88))
            .toVar();
        leaf.mulAssign(veins.mul(0.3).add(1));
        // The rim curls up a little; along one side of each leaf the wine-red underside shows.
        const rim = smoothstep(0.88, 0.985, pd).toVar();
        const curl = smoothstep(0.82, 0.97, pd).mul(smoothstep(0.5, 0.95, sin(padAngle.add(seed.mul(2.4))).mul(0.5).add(0.5)));
        leaf.assign(mix(leaf, PAD_RIM, max(rim.mul(0.5), curl.mul(0.85))));
        const padLit = leaf.mul(glow.mul(padWarm).mul(2.4).add(0.7)).toVar();
        // Wax and water: the sky and the lanterns on the leaf, stronger at grazing angles, patchy
        // where water beads; the curled rim catches the most.
        const wet = smoothstep(0.42, 0.78, gnoise(local.mul(3.5).add(seed.mul(3.1)))).mul(0.6).add(rim.mul(0.6)).add(0.12)
            .toVar();
        padLit.addAssign(sky.mul(mirror).mul(wet).mul(sheen).mul(0.55));
        padLit.addAssign(lanterns.mul(mirror).mul(glints).mul(wet).mul(0.2));
        padLit.addAssign(mix(ROSE, GOLD, 0.5).mul(imageGlow.add(padWarm.mul(0.2))).mul(glow).mul(wet)
            .mul(0.12));
        // Beads of water resting on the leaf, each catching a point of light.
        const beadCell = local.mul(4).add(seed.mul(13)).toVar();
        const beadAt = beadCell.fract().sub(0.5).sub(hash22(beadCell.floor()).sub(0.5).mul(0.5));
        const bead = step(0.96, hash21(beadCell.floor().add(5.7))).mul(fadeOut(0.03, 0.09, beadAt.length()))
            .mul(fadeOut(0.75, 0.85, pd)).mul(padDetail);
        padLit.addAssign(WARM.mul(padWarm).mul(glow).mul(0.25).add(HAZE.mul(1.5))
            .mul(bead));
        pond.assign(mix(pond, padLit, pads.cover));

        // ---- Now and then a petal falls on the water: it lands, floats, and sends out a ring. ----
        const drop = eventWindow(u.time, float(19), float(8), float(0.8), u.seed.mul(41.3).add(2.1)).toVar();
        const dropShow = drop.x.mul(u.life).toVar();
        If(dropShow.greaterThan(0.001), () => {
            const dropAt = vec2(
                mix(float(-1.3), float(1.3), hash21(vec2(drop.z, 3.7))),
                mix(float(0.7), float(1.9), hash21(vec2(drop.z, 8.1))),
            ).toVar();
            const dRel = plane.sub(dropAt).toVar();
            const dr = dRel.length().toVar();
            const df = dr.sub(drop.y.mul(0.95).add(0.03)).toVar();
            const dWave = sin(df.mul(TAU / 0.1)).mul(exp(df.mul(df).mul(-180))).toVar();
            const dFade = dropShow.mul(exp(dr.mul(-1.6))).mul(smoothstep(2.0, 4.0, unitPx.mul(0.1))).mul(water)
                .toVar();
            const dCrest = dWave.max(0).mul(dWave.max(0)).mul(dFade);
            const dLight = HAZE.mul(2.5).add(MIST.mul(0.8)).add(WARM.mul(glow).mul(padWarm).mul(0.12));
            pond.assign(pond.mul(dWave.mul(dFade).mul(0.5).add(1)).add(dLight.mul(dCrest)));
            // The petal itself, afloat where it fell, turning slowly.
            const pTurn = drop.z.mul(TAU).add(drop.y).toVar();
            const pc = cos(pTurn).toVar();
            const ps = sin(pTurn).toVar();
            const pq = vec2(dRel.x.mul(pc).add(dRel.y.mul(ps)), dRel.y.mul(pc).sub(dRel.x.mul(ps)))
                .div(vec2(0.055, 0.024))
                .toVar();
            const petalSoft = planePx.div(0.024).max(0.15);
            const petal = fadeOut(float(1).sub(petalSoft), float(1).add(petalSoft), pq.length()).mul(dropShow);
            const petalLight = pal.ambient.add(WARM.mul(glow).mul(padWarm).mul(0.7)).add(HAZE.mul(1.5));
            pond.assign(mix(pond, vec3(...look.petal).mul(petalLight).mul(pq.x.mul(0.25).add(0.85)), petal.mul(water)));
        });

        // ---- Closed buds standing in the water beside the pads, each with its image below it. ----
        BUDS.forEach(([x, z, height, lean]) => {
            const bq = layer(p, u, 1 / z).toVar();
            const foot = vec2(x / z, horizon.sub(slope.div(z)));
            const bud = bq.sub(foot).div(height / z).toVar();
            // Above the water the bud itself; below, the same shape mirrored, dim and broken by the swell.
            const up = bud.y.abs().toVar();
            const inAir = smoothstep(-0.02, 0.02, bud.y).toVar();
            const across = bud.x.sub(up.mul(up).mul(lean)).toVar();
            const half = sin(up.min(1).pow(0.8).mul(Math.PI)).max(0).pow(0.85).mul(0.3)
                .toVar();
            const shape = fadeOut(half.sub(0.03), half.add(0.03), across.abs()).mul(fadeOut(0.97, 1.0, up)).toVar();
            const budPetals = mix(vec3(0.42, 0.03, 0.17), vec3(0.95, 0.55, 0.66), smoothstep(0.15, 0.95, up))
                .mul(float(1).sub(across.abs().div(half.max(0.02)).mul(0.55))).mul(glow.mul(0.05).add(0.1));
            // Sepals: a green cup at the foot.
            const tone = mix(budPetals, vec3(0.006, 0.018, 0.008), fadeOut(0.16, 0.3, up).mul(0.85)).toVar();
            pond.assign(mix(pond, tone, shape.mul(inAir)));
            pond.addAssign(tone.mul(shape).mul(float(1).sub(inAir)).mul(brokenImage).mul(0.35));
        });

        if (floaterAt) {
            // ---- Paper lanterns afloat: each a warm glowing box on the water, its light pooled round
            // it and its image drawn down into the pond. ----
            Loop(FLOATERS.length, ({ i }) => {
                const fl = floaterAt.element(i).toVar();
                const fx = fl.x.add(sin(u.time.mul(0.05).add(fl.w)).mul(0.12)).toVar();
                const fz = fl.y;
                const fq = layer(p, u, float(1).div(fz)).toVar();
                const size = fl.z.mul(0.11).div(fz).toVar();
                const bob = sin(u.time.mul(0.7).add(fl.w.mul(3))).mul(0.04);
                const ffoot = vec2(fx.div(fz), horizon.sub(slope.div(fz)));
                const lq = fq.sub(ffoot).div(size).sub(vec2(0, bob)).toVar();
                const ly = lq.y.abs().toVar();
                const inAir = smoothstep(-0.03, 0.03, lq.y).toVar();
                // A paper box a little taller than wide, its corners softened; a dark cap and base.
                const box = fadeOut(0.5, 0.62, lq.x.abs()).mul(fadeOut(1.0, 1.1, ly)).toVar();
                // Paper glowing from the candle inside, brightest low in the middle; a dark wooden cap
                // and base, and faint ribs.
                const ribs = sin(lq.x.mul(Math.PI * 4)).abs().mul(0.15).add(0.85);
                const frame = smoothstep(0.84, 0.9, ly).add(fadeOut(0.08, 0.14, ly)).saturate();
                const paper = vec3(1.0, 0.6, 0.26).mul(exp(lq.x.mul(lq.x).mul(-3)).mul(1.4).add(0.5))
                    .mul(exp(ly.sub(0.4).mul(ly.sub(0.4)).mul(-2.5)).mul(0.8).add(0.4))
                    .mul(ribs)
                    .mul(float(1).sub(frame.mul(0.85)))
                    .mul(sin(u.time.mul(0.9).add(fl.w.mul(5))).mul(0.06).add(1.1));
                const halo = exp(vec2(lq.x, ly.sub(0.5)).length().pow(2).mul(-0.5)).mul(0.05);
                pond.assign(mix(pond, paper, box.mul(inAir)));
                pond.addAssign(paper.mul(box).mul(float(1).sub(inAir)).mul(brokenImage).mul(0.4));
                pond.addAssign(vec3(1.0, 0.6, 0.3).mul(halo));
                // The pool of light on the water round it.
                const pool = plane.sub(vec2(fx, fz)).toVar();
                pond.addAssign(vec3(1.0, 0.55, 0.25).mul(exp(dot(pool, pool).mul(-30))).mul(0.06).mul(water));
            });
        }

        // ---- Mist lies on the water: slow wisps in plane space, stretched along the surface, a haze
        // thickening toward the far shore, lit warm by the flower near it. ----
        const wispAt = vec3(plane.x.mul(0.38).add(u.time.mul(0.02)).add(u.seed.mul(13.7)), depth.min(10).mul(1.5), u.time.mul(0.03));
        const wisps = fbm3(wispAt, mistOctaves).toVar();
        const lying = smoothstep(0.4, 0.76, wisps).mul(exp(depth.mul(-0.1)).mul(0.5).add(0.5)).toVar();
        const distance = smoothstep(1.5, 10.0, depth);
        const mistAmount = lying.mul(0.7).add(distance.mul(0.3)).mul(water).mul(look.mistAmount)
            .toVar();
        const warmMist = exp(r.mul(r).mul(-0.7)).toVar();
        const mistLight = MIST.add(mix(ROSE, GOLD, 0.35).mul(warmMist).mul(glow).mul(0.16));
        const col = mix(skyColor, pond, water).toVar();
        col.assign(col.mul(float(1).sub(mistAmount.mul(0.2).min(0.5))).add(mistLight.mul(mistAmount).mul(0.5)));
        // A band of haze sits on the horizon on both sides of it, thicker in some places than others.
        const band = exp(p.y.sub(horizon).mul(p.y.sub(horizon)).mul(-120 / Math.max(1, look.mistAmount)));
        const banks = gnoise(vec2(p.x.mul(1.3).add(u.time.mul(0.006)).add(u.seed.mul(7.7)), 5.3));
        col.addAssign(MIST.mul(band).mul(banks.mul(0.9).add(0.05)).mul(Math.min(look.mistAmount, 1.5)));

        // The flower's glow in the air around it (bloom adds more on tiers that have it).
        const air = dot(toHeart, toHeart).toVar();
        col.addAssign(mix(ROSE, GOLD, 0.5).mul(exp(air.mul(-9)).mul(0.04).add(exp(air.mul(-1.8)).mul(0.012))).mul(glow));

        // ---- Reeds at the frame's edges, close to the lens and out of focus, rimmed by the flower. ----
        const bottom = u.ext.y.negate().sub(u.focus).sub(0.1);
        const reeds = float(0).toVar();
        const reedRim = float(0).toVar();
        const reedSky = float(0).toVar();
        Loop(REEDS.length, ({ i }) => {
            const shape = reedShape.element(i).toVar();
            const rl = reedLook.element(i).toVar();
            const side = shape.x;
            const k = rl.y;
            const q = layer(p, u, k).toVar();
            const foot = vec2(u.ext.x.sub(shape.y).mul(side), bottom).toVar();
            const lean = sin(u.time.mul(0.35).add(rl.w)).mul(side.mul(0.012)).add(shape.w).toVar();
            const blade = reedBlade(q, foot, shape.z, lean, rl.x, k.mul(0.005));
            reeds.assign(max(reeds, blade.mask));
            // The edge toward the flower catches its light; the other edge, the sky's.
            reedRim.assign(max(reedRim, blade.mask.mul(smoothstep(0.1, 0.9, blade.edge.mul(side.negate())))));
            reedSky.assign(max(reedSky, blade.mask.mul(smoothstep(0.3, 0.95, blade.edge.mul(side)))));
            // A seed head (cattail) part way up some of the stems.
            const head = rl.z;
            const centre = vec2(foot.x.add(lean.mul(head.mul(head))), foot.y.add(shape.z.mul(head)));
            const hd = q.sub(centre).div(vec2(0.026, 0.08)).length();
            reeds.assign(max(reeds, fadeOut(0.85, k.mul(0.08).add(1.0), hd).mul(step(0.01, head))));
        });
        const reedTone = vec3(...look.reed).add(WARM.mul(reedRim).mul(glow).mul(0.05))
            .add(HAZE.mul(reedSky).mul(1.2));
        col.assign(mix(col, reedTone, reeds.mul(0.98)));

        // The whole scene warms a little with the in-breath.
        return col.mul(u.breathSoft.mul(0.08).add(0.95));
    })();

    const veil = mistVeil(u, light, pal, look.mistAmount);
    // A soft glory from the heart: only its hottest light streams, through the gaps between petals.
    const shafts = {
        source: [0, WATERLINE, 1],
        radius: 0.28,
        strength: 0.55,
        threshold: 1.15,
        decay: 0.95,
        length: 0.55,
        tint: look.shaftTint,
        breath: 0.85,
    };
    const [glowRest, glowSwing] = look.glow;
    return {
        backdrop,
        objects: [...lotus.objects, veil],
        motes: look.motes,
        shafts,
        bloom: look.bloom,
        grade: look.grade,
        camera: { dolly: 0.04, drift: [0.03, 0.012], period: 60 },
        exposure: look.exposure,
        update({
            time, breath, breathSoft, ext,
        }) {
            const slope = lookDown(ext.y);
            // The flower tilts toward us as far as the pond is foreshortened at its foot.
            const elevation = Math.asin(Math.min(slope, 0.95));
            lotus.update({
                time, breath, glow: glowRest + breathSoft * glowSwing, elevation,
            });
            lotus.heartOnScreen(u.focus.value, CAMERA_DISTANCE);
            shafts.source[0] = light.screen.value.x;
            shafts.source[1] = light.screen.value.y;
        },
        dispose() {
            lotus.dispose();
        },
    };
}
