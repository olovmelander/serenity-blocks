/**
 * Synthwave Sunset — the promenade round the bay: a seawall with a white railing and globe lamps
 * following the beach as it curves out to sea right of the pier, a row of pastel Art Deco hotels
 * behind it (synthwave-sunset-hotels.js), and the dark headland that closes the bay, its houses'
 * lights coming on.
 *
 * In the game view all of it lies right of the HUD, 200 m and more away, receding toward the
 * horizon: the town the pier belongs to. Three draws (the structure, the hotels, the lamp globes
 * with the hotels' beacons); the palms along it are the palms part's.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    dot,
    float,
    floor,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    select,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    SEA_HAZE,
    SHORE,
    linearColor,
    rgb,
    swHash21,
    swSkyGradient,
} from './synthwave-sunset-tsl.js';
import { inlandOf } from './synthwave-sunset-sea.js';
import {
    box, makeOut, strut, toGeometry,
} from './synthwave-sunset-geo.js';
import { BULB, createBulbField } from './synthwave-sunset-bulbs.js';
import { buildHotels, createHotelMaterial } from './synthwave-sunset-hotels.js';

const KIND = {
    wall: 0, paint: 1, ridge: 3,
};

/** Where along the beach (world x) the promenade runs, and its lamps' spacing (m). */
export const PROMENADE = Object.freeze({
    x0: 70,
    x1: 900,
    lampEvery: 14,
});

/** Points along the promenade (offset inland from the waterline), every `spacing` metres of x. */
export function promenadePath(inland = SHORE.promenade, spacing = 6) {
    const pts = [];
    for (let x = PROMENADE.x0; x <= PROMENADE.x1; x += spacing) {
        const q = inlandOf(x, inland);
        pts.push(new THREE.Vector3(q.x, 0, q.z));
    }
    return pts;
}

/** A frame at a point of a horizontal path: x = along, y = up, z = inland (right-handed). */
function pathBasis(a, b) {
    const along = b.clone().sub(a).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(along, up);
    return { x: along, y: up, z };
}

function buildPromenade() {
    const out = makeOut();
    const wall = [KIND.wall, 0, 0, 0];
    const paint = [KIND.paint, 0, 0, 0];
    const path = promenadePath();
    const lamps = [];
    let run = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i];
        const b = path[i + 1];
        const B = pathBasis(a, b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        // Seawall: 2.2 m of pastel concrete with a cap; the railing on top.
        box(out, mid.clone().setY(1.1), new THREE.Vector3(len / 2 + 0.05, 1.1, 0.5), wall, B);
        box(out, mid.clone().setY(2.3), new THREE.Vector3(len / 2 + 0.05, 0.1, 0.65), paint, B);
        strut(out, a.clone().setY(3.3), b.clone().setY(3.3), 0.06, 4, paint);
        strut(out, a.clone().setY(2.4), a.clone().setY(3.3), 0.05, 4, paint);
        run += len;
        if (run >= PROMENADE.lampEvery) {
            run = 0;
            const back = a.clone().addScaledVector(B.z, -1.6);
            strut(out, back.clone().setY(2.3), back.clone().setY(7.6), 0.12, 6, paint);
            strut(out, back.clone().setY(7.2).addScaledVector(B.x, -0.9), back.clone().setY(7.2).addScaledVector(B.x, 0.9), 0.06, 4, paint);
            lamps.push(back.clone().setY(7.5).addScaledVector(B.x, -0.9), back.clone().setY(7.5).addScaledVector(B.x, 0.9));
        }
    }

    // The headland: a ridge of dark hills closing the bay, far behind the hotels.
    const ridge = [];
    for (let rx = 260; rx <= 1900; rx += 12) {
        const q = inlandOf(rx, SHORE.promenade + 150 + Math.sin(rx * 0.004) * 40);
        // Rounded hills on a long rise: a few octaves, the higher ones weaker.
        const h = 22 + 34 * Math.max(0, Math.sin((rx - 260) * 0.0025)) + 13 * Math.sin(rx * 0.0071 + 1.3)
            + 9 * Math.sin(rx * 0.017) + 5 * Math.sin(rx * 0.043 + 0.4) + 2.5 * Math.sin(rx * 0.11 + 2.0);
        ridge.push({ x: q.x, z: q.z, h: Math.max(8, h) });
    }
    for (let i = 0; i < ridge.length - 1; i += 1) {
        const a = ridge[i];
        const b = ridge[i + 1];
        const baseIdx = out.position.length / 3;
        const quad = [[a.x, 0, a.z], [b.x, 0, b.z], [b.x, b.h, b.z], [a.x, a.h, a.z]];
        // Facing the camera side (toward −x, −z): normal from the strip's horizontal tangent.
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const tl = Math.hypot(tx, tz);
        const nx = tz / tl;
        const nz = -tx / tl;
        quad.forEach(([px, py, pz]) => {
            out.position.push(px, py, pz);
            out.normal.push(-nx, 0, -nz);
            out.meta.push(KIND.ridge, py, 0, 0);
        });
        out.index.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2);
        out.index.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    return { out, lamps };
}

function createPromenadeMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwavePromenade';
    material.fog = false;
    const meta = attribute('aProm', 'vec4');
    material.colorNode = Fn(() => {
        const kind = meta.x;
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel);
        const V = rel.div(dist);
        const N = normalize(normalWorld).toVar();
        const facing = abs(dot(N, V));
        const duskLight = mix(float(1.0), float(0.5), u.dusk);
        const sky = rgb(0x8a7aa8, 0.3).mul(float(0.55).add(max(N.y, 0.0).mul(0.45))).mul(duskLight);
        const rim = pow(float(1.0).sub(facing), 3.0).mul(max(dot(N, u.sunDir), 0.0).mul(0.8).add(0.2))
            .mul(rgb(0xff8a5c, 0.45)).mul(mix(float(1.0), float(0.3), u.dusk));
        const lampWash = smoothstep(9.0, 0.0, p.y).mul(rgb(0xffc890, 0.14)).mul(u.pierGlow);
        const wallCol = rgb(0xc9b2bc).mul(sky.add(lampWash)).add(rim);
        const paintCol = rgb(0xece4ea).mul(sky.add(lampWash)).add(rim);

        // The headland: a dark ridge with scattered house lights on its lower slopes.
        const lc = floor(vec2(p.x.add(p.z).mul(0.12), p.y.mul(0.3)));
        const house = step(0.93, swHash21(lc)).mul(step(p.y, meta.y.mul(0.6)));
        // Darker at the foot, the crest catching the sky.
        const ridgeCol = rgb(0x231a33).mul(duskLight).mul(float(0.7).add(smoothstep(0.0, 70.0, p.y).mul(0.6)))
            .add(rgb(0xffc07a, 1.6).mul(house).mul(u.townLights));

        const col = select(kind.lessThan(0.5), wallCol, select(kind.lessThan(1.5), paintCol, ridgeCol));
        // Far things sit in the bay's haze, the colour of the horizon on their bearing.
        const haze = float(1.0).sub(pow(float(1.0).sub(smoothstep(0.0, 1.0, dist.mul(SEA_HAZE * 1.6))), 1.5));
        return mix(col, swSkyGradient(u, normalize(vec3(V.x, 0.0, V.z))).color, haze.mul(0.85));
    })();
    return material;
}

/**
 * @param {object} u  world uniforms (townLights, pierGlow, dusk, sunDir…)
 * @param {object} opts
 * @param {() => number} opts.rand
 * @param {number} [opts.mirrorLayer]
 * @returns {THREE.Group}
 */
export function createPromenade(u, { rand, mirrorLayer } = {}) {
    const { out, lamps } = buildPromenade();
    const hotelOut = makeOut();
    const beacons = buildHotels(hotelOut, rand ?? Math.random);
    const group = new THREE.Group();
    group.name = 'SynthwavePromenade';
    const structure = new THREE.Mesh(toGeometry(out, 'aProm'), createPromenadeMaterial(u));
    structure.name = 'SynthwavePromenadeStructure';
    structure.renderOrder = -8;
    structure.frustumCulled = false;
    const hotels = new THREE.Mesh(toGeometry(hotelOut, 'aHotel'), createHotelMaterial(u));
    hotels.name = 'SynthwaveHotels';
    hotels.renderOrder = -8;
    hotels.frustumCulled = false;
    const globe = linearColor(0xfff0e0);
    const bulbs = createBulbField(u, lamps.map((p, i) => ({
        p, size: 0.7, color: globe, program: BULB.globe, index: i, count: lamps.length, along: 1, level: 1,
    })).concat(beacons), { name: 'SynthwavePromenadeLamps', mirrorLayer });
    group.add(structure, hotels, bulbs);
    if (Number.isInteger(mirrorLayer)) {
        structure.layers.enable(mirrorLayer);
        hotels.layers.enable(mirrorLayer);
    }
    group.userData.meshes = [structure, hotels, bulbs];
    return group;
}
