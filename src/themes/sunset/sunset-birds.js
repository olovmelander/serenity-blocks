/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the flock a chain of clears calls across the light.
 *
 * Common gulls in a loose skein come in from one edge of the frame, cross in front of the sun
 * (the moon by night) a little above it and fly on out of the other side. The bird is the
 * theme's own, modelled, rigged and animated in Blender (scripts/blender/sunset_gull.py writes
 * sunset-gull-model.js): a round head and a slim bill, a short square tail, long narrow wings bent
 * at the wrist, nine bones. Its wingbeat is Blender's keyframed "Flap" action sampled into
 * FLAP_ROWS poses, and its glide the "Glide" pose. Per bird per frame, on the CPU, each joint's
 * turn is blended between two rows of the bird's own beat and toward the glide, chained from the
 * body out, then banked, turned to the bird's heading and carried to its place: nine finished
 * bones in the bird's row of a small float table. The vertex stage skins each vertex to two of
 * them. Nothing is loaded: the model is in the bundle.
 *
 * The light is the hour's: the sky the feathers face (the theme's own sky colour along the
 * normal) and the sea's dim light from under them, the sun (or the moon) on the faces turned to
 * it with the colour the hour gives a sunlit cloud, the thin feathers lit through only when a
 * bird crosses the disc itself, and a thin rim round the outline against the light. So the
 * skein is black against the fire at sunset and white gulls by day.
 *
 * The table carries each bird's whole transform and the vertex stage applies it: a positionNode's
 * output is final, so an instance matrix would be lost.
 *
 * The skein comes in whole from beyond one edge of the frame and flies out past the other: no bird
 * appears or vanishes in sight, and every bird keeps the skein's pace. A chain keeps calling: a
 * flock still coming in takes the newcomers straight into their places at its tail while those
 * places are still out of sight (so the skein grows with the chain and still comes in as one), and
 * a call once its tail is in sight sets out a new flight on a line of its own, over or under the
 * first. Nothing ever restarts a flock in the air, and no bird is ever seen racing to catch up
 * (latecomers that closed a gap behind the skein in plain sight looked wrong).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cross, dot, faceDirection, float, floor, instanceIndex, int, ivec2, max,
    mix, normalize, positionGeometry, positionWorld, pow, smoothstep, textureLoad, varying, vec3, vec4,
} from 'three/tsl';
import { mulberry32, smooth } from './sunset-core.js';
import { SUNSET_GULL } from './sunset-gull-model.js';
import { skyBase } from './sunset-tsl.js';

/**
 * How far from the eye the skein flies (metres), and how fast along its line (metres a second:
 * about three degrees of the frame a second, so it takes some 27 s to cross a wide frame).
 */
export const FLOCK_RANGE = 58;
export const FLOCK_SPEED = 3;
const RATE = FLOCK_SPEED / FLOCK_RANGE;
/** Flights in the air at once (they share the instances), and the fewest birds worth a new one. */
export const FLIGHTS = 3;
const MIN_FLIGHT = 3;
/**
 * How long a called flock flies out of sight before its leader comes in (seconds): the calls of a
 * chain in that time fill its skein unseen, so a quick chain comes in as one skein.
 */
export const LEAD_SECONDS = 6;
/**
 * How far past the frame's edge (degrees, beyond a bird's own wingtip) the skein counts as out of
 * sight: the swell, the pointer and the breath turn the view two degrees at most.
 */
export const OUT_OF_SIGHT = 4;
/** How much larger than life the skein flies (the model is a real 1.33 m gull). */
export const GULL_SCALE = 2.1;

/** How the light falls on the birds (shares of the hour's colours). */
export const TONE = Object.freeze({
    sky: 1.0,
    sea: 0.55,
    seaSun: 0.2,
    /** The shaded side's share left when the bird is seen against a low light. */
    against: 0.12,
    key: 0.85,
    /** The sunlit side's share left then (a raised wing catching the low sun). */
    keyAgainst: 0.5,
    through: 0.5,
    rim: 0.06,
});

