/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE CITY'S ROOFTOPS, drawn (2026-11-17 masterpiece pass).
 *
 * What the architecture plan (odyssey-neon-architecture.js) puts on the roofs the eye flies over
 * and on the crowns of the tall towers:
 *
 *   boxes     masts and aerials, air handlers with louvred sides, the legs of the water tanks;
 *   caps      four-sided pyramid crowns, their ridges lit in the tower's neon on the hero towers;
 *   tanks     water tanks: a hooped barrel with a conical lid;
 *   beacons   aircraft lights on every mast and crown: a slow breath, never a strobe.
 *
 * One material for the three kinds of solid (three small instanced draws) and one for the beacons.
 * Everything stands in the city's air and takes the sky's light on the side it shows it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    fract,
    max,
    mix,
    modelViewMatrix,
    normalGeometry,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { STREET_Y } from './odyssey-neon-city-plan.js';
import {
    neonAtmosphere, neonCityPos, neonGlow, neonIgnition, neonSpireLight,
} from './odyssey-neon-light.tsl.js';
import { neonSkyLite } from './odyssey-neon-sky.tsl.js';

/** Gear kinds (the shader's `kind`). */
export const NEON_GEAR = Object.freeze({
    leg: 0, mast: 1, unit: 2, cap: 3, tank: 4,
});

function createGearMaterial(N) {
    const aGear = varying(attribute('aGear', 'vec4'), 'vGearLook').setInterpolation('flat', 'either');
    const pcVarying = neonCityPos(N, 'vGearPos');
    const nVarying = varying(normalGeometry, 'vGearNormal');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-roof-gear';
    material.fog = false;
    material.colorNode = Fn(() => {
        const pc = pcVarying.toVar();
        const n = normalize(nVarying).toVar();
        const tint = aGear.x;
        const kind = aGear.y;
        const hero = aGear.z;
        const st = uv();
        const isUnit = step(1.5, kind).mul(step(kind, 2.5));
        const isCap = step(2.5, kind).mul(step(kind, 3.5));
        const isTank = step(3.5, kind);
        // Steel for masts and legs, painted sheet for the air handlers (louvres down their
        // sides), weathered copper for the caps, banded timber for the tanks.
        const steel = vec3(0.03, 0.032, 0.042);
        const louvre = step(0.5, fract(st.y.mul(7.0))).mul(0.35).add(0.65);
        const sheet = vec3(0.1, 0.11, 0.13).mul(mix(float(1.0), louvre, step(abs(n.y), 0.5)));
        const copper = mix(vec3(0.045, 0.1, 0.09), vec3(0.11, 0.07, 0.05), smoothstep(0.35, 0.65, tint));
        const hoop = float(1.0).sub(step(0.82, fract(st.y.mul(4.0))).mul(0.55));
        const timber = vec3(0.12, 0.072, 0.046).mul(hoop);
        const albedo = mix(mix(mix(steel, sheet, isUnit), copper, isCap), timber, isTank);
        // The sky on the side it shows, the street's glow from below, the spire's rose.
        const ign = neonIgnition(N, pc);
        const hAbove = max(pc.y.sub(STREET_Y), 0.0);
        const sky = neonSkyLite(N.sky, normalize(vec3(n.x, n.y.add(0.5), n.z))).mul(mix(float(0.55), float(1.5), isCap));
        const bounce = neonGlow(N, pc, 1).mul(ign.level).mul(exp(hAbove.mul(-1 / 45))).mul(0.35)
            .mul(max(n.y.negate().add(0.6), 0.0));
        const rim = N.sky.hazeSun.mul(max(n.dot(N.sky.sunDir), 0.0)).mul(0.55);
        const light = sky.add(bounce).add(rim).add(neonSpireLight(N, pc, n));
        // A cap's four ridges: lit in the tower's neon on the hero towers once the city is on.
        const ridge = float(1.0).sub(smoothstep(0.0, 0.035, abs(fract(st.x.mul(4.0).add(0.5)).sub(0.5))));
        const ridgeCol = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.2, 0.7), step(1.5, hero));
        const glow = ridgeCol.mul(ridge).mul(isCap).mul(step(0.5, hero)).mul(ign.level.mul(0.9))
            .mul(N.seamReveal);
        return neonAtmosphere(N, albedo.mul(light).add(glow), pc, vec3(0.0, 0.0, 0.0));
    })();
    material.userData.emitsBloom = true;
    return material;
}

