/**
 * Synthwave Sunset — the ferris wheel at the end of the pier, standing in front of the setting
 * sun so the sun shows through its spokes.
 *
 * Two draws:
 *   1. The STRUCTURE: A-frame legs and axle (static), two rims with their spokes, an inner ring,
 *      the trusses between the rims and the hub (turning), and the cabins (carried round, always
 *      hanging upright). One merged mesh; the vertex stage turns what turns, by `aWheel.x` (the
 *      kind) and the wheel's angle. Dark painted steel backlit by the sunset, warmed near the
 *      bulbs; the cabins are pastel with lit windows, and the inner ring is a neon tube.
 *   2. The BULBS: one instanced additive draw of camera-facing quads, sized in metres with a
 *      floor of about one buffer pixel, so far bulbs never vanish or shimmer, and dimmed by the
 *      area they had to grow by, so a far wheel is not brighter than a near one. Their light runs
 *      programmes (warm steady, chases, sparkle) that gameplay can colour (step 5).
 *
 * Both draw on the mirror layer as well, so the sea and the wet sand reflect them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    modelViewMatrix,
    modelWorldMatrix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    screenSize,
    select,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { rgb, swHash11 } from './synthwave-sunset-tsl.js';
import {
    PIER, WHEEL, pierFrame, wheelWorldPosition,
} from './synthwave-sunset-layout.js';
import {
    box, makeOut, ringPoints, strut, toGeometry, tube,
} from './synthwave-sunset-geo.js';

export { WHEEL };

const KIND = {
    static: 0, turning: 1, cabin: 2, neon: 3,
};

/** Build the structure in the wheel's local frame: plane = xy, axle = z, hub at the origin. */
function buildStructure() {
    const out = makeOut();
    const { radius: R, depth: D } = WHEEL;
    const zf = D / 2;
    const turning = [KIND.turning, 0, 0, 0];
    const neon = [KIND.neon, 0, 0, 0];

    // Rims, inner rings (front one is a neon tube), the hub.
    for (const z of [zf, -zf]) {
        tube(out, ringPoints(R, z, 120), 0.34, 6, true, [KIND.turning, 1, 0, 0]);
        tube(out, ringPoints(R * 0.42, z, 64), z > 0 ? 0.22 : 0.18, 6, true, z > 0 ? neon : turning);
        tube(out, ringPoints(R * 0.78, z, 96), 0.14, 5, true, turning);
    }
    strut(out, new THREE.Vector3(0, 0, -zf - 0.8), new THREE.Vector3(0, 0, zf + 0.8), 2.0, 12, turning);

    // Spokes from the hub to each rim, trusses between the rims.
    for (let k = 0; k < WHEEL.spokes; k += 1) {
        const a = (k / WHEEL.spokes) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const half = (Math.PI / WHEEL.spokes);
        for (const z of [zf, -zf]) {
            strut(out, new THREE.Vector3(c * 1.8, s * 1.8, z * 0.6), new THREE.Vector3(c * R, s * R, z), 0.15, 5, turning);
        }
        strut(out, new THREE.Vector3(c * R, s * R, zf), new THREE.Vector3(c * R, s * R, -zf), 0.13, 5, turning);
        // A diagonal brace across the gap to the next spoke, alternating sides.
        const a2 = a + half * 2;
        const zz = k % 2 ? zf : -zf;
        strut(out, new THREE.Vector3(c * R, s * R, zz), new THREE.Vector3(Math.cos(a2) * R * 0.78, Math.sin(a2) * R * 0.78, zz), 0.1, 4, turning);
    }

    // A-frame legs (static): two pairs, one each side of the wheel, splayed along the plane.
    const footY = PIER.deckY - WHEEL.hubY;
    const legStatic = [KIND.static, 0, 0, 0];
    for (const side of [1, -1]) {
        const top = new THREE.Vector3(0, 0, side * (zf + 1.6));
        for (const sx of [1, -1]) {
            const foot = new THREE.Vector3(sx * 14.5, footY, side * (zf + 4.2));
            strut(out, top, foot, 0.62, 8, legStatic);
            // Cross-bracing rungs up the leg.
            for (let r = 1; r <= 4; r += 1) {
                const f = r / 5;
                const p = top.clone().lerp(foot, f);
                const q = new THREE.Vector3(-p.x, p.y, p.z);
                if (sx > 0) strut(out, p, q, 0.22, 5, legStatic);
            }
        }
    }
    strut(out, new THREE.Vector3(0, 0, -zf - 2.2), new THREE.Vector3(0, 0, zf + 2.2), 0.9, 10, legStatic);
    // The boarding platform on the deck.
    // The boarding platform, on the pier head's deck (synthwave-sunset-pier.js builds the dock).
    box(out, new THREE.Vector3(0, footY + 0.6, 0), new THREE.Vector3(16.5, 0.6, zf + 4.5), legStatic);
    box(out, new THREE.Vector3(0, footY + 2.6, 0), new THREE.Vector3(5.5, 0.8, 2.6), legStatic);

    // Cabins: pivot on the rim's centre line, hanging below it; aWheel = (cabin, θ0, colour, 0).
    for (let k = 0; k < WHEEL.cabins; k += 1) {
        const a = ((k + 0.5) / WHEEL.cabins) * Math.PI * 2;
        const pivot = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
        const meta = [KIND.cabin, a, k % 4, 0];
        box(out, pivot.clone().add(new THREE.Vector3(0, -2.2, 0)), new THREE.Vector3(1.25, 1.35, 1.35), meta);
        box(out, pivot.clone().add(new THREE.Vector3(0, -0.62, 0)), new THREE.Vector3(1.45, 0.2, 1.5), meta);
        strut(out, pivot.clone().add(new THREE.Vector3(0, 0, 0)), pivot.clone().add(new THREE.Vector3(0, -0.6, 0)), 0.09, 4, meta);
    }
    return out;
}