/** The wingbeat's rows in the pose table; the glide is the row after them. */
export const FLAP_ROWS = SUNSET_GULL.flapRows;
const BONES = SUNSET_GULL.bones.length;
const PARENTS = SUNSET_GULL.parents;
const PIVOTS = SUNSET_GULL.pivots;

// ── The model ─────────────────────────────────────────────────────────────────────────────

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

// Quaternions as [x, y, z, w].
function qMul(a, b, out) {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
}

/** v turned by q: v + 2 q.xyz × (q.xyz × v + w v). */
function rotate(q, v, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    const cx = y * v[2] - z * v[1] + w * v[0];
    const cy = z * v[0] - x * v[2] + w * v[1];
    const cz = x * v[1] - y * v[0] + w * v[2];
    const rx = v[0] + 2 * (y * cz - z * cy);
    const ry = v[1] + 2 * (z * cx - x * cz);
    const rz = v[2] + 2 * (x * cy - y * cx);
    out[0] = rx;
    out[1] = ry;
    out[2] = rz;
    return out;
}

/**
 * Blender's rows (each bone's deform, rest to pose) as each bone's turn about its own joint
 * relative to its parent, and how far the joint moved besides (the head is held steady while the
 * body rises and falls); the body's rows stay whole. Blending these, joint by joint, keeps every
 * joint where its parent holds it in any blend of the beat and the glide (blending the deforms
 * themselves pulled the wrist apart, 1.9 times its skin, halfway into a glide).
 */
function jointRows(poses) {
    const out = new Float32Array(poses.length);
    const q = [0, 0, 0, 1];
    const qp = [0, 0, 0, 1];
    const ql = [0, 0, 0, 1];
    const v = [0, 0, 0];
    for (let r = 0; r <= FLAP_ROWS; r += 1) {
        for (let b = 0; b < BONES; b += 1) {
            const o = (r * BONES + b) * 8;
            const p = PARENTS[b];
            if (p < 0) {
                out.set(poses.subarray(o, o + 8), o);
            } else {
                for (let k = 0; k < 4; k += 1) q[k] = poses[o + k];
                const op = (r * BONES + p) * 8;
                qp[0] = -poses[op];
                qp[1] = -poses[op + 1];
                qp[2] = -poses[op + 2];
                qp[3] = poses[op + 3];
                qMul(qp, q, ql);
                const sign = ql[3] < 0 ? -1 : 1;
                // e = (the parent's deform)⁻¹(the child's deform(h)) − h
                const h = PIVOTS[b];
                rotate(q, h, v);
                for (let k = 0; k < 3; k += 1) v[k] += poses[o + 4 + k] - poses[op + 4 + k];
                rotate(qp, v, v);
                out.set([
                    ql[0] * sign, ql[1] * sign, ql[2] * sign, ql[3] * sign, v[0] - h[0], v[1] - h[1], v[2] - h[2], 0,
                ], o);
            }
        }
    }
    return out;
}

let decoded = null;

/**
 * The gull, decoded once: rest positions (metres, game frame: x its left, y up, z forward),
 * triangles, its two bones and the first one's weight per vertex, its plumage, Blender's pose
 * rows (per row, per bone: qx, qy, qz, qw, tx, ty, tz, 1) and the same rows joint by joint.
 */
export function gullModel() {
    if (decoded) return decoded;
    const { quant } = SUNSET_GULL;
    const poses = decode(SUNSET_GULL.poses, Float32Array);
    decoded = Object.freeze({
        positions: Float32Array.from(decode(SUNSET_GULL.positions, Int16Array), (v) => v * quant),
        index: decode(SUNSET_GULL.index, Uint16Array),
        skin: decode(SUNSET_GULL.skin, Uint8Array),
        colours: decode(SUNSET_GULL.colours, Uint8Array),
        poses,
        joints: jointRows(poses),
        vertexCount: SUNSET_GULL.vertexCount,
        triangleCount: SUNSET_GULL.triangleCount,
        bones: BONES,
        rows: FLAP_ROWS + 1,
        span: SUNSET_GULL.span,
        checks: SUNSET_GULL.checks,
    });
    return decoded;
}

