/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sacred Geometry — a temple of light. Box breathing: four equal sides.
 *
 * A gate of four light-beams stands on a black obsidian floor in a violet void. Inside it floats
 * the crystal: a dodecahedron, an icosahedron and a star tetrahedron of glowing edges and faint
 * iridescent glass, around one white-gold core whose light radiates through the haze. Light
 * walks the gate one side per count of four — up the left side on the in-breath, across the top
 * in the full hold, down the right side on the out-breath, back along the floor in the empty
 * hold — a comet head with a fading trail, the sides it has walked still glowing.
 *
 * Inhale: the crystal unfolds and brightens and the breath's light spreads outward through the
 * mandala inscribed in the floor. Full hold: suspended, turning slowly, light shimmers along its
 * edges. Exhale: it folds back and dims. Empty hold: rest.
 *
 * Depth, far to near: stars; a nebulous haze with a faint rose window of circles; the horizon
 * where the floor melts into the haze; the floor in perspective (its mandala foreshortened,
 * its polish mirroring the haze, the gate and the crystal — real mirrored meshes, see
 * sacred-solids.js); the gate and the crystal on the hero plane; golden dust, some of it close
 * to the lens and out of focus. The post pipeline's light shafts stream from the core.
 *
 * Layout: the gate must stay clear of the guide's title (the top ~15% of the screen) and of its
 * phase word (from ~70% down), or the light would run behind the text. On a landscape screen
 * that leaves y ≈ -0.52..0.56, so the gate is 0.52 there; tall screens have room for a larger one.
 *
 * Moods: the golden temple in its violet void (the poster); a moonstone temple of silver light in
 * a blue night where frost glitters down through the air and meteors cross; an emerald temple
 * where rose-gold light falls through green haze and petals drift down; and dawn, copper light
 * over a pale marble floor, the sky warming on one side and dust rising. Every mood keeps a low
 * bank of mist on the floor, and two rare events: now and then a constellation draws itself
 * star by star beside the gate (a hexagram) and fades, and a wave of light runs out along the
 * floor's inscription from the centre to the great circle.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, atan, cos, dot, exp, float, floor, fract, length, max, mix, select, sin, smoothstep, sqrt, step,
    uniform, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, fbm3, fresnel, gnoise, hash21, layer, shootingStar, starfield, turn,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION, MOTE_SHAPE } from '../stage/breath-motes.js';
import { REFERENCE_GATE, createSacredSolids } from './sacred-solids.js';
import { footprint, inscription, lineOf } from './sacred-floor.js';

/** The gate's centre (hero y) and its half-size on landscape and on tall screens. */
const GATE_CENTRE = 0.04;
const GATE_WIDE = 0.52;
const GATE_TALL = 0.72;
/** The square's sides in the order the light walks them: start corner (in gate units), direction. */
const SIDES = [[-1, -1, 0, 1], [-1, 1, 1, 0], [1, 1, 0, -1], [1, -1, -1, 0]];
/** Sparks: one chance per this much beam (hero units). */
const SPARK_CELL = 0.028;
const TAU = Math.PI * 2;

/**
 * The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's.
 * Light: gold (the beams' glow), whiteGold (their cores), white (the core, the comet); far: the
 * colour light takes far off in the haze (and the gate's haze); warm: the haze's second colour
 * near the core. Void: the air low and high, the floor stone, the nebula's two colours.
 */
