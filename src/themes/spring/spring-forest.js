/**
 * Spring — the birches and the spruces near the river.
 *
 * The trees are authored in Blender (spring-assets.js): bark meshes instanced per specimen,
 * and every spray of leaves or needles of every tree one instance in a handful of shared draws.
 * The birches are in first leaf: small young leaves, sparse enough that their purple-brown
 * twigs show through, a yellow-green haze that glows where the sun stands behind it. The spruces
 * carry their pale new shoots at the tips. The trees stand where the valley's forest cover says
 * (spring-terrain forestCover / birchShare), never on the knoll's flowering top or in the water,
 * the nearest and the ones in frame first; beyond the modelled trees the land's canopy carries
 * the forest; the tall weeping birch (birch-hero) is one of the grove's birches.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    instancedBufferAttribute,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { aerial } from './spring-light.js';
import { EYE, PLACES, bearingOf } from './spring-plan.js';
import { fallToWorld, worldToFall } from './spring-fall-plan.js';
import {
    birchShare, forestCover, groundHeight, groundNormal, knollOutside, standable, waterEdge,
} from './spring-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Trees placed by hand: a birch and a spruce on the rim of the step, either side of the fall,
 * standing over its brink against the sky. (No tree frames the picture: framing trees are the
 * fleet's commonest device; see the theme catalogue's Part 0.) Placed in the fall's frame
 * (metres along the river from the lip, across it).
 */
export const FEATURE_TREES = Object.freeze([
    Object.freeze({
        asset: 'birch-grove-c', along: -14, across: 25, yaw: 2.2, scale: 1.0, tone: 0.45,
    }),
    Object.freeze({
        asset: 'spruce-hero', along: -14.5, across: -23, yaw: 1.0, scale: 1.0, tone: 0.4,
    }),
].map((tree) => Object.freeze({ ...tree, ...fallToWorld(tree.along, tree.across) })));

const BIRCHES = ['birch-grove-a', 'birch-grove-b', 'birch-grove-c', 'birch-hero'];
const SPRUCES = ['spruce-grove-a', 'spruce-grove-b', 'spruce-grove-c'];
/** The view's wedge (degrees) and how far modelled trees reach (m). */
const WEDGE = Object.freeze({ from: -66, to: 60 });
const REACH = Object.freeze({ near: 14, far: 330, lod: 90 });

/**
 * The leaves' level of detail. A leaf of the weeping birch's sprays (six centimetres) is a fan
 * of 18 triangles round its outline, and those sprays were most of the forest's triangles.
 * From the knoll the nearest modelled tree stands seventy metres off and the nearest weeping
 * birch eighty, where a leaf is a pixel or two across even in a 1600-pixel frame and its outline
 * cannot show. Past `from` metres a tree's leaves are drawn from every `stride`-th point of their
 * outline: the stalk, the tip and the two corners at the stalk, two triangles grown about the
 * stalk to the leaf's own area, so the crown keeps every leaf, its placing, colouring and light.
 * A spray's twig (a three-sided tube, millimetres thick) keeps its first, middle and last rings.
 * Fans of fewer than `minTriangles` (the grove birches' strand leaves, four), open strips (the
 * spruces' shoots, whose taper shows) and anything else are kept as they are; the impostor
 * atlas's bake draws every spray whole. Captured against the full leaves, the frame and five-fold
 * close-ups of the crowns differ only in single pixels at the leaves' edges.
 */
export const LEAF_LOD = Object.freeze({ from: 40, stride: 9, minTriangles: 8 });

