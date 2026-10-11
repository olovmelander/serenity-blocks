/**
 * Ocean — the fish and the jellies.
 *
 *   school    the silver school: thousands of fish strung along a slow loop through the canyon's
 *             mid-water. Where each fish is is a pure function of the school's uniforms (its
 *             shape, its place on the loop, how far it is wound into the vortex round the board)
 *             and of the startles in the water, so nothing is simulated and any frame replays.
 *             Their flanks are mirrors: as the school turns, it flashes.
 *   reef fish small bright fish that keep to the coral heads, each wandering round its own
 *             colony and darting into it when something lands close by.
 *   jellies   moon jellies hanging in the blue, their bells beating; at night their rims glow.
 *
 * A fish is one small mesh (nose along +z), drawn once per fish; its body bends as it swims.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SCARE_SPREAD, TAU, VORTEX, mulberry32, ocBackdrop, ocFog, ocLight, ocPart, ocPow4, ocPow8,
} from './ocean-tsl.js';
import { Shape } from './ocean-reef.js';

// ── The fish ────────────────────────────────────────────────────────────────────

/**
 * A fish a unit long, nose at +z: a laterally flattened body and a forked tail.
 * aShape = (along: 0 at the nose → 1 at the tail's tip, how far up the flank: −1 belly → 1 back).
 */
export function fishShape({
    deep = 0.24, wide = 0.09, rings = 7, sides = 8,
} = {}) {
    const shape = new Shape();
    const grid = [];
    for (let j = 0; j <= rings; j++) {
        const s = j / rings;
        const along = s * 0.78;
        const z = 0.5 - along;
        const body = Math.sin(Math.PI * Math.min(1, s ** 0.62)) * (s < 0.98 ? 1 : 0.15) + 0.06;
        const ring = [];
        for (let k = 0; k < sides; k++) {
            const a = (k / sides) * TAU;
            const y = Math.cos(a) * deep * 0.5 * body;
            const x = Math.sin(a) * wide * 0.5 * body;
            const n = [Math.sin(a) / wide, Math.cos(a) / deep, 0.12];
            const len = Math.hypot(n[0], n[1], n[2]);
            ring.push(shape.vert([x, y, z], [n[0] / len, n[1] / len, n[2] / len], along, Math.cos(a)));
        }
        grid.push(ring);
    }
    const nose = shape.vert([0, 0, 0.53], [0, 0, 1], 0, 0);
    for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        shape.tri(nose, grid[0][k], grid[0][k1]);
        for (let j = 0; j < rings; j++) shape.quad(grid[j][k], grid[j][k1], grid[j + 1][k1], grid[j + 1][k]);
    }
    // The tail: two lobes, flat and upright, seen from either side.
    const root = 0.5 - 0.78;
    [1, -1].forEach((face) => {
        const n = [face, 0, 0];
        const a = shape.vert([0, 0.012, root + 0.01], n, 0.8, 0.1);
        const b = shape.vert([0, -0.012, root + 0.01], n, 0.8, -0.1);
        const top = shape.vert([0, deep * 0.62, -0.5], n, 1, 1);
        const notch = shape.vert([0, 0, -0.4], n, 0.92, 0);
        const bottom = shape.vert([0, -deep * 0.62, -0.5], n, 1, -1);
        shape.tri(a, top, notch);
        shape.tri(b, notch, bottom);
        shape.tri(a, notch, b);
    });
    return shape;
}

/**
 * A fish's place in the world from its centre, heading and local vertex, with its body bent:
 * returns { position, normal } nodes. `beat` = the swim's phase, `amp` how hard it swims.
 */
const placeFish = (centre, heading, local, normal, along, beat, amp) => {
    // The body bends from the head back, more toward the tail.
    const bend = sin(beat.sub(along.mul(5.5))).mul(along.mul(along)).mul(amp);
    const bent = vec3(local.x.add(bend), local.y, local.z);
    const f = normalize(heading);
    const right = normalize(cross(f, vec3(0.0, 1.0, 0.0)).add(vec3(1e-4, 0.0, 0.0)));
    const up = cross(right, f);
    const position = centre.add(right.mul(bent.x)).add(up.mul(bent.y)).add(f.mul(bent.z));
    // (The bend turns the flank a little: enough for the glints to ripple down the body.)
    const turn = cos(beat.sub(along.mul(5.5))).mul(along).mul(amp).mul(2.5);
    const n = vec3(normal.x, normal.y, normal.z.sub(normal.x.mul(turn)));
    const world = normalize(right.mul(n.x).add(up.mul(n.y)).add(f.mul(n.z)));
    return { position, normal: world };
};