export const MOODS = Object.freeze([
    {
        id: 'golden-temple',
        name: 'Golden Temple',
        gold: [1.0, 0.68, 0.3],
        whiteGold: [1.0, 0.9, 0.74],
        white: [1.0, 0.97, 0.92],
        far: [0.46, 0.28, 1.0],
        warm: [1.0, 0.46, 0.6],
        voidLow: [0.018, 0.007, 0.04],
        voidHigh: [0.0016, 0.0014, 0.0075],
        stone: [0.0026, 0.0018, 0.0062],
        haze: [[0.32, 0.15, 0.75], [0.85, 0.26, 0.52]],
        hazeGain: 0.17,
        stars: 0.55,
        mist: { colour: [0.62, 0.42, 1.0], gain: 0.05 },
        meteors: false,
        solids: {
            tints: [[0.66, 0.5, 1.0], [1.0, 0.72, 0.36], [1.0, 0.7, 0.8]],
            halos: [[0.42, 0.24, 1.0], [1.0, 0.52, 0.18], [1.0, 0.42, 0.6]],
            axis: [1.0, 0.9, 0.74],
            mirror: [0.62, 0.55, 1.0],
            film: [1.0, 0.72, 0.95],
        },
        inscription: { gold: [1.0, 0.7, 0.32], whiteGold: [1.0, 0.88, 0.66], amber: [1.0, 0.56, 0.22] },
        dust: { halo: [[1.0, 0.84, 0.52], [1.0, 0.64, 0.34]], air: [[1.0, 0.86, 0.56], [0.82, 0.64, 1.0]] },
        extraMotes: null,
        shaftTint: [1.0, 0.86, 0.64],
        grade: {
            shadows: [0.94, 0.88, 1.1], highlights: [1.06, 0.99, 0.88], saturation: 1.06, contrast: 1.05,
        },
    },
    {
        // Night: silver light in a deep blue void, frost glittering down, now and then a meteor.
        id: 'moonstone',
        name: 'Moonstone',
        gold: [0.62, 0.78, 1.0],
        whiteGold: [0.86, 0.92, 1.0],
        white: [0.95, 0.97, 1.0],
        far: [0.24, 0.4, 1.0],
        warm: [0.62, 0.56, 1.0],
        voidLow: [0.006, 0.011, 0.038],
        voidHigh: [0.0008, 0.0014, 0.0062],
        stone: [0.0016, 0.0022, 0.0062],
        haze: [[0.12, 0.24, 0.8], [0.5, 0.46, 0.95]],
        hazeGain: 0.15,
        stars: 1.0,
        mist: { colour: [0.55, 0.7, 1.0], gain: 0.085 },
        meteors: true,
        solids: {
            tints: [[0.5, 0.66, 1.0], [0.86, 0.93, 1.0], [0.78, 0.7, 1.0]],
            halos: [[0.24, 0.4, 1.0], [0.55, 0.72, 1.0], [0.55, 0.42, 1.0]],
            axis: [0.9, 0.95, 1.0],
            mirror: [0.55, 0.7, 1.0],
            film: [0.75, 0.88, 1.0],
        },
        inscription: { gold: [0.62, 0.78, 1.0], whiteGold: [0.85, 0.92, 1.0], amber: [0.45, 0.55, 1.0] },
        dust: { halo: [[0.82, 0.9, 1.0], [0.6, 0.74, 1.0]], air: [[0.85, 0.92, 1.0], [0.62, 0.62, 1.0]] },
        extraMotes: {
            // Frost: fine flakes of light sinking slowly through the temple's air.
            motion: MOTE_MOTION.fall,
            shape: MOTE_SHAPE.flake,
            count: 60,
            size: 0.03,
            speed: 0.32,
            spread: 1.05,
            depth: 2.4,
            bokeh: 0.14,
            spin: 0.22,
            flutter: 0.3,
            colorA: [0.8, 0.88, 1.0],
            colorB: [0.58, 0.7, 1.0],
            gain: 0.42,
        },
        shaftTint: [0.84, 0.92, 1.0],
        grade: {
            shadows: [0.9, 0.95, 1.12], highlights: [0.99, 1.0, 1.04], saturation: 1.04, contrast: 1.06,
        },
    },
    {
        // Rose-gold light in an emerald haze; rose petals drift down through the gate.
        id: 'emerald-rose',
        name: 'Emerald Rose',
        gold: [1.0, 0.58, 0.42],
        whiteGold: [1.0, 0.86, 0.76],
        white: [1.0, 0.96, 0.92],
        far: [0.1, 0.78, 0.52],
        warm: [1.0, 0.42, 0.44],
        voidLow: [0.004, 0.022, 0.018],
        voidHigh: [0.0006, 0.0024, 0.003],
        stone: [0.0012, 0.0036, 0.003],
        // Emerald wisps with dusky rose ones among them.
        haze: [[0.04, 0.5, 0.32], [0.6, 0.3, 0.32]],
        hazeGain: 0.15,
        stars: 0.45,
        mist: { colour: [0.36, 0.95, 0.7], gain: 0.06 },
        meteors: false,
        solids: {
            tints: [[0.4, 1.0, 0.72], [1.0, 0.66, 0.5], [1.0, 0.76, 0.8]],
            halos: [[0.08, 0.85, 0.5], [1.0, 0.45, 0.3], [1.0, 0.4, 0.5]],
            axis: [1.0, 0.9, 0.82],
            mirror: [0.5, 1.0, 0.78],
            film: [0.8, 1.0, 0.86],
        },
        inscription: { gold: [1.0, 0.62, 0.46], whiteGold: [1.0, 0.86, 0.74], amber: [0.3, 0.92, 0.6] },
        dust: { halo: [[1.0, 0.8, 0.66], [1.0, 0.56, 0.46]], air: [[1.0, 0.8, 0.7], [0.5, 1.0, 0.75]] },
        extraMotes: {
            // Rose petals, lit by the gate as they fall and turn over.
            motion: MOTE_MOTION.fall,
            shape: MOTE_SHAPE.petal,
            blend: 'alpha',
            count: 24,
            size: 0.05,
            speed: 0.28,
            spread: 1.0,
            depth: 2.4,
            // A petal blurred near the lens reads as a stain on the glass: keep them all in focus.
            bokeh: 0,
            spin: 0.45,
            tumble: 0.8,
            flutter: 1,
            colorA: [0.5, 0.1, 0.16],
            colorB: [0.86, 0.36, 0.38],
            gain: 0.85,
        },
        shaftTint: [1.0, 0.82, 0.72],
        grade: {
            shadows: [0.9, 1.06, 1.0], highlights: [1.06, 0.98, 0.94], saturation: 1.06, contrast: 1.05,
        },
    },
    {
        // Another hour: dawn breaking low on one side, copper light on a pale marble floor, a
        // morning mist lying on the stone and dust rising slowly through the light.
        id: 'alabaster-dawn',
        name: 'Alabaster Dawn',
        gold: [1.0, 0.5, 0.24],
        whiteGold: [1.0, 0.8, 0.6],
        white: [1.0, 0.95, 0.88],
        far: [0.75, 0.42, 0.6],
        warm: [1.0, 0.56, 0.42],
        voidLow: [0.05, 0.036, 0.075],
        voidHigh: [0.006, 0.011, 0.04],
        stone: [0.05, 0.042, 0.04],
        haze: [[0.62, 0.36, 0.5], [1.0, 0.6, 0.4]],
        hazeGain: 0.1,
        stars: 0.18,
        dawn: { glow: [0.26, 0.11, 0.06], sun: [0.55, 0.24, 0.09], x: -1.05 },
        marble: 0.5,
        mist: { colour: [1.0, 0.74, 0.6], gain: 0.1 },
        meteors: false,
        solids: {
            tints: [[1.0, 0.62, 0.44], [1.0, 0.78, 0.5], [1.0, 0.88, 0.8]],
            halos: [[0.95, 0.38, 0.24], [1.0, 0.5, 0.2], [1.0, 0.55, 0.45]],
            axis: [1.0, 0.92, 0.8],
            mirror: [1.0, 0.8, 0.72],
            film: [1.0, 0.86, 0.76],
        },
        inscription: { gold: [0.95, 0.46, 0.22], whiteGold: [1.0, 0.8, 0.6], amber: [0.85, 0.36, 0.2] },
        dust: { halo: [[1.0, 0.82, 0.6], [1.0, 0.6, 0.36]], air: [[1.0, 0.86, 0.68], [1.0, 0.7, 0.55]] },
        extraMotes: {
            // Dust rising slowly through the morning light.
            motion: MOTE_MOTION.rise,
            count: 60,
            size: 0.008,
            speed: 0.22,
            spread: 1,
            depth: 2.4,
            bokeh: 0.2,
            colorA: [1.0, 0.86, 0.66],
            colorB: [1.0, 0.68, 0.48],
            gain: 0.32,
        },
        shaftTint: [1.0, 0.8, 0.62],
        exposure: 0.95,
        grade: {
            shadows: [1.0, 0.95, 1.05], highlights: [1.04, 0.99, 0.92], saturation: 1.04, contrast: 1.04,
        },
    },
]);

