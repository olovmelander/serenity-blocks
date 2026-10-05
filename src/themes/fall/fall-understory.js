/**
 * Fall — the forest floor's small things.
 *
 * Thousands of real leaves lie on the carpet (the same Blender leaf meshes that grow on
 * the trees), with dry grass, copper ferns, mossy stones and a few glowing mushrooms at
 * the roots of the old trees. Everything is instanced and lit by the shared light rig.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, normalWorld,
    positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, vec3,
} from 'three/tsl';
import { FALL_FEATURE_TREES } from './fall-composition.js';
import { fallPathDistance, fallTerrainHeight } from './fall-terrain.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const MAPLE = [0x5c0a08, 0xa8200a, 0xd0560c, 0xdc9416];
const OAK = [0x4a1c0a, 0x7c3a0c, 0xa8620f, 0xc08a1c];
const BIRCH = [0xb8780c, 0xd8a012, 0xe8c226, 0xdcd04a];

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

function triangle(arrays, a, b, c) {
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    [a, b, c].forEach((point) => {
        arrays.position.push(point.x, point.y, point.z);
        arrays.normal.push(normal.x, normal.y, normal.z);
    });
}

function toGeometry(arrays) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

/** A tuft of dry blades, each a tapering two-segment ribbon. */
function grassGeometry(rng) {
    const arrays = { position: [], normal: [] };
    for (let blade = 0; blade < 9; blade += 1) {
        const angle = (blade / 9) * TAU + rng() * 0.5;
        const height = 0.3 + rng() * 0.55;
        const width = 0.011 + rng() * 0.012;
        const lean = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const across = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        const root = lean.clone().multiplyScalar(0.05 * rng());
        const middle = root.clone().addScaledVector(lean, height * 0.16).setY(height * 0.55);
        const tip = root.clone().addScaledVector(lean, height * 0.46).setY(height);
        const a = root.clone().addScaledVector(across, width);
        const b = root.clone().addScaledVector(across, -width);
        const c = middle.clone().addScaledVector(across, width * 0.6);
        const d = middle.clone().addScaledVector(across, -width * 0.6);
        triangle(arrays, a, b, c);
        triangle(arrays, b, d, c);
        triangle(arrays, c, d, tip);
    }
    return toGeometry(arrays);
}

/** Arching fern fronds with paired pinnae. */
function fernGeometry() {
    const arrays = { position: [], normal: [] };
    for (let frond = 0; frond < 7; frond += 1) {
        const yaw = (frond / 7) * TAU + (frond % 2) * 0.3;
        const turn = (point) => point.applyAxisAngle(UP, yaw);
        for (let i = 1; i < 9; i += 1) {
            const t = i / 9;
            const spine = new THREE.Vector3(t * 0.95, Math.sin(t * Math.PI * 0.8) * 0.62, 0);
            const reach = Math.sin(t * Math.PI) * 0.26 + 0.03;
            [-1, 1].forEach((side) => {
                triangle(
                    arrays,
                    turn(spine.clone().add(new THREE.Vector3(-0.035, -0.02, 0))),
                    turn(spine.clone().add(new THREE.Vector3(0.11, 0.0, side * reach))),
                    turn(spine.clone().add(new THREE.Vector3(0.05, 0.03, side * reach * 0.5))),
                );
            });
        }
    }
    return toGeometry(arrays);
}

function rockGeometry() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const lump = 1 + Math.sin(x * 4.1 + y * 2.7) * 0.12 + Math.sin(z * 5.3 - x * 3.1) * 0.09
            + Math.sin(y * 7.9 + z * 3.3) * 0.05;
        positions.setXYZ(i, x * lump, y * lump * 0.62, z * lump);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function mushroomGeometry() {
    const profile = [[0.0, 0.0], [0.05, 0.0], [0.04, 0.22], [0.06, 0.25], [0.22, 0.23], [0.2, 0.3], [0.12, 0.37],
        [0.0, 0.4]].map(([radius, height]) => new THREE.Vector2(radius, height));
    const geometry = new THREE.LatheGeometry(profile, 10);
    geometry.computeVertexNormals();
    return geometry;
}

export class FallUnderstory {
    constructor({
        light, foliage, tier, rng = Math.random,
    }) {
        this.light = light;
        this.foliage = foliage;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallUnderstory';
        this.owned = [];
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildLitter();
        this.buildPlants();
        this.buildStones();
        this.buildMushrooms();
        return this;
    }

