/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the sea life drawn: every animal of the pack (waves-cast.js), swum and lit.
 *
 * The cast shares two skin materials. On tiers with reflections the open sea also carries the
 * broken silhouettes of the cetaceans above it.
 *
 *   air     what is out of the water: wet skin under the hour's sun and sky, the sea's green
 *           thrown up under it, the sun sliding along its back, its fins lit through when the sun
 *           stands behind them.
 *   under   what is behind the water's surface, drawn where the depth test FAILS (the animal is
 *           behind the wave the eye sees): a body lit from above by the light that has come down
 *           through the wave, with the net of light the moving surface folds it into sliding over
 *           its back; round (dark toward its outline), its outline never quite still (the water
 *           bends it); its red taken first and the water's own glow laid over it by the metres of
 *           sea between it and the eye, until below a few metres it is gone. Under the moon its
 *           edge burns with the sea's own cold light.
 *
 * A dolphin leaving the face is therefore one animal in two lights with no seam to manage: what
 * has broken the surface is drawn by the first, what is still behind it by the second.
 *
 * Where each animal is comes from its act (waves-acts.js), written each frame as four rows into
 * its kind's instance buffer (attributes aRow0..3):
 *   (x, y, z, metres)  (heading xyz, stroke phase)  (back xyz, depth)  (beat, arch, spread, variant)
 * metres 0 = not there.
 *
 * The vertex stage swims each body plan from what its vertices carry (place along the body, part,
 * how far out along a fin, where the fin turns from):
 *   dolphins, the whale   the body beats up and down in a wave that grows toward the flukes, the
 *                         flukes pitch after it, the flippers trim; the body arches over a leap
 *   the manta             a wave runs out along each wing
 *   the turtle            the front flippers fly (down and back, feathered coming up), the rear
 *                         ones steer, the head looks about
 *   the seabird           the wings beat from the shoulder, the tips after the arms
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, atan, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fwidth, int, length,
    max, min, mix, normalize, positionGeometry, positionWorld, pow, reflect, round, select, sin, smoothstep, texture,
    uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { KINDS, SPECIES } from './waves-acts.js';
import { WAVE } from './waves-core.js';
import { troughHeight } from './waves-tsl.js';

const ROWS = 4;
export const FAUNA_STRIDE = ROWS * 4;
/**
 * The alpha an animal in the air writes to the scene: the lens reads it (waves-post.js) and keeps
 * its glare off the animal, so one that crosses the sun stays a dark shape with a burning edge
 * instead of a pale ghost.
 */
export const LIFE_MASK = 0.3;

/**
 * Per kind, how it swims:
 *   A = (the body wave's height at the tail / the wing's at its tip, its wavenumber, flipper or
 *        wing amplitude, how far the head moves against the tail)
 *   B = (the flukes' extra pitch / the wing's lag out along the span / how far a turtle's
 *        flipper feathers, the wings' set in a glide / a turtle's sweep back, -, -)
 */
const SWIM = {
    bottlenose: [[0.07, 4.2, 0.14, 0.12], [0.5, 0, 0, 0]],
    spinner: [[0.08, 4.4, 0.14, 0.12], [0.55, 0, 0, 0]],
    humpback: [[0.05, 4.4, 0.16, 0.1], [0.4, 0, 0, 0]],
    manta: [[0.16, 1.3, 0, 0], [2.2, 0, 0, 0]],
    turtle: [[0, 0, 0.6, 0], [0.4, 0.5, 0, 0]],
    seabird: [[0, 0, 0.62, 0], [1.1, 0.2, 0, 0]],
};

/**
 * Per kind, its colours (scene-linear) and how they lie:
 *   back (rgb, how glossy its wet skin is), belly (rgb, where the line between the two falls on
 *   the rest normal's y), a (rgb, how strongly its first mask paints), b (the same for the second).
 */