/** Twice the area of a triangle given by three vertex indices into a flat xyz array. */
function doubleArea(p, a, b, c) {
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * A fan (an island whose triangles all share one vertex, its hub, and run round it in one open
 * chain) redrawn from every `stride`-th point of its outline, the first and last always kept, the
 * kept points pushed out from the hub so it keeps its area. Writes into `out` and `moved`; false
 * (nothing written) when the island is not such a fan.
 */
function thinFan(tris, index, position, moved, out, stride) {
    const a = index[tris[0]];
    const b = index[tris[0] + 1];
    const c = index[tris[0] + 2];
    const has = (t, v) => index[t] === v || index[t + 1] === v || index[t + 2] === v;
    const hub = [a, b, c].find((v) => tris.every((t) => has(t, v)));
    if (hub === undefined) return false;
    // Each triangle as (hub, from, to) in its own winding; the outline is the chain from → to.
    const next = new Map();
    const into = new Set();
    for (const t of tris) {
        let k = 2;
        if (index[t] === hub) k = 0;
        else if (index[t + 1] === hub) k = 1;
        const from = index[t + ((k + 1) % 3)];
        if (next.has(from)) return false;
        next.set(from, index[t + ((k + 2) % 3)]);
        into.add(index[t + ((k + 2) % 3)]);
    }
    const starts = [...next.keys()].filter((v) => !into.has(v));
    if (starts.length !== 1) return false;
    const outline = [starts[0]];
    while (next.has(outline[outline.length - 1]) && outline.length <= tris.length) {
        outline.push(next.get(outline[outline.length - 1]));
    }
    if (outline.length !== tris.length + 1) return false;
    const last = outline.length - 1;
    const kept = [];
    for (let i = 0; i < last; i += stride) kept.push(outline[i]);
    // The last point is always kept; a short last step folds into it.
    if (last - (kept.length - 1) * stride < stride / 2 && kept.length > 2) kept.pop();
    kept.push(outline[last]);
    let full = 0;
    for (let i = 0; i < last; i += 1) full += doubleArea(position, hub, outline[i], outline[i + 1]);
    let thin = 0;
    for (let i = 0; i + 1 < kept.length; i += 1) thin += doubleArea(position, hub, kept[i], kept[i + 1]);
    const grow = thin > 1e-12 ? Math.sqrt(full / thin) : 1;
    for (const v of kept) {
        for (let k = 0; k < 3; k += 1) {
            moved[v * 3 + k] = position[hub * 3 + k] + (position[v * 3 + k] - position[hub * 3 + k]) * grow;
        }
    }
    for (let i = 0; i + 1 < kept.length; i += 1) out.push(hub, kept[i], kept[i + 1]);
    return true;
}

/**
 * A closed tube of `side`-vertex rings stored one after another (ring k is the island's vertices
 * side·k … side·k + side − 1, every ring joined to the next by 2·side triangles) redrawn from its
 * first, middle and last rings: each kept ring is joined straight to the next kept one by the
 * triangles that joined it to its neighbour. False (nothing written) for anything else.
 */
function thinTube(tris, index, out, side = 3) {
    let first = Infinity;
    let top = -Infinity;
    for (const t of tris) {
        for (let k = 0; k < 3; k += 1) {
            first = Math.min(first, index[t + k]);
            top = Math.max(top, index[t + k]);
        }
    }
    const count = top - first + 1;
    const rings = count / side;
    if (!Number.isInteger(rings) || rings < 4 || tris.length !== 2 * side * (rings - 1)) return false;
    const segments = new Map();
    for (const t of tris) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < 3; k += 1) {
            const ring = Math.floor((index[t + k] - first) / side);
            lo = Math.min(lo, ring);
            hi = Math.max(hi, ring);
        }
        if (hi !== lo + 1) return false;
        if (!segments.has(lo)) segments.set(lo, []);
        segments.get(lo).push(t);
    }
    for (let ring = 0; ring + 1 < rings; ring += 1) {
        if ((segments.get(ring)?.length ?? 0) !== 2 * side) return false;
    }
    const kept = [0, Math.round((rings - 1) / 2), rings - 1];
    for (let i = 0; i + 1 < kept.length; i += 1) {
        const shift = (kept[i + 1] - kept[i] - 1) * side;
        for (const t of segments.get(kept[i])) {
            for (let k = 0; k < 3; k += 1) {
                const v = index[t + k];
                out.push(Math.floor((v - first) / side) === kept[i] ? v : v + shift);
            }
        }
    }
    return true;
}

/**
 * Thin a spray (three-free): its leaf fans (thinFan) and its twig tubes (thinTube) as LEAF_LOD
 * says; every other island is kept as it is. Returns a new index array and a copy of the
 * positions (only kept fan outline points move; every other attribute can be shared).
 */
export function thinSpray(index, position, { stride = LEAF_LOD.stride, minTriangles = LEAF_LOD.minTriangles } = {}) {
    const vertexCount = position.length / 3;
    const parent = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) parent[i] = i;
    const find = (x) => {
        let r = x;
        while (parent[r] !== r) {
            parent[r] = parent[parent[r]];
            r = parent[r];
        }
        return r;
    };
    const join = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
    };
    for (let t = 0; t < index.length; t += 3) {
        join(index[t], index[t + 1]);
        join(index[t + 1], index[t + 2]);
    }
    const islands = new Map();
    for (let t = 0; t < index.length; t += 3) {
        const root = find(index[t]);
        if (!islands.has(root)) islands.set(root, []);
        islands.get(root).push(t);
    }
    const out = [];
    const moved = new Float32Array(position);
    islands.forEach((tris) => {
        if (tris.length >= minTriangles && thinFan(tris, index, position, moved, out, stride)) return;
        if (thinTube(tris, index, out)) return;
        for (const t of tris) out.push(index[t], index[t + 1], index[t + 2]);
    });
    return { index: out, position: moved };
}

