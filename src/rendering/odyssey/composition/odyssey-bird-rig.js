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
 *
 * THE BEAT (2026-11-03, odyssey-bird-beats.js): keyframed in Blender per bird and fitted with a
 * short Fourier series per channel, so a beat is smooth at every order and has no seam: a quick
 * downstroke on a spread wing, the wrist flexing on the way up (the tip draws a loop), the hand
 * lagging the arm, the body rising against the beat (`heave`). A bird blends it with its glide
 * pose by a weight. The bouts that start and stop a beat (`birdBoutAt`) begin and end at
 * mid-upstroke, where the beat's pose is the glide's, and ease in and out with a C2 ramp.
 * THE TAIL: a point's `tail` weight (0 root .. 1 tip) carries the tail's fan (spread) and twist
 * (`tailBirdPoint`, `tailBirdNode`), which the turn drives.
 */
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, faceDirection, float, floor, fract, length, max, mix,
    normalize, positionWorld, select, sin, smoothstep, vec3, vec4,
} from 'three/tsl';
import { ODYSSEY_BIRD_BEATS } from './odyssey-bird-beats.js';
import { ODYSSEY_BIRD_MODELS } from './odyssey-bird-models.js';

/** The beat's channels, in the order the beats module lists them. */
export const BIRD_BEAT_CHANNELS = Object.freeze(['lift', 'sweep', 'bend', 'fold', 'curl', 'heave']);
const HINGES = Object.freeze(['lift', 'sweep', 'bend', 'fold', 'curl']);

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
 * y up, z forward), unit normals, Uint16 triangles, hinge weights (arm, hand, tip, thin feather),
 * tail weights, the linear plumage seen from above (`top`; `topTail` the same with the tail
 * weight in w, the vertex buffer) and from below (`under`), its rig (`shoulder`, `wrist` pivots,
 * `tailY` the tail's root height) and its wingbeat (`flight`: rate, downstroke share, glide pose
 * and the keyframed beat's series, odyssey-bird-beats.js).
 * @param {string} name a key of ODYSSEY_BIRD_MODELS ('gull', 'swallow', 'goose', ...)
 */
export function decodeBirdModel(name) {
    const cached = decoded.get(name);
    if (cached) return cached;
    const src = ODYSSEY_BIRD_MODELS[name];
    if (!src) throw new Error(`[OdysseyBirds] no bird model "${name}"`);
    const flight = ODYSSEY_BIRD_BEATS[name];
    if (!flight) throw new Error(`[OdysseyBirds] no wingbeat for "${name}"`);
    const { quant } = ODYSSEY_BIRD_MODELS;
    const positions = Float32Array.from(decodeBase64(src.positions, Int16Array), (v) => v * quant);
    const normals = Float32Array.from(decodeBase64(src.normals, Int8Array), (v) => v / 127);
    for (let i = 0; i < normals.length; i += 3) {
        const n = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= n;
        normals[i + 1] /= n;
        normals[i + 2] /= n;
    }
    const top = Float32Array.from(decodeBase64(src.top, Uint8Array), srgbByteToLinear);
    const tail = Float32Array.from(decodeBase64(src.tail, Uint8Array), (v) => v / 255);
    // The plumage seen from above with the tail weight packed in w: no extra vertex buffer.
    const topTail = new Float32Array(src.vertexCount * 4);
    for (let i = 0; i < src.vertexCount; i += 1) {
        topTail.set([top[i * 3], top[(i * 3) + 1], top[(i * 3) + 2], tail[i]], i * 4);
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
        tailY: src.tailY,
        flight,
        positions,
        normals,
        index: decodeBase64(src.index, Uint16Array),
        hinge: Float32Array.from(decodeBase64(src.hinge, Uint8Array), (v) => v / 255),
        tail,
        top,
        topTail,
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
    geometry.setAttribute('aTop', new BufferAttribute(model.topTail, 4));
    geometry.setAttribute('aUnder', new BufferAttribute(model.under, 3));
    return geometry;
}

// -- the beat, on the CPU (the tests, the review exporter) -----------------------------------------

/** A channel's Fourier series (odyssey-bird-beats.js) at phase `phi` (radians). */
export function beatSeriesAt(coef, phi) {
    let v = coef[0];
    for (let k = 1; (2 * k) < coef.length; k += 1) {
        v += (coef[(2 * k) - 1] * Math.cos(k * phi)) + (coef[2 * k] * Math.sin(k * phi));
    }
    return v;
}

/**
 * The hinge angles and the body's heave at beat phase `phi` (radians, 0 the top of the stroke)
 * blended with the glide pose by `weight` (0..1) — `wing_pose` in the script. `flex` (optional)
 * is added to the glide pose first: the held wing flexing on the air.
 */
export function birdWingPoseAt(model, phi, weight, out = {}, flex = null) {
    const { glide, cycle } = model.flight;
    for (let i = 0; i < HINGES.length; i += 1) {
        const n = HINGES[i];
        const held = glide[n] + (flex ? (flex[n] || 0) : 0);
        out[n] = held + ((beatSeriesAt(cycle[n], phi) - held) * weight);
    }
    out.heave = beatSeriesAt(cycle.heave, phi) * weight;
    return out;
}

/** Quintic smootherstep (C2: the acceleration does not jump where it starts or ends). */
export function smootherstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * t * ((t * ((t * 6) - 15)) + 10);
}

/** A hash in [0, 1) that the vertex stage computes alike (no sine: steady for big inputs). */
export function birdHash(x) {
    let p = (x * 0.1031) - Math.floor(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return p - Math.floor(p);
}

/**
 * A bird's bouts of beats between glides (the gulls', the vultures'): every `period` seconds
 * (each bird its own, from `seed`) one bout of `beats` beats (each bout its own count), at a time
 * of its own in the period. A bout starts at `start` of a beat (mid-upstroke: the beat's pose is
 * the glide's there) with its weight rising over `rise` beats; after its last downstroke it eases
 * out over `fall` beats, ending `tail` beats past the count. C2 everywhere; the phase jumps only
 * where the weight is 0. The vertex stage's `birdBoutNode`.
 * @returns {{weight:number, phase:number}} phase in beats
 */
export function birdBoutAt(t, seed, cfg, out = { weight: 0, phase: 0 }) {
    const [p0, p1] = cfg.period;
    const P = p0 + ((p1 - p0) * birdHash((seed * 131.7) + 3.1));
    const u = (t / P) + birdHash((seed * 71.3) + 9.7);
    const n = Math.floor(u);
    const tau = (u - n) * P;
    const [b0, b1] = cfg.beats;
    const beats = b0 + Math.floor(birdHash(n + (seed * 17.13)) * ((b1 - b0) + 0.999));
    const longest = (b1 + cfg.tail) / cfg.rate;
    const at = birdHash((n * 1.37) + (seed * 29.1) + 0.5) * Math.max(P - longest, 0);
    const c = (tau - at) * cfg.rate;
    const end = beats + cfg.tail;
    out.weight = smootherstep(0, cfg.rise, c) * (1 - smootherstep(end - cfg.fall, end, c));
    out.phase = cfg.start + c;
    return out;
}

/** CPU twin of `tailBirdNode`: a rest point fanned and twisted by its tail weight. */
export function tailBirdPoint(model, p, tail, spread, twist) {
    if (!(tail > 0)) return p;
    const x = p[0] * (1 + (spread * tail));
    const dy = p[1] - model.tailY;
    const a = twist * tail;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [(x * c) - (dy * s), model.tailY + (x * s) + (dy * c), p[2]];
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

// -- the beat in the vertex stage (TSL; call these inside the position Fn) -------------------------

/** A channel's series packed as three vec4s: (a0 a1 b1 a2) (b2 a3 b3 a4) (b4 a5 b5 0). */
export function packBeatSeries(coef) {
    const c = [...coef, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 12);
    return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)];
}

/** One bird's packed series as constant vec4 nodes: channel -> [A, B, C]. */
export function beatSeriesConstants(model) {
    return Object.fromEntries(BIRD_BEAT_CHANNELS.map((ch) => [
        ch, packBeatSeries(model.flight.cycle[ch]).map((v) => vec4(...v)),
    ]));
}

/** cos k phi and sin k phi for k = 1..5, from one cos and one sin (vars). */
export function beatHarmonicsNode(phi) {
    const c1 = cos(phi).toVar();
    const s1 = sin(phi).toVar();
    const c2 = c1.mul(c1).sub(s1.mul(s1)).toVar();
    const s2 = s1.mul(c1).mul(2.0).toVar();
    const c3 = c2.mul(c1).sub(s2.mul(s1)).toVar();
    const s3 = s2.mul(c1).add(c2.mul(s1)).toVar();
    const c4 = c2.mul(c2).sub(s2.mul(s2)).toVar();
    const s4 = s2.mul(c2).mul(2.0).toVar();
    const c5 = c4.mul(c1).sub(s4.mul(s1)).toVar();
    const s5 = s4.mul(c1).add(c4.mul(s1)).toVar();
    return [c1, s1, c2, s2, c3, s3, c4, s4, c5, s5];
}

/** A channel at the harmonics `h` from its packed series [A, B, C] (vec4 nodes). */
export function beatSeriesNode([A, B, C], h) {
    return A.x.add(A.y.mul(h[0])).add(A.z.mul(h[1])).add(A.w.mul(h[2])).add(B.x.mul(h[3]))
        .add(B.y.mul(h[4]))
        .add(B.z.mul(h[5]))
        .add(B.w.mul(h[6]))
        .add(C.x.mul(h[7]))
        .add(C.y.mul(h[8]))
        .add(C.z.mul(h[9]));
}

/** `smootherstep` in the vertex stage (edges may be numbers or nodes). */
export function smootherstepNode(e0, e1, x) {
    const t = clamp(x.sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
    return t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0));
}

