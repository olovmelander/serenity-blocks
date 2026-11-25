/**
 * Fall — the grove.
 *
 * Trees are authored in Blender (see fall-assets.js): bark meshes are instanced per
 * specimen, and every foliage spray of every tree is one instance in a handful of shared
 * draws. Leaves are real lobed geometry lit as thin translucent blades, so a low sun
 * behind the crowns makes them glow; the crown's baked sky visibility and bent normals
 * give each tree depth without any per-frame lighting cost.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, float, fract, instancedBufferAttribute, mix, normalize,
    normalWorld, positionGeometry,
    positionLocal, positionWorld, pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { FALL_BARK_SHEET_SIZE, fallBarkSheetOnce } from './fall-bark-sheet.js';
import {
    FALL_FEATURE_TREES, FALL_GROVE_CEILING, createFallVisibilityTest, layoutFallGrove,
} from './fall-composition.js';
import { FALL_SLICE_MS, fallSlice } from './fall-slices.js';
import { fallTerrainHeight } from './fall-terrain.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Autumn ramps per species, walked by `tone` from the deepest to the lightest colour. */
const LEAF_RAMPS = Object.freeze({
    maple: [0x5c0a08, 0xa8200a, 0xd0560c, 0xdc9416],
    oak: [0x4a1c0a, 0x7c3a0c, 0xa8620f, 0xc08a1c],
    birch: [0xb8780c, 0xd8a012, 0xe8c226, 0xdcd04a],
});
/** How far down its ramp the canopy slides at a full turn of play (the leaves in the air go further). */
const CANOPY_TURN = 0.16;
const FOLIAGE_SPECIES = Object.freeze({
    maple_spray: 'maple', maple_clump: 'maple', oak_spray: 'oak', birch_strand: 'birch',
});

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

/** The bark sheet as a texture: it repeats round and along every limb, mip-mapped for the far trees. */
function barkSheetTexture({ data, width, height }) {
    // (A copy: the kept sheet outlives this start, and a texture's dispose() may release its array.)
    const sheet = new THREE.DataTexture(new Uint8Array(data), width, height, THREE.RGBAFormat);
    sheet.wrapS = THREE.RepeatWrapping;
    sheet.wrapT = THREE.RepeatWrapping;
    sheet.magFilter = THREE.LinearFilter;
    sheet.minFilter = THREE.LinearMipmapLinearFilter;
    sheet.generateMipmaps = true;
    sheet.anisotropy = 4;
    sheet.colorSpace = THREE.NoColorSpace;
    sheet.name = 'FallBarkSheet';
    sheet.needsUpdate = true;
    return sheet;
}

const LEAN = new THREE.Quaternion();
const LEAN_EULER = new THREE.Euler();

/** How a tree stands: turned about the plumb by its yaw, then tipped by its lean (if it has one). */
function treeTurn(tree, out) {
    out.setFromAxisAngle(UP, tree.yaw);
    if (tree.lean) out.premultiply(LEAN.setFromEuler(LEAN_EULER.set(tree.lean[0], 0, tree.lean[1])));
    return out;
}

