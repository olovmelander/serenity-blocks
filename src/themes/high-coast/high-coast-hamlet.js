/**
 * High Coast — the fishing hamlet and the lighthouse.
 *
 *  - On the near right island: Falu-red cottages with white corner boards and window frames and
 *    dark roofs, sitting on grey stone plinths; red boathouses (sjöbodar) along the shore, gable
 *    to the water; a jetty on posts; a flagpole with the Swedish flag in the wind. The windows
 *    glow when the sun is low. As the land rises the boathouses are left high above the water,
 *    as the old ones on the High Coast are.
 *  - Far out, the lighthouse on its steep island: a white tower with a red lantern roof, and its
 *    light (high-coast-fx.js draws the glow and beam).
 *
 * Buildings are merged into one mesh (one material: walls, trim, roofs and plinths by a part
 * attribute and local wall coordinates), the flag is its own cloth, the lighthouse its own mesh.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    floor,
    fract,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { PLACES, mulberry32 } from './high-coast-core.js';
import { groundHeight } from './high-coast-field.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import { flatVarying } from '../shared/flat-varying.js';

/** Parts of a building's surface (the material's aPart): wall, trim, roof, plinth, glass. */
const WALL = 0;
const ROOF = 2;
const PLINTH = 3;

/** Where the hamlet's buildings stand: chosen on the island by the ground, deterministic. */
export function hamletSites(fields, seed = 0x5ab0) {
    const random = mulberry32(seed);
    const ground = (x, z) => groundHeight(fields, x, z, true);
    const slopeAt = (x, z) => Math.hypot(ground(x + 2, z) - ground(x - 2, z), ground(x, z + 2) - ground(x, z - 2)) / 4;
    const downhill = (x, z) => Math.atan2(-(ground(x + 2, z) - ground(x - 2, z)), -(ground(x, z + 2) - ground(x, z - 2)));
    const cottages = [];
    const sheds = [];
    const { x: hx, z: hz } = PLACES.hamlet;
    for (let tries = 0; tries < 4000 && cottages.length < 4; tries++) {
        const a = random() * Math.PI * 2;
        const d = random() * 62;
        const x = hx + Math.cos(a) * d;
        const z = hz + Math.sin(a) * d;
        const y = ground(x, z);
        if (y < 2.6 || y > 13 || slopeAt(x, z) > 0.32) continue;
        if (cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 17)) continue;
        cottages.push({
            x, z, yaw: downhill(x, z) + (random() - 0.5) * 0.5, w: 7 + random() * 2, d: 5.2 + random() * 1.2, h: 3 + random() * 0.6, roof: random() < 0.3 ? 1 : 0, seed: random(),
        });
    }
    for (let tries = 0; tries < 6000 && sheds.length < 3; tries++) {
        const a = random() * Math.PI * 2;
        const d = 20 + random() * 70;
        const x = hx + Math.cos(a) * d;
        const z = hz + Math.sin(a) * d;
        const y = ground(x, z);
        if (y < 0.35 || y > 1.6) continue;
        if (sheds.some((c) => Math.hypot(c.x - x, c.z - z) < 9) || cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
        sheds.push({
            x, z, yaw: downhill(x, z), w: 4 + random(), d: 6 + random() * 1.5, h: 2.6, roof: 0, seed: random(), shed: true,
        });
    }
    // The jetty runs out from the first boathouse, down the slope into the water.
    const first = sheds[0] || cottages[0] || { x: hx, z: hz, yaw: 0 };
    const jetty = {
        x: first.x + Math.sin(first.yaw) * 4, z: first.z + Math.cos(first.yaw) * 4, yaw: first.yaw, length: 18,
    };
    // The flag stands on the high point of the yard.
    let flag = { x: hx, z: hz, y: ground(hx, hz) };
    for (let k = 0; k < 400; k++) {
        const x = hx + (random() - 0.5) * 50;
        const z = hz + (random() - 0.5) * 50;
        const y = ground(x, z);
        if (y > flag.y && !cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 7)) flag = { x, z, y };
    }
    return {
        cottages, sheds, jetty, flag,
    };
}