/**
 * The far-leaf version of a spray (LEAF_LOD), made once per spray mesh and kept with it: the
 * same vertices (normals, colours and uvs shared), the leaves' outlines and the twig thinned. The
 * spray itself when thinning would not save anything.
 */
export function leafLod(geometry) {
    if (!geometry?.index) return geometry;
    if (geometry.userData.leafLod) return geometry.userData.leafLod;
    const { index, position } = thinSpray(geometry.index.array, geometry.attributes.position.array);
    let lod = geometry;
    if (index.length < geometry.index.count) {
        lod = new THREE.BufferGeometry();
        Object.entries(geometry.attributes).forEach(([key, value]) => {
            if (key !== 'position') lod.setAttribute(key, value);
        });
        lod.setAttribute('position', new THREE.BufferAttribute(position, 3));
        const IndexArray = geometry.index.array.constructor;
        lod.setIndex(new THREE.BufferAttribute(new IndexArray(index), 1));
        lod.computeBoundingSphere();
        lod.name = `${geometry.name || 'spray'} (far leaves)`;
    }
    geometry.userData.leafLod = lod;
    return lod;
}

function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Lay the trees out: the feature trees, then a grove over the valley's forest cover, nearest and
 * in-frame first, up to `count` trees in all. Deterministic for a seed.
 */
export function layoutForest(baked, assets, count, seed = 0x7f31) {
    const random = mulberry32(seed);
    const has = (name) => !assets || Boolean(assets.trees?.[name]);
    const placed = FEATURE_TREES.filter((t) => has(t.asset)).map((t) => ({
        ...t, y: groundHeight(baked, t.x, t.z) - 0.1, far: false,
    }));
    const candidates = [];
    const spacing = 7.5;
    const n = [0, 1, 0];
    const w = {};
    for (let z = -580; z < -12; z += spacing) {
        for (let x = -330; x < 330; x += spacing) {
            const jx = x + (random() - 0.5) * spacing * 0.9;
            const jz = z + (random() - 0.5) * spacing * 0.9;
            const pick = random();
            const variety = random();
            const turn = random();
            const size = random();
            const d = Math.hypot(jx - EYE.x, jz - EYE.z);
            const b = bearingOf(jx, jz);
            if (b < WEDGE.from || b > WEDGE.to || d < REACH.near || d > REACH.far) continue;
            if (knollOutside(jx, jz) < 4) continue;
            waterEdge(baked, jx, jz, w);
            if (w.edge < 2.5) continue;
            const h = groundHeight(baked, jx, jz);
            groundNormal(baked, jx, jz, n, 1.5);
            if (n[1] < standable(jx, jz) + 0.06) continue;
            const cover = forestCover(jx, jz, w.edge, h, PLACES.barn);
            if (pick > cover) continue;
            const birch = variety < birchShare(jx, jz, w.edge, h);
            const list = birch ? BIRCHES : SPRUCES;
            const asset = list[Math.floor(turn * list.length) % list.length];
            if (!has(asset)) continue;
            const inFrame = Math.abs(b) < 38 ? 1.6 : 1;
            candidates.push({
                asset,
                x: jx,
                y: h - 0.15,
                z: jz,
                yaw: turn * Math.PI * 2,
                scale: (birch ? 0.8 : 0.85) + size * 0.4,
                tone: random(),
                far: d > REACH.lod,
                score: (inFrame * cover) / Math.max(30, d),
            });
        }
    }
    candidates.sort((p, q) => q.score - p.score);
    // A third of the trees stand round the fall (its rim and the gorge's slopes), however far it
    // is: it is where the eye goes. The rest go nearest first.
    const room = Math.max(0, count - placed.length);
    const f = {};
    const byFall = (c) => {
        worldToFall(c.x, c.z, f);
        return f.along > -60 && f.along < 45 && Math.abs(f.across) < 70;
    };
    const fall = candidates.filter(byFall).slice(0, Math.round(room / 3));
    const chosen = new Set(fall);
    const rest = candidates.filter((c) => !chosen.has(c)).slice(0, room - fall.length);
    return [...placed, ...fall, ...rest];
}

