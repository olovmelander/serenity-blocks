/**
 * Grainfields — the shelterbelts: Japanese larch, Ezo spruce and white birch.
 *
 * Trees are authored in Blender (scripts/blender/grainfields_assets.py, loaded by
 * grainfields-assets.js): within `tier.forest.near` metres of the eye every tree is its bark mesh
 * (instanced per specimen) and its sprays of needles and leaves (one instance each, in a handful of
 * shared draws); farther out the belts are sprites from the impostor sheet. The sites are the
 * plan's (treeSites): the belts along the plots and the few lone trees in the fields.
 *
 * From the low eye only what stands over the barley's crest can show, so sprays the crest hides
 * are never drawn, and the far ones are thinned (a tree a few dozen pixels tall keeps its shape
 * with a third of its sprays, each grown a little).
 *
 * Unlit, lit by the shared light: the deck's gaps throw the sun onto a crown (read once a pixel
 * at the tree's own foot), the crown's baked sky visibility and bent normals give it its dark
 * heart, and with the sun ahead the thin needles and leaves light up like glass. Then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    color,
    dot,
    float,
    fract,
    instancedBufferAttribute,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE, clamp01 } from './grainfields-core.js';
import { groundHeight } from './grainfields-plan.js';
import { aerial } from './grainfields-light.js';
import { deckShadow } from './grainfields-tsl.js';

const UP = new THREE.Vector3(0, 1, 0);

/** treeSites' kinds by code, and the authored specimens of each. */
export const TREE_SPECIES = Object.freeze(['larch', 'birch', 'spruce']);
const SPECIMENS = Object.freeze({
    larch: ['larch-grove-a', 'larch-grove-b', 'larch-grove-c'],
    birch: ['birch-grove-a', 'birch-grove-b', 'birch-grove-c'],
    spruce: ['spruce-grove-a', 'spruce-grove-b', 'spruce-grove-c'],
});
const FOLIAGE_SPECIES = Object.freeze({ larch_tuft: 'larch', birch_sprig: 'birch', spruce_frond: 'spruce' });

/**
 * Foliage ramps per species (sRGB), walked by `tone` from a crown's dark heart to its sunlit
 * skin: the larch soft and light at the end of summer, the spruce near black-green, the birch a
 * fresh yellow-green.
 */
