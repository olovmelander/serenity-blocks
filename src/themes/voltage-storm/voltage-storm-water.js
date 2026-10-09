/**
 * Voltage Storm — the flooded plain.
 *
 * A few centimetres of water lie over the plain as far as the far shore, so everything stands on
 * its own image. The sky's image costs one fetch: the water bends the view ray about its rippled
 * surface and looks the mirrored ray up in the sky target the backdrop already drew (the towers'
 * and the bolts' images are drawn as geometry on top, see the towers and the bolts).
 *
 * What moves it: two layers of wind ripple, the rings of raindrops near the lens, and the shock
 * rings a hard drop or a strike sends across it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    reflect,
    screenUV,
    sin,
    smoothstep,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    NOISE_SLOPE_GAIN, vsFlashLight, vsHash22, vsPart, vsShockRings,
} from './voltage-storm-tsl.js';

/** The plain's extent (metres): from behind the camera to past the far shore. */
const NEAR_Z = 400;
const FAR_Z = -32000;
const HALF_X = 34000;

/**
 * @param {object} u  shared storm uniforms
 * @param {object} options
 * @param {boolean} options.rings  raindrop rings near the lens
 */
export function createWater(u, { rings = true } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -HALF_X, 0, NEAR_Z, HALF_X, 0, NEAR_Z, HALF_X, 0, FAR_Z, -HALF_X, 0, FAR_Z,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'VoltageStormWater';
    material.fog = false;
    const vWorld = varyingProperty('vec3', 'vsWaterWorld');
    material.vertexNode = Fn(() => {
        vWorld.assign(positionGeometry);
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionGeometry, 1.0));
    })();

    material.colorNode = Fn(() => {
        const xz = vWorld.xz.toVar();
        const eye = cameraPosition;
        const toPoint = vec3(xz.x, 0.0, xz.y).sub(eye);
        const dist = max(length(toPoint), 0.01).toVar();
        const view = toPoint.div(dist).toVar();

        // ── The surface's slope ──
        // Wind ripple, calmer with distance (a far pixel covers metres: it sees the mean).
        const calm = exp(dist.div(-900.0)).mul(0.75).add(0.25);
        const drift = u.time.mul(vec2(0.021, 0.013));
        const fine = u.noise(xz.mul(0.071).add(drift)).zw;
        const broad = u.noise(xz.mul(0.0143).sub(drift.mul(0.4))).zw;
        const slope = fine.mul(0.045).add(broad.mul(0.075)).div(NOISE_SLOPE_GAIN).mul(calm)
            .mul(u.rainGain.mul(0.25).add(0.75))
            .toVar();
        if (rings) {
            // Raindrop rings: one drop per cell per beat, each a ring that widens and dies.
            const near = float(1.0).sub(smoothstep(40.0, 150.0, dist));
            const cellSize = float(2.6);
            const cell = floor(xz.div(cellSize));
            const beat = u.rainClock.mul(1.35).add(vsHash22(cell).x.mul(7.0));
            const born = floor(beat);
            const age = fract(beat);
            const at = vsHash22(cell.add(born.mul(13.0))).mul(0.7).add(0.15);
            const away = fract(xz.div(cellSize)).sub(at).mul(cellSize);
            const r = max(length(away), 0.01);
            const front = age.mul(1.5);
            const x = r.sub(front).mul(9.0);
            const ring = sin(x).mul(exp(x.mul(x).mul(-0.35))).mul(float(1.0).sub(age)).mul(float(1.0).sub(age));
            slope.addAssign(away.div(r).mul(ring).mul(0.05).mul(near)
                .mul(u.rainGain));
        }
        const shock = vsShockRings(u, xz);
        slope.addAssign(shock.slope.mul(0.16));

        // ── The mirrored sky ──
        const normal = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const bounced = reflect(view, normal).toVar();
        bounced.y.assign(max(bounced.y, 0.004));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(bounced, 0.0)).toVar();
        const w = max(clip.w, 0.001);
        const lookup = vec2(clip.x.div(w).mul(0.5).add(0.5), float(0.5).sub(clip.y.div(w).mul(0.5)));
        const sky = u.skyAt(clamp(lookup, vec2(0.002, 0.002), vec2(0.998, 0.998)));
        const cosine = clamp(dot(normal, view.negate()), 0.0, 1.0);
        const k = float(1.0).sub(cosine);
        const fresnel = k.mul(k).mul(k).mul(k).mul(k)
            .mul(0.98)
            .add(0.02);
        // The water's own dark, and a stroke's light scattered in the rain-roughened surface.
        const lit = vsFlashLight(u, vec3(xz.x, 0.0, xz.y), 'wf');
        const body = u.water.mul(u.breath.mul(0.5).add(0.5)).add(lit.mul(0.012));
        const col = mix(body, sky, fresnel).toVar();
        col.addAssign(shock.light.mul(0.3));

        // The far water goes to the colour of the shore above it.
        const shore = u.skyAt(vec2(screenUV.x, clamp(u.horizonV.sub(0.034), 0.002, 0.998)));
        col.assign(mix(col, shore, float(1.0).sub(exp(dist.div(-7000.0))).mul(0.9)));
        return vec4(col, 1.0);
    })();

    return vsPart('VoltageStormWater', geometry, material, -50);
}