// Linear albedos.
const LEAF_RAMP = Object.freeze({
    birch: [[0.12, 0.2, 0.035], [0.26, 0.4, 0.07], [0.44, 0.58, 0.13]],
    spruce: [[0.012, 0.03, 0.016], [0.03, 0.065, 0.028], [0.06, 0.11, 0.04]],
});
const SHOOT = [0.22, 0.38, 0.09];
const TWIG = [0.055, 0.038, 0.034];
/** How leaves answer the light and the wind, by species. */
const LOOK = Object.freeze({
    birch: {
        flutter: [0.06, 0.02], glow: [1.25, 1.5, 0.35], through: 0.85, sun: 0.38, ambient: 1.0,
    },
    spruce: {
        flutter: [0.025, 0.006], glow: [1.4, 1.2, 0.3], through: 0.6, sun: 0.6, ambient: 1.05,
    },
});

function ramp(stops, t) {
    const k = clamp(t, 0.0, 1.0).mul(stops.length - 1);
    let out = vec3(...stops[0]);
    for (let i = 1; i < stops.length; i += 1) out = mix(out, vec3(...stops[i]), smoothstep(i - 1, i, k));
    return out;
}

/** The breeze leaning a tree: more the higher up, in the wind's direction. */
function treeSway(u, tree, phase, sway) {
    const height = clamp(positionLocal.y.sub(tree.y).div(max(tree.w, 1.0)), 0.0, 1.0);
    const swing = sin(u.time.mul(0.85).add(tree.x.mul(0.13)).add(tree.z.mul(0.07)).add(phase.mul(6.283)))
        .mul(0.5).add(0.5).mul(sway.mul(0.6).add(0.4))
        .mul(u.gust)
        .mul(0.22);
    return vec3(0.86, 0.0, -0.5).mul(swing.mul(height.mul(height)));
}

/**
 * What a bake pass writes for a surface (spring-impostors.js): its albedo (square-rooted, so the
 * dark greens keep their steps in eight bits) and coverage, or its normal as the bake's camera
 * sees it (toward the camera +z, which is world +z: the camera is square to the axes), with its
 * occlusion and how far it is a leaf the sun shines through.
 */
function bakeOutput(pass, albedo, N, occlusion, leaf) {
    const n = N.mul(select(N.z.lessThan(0.0), float(-1.0), float(1.0)));
    const normals = vec4(n.xy.mul(0.5).add(0.5), occlusion, leaf);
    return select(pass.greaterThan(0.5), normals, vec4(albedo.max(0.0).sqrt(), 1.0));
}