/**
 * How far the startles in the water push a point (world): each spreads from where it began,
 * reaches the point, pushes it away for a breath and lets it drift back.
 */
const scarePush = (u, P, gain) => {
    const push = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.counts.w), type: 'int', condition: '<', name: 'sc',
    }, ({ sc }) => {
        const A = u.scares.element(sc.mul(2));
        const B = u.scares.element(sc.mul(2).add(1));
        const away = P.sub(A.xyz);
        const d = max(length(away), 0.15);
        const age = u.time.sub(A.w).sub(d.div(SCARE_SPREAD)).toVar();
        const env = float(1.0).sub(exp(age.div(-0.07))).mul(exp(max(age.sub(0.35), 0.0).div(-0.8))).mul(step(0.0, age));
        const reach = float(1.0).sub(smoothstep(B.y.mul(0.3), B.y, d));
        push.addAssign(away.div(d).mul(env).mul(reach).mul(B.x)
            .mul(gain));
    });
    return push;
};

/** The silver flank: dark back, a mirror for a flank, and a glint where it turns to the sun. */
const silverFlank = (u, N, P, up, back, belly, glints) => {
    const view = normalize(P.sub(cameraPosition));
    const R = reflect(view, N);
    const lit = ocLight(u, { N, P, wrap: 0.3 });
    const flankUp = clamp(up.mul(0.5).add(0.5), 0.0, 1.0);
    const albedo = mix(belly, back, smoothstep(0.35, 0.8, flankUp));
    const mirror = ocBackdrop(u, R).mul(float(1.0).sub(smoothstep(0.4, 0.85, flankUp)));
    const col = albedo.mul(lit).add(mirror.mul(0.85)).toVar();
    if (glints) {
        const g = clamp(dot(R, u.sunDir), 0.0, 1.0);
        col.addAssign(u.sun.mul(ocPow8(ocPow4(g))).mul(2.4).mul(float(1.0).sub(flankUp.mul(0.7))).mul(u.breath));
    }
    return col;
};

// ── The silver school ───────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {number} count
 * @param {{ glints?: boolean }} [options]
 */