/** The gull's mesh for the flock: rest positions, normals, plumage and skin; no instances yet. */
export function buildBirdGeometry() {
    const m = gullModel();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(m.index, 1));
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(m.colours, 4, true));
    geometry.setAttribute('skin', new THREE.BufferAttribute(m.skin, 4, true));
    geometry.instanceCount = 0;
    return geometry;
}

// ── The pose ──────────────────────────────────────────────────────────────────────────────

const ROW_FLOATS = BONES * 8;
const scratch = {
    q: [0, 0, 0, 1], e: [0, 0, 0], tl: [0, 0, 0], qp: [0, 0, 0, 1], qd: [0, 0, 0, 1], v: [0, 0, 0],
};

/**
 * The bird's nine bones at wingbeat `cycle` (turns; 0 is the top of the stroke) with `glide`
 * (0 flapping .. 1 gliding): each joint's turn blended between two neighbouring rows and then
 * toward the glide, chained from the body out. Writes each bone's deform (qx, qy, qz, qw, tx, ty,
 * tz, 0) into `out`.
 */
export function gullPose(cycle, glide, out = new Float32Array(ROW_FLOATS)) {
    const { joints } = gullModel();
    const f = (cycle - Math.floor(cycle)) * FLAP_ROWS;
    const r0 = Math.min(FLAP_ROWS - 1, Math.floor(f));
    const a = f - r0;
    const r1 = (r0 + 1) % FLAP_ROWS;
    const {
        q, e, tl, qp, qd, v,
    } = scratch;
    for (let b = 0; b < BONES; b += 1) {
        const o0 = r0 * ROW_FLOATS + b * 8;
        const o1 = r1 * ROW_FLOATS + b * 8;
        const og = FLAP_ROWS * ROW_FLOATS + b * 8;
        let len = 0;
        for (let k = 0; k < 4; k += 1) {
            const flap = joints[o0 + k] + (joints[o1 + k] - joints[o0 + k]) * a;
            q[k] = flap + (joints[og + k] - flap) * glide;
            len += q[k] * q[k];
        }
        len = Math.sqrt(len) || 1;
        for (let k = 0; k < 4; k += 1) q[k] /= len;
        for (let k = 0; k < 3; k += 1) {
            const flap = joints[o0 + 4 + k] + (joints[o1 + 4 + k] - joints[o0 + 4 + k]) * a;
            e[k] = flap + (joints[og + 4 + k] - flap) * glide;
        }
        const ob = b * 8;
        const p = PARENTS[b];
        if (p < 0) {
            for (let k = 0; k < 4; k += 1) out[ob + k] = q[k];
            for (let k = 0; k < 3; k += 1) out[ob + 4 + k] = e[k];
            out[ob + 7] = 0;
        } else {
            // The joint's own turn about its pivot h, then its parent's deform:
            // L(x) = R(x − h) + h + e, D = Dparent ∘ L.
            const h = PIVOTS[b];
            rotate(q, h, v);
            for (let k = 0; k < 3; k += 1) tl[k] = h[k] + e[k] - v[k];
            const op = p * 8;
            for (let k = 0; k < 4; k += 1) qp[k] = out[op + k];
            qMul(qp, q, qd);
            rotate(qp, tl, v);
            for (let k = 0; k < 4; k += 1) out[ob + k] = qd[k];
            for (let k = 0; k < 3; k += 1) out[ob + 4 + k] = v[k] + out[op + 4 + k];
            out[ob + 7] = 0;
        }
    }
    return out;
}

/** Vertex `i` of the gull at wingbeat `cycle` with `glide`, in the bird's own frame (metres). */
export function gullVertex(i, cycle, glide, pose = gullPose(cycle, glide)) {
    const m = gullModel();
    const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const out = [0, 0, 0];
    const r = [0, 0, 0];
    for (let k = 0; k < 2; k += 1) {
        const o = m.skin[i * 4 + k] * 8;
        const w = k === 0 ? m.skin[i * 4 + 2] / 255 : 1 - m.skin[i * 4 + 2] / 255;
        rotate([pose[o], pose[o + 1], pose[o + 2], pose[o + 3]], p, r);
        for (let c = 0; c < 3; c += 1) out[c] += (r[c] + pose[o + 4 + c]) * w;
    }
    return out;
}

