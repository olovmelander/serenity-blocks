/**
 * Forest — the forest floor.
 *
 * Ferns in rosettes round the feet of the old trunks and along the ride, tufts of grass,
 * wood stars in the moss, foxfire fungi on the fallen spruce and the roots, boulders, the
 * fallen trunk on the knoll and the stump it left. Fronds, log, stump and stones are
 * Blender-authored (see forest-assets.js); grass, fungi and flowers are a few triangles
 * each, built here. Everything on the floor bows as a wave of light passes, is lit by the
 * fireflies that drift over it, and the fungi light one by one as a combo wakes the forest.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, float, instancedBufferAttribute, length, mix, normalWorld, normalize,
    positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec3, vec4,
} from 'three/tsl';
import {
    FOREST_EYE, forestRide, forestRideHalfWidth, forestRidePoint,
} from './forest-plan.js';
import { FOREST_KNOLL, forestGroundHeight, forestPlateau } from './forest-terrain.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
/** Where the fallen spruce lies and the stump it broke from. */
export const FOREST_LOG = Object.freeze({ x: FOREST_KNOLL.x - 0.3, z: FOREST_KNOLL.z - 0.4, yaw: -0.45 });
export const FOREST_STUMP = Object.freeze({ x: FOREST_KNOLL.x + 3.3, z: FOREST_KNOLL.z + 1.5, yaw: 1.1 });
// The stag stands in front of the knoll, clear of the score panel and of the elder pine.
export const FOREST_STAG_STAND = Object.freeze({ x: 10.2, z: -5.4 });
// Stones placed by hand: x, z, width in metres. The rest are scattered.
const FEATURE_STONES = [
    [-4.4, 8.9, 1.9], [-2.9, 9.8, 0.7], [5.6, 9.4, 1.1], [13.6, 0.2, 1.4], [-9.4, -8.6, 1.6],
    [FOREST_KNOLL.x + 4.6, FOREST_KNOLL.z - 3.2, 2.3], [3.4, -21, 1.3], [-14.5, -1.5, 1],
];

