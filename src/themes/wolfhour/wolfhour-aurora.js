/**
 * Wolfhour's northern lights: the sky's answer to the pack.
 *
 * Curtains of light hang behind the mountains, between the stars and the moon: each a ribbon whose
 * foot wanders along the sky, sharp along its lower edge and fading upward, combed into rays that
 * drift along it, green at the foot through teal to violet at its top. At rest there is none. A
 * deep-midnight hour lets a low, faint ribbon show over the far range; a four-line clear lights
 * the curtains for as long as the howl lasts; a perfect clear or a fever raises them over the
 * whole sky. `level` is how bright (0 none), `reach` how high and how many (0 one low ribbon over
 * the horizon .. 1 three curtains to the top of the frame).
 *
 * One additive quad, three reads of the sky's noise tile; not built on the lowest tier. Slow by
 * nature: nothing in it flickers.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, exp, float, max, mix, positionGeometry, sin, smoothstep, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { createWolfhourNightLight, makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/** The plane (world units) and where it hangs: behind the moon and its cloud, before the stars. */
const PLANE = Object.freeze({
    width: 6200, height: 1100, y: 210, z: -4500, response: 0.945,
});
/** The curtains: where each foot rests (plane y), how tall it stands, its sway, its share of the light. */
export const AURORA_CURTAINS = Object.freeze([
    Object.freeze({
        foot: -150, tall: 250, sway: 44, wave: 0.0021, drift: 0.021, gain: 1, from: 0,
    }),
    Object.freeze({
        foot: -20, tall: 330, sway: 62, wave: 0.0016, drift: -0.016, gain: 0.8, from: 0.3,
    }),
    Object.freeze({
        foot: 120, tall: 420, sway: 80, wave: 0.0012, drift: 0.012, gain: 0.7, from: 0.62,
    }),
]);
/** The light at a curtain's foot, its middle and its top (linear, before the grade). */
const FOOT = vec3(0.07, 0.42, 0.2);
const BODY = vec3(0.05, 0.3, 0.3);
const TOP = vec3(0.24, 0.1, 0.42);

/** Creates the aurora (no renderer); null on the lowest tier. */
export function createWolfhourAurora({
    quality = 'High', noiseMap = null, nightLight = createWolfhourNightLight(),
} = {}) {
    if (quality === 'Minimal') return null;
    const ownsNoise = !noiseMap;
    const noise = noiseMap || makeWolfhourNoiseTexture();
    const uTime = uniform(0);
    const uLevel = uniform(0);
    const uReach = uniform(0);
    // Low draws two curtains; the third (the highest) needs a tier that can spare its reads.
    const curtains = quality === 'Low' ? AURORA_CURTAINS.slice(0, 2) : AURORA_CURTAINS;
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour northern lights',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const light = Fn(() => {
        const p = positionGeometry.xy.toVar();
        const total = vec3(0).toVar();
        // A few curtains, each written once (three at most: a table would cost more than it saves).
        for (const [index, curtain] of curtains.entries()) {
            const seed = 0.17 + index * 0.31;
            // The foot wanders: two slow waves and a broad read of the noise.
            const wander = texture(noise, vec2(
                p.x.mul(0.00021).add(uTime.mul(curtain.drift * 0.02)).add(seed),
                float(seed * 3.7).add(uTime.mul(0.0011)),
            )).r;
            const foot = float(curtain.foot)
                .add(sin(p.x.mul(curtain.wave).add(uTime.mul(curtain.drift * 6)).add(index * 2.1)).mul(curtain.sway))
                .add(sin(p.x.mul(curtain.wave * 2.7).sub(uTime.mul(curtain.drift * 9)).add(index * 4.3))
                    .mul(curtain.sway * 0.4))
                .add(wander.sub(0.5).mul(curtain.sway * 3.4));
            const h = p.y.sub(foot).toVar();
            // Rays: the tile read along the curtain only, so they stand upright; they drift along it.
            const rays = texture(noise, vec2(
                p.x.mul(0.0026).add(uTime.mul(curtain.drift)).add(seed * 5),
                h.mul(0.00022).add(seed),
            )).g;
            const fine = texture(noise, vec2(
                p.x.mul(0.0085).sub(uTime.mul(curtain.drift * 1.7)).add(seed * 9),
                h.mul(0.0004).add(0.4),
            )).g;
            const comb = rays.mul(0.85).add(fine.mul(0.3)).toVar();
            // The taller rays reach higher: the curtain's top is ragged, its foot one sharp line.
            const tall = float(curtain.tall).mul(comb.mul(0.9).add(0.45)).mul(uReach.mul(0.5).add(0.6));
            const lift = h.div(max(tall, 1)).toVar();
            // (A bright hem along the foot, and the long veil above it.)
            const body = smoothstep(-16, 3, h).mul(exp(lift.max(0).mul(-2.9)).add(exp(lift.max(0).mul(-16)).mul(0.9)))
                .mul(float(1).sub(smoothstep(0.9, 1.5, lift)));
            const bright = comb.mul(comb).mul(1.7).add(0.1);
            // Along its length a curtain comes and goes in patches.
            const patch = smoothstep(0.43, 0.68, wander.add(uReach.mul(0.07)));
            const shown = smoothstep(curtain.from, curtain.from + 0.3, uReach.add(0.001));
            const colour = mix(mix(FOOT, BODY, smoothstep(0, 0.4, lift)), TOP, smoothstep(0.3, 1, lift));
            total.addAssign(colour.mul(body).mul(bright).mul(patch).mul(shown)
                .mul(curtain.gain));
        }
        // It fades into the frame's sides and below the far range, and the hour of the night's
        // sky dims it a little as the day comes (the stars' share).
        const sides = smoothstep(0, 0.08, positionGeometry.x.div(PLANE.width).add(0.5))
            .mul(smoothstep(0, 0.08, float(0.5).sub(positionGeometry.x.div(PLANE.width))));
        const day = nightLight.uStars.mul(0.5).add(0.5).min(1);
        return vec4(total.mul(sides).mul(day).mul(uLevel), 1);
    })();
    material.colorNode = light.rgb;
    material.opacityNode = float(1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE.width, PLANE.height), material);
    mesh.name = 'Wolfhour northern lights';
    mesh.position.set(0, PLANE.y, PLANE.z);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return {
        mesh,
        /** How many curtains this tier draws. */
        curtains: curtains.length,
        applyParallax(camera) {
            const cameraX = Number.isFinite(camera?.position?.x) ? camera.position.x : 0;
            const cameraY = Number.isFinite(camera?.position?.y) ? camera.position.y : 0;
            mesh.position.x = cameraX * PLANE.response;
            mesh.position.y = PLANE.y + cameraY * PLANE.response;
        },
        /** `level` 0..1.6 how bright, `reach` 0..1 how high and how many curtains. */
        update(time, level = 0, reach = 0) {
            uTime.value = Number.isFinite(time) ? time : 0;
            uLevel.value = Math.max(0, Math.min(1.6, Number.isFinite(level) ? level : 0));
            uReach.value = Math.max(0, Math.min(1, Number.isFinite(reach) ? reach : 0));
            // Nothing to draw: the quad costs nothing while the sky is dark (the theme warms its
            // parked drawables, so its pipeline is ready before the first howl).
            mesh.visible = uLevel.value > 0.002;
        },
        get level() { return uLevel.value; },
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
            if (ownsNoise) noise.dispose();
        },
    };
}
