/**
 * First Light — the sky: the flSky function drawn along the view ray on a sphere round the eye.
 *
 * It is drawn after the opaque pieces (renderOrder) with the depth test on and no depth write,
 * so it is shaded only where nothing covers it. The haze's grain is the baked fBm projected on
 * a plane far below the eye, so the light from below has perspective: it reads as a sea of soft
 * light seen from above, drifting, not as a gradient.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec2,
} from 'three/tsl';
import { flSky } from './intro-world-tsl.js';

/**
 * @param {object} u shared uniforms (time, haloDir, light)
 * @param {THREE.Texture} grainTex
 * @param {{ grain?: boolean, radius?: number }} [options]
 */
export function createSky(u, grainTex, { grain = true, radius = 420 } = {}) {
    const geometry = new THREE.SphereGeometry(radius, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    material.name = 'FirstLightSky';
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        const d = normalize(positionWorld.sub(cameraPosition)).toVar();
        let g = float(0.5);
        if (grain) {
            // A plane below the eye: the grain's place where the view ray meets it.
            const down = max(d.y.negate().add(0.07), 0.07);
            const drift = vec2(u.time.mul(0.0042), u.time.mul(-0.0023));
            const st = d.xz.div(down).mul(0.085).add(drift);
            const a = texture(grainTex, st).level(1.0).r;
            const b = texture(grainTex, st.mul(2.37).add(vec2(0.31, 0.77)).sub(drift.mul(1.6))).level(1.0).r;
            const raw = a.mul(0.62).add(b.mul(0.38));
            // Contrast to taste, and only below the eye line (above it the sky is clear).
            const shaped = smoothstep(0.22, 0.78, raw);
            g = mix(float(0.5), shaped, float(1.0).sub(smoothstep(-0.22, 0.08, d.y)));
        }
        return flSky(d, u.haloDir, u.light, g, u.time);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FirstLightSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    return {
        mesh,
        /** Keep the sphere round the eye. */
        follow(camera) {
            mesh.position.copy(camera.position);
            mesh.updateMatrixWorld();
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