export function createSchool(u, count, { glints = true } = {}) {
    const n = Math.max(1, count);
    const shape = fishShape({
        deep: 0.22, wide: 0.075, rings: 6, sides: 6,
    });
    const base = shape.geometry(false);
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(base.attributes).forEach((k) => geometry.setAttribute(k, base.attributes[k]));
    geometry.setIndex(base.index);
    const data = new Float32Array(n * 4);
    const rand = mulberry32(7307);
    for (let i = 0; i < n; i++) {
        // Along the school (−0.5..0.5), round it (angle), out from its middle (0..1, denser inside), its own number.
        data.set([rand() - 0.5, rand() * TAU, Math.sqrt(rand()) * (0.6 + 0.4 * rand()), rand()], i * 4);
    }
    geometry.setAttribute('aFish', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanSchool';
    material.fog = false;
    material.toneMapped = false;
    const aFish = attribute('aFish', 'vec4');
    const aShape = attribute('aShape', 'vec2');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'vSchoolN');
    const vUp = varying(aShape.y, 'vSchoolUp');

    material.positionNode = Fn(() => {
        const A = u.schoolA; // wide, high, swing, back
        const B = u.schoolB; // deep, phase, vortex, span
        const C = u.schoolC; // spin, tight, excite
        const s = aFish.x;
        const seed = aFish.w;
        // ── On the loop ──
        const ph = B.y.add(s.mul(B.w)).toVar();
        const loop = vec3(
            sin(ph).mul(A.x).mul(u.squeeze),
            A.y.add(sin(ph.add(1.1)).mul(A.z)).add(sin(ph.mul(2.3)).mul(A.z).mul(0.35)),
            A.w.add(sin(ph.mul(2.0).add(0.6)).mul(B.x)).add(cos(ph).mul(5.0)),
        );
        const dLoop = vec3(
            cos(ph).mul(A.x).mul(u.squeeze),
            cos(ph.add(1.1)).mul(A.z).add(cos(ph.mul(2.3)).mul(A.z).mul(0.8)),
            cos(ph.mul(2.0).add(0.6)).mul(B.x).mul(2.0).sub(sin(ph).mul(5.0)),
        );
        const dir = normalize(dLoop).toVar();
        // Round the loop's line: thick in the middle, thinning to either end.
        const girth = float(1.0).sub(s.mul(2.0).mul(s.mul(2.0)).mul(0.65)).mul(1.7).mul(C.y);
        const right = normalize(cross(dir, vec3(0.0, 1.0, 0.0)).add(vec3(1e-4, 0.0, 0.0)));
        const up = cross(right, dir);
        const t = u.time;
        const wander = vec3(
            sin(t.mul(0.7).add(seed.mul(50.0))),
            sin(t.mul(0.53).add(seed.mul(31.0))),
            cos(t.mul(0.61).add(seed.mul(17.0))),
        ).mul(0.25);
        const round = right.mul(cos(aFish.y)).add(up.mul(sin(aFish.y).mul(0.55))).mul(aFish.z.mul(girth));
        const onLoop = loop.add(round).add(wander);
        // ── Wound round the board ──
        const k = s.add(0.5);
        const angle = C.x.add(k.mul(TAU * 2.1)).add(seed.mul(0.4));
        const radius = float(VORTEX.radius).add(cos(aFish.y).mul(aFish.z).mul(1.3));
        const spiral = vec3(
            sin(angle).mul(radius).mul(max(u.squeeze, 0.6)),
            float(VORTEX.low).add(k.mul(VORTEX.tall)).add(sin(aFish.y).mul(aFish.z).mul(0.9)),
            float(VORTEX.z).add(cos(angle).mul(radius).mul(0.75)),
        );
        const dSpiral = normalize(vec3(cos(angle).mul(max(u.squeeze, 0.6)), 0.12, sin(angle).mul(-0.75)));
        const w = smoothstep(0.0, 1.0, B.z);
        const centre = mix(onLoop, spiral, w).toVar();
        const heading = normalize(mix(dir, dSpiral, w)).toVar();
        // ── Startled: pushed away, and turned with the push ──
        const push = scarePush(u, centre, 2.4).toVar();
        centre.addAssign(push);
        heading.assign(normalize(heading.add(push.mul(1.4))));
        // ── Swimming ──
        const size = seed.mul(0.09).add(0.15);
        const beat = t.mul(C.z.mul(9.0).add(length(push).mul(14.0)).add(11.0)).add(seed.mul(TAU));
        const fish = placeFish(centre, heading, positionGeometry.mul(size), attribute('normal', 'vec3'), aShape.x, beat, float(0.09));
        vNormal.assign(fish.normal);
        return fish.position;
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal);
        const col = silverFlank(u, N, P, vUp, vec3(0.05, 0.09, 0.12), vec3(0.7, 0.76, 0.8), glints);
        return vec4(ocFog(u, col, P), 1.0);
    })();
    const part = ocPart('OceanSchool', geometry, material, 7);
    part.count = n;
    part.triangles = shape.triangles;
    return part;
}

// ── Reef fish ───────────────────────────────────────────────────────────────────

/** Liveries: (back, belly, band) and how deep the body is. */
const LIVERIES = Object.freeze([
    {
        back: [0.95, 0.75, 0.04], belly: [1.0, 0.86, 0.2], band: [0.95, 0.75, 0.04], deep: 0.5,
    }, // tang
    {
        back: [0.03, 0.18, 0.75], belly: [0.15, 0.55, 1.0], band: [0.15, 0.55, 1.0], deep: 0.3,
    }, // chromis
    {
        back: [0.95, 0.3, 0.42], belly: [1.0, 0.55, 0.45], band: [0.95, 0.3, 0.42], deep: 0.32,
    }, // anthias
    {
        back: [1.0, 0.36, 0.03], belly: [1.0, 0.5, 0.1], band: [0.95, 0.95, 0.92], deep: 0.36,
    }, // clownfish
]);

/**
 * @param {object} u
 * @param {Array<{x:number,y:number,z:number,seed:number,hue:number,cover:number[]}>} homes
 */