/** A mood's colours as nodes (each world build makes its own). */
function paletteOf(mood) {
    const v = (rgb) => vec3(...rgb);
    return {
        GOLD: v(mood.gold),
        WHITE_GOLD: v(mood.whiteGold),
        WHITE: v(mood.white),
        VIOLET: v(mood.far),
        ROSE: v(mood.warm),
        VOID_LOW: v(mood.voidLow),
        VOID_HIGH: v(mood.voidHigh),
        OBSIDIAN: v(mood.stone),
        HAZE_A: v(mood.haze[0]),
        HAZE_B: v(mood.haze[1]),
        hazeGain: mood.hazeGain,
        DAWN: mood.dawn ? v(mood.dawn.glow) : null,
        SUNRISE: mood.dawn ? v(mood.dawn.sun) : null,
        dawnX: mood.dawn?.x ?? 0,
    };
}

/** x³ of a noise that may dip a hair below zero: pow() of a negative base is NaN. */
const cube = (x) => {
    const c = x.max(0).toVar();
    return c.mul(c).mul(c);
};

/** The gate's size and place for a screen of half extents `ext`. */
function layoutFor(ext, out) {
    const tall = THREE.MathUtils.smoothstep(ext.y, 1.0, 1.7);
    out.gate = GATE_WIDE + (GATE_TALL - GATE_WIDE) * tall;
    out.centre = GATE_CENTRE;
    out.floor = GATE_CENTRE - out.gate;
    out.scale = out.gate / REFERENCE_GATE;
    return out;
}

/** Where the light is on the square at `lap` (0..1 from the bottom-left corner, going up). */
function pathPoint(lap, { gate, centre }, out) {
    const along = (((lap % 1) + 1) % 1) * 4;
    const index = Math.min(3, Math.floor(along));
    const [x, y, dx, dy] = SIDES[index];
    const t = (along - index) * 2 * gate;
    return out.set(x * gate + dx * t, centre + y * gate + dy * t);
}

/**
 * How brightly the square burns at path position `s` (laps from the bottom-left corner) while
 * the light is at `head`: a hot trail just behind the light, the sides it has walked still
 * glowing and fading as it moves on, and a faint glow everywhere so the square always reads.
 * It depends only on how far the light has gone since passing `s`, so nothing snaps off when a
 * lap ends.
 */
function pathLight(s, head) {
    const lag = fract(head.sub(s)).toVar();
    const trail = exp(lag.mul(-15)).mul(smoothstep(0, 0.012, lag));
    return exp(lag.mul(-2.6)).mul(0.5).add(trail.mul(1.7)).add(0.12);
}

/**
 * pathLight for the light as it is, cross-faded from where it was if it jumped (a session
 * re-syncing the cycle, a skipped phase): the square's glow never snaps to a new pattern.
 */
const walked = (s, light) => mix(pathLight(s, light.head), pathLight(s, light.was), light.fading);

/**
 * The gate's beams at hero point `g`: on each side a white-hot core, a gold glow and a long
 * faint haze, lit by pathLight. `blur` widens the core and glow (the reflection's gloss) while
 * keeping their light. `gate`/`centre`: the square's half-size and centre. Returns linear RGB.
 */
function gateBeams(g, light, u, blur, { gate, centre, P }) {
    const { GOLD, WHITE_GOLD, VIOLET } = P;
    const coreW2 = u.px.mul(u.px).mul(1.4).add(blur.add(0.0034).mul(blur.add(0.0034))).toVar();
    const glowW2 = blur.mul(2).add(0.017).mul(blur.mul(2).add(0.017)).toVar();
    const hazeW2 = blur.mul(3).add(0.075).mul(blur.mul(3).add(0.075)).toVar();
    const side = gate.mul(2).toVar();
    const local = g.sub(vec2(0, centre)).toVar();
    const coreI = float(0).toVar();
    const glowI = float(0).toVar();
    const hazeI = float(0).toVar();
    const joints = float(0).toVar();
    const sparks = float(0).toVar();
    SIDES.forEach(([x, y, dx, dy], index) => {
        const rel = local.sub(vec2(x, y).mul(gate)).toVar();
        const reach = rel.x.mul(dx).add(rel.y.mul(dy)).toVar();
        const along = reach.clamp(0, side).toVar();
        const off = rel.sub(vec2(dx, dy).mul(along));
        const d2 = dot(off, off).toVar();
        const lit = walked(along.div(side).add(index).div(4), light).toVar();
        coreI.assign(max(coreI, exp(d2.div(coreW2).negate()).mul(lit)));
        glowI.assign(max(glowI, exp(d2.div(glowW2).negate()).mul(lit)));
        hazeI.assign(max(hazeI, lit.div(d2.div(hazeW2).add(1))));
        // Corners: the gate's joints, a little brighter than the beams they join.
        joints.addAssign(exp(dot(rel, rel).div(glowW2.mul(0.5)).negate()).mul(walked(float(index / 4), light)));
        // Sparks: every short stretch of beam the light has just crossed may throw one, which
        // drifts off the beam to one side and fades within about a second.
        const cell = floor(along.min(side.sub(0.001)).div(SPARK_CELL)).toVar();
        const pick = hash21(vec2(cell, index * 17 + 3)).toVar();
        const lean = hash21(vec2(cell, index * 17 + 9)).toVar();
        const sparkAlong = cell.add(pick.mul(0.6).add(0.2)).mul(SPARK_CELL);
        const since = fract(light.head.sub(sparkAlong.div(side).add(index).div(4))).toVar();
        const drift = since.mul(lean.mul(0.45).add(0.1)).add(0.004).mul(step(0.5, lean).mul(2).sub(1));
        const across = rel.x.mul(-dy).add(rel.y.mul(dx));
        const ds = vec2(reach.sub(sparkAlong), across.sub(drift));
        sparks.addAssign(exp(dot(ds, ds).div(blur.add(0.005).mul(blur.add(0.005))).negate())
            .mul(exp(since.mul(-18))).mul(smoothstep(0.0, 0.006, since)).mul(step(0.5, pick)));
    });
    // A blurred core keeps its light: it spreads, so it dims.
    const spread = sqrt(float(0.0034 * 0.0034).div(coreW2.sub(u.px.mul(u.px).mul(1.4)).max(1e-6))).min(1);
    return WHITE_GOLD.mul(coreI.mul(spread).mul(2.4).add(joints.mul(0.9)).add(sparks.mul(spread).mul(4)))
        .add(GOLD.mul(glowI).mul(0.5))
        .add(mix(GOLD, VIOLET, 0.45).mul(hazeI).mul(0.07));
}