/**
 * The turn that carries the bird's own frame (x its left, y up, z forward) into the world:
 * banked by `bank` about its body, then turned to `heading` (radians, as the world's bearings:
 * forward becomes (sin h, 0, −cos h)).
 */
export function flightTurn(heading, bank, out = [0, 0, 0, 1]) {
    const sy = Math.sin((Math.PI - heading) * 0.5);
    const cy = Math.cos((Math.PI - heading) * 0.5);
    const sr = Math.sin(bank * 0.5);
    const cr = Math.cos(bank * 0.5);
    // (0, sy, 0, cy) · (0, 0, sr, cr)
    out[0] = sy * sr;
    out[1] = sy * cr;
    out[2] = cy * sr;
    out[3] = cy * cr;
    return out;
}

/** Carry a bird's bones (`pose`) into the world by `turnQ`, about `place` at `size`, into `out`. */
function placeBones(pose, turnQ, place, size, out, at) {
    const tq = scratch.qd;
    const tv = scratch.v;
    for (let j = 0; j < BONES; j += 1) {
        const o = j * 8;
        for (let k = 0; k < 4; k += 1) scratch.qp[k] = pose[o + k];
        qMul(turnQ, scratch.qp, tq);
        tv[0] = pose[o + 4];
        tv[1] = pose[o + 5];
        tv[2] = pose[o + 6];
        rotate(turnQ, tv, tv);
        const ob = at + o;
        for (let k = 0; k < 4; k += 1) out[ob + k] = tq[k];
        for (let k = 0; k < 3; k += 1) out[ob + 4 + k] = place[k] + tv[k] * size;
        out[ob + 7] = size;
    }
}

// ── The flock ─────────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