// ── Materials ───────────────────────────────────────────────────────────────────

const CABIN_COLORS = [0xff86b8, 0x7ff0d4, 0xffd88a, 0xc8a8ff];

/**
 * The lock chases at a rim angle `phi` (rad, in the wheel's plane): two bands of the piece's
 * colour leave a point near the bottom and run both ways round to meet at the top (π in 1.25 s).
 * Each slot is u.chase<i> = (start time, start angle, strength, 0) with its colour in
 * u.chaseCol<i>, for as many slots as the world made. Returns vec4(colour, weight): the slots'
 * hues averaged by weight, and their summed weight, so bands that meet or pile up (rapid locks,
 * a hard drop's stronger band) burn brighter instead of only recolouring the rim.
 */
function wheelChase(u, phi) {
    const one = (C) => {
        const age = u.time.sub(C.x);
        const run = age.mul(Math.PI / 1.25);
        const gap = (h) => abs(fract(phi.sub(h).div(Math.PI * 2).add(0.5)).sub(0.5)).mul(Math.PI * 2);
        const band = (h) => exp(gap(h).div(0.34).pow(2.0).negate());
        const env = smoothstep(0.0, 0.08, age).mul(float(1.0).sub(smoothstep(1.15, 1.6, age)));
        return max(band(C.y.add(run)), band(C.y.sub(run))).mul(env).mul(C.z);
    };
    let sum = float(0.0);
    let col = vec3(0.0);
    for (let i = 0; u[`chase${i}`]; i += 1) {
        const w = one(u[`chase${i}`]).toVar();
        sum = sum.add(w);
        col = col.add(u[`chaseCol${i}`].mul(w));
    }
    const total = sum.toVar();
    return vec4(col.div(max(total, 1e-3)).mul(2.4), total);
}

/** Turn a local point about the axle (z) by angle a. */
const turnZ = (p, a) => vec3(p.x.mul(cos(a)).sub(p.y.mul(sin(a))), p.x.mul(sin(a)).add(p.y.mul(cos(a))), p.z);

function createStructureMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveWheel';
    material.fog = false;
    const meta = attribute('aWheel', 'vec4');
    const kind = meta.x;
    const R = float(WHEEL.radius);

    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const a = u.wheelAngle;
        const turned = turnZ(p, a);
        // Cabins: move the pivot round the circle, keep the cabin upright, a little swing.
        const t0 = meta.y;
        const pivot0 = vec3(cos(t0).mul(R), sin(t0).mul(R), 0.0);
        const pivot1 = vec3(cos(t0.add(a)).mul(R), sin(t0.add(a)).mul(R), 0.0);
        const swing = sin(u.time.mul(0.9).add(t0.mul(3.0))).mul(0.06);
        const rel = p.sub(pivot0);
        const swung = vec3(rel.x.add(rel.y.mul(swing).negate()), rel.y, rel.z);
        const cabin = pivot1.add(swung);
        return select(kind.lessThan(0.5), p, select(kind.greaterThan(1.5).and(kind.lessThan(2.5)), cabin, turned));
    })();
    // What turns, turns its normal too (the cabins hang upright and keep theirs).
    const turnsNormal = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind).mul(step(kind, 2.5))));
    const vNormal = varying(mix(normalGeometry, turnZ(normalGeometry, u.wheelAngle), turnsNormal), 'vWheelNormal');

    material.colorNode = Fn(() => {
        const V = normalize(positionWorld.sub(cameraPosition)).toVar();
        const N = normalize(modelWorldMatrix.mul(vec4(vNormal, 0.0)).xyz).toVar();
        const facing = abs(dot(N, V));
        // Backlit steel: dark, a warm rim where the surface turns toward the sun behind it.
        const rim = pow(float(1.0).sub(facing), 3.0).mul(max(dot(N, u.sunDir), 0.0).mul(0.8).add(0.2));
        const steel = rgb(0x1f1626).add(rgb(0xff8a5c).mul(rim.mul(0.55)).mul(mix(float(1.0), float(0.4), u.dusk)));
        // The bulbs light the rim and the spokes near it (cheap: by local radius).
        const local = positionGeometry;
        const r = length(vec2(local.x, local.y));
        const nearBulbs = exp(abs(r.sub(R)).mul(-0.6)).mul(step(kind, 1.5)).mul(step(0.5, kind));
        const warmed = steel.add(rgb(0xffc48a).mul(nearBulbs.mul(0.16).mul(u.wheelGlow))).toVar();
        // A lock's chase lights the rim tube itself, so it reads as a moving arc of colour.
        const rimAngle = atan(local.y, local.x).add(u.wheelAngle);
        const ch = wheelChase(u, rimAngle);
        warmed.addAssign(ch.xyz.mul(min(ch.w, 1.25)).mul(nearBulbs).mul(1.6));

        // Cabins: pastel bodies with lit windows (a band around the middle).
        const colorIdx = meta.z;
        const cabinCol = select(colorIdx.lessThan(0.5), rgb(CABIN_COLORS[0]), select(
            colorIdx.lessThan(1.5),
            rgb(CABIN_COLORS[1]),
            select(colorIdx.lessThan(2.5), rgb(CABIN_COLORS[2]), rgb(CABIN_COLORS[3])),
        ));
        const t0 = meta.y;
        const pivotY = sin(t0).mul(R);
        const yIn = local.y.sub(pivotY);
        const window = smoothstep(-2.75, -2.6, yIn).mul(float(1.0).sub(smoothstep(-1.65, -1.5, yIn)))
            .mul(float(1.0).sub(step(0.9, abs(N.y))));
        const cabin = cabinCol.mul(0.16).add(rgb(0xffd8a8, 1.6).mul(window).mul(u.wheelGlow));

        // The inner neon ring.
        const neonCol = mix(rgb(0xff5fa8, 3.2), rgb(0x7ff0d4, 3.0), u.wheelNeonMix).mul(u.wheelGlow);

        return select(kind.lessThan(1.5), warmed, select(kind.lessThan(2.5), cabin, neonCol));
    })();

    return material;
}

/** Bulb layout: (radius, θ0, z, turning) + (ring id, index, count, 0). */
function bulbLayout() {
    const rows = [];
    const { radius: R, depth: D } = WHEEL;
    for (const [ring, z] of [[0, D / 2], [1, -D / 2]]) {
        for (let i = 0; i < WHEEL.rimBulbs; i += 1) {
            rows.push([R + 0.45, (i / WHEEL.rimBulbs) * Math.PI * 2, z, 1, ring, i, WHEEL.rimBulbs]);
        }
    }
    let i = 0;
    const perRay = WHEEL.spokeBulbs;
    for (let k = 0; k < WHEEL.spokes; k += 1) {
        const a = (k / WHEEL.spokes) * Math.PI * 2;
        for (let j = 1; j <= perRay; j += 1) {
            rows.push([R * (0.2 + 0.78 * (j / (perRay + 0.4))), a, D / 2 + 0.25, 1, 2, i, WHEEL.spokes * perRay]);
            i += 1;
        }
    }
    for (let k = 0; k < 24; k += 1) rows.push([2.6, (k / 24) * Math.PI * 2, D / 2 + 0.9, 1, 3, k, 24]);
    return rows;
}

