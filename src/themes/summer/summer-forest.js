/**
 * Summer — the birches and the spruces.
 *
 * Trees are authored in Blender (see summer-assets.js): bark meshes are instanced per
 * specimen, and every spray of leaves or needles of every tree is one instance in a
 * handful of shared draws. Leaves are real geometry lit as thin blades, so the low sun
 * behind a birch turns its hanging strands to green glass; the crown's baked sky visibility
 * and bent normals give each tree depth without any per-frame lighting cost.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, fract, instancedBufferAttribute, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    SUMMER_FEATURE_TREES, SUMMER_GROVE_CEILING, createSummerVisibilityTest, layoutSummerGrove,
} from './summer-composition.js';
import { summerGroundHeight } from './summer-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Foliage ramps per species, walked by `tone` from deep shade to sunlit June green. */
const FOLIAGE_RAMPS = Object.freeze({
    birch: [0x12300b, 0x2c6414, 0x5c9a22, 0x9cc440],
    spruce: [0x06120a, 0x0f2810, 0x1f4016, 0x3f5c1c],
});
const FOLIAGE_SPECIES = Object.freeze({
    birch_spray: 'birch', birch_strand: 'birch', spruce_frond: 'spruce', spruce_bough: 'spruce',
});
/** How leaves answer the light and the wind, by species. */
const FOLIAGE_LOOK = Object.freeze({
    // Birch leaves hang on thin stalks: they never stop trembling, and they pass a lot of light.
    birch: {
        flutter: [0.07, 0.022], glow: [1.2, 1.5, 0.3], through: 0.8, sun: 0.3, ambient: 0.95,
    },
    spruce: {
        flutter: [0.03, 0.006], glow: [1.5, 1.2, 0.3], through: 0.9, sun: 0.62, ambient: 1.05,
    },
});

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

/**
 * A tree on the camera's side of the near shore can never show in the lake: the line from
 * the mirrored camera to any point of it meets the ground, not the water. The two framing
 * trees are such trees, and they carry more than half of the forest's triangles, so the
 * draws that hold only them are kept out of the mirror pass.
 */
const NEAR_SHORE_Z = -8;
const CROWN_REACH = 6.5;
function standsBehindTheShore(tree) {
    return tree.z - CROWN_REACH * tree.scale > NEAR_SHORE_Z;
}