/** Deterministic 0..1 hash for choosing which sprays a tier keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export class FallForest {
    constructor({
        light, assets, tier, rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallGrove';
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
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The grove as steps for the world's breathing build, a time slice a step: the bark, then the
     * sprays tree by tree and their draws (one 15-18 ms step of a first visit before).
     */
    * buildSteps() {
        const clock = stepClock(FALL_SLICE_MS);
        const grove = layoutFallGrove(this.rng, FALL_GROVE_CEILING).slice(0, this.tier.groveTrees);
        this.placements = [...FALL_FEATURE_TREES, ...grove]
            .filter((tree) => this.assets.trees[tree.asset])
            .map((tree) => ({ ...tree, y: fallTerrainHeight(tree.x, tree.z) }));
        this.stats.trees = this.placements.length;
        // The bark sheet every trunk and limb wears (fall-bark-sheet.js; drawn once a session).
        const sheet = yield* fallBarkSheetOnce(clock, fallSlice);
        this.barkSheet = this.own(barkSheetTexture(sheet));
        this.buildBark();
        yield* fallSlice(clock, 'bark');
        yield* this.foliageSteps(clock);
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial(species) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = species === 'birch' ? 'FallBirchBark' : 'FallOldBark';
        const tree = instancedBufferAttribute(this.treeAttribute);
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, moss
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        material.positionNode = positionLocal.add(light.wind({
            world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: paint.r, phase: paint.g,
        }));

        const st = uv();
        const world = positionWorld;
        const sheet = this.barkSheet;
        const E = 1 / FALL_BARK_SHEET_SIZE;
        // How far up its own trunk a fragment is, and a slow tone that never repeats with the sheet
        // (read at the tree's rest shape, so it rides the wind with the wood).
        const above = world.y.sub(tree.y);
        const broad = light.noise(positionGeometry.xy.mul(0.09).add(positionGeometry.z.mul(0.05)));
        let albedo;
        let dHdu;
        let dHdv;
        let depth;
        let cavity;
        if (species === 'birch') {
            // Chalk-white paper bark. The sheet laid on its side gives the lenticels: thin dark
            // dashes round the stem, broken along their length; the foot of an old birch is black
            // and rugged, and a sooty scar sits where a limb leaves.
            const around = vec2(st.y.mul(4.5), st.x);
            const band = texture(sheet, around);
            const upright = texture(sheet, st);
            const dash = smoothstep(0.5, 0.86, band.b).mul(smoothstep(0.38, 0.62, upright.a));
            // (Fissures only, and low: a blotched foot read as a dark figure against the white.)
            const foot = float(1).sub(smoothstep(0.1, 1.3, above)).mul(smoothstep(0.55, 0.95, upright.b)).mul(0.7);
            const soot = smoothstep(0.55, 0.9, broad.a.mul(0.6).add(paint.b.oneMinus().mul(0.9)));
            const dark = saturate(dash.add(soot).add(foot));
            const paper = mix(color(0xcfc6b4), color(0xece4d4), upright.g).mul(band.g.mul(0.14).add(0.9));
            albedo = mix(paper, color(0x1d1915), dark);
            // The dashes are grooves: the sheet's cavity, turned over, is the height along the stem.
            dHdu = float(0);
            dHdv = band.b.sub(texture(sheet, around.add(vec2(E, 0))).b).div(E).mul(4.5);
            depth = float(0.003);
            cavity = dark.mul(0.35);
        } else {
            // Old bark in plates: tall plates split by deep furrows that run up the trunk and fork,
            // fissures across them, a fibrous grain; its relief is read off the sheet's own height.
            const here = texture(sheet, st);
            dHdu = texture(sheet, st.add(vec2(E, 0))).r.sub(here.r).div(E);
            dHdv = texture(sheet, st.add(vec2(0, E * 0.5))).r.sub(here.r).div(E * 0.5);
            const oak = species === 'oak';
            const plate = mix(color(oak ? 0x2b2119 : 0x35291f), color(oak ? 0x5b4a3a : 0x6b5847), here.g)
                .mul(broad.r.mul(0.5).add(0.76));
            const raised = smoothstep(0.06, 0.5, here.r);
            const wood = mix(color(0x0b0705), plate, raised);
            // Moss in soft cushions at the root flare and on the damp side (the tree's own painted
            // cover, opened by the sheet's slow blotches); pale lichen crusts higher up, on the plates.
            // (Low and in patches: a trunk green to head height read as a mossy pillar, not as bark.
            // The furrows hold it first. A lying log or a stump is all low, so mossy all over.)
            const damp = float(1).sub(smoothstep(0.15, 1.5, above));
            const cover = smoothstep(0.52, 0.82, paint.a.mul(1.1).mul(damp.mul(0.6).add(0.4)).add(damp.mul(0.22))
                .add(here.b.mul(0.12))
                .mul(here.a.mul(0.9).add(0.45)));
            const cushion = mix(color(0x18240c), color(0x4a5c1e), here.g.mul(0.55).add(here.r.mul(0.45)));
            const crust = texture(sheet, st.mul(vec2(1, 0.37)).add(vec2(0.37, 0.11))).a;
            const lichen = smoothstep(0.66, 0.76, crust).mul(raised).mul(cover.oneMinus())
                .mul(smoothstep(0.8, 2.4, above))
                .mul(0.6);
            albedo = mix(mix(wood, color(0x8b947c), lichen), cushion, cover);
            // Moss pads the furrows it grows over.
            depth = cover.oneMinus().mul(0.6).add(0.4).mul(oak ? 0.026 : 0.021);
            cavity = here.b.mul(cover.oneMinus().mul(0.7).add(0.3));
        }
        // Rain darkens the wood (FallLight.uWet).
        albedo = albedo.mul(float(1).sub(light.uWet.mul(0.28)));

        // Relief: the low sun rakes across the plates. The slope comes from the sheet (three taps),
        // carried to the screen through the UVs' own derivatives.
        const smooth = normalize(normalWorld);
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const reliefX = dHdu.mul(dFdx(st.x)).add(dHdv.mul(dFdx(st.y)));
        const reliefY = dHdu.mul(dFdy(st.x)).add(dHdv.mul(dFdy(st.y)));
        const slope = r1.mul(reliefX).add(r2.mul(reliefY)).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(depth)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir));
        // Low sun behind the trunk wraps a thin rim of light around its silhouette.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.55)));
        const occlusion = paint.b.mul(0.85).add(0.15).mul(float(1).sub(cavity.mul(0.6)));
        const lit = albedo.mul(light.uSunColor).mul(facing.mul(1.5).add(rim.mul(0.9))).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.25));
        // fragmentNode, not colorNode: the shadow pass multiplies a caster's alpha by its
        // colorNode, which would sample the shadow map while it is being drawn.
        material.fragmentNode = vec4(light.haze(light.events.onBark(lit, { world, tree }), { world }), 1);
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
            mesh.name = `FallBark ${name}`;
            trees.forEach((tree, index) => {
                dummy.position.set(tree.x, tree.y, tree.z);
                dummy.rotation.set(0, tree.yaw, 0);
                if (tree.lean) treeTurn(tree, dummy.quaternion);
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
            if (!this.tier.twigs && asset.barkCoreIndices > 0 && asset.barkCoreIndices < drawn) {
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

    // -- foliage ------------------------------------------------------------------------
    createFoliageMaterial(kind, buffers) {
        const { light } = this;
        const species = FOLIAGE_SPECIES[kind];
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `FallFoliage ${kind}`;
        const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
        const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
        const tree = instancedBufferAttribute(buffers.tree); // base xyz, height
        const paint = attribute('color', 'vec4'); // tip weight, leaf id, shade, leaf (1) or wood (0)
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        const t = light.uTime;
        const force = light.uWind.add(light.uGust);
        const flutter = sin(t.mul(paint.g.mul(3).add(5)).add(paint.g.mul(41)).add(crown.z.mul(13)))
            .mul(paint.r).mul(paint.a).mul(force.mul(0.05).add(0.014));
        material.positionNode = positionLocal
            .add(light.wind({
                world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: crown.y, phase: crown.z,
            }))
            .add(vec3(light.uWindDir.x.mul(0.5), 1, light.uWindDir.z.mul(0.5)).mul(flutter));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const blade = normalize(normalWorld);
        const normal = normalize(mix(blade, bent.xyz, 0.6));
        // Colour: each tree sits somewhere on its species' ramp; exposed leaves turn first. Hot play
        // turns the whole canopy a little further (FallLight.uTurn): gold deepens toward rust.
        const tone = saturate(bent.w.add(crown.w.sub(0.5).mul(0.34)).add(paint.g.sub(0.5).mul(0.3))
            .add(crown.x.sub(0.5).mul(-0.22)).sub(light.uTurn.mul(CANOPY_TURN)));
        const leaf = ramp(LEAF_RAMPS[species], tone);
        const vein = smoothstep(0.02, 0.09, uv().x.sub(0.5).abs()).mul(0.14).add(0.86);
        const albedo = mix(color(0x20140d), leaf.mul(vein), paint.a).mul(paint.b);
        const glowing = pow(leaf, vec3(0.78)).mul(vec3(1.3, 1.08, 0.66));

        const sun = light.sunlight();
        const facing = dot(blade, light.uSunDir);
        const wrap = saturate(dot(normal, light.uSunDir).mul(0.6).add(0.4));
        const front = albedo.mul(wrap).mul(saturate(facing.mul(4).add(0.6)));
        // Thin-blade transmission: sun on the far face lights the near one, most of all
        // when the eye looks straight up the beam.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const back = glowing.mul(paint.a).mul(saturate(facing.negate()).mul(0.55).add(through.mul(1.25)))
            .mul(crown.x.mul(0.5).add(0.5));
        const occlusion = crown.x.mul(0.78).add(0.22);
        const lit = front.add(back).mul(light.uSunColor).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.5))
            // Light that has already passed through the crown warms the leaves it shades.
            .add(glowing.mul(paint.a).mul(light.uSunColor).mul(crown.x.mul(0.05).add(0.022))
                .mul(light.uWarmth.mul(0.9).add(1)));
        material.fragmentNode = vec4(light.haze(light.events.onFoliage(lit, { world, tree, glowing: glowing.mul(paint.a) }), { world }), 1);
        return material;
    }

    buildFoliage() {
        drainSteps(this.foliageSteps(stepClock(FALL_SLICE_MS)));
    }

    /** The sprays of every tree, a time slice a step, then a draw for each kind and variant. */
    * foliageSteps(clock) {
        const visible = createFallVisibilityTest();
        const buckets = new Map();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const yaw = new THREE.Quaternion();
        const bentNormal = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const { variants } = this.assets.foliage;
        for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex += 1) {
            const tree = this.placements[treeIndex];
            const asset = this.assets.trees[tree.asset];
            const { sites } = asset;
            const keep = this.tier.foliage * (tree.far ? 0.5 : 1);
            const grow = (1 / keep) ** 0.36;
            treeTurn(tree, yaw);
            for (let i = 0; i < sites.count; i += 1) {
                if ((i & 255) === 0) yield* fallSlice(clock, 'foliage');
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
        }
        const materials = new Map();
        for (const [key, bucket] of buckets) {
            yield* fallSlice(clock, 'foliage');
            const geometry = this.assets.foliage.meshes[key];
            if (!geometry) throw new Error(`[Fall] Foliage mesh "${key}" is missing from the asset pack.`);
            const count = bucket.matrices.length / 16;
            const buffers = {
                crown: new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4),
                bent: new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4),
                tree: new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4),
            };
            // Variants of one spray kind differ only in geometry and instance data, but the
            // instance buffers are baked into the node graph, so each draw owns a material.
            const material = this.createFoliageMaterial(bucket.kind, buffers);
            materials.set(key, material);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `FallFoliage ${key}`;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.sprays += count;
            this.stats.foliageTriangles += (geometry.index.count / 3) * count;
        }
    }

    /** Points on the crowns where a falling leaf may let go, as [x, y, z, speciesIndex]. */
    sampleCrownPoints(count, rng = this.rng) {
        const points = new Float32Array(count * 4);
        const speciesIndex = { maple: 0, oak: 1, birch: 2 };
        const yaw = new THREE.Quaternion();
        const position = new THREE.Vector3();
        const near = this.placements.filter((tree) => !tree.far);
        for (let i = 0; i < count; i += 1) {
            const tree = near[Math.floor(rng() * near.length) % near.length];
            const asset = this.assets.trees[tree.asset];
            const site = Math.floor(rng() * asset.sites.count) % asset.sites.count;
            treeTurn(tree, yaw);
            position.fromArray(asset.sites.position, site * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
            points.set([position.x + tree.x, position.y + tree.y, position.z + tree.z,
                speciesIndex[asset.species] ?? 0], i * 4);
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