const SKINS = {
    bottlenose: [[0.12, 0.14, 0.17, 1], [0.24, 0.26, 0.28, -0.25], [0.04, 0.05, 0.065, 0.9], [0.6, 0.58, 0.56, 0.95]],
    spinner: [[0.24, 0.27, 0.3, 1], [0.4, 0.42, 0.44, -0.2], [0.045, 0.055, 0.07, 0.95], [0.82, 0.82, 0.8, 1]],
    humpback: [[0.024, 0.028, 0.036, 0.8], [0.3, 0.32, 0.33, -0.25], [0.14, 0.15, 0.17, 0.6], [0.4, 0.42, 0.42, 0.8]],
    manta: [[0.011, 0.012, 0.016, 0.6], [0.68, 0.7, 0.7, -0.05], [0.6, 0.62, 0.63, 1], [0.04, 0.04, 0.05, 0.6]],
    turtle: [[0.11, 0.12, 0.085, 0.4], [0.36, 0.34, 0.24, -0.3], [0.16, 0.11, 0.04, 1], [0.46, 0.41, 0.23, 1]],
    seabird: [[0.7, 0.7, 0.68, 0.2], [0.8, 0.8, 0.78, -0.2], [0.1, 0.1, 0.11, 0.9], [0.02, 0.02, 0.025, 1]],
};

const table4 = (src, index) => uniformArray(KINDS.map((kind) => new THREE.Vector4(...src[kind][index])), 'vec4');

const rotX = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
};
const rotY = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};
const rotZ = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
};

/** The body wave at a place along it: how far it stands off its line (units of its length). */
const bodyWave = (s, phase, amp, K, recoil, from) => {
    const env = pow(clamp(s.sub(from).div(float(1).sub(from)), 0.0, 1.0), 1.6)
        .sub(float(1.0).sub(smoothstep(0.0, 0.35, s)).mul(recoil));
    return env.mul(amp).mul(sin(phase.sub(s.mul(K))));
};

/** Where each kind stands in the pack (the shaders branch on it). */
const KIND = Object.freeze(Object.fromEntries(KINDS.map((kind, i) => [kind, i])));

/**
 * The light that reaches an animal under the water comes down through the wave from above, from
 * the side of the tube and from ahead, where the barrel opens (a fixed direction: under water the
 * light is the water's, whatever the sun's height).
 */
const UNDER_LIGHT = Object.freeze([-0.42, 0.78, -0.46]);

/**
 * The two materials every kind shares.
 * @param {object} U   the world's uniforms (time, sun, warm, glow, light: the hour's colours,
 *                     glowing: 0..1 the sea's own light at night)
 * @param {object} [maps]
 * @param {THREE.Texture} [maps.lace]    the field of foam cells (waves-tsl.js createFoamLace): the
 *                                       turtle's plates and scales, and the net of light on a back
 * @param {THREE.Texture} [maps.noise]   the water's noise: streaks in a plate, mottle on a hide
 */
