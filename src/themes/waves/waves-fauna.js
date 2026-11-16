/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the sea life drawn: every animal of the pack (waves-cast.js), swum and lit.
 *
 * One instanced draw per kind and two materials for them all, so the whole cast costs two
 * pipelines:
 *
 *   air     what is out of the water: wet skin under the hour's sun and sky, the sea's green
 *           thrown up under it, the sun sliding along its back, its fins lit through when the sun
 *           stands behind them.
 *   under   what is behind the water's surface, drawn where the depth test FAILS (the animal is
 *           behind the wave the eye sees): its shape through the glass, dimmed and turned to the
 *           water's colour by the metres of sea over it, soft at its edge, gone below a few
 *           metres. Under the moon its edge burns with the sea's own cold light.
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
 *   the turtle            the front flippers row, the rear ones trail
 *   the flying fish       the tail sweeps side to side; the wings fold back or stand spread
 *   the seabird           the wings beat from the shoulder, the tips after the arms
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, atan, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, int, length, max, mix,
    normalize, positionGeometry, positionWorld, pow, reflect, round, select, sin, smoothstep, uniformArray, varying,
    vec3, vec4,
} from 'three/tsl';
import { KINDS, SPECIES } from './waves-acts.js';
import { wavesSky } from './waves-tsl.js';

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
 *   B = (the flukes' extra pitch / the wing's lag out along the span, the wings' set in a glide,
 *        -, -)
 */
