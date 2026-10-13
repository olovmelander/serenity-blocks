/**
 * High Coast — the things near the eye: the old pine, the trail sign, boulders and heath.
 *
 *  - The old Scots pine on the knoll left of the eye (high-coast-pine.js): it stands on rock the
 *    frame shows, its crown reaching out over the top left of the view.
 *  - The trail sign beside it: a weathered post with a board carved HÖGA KUSTEN and an arrow
 *    board VÄRLDSARV pointing out over the coast (the letters a baked distance field).
 *  - Lichen-crusted granite boulders on the summit, and tufts of heather, crowberry and reindeer
 *    lichen in its hollows.
 *
 * Everything stands on the land it is drawn over (its base sunk a little into the rock), is lit
 * like the land (sun, the terrain's shadow, sky fill) and read through the same air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    fwidth,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EYE, PLACES, mulberry32 } from './high-coast-core.js';
import { groundHeight } from './high-coast-field.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import { createPine } from './high-coast-pine.js';
import { bakeSignField } from './high-coast-sign.js';
import { simplex } from './high-coast-plan.js';

// ── The trail sign ────────────────────────────────────────────────────────────────

/** Board sizes (metres) and their texts. */
export const SIGN = Object.freeze({
    post: { w: 0.12, h: 2.05 },
    boards: Object.freeze([
        Object.freeze({
            text: 'HÖGA KUSTEN', w: 1.46, h: 0.3, y: 1.62, arrow: 0,
        }),
        Object.freeze({
            text: 'VÄRLDSARV', w: 1.12, h: 0.24, y: 1.2, arrow: 0.18,
        }),
    ]),
    texture: { w: 512, h: 96 },
});

function signTexture() {
    const { w, h } = SIGN.texture;
    const data = new Uint8Array(w * h * 2 * 4);
    SIGN.boards.forEach((b, k) => {
        const field = bakeSignField(b.text, w, h);
        for (let i = 0; i < w * h; i++) {
            data[(k * w * h + i) * 4] = field[i];
            data[(k * w * h + i) * 4 + 3] = 255;
        }
    });
    const tex = new THREE.DataTexture(data, w, h * 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'high-coast-sign';
    tex.needsUpdate = true;
    return tex;
}

/** A board's outline (a rectangle, or with an arrow point on the right) as an extruded shape. */
function boardGeometry(board) {
    const s = new THREE.Shape();
    const { w, h, arrow } = board;
    s.moveTo(0, 0);
    s.lineTo(w - arrow, 0);
    if (arrow > 0) s.lineTo(w, h / 2);
    s.lineTo(w - arrow, h);
    s.lineTo(0, h);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, {
        depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1,
    });
    geo.translate(-0.08, -h / 2, 0.06);
    return geo;
}