/** The travelling light itself: a white-hot head, its glow, and a faint four-point glint. */
function cometHead(g, point, { GOLD, WHITE_GOLD, WHITE }) {
    const to = g.sub(point).toVar();
    const h2 = dot(to, to).toVar();
    const x2 = to.x.mul(to.x);
    const y2 = to.y.mul(to.y);
    const glint = exp(y2.div(0.0032 ** 2).negate()).div(x2.div(0.11 ** 2).add(1))
        .add(exp(x2.div(0.0032 ** 2).negate()).div(y2.div(0.06 ** 2).add(1)).mul(0.45));
    return WHITE.mul(exp(h2.div(0.011 ** 2).negate()).mul(5.5))
        .add(WHITE_GOLD.mul(exp(h2.div(0.034 ** 2).negate()).mul(1.3)))
        .add(GOLD.mul(float(0.24).div(h2.div(0.1 ** 2).add(1))))
        .add(WHITE_GOLD.mul(glint).mul(0.4));
}

/** The travelling light, cross-faded from where it was if it jumped. */
const travellingLight = (g, light, P) => cometHead(g, light.point, P).mul(light.fading.oneMinus())
    .add(cometHead(g, light.wasPoint, P).mul(light.fading));

/**
 * The void at sky point `s`: indigo overhead, deep violet low, a slow nebulous haze in wisps and
 * dark lanes, and the horizon's glow. `lit` is how much of the crystal's light reaches this
 * part of the haze (1 beside the core, a small floor far away). The visit's seed moves the haze.
 */
function voidAt(s, u, {
    horizon, top, glow, octaves, lit, P, blurred = false,
}) {
    const {
        VOID_LOW, VOID_HIGH, VIOLET, ROSE, GOLD, HAZE_A, HAZE_B,
    } = P;
    const height = smoothstep(horizon.sub(0.15), top.add(0.25), s.y);
    const col = mix(VOID_LOW, VOID_HIGH, height).toVar();
    const drift = u.time.mul(0.008);
    // A little domain warp turns blobs into wisps (the floor's soft mirror needs none of it).
    const q = blurred ? s : s.add(vec2(
        gnoise(s.mul(0.85).add(vec2(drift, 3.1))),
        gnoise(s.mul(0.85).add(vec2(7.7, drift.negate()))),
    ).sub(0.5).mul(0.9)).toVar();
    const neb = fbm3(vec3(q.x.mul(0.8).add(drift), q.y.mul(1.15), u.time.mul(0.012).add(u.seed.mul(6.1))), octaves)
        .toVar();
    const dense = smoothstep(0.42, 0.8, neb).toVar();
    const lanes = blurred ? float(0.6)
        : smoothstep(0.3, 0.62, gnoise(q.mul(1.7).add(vec2(11.3, 4.4)))).mul(0.75).add(0.25);
    const tone = gnoise(q.mul(0.7).add(vec2(4.2, 1.3)));
    const hazeColour = mix(HAZE_A, HAZE_B, tone.mul(1.8).sub(0.55).saturate());
    const low = exp(s.y.sub(horizon).max(0).mul(-1.1));
    col.addAssign(hazeColour.mul(dense.mul(lanes)).mul(low.mul(0.4).add(0.6)).mul(lit.mul(lit)).mul(P.hazeGain)
        .mul(glow.mul(0.3).add(0.85)));
    // Light pooled in the low haze where the floor meets the void, strongest under the core.
    const above = s.y.sub(horizon).toVar();
    const centred = float(1).div(s.x.mul(s.x).mul(1.6).add(1)).toVar();
    const band = exp(above.mul(above).mul(-60)).mul(centred.mul(0.85).add(0.15));
    col.addAssign(mix(VIOLET, mix(ROSE, GOLD, 0.5), centred.mul(0.55)).mul(band).mul(0.035).mul(glow));
    if (P.DAWN) {
        // Dawn: a warm band along the horizon, brightest on the side where the sun will rise.
        const rise = above.max(0).toVar();
        const sunSide = float(1).div(s.x.sub(P.dawnX).pow2().mul(1.4).add(1)).toVar();
        col.addAssign(P.DAWN.mul(exp(rise.mul(-3.2))).mul(sunSide.mul(0.6).add(0.4)));
        col.addAssign(P.SUNRISE.mul(exp(rise.mul(-9))).mul(sunSide.mul(sunSide)));
    }
    return col;
}