export function createFlock({ count, U, seed = 29 }) {
    const geometry = buildBirdGeometry();
    // Every bird's nine bones, finished (its pose, its turn, its place and size): a row a bird,
    // two texels a bone (the rotation; the place and the size).
    const rows = Math.max(1, count);
    const bones = new Float32Array(rows * BONES * 8);
    const table = new THREE.DataTexture(bones, BONES * 2, rows, THREE.RGBAFormat, THREE.FloatType);
    table.minFilter = THREE.NearestFilter;
    table.magFilter = THREE.NearestFilter;
    table.generateMipmaps = false;
    table.colorSpace = THREE.NoColorSpace;
    table.name = 'sunset-gull-bones';
    table.needsUpdate = true;
    /** Where each bird is (x, y, z) and its size, and which flight and bird it is: read by the tests. */
    const places = new Float32Array(rows * 4);
    const owners = new Int16Array(rows * 2);
    const pose = new Float32Array(BONES * 8);
    const turnQ = [0, 0, 0, 1];
    const where = [0, 0, 0];

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'sunset-birds';
    const aSkin = attribute('skin', 'vec4');
    const aNormal = attribute('normal', 'vec3');
    const aPlumage = attribute('color', 'vec4');
    const vNormal = varying(vec3(0, 1, 0), 'sunsetGullNormal');
    const vPlumage = varying(vec4(1), 'sunsetGullPlumage');

    const turn = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0));
    material.positionNode = Fn(() => {
        // The bird's row of the table: per bone its rotation, then its place and the bird's size.
        const row = int(instanceIndex);
        const rest = positionGeometry;
        const pos = vec3(0).toVar();
        const nor = vec3(0).toVar();
        [[aSkin.x, aSkin.z], [aSkin.y, aSkin.z.oneMinus()]].forEach(([id, w]) => {
            const x = int(floor(id.mul(255.0).add(0.5))).mul(2);
            const q = textureLoad(table, ivec2(x, row)).toVar();
            const t = textureLoad(table, ivec2(x.add(1), row)).toVar();
            pos.addAssign(turn(q, rest).mul(t.w).add(t.xyz).mul(w));
            nor.addAssign(turn(q, aNormal).mul(w));
        });
        vNormal.assign(nor);
        vPlumage.assign(aPlumage);
        return pos;
    })();

    material.colorNode = Fn(() => {
        const { light } = U;
        const N = normalize(vNormal).mul(faceDirection).toVar();
        const look = normalize(positionWorld.sub(cameraPosition)).toVar();
        const albedo = vPlumage.rgb;
        const thin = vPlumage.a;
        // The light: the sun by day, the moon by night, as much of it as stands over the sea.
        const key = normalize(mix(U.sun, U.moon, U.moonKey)).toVar();
        const keyUp = mix(U.sunUp, U.moonUp, U.moonKey);
        // The sky the feathers face (the sky's own colour along the normal, from just above the
        // horizon up), and the sea's dim light from below.
        const seeSky = N.y.mul(0.5).add(0.5).toVar();
        const skyLight = skyBase(normalize(vec3(N.x, max(N.y, 0.0).add(0.25), N.z)), U);
        // Seen against a low light the eye is set by the glare behind them: the shaded side, all
        // the eye sees of a bird crossing the sun, goes to a silhouette (held under a fifth or so
        // of the sky behind it). With the sun high the same birds are white gulls in the light.
        const toward = dot(look, key);
        const sunHigh = smoothstep(Math.sin(18 * DEG), Math.sin(38 * DEG), key.y);
        // (Not the disc's share over the sea: the sky round a sun just set is still the glare.)
        const glare = smoothstep(Math.cos(55 * DEG), Math.cos(12 * DEG), toward).mul(sunHigh.oneMinus());
        // (From below, the sea mirrors the low sky the way the feathers face: dim purple under a
        // bird crossing the sun, not the glow behind it; by day the sunlit water lights a white
        // belly from beneath.)
        const seaLight = skyBase(normalize(vec3(N.x, 0.12, N.z)), U).mul(TONE.sea)
            .add(light.cloudLit.mul(keyUp).mul(TONE.seaSun));
        const ambient = mix(seaLight, skyLight.mul(TONE.sky), seeSky)
            .mul(mix(float(1.0), float(TONE.against), glare));
        // The key on the faces turned to it, as bright as the hour lights a white cloud.
        const direct = light.cloudLit.mul(max(dot(N, key), 0.0).mul(keyUp).mul(TONE.key))
            .mul(mix(float(1.0), float(TONE.keyAgainst), glare));
        // Seen against the light: the thin feathers glow only over the disc itself; the outline
        // takes a thin rim close to it (a wider one tinted every small bird brown).
        const through = smoothstep(Math.cos(11 * DEG), Math.cos(1.5 * DEG), toward).mul(thin).mul(keyUp);
        const edge = pow(float(1.0).sub(abs(dot(N, look))), 5.0);
        const rim = edge.mul(smoothstep(Math.cos(18 * DEG), Math.cos(3 * DEG), toward)).mul(keyUp);
        const back = light.cloudRim.mul(through.mul(TONE.through).add(rim.mul(TONE.rim)));
        return vec4(albedo.mul(ambient.add(direct)).add(back), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sunset-birds';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    const rand = mulberry32(seed + 101);
    const halfSpan = gullModel().span * 0.5 * GULL_SCALE;
    /**
     * Each bird's place in the skein and its own pace. Each rank flies 1.15 to 1.65 m behind the
     * one before it, so the line has no holes (a stride of its own times the rank left the last
     * birds of a long skein straggling metres behind the rest).
     */
    let rankBack = 0;
    const birds = Array.from({ length: count }, (_, i) => {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        if (i % 2 === 1) rankBack += 1.15 + rand() * 0.5;
        const bird = {
            back: rankBack + rand() * 0.6,
            aside: side * rank * (0.75 + rand() * 0.35) + (rand() - 0.5) * 0.8,
            up: (rand() - 0.5) * 1.3 + rank * 0.1,
            pace: 2.6 + rand() * 0.9,
            phase: rand() * Math.PI * 2,
            glide: rand() * 10,
            wander: rand() * 6,
        };
        // Flying either way (index 0 left to right): how far its bearing trails the leader's
        // (radians), and how far its wingtips reach either side of it, with a little for its
        // wobble. Its side of the line is nearer the eye one way across than the other.
        const near = [1, -1].map((dir) => FLOCK_RANGE - dir * bird.aside);
        bird.lag = near.map((d) => Math.atan2(bird.back, d));
        bird.reach = near.map((d) => Math.atan(halfSpan / Math.hypot(bird.back, d)) + 0.6 / FLOCK_RANGE);
        return bird;
    });
    /**
     * The flights, each its own line across the frame. Along the line the way it flies, the
     * leader's bearing (radians, `dir` times its bearing right of the view's middle) starts at
     * `p0`, out of sight, and goes on at RATE; `lag` is how far behind that the last wingtip
     * trails, so the flight is over once that is out of sight past the far edge.
     */
    const flights = Array.from({ length: FLIGHTS }, () => ({
        at: -100, n: 0, el: 0, dir: 1, p0: 0, lag: 0,
    }));
    /** Half the frame's width (radians), as the world last gave it, and the out-of-sight line. */
    let edge = 40 * DEG;
    const away = () => edge + OUT_OF_SIGHT * DEG;
    const way = (f) => (f.dir > 0 ? 0 : 1);
    const lead = (f, clock) => f.p0 + RATE * (clock - f.at);
    const inAir = (f, clock) => f.n > 0 && clock >= f.at && lead(f, clock) - f.lag < away();
    /** Whether bird `i`'s place in `f` is still out of sight beyond the edge `f` comes in by. */
    const unseen = (f, i, clock) => {
        const b = birds[Math.max(0, Math.min(count - 1, i))];
        return lead(f, clock) - b.lag[way(f)] + b.reach[way(f)] < -away();
    };
    /** Birds no other flight in the air is using. */
    const roomBeside = (f, clock) => {
        let used = 0;
        for (let k = 0; k < FLIGHTS; k += 1) {
            if (flights[k] !== f && inAir(flights[k], clock)) used += flights[k].n;
        }
        return Math.max(0, count - used);
    };
    /** Bird `i` flies in `f`: its trailing wingtip may lengthen the flight. */
    const enlist = (f, i) => {
        const b = birds[i];
        f.lag = Math.max(f.lag, b.lag[way(f)] + b.reach[way(f)]);
    };
    /** Newcomers take their places at `f`'s tail, up to `n` birds, as long as those are unseen. */
    const join = (f, n, clock) => {
        const most = Math.min(n, roomBeside(f, clock));
        while (f.n < most && unseen(f, f.n, clock)) {
            enlist(f, f.n);
            f.n += 1;
        }
    };

    return {
        mesh,
        count,
        /** Every flying bird's bones as the vertex stage reads them (a row a bird). */
        table,
        /**
         * Call `n` birds across the light whose direction is `toward` (unit vector); `half` is
         * half the frame's width (degrees). The youngest flight still coming in takes them into
         * the places at its tail that are still out of sight (it grows to `n`); a call once its
         * tail is in sight sets out a free flight; with none free the call goes by. Never a restart.
         */
        send(clock, n, toward, r = 0.5, half = undefined) {
            if (Number.isFinite(half) && half > 0) edge = half * DEG;
            const want = Math.min(n, count);
            if (!(want > 0)) return;
            let coming = null;
            let free = null;
            for (let k = 0; k < FLIGHTS; k += 1) {
                const f = flights[k];
                if (!inAir(f, clock)) {
                    if (!free) free = f;
                } else if (unseen(f, f.n - 1, clock) && (!coming || f.at > coming.at)) {
                    coming = f;
                }
            }
            if (coming) {
                if (coming.n >= want) return;
                const had = coming.n;
                join(coming, want, clock);
                if (coming.n > had) return;
            }
            if (!free) return;
            const size = Math.min(want, roomBeside(free, clock));
            if (size < Math.min(MIN_FLIGHT, want)) return;
            const others = flights.filter((f) => f !== free && inAir(f, clock));
            free.at = clock;
            free.n = 0;
            free.lag = 0;
            // Flights beside each other go the same way across, so they never fly through each other.
            free.dir = r < 0.7 ? 1 : -1;
            if (others.length > 0) free.dir = others[0].dir;
            let front = 0;
            for (let i = 0; i < size; i += 1) {
                enlist(free, i);
                front = Math.max(front, birds[i].reach[way(free)] - birds[i].lag[way(free)]);
            }
            free.n = size;
            // The leader's wingtip comes into sight LEAD_SECONDS from now.
            free.p0 = -away() - front - RATE * LEAD_SECONDS;
            // A little above the light, never into the sea, and in the picture when it is high; a
            // flight beside others keeps a line of its own, over or under theirs.
            const el = Math.asin(Math.max(-1, Math.min(1, toward.y)));
            const top = 0.3 + r * 0.05;
            const line = (e) => Math.min(top, Math.max(0.035, e));
            const base = line(el + 0.025 + r * 0.03);
            free.el = [0, 0.05, -0.045, 0.1, -0.09].map((d) => line(base + d))
                .find((e) => others.every((o) => Math.abs(o.el - e) >= 0.035)) ?? base;
        },
        reset() {
            for (let k = 0; k < FLIGHTS; k += 1) {
                flights[k].at = -100;
                flights[k].n = 0;
            }
            geometry.instanceCount = 0;
        },
        airborne(clock) {
            let n = 0;
            for (let k = 0; k < FLIGHTS; k += 1) if (inAir(flights[k], clock)) n += flights[k].n;
            return n;
        },
        /** Fly every flight in the air to `clock`; `half` is half the frame's width (degrees). */
        update(clock, half = undefined) {
            if (Number.isFinite(half) && half > 0) edge = half * DEG;
            let at = 0;
            for (let k = 0; k < FLIGHTS; k += 1) {
                const flight = flights[k];
                if (!inAir(flight, clock)) continue;
                // The leader's bearing, and the line's heading, square to it the way it flies.
                const bearing = flight.dir * lead(flight, clock);
                const heading = bearing + flight.dir * Math.PI * 0.5;
                const fx = Math.sin(heading);
                const fz = -Math.cos(heading);
                const sx = -fz;
                const sz = fx;
                const cx = Math.sin(bearing) * FLOCK_RANGE;
                const cz = -Math.cos(bearing) * FLOCK_RANGE;
                // A second flight's birds keep their own beat.
                const own = k * 1.7;
                for (let i = 0; i < flight.n && at < count; i += 1) {
                    const b = birds[i];
                    const wob = Math.sin(clock * 0.6 + b.wander + own) * 0.5;
                    const y = 3.2 + Math.tan(flight.el) * FLOCK_RANGE + b.up
                        + Math.sin(clock * 0.45 + b.wander + own) * 0.4;
                    where[0] = cx - fx * b.back + sx * (b.aside + wob);
                    where[1] = y;
                    where[2] = cz - fz * b.back + sz * (b.aside + wob);
                    const size = GULL_SCALE;
                    for (let c = 0; c < 3; c += 1) places[at * 4 + c] = where[c];
                    places[at * 4 + 3] = size;
                    owners[at * 2] = k;
                    owners[at * 2 + 1] = i;
                    // Bursts of beats and long glides.
                    const gliding = smooth(0.55, 0.85, Math.sin(clock * 0.31 + b.glide + own) * 0.5 + 0.5);
                    const bank = Math.sin(clock * 0.5 + b.wander + own) * 0.12;
                    const beat = (clock * b.pace + b.phase + own) / (Math.PI * 2);
                    gullPose(beat, gliding, pose);
                    placeBones(pose, flightTurn(heading, bank, turnQ), where, size, bones, at * BONES * 8);
                    at += 1;
                }
            }
            geometry.instanceCount = at;
            if (at > 0) table.needsUpdate = true;
        },
        /** Bird `i`'s place (x, y, z) and size this frame. */
        placeOf(i) {
            return Array.from(places.subarray(i * 4, i * 4 + 4));
        },
        /** Which flight and which of its birds instance `i` is this frame. */
        whoIs(i) {
            return { flight: owners[i * 2], bird: owners[i * 2 + 1] };
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
            table.dispose();
        },
    };
}