/** Push one building (walls, gable roof, plinth) into the merged arrays. */
function addBuilding(out, b, ground) {
    const { w, d, h } = b;
    const cy = Math.min(ground(b.x, b.z), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
        const lx = (sx * w) / 2;
        const lz = (sz * d) / 2;
        return ground(b.x + Math.cos(b.yaw) * lx + Math.sin(b.yaw) * lz, b.z - Math.sin(b.yaw) * lx + Math.cos(b.yaw) * lz);
    }));
    const top = Math.max(ground(b.x, b.z), cy) + 0.55;
    const ca = Math.cos(b.yaw);
    const sa = Math.sin(b.yaw);
    const world = (lx, ly, lz) => [b.x + ca * lx + sa * lz, ly, b.z - sa * lx + ca * lz];
    const push = (a, bb, c, part, la, lb, lc, n, width) => {
        for (const [p, l] of [[a, la], [bb, lb], [c, lc]]) {
            const wp = world(p[0], p[1], p[2]);
            out.pos.push(...wp);
            out.nrm.push(ca * n[0] + sa * n[2], n[1], -sa * n[0] + ca * n[2]);
            // A boathouse's seed is lifted by 2: the shader reads it as "no windows".
            out.local.push(l[0], l[1], part, b.seed + (b.shed ? 2 : 0));
            out.width.push(width);
        }
    };
    const quad = (p0, p1, p2, p3, part, n, uw, vh) => {
        push(p0, p1, p2, part, [0, 0], [uw, 0], [uw, vh], n, uw);
        push(p0, p2, p3, part, [0, 0], [uw, vh], [0, vh], n, uw);
    };
    const x0 = -w / 2;
    const x1 = w / 2;
    const z0 = -d / 2;
    const z1 = d / 2;
    const yb = top;
    const yt = top + h;
    // Plinth: from deep in the rock up to the floor.
    const pb = cy - 1.2;
    quad([x0, pb, z1], [x1, pb, z1], [x1, yb, z1], [x0, yb, z1], PLINTH, [0, 0, 1], w, yb - pb);
    quad([x1, pb, z0], [x0, pb, z0], [x0, yb, z0], [x1, yb, z0], PLINTH, [0, 0, -1], w, yb - pb);
    quad([x1, pb, z1], [x1, pb, z0], [x1, yb, z0], [x1, yb, z1], PLINTH, [1, 0, 0], d, yb - pb);
    quad([x0, pb, z0], [x0, pb, z1], [x0, yb, z1], [x0, yb, z0], PLINTH, [-1, 0, 0], d, yb - pb);
    // Walls (long sides: front +z, back −z; gables ±x with the triangle up to the ridge).
    quad([x0, yb, z1], [x1, yb, z1], [x1, yt, z1], [x0, yt, z1], WALL, [0, 0, 1], w, h);
    quad([x1, yb, z0], [x0, yb, z0], [x0, yt, z0], [x1, yt, z0], WALL, [0, 0, -1], w, h);
    const ridge = yt + d * 0.42;
    for (const side of [1, -1]) {
        const xs = side > 0 ? x1 : x0;
        const n = [side, 0, 0];
        const za = side > 0 ? z1 : z0;
        const zb = side > 0 ? z0 : z1;
        quad([xs, yb, za], [xs, yb, zb], [xs, yt, zb], [xs, yt, za], WALL, n, d, h);
        push([xs, yt, za], [xs, yt, zb], [xs, ridge, 0], WALL, [0, h], [d, h], [d / 2, h + d * 0.42], n, d);
    }
    // Roof: two slopes with a small overhang.
    const o = 0.45;
    const slope = [0, Math.cos(Math.atan2(d * 0.42, d / 2)), Math.sin(Math.atan2(d * 0.42, d / 2))];
    quad([x0 - o, yt - 0.25, z1 + o], [x1 + o, yt - 0.25, z1 + o], [x1 + o, ridge + 0.05, 0], [x0 - o, ridge + 0.05, 0], ROOF + b.roof * 0.5, [0, slope[1], slope[2]], w, 1);
    quad([x1 + o, yt - 0.25, z0 - o], [x0 - o, yt - 0.25, z0 - o], [x0 - o, ridge + 0.05, 0], [x1 + o, ridge + 0.05, 0], ROOF + b.roof * 0.5, [0, slope[1], -slope[2]], w, 1);
}

function buildingMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastHamlet';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const local = attribute('aLocal', 'vec4');
    const width = attribute('aWidth', 'float');
    // The part, flat: a black roof is 2.0, and read interpolated as 1.9999999 its fract made it red.
    const partOf = flatVarying(local.z, 'vHamletPart');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const lu = local.x;
        const lv = local.y;
        const part = partOf;
        const seed = fract(local.w);
        const shed = step(1.5, local.w);
        // Falu red: a deep iron-oxide red, a little uneven board by board.
        const board = fract(lu.div(0.2));
        const boards = smoothstep(0.0, 0.08, board).mul(0.12).add(0.88);
        const falu = vec3(0.26, 0.028, 0.014).mul(boards).mul(seed.mul(0.2).add(0.9));
        // White trim: corner boards, the eaves line and window frames.
        const corner = float(1.0).sub(step(0.22, lu.min(width.sub(lu))));
        const win = (cx) => {
            const dx = lu.sub(cx).abs();
            const dy = lv.sub(1.6).abs();
            const frame = step(dx, 0.62).mul(step(dy, 0.72));
            const glass = step(dx, 0.48).mul(step(dy, 0.58));
            return vec2(frame.sub(glass), glass);
        };
        const w1 = win(1.8);
        const w2 = win(4.6);
        const frame = max(w1.x, w2.x).mul(float(1.0).sub(shed));
        const glass = max(w1.y, w2.y).mul(step(lv, 3.0)).mul(float(1.0).sub(shed));
        const trim = max(corner, frame);
        const wall = mix(falu, vec3(0.75, 0.74, 0.7), trim);
        const windowDark = vec3(0.02, 0.025, 0.03);
        const roofCol = mix(vec3(0.045, 0.045, 0.05), vec3(0.2, 0.05, 0.03), step(0.25, fract(part)));
        const plinth = mix(vec3(0.22, 0.21, 0.2), vec3(0.32, 0.3, 0.28), texture(t.noise, P.xz.mul(1.3).add(P.y)).a);
        const isRoof = step(1.5, part).mul(step(part, 2.9));
        const isPlinth = step(2.9, part);
        const albedo = mix(mix(mix(wall, windowDark, glass), roofCol, isRoof), plinth, isPlinth);
        const L = u.sunDir;
        const ndl = clamp(dot(n, L), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(ndl).mul(shadow).mul(u.sunUp).add(u.fill.mul(n.y.mul(0.3).add(0.7)))
            .add(u.bounce.mul(0.5))).toVar();
        // Windows glow when the sun is low.
        lit.addAssign(vec3(1.8, 1.05, 0.45).mul(glass).mul(u.lamps).mul(seed.mul(0.6).add(0.5)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

/** The Swedish flag: blue with a yellow Nordic cross, 1.6 × 1 m, waving at a constant pace. */
function flagMesh(u, site) {
    const geo = new THREE.PlaneGeometry(1.6, 1.0, 16, 8);
    geo.translate(0.8, 0, 0);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'HighCoastFlag';
    material.fog = false;
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const along = p.x.div(1.6);
        const wave = sin(p.x.mul(4.2).sub(u.time.mul(5.5))).mul(0.12).add(sin(p.x.mul(7.3).sub(u.time.mul(8.1)).add(p.y.mul(2.0))).mul(0.04));
        return vec3(p.x, p.y.sub(along.mul(along).mul(0.12)), wave.mul(along));
    })();
    material.colorNode = Fn(() => {
        const st = uv();
        const x = st.x.mul(16.0);
        const y = st.y.mul(10.0);
        const crossV = step(5.0, x).mul(step(x, 7.0));
        const crossH = step(4.0, y).mul(step(y, 6.0));
        const cross = max(crossV, crossH);
        const albedo = mix(vec3(0.0, 0.12, 0.42), vec3(0.95, 0.68, 0.0), cross);
        const lit = albedo.mul(u.sun.mul(0.45).mul(u.sunUp).add(u.fill.mul(0.9)).add(u.bounce));
        return vec4(aerial(u, positionWorld, lit), 1.0);
    })();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'HighCoastFlag';
    mesh.position.set(site.x, site.y + 8.1, site.z);
    mesh.rotation.y = 0.9;
    return { mesh, geo, material };
}

