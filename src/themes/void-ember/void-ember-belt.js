/**
 * Void Ember — the cinder belt and the cinder world: what the ember still lights.
 *
 * The belt is the wreck of whatever once circled this star: a few thousand chiselled stones on
 * their own orbits, seen almost edge-on, the near arc crossing the star's lower face as black
 * shapes and the far arc going behind it. Nothing lights them but the star, so each is a sliver
 * of ember light with the dark behind it, and they brighten as play blows the star up. When a
 * clear's wave reaches a stone it flashes in the wave's colour, is shoved outward, and the fire
 * that got into its cracks takes a few seconds to die.
 *
 * The cinder world is one dead planet far out on the other side of the board, backlit: a thin
 * crescent, a breath of atmosphere past the terminator, and old lava still glowing in its night
 * side when the star is hot.
 *
 * Orbit, tumble and the wave's shove are closed forms of the clock: no per-frame CPU work, and a
 * seek reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EMBER, TAU, mulberry32, veBlackbody, veFxMaterial, vePart, veSolidMaterial, veWaveLight,
} from './void-ember-tsl.js';

/** Stone sizes (world units; the star's radius is 10) and tessellation per class. */
export const ROCK_CLASSES = Object.freeze([
    {
        name: 'boulders', detail: 2, size: [0.5, 1.35], maxOrbit: 3.4,
    },
    {
        name: 'stones', detail: 1, size: [0.2, 0.62], maxOrbit: 3.9,
    },
    {
        name: 'gravel', detail: 0, size: [0.07, 0.24], maxOrbit: 3.9,
    },
]);

/**
 * A chiselled stone: a ball cut by random planes, stretched, with flat faces.
 * @returns {THREE.BufferGeometry} non-indexed, with per-face normals
 */
export function createRockGeometry(seed, detail) {
    const rand = mulberry32(seed);
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const pos = geometry.getAttribute('position');
    const cuts = [];
    const cutCount = 7 + Math.floor(rand() * 5);
    for (let i = 0; i < cutCount; i++) {
        const z = rand() * 2 - 1;
        const a = rand() * TAU;
        const r = Math.sqrt(1 - z * z);
        cuts.push([r * Math.cos(a), z, r * Math.sin(a), 0.52 + rand() * 0.36]);
    }
    const stretch = [0.72 + rand() * 0.5, 0.6 + rand() * 0.42, 0.75 + rand() * 0.5];
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        for (let c = 0; c < cuts.length; c++) {
            const [nx, ny, nz, d] = cuts[c];
            const over = x * nx + y * ny + z * nz - d;
            if (over > 0) {
                x -= nx * over;
                y -= ny * over;
                z -= nz * over;
            }
        }
        pos.setXYZ(i, x * stretch[0], y * stretch[1], z * stretch[2]);
    }
    geometry.computeVertexNormals(); // non-indexed: one normal per face
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * The stones of one class, as plain numbers (three-free: tests read it).
 * @returns {{ orbit: Float32Array, body: Float32Array, seed: Float32Array, count: number }}
 */
export function planRocks(seed, count, cls) {
    const rand = mulberry32(seed);
    const orbit = new Float32Array(count * 4);
    const body = new Float32Array(count * 4);
    const seeds = new Float32Array(count * 4);
    const span = Math.min(EMBER.beltOuter, cls.maxOrbit) - EMBER.beltInner;
    for (let i = 0; i < count; i++) {
        // Thickest near the belt's own radius, thinning to both edges.
        const t = (rand() + rand() + rand()) / 3;
        const radius = EMBER.beltInner + span * Math.min(1, Math.max(0, 0.5 + (t - 0.5) * 2.1));
        const gauss = (rand() + rand() + rand() + rand() - 2) * 0.5;
        const height = gauss * EMBER.beltThickness * (radius / EMBER.beltPeak);
        // Kepler: the inner stones overtake the outer ones.
        const speed = 0.0345 * (EMBER.beltPeak / radius) ** 1.5 * (0.94 + rand() * 0.12);
        orbit.set([radius, rand() * TAU, height, speed], i * 4);
        const size = cls.size[0] + (cls.size[1] - cls.size[0]) * rand() ** 1.9;
        body.set([size, Math.acos(rand() * 2 - 1), rand() * TAU, (0.05 + rand() * 0.3) * (rand() < 0.5 ? -1 : 1)], i * 4);
        seeds.set([rand() * TAU, rand(), rand() * 40, rand()], i * 4);
    }
    return {
        orbit, body, seed: seeds, count,
    };
}

