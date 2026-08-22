/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater moonshafts — volumetric light carved by the canopy.
 *
 * This is the Bauer image: not "fog with a glow in it" but light with the
 * branches cut out of it. The canopy arch already frames the top of frame; a
 * shadow-mapped volumetric turns that silhouette into the shape of the light
 * itself, which is the difference between an atmosphere and an event.
 *
 * Hard-won constraints (re-verified against the pinned three 0.185.1):
 *
 * 1. `VolumetricLightingModel` skips any light whose `.distance` is `undefined`
 *    (r185 VolumetricLightingModel.js:177). A DirectionalLight — the obvious
 *    choice for a moon — is therefore silently skipped and you get an empty
 *    volume with no error. The moon is driven by a SpotLight with a finite
 *    distance placed along the moon direction.
 * 2. The march is expensive per step, so it runs few steps with an IGN dither
 *    offset (`material.offsetNode`, r185) instead of many steps. Soft and
 *    slightly grainy is also MORE painterly than a clean geometric march —
 *    the softness is the point, not a compromise.
 * 3. The carve requires a LIVE shadow map: with `renderer.shadowMap.enabled`
 *    false the r185 model renders an unshadowed cone (no error, no canopy
 *    silhouette). The caller owns that toggle — see stillwater-runtime.
 */
