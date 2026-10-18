/**
 * Spring — the woods of the valley.
 *
 * Thousands of simple trees on the slopes either side of the river, the wooded tongue between
 * its arms and the hills down the valley, planted by the baked forest cover (spring-terrain
 * forestCover / birchShare): Norway spruces, narrow dark spires of drooping tiers, and birches in
 * first leaf, white stems under a loose crown of the yellow-green haze May puts on them, glowing
 * when the sun stands behind. A Norrland hillside is the two mixed: dark spires and pale clouds.
 *
 * Near trees are single; farther out a tree stands for a small group (the same footprint scaled
 * up), and past the woods' reach the land's own canopy takes over (spring-land.js CANOPY). The
 * modelled trees (spring-forest.js) stand nearer the eye. Adapted from High Coast's forest
 * (high-coast-forest.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, clamp as clampJs, mulberry32 } from './spring-core.js';
import { aerial, sunShare } from './spring-light.js';
import { noise3 } from './spring-tsl.js';
import { EYE, PLACES } from './spring-plan.js';
import { fallToWorld } from './spring-fall-plan.js';
import { createImpostorWoods } from './spring-impostors.js';
import {
    birchShare, forestCover, groundHeight, groundNormal, knollOutside, standable, waterEdge,
} from './spring-terrain.js';

/**
 * Where the woods stand: bearings (degrees, wide enough for portrait's turn and the camera's
 * breath), the nearest and farthest tree (m), and where a tree starts standing for a group.
 */
export const WOODS = Object.freeze({
    from: -64, to: 54, nearest: 34, reach: 2300, single: 520, detail: 700, birchFrom: 280,
});
/** The woods sown round the fall: their share of the trees, and the box (m in the fall's frame). */
export const FALL_WOODS = Object.freeze({ share: 0.05, along: Object.freeze([-90, 50]), across: 80 });

/**
 * The trees: the forest cover sampled by a seeded walk over the wedge, thinning with distance
 * (far trees are drawn larger, as groups). Never in the water, on the knoll's meadow or on a cliff.
 */
export function woodSites(baked, count = 10000, seed = 0x3d71, { nearBirches = false } = {}) {
    const random = mulberry32(seed);
    const sites = [];
    const w = {};
    const n = [0, 1, 0];
    const p = {};
    let tries = 0;
    // A share of the trees is sown over the fall's surroundings (its rim and the gorge's slopes),
    // where the wedge's walk, thinning with distance, would leave them bare.
    const fallShare = Math.round(count * FALL_WOODS.share);
    while (sites.length < count && tries < count * 40) {
        tries++;
        let x;
        let z;
        let d;
        if (sites.length < fallShare && tries < fallShare * 30) {
            const along = FALL_WOODS.along[0] + (FALL_WOODS.along[1] - FALL_WOODS.along[0]) * random();
            fallToWorld(along, (random() * 2 - 1) * FALL_WOODS.across, p);
            ({ x, z } = p);
            d = Math.hypot(x - EYE.x, z - EYE.z);
        } else {
            // Distance by area: the far wedge is huge, so draw distance with a bias toward the eye.
            d = WOODS.nearest + (WOODS.reach - WOODS.nearest) * random() ** 1.7;
            const a = (WOODS.from + (WOODS.to - WOODS.from) * random()) * DEG;
            x = EYE.x + Math.sin(a) * d;
            z = EYE.z - Math.cos(a) * d;
        }
        const pick = random();
        const kind = random();
        const r1 = random();
        const r2 = random();
        const r3 = random();
        waterEdge(baked, x, z, w);
        if (w.edge < 3) continue;
        if (knollOutside(x, z) < 6) continue;
        const y = groundHeight(baked, x, z);
        // Level enough to stand on (a tree on a cliff face would hang in the air).
        groundNormal(baked, x, z, n, Math.max(1.5, d * 0.01));
        if (n[1] < standable(x, z)) continue;
        const cover = forestCover(x, z, w.edge, y, PLACES.barn);
        if (pick > cover * 1.15) continue;
        const group = clampJs(d / WOODS.single, 1, 3.4);
        const birch = kind < birchShare(x, z, w.edge, y) ? 1 : 0;
        // Near to, the birches are the modelled ones (spring-forest.js): a simple one would show
        // (a card of a modelled one does not).
        if (birch && !nearBirches && d < WOODS.birchFrom) continue;
        const height = (birch ? 11 + r1 * 7 : 14 + r1 * 10) * (0.9 + 0.1 * group);
        sites.push({
            x,
            y,
            z,
            kind: birch ? 0 : 1,
            height,
            // The geometry carries the tree's proportions: across, the height again, give or take.
            width: height * (0.88 + r2 * 0.24) * group,
            seed: r3,
            lean: (random() - 0.5) * (birch ? 0.12 : 0.05),
            d,
        });
    }
    return sites;
}