/** Where a stone is in the belt's frame at `time` (star radii). CPU twin of the vertex stage. */
export function rockPosition(plan, index, time, out = [0, 0, 0]) {
    const r = plan.orbit[index * 4];
    const a = plan.orbit[index * 4 + 1] + plan.orbit[index * 4 + 3] * time;
    out[0] = Math.cos(a) * r;
    out[1] = plan.orbit[index * 4 + 2];
    out[2] = Math.sin(a) * r;
    return out;
}

/**
 * One class of stones.
 * @param {object} u       shared uniforms
 * @param {object} cls     ROCK_CLASSES entry
 * @param {number} count
 * @param {number} seed
 * @param {object} opts
 * @param {boolean} [opts.cracks=true]  the fire in the cracks (one noise read per pixel)
 */
export function createRocks(u, cls, count, seed, { cracks = true } = {}) {
    const plan = planRocks(seed, count, cls);
    const rock = createRockGeometry(seed * 31 + 7, cls.detail);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', rock.getAttribute('position'));
    geometry.setAttribute('normal', rock.getAttribute('normal'));
    geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(plan.orbit, 4));
    geometry.setAttribute('aBody', new THREE.InstancedBufferAttribute(plan.body, 4));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(plan.seed, 4));
    geometry.instanceCount = count;

    const orbit = attribute('aOrbit', 'vec4');
    const body = attribute('aBody', 'vec4');
    const seeds = attribute('aSeed', 'vec4');

    const material = veSolidMaterial(`VoidEmberRocks_${cls.name}`);

    // ── Where the stone is ──
    const angle = orbit.y.add(orbit.w.mul(u.time));
    const inBelt = vec3(cos(angle).mul(orbit.x), orbit.z, sin(angle).mul(orbit.x));
    const fromStar = u.beltRot.mul(inBelt);
    // The wave: light, afterglow and a shove, all from the stone's own distance.
    const wave = veWaveLight(u, orbit.x);
    const shove = normalize(fromStar).mul(wave.w.mul(0.03).add(max(wave.x, max(wave.y, wave.z)).mul(0.14)));
    const centre = u.centre.add(fromStar.add(shove).mul(u.radius));
    // Its tumble: a turn about its own axis.
    const axis = vec3(sin(body.y).mul(cos(body.z)), cos(body.y), sin(body.y).mul(sin(body.z)));
    const turn = seeds.x.add(body.w.mul(u.time));
    const ct = cos(turn);
    const st = sin(turn);
    const spinV = (v) => v.mul(ct).add(cross(axis, v).mul(st)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(ct)));
    const world = centre.add(spinV(positionGeometry).mul(body.x));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

    const vWorld = varying(world, 'veRockWorld');
    const vNormal = varying(spinV(normalGeometry), 'veRockNormal');
    const vLocal = varying(positionGeometry, 'veRockLocal');
    const vWave = varying(wave, 'veRockWave');
    const vSeed = varying(vec3(seeds.y, seeds.z, orbit.x), 'veRockSeed');

    material.colorNode = Fn(() => {
        const N = normalize(vNormal).toVar();
        const toStar = u.centre.sub(vWorld).toVar();
        const radii = max(length(toStar).div(u.radius), 1.0).toVar();
        const L = toStar.div(length(toStar));
        const V = normalize(cameraPosition.sub(vWorld));
        const ndl = dot(N, L).toVar();
        const day = smoothstep(-0.04, 0.3, ndl).mul(max(ndl, 0.0).mul(0.75).add(0.25)).toVar();
        // The star's light thins with the square of the distance.
        const fall = min(float(9.0).div(radii.mul(radii)), 3.0);
        const albedo = u.rock.mul(vSeed.x.mul(0.9).add(1.0));
        const col = albedo.mul(u.starLight).mul(day.mul(fall)).toVar();
        // A dusty sheen where the light grazes.
        const graze = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        col.addAssign(u.starLight.mul(graze.mul(graze).mul(graze).mul(day).mul(fall)
            .mul(0.05)));
        // What little the void gives the night side.
        col.addAssign(u.fill.mul(N.y.mul(0.35).add(0.65)).mul(albedo.x.mul(8.0)).mul(u.iris.pow(0.72)));
        // The wave's front lights the side that faces the star.
        col.addAssign(albedo.mul(vWave.rgb).mul(day.mul(0.6).add(0.4)).mul(6.0));
        if (cracks) {
            // Fire in the cracks: what the wave leaves behind, and the star's own heat close in.
            const n = u.noise3(vLocal.mul(2.7).add(vec3(vSeed.y, vSeed.y.mul(1.7), 3.0)));
            const seam = float(1.0).sub(abs(n.x.mul(2.0).sub(1.0)));
            const crack = seam.mul(seam).mul(seam).mul(seam).mul(seam)
                .mul(smoothstep(0.25, 0.7, n.y));
            const near = float(1.0).sub(smoothstep(2.1, 3.6, vSeed.z)).mul(max(u.heat.sub(0.4), 0.0)).mul(1.5);
            const fire = vWave.w.mul(0.8).add(near);
            col.addAssign(veBlackbody(fire.mul(0.4).add(0.22)).mul(crack.mul(fire).mul(2.4)));
        }
        return vec4(col.mul(u.breath.mul(0.75).add(0.25)), 1.0);
    })();

    const part = vePart(`VoidEmberRocks_${cls.name}`, geometry, material, 2);
    part.plan = plan;
    part.count = count;
    part.extraGeometry = rock;
    return part;
}

