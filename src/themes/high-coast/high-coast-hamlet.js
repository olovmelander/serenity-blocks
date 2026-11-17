/**
 * High Coast — the fishing hamlet and the lighthouse.
 *
 *  - On the near right island: Falu-red cottages with white corner boards, window casings and
 *    bargeboards, a porch over the door and a chimney on the ridge, sitting on grey stone plinths;
 *    red boathouses (sjöbodar) along the shore, gable and doors to the water; a hut or two behind
 *    the cottages; rowing boats drawn up on the shingle; a jetty on posts; a flagpole with the
 *    Swedish flag in the wind. The buildings shade the grass, and the windows glow when the sun
 *    is low. As the land rises the boathouses are left high above the water, as the old ones on
 *    the High Coast are. (The buildings themselves: high-coast-cottages.js.)
 *  - Far out, the lighthouse on its steep island: a white tower with a red lantern roof, and its
 *    light (high-coast-fx.js draws the glow and beam).
 *
 * Buildings are merged into one mesh (one material), the flag is its own cloth, the lighthouse
 * its own mesh.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    floor,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
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
import { buildCottages, cottageMaterial, houseShadows } from './high-coast-cottages.js';

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
    // (Drawn after everything above, so what stood there before stands where it stood.)
    const clear = (x, z, r) => !cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 6.5 + r)
        && !sheds.some((c) => Math.hypot(c.x - x, c.z - z) < 5.5 + r) && Math.hypot(flag.x - x, flag.z - z) > 3;
    // A hut behind each of the first cottages: up the slope from it, a little to one side.
    const huts = [];
    for (const c of cottages.slice(0, 2)) {
        for (let tries = 0; tries < 40; tries++) {
            const back = 6.5 + random() * 3.5;
            const aside = (random() < 0.5 ? -1 : 1) * (2.5 + random() * 4);
            const x = c.x - Math.sin(c.yaw) * back + Math.cos(c.yaw) * aside;
            const z = c.z - Math.cos(c.yaw) * back - Math.sin(c.yaw) * aside;
            const y = ground(x, z);
            if (y < 2.6 || slopeAt(x, z) > 0.36 || !clear(x, z, 1.5) || huts.some((h) => Math.hypot(h.x - x, h.z - z) < 6)) continue;
            huts.push({
                x, z, yaw: c.yaw + (random() - 0.5) * 0.4, w: 2.7, d: 2.2, h: 2.0, roof: 0, seed: random(), hut: true,
            });
            break;
        }
    }
    // Rowing boats drawn up on the shingle beside the boathouses, stem to the land.
    const boats = [];
    for (const s of sheds) {
        for (let tries = 0; tries < 40 && boats.length < 3; tries++) {
            const aside = (random() < 0.5 ? -1 : 1) * (4.5 + random() * 4);
            const down = 1 + random() * 4;
            const x = s.x + Math.cos(s.yaw) * aside + Math.sin(s.yaw) * down;
            const z = s.z - Math.sin(s.yaw) * aside + Math.cos(s.yaw) * down;
            const y = ground(x, z);
            if (y < 0.45 || y > 1.5 || slopeAt(x, z) > 0.3 || !clear(x, z, 1) || boats.some((b) => Math.hypot(b.x - x, b.z - z) < 3)) continue;
            // The boat's stem (its +x) points up the shore.
            boats.push({
                x, z, yaw: downhill(x, z) + Math.PI / 2 + (random() - 0.5) * 0.5, seed: random(),
            });
            break;
        }
    }
    return {
        cottages, sheds, jetty, flag, huts, boats,
    };
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
    const { geometry: geo, solids } = buildCottages(sites, ground);
    const mat = cottageMaterial(u, t);
    const buildings = new THREE.Mesh(geo, mat);
    buildings.name = 'HighCoastHamlet';
    buildings.frustumCulled = false;
    buildings.renderOrder = 2;
    // The buildings' shadows on the yard (not on the lowest tier).
    const shade = tier.props > 0 ? houseShadows(u, t, fields, tier, solids) : null;

    // The jetty: a deck on posts.

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
    if (shade) meshes.push(shade.mesh);
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
            shade?.geometry.dispose();
            shade?.material.dispose();
        },
    };
}

export { floor };
