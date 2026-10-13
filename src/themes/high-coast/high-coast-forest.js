/**
 * High Coast — the pine forests of the islands, the headland's crown and the far shores.
 *
 * Instanced conifers planted by the baked forest cover: Scots pines (a bare trunk, orange-red
 * toward the top, under a flat, clumped crown) on the rock, Norway spruces (tiered dark cones) in
 * the sheltered hollows. Near trees are single; farther out a tree stands for a small group (the
 * same footprint scaled up), and past the canopy distance the land's own canopy takes over
 * (high-coast-land.js CANOPY). They stand on the land, never in the sea: a tree whose ground
 * the rising sea uncovers was always above it.
 *
 * Lit like the land (sun with the terrain's and the clouds' shadows, sky fill), with light through
 * the crowns' edges when the sun stands behind them, and read through the same air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    max,
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
import {
    EYE, FIELDS, PLACES, clamp as clampJs, mulberry32,
} from './high-coast-core.js';
import { groundByte, groundHeight, inField } from './high-coast-field.js';
import { CANOPY } from './high-coast-land.js';
import { aerial, cloudShadow } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';

/** How far out single trees stand (metres from the eye) before the land's canopy takes over. */
export const FOREST_REACH = CANOPY.to;

/**
 * Where the trees stand: the baked forest cover, sampled by a seeded walk over the frame's sector
 * (a little wider than the widest lens), thinning with distance (far trees are drawn larger).
 */
export function treeSites(fields, count = 12000, seed = 0x7ee5) {
    const random = mulberry32(seed);
    const sites = [];
    const half = 52 * (Math.PI / 180);
    let tries = 0;
    while (sites.length < count && tries < count * 60) {
        tries++;
        // Distance by area: the far sector is huge, so draw distance with a bias toward the eye.
        const d = 60 + (FOREST_REACH - 60) * random() ** 1.35;
        const a = (random() * 2 - 1) * half;
        const x = EYE.x + Math.sin(a) * d;
        const z = EYE.z - Math.cos(a) * d;
        if (!inField(FIELDS.mid, x, z)) continue;
        const forest = groundByte(fields, 'flow', x, z);
        if (forest < 0.12 || random() > forest * 1.15) continue;
        const y = groundHeight(fields, x, z, d < 1500);
        if (y < 2.5) continue;
        const hm = Math.hypot(x - PLACES.hamlet.x, z - PLACES.hamlet.z);
        if (hm < PLACES.hamlet.radius * 0.7) continue;
        // Level enough to stand on (a tree on a cliff face would hang in the air).
        const e = 2.5;
        const slope = Math.max(
            Math.abs(groundHeight(fields, x + e, z) - groundHeight(fields, x - e, z)),
            Math.abs(groundHeight(fields, x, z + e) - groundHeight(fields, x, z - e)),
        ) / (2 * e);
        if (slope > 0.95) continue;
        const group = clampJs(d / 900, 1, 3.2);
        // Pines hold the rock; spruces gather where the forest is thick.
        const spruce = random() < 0.18 + 0.22 * forest ? 1 : 0;
        sites.push({
            x,
            y,
            z,
            kind: spruce ? 1 : 0,
            height: (spruce ? 13 + random() * 9 : 10 + random() * 11) * (0.85 + 0.15 * group),
            width: (spruce ? 7 + random() * 2.5 : 8 + random() * 4) * group,
            seed: random(),
            lean: (random() - 0.5) * 0.08,
            d,
        });
    }
    return sites;
}

/** Merge geometries (non-indexed) and tag each vertex with a part id. */
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

/** A deterministic random for geometry builds. */
const geoRandom = (seed) => mulberry32(seed);

/**
 * A Scots pine (unit height): a trunk most of the way up, a crown of flattened clumps from about
 * half its height, wider on one side (a pine on the coast leans its crown to the light). `clumps`
 * and `detail` set the cost (near: 7 clumps, far: 3).
 */
export function pineGeometry({ clumps = 7, detail = 0, seed = 0x91e } = {}) {
    const r = geoRandom(seed);
    const trunk = new THREE.CylinderGeometry(0.011, 0.024, 0.82, clumps > 4 ? 5 : 3);
    trunk.translate(0, 0.41, 0);
    const parts = [[trunk, 0]];
    for (let k = 0; k < clumps; k++) {
        const top = k === 0;
        const y = top ? 0.9 : 0.56 + 0.34 * r();
        const reach = top ? 0 : 0.08 + 0.16 * r() * (1.2 - (y - 0.56));
        const a = r() * Math.PI * 2;
        const rad = top ? 0.17 : 0.1 + 0.1 * r();
        const blob = new THREE.IcosahedronGeometry(1, detail);
        blob.scale(rad * (1.3 + 0.4 * r()), rad * (0.42 + 0.2 * r()), rad * (1.1 + 0.4 * r()));
        blob.rotateY(a);
        blob.translate(Math.cos(a) * reach + 0.03, y, Math.sin(a) * reach);
        parts.push([blob, 1]);
    }
    return merge(parts);
}

