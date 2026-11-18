/**
 * Rainbark — the beam field: the sun through the canopy, standing in the haze.
 *
 * The air of the grove was one even field of light, gold toward the sun. Light through leaves is
 * never even: it comes down in beams, each the image of an opening in the crowns, and what makes a
 * misty forest read as deep is those beams at every distance, the trunks dark in front of some and
 * veiled behind others. This draws them (BEAMS, beamField in the core): a strip along the sun's
 * ray per beam, turned to face the camera round it (geometry, never a screen-space god ray: the
 * trunks' depth hides and veils it truly, and the camera's breath gives it parallax), lit per
 * vertex by the sun forward-scattered toward the eye, the haze's density along it and the air in
 * front of it. Across it, per fragment, a bundle of rays (sharper toward its core) with the vapour
 * drifting through it.
 *
 * It lives: each beam breathes on its own clock (dark a share of the time), so the set of beams in
 * the frame is never the same for long; and `u.beamGain` (the world's: the light wheel's mood, the
 * tide, a sunbreak, the big moments of play) raises and lowers them all.
 *
 * Additive (vec4(rgb, 0)), depth-tested. Every beam is drawn on every frame (a dark one costs its
 * vertices only: its strip has no width), so the first frame compiles the pipeline and the scene
 * never changes after it is built.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    screenUV,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BEAMS,
    TAU,
    beamField,
    rbAirTransmittance,
    rbFxMaterial,
    rbHgMix,
    rbPart,
} from './rainbark-tsl.js';

/** Segments along a beam (its light and air are found per vertex). */
const BEAM_SEGMENTS = 14;
/** Floats per beam: (across, depth, width, rise) and (salt, 2π/period, phase, 0). */
export const BEAM_STRIDE = 8;
/** The beams draw first among the additive effects: the shafts, the drops and the motes over them. */
const BEAM_ORDER = 71;

/** The instance records of the first `count` beams of the field. */
export function beamRecords(count) {
    const field = beamField(count);
    const data = new Float32Array(field.length * BEAM_STRIDE);
    field.forEach((b, i) => {
        data.set([b.across, b.depth, b.width, b.rise, b.salt, TAU / b.period, b.phase, 0], i * BEAM_STRIDE);
    });
    return { data, count: field.length };
}