/** Merge geometries (non-indexed) and tag each vertex with a part id (0 stem, 1 crown). */
function merge(parts) {
    let count = 0;
    const flat = parts.map(([geo, id]) => {
        const g = geo.index ? geo.toNonIndexed() : geo;
        count += g.attributes.position.count;
        return [g, id, geo];
    });
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const part = new Float32Array(count);
    let o = 0;
    for (const [g, id, src] of flat) {
        pos.set(g.attributes.position.array, o * 3);
        nrm.set(g.attributes.normal.array, o * 3);
        part.fill(id, o, o + g.attributes.position.count);
        o += g.attributes.position.count;
        if (g !== src) g.dispose();
        src.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    return out;
}

/**
 * A birch in first leaf (unit height): a slender white stem, a broad oval crown from a third of
 * the way up made of soft lumps round the stem, the lower ones hanging out and down (a birch's
 * twigs droop), wider on one side. `clumps` and `detail` set the cost.
 */
export function birchGeometry({ clumps = 9, detail = 0, seed = 0xb1c } = {}) {
    const r = mulberry32(seed);
    const stem = new THREE.CylinderGeometry(0.006, 0.013, 0.92, clumps > 5 ? 5 : 3);
    stem.translate(0, 0.46, 0);
    const parts = [[stem, 0]];
    for (let k = 0; k < clumps; k++) {
        const top = k === 0;
        // Up the crown: the top lump, then a ring of lumps that reach out more as they hang lower.
        const t = top ? 1 : r();
        const y = top ? 0.88 : 0.36 + 0.46 * t;
        const reach = top ? 0 : (0.08 + 0.1 * r()) * (1.15 - t * 0.6);
        const a = (k / clumps) * Math.PI * 2 + r() * 0.8;
        const rad = top ? 0.1 : 0.085 + 0.055 * r();
        const blob = new THREE.IcosahedronGeometry(1, detail);
        blob.scale(rad * (1.0 + 0.3 * r()), rad * (1.0 + 0.4 * r()) * (top ? 1.2 : 0.95), rad * (1.0 + 0.3 * r()));
        blob.rotateY(a);
        blob.translate(Math.cos(a) * reach + 0.02, y - (top ? 0 : reach * 0.35), Math.sin(a) * reach);
        parts.push([blob, 1]);
    }
    return merge(parts);
}

/** A Norway spruce (unit height): a narrow cone of drooping tiers on a short trunk. */
export function spruceGeometry({ tiers = 6, segments = 7 } = {}) {
    const pts = [];
    for (let k = 0; k <= tiers * 2; k++) {
        const s = k / (tiers * 2);
        // A saw-tooth profile: each tier flares out at its foot.
        const tooth = k % 2 === 0 ? 1 : 0.6;
        const rr = (1 - s) ** 1.05 * 0.135 * tooth + 0.003;
        pts.push(new THREE.Vector2(rr, 0.06 + s * 0.94));
    }
    pts.reverse();
    const crown = new THREE.LatheGeometry(pts, segments);
    crown.deleteAttribute('uv');
    crown.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.01, 0.018, 0.1, 4);
    trunk.translate(0, 0.05, 0);
    return merge([[trunk, 0], [crown, 1]]);
}

// Linear albedos.
const SPRUCE_DARK = [0.012, 0.026, 0.016];
const SPRUCE_LIT = [0.032, 0.058, 0.03];
const BIRCH_LEAF = [0.09, 0.14, 0.03];
const BIRCH_YOUNG = [0.2, 0.27, 0.055];
const BIRCH_BARK = [0.5, 0.5, 0.46];

