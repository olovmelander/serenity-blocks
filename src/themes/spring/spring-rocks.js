/**
 * Spring — the granite: boulders the rapids break over and lying along the banks, slabs
 * breaking through the shoulder of the knoll the eye stands on, and the big jointed blocks the
 * gorge's walls and the fall's step are built of.
 *
 * The stones are authored in Blender (spring-assets.js, `rocks`): plain meshes whose colours
 * carry pale lichen (R), moss (G), baked occlusion (B) and a tone (A). Each placement is one
 * instance; a stone knows the level of the water beside it, so it goes dark and glistening below
 * the flood's wet line.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    instancedBufferAttribute,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { aerial } from './spring-light.js';
import {
    BOULDERS, EYE, S_LIP, S_POOL, courseAt, levelAt,
} from './spring-plan.js';
import {
    KNOLL, groundHeight, groundNormal, knollOutside, waterEdge,
} from './spring-terrain.js';

const BOULDER_MESHES = ['boulder_0', 'boulder_1', 'boulder_2', 'boulder_3', 'boulder_4'];
const SLAB_MESHES = ['slab_0', 'slab_1'];

/**
 * Lay the stones out: { mesh, x, y, z, yaw, scale [sx, sy, sz], level } each. Deterministic.
 * `bankCount` boulders along the banks, every boulder of the plan in the river, slabs round the
 * knoll's shoulder, `wallCount` blocks sunk into the steep faces round the plunge pool.
 */
export function layoutRocks(baked, { bankCount = 36, slabCount = 10, wallCount = 40 } = {}, seed = 0x6b2d) {
    const random = mulberry32(seed);
    const out = [];
    const c = {};
    const w = {};
    // In the river: the plan's boulders, their crowns a third of their radius out of the water.
    BOULDERS.forEach((b, k) => {
        courseAt(b.s, c);
        const across = b.n * c.halfWidth;
        const level = levelAt(b.s);
        const size = b.r * 0.95;
        out.push({
            mesh: BOULDER_MESHES[k % BOULDER_MESHES.length],
            x: c.x - c.tz * across,
            z: c.z + c.tx * across,
            y: level + b.r * 0.33 - size * 1.2,
            yaw: random() * Math.PI * 2,
            scale: [size, size * (0.9 + random() * 0.3), size],
            level,
        });
    });
    // Along the banks: half in the water, or up on the meadow's edge.
    for (let k = 0, tries = 0; k < bankCount && tries < bankCount * 40; tries++) {
        const s = S_LIP + 8 + random() * 330;
        courseAt(s, c);
        const side = random() < 0.5 ? -1 : 1;
        const across = side * (c.halfWidth + (random() - 0.2) * 5);
        const x = c.x - c.tz * across;
        const z = c.z + c.tx * across;
        waterEdge(baked, x, z, w);
        if (w.edge < -1.5 || w.edge > 6) continue;
        const ground = groundHeight(baked, x, z);
        const size = 0.5 + random() ** 2 * 1.6;
        out.push({
            mesh: BOULDER_MESHES[Math.floor(random() * BOULDER_MESHES.length)],
            x,
            z,
            y: ground - size * 0.25,
            yaw: random() * Math.PI * 2,
            scale: [size, size * (0.8 + random() * 0.4), size],
            level: w.level,
        });
        k++;
    }
    // Slabs breaking through the knoll's shoulder, where it falls to the water.
    const n = [0, 1, 0];
    for (let k = 0, tries = 0; k < slabCount && tries < slabCount * 60; tries++) {
        const a = -Math.PI * (0.12 + random() * 0.76);
        const r = 0.8 + random() * 0.45;
        const x = EYE.x + Math.cos(a) * r * KNOLL.rx;
        const z = EYE.z + KNOLL.back + Math.sin(a) * r * KNOLL.rz;
        const out0 = knollOutside(x, z);
        if (out0 < -2.5 || out0 > 5) continue;
        if (Math.hypot(x - EYE.x, z - EYE.z) < 4) continue;
        waterEdge(baked, x, z, w);
        if (w.edge < 0.5) continue;
        const ground = groundHeight(baked, x, z);
        groundNormal(baked, x, z, n, 1.5);
        const size = 0.45 + random() * 0.5;
        out.push({
            mesh: SLAB_MESHES[k % SLAB_MESHES.length],
            x,
            z,
            y: ground - 0.35 * size,
            yaw: random() * Math.PI * 2,
            scale: [size, size * (0.6 + random() * 0.6), size],
            level: -100,
        });
        k++;
    }
    // The gorge's walls and the step's rim: big jointed blocks sunk into the steep faces round
    // the plunge pool, so the rock reads as granite and not as a smoothed bank. (The authored
    // cliff faces in the pack, cliff_0 and cliff_1, are not placed: blocks read better here.)
    const foot = courseAt(S_POOL, {});
    for (let k = 0, tries = 0; k < wallCount && tries < wallCount * 60; tries++) {
        const a = random() * Math.PI * 2;
        const r = 9 + random() * 64;
        const x = foot.x + Math.cos(a) * r;
        const z = foot.z + Math.sin(a) * r;
        waterEdge(baked, x, z, w);
        if (w.edge < 0.3) continue;
        groundNormal(baked, x, z, n, 2.0);
        if (n[1] > 0.62) continue;
        const ground = groundHeight(baked, x, z);
        // A block of 3–8 m (the boulder meshes are about 2 m), its middle sunk into the face.
        const size = 3 + random() ** 1.5 * 5;
        const sink = size * 0.3;
        const flat = Math.hypot(n[0], n[2]) || 1;
        out.push({
            mesh: BOULDER_MESHES[Math.floor(random() * BOULDER_MESHES.length)],
            x: x - (n[0] / flat) * sink,
            z: z - (n[2] / flat) * sink,
            y: ground - size * 0.6,
            yaw: Math.atan2(n[0], n[2]) + (random() - 0.5) * 0.7,
            scale: [
                (size / 2) * (0.8 + random() * 0.5),
                (size / 2) * (0.9 + random() * 0.8),
                (size / 2) * (0.7 + random() * 0.4),
            ],
            level: w.level,
        });
        k++;
    }
    return out;
}