function stripGeometry(records) {
    const corners = [];
    for (let j = 0; j <= BEAM_SEGMENTS; j++) corners.push(-1, j / BEAM_SEGMENTS, 0, 1, j / BEAM_SEGMENTS, 0);
    const index = [];
    for (let j = 0; j < BEAM_SEGMENTS; j++) {
        const a = j * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex(index);
    const buffer = new THREE.InstancedInterleavedBuffer(records, BEAM_STRIDE, 1);
    geometry.setAttribute('aBeam', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aBeamLook', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = records.length / BEAM_STRIDE;
    return geometry;
}

/**
 * How lit a beam is at time t (0 … 1): two sines on its own clock, dark `rest` of the time. The
 * CPU twin of the vertex stage's (tests read it).
 */
export function beamBreath(t, rate, phase, rest = BEAMS.rest) {
    const s = Math.sin(t * rate + phase) * 0.62 + Math.sin(t * rate * 1.618 + phase * 2.3) * 0.38;
    const x = Math.max(0, Math.min(1, (s * 0.5 + 0.5 - rest) / (1 - rest)));
    return x * x * (3 - 2 * x);
}

/**
 * The beam field's draw.
 * @param {object} u      the shared uniforms (with textures: the lattice noise)
 * @param {number} count  beams (the tier's)
 */
export function createBeams(u, count) {
    const records = beamRecords(count);
    const geometry = stripGeometry(records.data);
    const material = rbFxMaterial('RainbarkBeams');
    const aBeam = attribute('aBeam', 'vec4');
    const aLook = attribute('aBeamLook', 'vec4');
    const vAcross = varying(float(0.0), 'rbBeamAcross');
    const vAt = varying(vec3(0.0), 'rbBeamAt');
    const vCol = varying(vec3(0.0), 'rbBeamLight');
    const vSalt = varying(float(0.0), 'rbBeamSalt');
    const B = BEAMS;

    material.positionNode = Fn(() => {
        const L = u.sunDir;
        const depth = aBeam.y;
        // Where it crosses the eye's storey: a place across the lens at its depth (the same share
        // of any frame, upright or wide), a little over or under the eye.
        const anchor = vec3(aBeam.x.mul(depth).mul(u.tanHalf.x), u.camY.add(aBeam.w), depth.negate()).toVar();
        // Its breath: its own clock, dark a share of the time.
        const s = sin(u.time.mul(aLook.y).add(aLook.z)).mul(0.62)
            .add(sin(u.time.mul(aLook.y).mul(1.618).add(aLook.z.mul(2.3))).mul(0.38));
        const breath = smoothstep(0.0, 1.0, s.mul(0.5).add(0.5).sub(B.rest).div(1 - B.rest)).toVar();
        const lit = breath.mul(u.beamGain).toVar();
        // (From an eye down in the mist the beams come on down through it to the eye's own depth,
        // fading with the vapour over them: god-rays in the pearl, never a blank white.)
        const foot = u.tide.add(B.bottom).min(u.camY.sub(B.under)).toVar();
        const head = u.camY.add(B.top + B.soften);
        const y = mix(foot, head, positionGeometry.y).toVar();
        const onRay = anchor.add(L.mul(y.sub(anchor.y).div(max(L.y, 0.2)))).toVar();
        const toEye = normalize(cameraPosition.sub(onRay));
        const side = normalize(cross(L, toEye).add(vec3(1e-6, 0.0, 0.0)));
        // (A dark beam has no width: it costs its vertices only.)
        const width = aBeam.z.mul(depth).mul(step(0.004, lit));
        const P = onRay.add(side.mul(positionGeometry.x.mul(width).mul(0.5))).toVar();
        const ends = smoothstep(foot, foot.add(B.soften), y)
            .mul(float(1.0).sub(smoothstep(u.camY.add(B.top), head, y)));
        const density = exp(clamp(y.sub(u.hazeY), 0.0, 400.0).div(u.scaleHeight).negate())
            .mul(exp(clamp(u.tide.sub(y), 0.0, 200.0).div(-B.sink)));
        const scatter = rbHgMix(dot(toEye.negate(), L), float(B.g)).toVar();
        // (In the shade a beam still reads: cooler and fainter, never gone.)
        const toward = max(scatter, B.floor);
        const cool = float(1.0).sub(smoothstep(B.floor, B.floor * 2.2, scatter));
        const tint = mix(vec3(1.0), vec3(...B.shade), cool);
        const shine = toward.mul(density).mul(ends).mul(rbAirTransmittance(u, P)).mul(B.k)
            .mul(lit)
            .mul(u.fleckLight);
        vCol.assign(u.sunCol.mul(tint).mul(shine));
        vAcross.assign(positionGeometry.x);
        vAt.assign(P);
        vSalt.assign(aLook.x);
        return P;
    })();

    material.colorNode = Fn(() => {
        const x = clamp(vAcross, -1.0, 1.0);
        const soft = float(1.0).sub(x.mul(x));
        // A bundle of rays across it: broad at its edges, finer and deeper toward its core.
        const across = x.mul(B.rays.across).add(vSalt.mul(31.0));
        const rayA = u.noise3(vec3(across, vSalt.mul(7.0), u.time.mul(0.021).add(vSalt.mul(3.0)))).x;
        const rayB = u.noise3(vec3(across.mul(2.7).add(11.3), vSalt.mul(13.0), u.time.mul(0.034))).y;
        const rays = smoothstep(0.22, 0.78, rayA.mul(0.65).add(rayB.mul(0.35)));
        const bundle = mix(float(1.0 - B.rays.depth), float(1.0 + B.rays.depth * 0.5), rays);
        // The vapour drifting through it (world-fixed, so the beam is a volume, never a decal).
        const V = B.vapour;
        const drift = vec3(u.time.mul(V.drift), u.time.mul(V.drift * -0.3), u.time.mul(V.drift * 0.2));
        const vap = u.noise3(vAt.add(drift).div(V.grain)).x;
        const vapour = mix(float(1.0 - V.depth), float(1.0 + V.depth * 0.6), smoothstep(0.2, 0.8, vap));
        // Out of the card's band.
        const r = u.cardRect;
        const away = max(max(r.x.sub(screenUV.x), screenUV.x.sub(r.z)), max(r.y.sub(screenUV.y), screenUV.y.sub(r.w)));
        const clear = smoothstep(B.card[0], B.card[1], away);
        const profile = soft.mul(soft).mul(bundle).mul(vapour).mul(clear);
        return vec4(max(vCol, vec3(0.0)).mul(profile), 0.0);
    })();

    const part = rbPart('RainbarkBeams', geometry, material, BEAM_ORDER);
    part.count = records.count;
    return part;
}
