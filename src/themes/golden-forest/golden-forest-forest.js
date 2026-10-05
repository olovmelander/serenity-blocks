/**
 * Golden Forest — the conifers.
 *
 * Trees are authored in Blender (see golden-forest-assets.js): bark meshes are instanced
 * per specimen, and every needle spray of every tree is one instance in a handful of
 * shared draws. Needles are real serrated geometry lit as thin blades, so the low sun
 * behind the crowns gilds their fringes; the crown's baked sky visibility and bent normals
 * give each tree depth without any per-frame lighting cost.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, fract, instancedBufferAttribute, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    GOLDEN_FOREST_FEATURE_TREES, GOLDEN_FOREST_GROVE_CEILING, createGoldenForestVisibilityTest,
    layoutGoldenForestGrove,
} from './golden-forest-composition.js';
import { goldenForestGroundHeight } from './golden-forest-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Needle ramps per species, walked by `tone` from deep shade green to sunlit olive-gold. */
const NEEDLE_RAMPS = Object.freeze({
    spruce: [0x07130a, 0x112a10, 0x254414, 0x566418],
    pine: [0x0b1c0d, 0x1b3a15, 0x38561a, 0x748024],
});
const FOLIAGE_SPECIES = Object.freeze({
    spruce_frond: 'spruce', spruce_bough: 'spruce', pine_tuft: 'pine', pine_clump: 'pine',
});

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

/** Deterministic 0..1 hash for choosing which sprays a tier keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export class GoldenForestForest {
    constructor({
        light, assets, tier, rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestConifers';
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
        const grove = layoutGoldenForestGrove(this.rng, GOLDEN_FOREST_GROVE_CEILING).slice(0, this.tier.groveTrees);
        this.placements = [...GOLDEN_FOREST_FEATURE_TREES, ...grove]
            .filter((tree) => this.assets.trees[tree.asset])
            .map((tree) => ({ ...tree, y: goldenForestGroundHeight(tree.x, tree.z) - 0.05 }));
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildFoliage();
        return this;
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial(species) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = species === 'pine' ? 'GoldenForestPineBark' : 'GoldenForestSpruceBark';
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
        if (species === 'pine') {
            // Deep grey plates low on the trunk; above them thin bark that peels in
            // papery orange flakes and burns in a low sun.
            const plate = smoothstep(0.34, 0.66, light.noise(st.mul(vec2(2.4, 0.7)).add(grain.rg.mul(0.4))).g);
            const plated = mix(color(0x140d09), color(0x5e483a), plate).mul(grain.r.mul(0.5).add(0.75));
            const flake = smoothstep(0.3, 0.75, light.noise(st.mul(vec2(4.6, 2.2))).b.mul(0.6).add(fine.r.mul(0.4)));
            const peeling = mix(color(0x8a3a16), color(0xe08a46), flake);
            albedo = mix(plated, peeling, smoothstep(0.25, 0.8, paint.a));
            relief = mix(plate.mul(0.9), flake.mul(0.3), paint.a).add(fine.r.mul(0.3));
        } else {
            // Spruce: thin grey-brown scales, with pale lichen where the mask says so.
            const scale = smoothstep(0.36, 0.7, light.noise(st.mul(vec2(3.6, 1.6)).add(grain.rg.mul(0.3))).g
                .mul(0.6).add(fine.b.mul(0.4)));
            const scaled = mix(color(0x120c09), color(0x4e3c30), scale).mul(grain.r.mul(0.5).add(0.72));
            const lichen = mix(color(0x4a5236), color(0x8a9070), fine.a);
            albedo = mix(scaled, lichen, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))));
            relief = scale.mul(0.7).add(fine.r.mul(0.3));
        }

        const world = positionWorld;
        // Relief from the bark pattern itself: the low sun rakes across the plates.
        const smooth = normalize(normalWorld);
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(0.05)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir));
        // The sun behind a trunk wraps a thin rim of gold around its silhouette.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.55)));
        const occlusion = paint.b.mul(0.85).add(0.15);
        const lit = albedo.mul(light.uSunColor).mul(facing.mul(1.4).add(rim.mul(1.1))).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.15));
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
            mesh.name = `GoldenForestBark ${name}`;
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

    // -- needles ------------------------------------------------------------------------
    createFoliageMaterial(kind, buffers) {
        const { light } = this;
        const species = FOLIAGE_SPECIES[kind];
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `GoldenForestNeedles ${kind}`;
        const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
        const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
        const tree = instancedBufferAttribute(buffers.tree); // base xyz, height
        const paint = attribute('color', 'vec4'); // needle tip weight, shoot id, shade, needle (1) or wood (0)
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        const t = light.uTime;
        const force = light.uWind.add(light.uGust);
        const shiver = sin(t.mul(paint.g.mul(3).add(4)).add(paint.g.mul(41)).add(crown.z.mul(13)))
            .mul(paint.r).mul(paint.a).mul(force.mul(0.03).add(0.006));
        material.positionNode = positionLocal
            .add(light.wind({
                world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: crown.y, phase: crown.z,
            }))
            .add(vec3(light.uWindDir.x.mul(0.4), 1, light.uWindDir.z.mul(0.4)).mul(shiver));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const blade = normalize(normalWorld);
        const normal = normalize(mix(blade, bent.xyz, 0.65));
        // Colour: each tree sits somewhere on its species' ramp; this year's growth at the
        // tips and the open side of the crown are lighter.
        const tone = saturate(bent.w.mul(0.62).add(crown.w.sub(0.5).mul(0.24)).add(paint.r.mul(0.22))
            .add(crown.x.mul(0.2)));
        const needle = ramp(NEEDLE_RAMPS[species], tone);
        const albedo = mix(color(0x1a100b), needle, paint.a).mul(paint.b);
        // Sun through needles is a clear yellow-gold, whatever the green in front of it.
        const glowing = pow(needle, vec3(0.62)).mul(vec3(1.75, 1.05, 0.28));

        const sun = light.sunlight();
        const facing = dot(blade, light.uSunDir);
        const wrap = saturate(dot(normal, light.uSunDir).mul(0.6).add(0.4));
        const front = albedo.mul(wrap).mul(saturate(facing.abs().mul(2.2).add(0.45)));
        // Needles are too fine to block the sun: looking up the beam, the fringe of every
        // spray burns, and the tips most of all.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const back = glowing.mul(paint.a).mul(paint.r.mul(0.8).add(0.2))
            .mul(through.mul(1.25).add(saturate(facing.negate()).mul(0.24)))
            .mul(crown.x.mul(0.6).add(0.4));
        const occlusion = crown.x.mul(0.8).add(0.2);
        const lit = front.add(back).mul(light.uSunColor).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.05))
            // Light that has already passed through the crown warms the needles it shades.
            .add(glowing.mul(paint.a).mul(light.uSunColor).mul(crown.x.mul(0.03).add(0.008))
                .mul(light.uWarmth.mul(1.4).add(1)));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildFoliage() {
        const visible = createGoldenForestVisibilityTest();
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
                                kind: asset.foliage, matrices: [], crown: [], bent: [], tree: [],
                            });
                        }
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
            if (!geometry) throw new Error(`[GoldenForest] Foliage mesh "${key}" is missing from the asset pack.`);
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
            mesh.name = `GoldenForestNeedles ${key}`;
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

    /** Points among the lower boughs near the water where fireflies like to hang. */
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