/** A tuft of grass: a few tapering blades that lean out from one root. */
function createTuftGeometry() {
    const blades = 6;
    const segments = 3;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let blade = 0; blade < blades; blade += 1) {
        const angle = (blade / blades) * TAU + blade * 0.7;
        const lean = 0.25 + ((blade * 37) % 10) * 0.045;
        const height = 0.2 + ((blade * 53) % 10) * 0.02;
        const width = 0.02;
        const base = positions.length / 3;
        const ax = Math.cos(angle);
        const az = Math.sin(angle);
        for (let i = 0; i <= segments; i += 1) {
            const t = i / segments;
            const out = lean * t * t * height;
            const half = width * (1 - t * 0.92) * 0.5;
            const cx = ax * (0.02 + out);
            const cz = az * (0.02 + out);
            positions.push(cx - az * half, height * t * (1 - 0.18 * t), cz + ax * half);
            positions.push(cx + az * half, height * t * (1 - 0.18 * t), cz - ax * half);
            uvs.push(0, t, 1, t);
            if (i < segments) {
                const a = base + i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** A foxfire cap: a short stem under a domed cap, lathed. `uv.y` runs from foot to crown. */
function createCapGeometry() {
    const profile = [
        [0.0, 0.0], [0.017, 0.0], [0.012, 0.062], [0.064, 0.058], [0.06, 0.082], [0.036, 0.104], [0.0, 0.112],
    ].map(([radius, height]) => new THREE.Vector2(radius, height));
    return new THREE.LatheGeometry(profile, 9);
}

/** A wood star: seven narrow petals laid nearly flat. */
function createFlowerGeometry() {
    const petals = 7;
    const positions = [0, 0.01, 0];
    const uvs = [0.5, 0.5];
    const indices = [];
    for (let i = 0; i < petals; i += 1) {
        const angle = (i / petals) * TAU;
        const next = angle + (TAU / petals) * 0.62;
        const mid = (angle + next) / 2;
        positions.push(Math.cos(angle) * 0.4, 0.02, Math.sin(angle) * 0.4);
        positions.push(Math.cos(mid), 0.1, Math.sin(mid));
        positions.push(Math.cos(next) * 0.4, 0.02, Math.sin(next) * 0.4);
        uvs.push(0.4, 0.4, 1, 1, 0.4, 0.4);
        const base = 1 + i * 3;
        indices.push(0, base + 2, base, base, base + 2, base + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export class ForestUnderstory {
    constructor({
        light, assets, tier, rng = Math.random, trunks = [],
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.trunks = trunks;
        this.group = new THREE.Group();
        this.group.name = 'ForestFloorLife';
        this.owned = [];
        this.stats = {
            ferns: 0, fronds: 0, grass: 0, fungi: 0, flowers: 0, stones: 0,
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildProps();
        this.buildFerns();
        this.buildGrass();
        this.buildFungi();
        this.buildFlowers();
        return this;
    }

    /** Is a spot on the floor clear of every trunk? */
    clear(x, z, margin = 0.35) {
        return !this.trunks.some((trunk) => Math.hypot(trunk.x - x, trunk.z - z) < trunk.radius + margin);
    }

    /** How the wind and a passing wave of light move a point `reach` of the way up a plant. */
    sway(reach, phase) {
        const { light } = this;
        const force = light.floorWind(positionLocal);
        const swing = sin(light.uTime.mul(1.5).add(phase.mul(TAU)).add(positionLocal.x.mul(0.7))).mul(0.045)
            .add(sin(light.uTime.mul(2.9).add(phase.mul(11))).mul(0.014));
        const bend = reach.mul(reach);
        const shove = light.pulseShove(positionLocal).mul(reach).mul(0.36);
        return vec3(light.uWindDir.x, 0, light.uWindDir.z).mul(swing.mul(force).mul(3).mul(bend))
            .add(shove)
            .sub(vec3(0, length(shove).mul(0.35).add(force.mul(bend).mul(0.02)), 0));
    }

    // -- stones, the fallen spruce, the stump -------------------------------------------
    createStoneMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'ForestGranite';
        const paint = attribute('color', 'vec4'); // tone, part id, occlusion, moss
        const world = positionWorld;
        const grain = light.noise(world.xz.mul(0.9).add(world.y.mul(0.7)));
        const fleck = light.noise(world.xz.mul(4.3).add(world.y.mul(3.1)));
        const stone = mix(color(0x22252a), color(0x646a72), paint.r.mul(0.5).add(grain.g.mul(0.5)))
            .mul(fleck.r.mul(0.35).add(0.8));
        const normal = normalize(normalWorld);
        // Moss keeps to the top of a stone and to its damp side.
        const mossy = smoothstep(0.35, 0.75, paint.a.mul(0.6).add(normal.y.mul(0.5)).add(grain.b.mul(0.35)));
        const albedo = mix(stone, mix(color(0x10240a), color(0x40601a), fleck.g), mossy);
        const view = normalize(cameraPosition.sub(world));
        const moon = light.moonlight();
        const facing = saturate(dot(normal, light.uMoonDir));
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.5)));
        const glow = light.glow(world);
        const cool = light.night(albedo);
        const lit = cool.mul(light.moonColour()).mul(facing.mul(1.5).add(rim.mul(1.1))).mul(moon)
            .add(cool.mul(light.ambient(normal)).mul(paint.b.mul(0.85).add(0.15)).mul(1.2))
            .add(albedo.mul(1.6).add(0.008).mul(glow));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        return material;
    }

    /** Dead wood: silvered where it is bare, deep in moss along its upper side. */
    createTimberMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'ForestDeadWood';
        const paint = attribute('color', 'vec4'); // tone, part id, occlusion, moss
        const world = positionWorld;
        const grain = light.noise(world.xz.mul(2.2).add(world.y.mul(3.1)).add(paint.g.mul(7)));
        const fine = light.noise(world.xz.mul(6.1).add(world.y.mul(5.3)));
        const wood = mix(color(0x14100c), color(0x5d5348), paint.r.mul(0.7).add(grain.b.mul(0.3)));
        const normal = normalize(normalWorld);
        const mossy = smoothstep(0.3, 0.7, paint.a.mul(0.7).add(normal.y.mul(0.35)).add(grain.g.mul(0.3)));
        const moss = mix(color(0x0f2409), color(0x466a1c), fine.r);
        const albedo = mix(wood, moss, mossy);
        const view = normalize(cameraPosition.sub(world));
        const moon = light.moonlight();
        const facing = saturate(dot(normal, light.uMoonDir).abs());
        const rim = pow(saturate(dot(normal, view).abs()).oneMinus(), 3)
            .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.5)));
        const glow = light.glow(world);
        const cool = light.night(albedo);
        const lit = cool.mul(light.moonColour()).mul(facing.mul(1.3).add(rim.mul(1.1))).mul(moon)
            .add(cool.mul(light.ambient(normal)).mul(paint.b.mul(0.85).add(0.15)).mul(1.2))
            .add(albedo.mul(1.6).add(0.008).mul(glow))
            // Rotting wood is where foxfire lives: woken, its moss holds a cold light.
            .add(vec3(0.08, 0.75, 0.45).mul(mossy).mul(light.uWake).mul(fine.b.mul(0.6).add(0.1))
                .mul(0.3));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        return material;
    }

    buildProps() {
        const { rng, tier } = this;
        const { meshes } = this.assets.props || { meshes: {} };
        const timber = this.createTimberMaterial();
        const add = (name, x, z, yaw, sink = 0.08) => {
            if (!meshes[name]) return null;
            const mesh = new THREE.Mesh(meshes[name], timber);
            mesh.name = `Forest ${name}`;
            mesh.position.set(x, forestGroundHeight(x, z) - sink, z);
            mesh.rotation.set(0, yaw, 0);
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.updateMatrix();
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            return mesh;
        };
        this.log = add('log', FOREST_LOG.x, FOREST_LOG.z, FOREST_LOG.yaw, 0.1);
        add('stump', FOREST_STUMP.x, FOREST_STUMP.z, FOREST_STUMP.yaw, 0.06);
        const snag = forestRidePoint(58, 9.4);
        add('snag', snag.x, snag.z, 2.3, 0.1);

        const names = ['boulder_a', 'boulder_b', 'boulder_c'].filter((name) => meshes[name]);
        if (!names.length) return;
        const material = this.createStoneMaterial();
        const buckets = names.map(() => []);
        // How wide each boulder mesh is as authored; a stone is scaled to the width asked for.
        const native = { boulder_a: 2.5, boulder_b: 1.7, boulder_c: 1 };
        const place = (x, z, width) => {
            const variant = Math.floor(rng() * names.length) % names.length;
            const size = width / (native[names[variant]] || 1.7);
            buckets[variant].push({
                x, z, y: forestGroundHeight(x, z) - size * 0.14, size, yaw: rng() * TAU, squash: 0.75 + rng() * 0.4,
            });
        };
        FEATURE_STONES.slice(0, tier.rocks).forEach(([x, z, size]) => place(x, z, size));
        const wanted = Math.max(0, tier.rocks - FEATURE_STONES.length);
        for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 20; attempt += 1) {
            const x = (rng() * 2 - 1) * 40;
            const z = 10 - rng() * 62;
            if (this.clear(x, z, 1.2) && Math.hypot(x - FOREST_EYE.x, z - FOREST_EYE.z) > 5) {
                place(x, z, 0.35 + rng() ** 2 * 1.3);
                made += 1;
            }
        }
        const dummy = new THREE.Object3D();
        buckets.forEach((stones, variant) => {
            if (!stones.length) return;
            const mesh = new THREE.InstancedMesh(meshes[names[variant]], material, stones.length);
            mesh.name = `ForestBoulders ${names[variant]}`;
            stones.forEach((stone, index) => {
                dummy.position.set(stone.x, stone.y, stone.z);
                dummy.rotation.set(0, stone.yaw, 0);
                dummy.scale.set(stone.size, stone.size * stone.squash, stone.size);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.stones += stones.length;
        });
    }

    // -- ferns --------------------------------------------------------------------------
    /** Where the rosettes grow, nearest and most telling first. */
    layoutFerns() {
        const { rng } = this;
        const spots = [];
        const add = (x, z, size) => {
            if (!this.clear(x, z, 0.25)) return;
            if (Math.hypot(x - FOREST_EYE.x, z - FOREST_EYE.z) < 2.6) return;
            spots.push({ x, z, size });
        };
        // The corners of the frame, at the eye's feet.
        [[-3.6, 9.4, 1.05], [-5.4, 8.1, 0.9], [3.9, 9.6, 1], [5.8, 8.4, 0.9], [-2.2, 7.4, 0.75],
            [2.6, 7.7, 0.8], [-7.4, 6.3, 0.95], [7.6, 6.6, 0.95]].forEach(([x, z, size]) => add(x, z, size));
        // A skirt of fern round the foot of every near trunk, round the log and the stump.
        const hosts = [
            ...this.trunks.filter((trunk) => Math.hypot(trunk.x - FOREST_EYE.x, trunk.z - FOREST_EYE.z) < 44)
                .map((trunk) => ({
                    x: trunk.x, z: trunk.z, ring: trunk.radius + 0.7, count: trunk.radius > 0.4 ? 6 : 3,
                })),
            {
                x: FOREST_LOG.x, z: FOREST_LOG.z, ring: 2.6, count: 9,
            },
            {
                x: FOREST_STUMP.x, z: FOREST_STUMP.z, ring: 0.9, count: 4,
            },
        ];
        hosts.forEach((host) => {
            for (let i = 0; i < host.count; i += 1) {
                const angle = rng() * TAU;
                const reach = host.ring + rng() * 1.6;
                add(host.x + Math.cos(angle) * reach, host.z + Math.sin(angle) * reach, 0.6 + rng() * 0.45);
            }
        });
        // The rest fill the floor, thickest near the eye and along the edges of the ride.
        for (let attempt = 0; attempt < this.tier.ferns * 14 && spots.length < this.tier.ferns; attempt += 1) {
            const range = 5 + rng() ** 1.1 * 46;
            const bearing = (rng() * 2 - 1) * 0.86 - 0.04;
            const x = FOREST_EYE.x + Math.sin(bearing) * range;
            const z = FOREST_EYE.z - Math.cos(bearing) * range;
            const { s, d } = forestRide(x, z);
            const edge = Math.abs(Math.abs(d) - forestRideHalfWidth(s));
            // Fern likes the half-shade at the foot of the trees more than the open ride.
            const liking = 0.35 + 0.65 * Math.exp(-edge * 0.22) + (forestPlateau(x, z) > 0.5 ? 0.15 : 0);
            if (rng() < liking && forestGroundHeight(x, z) > -2.5) add(x, z, 0.55 + rng() * 0.45);
        }
        return spots.slice(0, this.tier.ferns);
    }

    createFernMaterial(look) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'ForestFern';
        const paint = attribute('color', 'vec4'); // along the frond, pinna id, shade, leaf (1) or rachis (0)
        material.positionNode = positionLocal.add(this.sway(paint.r, look.x.add(paint.g.mul(0.2))));
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const blade = normalize(normalWorld);
        const tone = saturate(look.y.mul(0.6).add(paint.r.mul(0.3)).add(paint.g.sub(0.5).mul(0.2)));
        const leaf = mix(color(0x0a1c0b), color(0x2f5a1c), tone);
        const albedo = mix(color(0x1a140c), leaf, paint.a).mul(paint.b.mul(0.7).add(0.3));
        const moon = light.moonlight();
        const facing = dot(blade, light.uMoonDir).abs();
        // A frond between the eye and the moon glows through.
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 6);
        const silver = pow(leaf, vec3(0.6)).mul(vec3(0.66, 0.96, 0.98));
        const cool = light.night(albedo);
        const front = cool.mul(facing.mul(0.8).add(0.14));
        const back = silver.mul(paint.a).mul(through.mul(0.9).add(0.04)).mul(paint.r.mul(0.5).add(0.5));
        const glow = light.glow(world);
        const lit = front.add(back).mul(light.moonColour()).mul(moon)
            .add(cool.mul(light.ambient(mix(blade, vec3(0, 1, 0), 0.6))).mul(paint.b.mul(0.7).add(0.3)).mul(1.2))
            .add(albedo.mul(1.7).add(0.008).mul(glow).mul(paint.b.mul(0.5).add(0.5)));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        return material;
    }

    buildFerns() {
        const { rng } = this;
        const { meshes } = this.assets.foliage || { meshes: {} };
        const near = meshes.fern_frond_0;
        const far = meshes.fern_frond_1 || near;
        if (!near) return;
        const spots = this.layoutFerns();
        const buckets = [{ geometry: near, matrices: [], look: [] }, { geometry: far, matrices: [], look: [] }];
        const forward = new THREE.Vector3();
        const across = new THREE.Vector3();
        const top = new THREE.Vector3();
        const basis = new THREE.Matrix4();
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        spots.forEach((spot) => {
            const range = Math.hypot(spot.x - FOREST_EYE.x, spot.z - FOREST_EYE.z);
            const bucket = range < 19 ? buckets[0] : buckets[1];
            const fronds = range < 19 ? 7 + Math.floor(rng() * 4) : 5 + Math.floor(rng() * 3);
            const turn = rng() * TAU;
            const phase = rng();
            const tone = rng();
            const y = forestGroundHeight(spot.x, spot.z) - 0.04;
            for (let i = 0; i < fronds; i += 1) {
                // Frond space: +Y runs along the frond, +Z is its upper side, +X is across.
                const angle = turn + (i / fronds) * TAU + (rng() - 0.5) * 0.5;
                const lift = THREE.MathUtils.degToRad(48 + rng() * 26);
                forward.set(Math.cos(angle) * Math.cos(lift), Math.sin(lift), Math.sin(angle) * Math.cos(lift));
                across.crossVectors(forward, UP).normalize();
                top.crossVectors(across, forward).normalize();
                basis.makeBasis(across, forward, top);
                rotation.setFromRotationMatrix(basis);
                const size = spot.size * (0.85 + rng() * 0.4);
                position.set(spot.x + Math.cos(angle) * 0.05, y, spot.z + Math.sin(angle) * 0.05);
                matrix.compose(position, rotation, scale.setScalar(size));
                bucket.matrices.push(...matrix.elements);
                bucket.look.push(phase + i * 0.07, tone, size, 0);
            }
            this.stats.ferns += 1;
        });
        buckets.forEach((bucket, index) => {
            const count = bucket.matrices.length / 16;
            if (!count) return;
            const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(bucket.look), 4));
            const mesh = new THREE.InstancedMesh(bucket.geometry, this.createFernMaterial(look), count);
            mesh.name = `ForestFerns ${index === 0 ? 'near' : 'far'}`;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = false;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.fronds += count;
        });
    }

    // -- grass --------------------------------------------------------------------------
    buildGrass() {
        const { light, rng } = this;
        const count = this.tier.grass;
        if (!(count > 0)) return;
        const geometry = this.own(createTuftGeometry());
        const lookData = new Float32Array(count * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, tone, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'ForestGrass';
        const up = uv().y;
        material.positionNode = positionLocal.add(this.sway(up, look.x));
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const albedo = mix(color(0x0a1a09), color(0x3a5a22), look.y.mul(0.6).add(up.mul(0.4)))
            .mul(up.mul(0.75).add(0.25));
        const moon = light.moonlight();
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 6);
        const glow = light.glow(world);
        const cool = light.night(albedo);
        const lit = cool.mul(light.moonColour()).mul(through.mul(1.3).mul(up).add(0.36)).mul(moon)
            .add(cool.mul(light.ambient(vec3(0, 1, 0))).mul(up.mul(0.6).add(0.4)).mul(1.2))
            .add(albedo.mul(1.7).add(0.006).mul(glow));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'ForestGrass';
        const dummy = new THREE.Object3D();
        let made = 0;
        for (let attempt = 0; made < count && attempt < count * 6; attempt += 1) {
            const range = 2.8 + rng() ** 1.7 * 40;
            const bearing = (rng() * 2 - 1) * 0.9 - 0.04;
            const x = FOREST_EYE.x + Math.sin(bearing) * range;
            const z = FOREST_EYE.z - Math.cos(bearing) * range;
            if (this.clear(x, z, 0.1) && forestGroundHeight(x, z) > -3) {
                dummy.position.set(x, forestGroundHeight(x, z) - 0.02, z);
                dummy.rotation.set(0, rng() * TAU, 0);
                const size = 0.55 + rng() * 0.85;
                dummy.scale.set(size, size * (0.8 + rng() * 0.6), size);
                dummy.updateMatrix();
                mesh.setMatrixAt(made, dummy.matrix);
                lookData.set([rng(), rng(), 0, 0], made * 4);
                made += 1;
            }
        }
        mesh.count = made;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.grass = made;
    }

    // -- foxfire ------------------------------------------------------------------------
    /** Clusters of caps: along the fallen spruce, on the stump, among the roots of the old trees. */
    layoutFungi() {
        const { rng } = this;
        const caps = [];
        const cluster = (x, y, z, count, spread, wakeAt) => {
            for (let i = 0; i < count; i += 1) {
                const angle = rng() * TAU;
                const reach = rng() ** 0.7 * spread;
                const cx = x + Math.cos(angle) * reach;
                const cz = z + Math.sin(angle) * reach;
                caps.push({
                    x: cx,
                    y: y === null ? forestGroundHeight(cx, cz) - 0.01 : y,
                    z: cz,
                    size: 0.9 + rng() ** 2 * 2.1,
                    wakeAt: THREE.MathUtils.clamp(wakeAt + (rng() - 0.5) * 0.16, 0.02, 0.9),
                });
            }
        };
        // The fallen spruce: caps along its upper side from end to end.
        const along = { x: Math.cos(FOREST_LOG.yaw), z: -Math.sin(FOREST_LOG.yaw) };
        const logTop = forestGroundHeight(FOREST_LOG.x, FOREST_LOG.z) + 0.56;
        for (let i = 0; i < 9; i += 1) {
            const t = (i / 8 - 0.5) * 6.6;
            cluster(
                FOREST_LOG.x + along.x * t,
                logTop - Math.abs(t) * 0.03,
                FOREST_LOG.z + along.z * t,
                4,
                0.22,
                0.08 + i * 0.05,
            );
        }
        cluster(FOREST_STUMP.x, forestGroundHeight(FOREST_STUMP.x, FOREST_STUMP.z) + 0.6, FOREST_STUMP.z, 7, 0.3, 0.2);
        // Roots of the near trees: the nearer the tree, the sooner it lights.
        const hosts = this.trunks
            .map((trunk) => ({ ...trunk, range: Math.hypot(trunk.x - FOREST_EYE.x, trunk.z - FOREST_EYE.z) }))
            .filter((trunk) => trunk.range < 40 && trunk.radius > 0.2)
            .sort((a, b) => a.range - b.range);
        hosts.forEach((trunk, index) => {
            const angle = rng() * TAU;
            cluster(
                trunk.x + Math.cos(angle) * (trunk.radius + 0.25),
                null,
                trunk.z + Math.sin(angle) * (trunk.radius + 0.25),
                5,
                0.45,
                Math.min(0.85, 0.12 + index * 0.06),
            );
        });
        // And fairy rings out in the moss.
        for (let ring = 0; ring < 5; ring += 1) {
            const spot = forestRidePoint(10 + ring * 7 + rng() * 4, (rng() * 2 - 1) * 6);
            const radius = 0.7 + rng() * 0.6;
            for (let i = 0; i < 9; i += 1) {
                const angle = (i / 9) * TAU + rng() * 0.2;
                const cx = spot.x + Math.cos(angle) * radius;
                const cz = spot.z + Math.sin(angle) * radius;
                cluster(cx, null, cz, 1, 0.05, 0.3 + ring * 0.11);
            }
        }
        return caps.slice(0, this.tier.fungi);
    }

    buildFungi() {
        const { light, rng } = this;
        const caps = this.layoutFungi();
        if (!caps.length) return;
        const geometry = this.own(createCapGeometry());
        const lookData = new Float32Array(caps.length * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // wake at, phase, hue, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'ForestFoxfire';
        const world = positionWorld;
        const normal = normalize(normalWorld);
        const crown = smoothstep(0.35, 0.6, uv().y);
        const flesh = mix(color(0x4a4a3c), color(0x8a917a), crown);
        const moon = light.moonlight();
        const glow = light.glow(world);
        // A faint cold light at rest; lit one by one as the forest wakes; flaring as a wave passes.
        const breath = sin(light.uTime.mul(look.y.mul(0.9).add(0.5)).add(look.y.mul(TAU))).mul(0.5).add(0.5);
        const awake = smoothstep(look.x, look.x.add(0.14), light.uWake);
        const power = breath.mul(0.05).add(0.035)
            .add(awake.mul(breath.mul(0.3).add(0.75)))
            .add(light.stir(world).mul(0.9));
        const foxfire = mix(vec3(0.1, 1.0, 0.55), vec3(0.3, 1.0, 0.2), look.z).mul(power)
            .mul(crown.mul(0.55).add(0.45)).mul(2.2);
        const lit = flesh.mul(light.moonColour()).mul(saturate(dot(normal, light.uMoonDir)).mul(1.2).add(0.1)).mul(moon)
            .add(flesh.mul(light.ambient(normal)).mul(1.1))
            .add(flesh.mul(1.2).mul(glow))
            .add(foxfire);
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, caps.length);
        mesh.name = 'ForestFoxfire';
        const dummy = new THREE.Object3D();
        caps.forEach((cap, index) => {
            dummy.position.set(cap.x, cap.y, cap.z);
            dummy.rotation.set((rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5);
            dummy.scale.set(cap.size, cap.size * (0.8 + rng() * 0.5), cap.size);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData.set([cap.wakeAt, rng(), rng(), 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.fungi = caps.length;
        // The fungi shed their light on the moss: remember where, for the light field's rest state.
        this.caps = caps;
    }

    // -- wood stars ---------------------------------------------------------------------
    buildFlowers() {
        const { light, rng } = this;
        const count = this.tier.flowers;
        if (!(count > 0)) return;
        const geometry = this.own(createFlowerGeometry());
        const lookData = new Float32Array(count * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, -, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'ForestWoodStars';
        material.positionNode = positionLocal.add(this.sway(float(0.5), look.x).mul(0.5));
        const world = positionWorld;
        const petal = length(positionGeometry.xz);
        const albedo = mix(vec3(0.75, 0.72, 0.4), vec3(0.78, 0.8, 0.84), smoothstep(0.1, 0.45, petal));
        const moon = light.moonlight();
        const glow = light.glow(world);
        // White petals hold the moonlight, and woken they give a little of it back.
        const lit = albedo.mul(light.moonColour()).mul(0.5).mul(moon)
            .add(albedo.mul(light.ambient(vec3(0, 1, 0))).mul(1.5))
            .add(albedo.mul(1.1).mul(glow))
            .add(vec3(0.5, 0.7, 0.9).mul(light.uWake).mul(0.12));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'ForestWoodStars';
        const dummy = new THREE.Object3D();
        let made = 0;
        // They grow in drifts.
        while (made < count) {
            const range = 4 + rng() ** 1.6 * 34;
            const bearing = (rng() * 2 - 1) * 0.84 - 0.05;
            const cx = FOREST_EYE.x + Math.sin(bearing) * range;
            const cz = FOREST_EYE.z - Math.cos(bearing) * range;
            const drift = 4 + Math.floor(rng() * 12);
            for (let i = 0; i < drift && made < count; i += 1) {
                const x = cx + (rng() - 0.5) * 2.2;
                const z = cz + (rng() - 0.5) * 2.2;
                dummy.position.set(x, forestGroundHeight(x, z) + 0.06 + rng() * 0.08, z);
                dummy.rotation.set((rng() - 0.5) * 0.7, rng() * TAU, (rng() - 0.5) * 0.7);
                dummy.scale.setScalar(0.035 + rng() * 0.03);
                dummy.updateMatrix();
                mesh.setMatrixAt(made, dummy.matrix);
                lookData.set([rng(), 0, 0, 0], made * 4);
                made += 1;
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.flowers = made;
    }

    /** Places a little above the floor where fireflies like to keep house. */
    fireflyHomes(count) {
        const { rng } = this;
        const homes = [];
        for (let i = 0; i < count; i += 1) {
            const range = 3.5 + rng() ** 1.25 * 44;
            const bearing = (rng() * 2 - 1) * 0.92 - 0.03;
            const x = FOREST_EYE.x + Math.sin(bearing) * range;
            const z = FOREST_EYE.z - Math.cos(bearing) * range;
            const floor = forestGroundHeight(x, z);
            if (floor > -4) homes.push(x, floor + 0.9 + rng() ** 2.2 * 3.2, z);
        }
        return homes;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.log = null;
    }
}