function signMaterial(u, t, letters, k = 0) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = `HighCoastSign${k}`;
    material.fog = false;
    const board = k >= 0 ? SIGN.boards[k] : null;
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const grain = texture(t.noise, vec2(P.x.add(P.z).mul(1.2), P.y.mul(24.0))).a;
        const plank = mix(vec3(0.12, 0.08, 0.05), vec3(0.24, 0.17, 0.1), grain);
        // Weathered: silver-grey toward the edges and on the top, where the rain sits.
        const silver = mix(plank, vec3(0.3, 0.29, 0.27), smoothstep(0.55, 0.9, texture(t.noise, P.xz.mul(3.0).add(P.y)).g).mul(0.6));
        let albedo = silver;
        if (board) {
            // An extruded shape keeps its shape coordinates as uv (metres along the board, up it).
            const st = uv();
            const bu = st.x.div(board.w);
            const bv = st.y.div(board.h);
            const front = smoothstep(0.5, 0.8, dot(n, normalize(u.eye.sub(P))));
            const sample = texture(letters, vec2(bu, bv.add(k).div(2.0))).r;
            const w = fwidth(sample).max(0.004);
            const ink = smoothstep(float(0.5).sub(w), float(0.5).add(w), sample).mul(front);
            // Carved and painted: cream letters with a darker groove edge.
            const edge = smoothstep(0.35, 0.5, sample).sub(ink).max(0.0);
            albedo = mix(silver.mul(float(1.0).sub(edge.mul(0.6))), vec3(0.72, 0.68, 0.56), ink);
        }
        const L = u.sunDir;
        const ndl = clamp(dot(n, L), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(ndl).mul(shadow).mul(u.sunUp).add(u.fill.mul(n.y.mul(0.3).add(0.7)))
            .add(u.bounce.mul(0.5)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── Boulders and heath ────────────────────────────────────────────────────────────

/** Where the boulders and heath tufts lie: on the summit rock the frame shows. */
export function nearSites(fields, { boulders = 34, tufts = 240, seed = 0xb01d } = {}) {
    const random = mulberry32(seed);
    const rocks = [];
    const heath = [];
    const keepClear = (x, z, r) => Math.hypot(x - PLACES.pine.x, z - PLACES.pine.z) < 1.4 + r
        || Math.hypot(x - PLACES.sign.x, z - PLACES.sign.z) < 1.2 + r;
    let tries = 0;
    while (rocks.length < boulders && tries++ < boulders * 80) {
        const a = (random() * 2 - 1) * 46 * (Math.PI / 180);
        const d = 7 + 40 * random() ** 1.4;
        const x = EYE.x + Math.sin(a) * d;
        const z = EYE.z - Math.cos(a) * d;
        const y = groundHeight(fields, x, z, true);
        const r = 0.22 + random() ** 2.4 * 0.95;
        if (y < 138 || keepClear(x, z, r)) continue;
        if (rocks.some((b) => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 1.15)) continue;
        rocks.push({
            x, y, z, r, seed: random(), yaw: random() * 6.283, squash: 0.55 + random() * 0.3,
        });
    }
    tries = 0;
    // Heath grows in drifts: pick a few centres, then tufts round them.
    const centres = Array.from({ length: 16 }, () => {
        const a = (random() * 2 - 1) * 48 * (Math.PI / 180);
        const d = 6 + 34 * random();
        return [EYE.x + Math.sin(a) * d, EYE.z - Math.cos(a) * d];
    });
    while (heath.length < tufts && tries++ < tufts * 40) {
        const c = centres[Math.floor(random() * centres.length)];
        const x = c[0] + (random() - 0.5) * 7;
        const z = c[1] + (random() - 0.5) * 7;
        const y = groundHeight(fields, x, z, true);
        if (y < 138 || keepClear(x, z, 0.2)) continue;
        if (Math.hypot(x - EYE.x, z - EYE.z) < 5) continue;
        if (rocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.9)) continue;
        heath.push({
            x, y, z, r: 0.25 + random() * 0.55, kind: random(), seed: random(),
        });
    }
    return { rocks, heath };
}

function boulderGeometry() {
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 4));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        // Glacier-rounded, a little blocky: two scales of lumps and a flattened base.
        const n = 1 + 0.16 * simplex(x * 1.4 + 3.1, z * 1.4 + y * 0.9) + 0.06 * simplex(x * 3.7 - y * 2.1, z * 3.7);
        p.setXYZ(i, x * n, (y < 0 ? y * 0.55 : y) * n, z * n);
    }
    geo.computeVertexNormals();
    return geo;
}

