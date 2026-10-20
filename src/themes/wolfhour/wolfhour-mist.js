/**
 * Wolfhour's valley mist: soft moonlit banks lying between the ranges. Each bank is one
 * transparent quad at a depth between two ranges, so the nearer range cuts through it while the
 * farther one fades into it. Two scrolling reads of the sky's noise tile shape long, slow wisps
 * with a ragged top; the valley air baked into the terrain (wolfhour-landscape-bake.js) uses the
 * same colours, so a bank melts into the range behind it instead of reading as a card.
 * Authored for the orthographic 1000-unit-tall view; parallax follows the ranges around it.
 */
import * as THREE from 'three/webgpu';
import {
    float, mix, positionGeometry, smoothstep, texture, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/**
 * The banks, farthest first. `y` is the bank's centre, `response` its share of the camera's
 * movement (between the two ranges it lies between: 0.18, 0.48, 0.88, 1.24).
 */
export const MIST_BANKS = Object.freeze([
    Object.freeze({
        name: 'Wolfhour far valley mist',
        z: -1700,
        y: -70,
        height: 300,
        response: 0.33,
        opacity: 0.55,
        drift: 0.55,
        seed: 0.81,
        minTier: 2,
    }),
    Object.freeze({
        name: 'Wolfhour massif foot mist',
        z: -1180,
        y: -215,
        height: 330,
        response: 0.68,
        opacity: 0.74,
        drift: 0.8,
        seed: 0.13,
        minTier: 1,
    }),
    Object.freeze({
        name: 'Wolfhour spur foot mist',
        z: -720,
        y: -385,
        height: 300,
        response: 1.06,
        opacity: 0.8,
        drift: 1.1,
        seed: 0.57,
        minTier: 0,
    }),
]);

const TIERS = Object.freeze({
    Minimal: 0, Low: 1, Medium: 2, High: 2, Ultra: 2, Extreme: 2,
});

/** The mist's colour at a bank's foot and at its moonlit top (linear, before the grade). */
const MIST_FOOT = vec3(0.046, 0.064, 0.108);
const MIST_TOP = vec3(0.07, 0.094, 0.15);

function createBankMaterial(bank, noiseMap, uTime, uGlow) {
    const material = new THREE.MeshBasicNodeMaterial({
        name: bank.name,
        transparent: true,
        depthWrite: false,
        depthTest: true,
    });
    const p = positionGeometry.xy;
    const v = uv().y;
    const u = uv().x;
    const drift = uTime.mul(bank.drift);
    // Two reads stretched along the valley: a slow broad roll and a faster finer wisp
    // travelling the other way, so the bank breathes rather than slides as one sheet.
    const broad = texture(noiseMap, vec2(
        p.x.mul(0.00042).add(drift.mul(0.0042)).add(bank.seed),
        p.y.mul(0.0026).add(bank.seed * 3.1),
    )).r;
    const wisp = texture(noiseMap, vec2(
        p.x.mul(0.0011).sub(drift.mul(0.0066)).add(bank.seed * 7.3),
        p.y.mul(0.0058).sub(drift.mul(0.0012)),
    )).r;
    const n = broad.mul(0.64).add(wisp.mul(0.36));
    const top = float(1).sub(smoothstep(0.22, 0.96, v.add(n.sub(0.5).mul(0.62))));
    const foot = smoothstep(0, 0.14, v);
    const sides = smoothstep(0, 0.07, u).mul(smoothstep(0, 0.07, float(1).sub(u)));
    const body = n.mul(0.75).add(0.5);
    material.opacityNode = top.mul(foot).mul(sides).mul(body).mul(bank.opacity)
        .clamp(0, 1);
    // The moon stands over the left: that side of every bank carries more of its light.
    const moonSide = smoothstep(700, -1300, p.x).mul(0.36).add(0.82);
    material.colorNode = mix(MIST_FOOT, MIST_TOP, smoothstep(0.2, 0.85, v))
        .mul(moonSide).mul(uGlow.mul(0.35).add(1));
    return material;
}

/** Creates the mist banks for a quality tier (no renderer, no texture fetch). */
export function createWolfhourMist({ scene = null, quality = 'High', noiseMap = null } = {}) {
    const tier = TIERS[quality] ?? 2;
    const ownsNoise = !noiseMap;
    const noise = noiseMap || makeWolfhourNoiseTexture();
    const group = new THREE.Group();
    group.name = 'Wolfhour valley mist';
    const uTime = uniform(0);
    const uGlow = uniform(0);
    const banks = [];
    for (const bank of MIST_BANKS) {
        if (bank.minTier > tier) continue;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(5200, bank.height),
            createBankMaterial(bank, noise, uTime, uGlow),
        );
        mesh.name = bank.name;
        mesh.position.set(0, bank.y, bank.z);
        mesh.userData.response = bank.response;
        mesh.userData.baseY = bank.y;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        banks.push(mesh);
        group.add(mesh);
    }
    scene?.add(group);
    return {
        group,
        banks,
        applyParallax(camera) {
            const cameraX = Number.isFinite(camera?.position?.x) ? camera.position.x : 0;
            const cameraY = Number.isFinite(camera?.position?.y) ? camera.position.y : 0;
            for (const mesh of banks) {
                mesh.position.x = cameraX * (1 - mesh.userData.response);
                mesh.position.y = mesh.userData.baseY + cameraY * (1 - mesh.userData.response);
                mesh.updateMatrix();
            }
        },
        /** `glow` (0..1.5) lifts the banks' moonlight for gameplay reactions and the howl. */
        update(time, glow = 0) {
            uTime.value = Number.isFinite(time) ? time : 0;
            uGlow.value = Math.max(0, Math.min(1.5, Number.isFinite(glow) ? glow : 0));
        },
        dispose() {
            group.removeFromParent();
            for (const mesh of banks) {
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            if (ownsNoise) noise.dispose();
            banks.length = 0;
            group.clear();
        },
    };
}