export function createReefFish(u, homes) {
    const n = Math.max(1, homes.length);
    const shape = fishShape({
        deep: 0.34, wide: 0.11, rings: 6, sides: 6,
    });
    const base = shape.geometry(false);
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(base.attributes).forEach((k) => geometry.setAttribute(k, base.attributes[k]));
    geometry.setIndex(base.index);
    const home = new Float32Array(n * 4);
    const cover = new Float32Array(n * 4);
    homes.forEach((h, i) => {
        home.set([h.x, h.y, h.z, h.seed], i * 4);
        cover.set([h.cover[0], h.cover[1], h.cover[2], h.hue], i * 4);
    });
    if (!homes.length) home.set([0, -50, 0, 0], 0);
    geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(home, 4));
    geometry.setAttribute('aCover', new THREE.InstancedBufferAttribute(cover, 4));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanReefFish';
    material.fog = false;
    material.toneMapped = false;
    const aHome = attribute('aHome', 'vec4');
    const aCover = attribute('aCover', 'vec4');
    const aShape = attribute('aShape', 'vec2');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'vReefFishN');
    const vUp = varying(aShape.y, 'vReefFishUp');
    const vAlong = varying(aShape.x, 'vReefFishAlong');
    const vHue = varying(aCover.w, 'vReefFishHue');
    const pick = (hue, key) => {
        const c = (i) => vec3(...LIVERIES[i][key]);
        return mix(mix(mix(c(0), c(1), step(0.5, hue)), c(2), step(1.5, hue)), c(3), step(2.5, hue));
    };
    material.positionNode = Fn(() => {
        const seed = aHome.w;
        const t = u.time;
        const rate = seed.mul(0.25).add(0.3);
        // Each wanders round its own colony on a slow figure, turning to face the way it goes.
        const ph = t.mul(rate).add(seed.mul(TAU)).toVar();
        const reach = seed.mul(0.6).add(0.45);
        const wander = vec3(sin(ph).mul(reach), sin(ph.mul(1.7)).mul(0.22), sin(ph.mul(2.0).add(1.0)).mul(reach.mul(0.6)));
        const dWander = vec3(cos(ph).mul(reach), cos(ph.mul(1.7)).mul(0.37), cos(ph.mul(2.0).add(1.0)).mul(reach.mul(1.2)));
        const homeW = vec3(aHome.x.mul(u.squeeze), aHome.y, aHome.z);
        const coverW = vec3(aCover.x.mul(u.squeeze), aCover.y, aCover.z);
        const free = homeW.add(wander).toVar();
        // Startled: it darts into its colony, holds there, and comes out again.
        const fright = float(0.0).toVar();
        Loop({
            start: int(0), end: int(u.counts.w), type: 'int', condition: '<', name: 'rf',
        }, ({ rf }) => {
            const A = u.scares.element(rf.mul(2));
            const B = u.scares.element(rf.mul(2).add(1));
            const d = max(length(free.sub(A.xyz)), 0.15);
            const age = u.time.sub(A.w).sub(d.div(SCARE_SPREAD)).toVar();
            const env = float(1.0).sub(exp(age.div(-0.06))).mul(exp(max(age.sub(0.9), 0.0).div(-1.1))).mul(step(0.0, age));
            fright.assign(max(fright, env.mul(float(1.0).sub(smoothstep(B.y.mul(0.4), B.y.mul(1.3), d))).mul(min1(B.x))));
        });
        const centre = mix(free, coverW, fright.mul(0.85));
        const heading = normalize(mix(dWander, coverW.sub(free), fright).add(vec3(1e-3, 0.0, 0.0)));
        const size = seed.mul(0.09).add(0.12);
        const deep = mix(mix(
            mix(float(LIVERIES[0].deep), float(LIVERIES[1].deep), step(0.5, aCover.w)),
            float(LIVERIES[2].deep),
            step(1.5, aCover.w),
        ), float(LIVERIES[3].deep), step(2.5, aCover.w));
        const local = positionGeometry.mul(vec3(1.0, deep.div(0.34), 1.0)).mul(size);
        const beat = t.mul(fright.mul(25.0).add(9.0)).add(seed.mul(TAU));
        const fish = placeFish(centre, heading, local, attribute('normal', 'vec3'), aShape.x, beat, float(0.07));
        vNormal.assign(fish.normal);
        return fish.position;
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal);
        const flank = clamp(vUp.mul(0.5).add(0.5), 0.0, 1.0);
        const albedo = mix(pick(vHue, 'belly'), pick(vHue, 'back'), smoothstep(0.3, 0.8, flank)).toVar();
        // Clownfish wear white bands; the others a dark tail.
        const bands = step(2.5, vHue).mul(step(0.62, abs(fract(vAlong.mul(3.2).add(0.15)).sub(0.5)).mul(2.0)));
        albedo.assign(mix(albedo, pick(vHue, 'band'), bands));
        albedo.mulAssign(float(1.0).sub(smoothstep(0.75, 0.95, vAlong).mul(0.55).mul(float(1.0).sub(step(2.5, vHue)))));
        const lit = ocLight(u, { N, P, wrap: 0.4 });
        const view = normalize(P.sub(cameraPosition));
        const sheen = ocBackdrop(u, reflect(view, N)).mul(0.25);
        // Their colour is their own: a little of it glows in the blue.
        const col = albedo.mul(lit).add(sheen).add(albedo.mul(u.fluor).mul(0.08)).mul(u.breath.mul(0.4).add(0.6));
        return vec4(ocFog(u, col, P), 1.0);
    })();
    const part = ocPart('OceanReefFish', geometry, material, 7);
    part.count = homes.length;
    return part;
}

