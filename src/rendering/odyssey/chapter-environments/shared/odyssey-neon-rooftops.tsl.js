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
    clamp,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    modelViewMatrix,
    normalGeometry,
    normalize,
    oneMinus,
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
import { NEON_GEAR_KIND } from './odyssey-neon-architecture.js';
import { NEON_KIT_KIND } from './odyssey-neon-wall-kit.js';
import {
    neonAtmosphere, neonCityPos, neonGlow, neonIgnition, neonSpireLight, neonWallGlow,
} from './odyssey-neon-light.tsl.js';
import { neonSkyLite } from './odyssey-neon-sky.tsl.js';

/** Gear kinds (the shader's `kind`): the roofs', then the wall kit's (odyssey-neon-wall-kit.js). */
export const NEON_GEAR = Object.freeze({ ...NEON_GEAR_KIND, ...NEON_KIT_KIND });

function createGearMaterial(N) {
    const aGear = varying(attribute('aGear', 'vec4'), 'vGearLook').setInterpolation('flat', 'either');
    const pcVarying = neonCityPos(N, 'vGearPos');
    const nVarying = varying(normalGeometry, 'vGearNormal');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-roof-gear';
    material.fog = false;
    const G = NEON_GEAR;
    material.colorNode = Fn(() => {
        const pc = pcVarying.toVar();
        const n = normalize(nVarying).toVar();
        const tint = aGear.x;
        const kind = floor(aGear.y.add(0.5)).toVar();
        const hero = aGear.z;
        const glowKind = floor(aGear.w.add(0.5)).toVar();
        const st = clamp(uv(), 0.0, 1.0).toVar();
        const is = (k) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
        const isUnit = is(G.unit).add(is(G.duct)).add(is(G.wallUnit)).toVar();
        const isCap = is(G.cap).toVar();
        const isTank = is(G.tank).toVar();
        const isFin = is(G.fin).toVar();
        const isConcrete = is(G.slab).add(is(G.front)).toVar();
        const isAwning = is(G.awning).toVar();
        const isLamp = is(G.lamp).toVar();
        const isSignal = is(G.signal).toVar();
        const isKit = step(9.5, kind).toVar();
        const upward = step(0.5, n.y);
        const sideways = step(abs(n.y), 0.5);
        // Steel for masts, legs, pipes and stairs; painted sheet for the air handlers and ducts
        // (louvres down their sides); weathered copper for the caps; banded timber for the tanks;
        // the tower's own concrete for a balcony.
        const steel = vec3(0.03, 0.032, 0.042).add(vec3(0.02, 0.02, 0.022).mul(isKit));
        const louvre = step(0.5, fract(st.y.mul(7.0))).mul(0.35).add(0.65);
        const sheet = vec3(0.1, 0.11, 0.13).mul(mix(float(1.0), louvre, sideways));
        const copper = mix(vec3(0.045, 0.1, 0.09), vec3(0.11, 0.07, 0.05), smoothstep(0.35, 0.65, tint));
        const hoop = float(1.0).sub(step(0.82, fract(st.y.mul(4.0))).mul(0.55));
        const timber = vec3(0.12, 0.072, 0.046).mul(hoop);
        const concrete = mix(
            mix(vec3(0.2, 0.15, 0.13), vec3(0.1, 0.125, 0.17), smoothstep(0.2, 0.3, tint)),
            mix(vec3(0.17, 0.09, 0.13), vec3(0.08, 0.135, 0.15), smoothstep(0.7, 0.8, tint)),
            smoothstep(0.45, 0.55, tint),
        ).mul(0.78);
        const albedo = mix(
            mix(mix(mix(mix(steel, sheet, isUnit), copper, isCap), timber, isTank), concrete, isConcrete),
            vec3(0.09, 0.095, 0.12),
            isFin,
        );
        // The sky on the side it shows, the street's glow from below, the spire's rose, and on
        // the boulevard's walls the signs' spill.
        const ign = neonIgnition(N, pc);
        const hAbove = max(pc.y.sub(STREET_Y), 0.0);
        const sky = neonSkyLite(N.sky, normalize(vec3(n.x, n.y.add(0.5), n.z))).mul(mix(float(0.55), float(1.5), isCap));
        const bounce = neonGlow(N, pc, 1).mul(ign.level).mul(exp(hAbove.mul(-1 / 45))).mul(0.35)
            .mul(max(n.y.negate().add(0.6), 0.0));
        const rim = N.sky.hazeSun.mul(max(n.dot(N.sky.sunDir), 0.0)).mul(0.55);
        const spill = neonWallGlow(N, pc).mul(ign.level).mul(isKit).mul(0.9);
        const light = sky.add(bounce).add(rim).add(neonSpireLight(N, pc, n)).add(spill);
        // A cap's four ridges: lit in the tower's neon on the hero towers once the city is on.
        const ridge = float(1.0).sub(smoothstep(0.0, 0.035, abs(fract(st.x.mul(4.0).add(0.5)).sub(0.5))));
        const heroCol = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.2, 0.7), step(1.5, hero));
        // A fin's outer edge is a line of the same neon.
        const finEdge = float(1.0).sub(smoothstep(0.0, 0.16, abs(st.x.sub(0.5)))).mul(sideways);
        // Lamps: a colour each (NEON_KIT_GLOW).
        const lampCol = mix(
            mix(
                mix(mix(vec3(1.0, 0.62, 0.3), vec3(0.85, 0.92, 1.0), step(1.5, glowKind)), vec3(0.1, 0.85, 1.0), step(2.5, glowKind)),
                vec3(1.0, 0.2, 0.55),
                step(3.5, glowKind),
            ),
            vec3(1.0, 0.55, 0.15),
            step(4.5, glowKind),
        ).toVar();
        // An awning is cloth with the shop's light under it: stripes, brightest along its middle.
        const stripe = step(0.5, fract(st.x.mul(mix(float(5.0), float(9.0), tint)))).mul(0.45).add(0.55);
        const awning = lampCol.mul(stripe).mul(upward.mul(0.34).add(0.1));
        // The signals over a crossing: red a while, then green, each crossing on its own clock.
        const phase = fract(N.uTime.mul(1 / 23).add(floor(pc.z.div(40.0)).mul(0.37)).add(tint));
        const signal = mix(vec3(1.0, 0.07, 0.05), vec3(0.1, 1.0, 0.4), step(0.55, phase))
            .mul(step(abs(n.z), 0.5).mul(0.25).add(step(0.5, abs(n.z)))).mul(1.7);
        const glow = heroCol.mul(ridge.mul(isCap).add(finEdge.mul(isFin))).mul(step(0.5, hero)).mul(ign.level.mul(0.9))
            .add(awning.mul(isAwning).mul(ign.level))
            .add(lampCol.mul(isLamp).mul(1.9))
            .add(signal.mul(isSignal))
            .mul(N.seamReveal);
        const lit = albedo.mul(light).mul(oneMinus(isLamp.add(isSignal).min(1.0).mul(0.8)));
        return neonAtmosphere(N, lit.add(glow), pc, vec3(0.0, 0.0, 0.0));
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
    const still = new THREE.Quaternion();
    const axis = new THREE.Vector3(1, 0, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((item, i) => {
        p.set(item.x, item.y, item.z);
        s.set(item.width, item.height, item.depth);
        // A stair is tilted along its wall (about the corridor's x).
        mesh.setMatrixAt(i, m.compose(p, item.tilt ? q.setFromAxisAngle(axis, item.tilt) : still, s));
        looks.set([item.tint ?? 0.5, kindOf(item), item.hero ?? 0, item.glow ?? 0], i * 4);
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
 * @param {{ boxes: object[] } | null} [kit] the walls' kit (odyssey-neon-wall-kit.js), drawn with the boxes
 * @returns {THREE.Group} with userData.solids (the opaque draws) and userData.beacons
 */
export function createNeonRooftops(N, gear, kit = null) {
    const group = new THREE.Group();
    group.name = 'neon-rooftops';
    const material = createGearMaterial(N);
    const solids = [];
    // The roofs' boxes and the walls' kit are one draw.
    const boxes = kit?.boxes?.length ? gear.boxes.concat(kit.boxes) : gear.boxes;
    if (boxes.length) {
        solids.push(instancedSolids(new THREE.BoxGeometry(1, 1, 1), material, boxes, 'neon-roof-boxes', (item) => item.kind ?? 0));
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