/** The core's light in the air at squared distance `c2`: violet far, rose, gold near. */
const auraAt = (c2, glow, { VIOLET, ROSE, GOLD }) => VIOLET.mul(0.05).div(c2.mul(3.5).add(1))
    .add(ROSE.mul(0.022).div(c2.mul(8).add(1)))
    .add(GOLD.mul(0.06).mul(glow).div(c2.mul(16).add(1)));

/** The white-gold core itself: it swells and brightens with the breath. */
const coreAt = (c2, u, glow, { WHITE, WHITE_GOLD }) => WHITE
    .mul(exp(c2.div(u.breathSoft.mul(0.0006).add(0.00035)).negate()))
    .mul(u.breathSoft.mul(2.4).add(1.4))
    .add(WHITE_GOLD.mul(exp(c2.div(0.0065).negate())).mul(0.4).mul(glow));

/**
 * A rare event: a constellation draws itself in the sky beside the gate (above it on a tall
 * screen) — a hexagram, star by star, each line drawn from the star before — holds a while and
 * fades. Some fifteen seconds in all, about one visit in every minute or so. Returns linear RGB.
 */
function constellation(p, u, P, gate, centre) {
    const ev = eventWindow(u.time, float(47), float(15), float(0.7), u.seed.mul(31.7).add(4.2)).toVar();
    const light = vec3(0).toVar();
    If(ev.x.mul(u.life).greaterThan(0.002), () => {
        const tall = smoothstep(1.0, 1.7, u.ext.y);
        const h1 = hash21(vec2(ev.z, 5.1)).toVar();
        const h2 = hash21(vec2(ev.z, 6.3)).toVar();
        const side = step(0.5, hash21(vec2(ev.z, 3.7))).mul(2).sub(1);
        const at = vec2(
            side.mul(mix(gate.add(mix(0.42, 0.78, h1)), mix(float(0.3), float(0.58), h1), tall)),
            mix(centre.add(mix(0.16, 0.4, h2)), centre.add(gate).add(mix(0.3, 0.4, h2)), tall),
        );
        const radius = mix(float(0.12), float(0.16), hash21(vec2(ev.z, 8.8))).toVar();
        const spin = hash21(vec2(ev.z, 9.9)).mul(TAU).add(u.time.mul(0.008)).toVar();
        // Drift with the far sky as the camera breathes.
        const q = layer(p, u, 0.3).sub(at).toVar();
        // Drawn over the first ~40% of the event, then held, then faded by the envelope.
        const drawn = ev.y.mul(2.5).saturate().mul(6).toVar();
        const w2 = u.px.mul(u.px).mul(1.8).toVar();
        const lines = float(0).toVar();
        const stars = float(0).toVar();
        Loop(6, ({ i }) => {
            const k = float(i);
            // Corners 0 2 4 make one triangle, 1 3 5 the other.
            const corner = select(k.lessThan(3), k.mul(2), k.mul(2).sub(5));
            const a0 = corner.mul(Math.PI / 3).add(spin);
            const from = vec2(cos(a0), sin(a0)).mul(radius).toVar();
            const to = vec2(cos(a0.add(TAU / 3)), sin(a0.add(TAU / 3))).mul(radius);
            const f = drawn.sub(k).saturate().toVar();
            const ab = to.sub(from).mul(f).toVar();
            const rel = q.sub(from).toVar();
            const t = dot(rel, ab).div(dot(ab, ab).max(1e-7)).saturate();
            const off = rel.sub(ab.mul(t));
            const d2 = dot(off, off).toVar();
            lines.addAssign(exp(d2.div(w2).negate()).add(float(0.12).div(d2.div(0.00003).add(1))).mul(step(1e-4, f)));
            // A star wakes as its line sets out from it, with a slow twinkle.
            const r2 = dot(rel, rel);
            const twinkle = sin(u.time.mul(1.3).add(k.mul(2.1))).mul(0.2).add(0.8);
            stars.addAssign(exp(r2.div(w2.mul(4)).negate()).mul(2.2).add(float(0.25).div(r2.div(0.00012).add(1)))
                .mul(smoothstep(0, 0.25, drawn.sub(k).add(0.05)))
                .mul(twinkle));
        });
        light.assign(P.WHITE_GOLD.mul(lines.mul(0.45)).add(P.WHITE.mul(stars)).mul(ev.x).mul(u.life));
    });
    return light;
}

/**
 * A low bank of mist lying on the floor: thickest along the horizon, where the eye looks
 * through the most of it, thinning toward the viewer and lifting a little into the void. It
 * drifts slowly sideways and is lit by the crystal above it.
 */
function floorMist(p, hero, u, horizon, mood, glow, coreX, octaves) {
    const mq = layer(p, u, 0.45).toVar();
    const dy = p.y.sub(horizon).toVar();
    const bank = exp(dy.max(0).div(0.075).pow2().negate()).mul(exp(dy.min(0).div(0.26).pow2().negate()));
    const wisp = fbm3(vec3(
        mq.x.mul(1.3).add(u.time.mul(0.03)).add(u.seed.mul(17)),
        dy.mul(6.5).sub(u.time.mul(0.01)),
        u.time.mul(0.02),
    ), octaves);
    const density = smoothstep(0.34, 0.78, wisp).mul(bank).toVar();
    const dx = hero.x.sub(coreX);
    const lit = float(0.75).div(dx.mul(dx).mul(1.6).add(1)).add(0.25);
    return vec3(...mood.mist.colour).mul(density).mul(lit).mul(glow.mul(0.4).add(0.7))
        .mul(mood.mist.gain);
}