const SWIM = {
    bottlenose: [[0.07, 4.2, 0.14, 0.12], [0.5, 0, 0, 0]],
    spinner: [[0.08, 4.4, 0.14, 0.12], [0.55, 0, 0, 0]],
    humpback: [[0.05, 4.4, 0.16, 0.1], [0.4, 0, 0, 0]],
    manta: [[0.16, 1.3, 0, 0], [2.2, 0, 0, 0]],
    turtle: [[0, 0, 0.6, 0], [0.4, 0.5, 0, 0]],
    flyingFish: [[0.07, 5.2, 0.08, 0.2], [0, 1.25, 0, 0]],
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
    flyingFish: [[0.62, 0.68, 0.74, 2.4], [0.9, 0.92, 0.94, -0.1], [0.05, 0.12, 0.28, 1], [0.5, 0.62, 0.75, 0.85]],
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

/**
 * The two materials every kind shares.
 * @param {object} U   the world's uniforms (sun, warm, light: the hour's colours, glow: 0..1 the
 *                     sea's own light at night)
 */
export function createFaunaMaterials(U) {
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
        const onRear = isPart(5).toVar();

        If(kindF.lessThan(2.5), () => {
            // ── Dolphins and the whale: up and down ──
            const trim = A.z.mul(beat).mul(sin(phase.mul(0.5).add(0.8))).mul(sgn).mul(onFlipper)
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
        }).ElseIf(kindF.lessThan(3.5), () => {
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
        }).ElseIf(kindF.lessThan(4.5), () => {
            // ── The turtle: the front flippers row, the rear ones trail ──
            const row = A.z.mul(beat).mul(sin(phase)).mul(sgn).mul(onFlipper)
                .mul(root);
            const sweep = B.y.mul(beat).mul(sin(phase.sub(0.9))).mul(sgn).mul(onFlipper)
                .mul(root);
            const trail = B.x.mul(0.4).mul(sin(phase.add(1.2))).mul(sgn).mul(onRear)
                .mul(root);
            local.assign(pivot.add(rotY(rotZ(local.sub(pivot), row.add(trail)), sweep)));
            nrm.assign(rotY(rotZ(nrm, row.add(trail)), sweep));
        })
            .ElseIf(kindF.lessThan(5.5), () => {
            // ── The flying fish: the wings fold back along the body or stand spread; the tail sculls ──
                const wings = onFlipper.add(onRear).mul(root);
                const fold = float(1.0).sub(spread).mul(B.y).mul(sgn)
                    .mul(wings);
                const flutter = sin(phase.mul(1.7)).mul(A.z).mul(spread).mul(sgn)
                    .mul(wings)
                    .mul(w);
                local.assign(pivot.add(rotZ(rotY(local.sub(pivot), fold), flutter)));
                nrm.assign(rotZ(rotY(nrm, fold), flutter));
                const amp = A.x.mul(beat);
                const h = bodyWave(s, phase, amp, A.y, A.w, 0.2);
                const h2 = bodyWave(s.add(0.01), phase, amp, A.y, A.w, 0.2);
                local.addAssign(vec3(h, 0.0, 0.0));
                nrm.assign(rotY(nrm, atan(h2.sub(h).div(0.01)).negate()));
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

    /** The animal's own colours, before any light. */
    const albedoOf = () => {
        const kind = int(round(aShape.w.mul(255.0)));
        const skin = attribute('aSkin', 'vec4');
        const back = skinBack.element(kind);
        const belly = skinBelly.element(kind);
        const accA = skinA.element(kind);
        const accB = skinB.element(kind);
        const shade = smoothstep(belly.w.sub(0.28), belly.w.add(0.28), vRestN.y);
        // No two animals are quite one grey.
        const own = vLook.x.sub(0.5).mul(0.3).add(1.0);
        const base = mix(belly.rgb, back.rgb, shade).mul(own);
        const painted = mix(mix(base, accA.rgb.mul(own), skin.y.mul(accA.w)), accB.rgb, skin.z.mul(accB.w));
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
        const behind = max(dot(sun, V.negate()), 0.0);
        const shine = vec3(3.2, 2.2, 1.2).mul(g8.mul(g8).mul(g2)).mul(gloss)
            .add(vec3(1.5, 0.9, 0.45).mul(rim.mul(rim).mul(rim)).mul(behind.mul(1.2).add(0.1)))
            .mul(light.fireTint);
        // A fin is thin: with the sun behind it, it glows through.
        // (A fin's tip, or the flying fish's wing membranes: its second mask.)
        const isFish = select(aShape.w.mul(255.0).greaterThan(4.5), 1.0, 0.0);
        const thin = max(smoothstep(0.25, 0.8, vLook.z), skin.z.mul(isFish));
        const through = sunLight.mul(albedo.add(0.08)).mul(thin).mul(behind.mul(behind).mul(0.9).add(0.12));
        const colour = lit.add(shine).add(through).mul(mix(vec3(1.0), vec3(1.12, 1.0, 0.84), warm)).toVar();
        // What is far out stands in the haze of the hour.
        const haze = wavesSky(normalize(vec3(V.x.negate(), 0.012, V.z.negate())), sun, float(0.0), warm, light);
        colour.assign(mix(colour, haze, float(1.0).sub(exp(dist.mul(-1 / 520)))));
        return vec4(colour, LIFE_MASK);
    })();

    // ── Behind the water ──
    const under = new THREE.MeshBasicNodeMaterial({
        fog: false, side: THREE.FrontSide, transparent: true, depthWrite: false,
    });
    under.name = 'waves-life-under';
    under.depthFunc = THREE.GreaterDepth;
    under.positionNode = position;
    under.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        const V = normalize(cameraPosition.sub(P)).toVar();
        const { albedo, skin } = albedoOf();
        const depth = max(vLook.y, 0.04).toVar();
        // What its own light keeps after the water over it, and the water's glow in front of it.
        const kept = exp(light.absorb.mul(depth.mul(-1.5))).toVar();
        const facing = clamp(dot(N, sun).mul(0.6).add(0.4), 0.0, 1.0);
        const own = albedo.mul(ambientOn(N).mul(1.3).add(sunLight.mul(facing).mul(0.3)))
            .mul(skin.x.mul(0.6).add(0.4));
        // (It stands in the water's light: a darker shape in the glass, its belly a little paler.)
        const veil = light.scatter.mul(vec3(0.3, 0.4, 0.5).mul(light.skyTint)).mul(0.5);
        const colour = own.mul(kept).mul(0.8).add(veil.mul(vec3(1.0).sub(kept))).toVar();
        const rim = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        // The sea's own light, at night: what moves through it burns cold along its edge.
        const shallow = float(1.0).sub(smoothstep(0.0, 2.6, depth));
        const cold = vec3(0.05, 0.5, 0.9).mul(U.glowing).mul(rim.mul(rim).mul(rim).mul(1.5).add(0.025)).mul(shallow);
        colour.addAssign(cold);
        // Soft at its edge (the water bends it), fainter the deeper it lies.
        const soft = smoothstep(0.0, 0.5, float(1.0).sub(rim));
        // Under the flat of the sea the eye looks along the water: most of what lies under it is
        // lost in the sky the surface mirrors, more the further off it is.
        const along = float(1.0).sub(clamp(abs(V.y), 0.0, 1.0));
        const a2 = along.mul(along);
        const mirrored = a2.mul(a2).mul(along).mul(float(1.0).sub(smoothstep(0.0, 0.35, P.y)));
        const edge = soft.mul(0.85).add(U.glowing.mul(rim.mul(rim)).mul(0.5));
        const alpha = float(1.0).sub(smoothstep(0.5, 3.2, depth)).mul(edge)
            .mul(float(1.0).sub(mirrored.mul(0.92)))
            .mul(0.94);
        return vec4(colour.mul(mix(vec3(1.0), vec3(1.1, 1.0, 0.86), warm)), clamp(alpha, 0.0, 1.0));
    })();

    return { air, under };
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
 */
export function createFauna({ U, pack, tier }) {
    const materials = createFaunaMaterials(U);
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
        group.add(inAir);
        kinds[kind] = {
            geometry, data, buffer, slots, triangles: body.triangles, inAir, behind, shown: 0,
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
                entry.buffer.needsUpdate = true;
            });
        },
        dispose() {
            group.removeFromParent();
            // (The pack's own geometries are shared by every world: only the instanced ones go.)
            Object.values(kinds).forEach((entry) => entry.geometry.dispose());
            materials.air.dispose();
            materials.under.dispose();
        },
    };
}