/** min(x, 1) for a node (the scare's strength may exceed 1). */
function min1(x) {
    return clamp(x, 0.0, 1.0);
}

// ── Moon jellies ────────────────────────────────────────────────────────────────

/**
 * A moon jelly half a metre across: a bell with a frilled rim, four oral arms and a fringe of
 * tentacles. aShape = (part: 0 bell, 1 arm, 2 tentacle; how far down it: 0 at the crown).
 */
export function jellyShape(seed = 5) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const RINGS = 6;
    const SIDES = 20;
    const rows = [];
    for (let j = 0; j <= RINGS; j++) {
        const lat = (j / RINGS) * (Math.PI / 2) * 1.05;
        const row = [];
        for (let k = 0; k < SIDES; k++) {
            const a = (k / SIDES) * TAU;
            const frill = j === RINGS ? 1 + 0.06 * Math.sin(a * 8) : 1;
            const r = Math.sin(lat) * 0.5 * frill;
            const y = Math.cos(lat) * 0.3;
            row.push(shape.vert([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a) * Math.sin(lat), Math.cos(lat), Math.sin(a) * Math.sin(lat)], 0, j / RINGS, a / TAU, 0));
        }
        rows.push(row);
    }
    const crown = shape.vert([0, 0.3, 0], [0, 1, 0], 0, 0, 0, 0);
    for (let k = 0; k < SIDES; k++) {
        const k1 = (k + 1) % SIDES;
        shape.tri(crown, rows[0][k], rows[0][k1]);
        for (let j = 0; j < RINGS; j++) shape.quad(rows[j][k], rows[j][k1], rows[j + 1][k1], rows[j + 1][k]);
    }
    // Ribbons hanging from under the bell: four oral arms, and a fringe of fine tentacles.
    const ribbon = (x, z, drop, width, part, steps, angle) => {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        let prev = null;
        for (let i = 0; i <= steps; i++) {
            const f = i / steps;
            const y = -f * drop;
            const w = width * (1 - 0.7 * f);
            const a = shape.vert([x - s * w, y, z + c * w], [c, 0, s], part, f, angle / TAU, f);
            const b = shape.vert([x + s * w, y, z - c * w], [c, 0, s], part, f, angle / TAU, f);
            if (prev) {
                shape.quad(prev[0], prev[1], b, a);
            }
            prev = [a, b];
        }
    };
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        ribbon(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.38 + rand() * 0.12, 0.05, 1, 6, a + Math.PI / 2);
    }
    for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        ribbon(Math.cos(a) * 0.49, Math.sin(a) * 0.49, 0.25 + rand() * 0.35, 0.006, 2, 4, a + Math.PI / 2);
    }
    return shape;
}

/**
 * @param {object} u
 * @param {number} count
 */
