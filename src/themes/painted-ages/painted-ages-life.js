/**
 * Painted Ages — the living things: the poplars along the river.
 *
 * Windbreak rows of columnar poplars on the valley floor beside the river, golden in autumn with
 * a few still green. Instanced spindles; the canopy is shaded in clumps (noise on its own
 * surface), sways a little in the wind (a constant rate), and is lit like the land and read
 * through the same air. (Low scrub is drawn by the land's own shader.)
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
import { FIELDS, mulberry32 } from './painted-ages-core.js';
import { groundHeight, inField } from './painted-ages-field.js';
import { RIVER, riverFloor } from './painted-ages-plan.js';
import { aerial, cloudShadow, mistPatches } from './painted-ages-light.js';
import { shadowAt } from './painted-ages-shadow.js';

// ── Poplars ───────────────────────────────────────────────────────────────────────

/** Where the poplars stand: rows along the river on its low, flat banks within the near field. */
export function poplarSites(fields, count = 160, seed = 0x9091) {
    const random = mulberry32(seed);
    const sites = [];
    const { near } = FIELDS;
    const ground = (x, z) => groundHeight(fields, x, z, true);
    let tries = 0;
    while (sites.length < count && tries < count * 40) {
        tries++;
        // A point along the river's course, then out to one bank in a row.
        const i = Math.floor(random() * (RIVER.length - 1));
        const t = random();
        const [ax, az] = RIVER[i];
        const [bx, bz] = RIVER[i + 1];
        const x0 = ax + (bx - ax) * t;
        const z0 = az + (bz - az) * t;
        if (!inField(near, x0, z0) || z0 > -120) continue;
        const len = Math.hypot(bx - ax, bz - az);
        const side = random() < 0.5 ? -1 : 1;
        const out = 26 + random() * 44;
        const x = x0 + (-(bz - az) / len) * out * side;
        const z = z0 + ((bx - ax) / len) * out * side;
        const y = ground(x, z);
        if (y - riverFloor(z) > 7) continue;
        // Level ground only (a tree on a slope stands on a terrace it does not have).
        const slope = Math.max(Math.abs(ground(x + 3, z) - ground(x - 3, z)), Math.abs(ground(x, z + 3) - ground(x, z - 3))) / 6;
        if (slope > 0.12) continue;
        if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 5.5)) continue;
        sites.push({
            x, y, z, height: 14 + random() * 9, radius: 1.7 + random() * 1.2, golden: random() < 0.72 ? 1 : 0, seed: random(),
        });
    }
    return sites;
}

/** A poplar's spindle: a lathe of its profile (radius 1 at the widest, height 1), with a trunk. */
function poplarGeometry() {
    const pts = [];
    const rings = 12;
    for (let k = 0; k <= rings; k++) {
        const t = k / rings;
        // Narrow at the foot of the crown, widest a third of the way up, tapering to a point.
        const r = t < 0.12 ? 0.25 + t * 4 : Math.sin(Math.min(1, (t - 0.05) / 0.95) * Math.PI) ** 0.8 * (1 - t * 0.35);
        pts.push(new THREE.Vector2(Math.max(0.02, r), 0.12 + t * 0.88));
    }
    const crown = new THREE.LatheGeometry(pts, 9);
    const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.2, 6);
    trunk.translate(0, 0.08, 0);
    crown.deleteAttribute('uv');
    trunk.deleteAttribute('uv');
    const merged = new THREE.BufferGeometry();
    const a = crown.toNonIndexed();
    const b = trunk.toNonIndexed();
    const pos = new Float32Array(a.attributes.position.count * 3 + b.attributes.position.count * 3);
    pos.set(a.attributes.position.array, 0);
    pos.set(b.attributes.position.array, a.attributes.position.count * 3);
    const nrm = new Float32Array(pos.length);
    nrm.set(a.attributes.normal.array, 0);
    nrm.set(b.attributes.normal.array, a.attributes.normal.count * 3);
    const bark = new Float32Array(pos.length / 3);
    bark.fill(1, a.attributes.position.count);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    merged.setAttribute('aBark', new THREE.BufferAttribute(bark, 1));
    crown.dispose();
    trunk.dispose();
    a.dispose();
    b.dispose();
    return merged;
}

export function createPoplars(u, t, tier, fields) {
    const count = { 0: 70, 1: 110, 2: 170 }[tier.props] ?? 170;
    const sites = poplarSites(fields, count);
    const geometry = poplarGeometry();
    const data = new Float32Array(Math.max(1, sites.length) * 4);
    sites.forEach((s, i) => data.set([s.golden, s.seed, s.height, 0], i * 4));
    geometry.setAttribute('aTree', new THREE.InstancedBufferAttribute(data, 4));
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesPoplars';
    material.fog = false;
    const tree = attribute('aTree', 'vec4');
    const bark = attribute('aBark', 'float');
    // A breath of wind in the crowns (constant rate; amplitude by height up the tree).
    material.positionNode = Fn(() => {
        const sway = sin(u.time.mul(0.9).add(tree.y.mul(40.0))).mul(0.018).mul(positionGeometry.y.mul(positionGeometry.y));
        return positionLocal.add(vec3(sway, 0.0, sway.mul(0.4)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const golden = mix(vec3(0.16, 0.2, 0.05), vec3(0.6, 0.38, 0.06), tree.x).mul(tree.y.mul(0.3).add(0.85));
        // Clumps of leaves: the crown's own surface is not one flat colour.
        const clump = texture(t.noise, vec2(P.x.add(P.y.mul(0.7)), P.z.sub(P.y.mul(0.5))).mul(0.35)).a;
        const albedo = mix(golden.mul(clump.mul(0.6).add(0.6)), vec3(0.09, 0.07, 0.05), bark);
        const n = normalize(normalWorld);
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.35).div(1.35), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const clouds = cloudShadow(u, t.noise, P);
        const view = normalize(P.sub(u.eye));
        // Light through the leaves when the sun stands behind the crown.
        const through = clamp(dot(view, L), 0.0, 1.0).pow(4.0).mul(0.6).mul(float(1.0).sub(bark));
        const direct = u.sun.mul(wrap.add(through)).mul(shadow).mul(clouds).mul(u.sunUp);
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65));
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.5)));
        // The same mist banks the valley floor stands in.
        return vec4(aerial(u, P, lit, mistPatches(u, t.noise, P.xz)), 1.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, sites.length));
    mesh.name = 'PaintedAgesPoplars';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    sites.forEach((s, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.seed * 6.28);
        sc.set(s.radius, s.height, s.radius);
        pos.set(s.x, s.y - 0.4, s.z);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
    });
    mesh.count = sites.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return {
        mesh,
        meshes: [mesh],
        sites,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}

export { smoothstep };
