/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE BIRD RIG — the Blender birds (`odyssey-bird-models.js`, written by
 * `scripts/blender/odyssey/odyssey_birds.py`) decoded for the GPU, and their wings folded.
 *
 * There is no skeleton. Each vertex carries how much the shoulder, the wrist and the wingtip move
 * it (eased across a band at each joint, the bands widening toward the trailing edge), and a pose
 * is five hinge angles:
 *   lift  the arm's elevation about the body's long axis (+ raises the wingtip)
 *   sweep the arm swung back about the vertical (+ the tip goes back)
 *   bend  the hand's elevation about the wrist, relative to the arm
 *   fold  the hand swung back about the wrist
 *   curl  the wingtip bent up (+), carried by the tip weight
 * The fold turns the point about the wrist (fold, then bend + curl), then about the shoulder
 * (sweep, then lift); a normal turns the same way. `foldBirdNode` is the vertex stage's,
 * `foldBirdPoint` its CPU twin (the tests' stretch check), `fold()` in the script the previews'.
 */
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, faceDirection, float, length, mix, normalize, positionWorld,
    select, sin, smoothstep, vec3,
} from 'three/tsl';
import { ODYSSEY_BIRD_MODELS } from './odyssey-bird-models.js';

function decodeBase64(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

const srgbByteToLinear = (byte) => {
    const s = byte / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const decoded = new Map();

/**
 * One bird, decoded once (shared by every board): positions in metres (bird frame: x its left,
 * y up, z forward), unit normals, Uint16 triangles, hinge weights (arm, hand, tip, thin feather)
 * and the linear plumage seen from above (`top`) and from below (`under`), plus its rig
 * (`shoulder`, `wrist` pivots) and wingbeat numbers (`flight`).
 * @param {string} name a key of ODYSSEY_BIRD_MODELS ('gull', 'swallow', 'goose', ...)
 */
export function decodeBirdModel(name) {
    const cached = decoded.get(name);
    if (cached) return cached;
    const src = ODYSSEY_BIRD_MODELS[name];
    if (!src) throw new Error(`[OdysseyBirds] no bird model "${name}"`);
    const { quant } = ODYSSEY_BIRD_MODELS;
    const positions = Float32Array.from(decodeBase64(src.positions, Int16Array), (v) => v * quant);
    const normals = Float32Array.from(decodeBase64(src.normals, Int8Array), (v) => v / 127);
    for (let i = 0; i < normals.length; i += 3) {
        const n = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= n;
        normals[i + 1] /= n;
        normals[i + 2] /= n;
    }
    const model = Object.freeze({
        name,
        species: src.species,
        span: src.span,
        length: src.length,
        vertexCount: src.vertexCount,
        triangleCount: src.triangleCount,
        shoulder: src.shoulder,
        wrist: src.wrist,
        flight: src.flight,
        positions,
        normals,
        index: decodeBase64(src.index, Uint16Array),
        hinge: Float32Array.from(decodeBase64(src.hinge, Uint8Array), (v) => v / 255),
        top: Float32Array.from(decodeBase64(src.top, Uint8Array), srgbByteToLinear),
        under: Float32Array.from(decodeBase64(src.under, Uint8Array), srgbByteToLinear),
    });
    decoded.set(name, model);
    return model;
}

/**
 * The template attributes of one bird for an InstancedBufferGeometry (fresh BufferAttributes over
 * the shared decoded arrays: each draw owns its GPU buffers). Every bird has the same layout, so
 * one material draws any of them with one pipeline.
 */
export function setBirdTemplate(geometry, model, BufferAttribute) {
    geometry.setIndex(new BufferAttribute(model.index, 1));
    geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
    geometry.setAttribute('aHinge', new BufferAttribute(model.hinge, 4));
    geometry.setAttribute('aTop', new BufferAttribute(model.top, 3));
    geometry.setAttribute('aUnder', new BufferAttribute(model.under, 3));
    return geometry;
}

/**
 * The five hinge angles at beat phase `phi` (0 the top of the stroke) blended with the glide pose
 * by `weight` (0..1) — `wing_pose` in the script. A beat is the arm's lift L0 + LA cos phi and the
 * hand's own elevation H0 + HA cos(phi - lag) (the outer wing lags the inner), the hand folded
 * back on the upstroke and the tip curled up under the downstroke.
 */
export function birdWingPoseAt(model, phi, weight, out = {}) {
    const { glide: g, beat: k } = model.flight;
    const up = Math.max(0, -Math.sin(phi)) ** 2;
    const lift = k.lift[0] + (k.lift[1] * Math.cos(phi));
    const hand = k.hand[0] + (k.hand[1] * Math.cos(phi - k.lag));
    const beat = {
        lift,
        sweep: k.sweep[0] + (k.sweep[1] * up),
        bend: hand - lift,
        fold: k.fold[0] + (k.fold[1] * up),
        curl: k.curl * Math.max(0, Math.sin(phi)),
    };
    ['lift', 'sweep', 'bend', 'fold', 'curl'].forEach((n) => {
        out[n] = g[n] + ((beat[n] - g[n]) * weight);
    });
    return out;
}

const rot = (a, b, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [(a * c) - (b * s), (a * s) + (b * c)];
};

/**
 * CPU twin of `foldBirdNode`: a rest point `p` of the model (bird frame) with hinge weights `w`
 * (arm, hand, tip) under `pose` -> [x, y, z]. Pass a normal with `isNormal` (turned, not moved).
 */
export function foldBirdPoint(model, p, w, pose, isNormal = false) {
    const side = p[0] >= 0 ? 1 : -1;
    const [wx, wy, wz] = isNormal ? [0, 0, 0] : model.wrist;
    const [sx, sy, sz] = isNormal ? [0, 0, 0] : model.shoulder;
    let du = (p[0] * side) - wx;
    let dy = p[1] - wy;
    let dz = p[2] - wz;
    [du, dz] = rot(du, dz, -pose.fold * w[1]);
    [du, dy] = rot(du, dy, (pose.bend * w[1]) + (pose.curl * w[2]));
    du += wx - sx;
    dy += wy - sy;
    dz += wz - sz;
    [du, dz] = rot(du, dz, -pose.sweep * w[0]);
    [du, dy] = rot(du, dy, pose.lift * w[0]);
    return [side * (sx + du), sy + dy, sz + dz];
}

/**
 * The vertex stage's fold (TSL; call inside the position Fn). `position`, `normal`: the rest
 * point and normal (bird frame); `hinge`: the vec4 weights; `pose`: float nodes {lift, sweep,
 * bend, fold, curl}; `shoulder`, `wrist`: vec3 nodes (or arrays) of the pivots.
 * @returns {{ local: object, normal: object }} the folded point and normal, bird frame
 */
export function foldBirdNode({
    position, normal, hinge, pose, shoulder, wrist,
}) {
    const S = Array.isArray(shoulder) ? vec3(...shoulder) : shoulder;
    const W = Array.isArray(wrist) ? vec3(...wrist) : wrist;
    const side = select(position.x.lessThan(0.0), float(-1.0), float(1.0));
    const turn = (ang) => [cos(ang), sin(ang)];
    const [c1, s1] = turn(pose.fold.mul(hinge.y).negate());
    const [c2, s2] = turn(pose.bend.mul(hinge.y).add(pose.curl.mul(hinge.z)));
    const [c3, s3] = turn(pose.sweep.mul(hinge.x).negate());
    const [c4, s4] = turn(pose.lift.mul(hinge.x));
    // The point: about the wrist, then about the shoulder (mirrored onto the left wing's side).
    const du0 = position.x.mul(side).sub(W.x);
    const dy0 = position.y.sub(W.y);
    const dz0 = position.z.sub(W.z);
    const du1 = du0.mul(c1).sub(dz0.mul(s1));
    const dz1 = du0.mul(s1).add(dz0.mul(c1));
    const du2 = du1.mul(c2).sub(dy0.mul(s2));
    const dy2 = du1.mul(s2).add(dy0.mul(c2));
    const du3 = du2.add(W.x.sub(S.x));
    const dy3 = dy2.add(W.y.sub(S.y));
    const dz3 = dz1.add(W.z.sub(S.z));
    const du4 = du3.mul(c3).sub(dz3.mul(s3));
    const dz4 = du3.mul(s3).add(dz3.mul(c3));
    const du5 = du4.mul(c4).sub(dy3.mul(s4));
    const dy5 = du4.mul(s4).add(dy3.mul(c4));
    // The normal: the same turns, nothing moved.
    const nu0 = normal.x.mul(side);
    const nu1 = nu0.mul(c1).sub(normal.z.mul(s1));
    const nz1 = nu0.mul(s1).add(normal.z.mul(c1));
    const nu2 = nu1.mul(c2).sub(normal.y.mul(s2));
    const ny2 = nu1.mul(s2).add(normal.y.mul(c2));
    const nu3 = nu2.mul(c3).sub(nz1.mul(s3));
    const nz3 = nu2.mul(s3).add(nz1.mul(c3));
    const nu4 = nu3.mul(c4).sub(ny2.mul(s4));
    const ny4 = nu3.mul(s4).add(ny2.mul(c4));
    return {
        local: vec3(side.mul(S.x.add(du5)), S.y.add(dy5), S.z.add(dz4)),
        normal: vec3(side.mul(nu4), ny4, nz3),
    };
}

/**
 * The birds' light (TSL colour node), the act's as on the eagle: the sun from behind the camera's
 * shoulder on the backs and the near wings, the sky from above, what lies below bounced up under
 * the wings, a rim of sky on the edges so a bird keeps its shape, and the air between it and the
 * eye. The plumage is the one the eye sees: a wing or a tail shows its upperside on its front face
 * and its underside on its back face.
 * @param {object} o
 * @param {object} o.normal varying vec3: the folded normal, world
 * @param {object} o.speck varying vec3: x how far the bird has shrunk to a speck (the rim fades),
 *   y how much its plumage darkens toward its silhouette
 * @param {object} o.bounce varying or node vec3: the ground's colour bounced up under the wings
 * @param {object} o.sunColour vec3 node
 * @param {number[]} o.sunDir unit direction TOWARD the sun
 * @param {object} o.haze vec3 node: the air's colour
 * @param {number[]} o.hazeRange [from, to, most]: the air mixed in over range
 */
export function birdColourNode({
    normal, speck, bounce, sunColour, sunDir, haze, hazeRange,
}) {
    return Fn(() => {
        // Clamped: with MSAA a varying is read at the pixel centre even when only a corner sample
        // is covered, so on a sliver of a far wing it is extrapolated past its vertices' values.
        const top = clamp(attribute('aTop', 'vec3'), 0.0, 1.0);
        const under = clamp(attribute('aUnder', 'vec3'), 0.0, 1.0);
        const thin = clamp(attribute('aHinge', 'vec4').w, 0.0, 1.0);
        const facing = faceDirection;
        const far = clamp(speck, 0.0, 1.0);
        const albedo = mix(under, top, facing.mul(0.5).add(0.5)).mul(float(1).sub(far.y));
        const N = normalize(normal.add(vec3(0, 1e-5, 0))).mul(facing).toVar();
        const toEye = cameraPosition.sub(positionWorld);
        const V = normalize(toEye);
        const ndl = clamp(dot(N, vec3(...sunDir)), 0.0, 1.0);
        const skyUp = clamp(N.y, 0.0, 1.0);
        const groundUp = clamp(N.y.negate(), 0.0, 1.0);
        const ambient = haze.mul(skyUp.mul(0.22).add(0.18)).add(clamp(bounce, 0.0, 1.0).mul(groundUp.mul(0.45)));
        const lit = albedo.mul(sunColour.mul(ndl.mul(0.92)).add(ambient));
        const edge = float(1.0).sub(abs(dot(N, V)));
        const rim = haze.mul(edge.mul(edge).mul(edge).mul(thin.mul(0.14).add(0.06)))
            .mul(float(1).sub(far.x));
        const [from, to, most] = hazeRange;
        return mix(lit.add(rim), haze, smoothstep(float(from), float(to), length(toEye)).mul(most));
    })();
}