/**
 * A rose window far behind the gate: great circles holding a ring of twelve interlaced circles,
 * in faint light, turning very slowly the other way from the floor's mandala. The haze drifts
 * across it, so it shows in places and dissolves in others. Its pixels face the lens: a pixel
 * is `u.px` across.
 */
function roseWindow(w, u, octaves, { VIOLET, GOLD }) {
    const q = turn(w, u.time.mul(-0.004)).toVar();
    const r = length(q).toVar();
    const fp = u.px.mul(1.3).toVar();
    const rings = [[1.05, 0.8], [1.12, 0.5], [1.95, 0.8], [2.02, 0.5], [2.75, 0.6]]
        .reduce((sum, [radius, gain]) => sum.add(lineOf(r.sub(radius).abs(), fp, 0.0022).mul(gain)), float(0));
    // The tracery: only the two circles either side of a point's angle can reach it.
    // atan(0, 0) is undefined in GLSL: never ask for it.
    const phi = atan(q.y, q.x.add(1e-6)).toVar();
    const step12 = (Math.PI * 2) / 12;
    const slot = floor(phi.div(step12)).toVar();
    const tracery = [0, 1].reduce((most, k) => {
        const angle = slot.add(k).mul(step12);
        const offset = q.sub(vec2(angle.cos(), angle.sin()).mul(1.53));
        return max(most, lineOf(length(offset).sub(0.45).abs(), fp, 0.0018));
    }, float(0));
    // The haze veils it: it shows through in some places and is lost in others.
    const veil = smoothstep(0.32, 0.68, fbm(q.mul(0.55).add(vec2(u.time.mul(0.006), 2.4)), octaves)).mul(0.8).add(0.2);
    return mix(VIOLET, GOLD, 0.4).mul(rings.add(tracery.mul(0.75))).mul(veil);
}