export function createFaunaMaterials(U, { lace = null, noise = null } = {}) {
    const swimA = table4(SWIM, 0);
    const swimB = table4(SWIM, 1);
    const skinBack = table4(SKINS, 0);
    const skinBelly = table4(SKINS, 1);
    const skinA = table4(SKINS, 2);
    const skinB = table4(SKINS, 3);

    const aShape = attribute('aShape', 'vec4');
    const aPivot = attribute('aPivot', 'vec4');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'vWaveLifeN');
    const vRestN = varying(vec3(0.0, 1.0, 0.0), 'vWaveLifeRestN');
    /** (variant, depth under the surface, how far out along a fin, -). */
    const vLook = varying(vec4(0.0), 'vWaveLifeLook');

    const position = Fn(() => {
        const R0 = attribute('aRow0', 'vec4');
        const R1 = attribute('aRow1', 'vec4');
        const R2 = attribute('aRow2', 'vec4');
        const R3 = attribute('aRow3', 'vec4');
        // Every value the body plans below share is a var made here, before the first branch
        // (a value first met inside one plan's branch is written again in every other).
        const kindF = round(aShape.w.mul(255.0)).toVar();
        const kind = int(kindF);
        const code = round(aShape.y.mul(255.0));
        const part = floor(code.div(3.0).add(0.01)).toVar();
        const s = aShape.x.toVar();
        const w = aShape.z.toVar();
        const pivot = aPivot.xyz.toVar();
        const phase = R1.w.toVar();
        const beat = R3.x.toVar();
        const arch = R3.y.toVar();
        const spread = R3.z.toVar();
        const A = swimA.element(kind).toVar();
        const B = swimB.element(kind).toVar();
        const sgn = select(pivot.x.greaterThanEqual(0.0), float(1.0), float(-1.0)).toVar();
        const isPart = (n) => float(1.0).sub(smoothstep(0.0, 0.5, abs(part.sub(n))));
        const local = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();
        const root = smoothstep(0.0, 0.3, w).toVar();
        const onFlipper = isPart(1).toVar();
        const onTail = isPart(2).toVar();
        const onHead = isPart(4).toVar();
        const onRear = isPart(5).toVar();

        If(kindF.lessThan(KIND.humpback + 0.5), () => {
            // ── Dolphins and the whale: up and down ──
            const trim = A.z.mul(beat).mul(sin(phase.mul(0.5).add(0.8)))
                .sub(float(1).sub(spread).mul(0.64)).mul(sgn)
                .mul(onFlipper)
                .mul(root);
            local.assign(pivot.add(rotZ(local.sub(pivot), trim)));
            nrm.assign(rotZ(nrm, trim));
            const amp = A.x.mul(beat);
            const h = bodyWave(s, phase, amp, A.y, A.w, 0.22);
            const h2 = bodyWave(s.add(0.01), phase, amp, A.y, A.w, 0.22);
            // The flukes pitch a quarter-beat behind the stroke, from where they meet the body.
            const pitch = B.x.mul(beat).mul(cos(phase.sub(A.y.mul(0.92)))).mul(onTail);
            const aft = max(float(-0.4).sub(local.z), 0.0);
            // Arched over a leap: the nose and the flukes hang from the middle of the back.
            const sag = arch.mul(local.z).mul(local.z);
            local.addAssign(vec3(0.0, h.add(aft.mul(pitch)).sub(sag), 0.0));
            nrm.assign(rotX(nrm, atan(h2.sub(h).div(0.01).add(pitch).add(arch.mul(local.z).mul(2.0)))));
        }).ElseIf(kindF.lessThan(KIND.manta + 0.5), () => {
            // ── The manta: the wings fly ──
            const span = clamp(abs(local.x).div(0.5), 0.0, 1.0);
            const wing = pow(smoothstep(0.12, 1.0, span), 1.25);
            const amp = A.x.mul(beat.mul(0.7).add(0.3));
            const y0 = wing.mul(amp).mul(sin(phase.sub(span.mul(B.x))));
            const sp2 = clamp(abs(local.x).add(0.01).div(0.5), 0.0, 1.0);
            const y1 = pow(smoothstep(0.12, 1.0, sp2), 1.25).mul(amp).mul(sin(phase.sub(sp2.mul(B.x))));
            const lift = y1.sub(y0).div(0.01).mul(select(local.x.greaterThanEqual(0.0), float(1.0), float(-1.0)));
            const whip = sin(phase.mul(1.3).sub(s.mul(7.0))).mul(0.03).mul(smoothstep(0.45, 1.0, s)).mul(onTail);
            local.addAssign(vec3(whip, y0.sub(amp.mul(0.12).mul(sin(phase))), 0.0));
            nrm.assign(normalize(vec3(nrm.x.sub(lift.mul(nrm.y)), nrm.y, nrm.z)));
        }).ElseIf(kindF.lessThan(KIND.turtle + 0.5), () => {
            // ── The turtle: the front flippers fly (down and back, feathered on the way up), the
            //    rear ones steer, the head looks about ──
            const stroke = sin(phase);
            // The power stroke is quicker than the recovery: the flipper is down longer than up.
            const down = stroke.add(sin(phase.mul(2.0)).mul(0.22));
            const lift = A.z.mul(beat).mul(down).mul(sgn).mul(onFlipper)
                .mul(root);
            const sweep = B.y.mul(beat).mul(sin(phase.sub(1.0))).mul(sgn).mul(onFlipper)
                .mul(root);
            const feather = B.x.mul(beat).mul(cos(phase)).mul(onFlipper).mul(w);
            const steer = sin(phase.mul(0.5).add(1.2)).mul(0.22).mul(sgn).mul(onRear)
                .mul(root);
            const nod = sin(phase.mul(0.37).add(0.6)).mul(0.1).mul(onHead).mul(w);
            const v = local.sub(pivot).toVar();
            v.assign(rotY(rotZ(rotX(v, feather.add(nod)), lift.add(steer)), sweep));
            local.assign(pivot.add(v));
            nrm.assign(rotY(rotZ(rotX(nrm, feather.add(nod)), lift.add(steer)), sweep));
            // The shell rides up a little on each stroke.
            local.addAssign(vec3(0.0, sin(phase.sub(0.6)).mul(0.012).mul(beat), 0.0));
        })
            .Else(() => {
            // ── The seabird: the wings beat from the shoulder, the tips after the arms ──
                const stroke = A.z.mul(beat).mul(sin(phase.sub(w.mul(B.x))));
                const set = B.y.mul(spread.mul(2.0).sub(0.6)).mul(w.mul(0.6).add(0.4));
                const flap = stroke.add(set).mul(sgn).mul(onFlipper).mul(root);
                local.assign(pivot.add(rotZ(local.sub(pivot), flap)));
                nrm.assign(rotZ(nrm, flap));
            });

        // Into the world: its own frame from its heading and its back.
        const f = normalize(R1.xyz);
        const side = normalize(cross(R2.xyz, f));
        const up = cross(f, side);
        const offset = side.mul(local.x).add(up.mul(local.y)).add(f.mul(local.z)).mul(R0.w)
            .toVar();
        // What is nearer the eye has less water over it.
        const toEye = normalize(cameraPosition.sub(R0.xyz));
        vRestN.assign(attribute('normal', 'vec3'));
        vNormal.assign(normalize(side.mul(nrm.x).add(up.mul(nrm.y)).add(f.mul(nrm.z))));
        vLook.assign(vec4(R3.w, R2.w.sub(dot(offset, toEye).mul(0.9)), w, 0.0));
        return R0.xyz.add(offset);
    })();

    /**
     * Seen through moving water an outline is never still: what is behind the surface is shifted
     * a few centimetres this way and that, more the deeper it lies, and not at all where it
     * breaks the surface (so the half in the air and the half behind the water still meet).
     */
    const positionBehind = Fn(() => {
        const at = position.toVar();
        const depth = max(attribute('aRow2', 'vec4').w, 0.0);
        const t = U.time;
        const shimmer = vec3(
            sin(at.y.mul(5.3).add(at.z.mul(2.1)).add(t.mul(1.9))),
            sin(at.x.mul(4.7).sub(at.z.mul(3.3)).add(t.mul(2.3))),
            sin(at.y.mul(3.9).add(at.x.mul(2.9)).sub(t.mul(1.7))),
        );
        return at.add(shimmer.mul(smoothstep(0.05, 0.7, depth).mul(0.016)));
    })();

    /** The animal's own colours, before any light. */
    const albedoOf = () => {
        const kindF = round(aShape.w.mul(255.0)).toVar();
        const kind = int(kindF);
        const skin = attribute('aSkin', 'vec4');
        const back = skinBack.element(kind);
        const belly = skinBelly.element(kind);
        const accA = skinA.element(kind);
        const accB = skinB.element(kind);
        const shade = smoothstep(belly.w.sub(0.28), belly.w.add(0.28), vRestN.y);
        // No two animals are quite one grey.
        const own = vLook.x.sub(0.5).mul(0.3).add(1.0);
        const base = mix(belly.rgb, back.rgb, shade).mul(own);
        const painted = mix(mix(base, accA.rgb.mul(own), skin.y.mul(accA.w)), accB.rgb, skin.z.mul(accB.w)).toVar();
        if (lace) {
            const rp = positionGeometry;
            // ── The green turtle: a shell of plates, a hide of scales ──
            // The plates: cells of the foam-cell field, mirrored about the keel so the row down the
            // middle is whole plates and each side answers the other. A dark seam between two,
            // streaks of amber fanning through each.
            const plateAt = vec2(abs(rp.x), rp.z).mul(0.82).add(vec2(0.045, 0.61));
            const plate = texture(lace, plateAt).toVar();
            const seam = float(1.0).sub(smoothstep(0.025, 0.085, plate.r));
            const grain = noise
                ? texture(noise, vec2(rp.x.mul(2.3).add(plate.b.mul(3.0)), rp.z.mul(2.3))).b
                : float(0.5);
            const amber = smoothstep(0.34, 0.72, grain);
            const shell = mix(vec3(0.085, 0.07, 0.04), vec3(0.34, 0.215, 0.07), amber)
                .mul(plate.b.mul(0.55).add(0.72))
                .mul(float(1.0).sub(seam.mul(0.78)));
            // The scales of its head and flippers: dark, each edged in cream.
            const scaleAt = vec2(rp.x.add(rp.y.mul(0.7)), rp.z.sub(rp.y.mul(0.35))).mul(1.75).add(vec2(0.37, 0.11));
            const scale = texture(lace, scaleAt).g;
            const cream = float(1.0).sub(smoothstep(0.035, 0.13, scale));
            const hide = mix(vec3(0.075, 0.08, 0.06), vec3(0.5, 0.46, 0.32), cream);
            const plastron = vec3(0.56, 0.5, 0.31);
            const bare = max(float(1.0).sub(skin.y).sub(skin.z), 0.0);
            const turtle = shell.mul(skin.y).add(plastron.mul(skin.z)).add(hide.mul(bare)).mul(own);
            const isTurtle = float(1.0).sub(smoothstep(0.0, 0.5, abs(kindF.sub(KIND.turtle))));
            painted.assign(mix(painted, turtle, isTurtle));
        }
        // The eye: dark and wet.
        return { albedo: mix(painted, vec3(0.006, 0.006, 0.008), skin.w), skin, gloss: back.w };
    };

    const { light, sun, warm } = U;
    const sunLight = vec3(2.1, 1.35, 0.72).mul(light.fireTint);
    /** The sky from above, the sea's own green thrown up from below. */
    const ambientOn = (N) => mix(
        light.scatter.mul(0.55).add(vec3(0.018, 0.04, 0.046)),
        vec3(0.13, 0.18, 0.25),
        N.y.mul(0.5).add(0.5),
    ).mul(light.skyTint);

    // ── In the air ──
    const air = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.FrontSide });
    air.name = 'waves-life';
    air.positionNode = position;
    // (The whole fragment: an opaque material's own alpha reaches the target only this way.)
    air.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3)).toVar();
        const { albedo, skin, gloss } = albedoOf();
        const ao = skin.x.mul(0.7).add(0.3);
        const facing = clamp(dot(N, sun).mul(0.8).add(0.2), 0.0, 1.0);
        const lit = albedo.mul(ambientOn(N).add(sunLight.mul(facing.mul(facing)))).mul(ao).toVar();
        // Wet skin: the sun slides along it, and its far edge takes the hour's fire.
        const R = reflect(V.negate(), N);
        const gleam = clamp(dot(R, sun), 0.0, 1.0);
        const g2 = gleam.mul(gleam);
        const g8 = g2.mul(g2).mul(g2).mul(g2);
        const rim = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        const behind = max(dot(sun, V.negate()), 0.0).toVar();
        // The lower flank mirrors the trough and the shoulder mirrors the cooler open sky.
        // Only the wet edge turned toward the sun picks up a silver-gold sliver.
        const reflected = mix(
            light.scatter.mul(0.52),
            light.zenithFar.add(vec3(0.035, 0.045, 0.055)),
            smoothstep(-0.3, 0.35, R.y),
        );
        const grazing = rim.mul(rim).mul(rim);
        const edge = smoothstep(-0.12, 0.55, dot(N, sun).add(max(N.y, 0.0).mul(0.42)));
        const shine = vec3(3.6, 2.35, 1.2).mul(g8.mul(g8).mul(g8)).mul(gloss)
            .add(vec3(1.6, 0.96, 0.5).mul(grazing).mul(behind).mul(edge))
            .mul(light.fireTint)
            .add(reflected.mul(grazing.mul(0.65).add(0.09)).mul(gloss));
        // A fin is thin: with the sun behind it, it glows through.
        const thin = smoothstep(0.25, 0.8, vLook.z);
        const through = sunLight.mul(albedo.add(0.08)).mul(thin).mul(behind.mul(behind).mul(0.9).add(0.12));
        const colour = lit.add(shine).add(through).mul(mix(vec3(1.0), vec3(1.12, 1.0, 0.84), warm)).toVar();
        // What is far out stands in the haze of the hour.
        const haze = mix(light.horizonFar, light.horizonSun, behind.mul(behind));
        colour.assign(mix(colour, haze, float(1.0).sub(exp(dist.mul(-1 / 740)))));
        return vec4(colour, LIFE_MASK);
    })();

    // ── Behind the water ──
    const under = new THREE.MeshBasicNodeMaterial({
        fog: false, side: THREE.FrontSide, transparent: true, depthWrite: false,
    });
    under.name = 'waves-life-under';
    under.depthFunc = THREE.GreaterDepth;
    under.positionNode = positionBehind;
    under.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        const V = normalize(cameraPosition.sub(P)).toVar();
        const { albedo, skin, gloss } = albedoOf();
        const depth = max(vLook.y, 0.03).toVar();
        const facing = clamp(dot(N, V), 0.0, 1.0).toVar();
        // The light that has come down through the wave: the hour's sun, less what a metre of
        // this water takes from it. It falls on the animal's back from above and from the open
        // end of the tube, and the moving surface folds it into a net that slides over the skin.
        const sunk = light.sunTint.mul(exp(light.absorb.mul(-1.1)));
        const key = clamp(dot(N, vec3(...UNDER_LIGHT)).mul(0.62).add(0.38), 0.0, 1.0).toVar();
        const net = float(0.0).toVar();
        if (lace) {
            const t = U.time;
            const along = P.z.add(P.x.mul(0.35));
            const up = P.y.add(P.x.mul(0.2));
            // (Bent by the swell: threads of light that waver, not the straight walls of the
            // cells they are drawn from, which on a smooth back read as a shell's plates.)
            const bend = noise
                ? texture(noise, vec2(along.mul(0.13).add(t.mul(0.013)), up.mul(0.13).sub(t.mul(0.009)))).rg
                    .sub(0.5)
                    .mul(0.34)
                : vec2(0.0);
            const k1 = texture(lace, vec2(along.mul(0.17).add(t.mul(0.021)), up.mul(0.17).add(0.4)).add(bend)).r;
            const k2 = texture(lace, vec2(along.mul(0.23).sub(t.mul(0.017)).add(0.6), up.mul(0.23)).sub(bend)).r;
            // Wide and soft: a glow that gathers toward a thread, never a drawn line.
            const fold = float(1.0).sub(smoothstep(0.0, 0.34, min(k1, k2.mul(1.3))));
            // (Sharp near the surface, washed out with depth.)
            net.assign(fold.mul(fold).mul(float(1.0).sub(smoothstep(0.4, 2.2, depth))));
        }
        // The water's own glow lights it from every side; from below there is less of it.
        const fill = light.scatter.mul(1.5).add(vec3(0.04, 0.06, 0.075).mul(light.skyTint))
            .mul(N.y.mul(0.3).add(0.7));
        // Wet skin under water still takes a sheen from the light above: a soft band down the back.
        const R = reflect(V.negate(), N);
        const gleam = clamp(dot(R, vec3(...UNDER_LIGHT)), 0.0, 1.0);
        const g2 = gleam.mul(gleam);
        const sheen = sunk.mul(g2.mul(g2).mul(gleam)).mul(gloss.mul(0.16)).mul(net.mul(0.8).add(0.6));
        const lit = albedo.mul(fill.add(sunk.mul(key).mul(net.mul(0.85).add(0.62))))
            .add(sheen)
            .mul(skin.x.mul(0.55).add(0.45))
            // Round: a body turns dark toward its outline.
            .mul(pow(facing, 0.6).mul(0.62).add(0.38))
            .toVar();
        // The water between it and the eye takes its red first and lays its own glow over it.
        const kept = exp(light.absorb.mul(depth.mul(-1.25))).toVar();
        const veil = light.scatter.mul(U.glow.mul(0.6).add(1.0)).mul(0.62);
        const colour = lit.mul(kept).add(veil.mul(vec3(1.0).sub(kept))).toVar();
        const rim = float(1.0).sub(facing);
        // The sea's own light, at night: what moves through it burns cold along its edge.
        const shallow = float(1.0).sub(smoothstep(0.0, 2.6, depth));
        const cold = vec3(0.05, 0.5, 0.9).mul(U.glowing).mul(rim.mul(rim).mul(rim).mul(1.5).add(0.025)).mul(shallow);
        colour.addAssign(cold);
        // A crisp shape near the surface, softer at its outline the deeper it lies, and gone
        // below a few metres.
        const outline = mix(float(1.0), smoothstep(0.0, 0.42, facing), smoothstep(0.35, 1.6, depth));
        // Under the flat of the sea the eye looks along the water: most of what lies under it is
        // lost in the sky the surface mirrors, more the further off it is.
        const flat = float(1.0).sub(clamp(abs(V.y), 0.0, 1.0));
        const f2 = flat.mul(flat);
        const mirrored = f2.mul(f2).mul(flat).mul(float(1.0).sub(smoothstep(0.0, 0.35, P.y)));
        const alpha = float(1.0).sub(smoothstep(0.9, 3.4, depth))
            .mul(outline.add(U.glowing.mul(rim.mul(rim)).mul(0.5)))
            .mul(float(1.0).sub(mirrored.mul(0.92)))
            .mul(0.96);
        return vec4(colour.mul(mix(vec3(1.0), vec3(1.1, 1.0, 0.86), warm)), clamp(alpha, 0.0, 1.0));
    })();

    return { air, under };
}