const GRANITE = [0.21, 0.195, 0.185];
const SCHIST = [0.075, 0.075, 0.08];
/** Where the fall meets the pool: the stones round it are the step's own rock. */
const FALL_FOOT = courseAt(S_POOL, {});
const LICHEN = [0.36, 0.38, 0.31];
const MOSS = [0.045, 0.09, 0.028];
const WET = [0.03, 0.029, 0.027];

export function createRocks(u, tex, assets, baked, tier) {
    const group = new THREE.Group();
    group.name = 'SpringRocks';
    const owned = [];
    if (!assets?.rocks) {
        return {
            mesh: group, meshes: [group], count: 0, update() {}, dispose() {},
        };
    }
    const placements = layoutRocks(baked, {
        bankCount: tier.bankRocks ?? 36, slabCount: tier.slabs ?? 10, wallCount: (tier.slabs ?? 10) * 4,
    });
    const byMesh = new Map();
    placements.forEach((p) => {
        if (!assets.rocks.meshes[p.mesh]) return;
        if (!byMesh.has(p.mesh)) byMesh.set(p.mesh, []);
        byMesh.get(p.mesh).push(p);
    });
    const dummy = new THREE.Object3D();
    byMesh.forEach((list, name) => {
        const geometry = assets.rocks.meshes[name];
        const water = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = `SpringRock ${name}`;
        const level = instancedBufferAttribute(water);
        const paint = attribute('color', 'vec4');
        material.colorNode = Fn(() => {
            const P = positionWorld;
            const N = normalize(normalWorld);
            const L = u.sunDir;
            const grain = texture(tex.noise, P.xz.add(P.y.mul(0.7)).div(3.1)).toVar();
            const fine = texture(tex.noise, vec2(P.x.add(P.z), P.y).div(0.9)).toVar();
            // Granite boulders far and wide; round the fall the stones are the step's dark schist.
            const fallSide = smoothstep(150.0, 70.0, length(P.xz.sub(vec2(FALL_FOOT.x, FALL_FOOT.z))));
            const albedo = mix(vec3(...GRANITE), vec3(...SCHIST), fallSide.mul(0.85)).mul(paint.a.mul(0.45).add(0.75))
                .mul(grain.r.mul(0.35).add(0.82)).mul(fine.g.mul(0.25).add(0.87))
                .toVar();
            const lichen = smoothstep(0.5, 0.8, paint.r.add(fine.b.sub(0.5).mul(0.4))).mul(0.55);
            albedo.assign(mix(albedo, vec3(...LICHEN), lichen));
            const moss = smoothstep(0.35, 0.7, paint.g.add(grain.a.sub(0.5).mul(0.3))).mul(0.75);
            albedo.assign(mix(albedo, vec3(...MOSS), moss));
            // Dark crystals and pits.
            albedo.mulAssign(float(1.0).sub(smoothstep(0.72, 0.85, fine.a).mul(0.35)));
            // Below the flood's wet line the stone is dark and glistens.
            const wet = smoothstep(0.7, 0.0, P.y.sub(level.add(u.flood)));
            albedo.assign(mix(albedo, vec3(...WET).mul(grain.g.mul(0.5).add(0.75)), wet.mul(0.9)));
            const occlusion = paint.b.mul(0.85).add(0.15);
            const sunLight = u.sun.mul(u.sunUp);
            const sky = u.fill.mul(N.y.mul(0.35).add(0.65));
            const lit = albedo.mul(sunLight.mul(max(dot(N, L), 0.0).mul(0.55)).add(sky).add(u.bounce.mul(0.35)))
                .mul(occlusion).toVar();
            const V = normalize(P.sub(u.eye));
            const R = V.sub(N.mul(dot(V, N).mul(2.0)));
            const g = clamp(dot(R, L), 0.0, 1.0);
            const g4 = g.mul(g).mul(g).mul(g);
            lit.addAssign(sunLight.mul(g4.mul(g4).mul(wet).mul(0.5)));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        owned.push(material);
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        mesh.name = `SpringRocks ${name}`;
        list.forEach((p, k) => {
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.yaw, 0);
            dummy.scale.set(p.scale[0], p.scale[1], p.scale[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(k, dummy.matrix);
            water.array[k] = p.level;
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 2;
        group.add(mesh);
    });
    return {
        mesh: group,
        meshes: [group],
        count: placements.length,
        update() {},
        dispose() {
            group.traverse((object) => {
                if (object.isInstancedMesh) object.dispose();
            });
            owned.forEach((m) => m.dispose());
            group.clear();
        },
    };
}