const FOLIAGE_RAMPS = Object.freeze({
    larch: [0x12240b, 0x284a15, 0x4a6e22, 0x7c973c],
    birch: [0x0f2609, 0x224a12, 0x44741e, 0x779b36],
    spruce: [0x050f08, 0x0b2010, 0x183517, 0x324d27],
});
/** How sprays answer the light and the wind: flutter (amount, floor), the glow's tint, its strength. */
const FOLIAGE_LOOK = Object.freeze({
    larch: {
        flutter: [0.035, 0.008], glow: [1.45, 1.4, 0.35], through: 0.8, sun: 0.3, ambient: 1.0,
    },
    birch: {
        flutter: [0.07, 0.02], glow: [1.25, 1.5, 0.3], through: 0.75, sun: 0.28, ambient: 0.95,
    },
    spruce: {
        flutter: [0.025, 0.005], glow: [1.5, 1.2, 0.3], through: 0.6, sun: 0.45, ambient: 1.05,
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

/** The share of a tree's sprays drawn at a distance (metres): all near, a third far out. */
function sprayShare(d) {
    if (d < 320) return 1;
    return d < 650 ? 0.6 : 0.36;
}

/** Deterministic 0..1 hash for choosing which sprays a tree keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** The bearings (degrees right of the view axis) a frame can show, with a margin. */
const BEARINGS = [-58, 58];
/** The barley's ears over the near field's ground, and how far the crest's horizon is looked for. */
const EAR_TOP = 0.95;
const CREST_REACH = 160;

/**
 * The crest's horizon by bearing (degrees of elevation from the eye, one per degree of bearing):
 * anything below it beyond the crest is behind the barley.
 */
export function crestHorizon() {
    const out = new Float32Array(BEARINGS[1] - BEARINGS[0] + 1);
    for (let k = 0; k < out.length; k++) {
        const b = (BEARINGS[0] + k) * DEG;
        let best = -90;
        for (let d = 3; d <= CREST_REACH; d += 1) {
            const x = EYE.x + Math.sin(b) * d;
            const z = EYE.z - Math.cos(b) * d;
            best = Math.max(best, Math.atan2(groundHeight(x, z) + EAR_TOP - EYE.y, d) / DEG);
        }
        out[k] = best;
    }
    return out;
}

/** Whether a point (with a size) can show over the crest, and inside the frames' bearings. */
function makeVisibilityTest() {
    const horizon = crestHorizon();
    return (x, y, z, size) => {
        const dx = x - EYE.x;
        const dz = z - EYE.z;
        const d = Math.hypot(dx, dz);
        const bearing = Math.atan2(dx, -dz) / DEG;
        if (bearing < BEARINGS[0] || bearing > BEARINGS[1]) return false;
        if (d < CREST_REACH) return true;
        const k = Math.round(bearing - BEARINGS[0]);
        const top = Math.atan2(y + size - EYE.y, d) / DEG;
        return top > horizon[k] - 0.04;
    };
}

/**
 * The wind in a crown: the whole tree leans and rocks on its own phase (more the higher up), a
 * spray or a limb on its own.
 */
function treeSway(u, {
    base, height, sway, phase,
}) {
    const treePhase = fract(base.x.mul(0.37).add(base.z.mul(0.71)));
    const up = clamp(positionLocal.y.sub(base.y).div(height.max(1.0)), 0.0, 1.2);
    const rock = sin(u.time.mul(0.85).add(treePhase.mul(6.283))).mul(0.6)
        .add(sin(u.time.mul(2.1).add(treePhase.mul(17.0)).add(phase.mul(6.283))).mul(0.25));
    const lean = up.mul(up).mul(height).mul(u.windStrength).mul(rock.mul(0.012).add(0.006))
        .mul(sway.mul(0.6).add(0.4));
    return vec3(u.windDir.x.mul(lean), 0.0, u.windDir.y.mul(lean));
}

/** The light a crown or a trunk gets: the sun through the deck's gaps at its foot, and the sky. */
function treeSun(u, t, base, height) {
    return deckShadow(u, t.noise, base.add(vec3(0.0, height.mul(0.6), 0.0))).mul(u.sunUp);
}

function barkMaterial(u, t, species, treeAttribute) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = `GrainfieldsBark-${species}`;
    const tree = instancedBufferAttribute(treeAttribute); // foot xyz, height
    const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, species mask
    material.positionNode = positionLocal.add(treeSway(u, {
        base: tree.xyz, height: tree.w, sway: paint.r, phase: paint.g,
    }));
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const st = uv();
        const grain = texture(t.noise, st.mul(vec2(0.11, 0.06)));
        const fine = texture(t.noise, st.mul(vec2(0.37, 0.15)).add(grain.rg.mul(0.03)));
        let albedo;
        if (species === 'birch') {
            // Chalk-white bark banded with dark lenticels; the foot and the twigs dark and rough.
            const paper = mix(color(0xb8b2a2), color(0xf1eee6), grain.r.mul(0.6).add(fine.g.mul(0.4)));
            const dashes = texture(t.noise, st.mul(vec2(0.06, 0.55)).add(vec2(grain.b.mul(0.03), 0.0)));
            const lenticel = smoothstep(0.6, 0.7, dashes.g.mul(0.62).add(dashes.a.mul(0.38)));
            const white = mix(paper, color(0x211c18), lenticel.mul(0.7));
            const rough = mix(color(0x100c0a), color(0x4a3d33), fine.r);
            albedo = mix(white, rough, smoothstep(0.3, 0.8, paint.a.add(fine.b.sub(0.5).mul(0.3))));
        } else if (species === 'larch') {
            // Larch: thick red-brown plates low on the bole, thin flaking bark above.
            const plate = smoothstep(0.4, 0.7, fine.g.mul(0.6).add(grain.b.mul(0.4)));
            const thick = mix(color(0x2a1810), color(0x6e4630), plate);
            const thin = mix(color(0x4a2e1e), color(0x8a5a3c), fine.r);
            albedo = mix(thick, thin, paint.a);
        } else {
            // Spruce: grey-brown scales, pale lichen where the mask says so.
            const scale = smoothstep(0.36, 0.7, fine.g.mul(0.6).add(grain.b.mul(0.4)));
            const scaled = mix(color(0x1a120d), color(0x5f4a3a), scale).mul(grain.r.mul(0.5).add(0.72));
            const lichen = mix(color(0x55603c), color(0x98a07c), fine.a);
            albedo = mix(scaled, lichen, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))));
        }
        const N = normalize(normalWorld);
        const V = normalize(P.sub(u.eye));
        const sunlit = treeSun(u, t, tree.xyz, tree.w);
        const facing = clamp(dot(N, u.sunDir), 0.0, 1.0);
        // The sun behind a trunk wraps a thin rim of light round its silhouette.
        const rim = pow(float(1.0).sub(clamp(dot(N, V.negate()), 0.0, 1.0)), 3.0).mul(clamp(dot(V, u.sunDir).mul(0.6).add(0.4), 0.0, 1.0));
        const occlusion = paint.b.mul(0.85).add(0.15);
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(float(1.0).sub(N.y).mul(0.3)));
        const lit = albedo.mul(u.sun).mul(facing.mul(0.6).add(rim.mul(0.5))).mul(sunlit)
            .add(albedo.mul(sky).mul(occlusion).mul(1.1));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