/** A Norway spruce (unit height): a narrow cone of drooping tiers on a short trunk. */
export function spruceGeometry({ tiers = 5, segments = 7 } = {}) {
    const pts = [];
    for (let k = 0; k <= tiers * 2; k++) {
        const s = k / (tiers * 2);
        // A saw-tooth profile: each tier flares out at its foot.
        const tooth = k % 2 === 0 ? 1 : 0.62;
        const rr = (1 - s) ** 1.05 * 0.24 * tooth + 0.004;
        pts.push(new THREE.Vector2(rr, 0.08 + s * 0.92));
    }
    pts.reverse();
    const crown = new THREE.LatheGeometry(pts, segments);
    crown.deleteAttribute('uv');
    crown.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.012, 0.02, 0.12, 4);
    trunk.translate(0, 0.06, 0);
    return merge([[trunk, 0], [crown, 1]]);
}

/** The shared conifer material: kind 0 pine, 1 spruce (by the instance attribute). */
export function conferMaterial(u, t, { instanced = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastConifer';
    material.fog = false;
    const part = attribute('aPart', 'float');
    const tree = instanced ? attribute('aTree', 'vec4') : vec4(0, 0.5, 18, 0);
    // A breath of wind in the crowns (a constant rate; amplitude grows up the tree).
    material.positionNode = Fn(() => {
        const h = positionGeometry.y;
        const sway = sin(u.time.mul(0.75).add(tree.y.mul(37.0))).mul(0.012).mul(h.mul(h));
        return positionLocal.add(vec3(sway, 0.0, sway.mul(0.5)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const kind = tree.x;
        const n = normalize(normalWorld);
        // Needles: clumps of darker and sunlit green on the crown's own surface.
        const clump = texture(t.noise, vec2(P.x.add(P.y.mul(0.8)), P.z.sub(P.y.mul(0.6))).mul(0.42)).a;
        const pineGreen = mix(vec3(0.03, 0.055, 0.025), vec3(0.075, 0.11, 0.04), clump);
        const spruceGreen = mix(vec3(0.016, 0.034, 0.02), vec3(0.04, 0.07, 0.035), clump);
        const needles = mix(pineGreen, spruceGreen, kind).mul(tree.y.mul(0.35).add(0.82));
        // Bark: a Scots pine's trunk is grey-brown below and glows orange-red higher up.
        const up = clamp(positionGeometry.y.div(0.75), 0.0, 1.0);
        const bark = mix(vec3(0.07, 0.05, 0.04), mix(vec3(0.07, 0.05, 0.04), vec3(0.42, 0.15, 0.06), smoothstep(0.35, 0.8, up)), float(1.0).sub(kind));
        const albedo = mix(bark, needles, part);
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.45).div(1.45), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const clouds = cloudShadow(u, t.noise, P);
        const view = normalize(P.sub(u.eye));
        // Light through the needles at the crown's edge when the sun stands behind it.
        const rim = float(1.0).sub(clamp(dot(n, view.negate()), 0.0, 1.0));
        const through = clamp(dot(view, L), 0.0, 1.0).pow(6.0).mul(rim.mul(rim)).mul(1.4)
            .mul(part);
        const direct = u.sun.mul(wrap.mul(0.8).add(through)).mul(shadow).mul(clouds).mul(u.sunUp);
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(0.85);
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.35)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

/** Trees nearer than this get the detailed geometry; farther ones the cheap one. */
export const FOREST_LOD = 650;

export function createForest(u, t, tier, fields) {
    const sites = treeSites(fields, tier.trees);
    const material = conferMaterial(u, t);
    const meshes = [];
    const geometries = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const near = (s) => s.d < FOREST_LOD;
    const groups = [
        [sites.filter((s) => s.kind === 0 && near(s)), pineGeometry({ clumps: 7, detail: 0 }), 'HighCoastPinesNear'],
        [sites.filter((s) => s.kind === 0 && !near(s)), pineGeometry({ clumps: 3, detail: 0, seed: 0x3f1 }), 'HighCoastPinesFar'],
        [sites.filter((s) => s.kind === 1 && near(s)), spruceGeometry({ tiers: 5, segments: 7 }), 'HighCoastSprucesNear'],
        [sites.filter((s) => s.kind === 1 && !near(s)), spruceGeometry({ tiers: 3, segments: 5 }), 'HighCoastSprucesFar'],
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

export { max };
