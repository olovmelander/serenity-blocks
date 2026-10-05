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
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, dot, exp, float, floor, fract, length, max, mix, smoothstep, sqrt, step, uniform, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fbm3, fresnel, gnoise, hash21, layer, starfield, turn,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';
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

const GOLD = vec3(1.0, 0.68, 0.3);
const WHITE_GOLD = vec3(1.0, 0.9, 0.74);
const WHITE = vec3(1.0, 0.97, 0.92);
const VIOLET = vec3(0.46, 0.28, 1.0);
const ROSE = vec3(1.0, 0.46, 0.6);
const VOID_LOW = vec3(0.018, 0.007, 0.04);
const VOID_HIGH = vec3(0.0016, 0.0014, 0.0075);
const OBSIDIAN = vec3(0.0026, 0.0018, 0.0062);

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
function gateBeams(g, light, u, blur, { gate, centre }) {
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
function cometHead(g, point) {
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
const travellingLight = (g, light) => cometHead(g, light.point).mul(light.fading.oneMinus())
    .add(cometHead(g, light.wasPoint).mul(light.fading));

/**
 * The void at sky point `s`: indigo overhead, deep violet low, a slow nebulous haze in wisps and
 * dark lanes, and the horizon's glow. `lit` is how much of the crystal's light reaches this
 * part of the haze (1 beside the core, a small floor far away).
 */
function voidAt(s, u, {
    horizon, top, glow, octaves, lit, blurred = false,
}) {
    const height = smoothstep(horizon.sub(0.15), top.add(0.25), s.y);
    const col = mix(VOID_LOW, VOID_HIGH, height).toVar();
    const drift = u.time.mul(0.008);
    // A little domain warp turns blobs into wisps (the floor's soft mirror needs none of it).
    const q = blurred ? s : s.add(vec2(
        gnoise(s.mul(0.85).add(vec2(drift, 3.1))),
        gnoise(s.mul(0.85).add(vec2(7.7, drift.negate()))),
    ).sub(0.5).mul(0.9)).toVar();
    const neb = fbm3(vec3(q.x.mul(0.8).add(drift), q.y.mul(1.15), u.time.mul(0.012)), octaves).toVar();
    const dense = smoothstep(0.42, 0.8, neb).toVar();
    const lanes = blurred ? float(0.6)
        : smoothstep(0.3, 0.62, gnoise(q.mul(1.7).add(vec2(11.3, 4.4)))).mul(0.75).add(0.25);
    const tone = gnoise(q.mul(0.7).add(vec2(4.2, 1.3)));
    const hazeColour = mix(vec3(0.32, 0.15, 0.75), vec3(0.85, 0.26, 0.52), tone.mul(1.8).sub(0.55).saturate());
    const low = exp(s.y.sub(horizon).max(0).mul(-1.1));
    col.addAssign(hazeColour.mul(dense.mul(lanes)).mul(low.mul(0.4).add(0.6)).mul(lit.mul(lit)).mul(0.17)
        .mul(glow.mul(0.3).add(0.85)));
    // Light pooled in the low haze where the floor meets the void, strongest under the core.
    const above = s.y.sub(horizon).toVar();
    const centred = float(1).div(s.x.mul(s.x).mul(1.6).add(1)).toVar();
    const band = exp(above.mul(above).mul(-60)).mul(centred.mul(0.85).add(0.15));
    col.addAssign(mix(VIOLET, mix(ROSE, GOLD, 0.5), centred.mul(0.55)).mul(band).mul(0.035).mul(glow));
    return col;
}

/** The core's light in the air at squared distance `c2`: violet far, rose, gold near. */
const auraAt = (c2, glow) => VIOLET.mul(0.05).div(c2.mul(3.5).add(1))
    .add(ROSE.mul(0.022).div(c2.mul(8).add(1)))
    .add(GOLD.mul(0.06).mul(glow).div(c2.mul(16).add(1)));

/** The white-gold core itself: it swells and brightens with the breath. */
const coreAt = (c2, u, glow) => WHITE.mul(exp(c2.div(u.breathSoft.mul(0.0006).add(0.00035)).negate()))
    .mul(u.breathSoft.mul(2.4).add(1.4))
    .add(WHITE_GOLD.mul(exp(c2.div(0.0065).negate())).mul(0.4).mul(glow));

/**
 * A rose window far behind the gate: great circles holding a ring of twelve interlaced circles,
 * in faint light, turning very slowly the other way from the floor's mandala. The haze drifts
 * across it, so it shows in places and dissolves in others. Its pixels face the lens: a pixel
 * is `u.px` across.
 */
function roseWindow(w, u, octaves) {
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

export function createSacredWorld({ u, quality }) {
    const { octaves, detail } = quality;
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
    const solids = createSacredSolids(u, { hold, floorY });
    const frame = { gate, centre };

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
            horizon, top, glow, octaves: Math.max(2, octaves - 2),
        };

        // ---------- The void ----------
        const sky = layer(p, u, 0.18).toVar();
        const hero = layer(p, u, 1).toVar();
        const toCore = hero.sub(vec2(0, coreY)).toVar();
        const c2 = dot(toCore, toCore).toVar();
        // The crystal lights the haze around it.
        const col = voidAt(sky, u, { ...look, lit: float(0.9).div(c2.mul(0.9).add(1)).add(0.45) }).toVar();
        const clear = smoothstep(0.08, 0.6, c2);
        col.addAssign(starfield(layer(p, u, 0.04), u, 0.55).mul(0.4).mul(clear)
            .mul(smoothstep(horizon, horizon.add(0.35), sky.y)));
        const rosette = roseWindow(layer(p, u, 0.5).sub(vec2(0, centre)), u, Math.min(3, octaves - 1));
        col.addAssign(rosette.mul(0.12).mul(glow.mul(0.4).add(0.7)));

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
        const floorColour = OBSIDIAN.add(reflected.mul(mirrorGain)).toVar();
        // The core mirrored, its glow drawn out into a vertical streak as on any glossy floor.
        const streak = exp(toCoreMirror.x.mul(toCoreMirror.x).mul(-55))
            .mul(exp(toCoreMirror.y.mul(toCoreMirror.y).mul(-1.6)));
        floorColour.addAssign(auraAt(c2m, glow).mul(0.7).add(coreAt(c2m, u, glow).mul(0.5))
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
        floorColour.addAssign(inscription(mandala, u, { reach, wave, detail }).mul(glow.mul(0.22).add(0.2))
            .mul(distance));
        const floorMask = fadeOut(horizon.sub(u.px.mul(1.5)), horizon.add(u.px.mul(1.5)), p.y);
        col.assign(mix(col, floorColour, floorMask));
        // The floor's far edge catches the light: a fine bright line along the horizon.
        const edge = p.y.sub(horizon).div(u.px.mul(2.5).add(0.002));
        const centredEdge = float(1).div(p.x.mul(p.x).mul(2).add(1));
        col.addAssign(mix(VIOLET, WHITE_GOLD, centredEdge.mul(0.6)).mul(exp(edge.mul(edge).negate()))
            .mul(centredEdge.mul(0.07).add(0.008))
            .mul(glow));

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
        col.addAssign(auraAt(c2, glow).add(WHITE_GOLD.mul(rays)).mul(above));
        col.addAssign(coreAt(c2, u, glow));

        // ---------- The gate, and its reflection in the floor ----------
        const gateGain = u.breathSoft.mul(0.3).add(0.85);
        col.addAssign(gateBeams(hero, light, u, float(0), frame).add(travellingLight(hero, light)).mul(gateGain));
        const under = floorY.sub(hero.y).toVar();
        const depthBelow = under.max(0).toVar();
        const mirrored = vec2(hero.x.add(ripple.mul(0.008)), floorY.mul(2).sub(hero.y));
        const blur = depthBelow.mul(0.02);
        const gateMirror = gateBeams(mirrored, light, u, blur, frame).add(travellingLight(mirrored, light).mul(0.7));
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
        tint: [1.0, 0.86, 0.64],
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
                colorA: [1.0, 0.84, 0.52],
                colorB: [1.0, 0.64, 0.34],
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
                colorA: [1.0, 0.86, 0.56],
                colorB: [0.82, 0.64, 1.0],
                gain: 0.42,
            },
        ],
        shafts,
        bloom: {
            strength: 0.36, radius: 0.65, threshold: 0.75, breath: 0.5,
        },
        grade: {
            shadows: [0.94, 0.88, 1.1],
            highlights: [1.06, 0.99, 0.88],
            saturation: 1.06,
            contrast: 1.05,
            vignette: 0.42,
        },
        camera: { dolly: 0.04, drift: [0.026, 0.012], period: 60 },
        exposure: 1.0,
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
