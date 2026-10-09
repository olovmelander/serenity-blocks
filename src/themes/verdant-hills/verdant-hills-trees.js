/**
 * Verdant Hills — the old oak and the oaks of the downs.
 *
 * Trees are authored in Blender (see verdant-hills-assets.js): bark meshes are instanced
 * per specimen, and every spray of leaves of every tree is one instance in a handful of
 * shared draws. Leaves are real geometry lit as thin blades, so the high sun ahead of the
 * lens turns the near side of a crown to yellow-green glass; the crown's baked sky
 * visibility and bent normals give each tree its dark heart without any per-frame
 * lighting cost. The trees of the home hill draw into the static shadow map, so the old
 * oak lays real dappled shade on the grass; the shade of those further off is baked into
 * the land (see verdant-hills-layout.js).
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, float, fract, instancedBufferAttribute, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { createVerdantHillsVisibilityTest } from './verdant-hills-composition.js';
import {
    VERDANT_HILLS_FEATURE_TREES, VERDANT_HILLS_SHADOW_REACH, layoutVerdantHillsFieldTrees, verdantHillsRange,
} from './verdant-hills-layout.js';
import { VERDANT_HILLS_SUN_DIRECTION } from './verdant-hills-light.js';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const { smoothstep: ramp } = THREE.MathUtils;

/**
 * The oak's foliage ramp, walked by `tone` from the dark heart of a crown to sunlit
 * high-summer green. The far trees' sprites are painted from the same ramp.
 */
export const VERDANT_HILLS_OAK_RAMP = Object.freeze([0x0b2209, 0x1c4810, 0x38701a, 0x64942a]);
const FOLIAGE_RAMPS = Object.freeze({ oak: VERDANT_HILLS_OAK_RAMP });
const FOLIAGE_SPECIES = Object.freeze({ oak_spray: 'oak', oak_tuft: 'oak' });
/**
 * How leaves answer the light and the wind, by spray. Oak leaves are stiff and sit in
 * rosettes: they shiver rather than tremble, and the sun comes through them a clear
 * yellow-green. `through` is how brightly a spray lights up seen against the sun, `behind`
 * how much of that a leaf turned from the sun shows whichever way one looks.
 */
const FOLIAGE_LOOK = Object.freeze({
    // The old oak's crown hangs between the lens and the sun: its sprays glow.
    oak_spray: {
        flutter: [0.045, 0.012], glow: [1.25, 1.5, 0.28], through: 1.3, behind: 0.42, sun: 0.3, ambient: 0.95,
    },
    oak_tuft: {
        flutter: [0.045, 0.012], glow: [1.25, 1.5, 0.28], through: 0.95, behind: 0.34, sun: 0.3, ambient: 0.95,
    },
});
/** A tree beyond the home hill keeps this share of its sprays, less the further off it stands. */
const FAR_SPRAYS = [0.62, 0.32];
const FAR_RANGES = [240, 600];

