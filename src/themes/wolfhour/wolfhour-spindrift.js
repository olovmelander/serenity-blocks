/**
 * Spindrift: the night wind tearing snow off Wolfhour's two summits. Each plume is one transparent
 * quad anchored at a summit on the massif's crest (it moves with the massif) and streaming
 * downwind (to the right). Two reads of the sky's noise tile, scrolling along the plume, give it
 * torn, gusting edges; a slow envelope lets each plume die down and rise again.
 * Authored in world units; a plume's origin is its summit.
 */
import * as THREE from 'three/webgpu';
import {
    exp, float, mix, smoothstep, texture, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/** The plumes: which summit (local x on the massif), how long and how strong, and its gust phase. */
export const SPINDRIFT_PLUMES = Object.freeze([
    Object.freeze({
        name: 'Wolfhour spindrift (left summit)', x: -712, length: 280, height: 100, strength: 0.5, phase: 0.2,
    }),
    Object.freeze({
        name: 'Wolfhour spindrift (right summit)', x: 660, length: 240, height: 86, strength: 0.42, phase: 2.9,
    }),
]);

/** How strongly a plume blows at `time` (0.35..1): slow gusts that never quite stop. */
export function spindriftGust(time, phase = 0) {
    const t = Number.isFinite(time) ? time : 0;
    const g = Math.sin(t * 0.21 + phase) * 0.5 + Math.sin(t * 0.083 + phase * 1.7) * 0.5;
    return 0.35 + 0.65 * (g * 0.5 + 0.5) ** 1.5;
}

function createPlumeMaterial(plume, noiseMap, uTime, uGust, uWind) {
    const material = new THREE.MeshBasicNodeMaterial({
        name: plume.name, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const p = uv();
    const along = p.x;
    // The plume rises a little as it leaves the summit and spreads as it goes.
    const centre = along.mul(along).mul(0.18).add(0.36);
    const half = along.mul(0.24).add(0.1);
    const drift = uTime.mul(0.09);
    // Low-frequency reads only: the noise tile has no mips, so a finer read would sparkle.
    const torn = texture(noiseMap, vec2(along.mul(0.9).sub(drift).add(plume.phase), p.y.mul(0.45))).r;
    const curl = texture(noiseMap, vec2(along.mul(1.6).sub(drift.mul(1.8)), p.y.mul(0.8).add(plume.phase))).r;
    const across = p.y.sub(centre).add(torn.sub(0.5).mul(along.mul(0.4))).div(half);
    const body = exp(across.mul(across).mul(-1.5));
    const shreds = smoothstep(0.18, 0.8, torn.mul(0.55).add(curl.mul(0.45)));
    // Dense at the summit, gone well before the quad ends; the gust stretches it out.
    const reach = smoothstep(0, 0.035, along)
        .mul(float(1).sub(smoothstep(uGust.mul(0.5), uGust.mul(0.5).add(0.45), along)));
    const root = float(1).sub(smoothstep(0.02, 0.3, along)).mul(0.5).add(0.5);
    material.opacityNode = body.mul(shreds.mul(0.75).add(0.25)).mul(reach).mul(root)
        .mul(plume.strength)
        .mul(uGust.mul(0.5).add(0.5))
        // Play stirs the wind: the plumes thicken (uWind, 0 at rest).
        .mul(uWind.mul(0.7).add(1))
        .clamp(0, 1);
    material.colorNode = mix(vec3(0.27, 0.32, 0.45), vec3(0.16, 0.2, 0.3), along);
    return material;
}

/** Creates the plumes (no renderer). Stand each on the massif with `plume.userData.summitX`. */
export function createWolfhourSpindrift({ quality = 'High', noiseMap = null } = {}) {
    const ownsNoise = !noiseMap;
    const noise = noiseMap || makeWolfhourNoiseTexture();
    const uTime = uniform(0);
    const uWind = uniform(0);
    const plumes = [];
    if (quality !== 'Minimal') {
        for (const plume of SPINDRIFT_PLUMES) {
            const uGust = uniform(1);
            const geometry = new THREE.PlaneGeometry(plume.length, plume.height);
            // The summit is the quad's left edge, a third of the way up.
            geometry.translate(plume.length / 2, plume.height * 0.14, 0);
            const mesh = new THREE.Mesh(geometry, createPlumeMaterial(plume, noise, uTime, uGust, uWind));
            mesh.name = plume.name;
            mesh.userData.summitX = plume.x;
            mesh.userData.phase = plume.phase;
            mesh.userData.uGust = uGust;
            plumes.push(mesh);
        }
    }
    return {
        plumes,
        /**
         * `wind` (0..~1.2, 0 at rest) is how hard play drives the night wind: the gusts reach
         * further (never past the plume's quad) and the plumes thicken.
         */
        update(time, wind = 0) {
            const w = Number.isFinite(wind) ? Math.max(0, Math.min(1.2, wind)) : 0;
            uTime.value = Number.isFinite(time) ? time : 0;
            uWind.value = w;
            for (const mesh of plumes) {
                const gust = spindriftGust(time, mesh.userData.phase);
                mesh.userData.uGust.value = Math.min(1.1, gust * (1 + w * 0.5) + w * 0.12);
            }
        },
        dispose() {
            for (const mesh of plumes) {
                mesh.removeFromParent();
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            if (ownsNoise) noise.dispose();
            plumes.length = 0;
        },
    };
}