function createBulbs(u) {
    const rows = bulbLayout();
    const count = rows.length;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const a = new Float32Array(count * 4);
    const b = new Float32Array(count * 4);
    rows.forEach((row, i) => {
        a.set(row.slice(0, 4), i * 4);
        b.set([row[4], row[5], row[6], 0], i * 4);
    });
    geometry.setAttribute('iBulbA', new THREE.InstancedBufferAttribute(a, 4));
    geometry.setAttribute('iBulbB', new THREE.InstancedBufferAttribute(b, 4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveWheelBulbs';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;

    const A = attribute('iBulbA', 'vec4');
    const B = attribute('iBulbB', 'vec4');
    const WORLD_SIZE = 0.62;

    // Size in metres, floored at ~1.4 buffer pixels; the floor's extra area dims the bulb.
    const theta = A.y.add(u.wheelAngle.mul(A.w));
    const local = vec3(cos(theta).mul(A.x), sin(theta).mul(A.x), A.z);
    const mv = modelViewMatrix.mul(vec4(local, 1.0));
    const depth = max(mv.z.negate(), 0.1);
    const pxWorld = depth.mul(2.0).div(cameraProjectionMatrix.element(1).element(1).mul(screenSize.y));
    const size = max(float(WORLD_SIZE), pxWorld.mul(1.4));
    const corner = positionGeometry.xy;
    material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xyz.add(vec3(corner.mul(size), 0.0)), 1.0));
    const dim = pow(float(WORLD_SIZE).div(size), 2.0);

    material.colorNode = Fn(() => {
        const d = length(uv().sub(0.5)).mul(2.0);
        const shape = exp(d.mul(d).mul(-5.5)).sub(0.004).max(0.0);
        const ring = B.x;
        const idx = B.y;
        const n = max(B.z, 1.0);
        const t = u.time;
        // The chase programmes run on the midway's clock, which quickens as play heats.
        const pace = u.chaseTime ?? t;
        // Programme: warm steady with a slow twinkle; every third rim bulb flamingo, every fifth
        // mint; a soft chase runs round the rims; spokes pulse outward.
        const tw = sin(t.mul(2.3).add(swHash11(idx.add(ring.mul(311.0))).mul(40.0))).mul(0.12).add(0.88);
        const third = step(fract(idx.div(3.0)), 0.2);
        const fifth = step(fract(idx.div(5.0)), 0.12);
        const rimCol = mix(mix(rgb(0xffd88a), rgb(0xff6fae), third), rgb(0x7ff0d4), fifth);
        const chase = smoothstep(0.82, 1.0, fract(idx.div(n).mul(6.0).sub(pace.mul(0.22)))).mul(0.8);
        const spokePulse = smoothstep(0.6, 1.0, fract(idx.div(WHEEL.spokeBulbs).sub(pace.mul(0.5)))).mul(0.6);
        const level = select(ring.lessThan(1.5), float(1.0).add(chase), select(ring.lessThan(2.5), float(0.8).add(spokePulse), float(0.9)));
        const baseCol = select(ring.lessThan(1.5), rimCol, rgb(0xffe2b0)).mul(level).mul(tw).toVar();
        // Lock chases (see wheelChase): the bands of the piece's colour on the rim bulbs; where
        // bands pile up (rapid locks, a hard drop) the bulbs burn brighter, not only recoloured.
        const ch = wheelChase(u, theta);
        const onRim = step(ring, 1.5);
        baseCol.assign(mix(baseCol, ch.xyz.mul(1.4), clamp(ch.w, 0.0, 1.0).mul(onRim)));
        baseCol.addAssign(ch.xyz.mul(max(ch.w.sub(1.0), 0.0).mul(0.35).mul(onRim)));
        const col = baseCol;
        const back = select(ring.greaterThan(0.5).and(ring.lessThan(1.5)), float(0.7), float(1.0));
        return col.mul(shape).mul(dim).mul(back).mul(u.wheelGlow)
            .mul(5.0);
    })();
    material.outputNode = vec4(material.colorNode, 0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'SynthwaveWheelBulbs';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
}

/**
 * @param {object} u  shared world uniforms (wheelAngle, wheelGlow, wheelNeonMix, time, sunDir, dusk)
 * @param {object} [opts]
 * @param {number} [opts.mirrorLayer]  also draw on this layer (the sea's reflection pass)
 * @returns {THREE.Group}
 */
export function createWheel(u, opts = {}) {
    const group = new THREE.Group();
    group.name = 'SynthwaveWheel';
    wheelWorldPosition(group.position);
    // The axle runs along the pier.
    group.rotation.y = pierFrame().heading;

    const structure = new THREE.Mesh(toGeometry(buildStructure(), 'aWheel'), createStructureMaterial(u));
    structure.name = 'SynthwaveWheelStructure';
    structure.renderOrder = -6;
    structure.frustumCulled = false;
    const bulbs = createBulbs(u);
    group.add(structure, bulbs);
    if (Number.isInteger(opts.mirrorLayer)) {
        structure.layers.enable(opts.mirrorLayer);
        bulbs.layers.enable(opts.mirrorLayer);
    }
    group.userData.meshes = [structure, bulbs];
    return group;
}