// ── The cinder world ────────────────────────────────────────────────────────────

/** @param {object} u shared uniforms */
export function createCinderWorld(u, { segments = 48 } = {}) {
    const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6));
    const material = veSolidMaterial('VoidEmberCinderWorld');
    material.colorNode = Fn(() => {
        const p = normalize(positionLocal).toVar();
        const N = normalize(positionWorld.sub(u.worldCentre)).toVar();
        const V = normalize(cameraPosition.sub(positionWorld));
        const toStar = u.centre.sub(u.worldCentre);
        const radii = length(toStar).div(u.radius);
        const L = normalize(toStar);
        const ndl = dot(N, L).toVar();
        const mu = clamp(dot(N, V), 0.0, 1.0).toVar();
        const day = smoothstep(-0.1, 0.22, ndl).mul(max(ndl, 0.0).mul(0.8).add(0.2)).toVar();
        const fall = min(float(9.0).div(radii.mul(radii)), 3.0);
        // Highlands and basins, and a net of old rifts.
        const land = u.noise3(p.mul(3.1).add(vec3(5.0, 1.0, 9.0))).toVar();
        const fine = u.noise3(p.mul(9.5).add(vec3(2.0, 7.0, 4.0))).toVar();
        const albedo = u.rock.mul(land.x.mul(0.9).add(fine.x.mul(0.5)).add(0.35));
        const wave = veWaveLight(u, radii);
        const col = albedo.mul(u.starLight.mul(fall.mul(4.0)).add(wave.rgb.mul(5.0))).mul(day).toVar();
        // The atmosphere catches the light past the terminator: a thin bright arc.
        const rim = float(1.0).sub(mu);
        const air = rim.mul(rim).mul(rim).mul(rim).mul(rim)
            .mul(smoothstep(-0.3, 0.3, ndl));
        col.addAssign(u.starLight.mul(fall).add(wave.rgb.mul(2.0)).mul(air.mul(0.7)));
        // Old lava in the night side, waking as the star does.
        const seam = float(1.0).sub(abs(fine.y.mul(2.0).sub(1.0)));
        const rift = seam.mul(seam).mul(seam).mul(seam).mul(seam)
            .mul(smoothstep(0.35, 0.75, land.y));
        const wake = u.heat.mul(u.heat).mul(0.8).add(0.012).add(wave.w.mul(0.5));
        col.addAssign(veBlackbody(wake.mul(0.35).add(0.18)).mul(rift.mul(wake).mul(1.3)).mul(float(1.0).sub(day)));
        col.addAssign(u.fill.mul(0.5));
        return vec4(col.mul(u.breath.mul(0.75).add(0.25)), 1.0);
    })();
    return vePart('VoidEmberCinderWorld', geometry, material, 1);
}