/**
 * Project the animal's own silhouette onto the open water along the eye's mirror ray. A swell
 * in front of it can hide it, and the moving facets split it into strokes. This draws only the
 * animal's triangles and needs no reflection camera or render target.
 */
function createSeaReflection(U) {
    const mat = new THREE.MeshBasicNodeMaterial({
        fog: false,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
    });
    mat.name = 'waves-life-reflection';
    const strength = varying(float(0), 'vWaveMirrorWeight');
    mat.positionNode = Fn(() => {
        const place = attribute('aRow0', 'vec4');
        const heading = attribute('aRow1', 'vec4').xyz;
        const back = attribute('aRow2', 'vec4');
        const arch = attribute('aRow3', 'vec4').y;
        const p = positionGeometry;
        const side = cross(back.xyz, heading);
        const body = place.xyz.add(side.mul(p.x).add(back.xyz.mul(p.y.sub(arch.mul(p.z).mul(p.z))))
            .add(heading.mul(p.z)).mul(place.w)).toVar();
        const eye = cameraPosition;
        const height = max(body.y, 0);
        const fraction = clamp(eye.y.div(max(eye.y.add(height), 0.08)), 0.0, 1.0);
        const sea = mix(eye.xz, body.xz, fraction).toVar();
        // A ripple tips the reflected ray sideways. A high back breaks up more than a nose
        // touching the water. Keep this offset small enough to leave the fins legible.
        const chop = sin(sea.y.mul(5.1).add(sea.x.mul(1.3)).sub(U.time.mul(1.7)))
            .add(sin(sea.y.mul(9.3).add(U.time.mul(2.1))).mul(0.34));
        const x = sea.x.add(chop.mul(min(height, 4)).mul(0.044)).toVar();
        const ahead = max(sea.y.negate().sub(6), 0);
        const across = x.add(min(ahead.mul(ahead).mul(WAVE.bowl), WAVE.bowlMax)).toVar();
        const y = troughHeight(across, sea.y, U.time);
        const whale = attribute('aShape', 'vec4').w.mul(255).greaterThan(1.5);
        const surfaced = select(whale, float(1), float(1).sub(smoothstep(0.01, 0.14, back.w)));
        strength.assign(surfaced.mul(smoothstep(-0.04, 0.12, body.y)).mul(smoothstep(-0.14, 0.35, across.negate())));
        return vec3(x, y.add(0.035), sea.y);
    })();
    mat.fragmentNode = Fn(() => {
        const P = positionWorld;
        const along = P.z.mul(14).add(sin(P.x.mul(3.2).add(P.z.mul(2.4))).mul(1.7)).sub(U.time.mul(2.1));
        const ripple = mix(sin(along), float(0), smoothstep(0.45, 2.9, fwidth(along)));
        const weight = strength.mul(ripple.mul(0.19).add(0.34));
        return vec4(U.light.scatter.mul(0.23).add(U.light.zenithFar.mul(0.12)), weight);
    })();
    return mat;
}