/** `birdHash` in the vertex stage. */
export function birdHashNode(x) {
    const p0 = fract(x.mul(0.1031));
    const p1 = p0.mul(p0.add(33.33));
    return fract(p1.mul(p1.add(p1)));
}

/** `birdBoutAt` in the vertex stage -> { weight, phase } (phase in beats) as nodes. */
export function birdBoutNode(t, seed, cfg) {
    const [p0, p1] = cfg.period;
    const P = birdHashNode(seed.mul(131.7).add(3.1)).mul(p1 - p0).add(p0);
    const u = t.div(P).add(birdHashNode(seed.mul(71.3).add(9.7)));
    const n = floor(u);
    const tau = u.sub(n).mul(P);
    const [b0, b1] = cfg.beats;
    const beats = floor(birdHashNode(n.add(seed.mul(17.13))).mul((b1 - b0) + 0.999)).add(b0);
    const longest = (b1 + cfg.tail) / cfg.rate;
    const at = birdHashNode(n.mul(1.37).add(seed.mul(29.1)).add(0.5)).mul(max(P.sub(longest), 0.0));
    const c = tau.sub(at).mul(cfg.rate).toVar();
    const end = beats.add(cfg.tail);
    const weight = smootherstepNode(0.0, cfg.rise, c).mul(float(1.0).sub(smootherstepNode(end.sub(cfg.fall), end, c)));
    return { weight, phase: c.add(cfg.start) };
}

