/**
 * Neon District — the sky over the canyon.
 *
 * A dome that follows the camera. At the horizon it is exactly the haze the street fades into
 * (ndHaze), so the far end of the canyon and the feet of the megatowers dissolve into it. Above:
 * a ceiling of smog lit from below by the city (two fetches of the baked noise, drifting), a moon
 * that never quite gets through, and sheet lightning that the gameplay drives (`storm`).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import { ndHaze } from './neon-district-tsl.js';

/** Unit direction to the veiled moon (right of the street, over the roofs). */
export const MOON_DIR = Object.freeze((() => {
    const az = 26 * (Math.PI / 180);
    const el = 30 * (Math.PI / 180);
    return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
})());

/**
 * @param {object} u  shared district uniforms
 * @returns {{ mesh: THREE.Mesh, material: THREE.Material, geometry: THREE.BufferGeometry }}
 */
export function createSky(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDistrictSky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = false;

    material.colorNode = Fn(() => {
        const d = normalize(positionWorld.sub(cameraPosition));
        const up = max(d.y, 0.0);
        const base = ndHaze(u, d).toVar();

        // ── Smog ceiling: the view ray meets a slab overhead ──
        const cuv = vec2(d.x, d.z).div(up.add(0.14));
        const drift = u.time.mul(0.0032);
        const n1 = u.noise(cuv.mul(0.11).add(vec2(drift, drift.mul(0.6)))).r;
        const n2 = u.noise(cuv.mul(0.29).add(vec2(drift.mul(-1.7), drift.mul(0.9)))).g;
        const body = n1.mul(0.64).add(n2.mul(0.36));
        const cloud = smoothstep(0.34, 0.72, body);
        const veil = smoothstep(0.02, 0.22, up);

        // The city lights the cloud bottoms: rose over one bank, cyan over the next.
        const tint = mix(u.accentB, u.accentA, smoothstep(0.35, 0.65, u.noise(cuv.mul(0.045).add(3.7)).b));
        const underlight = mix(u.hazeLow.mul(2.2), tint.mul(0.085), 0.42)
            .mul(exp(up.mul(-1.25)).mul(1.5).add(0.22))
            .mul(float(1.0).add(u.power.mul(0.35)));
        const gap = vec3(0.004, 0.005, 0.014);
        const ceiling = mix(gap, underlight, cloud);
        base.assign(mix(base, ceiling, veil));

        // ── The moon behind the smog ──
        const moon = vec3(MOON_DIR[0], MOON_DIR[1], MOON_DIR[2]);
        const md = max(dot(d, moon), 0.0);
        const disc = smoothstep(0.9988, 0.9994, md);
        const corona = pow(md, 90.0).mul(0.42).add(pow(md, 900.0).mul(1.4));
        const thin = float(1.0).sub(cloud.mul(0.82));
        base.addAssign(vec3(0.62, 0.74, 1.0).mul(corona.mul(0.5).add(disc.mul(thin).mul(1.6))).mul(veil).mul(0.55));

        // ── Sheet lightning inside the smog ──
        const cell = u.noise(cuv.mul(0.05).add(vec2(u.time.mul(0.011), 1.3))).a;
        const sheet = smoothstep(0.52, 0.8, cell).mul(cloud.mul(0.7).add(0.3));
        base.addAssign(mix(vec3(0.55, 0.7, 1.0), tint, 0.25).mul(sheet).mul(u.storm).mul(veil)
            .mul(2.4));
        return base;
    })();

    const geometry = new THREE.SphereGeometry(1250, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -100;
    return { mesh, material, geometry };
}