import * as THREE from 'three/webgpu';
import {
    float,
    Fn,
    fract,
    mx_fractal_noise_float as materialXFractalNoise,
    screenCoordinate,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';

// Moon direction in world space, matching the disc the viewer can see.
const MOON_DIRECTION = Object.freeze({ x: 32, y: 17.5, z: -86 });
// The volume only needs to cover the canopy gap above the channel; a box that
// spans the whole scene wastes every step on empty air.
const VOLUME_SIZE = Object.freeze({ x: 78, y: 46, z: 96 });
const VOLUME_CENTRE = Object.freeze({ x: 4, y: 16, z: -26 });

/**
 * @param {object} options
 * @param {THREE.Object3D} options.root scene root to attach to
 * @param {number} [options.steps] raymarch steps; 16 with IGN dithering reads
 *   smooth — 12 left visible grain against the r185 accumulation
 * @returns {{ light: THREE.SpotLight, volume: THREE.Mesh, setIntensity: Function, dispose: Function }}
 */
export function createStillwaterShafts({ root, steps = 16 }) {
    const uIntensity = uniform(0.85);
    const uTime = uniform(0);

    // SpotLight, NOT DirectionalLight — see the header note. Distance must be
    // finite or the volumetric model skips it entirely and renders nothing.
    // Intensity is retuned for r185's accumulation: in-volume contribution is
    // intensity / distance^decay × cone, and the march multiplies it by
    // density × 0.01 × stepSize — the r181-era 2.4 summed to ~0.06 (invisible).
    // 35 / 23° are the IN-THEME calibration (live-tuned 2026-08-20 against the
    // real channel camera at z≈43, which looks straight down the beam axis:
    // wider/hotter values flood the whole valley as milky haze instead of a
    // moonlit veil — see the shafts A/B captures). The playground harness
    // reads dimmer at these values by design; the theme is the target.
    const light = new THREE.SpotLight(0xbfd4e6, 35, 260, Math.PI * 0.13, 0.55, 1.0);
    light.position.set(MOON_DIRECTION.x * 1.6, MOON_DIRECTION.y * 4.2, MOON_DIRECTION.z * 1.3);
    light.target.position.set(0, 0, -20);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 40;
    light.shadow.camera.far = 420;
    light.shadow.bias = -0.0006;
    light.name = 'stillwater-moon-shaft-light';
    root.add(light);
    root.add(light.target);

    const material = new THREE.VolumeNodeMaterial();
    material.steps = steps;
    // The header's "composited additively" — VolumeNodeMaterial defaults to
    // NormalBlending with opacity 1, which would paint the accumulated light
    // as an OPAQUE box over the scene. Light shafts add; black adds nothing.
    material.blending = THREE.AdditiveBlending;
    // IGN (interleaved gradient noise) per-pixel march offset — r185's
    // `offsetNode` hook, multiplied by stepSize internally. This is what lets
    // 12 steps read as a smooth volume instead of 12 banded shells.
    material.offsetNode = fract(
        fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)))
            .mul(52.9829189),
    );
    // Density modulation. The model calls `scatteringNode({ positionRay })` and
    // MULTIPLIES the accumulated per-step light by the result, so it must
    // sample the ray position — `positionWorld` is not the march sample point
    // inside the loop — and it must sit around unity.
    //
    // RESOLVED 2026-08-20 (was BLOCKED 2026-07-28 with `unresolved value
    // 'null'` at `scatteringDensity * null`): the four r181 bisection
    // hypotheses were all correct to be eliminated — the fault was upstream.
    // The repo never enables shadow maps, so AnalyticLightNode left
    // `shadowNode` null, and r181's volumetric model multiplied by it
    // UNCONDITIONALLY (r181 VolumetricLightingModel.js:154). r185 guards the
    // multiply (r185 VolumetricLightingModel.js:183-185), which both fixes the
    // WGSL error and explains constraint 3 in the header: without a live
    // shadow map the guard simply skips the carve.
    //
    // r185 accumulation this density is tuned against (front-to-back):
    // stepLight = Σ(lightColor × shadow) × thisNode × 0.01; outgoing +=
    // stepLight × transmittance × stepSize; Beer falloff exp(-density×0.01×Δ).
    material.scatteringNode = Fn(({ positionRay }) => {
        // Thicker low in the valley where the mist already sits.
        const lowBand = smoothstep(2, 24, positionRay.y).oneMinus();
        // Slow fractal so the shafts have internal structure rather than
        // reading as clean geometric cones.
        const drift = materialXFractalNoise(
            positionRay.mul(0.045).add(vec3(0, uTime.mul(0.02), 0)),
            3,
            2.0,
            0.5,
        ).mul(0.5).add(0.5);
        // Fade the density to zero before the box faces: without this the
        // march fills the whole volume and its silhouette reads as a slab
        // edge against the night. (Reversed smoothstep edges are valid WGSL —
        // see the skill's corrected note.)
        const local = positionRay
            .sub(vec3(VOLUME_CENTRE.x, VOLUME_CENTRE.y, VOLUME_CENTRE.z))
            .div(vec3(VOLUME_SIZE.x * 0.5, VOLUME_SIZE.y * 0.5, VOLUME_SIZE.z * 0.5));
        const edgeFade = smoothstep(1.0, 0.7, local.x.abs())
            .mul(smoothstep(1.0, 0.7, local.z.abs()))
            .mul(smoothstep(1.0, 0.82, local.y.abs()));
        return float(1.0)
            .add(lowBand.mul(0.9))
            .mul(drift.mul(0.7).add(0.6))
            .mul(edgeFade)
            .mul(uIntensity);
    });

    const volume = new THREE.Mesh(
        new THREE.BoxGeometry(VOLUME_SIZE.x, VOLUME_SIZE.y, VOLUME_SIZE.z),
        material,
    );
    volume.position.set(VOLUME_CENTRE.x, VOLUME_CENTRE.y, VOLUME_CENTRE.z);
    volume.name = 'stillwater-moon-shafts';
    // The volume is a participating medium, not a surface: it must never write
    // depth or occlude the scene it is scattering through.
    volume.renderOrder = 6;
    volume.frustumCulled = false;
    root.add(volume);

    return {
        light,
        volume,
        material,
        update(time) {
            uTime.value = time;
        },
        /** Session arc and quality both scale the shafts down, never up. */
        setIntensity(value) {
            uIntensity.value = Math.max(0, Math.min(1.4, Number(value) || 0));
        },
        dispose() {
            volume.removeFromParent();
            volume.geometry.dispose();
            material.dispose();
            light.removeFromParent();
            light.target.removeFromParent();
            light.dispose?.();
        },
    };
}

export default createStillwaterShafts;