function foliageMaterial(u, t, kind, buffers) {
    const species = FOLIAGE_SPECIES[kind] || 'larch';
    const look = FOLIAGE_LOOK[species];
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = `GrainfieldsFoliage-${kind}`;
    const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
    const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
    const tree = instancedBufferAttribute(buffers.tree); // foot xyz, height
    const paint = attribute('color', 'vec4'); // tip weight, leaf id, shade, leaf (1) or wood (0)
    const force = u.windStrength.add(0.25);
    const flutter = sin(u.time.mul(paint.g.mul(3.0).add(5.0)).add(paint.g.mul(41.0)).add(crown.z.mul(13.0)))
        .mul(paint.r).mul(paint.a).mul(force.mul(look.flutter[0]).add(look.flutter[1]));
    material.positionNode = positionLocal
        .add(treeSway(u, {
            base: tree.xyz, height: tree.w, sway: crown.y, phase: crown.z,
        }))
        .add(vec3(u.windDir.x.mul(0.5), 0.7, u.windDir.y.mul(0.5)).mul(flutter));
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const blade = normalize(normalWorld);
        const normal = normalize(mix(blade, bent.xyz, 0.65));
        // Each tree sits somewhere on its species' ramp; spray by spray it varies, and the open
        // side of the crown is lighter.
        const tone = clamp(bent.w.mul(0.6).add(crown.w.sub(0.5).mul(0.26)).add(paint.g.sub(0.5).mul(0.22))
            .add(crown.x.mul(0.22)), 0.0, 1.0);
        const leaf = ramp(FOLIAGE_RAMPS[species], tone);
        const albedo = mix(color(0x1a120d), leaf, paint.a).mul(paint.b);
        // Sun through a needle or a leaf is a clear yellow-green, whatever the green in front of it.
        const glowing = pow(leaf, vec3(0.62)).mul(vec3(...look.glow));
        const sunlit = treeSun(u, t, tree.xyz, tree.w);
        const facing = dot(blade, u.sunDir);
        const wrap = clamp(dot(normal, u.sunDir).mul(0.6).add(0.4), 0.0, 1.0);
        const front = albedo.mul(wrap).mul(clamp(facing.abs().mul(2.2).add(0.45), 0.0, 1.0));
        // Looking up the beam, every spray lights up.
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const through = a2.mul(a2);
        const back = glowing.mul(paint.a).mul(paint.r.mul(0.6).add(0.4))
            .mul(through.mul(look.through).add(clamp(facing.negate(), 0.0, 1.0).mul(0.3)))
            .mul(crown.x.mul(0.6).add(0.4));
        const occlusion = crown.x.mul(0.8).add(0.2);
        const sky = u.fill.mul(normal.y.mul(0.35).add(0.65)).add(u.bounce.mul(float(1.0).sub(normal.y).mul(0.3)));
        const lit = front.add(back).mul(u.sun).mul(sunlit).mul(look.sun)
            .add(albedo.mul(sky).mul(occlusion).mul(look.ambient).mul(1.3));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

/** The far belts' sprites: one card per tree, turned to the eye, shaded from the sheet's data. */
function spriteMaterial(u, t, impostors, tile, look, coverage) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'GrainfieldsFarBelts';
    const st = uv();
    const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
    const data = texture(impostors.texture, atlasUv); // shade, leaf mask, hue seed, coverage
    const sway = sin(u.time.mul(0.6).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
        .mul(u.windStrength.add(0.3));
    material.positionNode = positionLocal.add(vec3(u.windDir.x.mul(sway), 0.0, u.windDir.y.mul(sway)));
    if (coverage) {
        material.alphaTest = 0.5;
        material.alphaToCoverage = true;
    } else {
        material.maskNode = data.a.greaterThan(0.5);
    }
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye));
        // tile.w is the species: 0 larch, 0.5 birch, 1 spruce.
        const tone = clamp(tile.z.mul(0.62).add(data.b.sub(0.5).mul(0.3)).add(data.r.mul(0.3)), 0.0, 1.0);
        const larchLeaf = ramp(FOLIAGE_RAMPS.larch, tone);
        const birchLeaf = ramp(FOLIAGE_RAMPS.birch, tone);
        const spruceLeaf = ramp(FOLIAGE_RAMPS.spruce, tone);
        const leaf = mix(mix(larchLeaf, birchLeaf, smoothstep(0.25, 0.3, tile.w)), spruceLeaf, smoothstep(0.7, 0.75, tile.w));
        const isBirch = smoothstep(0.25, 0.3, tile.w).mul(float(1.0).sub(smoothstep(0.7, 0.75, tile.w)));
        const bark = mix(color(0x2a1a12), color(0xcfc9ba), isBirch);
        const albedo = mix(bark, leaf, data.g).mul(data.r.mul(0.85).add(0.15));
        const glowing = pow(leaf, vec3(0.62)).mul(vec3(1.45, 1.35, 0.32)).mul(data.g).mul(data.r);
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const sunlit = deckShadow(u, t.noise, P).mul(u.sunUp);
        const lit = albedo.mul(0.16).add(glowing.mul(a2.mul(a2).mul(0.7).add(0.06))).mul(u.sun).mul(sunlit)
            .add(albedo.mul(u.fill.mul(0.85).add(u.bounce.mul(0.2))).mul(1.5));
        return vec4(aerial(u, P, lit), coverage ? data.a : 1.0);
    })();
    return material;
}