function instancedSolids(geometry, material, items, name, kindOf) {
    const count = Math.max(1, items.length);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const looks = new Float32Array(count * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((item, i) => {
        p.set(item.x, item.y, item.z);
        s.set(item.width, item.height, item.depth);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        looks.set([item.tint ?? 0.5, kindOf(item), item.hero ?? 0, 0], i * 4);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    geometry.setAttribute('aGear', new THREE.InstancedBufferAttribute(looks, 4));
    mesh.computeBoundingSphere();
    return mesh;
}

/**
 * The beacons: one instanced draw of camera-facing sprites, pure added light.
 * @param {object} N neon uniforms
 * @param {{ x: number, y: number, z: number, phase: number, hue: number }[]} beacons
 */
function createBeacons(N, beacons) {
    const count = Math.max(1, beacons.length);
    const data = new Float32Array(count * 4);
    const looks = new Float32Array(count * 2);
    beacons.forEach((b, i) => {
        data.set([b.x, b.y, b.z, b.phase], i * 4);
        looks.set([b.hue, 0], i * 2);
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aBeacon', new THREE.InstancedBufferAttribute(data, 4));
    geometry.setAttribute('aBeaconLook', new THREE.InstancedBufferAttribute(looks, 2));
    geometry.instanceCount = beacons.length;
    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-beacons';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.forceSinglePass = true;
    material.uniforms = { uOpacity };
    material.userData.emitsBloom = true;
    const beacon = attribute('aBeacon', 'vec4');
    const look = attribute('aBeaconLook', 'vec2');
    const view = modelViewMatrix.mul(vec4(beacon.xyz, 1.0));
    // Never under ~2.5 px: a far beacon is a point of light, a near one a small lamp.
    const size = max(float(1.5), view.z.negate().mul(0.0042));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xy.add(positionGeometry.xy.mul(size)), view.z, 1.0));
    const breath = sin(N.uTime.mul(1.25).add(beacon.w.mul(6.283))).mul(0.42).add(0.58);
    const vBeacon = varying(
        mix(vec3(1.0, 0.1, 0.06), vec3(0.75, 0.9, 1.0), look.x).mul(breath).mul(N.seamReveal),
        'vBeaconLight',
    );
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r2 = q.dot(q);
        const core = exp(r2.mul(-9.0)).mul(1.9).add(exp(r2.mul(-2.4)).mul(0.22));
        return vec4(vBeacon.mul(core).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2))).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-roof-beacons';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    return mesh;
}

/**
 * Build the rooftops.
 * @param {object} N neon uniforms
 * @param {ReturnType<import('./odyssey-neon-architecture.js').planNeonArchitecture>['gear']} gear
 * @returns {THREE.Group} with userData.solids (the opaque draws) and userData.beacons
 */
export function createNeonRooftops(N, gear) {
    const group = new THREE.Group();
    group.name = 'neon-rooftops';
    const material = createGearMaterial(N);
    const solids = [];
    if (gear.boxes.length) {
        solids.push(instancedSolids(new THREE.BoxGeometry(1, 1, 1), material, gear.boxes, 'neon-roof-boxes', (item) => item.kind ?? 0));
    }
    if (gear.pyramids.length) {
        // A square pyramid whose base fills the unit square (a 4-sided cone turned 45 degrees).
        const cap = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, false);
        cap.rotateY(Math.PI / 4);
        solids.push(instancedSolids(cap, material, gear.pyramids, 'neon-roof-caps', () => NEON_GEAR.cap));
    }
    if (gear.tanks.length) {
        // A barrel with a conical lid, as one lathe (unit diameter, unit height).
        const profile = [
            new THREE.Vector2(0.0, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.26),
            new THREE.Vector2(0.54, 0.28), new THREE.Vector2(0.0, 0.5),
        ];
        solids.push(instancedSolids(new THREE.LatheGeometry(profile, 12), material, gear.tanks, 'neon-roof-tanks', () => NEON_GEAR.tank));
    }
    solids.forEach((mesh) => group.add(mesh));
    group.userData.solids = solids;
    if (gear.beacons.length) {
        const beacons = createBeacons(N, gear.beacons);
        group.add(beacons);
        group.userData.beacons = beacons;
    }
    return group;
}