/** The woods' material: kind 0 birch, 1 spruce (by the instance attribute). */
export function woodsMaterial(u, tex) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringWoods';
    material.fog = false;
    // A birch's crown is lace near to: holes cut through its lumps (faded out with distance,
    // where they would only shimmer).
    material.alphaTest = 0.5;
    const part = attribute('aPart', 'float');
    const tree = attribute('aTree', 'vec4'); // kind, seed, height, distance
    // A breath of wind in the crowns (a constant rate; more up the tree, more for the birches).
    material.positionNode = Fn(() => {
        const h = positionGeometry.y;
        const give = mix(float(0.022), float(0.01), tree.x);
        const sway = sin(u.time.mul(0.8).add(tree.y.mul(37.0))).mul(give).mul(h.mul(h)).mul(u.gust);
        return positionLocal.add(vec3(sway, 0.0, sway.mul(0.5)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const kind = tree.x;
        const n = normalize(normalWorld);
        const clump = texture(tex.noise, vec2(P.x.add(P.y.mul(0.8)), P.z.sub(P.y.mul(0.6))).mul(0.35)).a;
        const tone = tree.y.mul(0.3).add(0.85);
        // Spruce: near-black green, its new shoots a little lighter on the sunlit tiers.
        const spruce = mix(vec3(...SPRUCE_DARK), vec3(...SPRUCE_LIT), clump);
        // Birch: the young leaves' haze, paler where the clumps thin.
        const birch = mix(vec3(...BIRCH_LEAF), vec3(...BIRCH_YOUNG), clump.mul(0.7).add(tree.y.mul(0.3)));
        const crownAlb = mix(birch, spruce, kind).mul(tone);
        // Stems: a birch's white with dark marks, a spruce's grey-brown.
        const marks = smoothstep(0.55, 0.7, texture(tex.noise, vec2(P.y.mul(0.9), tree.y.mul(7.0))).g);
        const bark = mix(vec3(...BIRCH_BARK).mul(float(1.0).sub(marks.mul(0.8))), vec3(0.06, 0.045, 0.035), kind);
        const albedo = mix(bark, crownAlb, part);
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.45).div(1.45), 0.0, 1.0);
        const view = normalize(P.sub(u.eye));
        // Light through the leaves when the sun stands behind: a birch's crown lights up.
        const rim = float(1.0).sub(clamp(dot(n, view.negate()), 0.0, 1.0));
        const back = clamp(dot(view, L), 0.0, 1.0);
        const b2 = back.mul(back);
        const through = b2.mul(b2).mul(rim.mul(0.6).add(0.4)).mul(mix(float(1.0), float(0.35), kind)).mul(part);
        const share = sunShare(u, P);
        const direct = u.sun.mul(wrap.mul(0.8)).mul(share);
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(0.9);
        // Light through the leaves comes out a soft yellow-green, not the leaves' own deep colour.
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.35)))
            .add(vec3(0.16, 0.2, 0.06).mul(u.sun).mul(through).mul(share));
        const lacy = float(1.0).sub(kind).mul(part).mul(float(1.0).sub(smoothstep(140.0, 420.0, tree.w)));
        const holes = float(1.0).sub(smoothstep(0.3, 0.4, noise3(tex.lattice, P.mul(1.7)).x));
        return vec4(aerial(u, P, lit), float(1.0).sub(holes.mul(lacy)));
    })();
    return material;
}

/**
 * The woods: cards of the modelled trees from the impostor atlas when there is one
 * (spring-impostors.js), else the simple trees below.
 */
export function createWoods(u, tex, tier, baked, { atlas = null, samples = 0 } = {}) {
    if (atlas?.layout.cells.length) {
        return createImpostorWoods(u, atlas, woodSites(baked, tier.woods, 0x3d71, { nearBirches: true }), { samples });
    }
    const sites = woodSites(baked, tier.woods);
    const material = woodsMaterial(u, tex);
    const meshes = [];
    const geometries = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const near = (s) => s.d < WOODS.detail;
    const groups = [
        [sites.filter((s) => s.kind === 0 && near(s)), birchGeometry({ clumps: 11, detail: 1 }), 'SpringBirchesNear'],
        [
            sites.filter((s) => s.kind === 0 && !near(s)),
            birchGeometry({ clumps: 5, detail: 0, seed: 0x3f1 }),
            'SpringBirchesFar',
        ],
        [sites.filter((s) => s.kind === 1 && near(s)), spruceGeometry({ tiers: 7, segments: 7 }), 'SpringSprucesNear'],
        [sites.filter((s) => s.kind === 1 && !near(s)), spruceGeometry({ tiers: 4, segments: 5 }), 'SpringSprucesFar'],
    ];
    for (const [list, geometry, name] of groups) {
        const data = new Float32Array(Math.max(1, list.length) * 4);
        list.forEach((s, i) => data.set([s.kind, s.seed, s.height, s.d], i * 4));
        geometry.setAttribute('aTree', new THREE.InstancedBufferAttribute(data, 4));
        const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
        mesh.name = name;
        list.forEach((s, i) => {
            e.set(s.lean, s.seed * 6.283, s.lean * 0.6);
            q.setFromEuler(e);
            sc.set(s.width, s.height, s.width * (0.85 + 0.3 * s.seed));
            pos.set(s.x, s.y - 0.4, s.z);
            m.compose(pos, q, sc);
            mesh.setMatrixAt(i, m);
        });
        // A pool may be empty on a small tier: one collapsed instance keeps the draw (and its pipeline).
        if (!list.length) {
            m.makeScale(0, 0, 0);
            mesh.setMatrixAt(0, m);
        }
        mesh.count = Math.max(1, list.length);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 2;
        meshes.push(mesh);
        geometries.push(geometry);
    }
    return {
        mesh: meshes[0],
        meshes,
        sites,
        update() {},
        dispose() {
            for (const g of geometries) g.dispose();
            material.dispose();
            for (const mesh of meshes) mesh.dispose?.();
        },
    };
}