/**
 * The shelterbelts. `sites` from grainfields-plan treeSites (x, ground y, z, height, kind, seed,
 * width, lean); `assets` from loadGrainfieldsAssets; `tier.forest` = { near, sprays, sprites }.
 */
export function createForest(u, t, assets, sites, tier, { coverage = false } = {}) {
    const owned = [];
    const borrowed = [];
    const own = (resource) => {
        owned.push(resource);
        return resource;
    };
    const stats = {
        trees: 0, sprites: 0, sprays: 0, culled: 0, foliageTriangles: 0, barkTriangles: 0,
    };
    const meshes = [];
    const { near, sprays, sprites } = tier.forest;
    const visible = makeVisibilityTest();
    const placements = [];
    const far = [];
    for (let i = 0; i < sites.length; i += 8) {
        const species = TREE_SPECIES[sites[i + 4]] || 'larch';
        const seed = sites[i + 5];
        const x = sites[i];
        const z = sites[i + 2];
        const d = Math.hypot(x - EYE.x, z - EYE.z);
        const entry = {
            x,
            y: groundHeight(x, z) - 0.15,
            z,
            height: sites[i + 3],
            species,
            seed,
            d,
            yaw: seed * Math.PI * 14,
            tone: clamp01(0.5 + Math.sin(x * 0.035 + z * 0.05) * 0.28 + (seed - 0.5) * 0.36),
        };
        // A tree the crest hides from crown to foot is not drawn at all.
        if (!visible(x, entry.y, z, entry.height)) continue;
        if (d < near) {
            const list = SPECIMENS[species];
            const name = list[Math.floor(seed * list.length) % list.length];
            const asset = assets.trees[name];
            if (asset) placements.push({ ...entry, name, scale: entry.height / asset.height });
        } else far.push(entry);
    }
    stats.trees = placements.length;

    // ── Bark, per specimen ──
    const byAsset = new Map();
    placements.forEach((tree) => {
        if (!byAsset.has(tree.name)) byAsset.set(tree.name, []);
        byAsset.get(tree.name).push(tree);
    });
    const dummy = new THREE.Object3D();
    byAsset.forEach((trees, name) => {
        const asset = assets.trees[name];
        const data = new Float32Array(trees.length * 4);
        const treeAttribute = new THREE.InstancedBufferAttribute(data, 4);
        const material = own(barkMaterial(u, t, asset.species, treeAttribute));
        const mesh = new THREE.InstancedMesh(asset.bark, material, trees.length);
        mesh.name = `GrainfieldsBark ${name}`;
        trees.forEach((tree, index) => {
            dummy.position.set(tree.x, tree.y, tree.z);
            dummy.rotation.set(0, tree.yaw, 0);
            dummy.scale.setScalar(tree.scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            data.set([tree.x, tree.y, tree.z, asset.height * tree.scale], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 3;
        meshes.push(mesh);
        // Far trees show no limbs worth their triangles: the stems alone.
        const allFar = trees.every((tree) => tree.d > near * 0.5);
        const drawn = allFar && asset.barkCoreIndices > 0 ? asset.barkCoreIndices : asset.bark.index.count;
        asset.bark.setDrawRange(0, drawn === asset.bark.index.count ? Infinity : drawn);
        borrowed.push(asset.bark);
        stats.barkTriangles += (drawn / 3) * trees.length;
    });

    // ── Sprays, per kind and variant ──
    const buckets = new Map();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const bentNormal = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const { variants } = assets.foliage;
    placements.forEach((tree, treeIndex) => {
        const asset = assets.trees[tree.name];
        const { sites: crownSites } = asset;
        const keep = Math.min(1, sprays * sprayShare(tree.d));
        const grow = (1 / keep) ** 0.36;
        yaw.setFromAxisAngle(UP, tree.yaw);
        for (let i = 0; i < crownSites.count; i += 1) {
            if (keepHash(i, treeIndex + 1) > keep) continue;
            position.fromArray(crownSites.position, i * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
            position.x += tree.x;
            position.y += tree.y;
            position.z += tree.z;
            const size = crownSites.scale[i] * tree.scale * grow;
            if (!visible(position.x, position.y, position.z, size * 1.2)) {
                stats.culled += 1;
                continue;
            }
            const key = `${asset.foliage}_${crownSites.variant[i] % variants}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    kind: asset.foliage, matrices: [], crown: [], bent: [], tree: [],
                });
            }
            const bucket = buckets.get(key);
            rotation.fromArray(crownSites.rotation, i * 4).premultiply(yaw);
            matrix.compose(position, rotation, scale.setScalar(size));
            bucket.matrices.push(...matrix.elements);
            bucket.crown.push(crownSites.sky[i], crownSites.sway[i], crownSites.phase[i], crownSites.hue[i]);
            bentNormal.fromArray(crownSites.bent, i * 3).applyQuaternion(yaw);
            bucket.bent.push(bentNormal.x, bentNormal.y, bentNormal.z, tree.tone);
            bucket.tree.push(tree.x, tree.y, tree.z, asset.height * tree.scale);
        }
    });
    buckets.forEach((bucket, key) => {
        const geometry = assets.foliage.meshes[key];
        if (!geometry) throw new Error(`[Grainfields] Foliage mesh "${key}" is missing from the asset pack.`);
        const count = bucket.matrices.length / 16;
        const buffers = {
            crown: new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4),
            bent: new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4),
            tree: new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4),
        };
        // Variants of one spray differ only in geometry and instance data, but the instance buffers
        // are baked into the node graph, so each draw owns a material.
        const material = own(foliageMaterial(u, t, bucket.kind, buffers));
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = `GrainfieldsFoliage ${key}`;
        mesh.instanceMatrix.array.set(bucket.matrices);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 3;
        meshes.push(mesh);
        stats.sprays += count;
        stats.foliageTriangles += (geometry.index.count / 3) * count;
    });

    // ── The far belts: sprites ──
    const { impostors } = assets;
    const cards = sprites && impostors?.texture && impostors.tiles?.length ? far : [];
    if (cards.length) {
        const bySpecies = {};
        impostors.tiles.forEach((tile) => {
            (bySpecies[tile.species] ||= []).push(tile);
        });
        const geometry = own(new THREE.PlaneGeometry(1, 1, 1, 2));
        geometry.translate(0, 0.5, 0);
        const tileData = new Float32Array(cards.length * 4);
        const lookData = new Float32Array(cards.length * 4);
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, species
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height
        const material = own(spriteMaterial(u, t, impostors, tile, look, coverage));
        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'GrainfieldsFarBelts';
        cards.forEach((card, index) => {
            const list = bySpecies[card.species] || impostors.tiles;
            const pick = list[Math.floor(card.seed * 7.31 * list.length) % list.length];
            const s = card.height / pick.height;
            const width = pick.width * s;
            const height = pick.height * s;
            const flip = card.seed > 0.5;
            const sign = flip ? -1 : 1;
            const face = Math.atan2(EYE.x - card.x, EYE.z - card.z);
            const shift = -pick.trunk * width * sign;
            dummy.position.set(card.x + Math.cos(face) * shift, card.y, card.z - Math.sin(face) * shift);
            dummy.rotation.set(0, face, 0);
            dummy.scale.set(width, height, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            const u0 = pick.x / impostors.atlasWidth;
            const du = pick.pixels / impostors.atlasWidth;
            tileData.set([flip ? u0 + du : u0, flip ? -du : du, card.tone, TREE_SPECIES.indexOf(card.species) / 2], index * 4);
            lookData.set([card.seed, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 3;
        meshes.push(mesh);
        stats.sprites = cards.length;
    }

    return {
        mesh: meshes[0] || null,
        meshes,
        stats,
        update() {},
        dispose() {
            meshes.forEach((mesh) => {
                mesh.removeFromParent();
                mesh.dispose?.();
            });
            owned.forEach((resource) => resource.dispose());
            owned.length = 0;
            borrowed.forEach((geometry) => geometry.setDrawRange(0, Infinity));
            borrowed.length = 0;
        },
    };
}