/** An animal's rows set to "not there" (metres 0 collapses it to a point under the sea). */
function park(data, at) {
    data.fill(0, at, at + FAUNA_STRIDE);
    data[at + 1] = -100;
    data[at + 6] = -1;
    data[at + 9] = 1;
}

/** How many of a kind a tier may draw at once. */
export function slotsFor(kind, tier) {
    return Math.max(1, Math.round(SPECIES[kind].slots * (tier?.life ?? 1)));
}

/**
 * Every kind of animal as instanced meshes under one group, from the pack.
 *
 * Returns { mesh, set(kind, i, pose), commit(counts), slots(kind), dispose() }.
 * @param {object} p
 * @param {object} p.U       the world's uniforms
 * @param {{ kinds: object }} p.pack   what waves-cast.js parsed
 * @param {object} p.tier
 * @param {THREE.Texture} [p.lace]    the field of foam cells, and
 * @param {THREE.Texture} [p.noise]   the water's noise: what the skins and the light on them are
 *                                    drawn with (without them an animal is plain)
 */
export function createFauna({
    U, pack, tier, lace = null, noise = null,
}) {
    const materials = createFaunaMaterials(U, { lace, noise });
    const mirror = tier.trace ? createSeaReflection(U) : null;
    const group = new THREE.Group();
    group.name = 'waves-life';
    const kinds = {};
    KINDS.forEach((kind) => {
        const body = pack?.kinds?.[kind];
        if (!body) return;
        const slots = slotsFor(kind, tier);
        const geometry = new THREE.InstancedBufferGeometry();
        Object.keys(body.geometry.attributes).forEach((name) => {
            geometry.setAttribute(name, body.geometry.attributes[name]);
        });
        geometry.setIndex(body.geometry.index);
        const data = new Float32Array(slots * FAUNA_STRIDE);
        for (let i = 0; i < slots; i += 1) park(data, i * FAUNA_STRIDE);
        const buffer = new THREE.InstancedInterleavedBuffer(data, FAUNA_STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        for (let r = 0; r < ROWS; r += 1) {
            geometry.setAttribute(`aRow${r}`, new THREE.InterleavedBufferAttribute(buffer, 4, r * 4));
        }
        geometry.instanceCount = 1;
        geometry.name = `waves-life:${kind}`;
        const inAir = new THREE.Mesh(geometry, materials.air);
        inAir.name = `waves-life:${kind}`;
        inAir.frustumCulled = false;
        inAir.renderOrder = 12;
        // The whale and the birds are never seen through the water: no second draw for them.
        const seenUnder = kind !== 'humpback' && kind !== 'seabird';
        let behind = null;
        if (seenUnder) {
            behind = new THREE.Mesh(geometry, materials.under);
            behind.name = `waves-life-under:${kind}`;
            behind.frustumCulled = false;
            behind.renderOrder = 11;
            group.add(behind);
        }
        let reflection = null;
        if (mirror && KIND[kind] <= KIND.humpback) {
            reflection = new THREE.Mesh(geometry, mirror);
            reflection.name = `waves-life-reflection:${kind}`;
            reflection.frustumCulled = false;
            reflection.renderOrder = 10;
            group.add(reflection);
        }
        group.add(inAir);
        kinds[kind] = {
            geometry,
            data,
            buffer,
            slots,
            triangles: body.triangles,
            inAir,
            behind,
            reflection,
            reflecting: false,
            shown: 0,
        };
    });
    return {
        mesh: group,
        materials,
        kinds,
        slots(kind) {
            return kinds[kind]?.slots ?? 0;
        },
        /** Stand the `i`th animal of a kind at a pose (null, or `metres` 0: not there). */
        set(kind, i, pose) {
            const entry = kinds[kind];
            if (!entry || i < 0 || i >= entry.slots) return;
            const { data } = entry;
            const at = i * FAUNA_STRIDE;
            if (!pose || !(pose.metres > 0)) {
                park(data, at);
                return;
            }
            data[at] = pose.x;
            data[at + 1] = pose.y;
            data[at + 2] = pose.z;
            data[at + 3] = pose.metres;
            data[at + 4] = pose.fx;
            data[at + 5] = pose.fy;
            data[at + 6] = pose.fz;
            data[at + 7] = pose.phase;
            data[at + 8] = pose.ux;
            data[at + 9] = pose.uy;
            data[at + 10] = pose.uz;
            data[at + 11] = pose.depth;
            data[at + 12] = pose.beat;
            data[at + 13] = pose.arch;
            data[at + 14] = pose.spread;
            data[at + 15] = pose.variant;
            if (entry.reflection && pose.y > -pose.metres * 0.55 && (kind === 'humpback' || pose.depth < 0.14)) {
                entry.reflecting = true;
            }
        },
        /** Send this frame's rows, and draw only as many of each kind as are there. */
        commit(counts) {
            Object.keys(kinds).forEach((kind) => {
                const entry = kinds[kind];
                const n = Math.min(entry.slots, counts?.[kind] ?? entry.slots);
                // The rows of what has gone are parked, so a row is always the truth ("metres 0:
                // not there"), not the last frame of an animal no longer drawn.
                for (let i = n; i < entry.shown; i += 1) park(entry.data, i * FAUNA_STRIDE);
                entry.shown = n;
                entry.geometry.instanceCount = Math.max(1, n);
                const shown = n > 0;
                entry.inAir.visible = shown;
                if (entry.behind) entry.behind.visible = shown;
                if (entry.reflection) entry.reflection.visible = shown && entry.reflecting;
                entry.reflecting = false;
                entry.buffer.needsUpdate = true;
            });
        },
        dispose() {
            group.removeFromParent();
            // (The pack's own geometries are shared by every world: only the instanced ones go.)
            Object.values(kinds).forEach((entry) => entry.geometry.dispose());
            materials.air.dispose();
            materials.under.dispose();
            mirror?.dispose();
        },
    };
}