function ramped(stops, t) {
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

export class VerdantHillsTrees {
    /** `rng` is accepted for symmetry with the other parts: the layout plants from its own seed. */
    constructor({
        light, assets, tier, rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsTrees';
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
        const field = layoutVerdantHillsFieldTrees(null, this.tier.fieldTrees);
        this.placements = [...VERDANT_HILLS_FEATURE_TREES, ...field]
            .filter((tree) => this.assets.trees[tree.asset])
            .map((tree) => ({
                ...tree,
                y: verdantHillsGroundHeight(tree.x, tree.z) - 0.05,
                // Only the home hill lies inside the shadow map.
                casts: verdantHillsRange(tree.x, tree.z) <= VERDANT_HILLS_SHADOW_REACH,
            }));
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildFoliage();
        return this;
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial(name) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = `VerdantHillsBark ${name}`;
        const tree = instancedBufferAttribute(this.treeAttribute);
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, moss
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        material.positionNode = positionLocal.add(light.wind({
            world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: paint.r, phase: paint.g,
        }));

        const st = uv();
        const grain = light.noise(st.mul(vec2(1, 0.55)));
        const fine = light.noise(st.mul(vec2(3.1, 1.4)).add(grain.rg.mul(0.25)));
        // Oak bark: grey-brown plates parted by fissures that run up the stem and wander,
        // broken across here and there. The lens sees the shaded side of the bole, so the
        // fissures are only a shade darker than the plates: in open shade they are not black.
        const ridges = light.noise(st.mul(vec2(2.3, 0.3)).add(vec2(grain.b.mul(0.22), 0)));
        const breaks = light.noise(st.mul(vec2(1.1, 1.9)).add(fine.rg.mul(0.2)));
        const plate = smoothstep(0.34, 0.6, ridges.g.mul(0.62).add(ridges.b.mul(0.38)))
            .mul(smoothstep(0.24, 0.42, breaks.b.mul(0.7).add(fine.a.mul(0.3))));
        const plates = mix(color(0x625a4e), color(0x7d7567), grain.r.mul(0.55).add(fine.g.mul(0.45)));
        const barked = mix(color(0x3a342c), plates, plate);
        // Moss and lichen where the rain is driven: the mask is painted against the weather side.
        const moss = mix(color(0x47562a), color(0x8f9a72), fine.a.mul(0.7).add(grain.g.mul(0.3)));
        const grown = smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6)));
        const albedo = mix(barked, moss, grown);
        const relief = plate.mul(0.8).add(fine.r.mul(0.2)).mul(grown.mul(0.6).oneMinus());

        const world = positionWorld;
        // Relief from the bark pattern itself: the sun rakes across the plates.
        const smooth = normalize(normalWorld);
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(0.07)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir));
        // The sun beyond a trunk wraps a thin rim of light around its silhouette.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.55)));
        // The bake's occlusion is softened: under its own crown a bole stands in open shade.
        const occlusion = mix(float(1), paint.b, 0.55);
        // Shaded wood is filled by the sky above and by the sunlit grass below, most on what
        // faces the ground (the underside of the long bough) and on what stands low.
        const low = saturate(world.y.sub(tree.y).div(tree.w.mul(0.3))).oneMinus();
        const fill = light.ambient(normal)
            .add(light.uBounce.mul(saturate(normal.y.negate()).mul(1.4).add(low.mul(0.5)).add(0.15)));
        const lit = albedo.mul(light.uSunColor).mul(facing.mul(0.36).add(rim.mul(0.3))).mul(sun)
            .add(albedo.mul(fill).mul(occlusion));
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
            const mesh = new THREE.InstancedMesh(asset.bark, this.createBarkMaterial(name), trees.length);
            mesh.name = `VerdantHillsBark ${name}`;
            trees.forEach((tree, index) => {
                dummy.position.set(tree.x, tree.y, tree.z);
                dummy.rotation.set(0, tree.yaw, 0);
                dummy.scale.setScalar(tree.scale);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                data.set([tree.x, tree.y, tree.z, asset.height * tree.scale], index * 4);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = trees.some((tree) => tree.casts);
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

    // -- leaves -------------------------------------------------------------------------
    createFoliageMaterial(kind, buffers) {
        const { light } = this;
        const species = FOLIAGE_SPECIES[kind] || 'oak';
        const look = FOLIAGE_LOOK[kind] || FOLIAGE_LOOK.oak_tuft;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `VerdantHillsFoliage ${kind}`;
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
        const leaf = ramped(FOLIAGE_RAMPS[species], tone);
        const albedo = mix(color(0x1a140d), leaf, paint.a).mul(paint.b);
        // Sun through a leaf is a clear yellow-green, whatever the green in front of it.
        const glowing = pow(leaf, vec3(0.62)).mul(vec3(...look.glow));

        const sun = light.sunlight();
        const facing = dot(blade, light.uSunDir);
        const wrap = saturate(dot(normal, light.uSunDir).mul(0.6).add(0.4));
        // The heart of a crown sees little sky and as little sun: the leaves around it take both.
        const open = smoothstep(0.04, 0.6, crown.x).mul(0.68).add(0.32);
        const front = albedo.mul(wrap).mul(saturate(facing.abs().mul(2.2).add(0.45))).mul(open);
        // Leaves are too thin to block the sun: looking up the beam, every spray lights up.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const back = glowing.mul(paint.a).mul(paint.r.mul(0.6).add(0.4))
            .mul(through.mul(look.through).add(saturate(facing.negate()).mul(look.behind)))
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
        const visible = createVerdantHillsVisibilityTest();
        const buckets = new Map();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const yaw = new THREE.Quaternion();
        const bentNormal = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const sun = VERDANT_HILLS_SUN_DIRECTION;
        const { variants } = this.assets.foliage;
        this.placements.forEach((tree, treeIndex) => {
            const asset = this.assets.trees[tree.asset];
            const { sites } = asset;
            const away = ramp(verdantHillsRange(tree.x, tree.z), ...FAR_RANGES);
            const thinned = tree.far ? FAR_SPRAYS[0] + (FAR_SPRAYS[1] - FAR_SPRAYS[0]) * away : 1;
            const keep = Math.min(1, this.tier.foliage * thinned);
            const grow = (1 / keep) ** 0.36;
            yaw.setFromAxisAngle(UP, tree.yaw);
            for (let i = 0; i < sites.count; i += 1) {
                if (keepHash(i, treeIndex + 1) <= keep) {
                    position.fromArray(sites.position, i * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
                    position.x += tree.x;
                    position.y += tree.y;
                    position.z += tree.z;
                    const size = sites.scale[i] * tree.scale * grow;
                    // A spray out of the frame still counts if its shadow falls inside it (with
                    // the sun ahead of the lens few do: what shades the frame is mostly in it).
                    const drop = (position.y - tree.y) / sun.y;
                    const seen = visible(position.x, position.y, position.z, size * 1.2) || (tree.casts
                        && visible(position.x - sun.x * drop, tree.y, position.z - sun.z * drop, size * 1.5));
                    if (seen) {
                        const key = `${asset.foliage}_${sites.variant[i] % variants}`;
                        if (!buckets.has(key)) {
                            buckets.set(key, {
                                kind: asset.foliage, matrices: [], crown: [], bent: [], tree: [], casts: false,
                            });
                        }
                        const bucket = buckets.get(key);
                        bucket.casts ||= tree.casts;
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
            if (!geometry) throw new Error(`[Verdant Hills] Foliage mesh "${key}" is missing from the asset pack.`);
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
            mesh.name = `VerdantHillsFoliage ${key}`;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = bucket.casts;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.sprays += count;
            this.stats.foliageTriangles += (geometry.index.count / 3) * count;
        });
    }

    /** A named point of a hand-placed tree in the world (the old oak's `swing`, its `boughTip`), or null. */
    anchor(name, key) {
        const tree = this.placements.find((entry) => entry.asset === name);
        const local = this.assets.trees[name]?.anchors?.[key];
        if (!tree || !Array.isArray(local) || local.length < 3) return null;
        return new THREE.Vector3(local[0], local[1], local[2]).multiplyScalar(tree.scale).applyAxisAngle(UP, tree.yaw)
            .add(new THREE.Vector3(tree.x, tree.y, tree.z));
    }

    /** Points among the crowns near the lens, where swallows and seed down pass. */
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
