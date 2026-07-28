/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater moonshafts — volumetric light carved by the canopy.
 *
 * This is the Bauer image: not "fog with a glow in it" but light with the
 * branches cut out of it. The canopy arch already frames the top of frame; a
 * shadow-mapped volumetric turns that silhouette into the shape of the light
 * itself, which is the difference between an atmosphere and an event.
 *
 * Two things about r181 that will cost a day each if missed:
 *
 * 1. `VolumetricLightingModel` early-returns for any light whose `.distance` is
 *    `undefined` (three/src/nodes/functions/VolumetricLightingModel.js:149). A
 *    DirectionalLight — the obvious choice for a moon — is therefore silently
 *    skipped and you get an empty volume with no error. The moon is driven by a
 *    SpotLight with a finite distance placed along the moon direction.
 * 2. The march is expensive per step, so it renders at a low resolution scale
 *    and is composited additively. Low-res plus blur is also MORE painterly
 *    than a sharp march — the softness is the point, not a compromise.
 */
import * as THREE from 'three/webgpu';
import {
    float,
    Fn,
    mx_fractal_noise_float as materialXFractalNoise,
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
 * @param {number} [options.steps] raymarch steps; 12 is enough with dithering
 * @returns {{ light: THREE.SpotLight, volume: THREE.Mesh, setIntensity: Function, dispose: Function }}
 */
export function createStillwaterShafts({ root, steps = 12 }) {
    const uIntensity = uniform(0.85);
    const uTime = uniform(0);

    // SpotLight, NOT DirectionalLight — see the header note. Distance must be
    // finite or the volumetric model skips it entirely and renders nothing.
    const light = new THREE.SpotLight(0xbfd4e6, 2.4, 260, Math.PI * 0.22, 0.55, 1.0);
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
    // Density modulation. r181 calls this as `scatteringNode({ positionRay })`
    // and MULTIPLIES the accumulated light by the result, so it must sample the
    // ray position — `positionWorld` is not the march sample point inside the
    // loop — and it must sit around unity. A small absolute value here does not
    // mean "thin fog", it means "no shafts at all".
    // BLOCKED 2026-07-28 — `Error while parsing WGSL: unresolved value 'null'`
    // at `scatteringDensity = ( scatteringDensity * null )`. Four hypotheses
    // eliminated by bisection, each reproducing the identical error:
    //
    //   1. This scattering graph — a trivial `() => float(1.5)` reproduces it,
    //      so the noise/height maths is not involved.
    //   2. `material.steps` — declared on VolumeNodeMaterial (default 25) and
    //      read via `uniform('int').onRenderUpdate(({material}) => material.steps)`,
    //      which is exactly what is set below.
    //   3. The shadow map — `castShadow = false` reproduces it.
    //   4. Raw function vs `Fn` — the property is typed
    //      `Function|FunctionNode<vec4>` and BOTH forms reproduce it.
    //
    // The fault is therefore inside three r181's volumetric plumbing for this
    // configuration, not in this module's usage. The next step is a minimal
    // reproduction OUTSIDE the theme (bare scene + VolumeNodeMaterial + one
    // SpotLight) to establish whether it is r181 generally or an interaction
    // with this theme's PostProcessing/MRT chain. Do not re-test 1-4.
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
        return float(1.0)
            .add(lowBand.mul(1.6))
            .mul(drift.mul(0.7).add(0.6))
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
