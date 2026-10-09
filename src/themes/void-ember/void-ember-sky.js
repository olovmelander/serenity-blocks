/**
 * Void Ember — the void.
 *
 * One dome, shaded per view direction and drawn last among the solids so it costs only where
 * the sky shows. The void is nearly empty: a cold, thin dust torn by darker lanes, a few far
 * stars, and nothing else — except that the dust near the ember is lit by it, a warm stain that
 * spreads and whitens as the star is blown up, and that a clear's wave is seen crossing the dust
 * as a ring of the wave's own colour.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cameraPosition,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    veHash33, vePart, veSolidMaterial, veWaveLight,
} from './void-ember-tsl.js';

/** Radius of the dome. */
export const SKY_RADIUS = 3000;

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {number} [opts.layers=3]     lattices of far stars
 * @param {boolean} [opts.dust=true]   the cold dust (two fetches)
 */
export function createSky(u, { layers = 3, dust = true } = {}) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
    const material = veSolidMaterial('VoidEmberSky');
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const pixel = length(fwidth(dir)).toVar();
        // The sky as a flat sheet in front of the camera (it never turns far from its rest pose).
        const g = dir.xy.div(max(dir.z.negate(), 0.25)).toVar();
        // Angle from the ember, in its own apparent radii.
        const away = length(dir.sub(u.starDir)).div(u.starSize).toVar();
        // What is not lit by the ember (the void itself, its cold dust, the far stars) is
        // raised as the iris closes, so the sky does not go black behind a white-hot star.
        const keep = u.iris.pow(0.72).toVar();
        const col = u.voidCol.mul(g.y.mul(0.25).add(1.0)).mul(keep).toVar();

        const density = float(0.0).toVar();
        const threads = float(0.0).toVar();
        if (dust) {
            const c1 = u.fbm(g.mul(0.36).add(vec2(0.13, 0.31))).toVar();
            // The second read is carried by the first: wisps, not blots.
            const c2 = u.fbm(g.mul(1.15).add(c1.rg.mul(0.42)).add(vec2(0.52, 0.07))).toVar();
            density.assign(smoothstep(0.3, 0.9, c1.r.mul(0.6).add(c2.g.mul(0.4))));
            const thread = float(1.0).sub(abs(c2.a.mul(2.0).sub(1.0)));
            threads.assign(thread.mul(thread).mul(thread).mul(smoothstep(0.3, 0.72, c1.b)));
            const lanes = smoothstep(0.42, 0.74, c2.r.mul(0.6).add(c1.a.mul(0.4)));
            const cold = mix(u.dustA, u.dustB, smoothstep(0.3, 0.72, c1.g));
            const veil = density.mul(density).mul(0.11).add(threads.mul(density).mul(0.12));
            col.addAssign(cold.mul(veil).mul(float(1.0).sub(lanes.mul(0.85))).mul(keep));
            density.mulAssign(float(1.0).sub(lanes.mul(0.6)));
        }

        // ── The ember lights the dust round it ──
        const spread = away.mul(0.62);
        const reach = float(1.0).div(spread.mul(spread).add(1.0)).toVar();
        reach.mulAssign(reach.sqrt());
        const lit = density.mul(0.55).add(threads.mul(0.55)).add(0.05);
        col.addAssign(u.skyLight.mul(lit).mul(reach).mul(0.03));

        // ── A clear's wave crossing the dust ──
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = veWaveLight(u, away);
            col.addAssign(wave.rgb.mul(density.mul(0.5).add(threads.mul(0.6)).add(0.04)).mul(0.4));
            col.addAssign(u.skyLight.mul(wave.w).mul(lit).mul(reach).mul(0.012));
        });

        // ── Far stars: one per cell of a lattice the sphere of directions cuts through ──
        const starLayer = (scale, chance, size, gain) => {
            const p = dir.mul(scale);
            const id = floor(p);
            const h = veHash33(id);
            const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
            const d = length(f.sub(dir.mul(dot(f, dir))));
            // Never smaller than a pixel: a sub-pixel star would shimmer as the camera drifts.
            const r = max(float(size), pixel.mul(scale).mul(0.8));
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(size).div(r).mul(float(size).div(r)));
            const mag = h.z.mul(h.z).mul(h.z).mul(h.z).mul(0.94)
                .add(0.06);
            const twinkle = sin(u.time.mul(h.y.mul(2.6).add(0.7)).add(h.x.mul(40.0))).mul(0.2).add(0.8);
            const tint = mix(u.starTint, vec3(1.0, 0.86, 0.72), smoothstep(0.72, 1.0, h.y));
            return tint.mul(core.mul(mag).mul(twinkle).mul(step(h.x, chance)).mul(gain));
        };
        const LAYERS = [[52.0, 0.3, 0.03, 5.0], [140.0, 0.3, 0.028, 1.9], [310.0, 0.26, 0.026, 0.9]];
        let stars = vec3(0.0);
        for (let i = 0; i < Math.min(layers, LAYERS.length); i++) {
            const [scale, chance, size, gain] = LAYERS[i];
            stars = stars.add(starLayer(scale, chance, size, gain));
        }
        // The ember's glare and the thick dust drown the faint ones.
        const glare = smoothstep(1.0, 3.4, away).mul(0.85).add(0.15);
        col.addAssign(stars.mul(glare).mul(float(1.0).sub(density.mul(0.55))).mul(keep));

        return vec4(col.mul(u.breath.mul(0.4).add(0.6)), 1.0);
    })();

    return vePart('VoidEmberSky', geometry, material, 5);
}