/** The lighthouse: a white tower, a gallery, a red-roofed lantern (metres, from its foot). */
function lighthouseGeometry() {
    const parts = [];
    const tower = new THREE.CylinderGeometry(1.7, 2.6, 14, 14, 1, true);
    tower.translate(0, 7, 0);
    parts.push(tower);
    const gallery = new THREE.CylinderGeometry(2.5, 2.5, 0.4, 14);
    gallery.translate(0, 14.2, 0);
    parts.push(gallery);
    const lantern = new THREE.CylinderGeometry(1.4, 1.4, 2, 12, 1, true);
    lantern.translate(0, 15.4, 0);
    parts.push(lantern);
    const roof = new THREE.ConeGeometry(1.8, 1.6, 12);
    roof.translate(0, 17.2, 0);
    parts.push(roof);
    const pos = [];
    const nrm = [];
    const tag = [];
    parts.forEach((g, k) => {
        const ng = g.index ? g.toNonIndexed() : g;
        pos.push(...ng.attributes.position.array);
        nrm.push(...ng.attributes.normal.array);
        for (let i = 0; i < ng.attributes.position.count; i++) tag.push(k);
        if (ng !== g) ng.dispose();
        g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(tag, 1));
    return geo;
}

function lighthouseMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'HighCoastLighthouse';
    material.fog = false;
    const part = attribute('aPart', 'float');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const white = vec3(0.72, 0.72, 0.7);
        const red = vec3(0.4, 0.04, 0.03);
        const glass = vec3(0.05, 0.06, 0.07);
        const albedo = mix(mix(white, glass, step(1.5, part).mul(step(part, 2.5))), red, step(2.5, part));
        const ndl = clamp(dot(n, u.sunDir), 0.0, 1.0);
        const lit = albedo.mul(u.sun.mul(ndl).mul(u.sunUp).mul(shadowAt(t.shadow, P.xz)).add(u.fill.mul(0.9))).toVar();
        // The lantern burns when the sun is low (or the run is back-to-back).
        lit.addAssign(vec3(3.0, 2.4, 1.4).mul(step(1.5, part).mul(step(part, 2.5))).mul(max(u.lamps, u.beacon.x)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

export function createHamlet(u, t, tier, fields) {
    const ground = (x, z) => groundHeight(fields, x, z, true);
    const sites = hamletSites(fields);
    const out = {
        pos: [], nrm: [], local: [], width: [],
    };
    for (const b of [...sites.cottages, ...sites.sheds]) addBuilding(out, b, ground);
    // The jetty: a deck on posts (a long thin box per plank run, posts as thin boxes).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
    geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(out.local, 4));
    geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(out.width, 1));
    geo.computeBoundingSphere();
    const mat = buildingMaterial(u, t);
    const buildings = new THREE.Mesh(geo, mat);
    buildings.name = 'HighCoastHamlet';
    buildings.frustumCulled = false;
    buildings.renderOrder = 2;

    const j = sites.jetty;
    const deckGeo = new THREE.BoxGeometry(2, 0.18, j.length);
    deckGeo.translate(0, 0, j.length / 2);
    const woodMat = new THREE.MeshBasicNodeMaterial();
    woodMat.name = 'HighCoastJetty';
    woodMat.fog = false;
    woodMat.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const albedo = vec3(0.22, 0.2, 0.17).mul(texture(t.noise, vec2(P.x.add(P.z), P.y).mul(3.0)).a.mul(0.3).add(0.8));
        const lit = albedo.mul(u.sun.mul(clamp(dot(n, u.sunDir), 0.0, 1.0)).mul(u.sunUp).add(u.fill.mul(0.8)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    const deck = new THREE.Mesh(deckGeo, woodMat);
    deck.name = 'HighCoastJetty';
    deck.position.set(j.x, 0.9, j.z);
    deck.rotation.y = j.yaw;
    deck.frustumCulled = false;
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 5);
    const posts = new THREE.InstancedMesh(postGeo, woodMat, 8);
    posts.name = 'HighCoastJettyPosts';
    const m = new THREE.Matrix4();
    for (let k = 0; k < 8; k++) {
        const s = (Math.floor(k / 2) + 0.5) * (j.length / 4);
        const side = k % 2 ? 0.9 : -0.9;
        const x = j.x + Math.sin(j.yaw) * s + Math.cos(j.yaw) * side;
        const z = j.z + Math.cos(j.yaw) * s - Math.sin(j.yaw) * side;
        m.makeTranslation(x, 0.9 - 3, z);
        posts.setMatrixAt(k, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.frustumCulled = false;

    // The flagpole and flag.
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const pole = new THREE.Mesh(poleGeo, woodMat);
    pole.position.set(sites.flag.x, sites.flag.y - 0.2, sites.flag.z);
    pole.name = 'HighCoastFlagpole';
    const flag = flagMesh(u, sites.flag);

    // The lighthouse on its island's crown.
    const lx = PLACES.lighthouse.x;
    const lz = PLACES.lighthouse.z;
    const lhGeo = lighthouseGeometry();
    const lhMat = lighthouseMaterial(u, t);
    const lighthouse = new THREE.Mesh(lhGeo, lhMat);
    lighthouse.name = 'HighCoastLighthouse';
    lighthouse.position.set(lx, ground(lx, lz) - 0.5, lz);
    lighthouse.frustumCulled = false;

    const meshes = [buildings, deck, posts, pole, flag.mesh, lighthouse];
    for (const mesh of meshes) mesh.renderOrder = 2;
    return {
        mesh: buildings,
        meshes,
        sites,
        lantern: new THREE.Vector3(lx, lighthouse.position.y + 15.4, lz),
        update() {},
        dispose() {
            geo.dispose();
            mat.dispose();
            deckGeo.dispose();
            postGeo.dispose();
            woodMat.dispose();
            poleGeo.dispose();
            flag.geo.dispose();
            flag.material.dispose();
            lhGeo.dispose();
            lhMat.dispose();
            posts.dispose?.();
        },
    };
}

export { floor };