/**
 * The tail fanned and twisted (the twin: tailBirdPoint): `tail` the point's weight, `spread` and
 * `twist` float nodes, `tailY` the tail's root height. The normal turns with the twist.
 * @returns {{ position: object, normal: object }}
 */
export function tailBirdNode({
    position, normal, tail, spread, twist, tailY,
}) {
    const x = position.x.mul(spread.mul(tail).add(1.0));
    const dy = position.y.sub(tailY);
    const a = twist.mul(tail);
    const c = cos(a);
    const s = sin(a);
    return {
        position: vec3(x.mul(c).sub(dy.mul(s)), x.mul(s).add(dy.mul(c)).add(tailY), position.z),
        normal: vec3(normal.x.mul(c).sub(normal.y.mul(s)), normal.x.mul(s).add(normal.y.mul(c)), normal.z),
    };
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
 *   y how much its plumage darkens toward its silhouette, z how much less air it takes on
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
        const top = clamp(attribute('aTop', 'vec4').xyz, 0.0, 1.0);
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
        // The air with distance; a far speck keeps more of its dark silhouette (speck.z cuts it).
        const [from, to, most] = hazeRange;
        const air = smoothstep(float(from), float(to), length(toEye)).mul(most).mul(float(1).sub(far.z));
        return mix(lit.add(rim), haze, air);
    })();
}