export function createSacredWorld({ u, quality, mood = MOODS[0] }) {
    const { octaves, detail } = quality;
    const P = paletteOf(mood);
    const { WHITE_GOLD, GOLD, VIOLET } = P;
    /** The light's position around the square in laps (0..1), its point, and the hold's depth. */
    const light = {
        head: uniform(0),
        point: uniform(new THREE.Vector2(-GATE_WIDE, GATE_CENTRE - GATE_WIDE)),
        // Where the light was before a jump, and how much of that is still showing (1 → 0).
        was: uniform(0),
        wasPoint: uniform(new THREE.Vector2(-GATE_WIDE, GATE_CENTRE - GATE_WIDE)),
        fading: uniform(0),
    };
    const hold = uniform(0);
    /** The layout (see layoutFor) and the core's height: the crystal bobs, the painted core follows. */
    const gate = uniform(GATE_WIDE);
    const centre = uniform(GATE_CENTRE);
    const floorY = uniform(GATE_CENTRE - GATE_WIDE);
    const coreY = uniform(GATE_CENTRE);
    const solids = createSacredSolids(u, { hold, floorY, colors: mood.solids });
    const frame = { gate, centre, P };

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const glow = u.breathSoft.mul(0.8).add(0.4).toVar();
        const top = u.ext.y.sub(u.focus).toVar();
        // The painted camera: eye height above the floor, and the gate's depth (tall screens look
        // a little more steeply down on more floor).
        const tall = u.ext.y.sub(1).max(0).toVar();
        const eye = mix(float(0.21), float(0.27), smoothstep(1.0, 1.7, u.ext.y)).toVar();
        const horizon = floorY.add(eye).toVar();
        const focal = tall.mul(0.3).add(0.75).toVar();
        // Floor features are drawn for the reference gate and scale with the layout.
        const scale = gate.div(REFERENCE_GATE).toVar();
        const look = {
            horizon, top, glow, octaves: Math.max(2, octaves - 2), P,
        };

        // ---------- The void ----------
        const sky = layer(p, u, 0.18).toVar();
        const hero = layer(p, u, 1).toVar();
        const toCore = hero.sub(vec2(0, coreY)).toVar();
        const c2 = dot(toCore, toCore).toVar();
        // The crystal lights the haze around it.
        const col = voidAt(sky, u, { ...look, lit: float(0.9).div(c2.mul(0.9).add(1)).add(0.45) }).toVar();
        const clear = smoothstep(0.08, 0.6, c2);
        const aboveHorizon = smoothstep(horizon, horizon.add(0.35), sky.y).toVar();
        col.addAssign(starfield(layer(p, u, 0.04), u, mood.stars).mul(0.4).mul(clear).mul(aboveHorizon));
        if (mood.meteors) {
            // Now and then a meteor crosses the night beside the gate.
            col.addAssign(shootingStar(layer(p, u, 0.04), u, {
                period: 23, duration: 1.3, chance: 0.6, salt: 2.3, area: [-1.7, 0.25, 1.7, 0.72], color: mood.white,
            }).mul(clear).mul(aboveHorizon));
        }
        const rosette = roseWindow(layer(p, u, 0.5).sub(vec2(0, centre)), u, Math.min(3, octaves - 1), P);
        col.addAssign(rosette.mul(0.12).mul(glow.mul(0.4).add(0.7)));
        col.addAssign(constellation(p, u, P, gate, centre).mul(aboveHorizon));

        // ---------- The floor, in perspective ----------
        // A floor point at depth D (focal = the gate's depth) sits `focal * eye / D` below the horizon.
        const depth0 = focal.mul(eye).div(horizon.sub(p.y).max(0.002)).min(60);
        const fq = layer(p, u, focal.div(depth0).min(2.2)).toVar();
        const depth = focal.mul(eye).div(horizon.sub(fq.y).max(0.002)).min(60).toVar();
        // Floor units, origin under the gate's centre, y growing away from the viewer.
        const floorPoint = vec2(fq.x.mul(depth).div(focal), depth.sub(focal)).toVar();
        const fp = footprint(floorPoint).toVar();
        // Obsidian mirrors little looking down and almost everything at a grazing angle.
        const grazing = eye.div(sqrt(depth.mul(depth).add(eye.mul(eye))));
        const sheen = fresnel(grazing, 0.08).toVar();
        // The polish: broad, slow variation in how cleanly the stone mirrors (none where a pixel
        // spans more floor than the variation: no shimmer near the horizon).
        const near = fadeOut(0.02, 0.15, fp).toVar();
        const polish = fbm(floorPoint.mul(1.4).add(9.1), 3).sub(0.5).mul(near).add(0.5)
            .toVar();
        const ripple = gnoise(floorPoint.mul(2.3).add(vec2(3.3, 1.7))).sub(0.5).mul(near).toVar();
        const mirrorGain = sheen.mul(0.85).add(0.09).mul(polish.mul(0.45).add(0.78)).toVar();
        // Bright lights mirror visibly even where the stone reflects little: the polish shows in them.
        const glossGain = sheen.mul(0.45).add(0.45).mul(polish.mul(0.3).add(0.85)).toVar();
        // The haze, mirrored about the horizon; the core's light, about the floor line.
        const heroMirror = vec2(hero.x.add(ripple.mul(0.01)), floorY.mul(2).sub(hero.y).add(ripple.mul(0.02)));
        const toCoreMirror = heroMirror.sub(vec2(0, coreY)).toVar();
        const c2m = dot(toCoreMirror, toCoreMirror).toVar();
        const reflected = voidAt(vec2(sky.x, horizon.mul(2).sub(sky.y).add(ripple.mul(0.03))), u, {
            ...look, octaves: 2, lit: float(0.9).div(c2m.mul(0.9).add(1)).add(0.45), blurred: true,
        });
        const floorColour = P.OBSIDIAN.add(reflected.mul(mirrorGain)).toVar();
        if (mood.marble) {
            // Pale marble: fine grey veins wandering through the stone (gone where a pixel spans
            // more floor than a vein is wide).
            const veinNoise = fbm(floorPoint.mul(0.85).add(vec2(2.7, 8.1)), 3).sub(0.5).toVar();
            const veins = exp(veinNoise.mul(veinNoise).mul(-700)).mul(near);
            floorColour.mulAssign(float(1).sub(veins.mul(mood.marble)));
        }
        // The core mirrored, its glow drawn out into a vertical streak as on any glossy floor.
        const streak = exp(toCoreMirror.x.mul(toCoreMirror.x).mul(-55))
            .mul(exp(toCoreMirror.y.mul(toCoreMirror.y).mul(-1.6)));
        floorColour.addAssign(auraAt(c2m, glow, P).mul(0.7).add(coreAt(c2m, u, glow, P).mul(0.5))
            .add(WHITE_GOLD.mul(streak).mul(0.09).mul(glow))
            .mul(glossGain));
        // A pool of the crystal's light on the stone beneath it.
        const r2 = dot(floorPoint, floorPoint).toVar();
        floorColour.addAssign(GOLD.mul(exp(r2.div(scale.mul(scale)).mul(-14))).mul(0.06).mul(glow));
        // The gate lights the stone it stands on: the bottom beam along its length, the posts at
        // their feet, and the travelling light from wherever it is.
        const bx = floorPoint.x.clamp(gate.negate(), gate).toVar();
        const offBottom = vec2(floorPoint.x.sub(bx), floorPoint.y);
        const bottom = exp(dot(offBottom, offBottom).mul(-90))
            .mul(walked(gate.sub(bx).div(gate.mul(2)).add(3).div(4), light));
        const feet = [[-1, 0], [1, 0.75]].reduce((sum, [x, s]) => {
            const to = floorPoint.sub(vec2(gate.mul(x), 0));
            return sum.add(exp(dot(to, to).mul(-80)).mul(walked(float(s), light)));
        }, float(0));
        const travelling = [[light.point, light.fading.oneMinus()], [light.wasPoint, light.fading]]
            .reduce((sum, [point, weight]) => {
                const height = point.y.sub(floorY);
                const toHead = vec2(floorPoint.x.sub(point.x), floorPoint.y);
                return sum.add(weight.div(dot(toHead, toHead).add(height.mul(height)).mul(45).add(1)));
            }, float(0));
        floorColour.addAssign(GOLD.mul(bottom.mul(0.16).add(feet.mul(0.16)).add(travelling.mul(0.22))));
        // The inscription, drawn at the gate's scale: the breath's light spreads outward through it.
        const reach = u.breathSoft.mul(2.7).add(0.55);
        const wave = u.breathVel.max(0).mul(2.4).min(1);
        const distance = exp(depth.sub(focal).max(0).mul(-0.11));
        const mandala = floorPoint.div(scale);
        // Now and then a wave of light runs out along the lines, centre to great circle (~8 s).
        const swell = eventWindow(u.time, float(31), float(8), float(0.6), u.seed.mul(17.3).add(1.1)).toVar();
        const surge = vec2(swell.y.mul(3.6).sub(0.2), swell.x.mul(u.life));
        floorColour.addAssign(inscription(mandala, u, {
            reach, wave, detail, colors: mood.inscription, surge,
        }).mul(glow.mul(0.22).add(0.2))
            .mul(distance));
        const floorMask = fadeOut(horizon.sub(u.px.mul(1.5)), horizon.add(u.px.mul(1.5)), p.y);
        col.assign(mix(col, floorColour, floorMask));
        // The floor's far edge catches the light: a fine bright line along the horizon.
        const edge = p.y.sub(horizon).div(u.px.mul(2.5).add(0.002));
        const centredEdge = float(1).div(p.x.mul(p.x).mul(2).add(1));
        col.addAssign(mix(VIOLET, WHITE_GOLD, centredEdge.mul(0.6)).mul(exp(edge.mul(edge).negate()))
            .mul(centredEdge.mul(0.07).add(0.008))
            .mul(glow));
        // A low bank of mist on the floor, lit by the crystal.
        col.addAssign(floorMist(p, hero, u, horizon, mood, glow, float(0), octaves >= 5 ? 3 : 2));

        // ---------- Light in the air: aura, rays, the core ----------
        const above = smoothstep(floorY.sub(0.02), floorY.add(0.08), hero.y).toVar();
        const rc = sqrt(c2).max(1e-3).toVar();
        const dir = turn(toCore.div(rc), u.time.mul(0.012)).toVar();
        // Painted rays under the post shafts, so the lightest tier keeps them too.
        const fan = cube(gnoise(dir.mul(6.5).add(vec2(u.time.mul(0.025), 2.7)))).mul(1.6)
            .add(cube(gnoise(dir.mul(15).add(vec2(5.1, u.time.mul(0.04))))).mul(0.9));
        const falloff = rc.mul(rc).mul(float(3.4).sub(u.breathSoft.mul(1.8))).add(1);
        const rays = fan.mul(smoothstep(0.05, 0.3, rc)).div(falloff)
            .mul(glow)
            .mul(0.08);
        col.addAssign(auraAt(c2, glow, P).add(WHITE_GOLD.mul(rays)).mul(above));
        col.addAssign(coreAt(c2, u, glow, P));

        // ---------- The gate, and its reflection in the floor ----------
        const gateGain = u.breathSoft.mul(0.3).add(0.85);
        col.addAssign(gateBeams(hero, light, u, float(0), frame).add(travellingLight(hero, light, P)).mul(gateGain));
        const under = floorY.sub(hero.y).toVar();
        const depthBelow = under.max(0).toVar();
        const mirrored = vec2(hero.x.add(ripple.mul(0.008)), floorY.mul(2).sub(hero.y));
        const blur = depthBelow.mul(0.02);
        const gateMirror = gateBeams(mirrored, light, u, blur, frame).add(travellingLight(mirrored, light, P).mul(0.7));
        col.addAssign(gateMirror.mul(exp(depthBelow.mul(-1.3))).mul(smoothstep(0.0, 0.02, under)).mul(glossGain)
            .mul(0.55)
            .mul(gateGain));

        // The whole temple breathes a little brighter on the in-breath.
        return col.mul(u.breathSoft.mul(0.12).add(0.94));
    })();

    // The light streams from the core, only above the floor line (the mirror must not cast rays).
    const shafts = {
        source: [0, GATE_CENTRE, 1],
        region: GATE_CENTRE - GATE_WIDE + 0.04,
        radius: 0.2,
        strength: 0.42,
        threshold: 1.6,
        decay: 0.95,
        length: 0.5,
        tint: mood.shaftTint,
        breath: 0.6,
    };
    const layout = layoutFor({ y: 1 }, {});
    const lapPoint = new THREE.Vector2();
    let lastLap = null;

    return {
        backdrop,
        objects: [solids.group, solids.mirror],
        motes: [
            {
                // Fine gold dust around the crystal: it swells outward on the in-breath.
                motion: MOTE_MOTION.halo,
                count: 140,
                size: 0.013,
                speed: 1,
                spread: 0.62,
                depth: 1.4,
                bokeh: 0.1,
                colorA: mood.dust.halo[0],
                colorB: mood.dust.halo[1],
                gain: 0.55,
            },
            {
                // Dust floating in the temple's air, some of it close to the lens.
                motion: MOTE_MOTION.wander,
                count: 90,
                size: 0.009,
                speed: 0.3,
                spread: 0.95,
                band: [-0.4, 1.6],
                depth: 2.6,
                bokeh: 0.22,
                colorA: mood.dust.air[0],
                colorB: mood.dust.air[1],
                gain: 0.42,
            },
            ...(mood.extraMotes ? [mood.extraMotes] : []),
        ],
        shafts,
        bloom: {
            strength: 0.36, radius: 0.65, threshold: 0.75, breath: 0.5,
        },
        grade: {
            // Fine bright lines would fringe red and blue toward the corners: keep the lens quiet.
            chroma: 0.35,
            vignette: 0.42,
            ...mood.grade,
        },
        camera: { dolly: 0.04, drift: [0.026, 0.012], period: 60 },
        exposure: mood.exposure ?? 1.0,
        update({
            time, delta, breathSoft, phase, progress, ext,
        }) {
            layoutFor(ext, layout);
            gate.value = layout.gate;
            centre.value = layout.centre;
            floorY.value = layout.floor;
            // The light walks one side per phase. The pattern moves it a lap in some sixteen
            // seconds: more than a twentieth of a lap in one frame is a jump (a session re-syncing
            // the cycle, a skipped phase), and the old light fades out over a second instead.
            const lap = (phase + progress) / 4;
            if (lastLap !== null && delta > 0) {
                const moved = lap - lastLap - Math.round(lap - lastLap);
                if (Math.abs(moved) > 0.05) {
                    light.was.value = lastLap;
                    light.wasPoint.value.copy(light.point.value);
                    light.fading.value = 1;
                }
            }
            light.fading.value = delta > 0 ? Math.max(0, light.fading.value - delta / 1.2) : 0;
            lastLap = lap;
            light.head.value = lap;
            light.point.value.copy(pathPoint(lap, layout, lapPoint));
            // The full hold wakes the shimmer; it eases in and out over a second or two.
            const target = phase === 1 ? 1 : 0;
            hold.value += (target - hold.value) * (delta > 0 ? 1 - Math.exp(-delta * 1.4) : 1);
            const core = solids.pose(time, breathSoft, layout);
            coreY.value = core;
            shafts.source[1] = core;
            shafts.region = layout.floor + 0.04;
        },
    };
}