export class SpringForest {
    /**
     * `bake` ({ pass }: a uniform, 0 albedo, 1 normals): build the trees for the impostor atlas
     * (spring-impostors.js) instead: placed as given, every spray kept, still, unlit.
     */
    constructor(u, tex, assets, tier, { bake = null } = {}) {
        this.u = u;
        this.tex = tex;
        this.assets = assets;
        this.tier = tier;
        this.bake = bake;
        this.group = new THREE.Group();
        this.group.name = bake ? 'SpringForestBake' : 'SpringForest';
        this.owned = [];
        this.stats = {
            trees: 0, sprays: 0, foliageTriangles: 0, barkTriangles: 0,
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build(baked) {
        return this.buildPlacements(layoutForest(baked, this.assets, this.tier.trees ?? 60));
    }

    /** Build these trees ({ asset, x, y, z, yaw, scale, tone, far } each). */
    buildPlacements(placements) {
        this.placements = placements;
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildFoliage();
        return this;
    }

    createBarkMaterial(species, treeAttribute) {
        const { u, tex, bake } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = species === 'birch' ? 'SpringBirchBark' : 'SpringSpruceBark';
        if (bake) material.name += ' (bake)';
        const tree = instancedBufferAttribute(treeAttribute);
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, species mask
        material.positionNode = bake ? positionLocal : positionLocal.add(treeSway(u, tree, paint.g, paint.r));
        material.colorNode = Fn(() => {
            const st = uv();
            const grain = texture(tex.noise, st.mul(vec2(0.35, 0.19)));
            const fine = texture(tex.noise, st.mul(vec2(1.1, 0.5)).add(grain.rg.mul(0.1)));
            let albedo;
            if (species === 'birch') {
                // Paper-white bark banded with dark lenticels; dark and rough at the foot and on
                // every twig.
                const paper = mix(vec3(0.5, 0.48, 0.43), vec3(0.78, 0.77, 0.72), grain.r.mul(0.6).add(fine.g.mul(0.4)));
                const dashes = texture(tex.noise, st.mul(vec2(0.2, 1.9)).add(vec2(grain.b.mul(0.1), 0.0)));
                const lenticel = smoothstep(0.62, 0.72, dashes.g.mul(0.62).add(dashes.a.mul(0.38)));
                const white = mix(paper, vec3(0.03, 0.025, 0.022), clamp(lenticel.mul(0.75), 0.0, 1.0));
                const rough = mix(vec3(0.012, 0.009, 0.008), vec3(0.07, 0.052, 0.04), fine.r);
                albedo = mix(white, rough, smoothstep(0.3, 0.8, paint.a.add(fine.b.sub(0.5).mul(0.3))));
            } else {
                const plates = texture(tex.noise, st.mul(vec2(1.3, 0.6))).g;
                const scale = smoothstep(0.36, 0.7, plates.mul(0.6).add(fine.b.mul(0.4)));
                const scaled = mix(vec3(0.02, 0.014, 0.01), vec3(0.11, 0.08, 0.06), scale)
                    .mul(grain.r.mul(0.5).add(0.72));
                const lichen = mix(vec3(0.1, 0.12, 0.06), vec3(0.3, 0.32, 0.22), fine.a);
                albedo = mix(scaled, lichen, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))));
            }
            const N = normalize(normalWorld);
            const occlusion = paint.b.mul(0.85).add(0.15);
            if (bake) return bakeOutput(bake.pass, albedo, N, occlusion, float(0.0));
            const L = u.sunDir;
            const V = normalize(u.eye.sub(positionWorld));
            const rim = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 3.0)
                .mul(clamp(dot(V, L).negate().mul(0.6).add(0.5), 0.0, 1.0));
            const lit = albedo.mul(u.sun.mul(u.sunUp)).mul(max(dot(N, L), 0.0).mul(0.45).add(rim.mul(0.35)))
                .add(albedo.mul(u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(0.3))).mul(occlusion).mul(1.1));
            return vec4(aerial(u, positionWorld, lit), 1.0);
        })();
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
            const treeAttribute = new THREE.InstancedBufferAttribute(data, 4);
            const material = this.createBarkMaterial(asset.species, treeAttribute);
            const mesh = new THREE.InstancedMesh(asset.bark, material, trees.length);
            mesh.name = `SpringBark ${name}`;
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
            mesh.renderOrder = 2;
            // The tier may stop drawing a tree's limbs (they come last in its index buffer). A bake
            // leaves the shared geometry's range as the forest set it.
            let drawn = asset.bark.index.count;
            const core = asset.barkCoreIndices;
            if (!this.tier.limbs && core > 0 && core < drawn) drawn = core;
            if (!this.bake) asset.bark.setDrawRange(0, drawn === asset.bark.index.count ? Infinity : drawn);
            this.group.add(mesh);
            this.stats.barkTriangles += (drawn / 3) * trees.length;
        });
    }

    createFoliageMaterial(kind, buffers) {
        const { u, bake } = this;
        const species = kind.startsWith('spruce') ? 'spruce' : 'birch';
        const look = LOOK[species];
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = `SpringFoliage ${kind}${bake ? ' (bake)' : ''}`;
        const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
        const bent = instancedBufferAttribute(buffers.bent); // bent normal xyz, tree tone
        const tree = instancedBufferAttribute(buffers.tree); // base xyz, height
        const paint = attribute('color', 'vec4'); // tip weight, leaf id, shade, leaf (1) or wood (0)
        const flutter = sin(u.time.mul(paint.g.mul(3.0).add(5.0)).add(paint.g.mul(41.0)).add(crown.z.mul(13.0)))
            .mul(paint.r).mul(paint.a).mul(u.gust.mul(look.flutter[0]).add(look.flutter[1]));
        material.positionNode = bake ? positionLocal : positionLocal.add(treeSway(u, tree, crown.z, crown.y))
            .add(vec3(0.43, 0.7, -0.25).mul(flutter));
        material.colorNode = Fn(() => {
            const world = positionWorld;
            const V = normalize(u.eye.sub(world));
            const blade = normalize(normalWorld);
            const N = normalize(mix(blade, bent.xyz, 0.65));
            const L = u.sunDir;
            const tone = clamp(bent.w.mul(0.6).add(crown.w.sub(0.5).mul(0.26)).add(paint.g.sub(0.5).mul(0.22))
                .add(crown.x.mul(0.22)), 0.0, 1.0);
            let leaf = ramp(LEAF_RAMP[species], tone);
            // The spruce's new shoots: pale green at the tips.
            if (species === 'spruce') leaf = mix(leaf, vec3(...SHOOT), smoothstep(0.65, 0.95, paint.r).mul(0.75));
            const albedo = mix(vec3(...TWIG), leaf, paint.a).mul(paint.b);
            if (bake) {
                const throughLeaf = paint.a.mul(paint.r.mul(0.6).add(0.4));
                return bakeOutput(bake.pass, albedo, N, crown.x.mul(0.8).add(0.2), throughLeaf);
            }
            // Sun through a young leaf is a clear yellow-green.
            const glowing = pow(leaf, vec3(0.62)).mul(vec3(...look.glow));
            const facing = dot(blade, L);
            const wrap = clamp(dot(N, L).mul(0.6).add(0.4), 0.0, 1.0);
            const front = albedo.mul(wrap).mul(clamp(facing.abs().mul(2.2).add(0.45), 0.0, 1.0));
            const through = pow(clamp(dot(V, L).negate(), 0.0, 1.0), 4.0);
            const back = glowing.mul(paint.a).mul(paint.r.mul(0.6).add(0.4))
                .mul(through.mul(look.through).add(clamp(facing.negate(), 0.0, 1.0).mul(0.3)))
                .mul(crown.x.mul(0.6).add(0.4));
            const occlusion = crown.x.mul(0.8).add(0.2);
            const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(0.25));
            const lit = front.add(back).mul(u.sun.mul(u.sunUp)).mul(look.sun)
                .add(albedo.mul(sky).mul(occlusion).mul(look.ambient));
            return vec4(aerial(u, world, lit), 1.0);
        })();
        return material;
    }

    buildFoliage() {
        const buckets = new Map();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const yaw = new THREE.Quaternion();
        const bentNormal = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const { variants } = this.assets.foliage;
        const keepNear = this.bake ? 1 : this.tier.foliage ?? 0.8;
        this.placements.forEach((tree, treeIndex) => {
            const asset = this.assets.trees[tree.asset];
            const { sites } = asset;
            const keep = this.bake ? 1
                : Math.min(1, keepNear * (tree.far ? 0.6 : 1) * (asset.role === 'hero' ? 0.75 : 1));
            const grow = (1 / keep) ** 0.36;
            // (A bake's trees draw every leaf whole.)
            const thin = !this.bake && Math.hypot(tree.x - EYE.x, tree.z - EYE.z) > LEAF_LOD.from;
            yaw.setFromAxisAngle(UP, tree.yaw);
            for (let i = 0; i < sites.count; i += 1) {
                if (keepHash(i, treeIndex + 1) > keep) continue;
                position.fromArray(sites.position, i * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
                position.x += tree.x;
                position.y += tree.y;
                position.z += tree.z;
                // Sprays behind the eye are never seen (a bake's trees stand off by themselves).
                const b = bearingOf(position.x, position.z);
                if (!this.bake && (b < WEDGE.from - 8 || b > WEDGE.to + 8)) continue;
                const size = sites.scale[i] * tree.scale * grow;
                const mesh = `${asset.foliage}_${sites.variant[i] % variants}`;
                const key = thin ? `${mesh} far` : mesh;
                if (!buckets.has(key)) {
                    buckets.set(key, {
                        kind: asset.foliage, mesh, thin, matrices: [], crown: [], bent: [], tree: [],
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
            }
        });
        buckets.forEach((bucket, key) => {
            const spray = this.assets.foliage.meshes[bucket.mesh];
            if (!spray) throw new Error(`[Spring] Foliage mesh "${bucket.mesh}" is missing from the asset pack.`);
            const geometry = bucket.thin ? leafLod(spray) : spray;
            const count = bucket.matrices.length / 16;
            const buffers = {
                crown: new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4),
                bent: new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4),
                tree: new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4),
            };
            const material = this.createFoliageMaterial(bucket.kind, buffers);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `SpringFoliage ${key}`;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.renderOrder = 2;
            this.group.add(mesh);
            this.stats.sprays += count;
            this.stats.foliageTriangles += (geometry.index.count / 3) * count;
        });
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