    /** Ground shading shared by everything that lies or grows on the floor. */
    shade(albedo, normal, { translucent = 0 } = {}) {
        const { light } = this;
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir)).mul(2.4).add(0.06);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3).mul(translucent);
        const lit = albedo.mul(light.uSunColor).mul(facing.add(through)).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(1.15));
        return light.haze(lit, { world });
    }

    scatter(count, {
        near = 14, far = -70, spread = 34, pathClear = 0, bias = 1.8,
    }, place) {
        const { rng } = this;
        let placed = 0;
        for (let attempt = 0; placed < count && attempt < count * 6; attempt += 1) {
            const z = near - (rng() ** bias) * (near - far);
            const x = (rng() * 2 - 1) * (spread + Math.max(0, -z) * 0.5);
            if (fallPathDistance(x, z) >= pathClear) {
                place(placed, x, fallTerrainHeight(x, z), z);
                placed += 1;
            }
        }
        return placed;
    }

    buildLitter() {
        const { light, rng } = this;
        const kinds = [
            {
                mesh: 'leaf_maple', share: 0.3, range: [15, 1], size: [0.2, 0.36],
            },
            {
                mesh: 'leaf_maple_far', share: 0.42, range: [3, -62], size: [0.24, 0.44],
            },
            {
                mesh: 'leaf_oak', share: 0.14, range: [14, -40], size: [0.18, 0.3],
            },
            {
                mesh: 'leaf_birch', share: 0.14, range: [14, -40], size: [0.12, 0.2],
            },
        ];
        const dummy = new THREE.Object3D();
        kinds.forEach((kind) => {
            const geometry = this.foliage.meshes[kind.mesh];
            const count = Math.max(1, Math.round(this.tier.litter * kind.share));
            if (geometry) {
                const data = new Float32Array(count * 4); // tone, species, phase, lift
                const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
                const paint = attribute('color', 'vec4');
                const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
                material.name = `FallLitter ${kind.mesh}`;
                const stir = light.uWind.add(light.uGust.mul(1.4));
                const lift = sin(light.uTime.mul(look.z.mul(2).add(2.4)).add(look.z.mul(41)))
                    .mul(paint.r).mul(look.w).mul(stir.mul(0.06).add(0.004));
                material.positionNode = positionLocal.add(vec3(0, lift, 0));
                const tone = saturate(look.x.add(paint.r.sub(0.5).mul(0.12)));
                const leaf = mix(
                    mix(ramp(MAPLE, tone), ramp(OAK, tone), saturate(look.y)),
                    ramp(BIRCH, tone),
                    saturate(look.y.sub(1)),
                );
                // Fallen leaves dull and darken; a few stay bright where they landed last.
                const albedo = leaf.mul(look.w.mul(0.5).add(0.5)).mul(paint.b);
                material.colorNode = this.shade(albedo, normalize(normalWorld.add(vec3(0, 0.6, 0))), { translucent: 0.2 });
                const mesh = new THREE.InstancedMesh(geometry, material, count);
                mesh.name = `FallLitter ${kind.mesh}`;
                const species = {
                    leaf_maple: 0, leaf_maple_far: 0, leaf_oak: 1, leaf_birch: 2,
                }[kind.mesh];
                mesh.count = this.scatter(count, { near: kind.range[0], far: kind.range[1], spread: 30 }, (index, x, y, z) => {
                    dummy.position.set(x, y + 0.03 + rng() * 0.035, z);
                    dummy.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.5, 0, rng() * TAU, 'YXZ');
                    dummy.rotation.y = rng() * TAU;
                    dummy.scale.setScalar(kind.size[0] + rng() * (kind.size[1] - kind.size[0]));
                    dummy.updateMatrix();
                    mesh.setMatrixAt(index, dummy.matrix);
                    data.set([rng(), species, rng(), 0.35 + rng() * 0.65], index * 4);
                });
                mesh.instanceMatrix.needsUpdate = true;
                mesh.frustumCulled = false;
                mesh.matrixAutoUpdate = false;
                this.group.add(mesh);
            }
        });
    }

    buildPlants() {
        const { light, rng } = this;
        const dummy = new THREE.Object3D();
        const fractHash = (position) => sin(position.x.mul(1.71).add(position.z.mul(2.37))).mul(0.5).add(0.5);
        const plantMaterial = (name, base, tip) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
            material.name = name;
            const height = saturate(positionGeometry.y.div(0.9));
            const phase = fractHash(positionLocal);
            const force = light.uWind.add(light.uGust.mul(1.3));
            const sway = sin(light.uTime.mul(1.3).add(phase.mul(TAU))).mul(height.mul(height)).mul(force).mul(0.16);
            material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));
            const albedo = mix(color(base), color(tip), height);
            material.colorNode = this.shade(albedo, vec3(0, 1, 0), { translucent: 1.1 });
            return material;
        };
        const add = (name, geometry, material, count, options, scale) => {
            const mesh = new THREE.InstancedMesh(this.own(geometry), material, Math.max(1, count));
            mesh.name = name;
            mesh.count = this.scatter(count, options, (index, x, y, z) => {
                dummy.position.set(x, y - 0.02, z);
                dummy.rotation.set(0, rng() * TAU, 0);
                dummy.scale.setScalar(scale[0] + rng() * (scale[1] - scale[0]));
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
        };
        add('FallDryGrass', grassGeometry(rng), plantMaterial('FallDryGrass', 0x4a3414, 0xc89a3a), this.tier.grass, {
            near: 15, far: -64, spread: 30, pathClear: 2.6,
        }, [0.55, 1.2]);
        add('FallCopperFerns', fernGeometry(), plantMaterial('FallCopperFerns', 0x3c2a10, 0xb4701c), this.tier.ferns, {
            near: 13, far: -44, spread: 26, pathClear: 3.4, bias: 1.3,
        }, [0.55, 1.05]);
    }

    buildStones() {
        const { light, rng } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'FallMossyStones';
        const world = positionWorld;
        const normal = normalize(normalWorld);
        const grain = light.noise(world.xz.mul(0.9).add(world.y));
        const stone = mix(color(0x2c2a2c), color(0x6a6660), grain.r);
        const moss = mix(color(0x1c2a0a), color(0x4a5a16), grain.g);
        const cover = smoothstep(0.25, 0.75, normal.y.add(grain.b.mul(0.5)).sub(0.2));
        material.colorNode = this.shade(mix(stone, moss, cover), normal);
        const mesh = new THREE.InstancedMesh(this.own(rockGeometry()), material, Math.max(1, this.tier.rocks));
        mesh.name = 'FallMossyStones';
        const dummy = new THREE.Object3D();
        mesh.count = this.scatter(this.tier.rocks, {
            near: 12, far: -56, spread: 28, pathClear: 3, bias: 1.2,
        }, (index, x, y, z) => {
            const size = 0.22 + rng() ** 2 * 0.9;
            dummy.position.set(x, y - size * 0.22, z);
            dummy.rotation.set(rng() * 0.3, rng() * TAU, rng() * 0.3);
            dummy.scale.set(size * (0.9 + rng() * 0.5), size, size * (0.9 + rng() * 0.5));
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    /** Small lantern caps at the feet of the old trees; they answer combos with light. */
    buildMushrooms() {
        const { light, rng } = this;
        const count = Math.max(4, Math.round(this.tier.wisps * 0.8));
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'FallLanternCaps';
        const data = new Float32Array(count);
        const phase = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 1));
        const cap = smoothstep(0.2, 0.3, positionGeometry.y);
        const pulse = sin(light.uTime.mul(0.9).add(phase.mul(TAU))).mul(0.18).add(0.82);
        const glow = color(0x3fc8b0).mul(cap).mul(pulse).mul(light.uGlow.mul(2.8).add(0.42));
        const stem = mix(color(0x5a4a3a), color(0xd8cbb0), cap);
        material.colorNode = this.shade(stem, normalize(normalWorld)).add(glow.mul(float(1.5)));
        const mesh = new THREE.InstancedMesh(this.own(mushroomGeometry()), material, count);
        mesh.name = 'FallLanternCaps';
        const dummy = new THREE.Object3D();
        const hosts = FALL_FEATURE_TREES.slice(0, 2);
        for (let i = 0; i < count; i += 1) {
            const host = hosts[i % hosts.length];
            const angle = rng() * TAU;
            const radius = 1.5 + rng() * 2.6;
            const x = host.x + Math.cos(angle) * radius;
            const z = host.z + Math.sin(angle) * radius * 0.8 + 1.2;
            dummy.position.set(x, fallTerrainHeight(x, z) + 0.02, z);
            dummy.rotation.set((rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3);
            dummy.scale.setScalar(0.24 + rng() * 0.34);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            data[i] = rng();
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
