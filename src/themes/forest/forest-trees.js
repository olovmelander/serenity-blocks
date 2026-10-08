/**
 * Forest — the old trees.
 *
 * Trees are authored in Blender (see forest-assets.js): bark meshes are instanced per
 * specimen, and every spray of every tree is one instance in a handful of shared draws.
 * The moon stands behind them, so they are drawn the way a night photograph sees them:
 * dark masses with a rim of silver, needles and birch leaves that let a cold light through
 * at their fringes, moss on the feet of the trunks, and all of it answering the forest's
 * own light when a wave of it passes.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, fract, instancedBufferAttribute, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    FOREST_FEATURE_TREES, FOREST_GROVE_CEILING, createForestVisibilityTest, layoutForestGrove,
} from './forest-composition.js';
import { forestGroundHeight } from './forest-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Foliage ramps per species, walked by `tone` from deep shade to the palest new growth. */
const FOLIAGE_RAMPS = Object.freeze({
    spruce: [0x030b07, 0x0a1d10, 0x16321a, 0x2e4c26],
    pine: [0x05120b, 0x0f2618, 0x1e3d24, 0x3b5a30],
    birch: [0x0a1a0a, 0x1a3512, 0x33551c, 0x5d7a2a],
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

export class ForestTrees {
    constructor({
        light, assets, tier, rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'ForestOldTrees';
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
        const grove = layoutForestGrove(this.rng, FOREST_GROVE_CEILING).slice(0, this.tier.groveTrees);
        this.placements = [...FOREST_FEATURE_TREES, ...grove]
            .filter((tree) => this.assets.trees[tree.asset])
            .map((tree) => ({ ...tree, y: forestGroundHeight(tree.x, tree.z) - 0.05 }));
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildFoliage();
        return this;
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial(species) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = `ForestBark ${species}`;
        const tree = instancedBufferAttribute(this.treeAttribute);
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, species mask
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        material.positionNode = positionLocal.add(light.wind({
            world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: paint.r, phase: paint.g,
        }));

        const st = uv();
        const world = positionWorld;
        const grain = light.noise(st.mul(vec2(1, 0.55)));
        const fine = light.noise(st.mul(vec2(3.1, 1.4)).add(grain.rg.mul(0.25)));
        let albedo;
        let relief;
        if (species === 'pine') {
            // Deep grey plates low on the trunk; above them thin bark that peels in papery flakes.
            const plate = smoothstep(0.34, 0.66, light.noise(st.mul(vec2(2.4, 0.7)).add(grain.rg.mul(0.4))).g);
            const plated = mix(color(0x15100d), color(0x3a302a), plate).mul(grain.r.mul(0.4).add(0.8));
            const flake = smoothstep(0.3, 0.75, light.noise(st.mul(vec2(4.6, 2.2))).b.mul(0.6).add(fine.r.mul(0.4)));
            const peeling = mix(color(0x4a2c1c), color(0x80583a), flake);
            albedo = mix(plated, peeling, smoothstep(0.25, 0.8, paint.a));
            relief = mix(plate.mul(0.9), flake.mul(0.3), paint.a).add(fine.r.mul(0.3));
        } else if (species === 'birch') {
            // White paper bark ruled with dark lenticels; black where a limb was shed, and
            // rough and dark at the foot. Twigs are dark all through.
            const dash = smoothstep(0.62, 0.74, light.noise(st.mul(vec2(1.7, 21))).g.mul(0.7).add(fine.b.mul(0.3)));
            const paper = mix(color(0xb9bfc4), color(0xe8ecee), grain.r).mul(fine.g.mul(0.2).add(0.86));
            const marked = mix(paper, color(0x17140f), dash.mul(0.85));
            const foot = smoothstep(0.2, 2.4, world.y.sub(tree.y)).oneMinus();
            const dark = saturate(paint.a.mul(1.25).add(foot.mul(grain.g.mul(0.9).add(0.35))));
            albedo = mix(marked, color(0x14110d).mul(fine.r.mul(0.6).add(0.7)), dark);
            relief = dash.mul(0.5).add(dark.mul(fine.r).mul(0.6));
        } else {
            // Spruce: thin grey-brown scales, with pale lichen where the mask says so.
            const scale = smoothstep(0.36, 0.7, light.noise(st.mul(vec2(3.6, 1.6)).add(grain.rg.mul(0.3))).g
                .mul(0.6).add(fine.b.mul(0.4)));
            const scaled = mix(color(0x130e0b), color(0x33291f), scale).mul(grain.r.mul(0.4).add(0.78));
            const lichen = mix(color(0x343c2c), color(0x66705c), fine.a);
            albedo = mix(scaled, lichen, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))));
            relief = scale.mul(0.7).add(fine.r.mul(0.3));
        }
        // Moss climbs the foot of every old trunk, highest on its damp side.
        const smooth = normalize(normalWorld);
        const above = world.y.sub(tree.y);
        const damp = smooth.x.mul(0.35).add(smooth.z.mul(-0.5)).add(0.6);
        const mossLine = damp.mul(species === 'birch' ? 0.5 : 1.5).add(grain.b.mul(1.2));
        const moss = smoothstep(mossLine.sub(0.6), mossLine.add(0.5), above).oneMinus()
            .mul(smoothstep(0.3, 0.55, fine.g.mul(0.6).add(grain.a.mul(0.4)))).mul(paint.r.oneMinus());
        albedo = mix(albedo, mix(color(0x0c1c08), color(0x2a4212), fine.r), moss.mul(0.85));

        // Relief from the bark pattern itself: a low moon rakes across the plates.
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(0.03)));
        const view = normalize(cameraPosition.sub(world));
        const moon = light.moonlight();
        const facing = saturate(dot(normal, light.uMoonDir));
        // The moon behind a trunk wraps a thin rim of silver around its silhouette.
        // (The smooth normal: a rim taken from the relief breaks into scratches.)
        const rim = pow(saturate(dot(smooth, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.55)));
        const occlusion = paint.b.mul(0.85).add(0.15);
        const glow = light.glow(world);
        const cool = light.night(albedo);
        const lit = cool.mul(light.moonColour()).mul(facing.mul(1.4).add(rim.mul(1.5))).mul(moon)
            .add(cool.mul(light.ambient(normal)).mul(occlusion).mul(1.5))
            .add(albedo.mul(1.5).add(0.006).mul(glow).mul(occlusion))
            // Woken, the moss on the trunks holds a faint cold light of its own.
            .add(vec3(0.08, 0.7, 0.42).mul(moss).mul(light.uWake).mul(fine.b.mul(0.5).add(0.1))
                .mul(0.22));
        // fragmentNode, not colorNode: the shadow pass multiplies a caster's alpha by its
        // colorNode, which would sample the shadow map while it is being drawn.
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
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
            mesh.name = `ForestBark ${name}`;
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

    // -- needles and leaves -------------------------------------------------------------
    createFoliageMaterial(species, kind, buffers) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `ForestFoliage ${kind}`;
        const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
        const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
        const tree = instancedBufferAttribute(buffers.tree); // base xyz, height
        const paint = attribute('color', 'vec4'); // tip weight, shoot id, shade, leaf (1) or wood (0)
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        const t = light.uTime;
        const force = light.uWind.add(light.uGust);
        const leafy = species === 'birch';
        // Birch leaves tremble at a breath; needles only shiver.
        const shiver = sin(t.mul(paint.g.mul(3).add(leafy ? 6 : 4)).add(paint.g.mul(41)).add(crown.z.mul(13)))
            .mul(paint.r).mul(paint.a).mul(force.mul(leafy ? 0.07 : 0.03).add(leafy ? 0.012 : 0.005));
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
        const leaf = ramp(FOLIAGE_RAMPS[species] || FOLIAGE_RAMPS.spruce, tone);
        const albedo = mix(color(0x120c09), leaf, paint.a).mul(paint.b);
        // Moonlight through a spray is a cold silver, whatever the green in front of it.
        const silver = pow(leaf, vec3(0.6)).mul(leafy ? vec3(0.74, 0.98, 1.08) : vec3(0.7, 0.9, 1.14));
        const cool = light.night(albedo);

        const moon = light.moonlight();
        const facing = dot(blade, light.uMoonDir);
        const wrap = saturate(dot(normal, light.uMoonDir).mul(0.6).add(0.4));
        const front = cool.mul(wrap).mul(saturate(facing.abs().mul(2.2).add(0.45)));
        // Needles are too fine to block the moon: looking up the beam, the fringe of every
        // spray is edged in light, and the tips most of all.
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 5);
        const back = silver.mul(paint.a).mul(paint.r.mul(0.8).add(0.2))
            .mul(through.mul(leafy ? 1.3 : 1.0).add(saturate(facing.negate()).mul(0.16)))
            .mul(crown.x.mul(0.6).add(0.4));
        const occlusion = crown.x.mul(0.8).add(0.2);
        const glow = light.glow(world);
        const lit = front.add(back).mul(light.moonColour()).mul(moon)
            .add(cool.mul(light.ambient(normal)).mul(occlusion).mul(1.1))
            .add(albedo.mul(1.5).add(0.004).mul(glow).mul(occlusion));
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        return material;
    }

    buildFoliage() {
        const visible = createForestVisibilityTest();
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
            if (!asset.foliage || !sites.count) return;
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
                                species: asset.species,
                                kind: asset.foliage,
                                matrices: [],
                                crown: [],
                                bent: [],
                                tree: [],
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
            if (!geometry) throw new Error(`[Forest] Foliage mesh "${key}" is missing from the asset pack.`);
            const count = bucket.matrices.length / 16;
            const buffers = {
                crown: new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4),
                bent: new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4),
                tree: new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4),
            };
            // Variants of one spray kind differ only in geometry and instance data, but the
            // instance buffers are baked into the node graph, so each draw owns a material.
            const material = this.createFoliageMaterial(bucket.species, bucket.kind, buffers);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `ForestFoliage ${key}`;
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

    /** Points among the lower boughs of the near trees, where fireflies like to hang. */
    sampleCrownPoints(count, rng = this.rng) {
        const points = new Float32Array(count * 3);
        const yaw = new THREE.Quaternion();
        const position = new THREE.Vector3();
        const near = this.placements.filter((tree) => !tree.far && this.assets.trees[tree.asset].sites.count > 0);
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

    /** The trunks nearest the eye, for whatever wants to wind around them. */
    trunks() {
        return this.placements.map((tree) => {
            const asset = this.assets.trees[tree.asset];
            return {
                asset: tree.asset,
                x: tree.x,
                y: tree.y,
                z: tree.z,
                radius: (asset.trunkRadius || 0.3) * tree.scale,
                height: asset.height * tree.scale,
                crownBase: (asset.crownBase || asset.height * 0.3) * tree.scale,
            };
        });
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