// ── The belt's dust ─────────────────────────────────────────────────────────────

/**
 * The fine dust the stones ride in: a thin ring of ringlets and gaps in the belt's plane. Seen
 * almost edge-on it is a band that glows where the star's light comes through it toward the
 * camera, dims what is behind it, and lights up as a clear's wave runs out along it.
 *
 * @param {object} u
 * @param {object} opts
 * @param {number} [opts.detail=2]  noise reads per pixel (1..3)
 */
export function createDustRing(u, { detail = 2 } = {}) {
    const inner = EMBER.beltInner - 0.35;
    const outer = EMBER.beltOuter + 0.45;
    const segments = 160;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * TAU;
        positions.set([Math.cos(a) * inner, 0, Math.sin(a) * inner], i * 6);
        positions.set([Math.cos(a) * outer, 0, Math.sin(a) * outer], i * 6 + 3);
        if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);

    const material = veFxMaterial('VoidEmberDustRing');
    const world = u.centre.add(u.beltRot.mul(positionGeometry).mul(u.radius));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const vLocal = varying(positionGeometry, 'veRingLocal');
    const vWorld = varying(world, 'veRingWorld');

    material.colorNode = Fn(() => {
        const r = length(vLocal.xz).toVar();
        // Ringlets and gaps: noise along the radius only, at two scales; clumps along the ring.
        const lanes = u.noise3(vec3(r.mul(7.5), 3.3, 9.1)).toVar();
        let fine = float(0.5);
        if (detail >= 2) fine = u.noise3(vec3(r.mul(31.0), 1.7, 4.4)).x;
        let clump = float(0.5);
        if (detail >= 3) clump = u.noise3(vec3(vLocal.x.mul(1.6), vLocal.z.mul(1.6), u.time.mul(0.004))).x;
        const body = smoothstep(inner, inner + 0.5, r).mul(float(1.0).sub(smoothstep(outer - 0.9, outer, r)));
        const bulk = exp(r.sub(EMBER.beltPeak).mul(r.sub(EMBER.beltPeak)).mul(-0.9)).mul(0.75).add(0.25);
        const gaps = smoothstep(0.24, 0.42, lanes.y);
        const density = body.mul(bulk).mul(lanes.x.mul(0.8).add(0.2)).mul(fine.mul(0.7).add(0.65))
            .mul(clump.mul(0.6).add(0.7))
            .mul(gaps)
            .toVar();

        // The longer the line of sight lies in the ring, the more dust it crosses.
        const V = normalize(cameraPosition.sub(vWorld)).toVar();
        const normal = u.beltRot.mul(vec3(0.0, 1.0, 0.0));
        const slant = float(1.0).div(max(abs(dot(V, normal)), 0.16));
        const tau = density.mul(slant).mul(0.11);
        const alpha = float(1.0).sub(exp(tau.negate())).toVar();

        // Lit by the star alone: brightest where its light comes on through the dust at us.
        const away = normalize(vWorld.sub(u.centre));
        const cosine = dot(away, V);
        const forward = max(cosine, 0.0);
        const phase = forward.mul(forward).mul(forward).mul(1.3).add(float(1.0).sub(abs(cosine)).mul(0.3))
            .add(0.26);
        const fall = min(float(9.0).div(r.mul(r)), 3.0);
        // The dust takes the sky's share of the star's light: it must not veil a white-hot star.
        // And a breath of the void's own cold light, which is what the far side of the ring
        // shows: each level's palette is read in it.
        const cold = mix(u.dustA, u.dustB, lanes.x).mul(smoothstep(2.3, 3.7, r).mul(0.2).add(0.035))
            .mul(u.iris.pow(0.72));
        const light = u.skyLight.mul(fall).mul(phase).mul(0.27).add(cold)
            .toVar();
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = veWaveLight(u, r);
            light.addAssign(wave.rgb.mul(1.2).add(u.skyLight.mul(wave.w).mul(0.05)));
        });
        return vec4(light.mul(alpha).mul(u.breath.mul(0.75).add(0.25)), alpha.mul(0.3));
    })();

    return vePart('VoidEmberDustRing', geometry, material, 8);
}