export function createJellies(u, count) {
    const n = Math.max(1, count);
    const shape = jellyShape();
    const base = shape.geometry(true);
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(base.attributes).forEach((k) => geometry.setAttribute(k, base.attributes[k]));
    geometry.setIndex(base.index);
    const data = new Float32Array(n * 4);
    const rand = mulberry32(1203);
    let placed = 0;
    let guard = 0;
    while (placed < n && guard < 400) {
        guard += 1;
        const side = placed % 2 ? 1 : -1;
        const x = side * (5 + rand() * 12);
        const z = -3 - rand() * 22;
        const y = 4.5 + rand() * 7;
        data.set([x, y, z, rand()], placed * 4);
        placed += 1;
    }
    if (count <= 0) data.set([0, -50, 0, 0], 0);
    geometry.setAttribute('aJelly', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanJellies';
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    const aJelly = attribute('aJelly', 'vec4');
    const aShape = attribute('aShape', 'vec2');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'vJellyN');
    const vPart = varying(aShape.x, 'vJellyPart');
    const vDown = varying(aShape.y, 'vJellyDown');
    const vPulse = varying(float(0.0), 'vJellyPulse');
    material.positionNode = Fn(() => {
        const seed = aJelly.w;
        const t = u.time;
        // The bell beats: a quick squeeze, a slow open.
        const beat = fract(t.mul(seed.mul(0.15).add(0.38)).add(seed));
        const squeeze = smoothstep(0.0, 0.18, beat).mul(float(1.0).sub(smoothstep(0.25, 0.95, beat)));
        vPulse.assign(squeeze);
        const p = positionGeometry.toVar();
        const isBell = float(1.0).sub(step(0.5, aShape.x));
        const narrow = float(1.0).sub(squeeze.mul(0.2).mul(aShape.y));
        p.x.mulAssign(mix(float(1.0), narrow, isBell));
        p.z.mulAssign(mix(float(1.0), narrow, isBell));
        p.y.addAssign(squeeze.mul(0.05).mul(isBell).mul(aShape.y));
        // What hangs below trails behind the beat, swaying.
        const trail = aShape.y.mul(float(1.0).sub(isBell));
        p.x.addAssign(sin(t.mul(1.3).add(uv().x.mul(TAU)).add(trail.mul(3.0))).mul(trail).mul(0.07));
        p.z.addAssign(cos(t.mul(1.1).add(uv().x.mul(TAU)).add(trail.mul(2.6))).mul(trail).mul(0.07));
        p.y.addAssign(squeeze.mul(trail).mul(0.06));
        // It drifts up on each beat and sinks between, on a long slow wander.
        const drift = vec3(
            sin(t.mul(0.05).add(seed.mul(20.0))).mul(1.5).add(u.current.mul(sin(t.mul(0.02).add(seed)).mul(2.0))),
            sin(t.mul(0.07).add(seed.mul(9.0))).mul(1.4),
            cos(t.mul(0.045).add(seed.mul(13.0))).mul(1.5),
        );
        const size = seed.mul(0.35).add(0.7);
        const tilt = sin(t.mul(0.2).add(seed.mul(7.0))).mul(0.25);
        const leaned = vec3(p.x, p.y.mul(cos(tilt)).sub(p.z.mul(sin(tilt))), p.z.mul(cos(tilt)).add(p.y.mul(sin(tilt))));
        vNormal.assign(normalize(attribute('normal', 'vec3')));
        return vec3(aJelly.x.mul(u.squeeze), aJelly.y, aJelly.z).add(drift).add(leaned.mul(size));
    })();
    material.outputNode = Fn(() => {
        const P = positionWorld;
        const view = normalize(P.sub(cameraPosition));
        const N = normalize(vNormal);
        const edge = float(1.0).sub(abs(dot(N, view)));
        const isBell = float(1.0).sub(step(0.5, vPart));
        // Glass: what shows is the rim, catching the light from above.
        const above = clamp(N.y.mul(0.5).add(0.5), 0.0, 1.0);
        const glass = u.shallow.mul(0.5).add(u.sun.mul(above).mul(0.18)).mul(ocPow4(edge).mul(1.6).add(0.06));
        // The four rings of the gonads, rose through the bell.
        const ring = exp(abs(vDown.sub(0.32)).mul(-16.0)).mul(isBell).mul(0.4);
        const rose = vec3(0.9, 0.35, 0.65).mul(ring).mul(u.ambient.add(u.sun.mul(0.3)));
        // At night the rim glows, flaring as the bell beats.
        const rim = smoothstep(0.75, 1.0, vDown).mul(isBell).add(float(1.0).sub(isBell).mul(0.4));
        const glow = u.glow.mul(rim).mul(u.night.mul(0.85).add(u.fluor.mul(0.15))).mul(vPulse.mul(1.5).add(0.6));
        const parts = mix(float(0.5), float(1.0), isBell);
        const seen = exp(length(P.sub(cameraPosition)).mul(-0.045));
        const col = glass.mul(parts).add(rose).add(glow.mul(1.4));
        return vec4(col.mul(seen).mul(u.breath), 0.0);
    })();
    const part = ocPart('OceanJellies', geometry, material, 66);
    part.count = count;
    return part;
}