function nearMaterial(u, t, kind) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = kind === 'rock' ? 'HighCoastBoulders' : 'HighCoastHeath';
    material.fog = false;
    const inst = attribute('aNear', 'vec4');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        let albedo;
        if (kind === 'rock') {
            const N1 = texture(t.noise, P.xz.mul(0.7).add(P.y.mul(0.31)));
            const N2 = texture(t.noise, P.xz.mul(3.1).add(P.y.mul(1.7)));
            const base = mix(vec3(0.3, 0.2, 0.16), vec3(0.32, 0.31, 0.28), smoothstep(0.35, 0.7, N1.r));
            // Lichen: pale crust on the tops, yellow-green map lichen in patches, a dark underside.
            const crust = smoothstep(0.55, 0.7, N2.b).mul(smoothstep(-0.2, 0.6, n.y));
            const map = smoothstep(0.66, 0.72, N2.g).mul(smoothstep(0.0, 0.7, n.y));
            albedo = mix(mix(base, vec3(0.5, 0.5, 0.45), crust.mul(0.7)), vec3(0.3, 0.37, 0.08), map.mul(0.7))
                .mul(smoothstep(-0.8, 0.2, n.y).mul(0.45).add(0.55)).mul(inst.w.mul(0.25).add(0.88));
        } else {
            // Heather (purple-brown, pink in flower), crowberry (dark green), reindeer lichen (pale).
            const fine = texture(t.noise, P.xz.mul(9.0).add(P.y.mul(4.0))).a;
            const heather = mix(vec3(0.07, 0.045, 0.05), vec3(0.36, 0.1, 0.24), smoothstep(0.55, 0.75, fine));
            const crowberry = mix(vec3(0.018, 0.03, 0.015), vec3(0.05, 0.075, 0.03), fine);
            const reindeer = mix(vec3(0.38, 0.4, 0.34), vec3(0.55, 0.57, 0.5), fine);
            const k = inst.z;
            albedo = mix(mix(heather, crowberry, smoothstep(0.45, 0.55, k)), reindeer, smoothstep(0.82, 0.88, k));
        }
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(kind === 'rock' ? 0.05 : 0.3).div(kind === 'rock' ? 1.05 : 1.3), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(wrap).mul(shadow).mul(u.sunUp).add(u.fill.mul(n.y.mul(0.4).add(0.6)))
            .add(u.bounce.mul(0.6)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── The part ──────────────────────────────────────────────────────────────────────

export function createProps(u, t, tier, fields) {
    const meshes = [];
    const disposables = [];
    const ground = (x, z) => groundHeight(fields, x, z, true);

    // The old pine (its wood, its needles and its shadow on the summit).
    const pine = createPine(u, t, tier, ground, new THREE.Vector3(PLACES.pine.x, ground(PLACES.pine.x, PLACES.pine.z) - 0.6, PLACES.pine.z));
    meshes.push(...pine.meshes);
    disposables.push(pine);

    // The trail sign: a post, two boards turned toward the eye (a little to the right).
    const letters = signTexture();
    disposables.push(letters);
    const sign = new THREE.Group();
    sign.name = 'HighCoastSign';
    const baseY = ground(PLACES.sign.x, PLACES.sign.z);
    sign.position.set(PLACES.sign.x, baseY - 0.45, PLACES.sign.z);
    sign.rotation.y = Math.atan2(EYE.x - PLACES.sign.x, EYE.z - PLACES.sign.z) - 0.3;
    const postGeo = new THREE.BoxGeometry(SIGN.post.w, SIGN.post.h, SIGN.post.w);
    postGeo.translate(0, SIGN.post.h / 2, 0);
    const postMat = signMaterial(u, t, letters, -1);
    const post = new THREE.Mesh(postGeo, postMat);
    sign.add(post);
    disposables.push(postGeo, postMat);
    SIGN.boards.forEach((b, k) => {
        const geo = boardGeometry(b);
        const mat = signMaterial(u, t, letters, k);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, b.y, 0);
        sign.add(mesh);
        disposables.push(geo, mat);
    });
    sign.traverse((o) => {
        o.frustumCulled = false;
        o.renderOrder = 3;
    });
    meshes.push(sign);

    // Boulders and heath.
    const sites = nearSites(fields, { boulders: tier.props > 0 ? 34 : 18, tufts: 0 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (const [list, geoFn, kind] of [[sites.rocks, boulderGeometry, 'rock']]) {
        const geo = geoFn();
        const data = new Float32Array(Math.max(1, list.length) * 4);
        list.forEach((s, i) => data.set([s.r, s.seed, s.kind ?? 0, s.seed], i * 4));
        geo.setAttribute('aNear', new THREE.InstancedBufferAttribute(data, 4));
        const mat = nearMaterial(u, t, kind);
        const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
        mesh.name = kind === 'rock' ? 'HighCoastBoulders' : 'HighCoastHeath';
        list.forEach((s, i) => {
            e.set(0, s.yaw ?? s.seed * 6.283, 0);
            q.setFromEuler(e);
            if (kind === 'rock') {
                sc.set(s.r * 1.2, s.r * s.squash, s.r);
                pos.set(s.x, s.y - 0.32 + s.r * s.squash * 0.22, s.z);
            } else {
                sc.set(s.r * 1.3, s.r, s.r * 1.2);
                pos.set(s.x, s.y - 0.04, s.z);
            }
            m.compose(pos, q, sc);
            mesh.setMatrixAt(i, m);
        });
        mesh.count = Math.max(1, list.length);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        meshes.push(mesh);
        disposables.push(geo, mat);
    }

    return {
        mesh: meshes[0],
        meshes,
        sites,
        update() {},
        dispose() {
            for (const d of disposables) d.dispose();
            for (const mesh of meshes) mesh.dispose?.();
        },
    };
}

export { max };