/** Deterministic 0..1 hash for choosing which sprays a tier keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export class SummerForest {
    constructor({
        light, assets, tier, rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerWoods';
        this.owned = [];
        this.borrowed = [];
        this.placements = [];
        this.stats = {
            trees: 0, sprays: 0, culledSprays: 0, foliageTriangles: 0, barkTriangles: 0,
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        const grove = layoutSummerGrove(this.rng, SUMMER_GROVE_CEILING).slice(0, this.tier.groveTrees);
        this.placements = [...SUMMER_FEATURE_TREES, ...grove]
            .filter((tree) => this.assets.trees[tree.asset])
            .map((tree) => ({ ...tree, y: summerGroundHeight(tree.x, tree.z) - 0.05 }));
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildFoliage();
        return this;
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial(species) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = species === 'birch' ? 'SummerBirchBark' : 'SummerSpruceBark';
        const tree = instancedBufferAttribute(this.treeAttribute);
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, species mask
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        material.positionNode = positionLocal.add(light.wind({
            world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: paint.r, phase: paint.g,
        }));

        const st = uv();
        const grain = light.noise(st.mul(vec2(1, 0.55)));
        const fine = light.noise(st.mul(vec2(3.1, 1.4)).add(grain.rg.mul(0.25)));
        let albedo;
        let relief;
        let depth;
        if (species === 'birch') {
            // Paper-white bark banded with dark lenticels, black where limbs have left their
            // scars; the foot of an old trunk and every twig are dark and rough.
            const paper = mix(color(0xb9b3a4), color(0xf2efe6), grain.r.mul(0.6).add(fine.g.mul(0.4)));
            const dashes = light.noise(st.mul(vec2(0.55, 5.2)).add(vec2(grain.b.mul(0.3), 0)));
            const lenticel = smoothstep(0.6, 0.7, dashes.g.mul(0.62).add(dashes.a.mul(0.38)));
            const scar = smoothstep(0.7, 0.8, light.noise(st.mul(vec2(0.9, 0.62)).add(fine.rg.mul(0.2))).b
                .mul(0.8).add(grain.a.mul(0.2)));
            const white = mix(paper, color(0x211c18), saturate(lenticel.mul(0.7).add(scar)));
            const rough = mix(color(0x100c0a), color(0x4a3d33), fine.r);
            albedo = mix(white, rough, smoothstep(0.3, 0.8, paint.a.add(fine.b.sub(0.5).mul(0.3))));
            relief = lenticel.mul(0.25).add(scar.mul(0.4)).add(paint.a.mul(fine.r).mul(0.9));
            depth = 0.03;
        } else {
            // Spruce: thin grey-brown scales, with pale lichen where the mask says so.
            const scale = smoothstep(0.36, 0.7, light.noise(st.mul(vec2(3.6, 1.6)).add(grain.rg.mul(0.3))).g
                .mul(0.6).add(fine.b.mul(0.4)));
            const scaled = mix(color(0x1a120d), color(0x66503f), scale).mul(grain.r.mul(0.5).add(0.72));
            const lichen = mix(color(0x55603c), color(0x98a07c), fine.a);
            albedo = mix(scaled, lichen, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))));
            relief = scale.mul(0.7).add(fine.r.mul(0.3));
            depth = 0.05;
        }

        const world = positionWorld;
        // Relief from the bark pattern itself: the low sun rakes across it.
        const smooth = normalize(normalWorld);
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(depth)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir));
        // The sun behind a trunk wraps a thin rim of light around its silhouette.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.55)));
        const occlusion = paint.b.mul(0.85).add(0.15);
        const lit = albedo.mul(light.uSunColor).mul(facing.mul(0.42).add(rim.mul(0.4))).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.05));
        // fragmentNode, not colorNode: the shadow pass multiplies a caster's alpha by its
        // colorNode, which would sample the shadow map while it is being drawn.
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildBark() {
        const byAsset = new Map();
        this.placements.forEach((tree) => {
            if (!byAsset.has(tree.asset)) byAsset.set(tree.asset, []);
            byAsset.get(tree.asset).push(tree);
        });
        const dummy = new THREE.Object3D();
        byAsset.forEach((trees, name) => {
            const asset = this.assets.trees[name];
            const data = new Float32Array(trees.length * 4);
            this.treeAttribute = new THREE.InstancedBufferAttribute(data, 4);
            const mesh = new THREE.InstancedMesh(asset.bark, this.createBarkMaterial(asset.species), trees.length);
            mesh.name = `SummerBark ${name}`;
            mesh.userData.unmirrored = trees.every(standsBehindTheShore);
            trees.forEach((tree, index) => {
                dummy.position.set(tree.x, tree.y, tree.z);
                dummy.rotation.set(0, tree.yaw, 0);
                dummy.scale.setScalar(tree.scale);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                data.set([tree.x, tree.y, tree.z, asset.height * tree.scale], index * 4);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            let drawn = asset.bark.index.count;
            if (!this.tier.limbs && asset.barkCoreIndices > 0 && asset.barkCoreIndices < drawn) {
                drawn = asset.barkCoreIndices;
            }
            // The geometry belongs to the asset bundle, so the range is set for every
            // tier and handed back in dispose().
            asset.bark.setDrawRange(0, drawn === asset.bark.index.count ? Infinity : drawn);
            this.borrowed.push(asset.bark);
            this.stats.barkTriangles += (drawn / 3) * trees.length;
        });
        this.treeAttribute = null;
    }

    // -- leaves and needles -------------------------------------------------------------
    createFoliageMaterial(kind, buffers) {
        const { light } = this;
        const species = FOLIAGE_SPECIES[kind] || 'birch';
        const look = FOLIAGE_LOOK[species];
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `SummerFoliage ${kind}`;
        const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
        const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
        const tree = instancedBufferAttribute(buffers.tree); // base xyz, height
        const paint = attribute('color', 'vec4'); // tip weight, leaf id, shade, leaf (1) or wood (0)
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        const t = light.uTime;
        const force = light.uWind.add(light.uGust);
        const flutter = sin(t.mul(paint.g.mul(3).add(5)).add(paint.g.mul(41)).add(crown.z.mul(13)))
            .mul(paint.r).mul(paint.a).mul(force.mul(look.flutter[0]).add(look.flutter[1]));
        material.positionNode = positionLocal
            .add(light.wind({
                world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: crown.y, phase: crown.z,
            }))
            .add(vec3(light.uWindDir.x.mul(0.5), 0.7, light.uWindDir.z.mul(0.5)).mul(flutter));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const blade = normalize(normalWorld);
        const normal = normalize(mix(blade, bent.xyz, 0.65));
        // Colour: each tree sits somewhere on its species' ramp; leaf by leaf it varies, and
        // the open side of the crown is lighter.
        const tone = saturate(bent.w.mul(0.6).add(crown.w.sub(0.5).mul(0.26)).add(paint.g.sub(0.5).mul(0.22))
            .add(crown.x.mul(0.22)));
        const leaf = ramp(FOLIAGE_RAMPS[species], tone);
        const albedo = mix(color(0x1a120d), leaf, paint.a).mul(paint.b);
        // Sun through a leaf is a clear yellow-green, whatever the green in front of it.
        const glowing = pow(leaf, vec3(0.62)).mul(vec3(...look.glow));

        const sun = light.sunlight();
        const facing = dot(blade, light.uSunDir);
        const wrap = saturate(dot(normal, light.uSunDir).mul(0.6).add(0.4));
        const front = albedo.mul(wrap).mul(saturate(facing.abs().mul(2.2).add(0.45)));
        // Leaves are too thin to block the sun: looking up the beam, every spray lights up.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const back = glowing.mul(paint.a).mul(paint.r.mul(0.6).add(0.4))
            .mul(through.mul(look.through).add(saturate(facing.negate()).mul(0.3)))
            .mul(crown.x.mul(0.6).add(0.4));
        const occlusion = crown.x.mul(0.8).add(0.2);
        const lit = front.add(back).mul(light.uSunColor).mul(sun).mul(look.sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(look.ambient))
            // Light that has already passed through the crown warms the leaves it shades.
            .add(glowing.mul(paint.a).mul(light.uSunColor).mul(crown.x.mul(0.02).add(0.006))
                .mul(light.uWarmth.mul(1.4).add(1)));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildFoliage() {
        const visible = createSummerVisibilityTest();
        const buckets = new Map();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const yaw = new THREE.Quaternion();
        const bentNormal = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const { variants } = this.assets.foliage;
        this.placements.forEach((tree, treeIndex) => {
            const asset = this.assets.trees[tree.asset];
            const { sites } = asset;
            const keep = Math.min(1, this.tier.foliage * (tree.far ? 0.62 : 1));
            const grow = (1 / keep) ** 0.36;
            yaw.setFromAxisAngle(UP, tree.yaw);
            for (let i = 0; i < sites.count; i += 1) {
                if (keepHash(i, treeIndex + 1) <= keep) {
                    position.fromArray(sites.position, i * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
                    position.x += tree.x;
                    position.y += tree.y;
                    position.z += tree.z;
                    const size = sites.scale[i] * tree.scale * grow;
                    if (visible(position.x, position.y, position.z, size * 1.2)) {
                        const key = `${asset.foliage}_${sites.variant[i] % variants}`;
                        if (!buckets.has(key)) {
                            buckets.set(key, {
                                kind: asset.foliage, matrices: [], crown: [], bent: [], tree: [], unmirrored: true,
                            });
                        }
                        buckets.get(key).unmirrored &&= standsBehindTheShore(tree);
                        const bucket = buckets.get(key);
                        rotation.fromArray(sites.rotation, i * 4).premultiply(yaw);
                        matrix.compose(position, rotation, scale.setScalar(size));
                        bucket.matrices.push(...matrix.elements);
                        bucket.crown.push(sites.sky[i], sites.sway[i], sites.phase[i], sites.hue[i]);
                        bentNormal.fromArray(sites.bent, i * 3).applyQuaternion(yaw);
                        bucket.bent.push(bentNormal.x, bentNormal.y, bentNormal.z, tree.tone);
                        bucket.tree.push(tree.x, tree.y, tree.z, asset.height * tree.scale);
                    } else this.stats.culledSprays += 1;
                }
            }
        });
        buckets.forEach((bucket, key) => {
            const geometry = this.assets.foliage.meshes[key];
            if (!geometry) throw new Error(`[Summer] Foliage mesh "${key}" is missing from the asset pack.`);
            const count = bucket.matrices.length / 16;
            const buffers = {
                crown: new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4),
                bent: new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4),
                tree: new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4),
            };
            // Variants of one spray kind differ only in geometry and instance data, but the
            // instance buffers are baked into the node graph, so each draw owns a material.
            const material = this.createFoliageMaterial(bucket.kind, buffers);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `SummerFoliage ${key}`;
            mesh.userData.unmirrored = bucket.unmirrored;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.sprays += count;
            this.stats.foliageTriangles += (geometry.index.count / 3) * count;
        });
    }

    /** Points among the crowns near the camera, where swallows and seed down pass. */
    sampleCrownPoints(count, rng = this.rng) {
        const points = new Float32Array(count * 3);
        const yaw = new THREE.Quaternion();
        const position = new THREE.Vector3();
        const near = this.placements.filter((tree) => !tree.far);
        if (!near.length) return new Float32Array(0);
        for (let i = 0; i < count; i += 1) {
            const tree = near[Math.floor(rng() * near.length) % near.length];
            const asset = this.assets.trees[tree.asset];
            const site = Math.floor(rng() * asset.sites.count) % asset.sites.count;
            yaw.setFromAxisAngle(UP, tree.yaw);
            position.fromArray(asset.sites.position, site * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
            points.set([position.x + tree.x, position.y + tree.y, position.z + tree.z], i * 3);
        }
        return points;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.borrowed.forEach((geometry) => geometry.setDrawRange(0, Infinity));
        this.borrowed.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
