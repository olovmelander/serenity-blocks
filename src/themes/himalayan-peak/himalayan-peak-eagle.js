/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak — the eagle.
 *
 * One golden eagle working the updraft off the pass, out in the open sky right of the board where
 * the sun comes up. The model is the theme's own, built in Blender by
 * scripts/blender/himalayan_eagle.py: a soaring adult with splayed primaries and a fanned tail,
 * its Blender wingbeat blending with live trim from himalayan-peak-eagle-flight.js. It
 * loads off the frame and simply appears on its round when it has arrived; nothing waits for it.
 *
 * Its light is the amphitheatre's: the hour's shade and sky from above, the cloud sea from below,
 * the sun when the bird is out of the wall's shadow, and through the thin feathers when it flies
 * between the eye and the sun — the sun on the edges of its wings.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, exp, float, fract, fwidth, max, mix, normalWorld, normalize,
    positionWorld, smoothstep, step, uniform, uv, vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GALE_REST } from './himalayan-peak-core.js';
import { hpAirLight, hpPow8, hpSky } from './himalayan-peak-tsl.js';
import {
    EAGLE_BONES, EAGLE_SPAN, createEaglePose, createEagleRoute, eagleFlight,
} from './himalayan-peak-eagle-flight.js';

export {
    EAGLE_SPAN, eagleFlight, eaglePath,
} from './himalayan-peak-eagle-flight.js';

export const EAGLE_URL = new URL('./assets/eagle.glb', import.meta.url).href;

/** Fetch the model. Resolves null when it cannot be read (the mountain does without). */
export async function loadEagle(url = EAGLE_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        return await new GLTFLoader().loadAsync(url);
    } catch (error) {
        console.warn('[HimalayanPeak] the eagle did not arrive:', error?.message || error);
        return null;
    }
}

/** The plumage, lit by the amphitheatre. `at` = the bird's place in design space (uniform). */
function eagleMaterial(u, at) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HimalayanPeakEagle';
    material.fog = false;
    material.colorNode = Fn(() => {
        const plumage = attribute('color', 'vec4');
        // Unwrap each vane from root to tip and across its rachis. The mantle uses the same
        // coordinates across a continuous row of short contour feathers. The body is unmarked.
        const feather = uv().toVar();
        const mantle = step(1.5, feather.x);
        const along = clamp(feather.x.sub(mantle.mul(2)), 0, 1).toVar();
        const across = abs(fract(feather.y).mul(2).sub(1)).toVar();
        const width = max(fwidth(feather.y).mul(2), 0.006).toVar();
        const shaftWidth = float(0.056).sub(along.mul(0.033));
        const shaft = float(1).sub(smoothstep(0, shaftWidth.add(width), across))
            .mul(shaftWidth.div(shaftWidth.add(width)));
        // A curved herringbone on each side of the shaft. Filter by pixel footprint, so a
        // distant eagle resolves to the feather's average colour as it crosses the sky.
        const barb = along.mul(18).sub(across.mul(float(4.6).sub(along.mul(1.7)))).toVar();
        const resolved = float(1).sub(smoothstep(0.20, 0.52, fwidth(barb)));
        const ribs = cos(barb.mul(6.28318)).mul(resolved).mul(0.14);
        const bars = cos(along.mul(19.4).sub(across.mul(1.2))).mul(0.105)
            .mul(float(1).sub(smoothstep(0.07, 0.20, fwidth(along))));
        const edgeWear = smoothstep(0.68, 1.0, across).mul(smoothstep(0.48, 0.96, along)).mul(0.12);
        const marked = step(0, feather.x).mul(mix(1, 0.60, mantle));
        const albedo = plumage.rgb.mul(ribs.add(bars).add(edgeWear).mul(marked).add(1))
            .add(vec3(0.120, 0.083, 0.051).mul(shaft).mul(marked));
        const thin = plumage.a;
        const N = normalize(normalWorld).toVar();
        const toEye = cameraPosition.sub(positionWorld);
        const V = normalize(toEye).toVar();
        // Out of the wall's shadow? (One look-up for the whole bird: it is small.)
        const sun = hpAirLight(u, at, 25);
        const facing = dot(N, u.sunDir);
        const ndl = clamp(facing, 0.0, 1.0);
        const ambient = u.shade.mul(N.y.mul(0.45).add(0.62)).add(u.zenith.mul(max(N.y, 0.0).mul(0.35).add(0.12)))
            // The cloud sea under it throws its light back up.
            .add(u.cloudCol.mul(max(N.y.negate(), 0.0).mul(0.78).add(0.56)))
            .add(u.glow.mul(0.14));
        const lit = albedo.mul(u.sunCol.mul(ndl.mul(sun)).add(ambient)).toVar();
        // Sun on the far side of a thin vane comes through it, warmer than it went in and more
        // toward the sun (a few per cent of it: the wings glow, the bird stays darker than the
        // sky round the sun); the edges the light grazes rim.
        const behind = clamp(dot(V.negate(), u.sunDir), 0.0, 1.0);
        const back = clamp(facing.negate(), 0.0, 1.0);
        const through = u.sunCol.mul(back.mul(thin).mul(sun).mul(hpPow8(behind).mul(0.8).add(0.2)).mul(0.07))
            .mul(vec3(1.0, 0.6, 0.3));
        const edge = float(1.0).sub(abs(dot(N, V)));
        const edge3 = edge.mul(edge).mul(edge);
        const rim = u.sunCol.mul(edge3.mul(hpPow8(behind).mul(0.5).add(0.04)).mul(sun).mul(0.22));
        // In the wall's shadow it is a dark shape on a bright sky: the sky behind it (without the
        // sun's glare) wraps its edges a little, so the shape keeps its wings.
        const behindSky = hpSky(u, V.negate(), 0.0);
        const sheen = behindSky.mul(edge3.mul(thin.mul(0.25).add(0.2)));
        const col = lit.add(through).add(rim).add(sheen);
        // A little of the air between it and the eye.
        const haze = float(1.0).sub(exp(toEye.length().div(-5200)));
        return mix(col, behindSky, haze).mul(u.breath.mul(0.85).add(0.15));
    })();
    return material;
}

/**
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadEagle() resolved
 */
export function createEagle(u, gltf, seed) {
    const route = createEagleRoute(seed);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    // The model is built at its real size with its wings out along x.
    const scale = EAGLE_SPAN / (size.x || 1);
    model.scale.setScalar(scale);

    const at = uniform(new THREE.Vector3());
    const material = eagleMaterial(u, at);
    const replaced = [];
    model.traverse((child) => {
        if (!child.isMesh) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => replaced.push(m));
        child.material = material;
        // The widest pose is the open glide. Leave room for the tips to curl or lag a beat.
        child.geometry.computeBoundingSphere();
        child.boundingSphere = child.geometry.boundingSphere.clone();
        child.boundingSphere.radius *= 1.25;
    });
    replaced.forEach((m) => m?.dispose?.());

    const wingbeat = gltf.animations.find((clip) => clip.name === 'Ridge Wingbeat');
    const strokes = new Map();
    for (const track of wingbeat?.tracks ?? []) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        if (propertyName === 'quaternion' && /^(arm|fore|hand|f\d)[LR]$/.test(nodeName)) {
            strokes.set(nodeName, track.createInterpolant());
        }
    }
    const strokeRotation = new THREE.Quaternion();
    const bones = EAGLE_BONES.map((name) => [name, model.getObjectByName(name), strokes.get(name)])
        .filter(([, bone]) => bone);
    const pivot = new THREE.Group();
    pivot.name = 'HimalayanPeakEagle';
    pivot.add(model);
    const pose = createEaglePose();
    const basis = new THREE.Matrix4();
    const euler = new THREE.Euler(0, 0, 0, 'ZYX');
    const axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    return {
        mesh: pivot,
        material,
        pose,
        /**
         * Put the bird where it is at `time`, holding itself as it does then.
         * @param {number} time
         * @param {{ gale?: number, reduced?: boolean, squeeze?: number }} [air]
         */
        update(time, { gale = GALE_REST, reduced = false, squeeze = 1 } = {}) {
            eagleFlight(time, { gale, reduced, route }, pose);
            const { path } = pose;
            // Upright screens draw the world narrower about the view axis: the bird's PLACE
            // follows, its shape does not.
            pivot.position.set(path.x * squeeze, path.y, path.z);
            at.value.set(path.x, path.y, path.z);
            axis[0].fromArray(pose.left);
            axis[1].fromArray(pose.up);
            axis[2].fromArray(pose.forward);
            basis.makeBasis(axis[0], axis[1], axis[2]);
            pivot.quaternion.setFromRotationMatrix(basis);
            model.position.set(0, pose.heave * scale, 0);
            for (let i = 0; i < bones.length; i++) {
                const [name, bone, stroke] = bones[i];
                const j = pose.joints[name];
                bone.quaternion.setFromEuler(euler.set(j[0], j[1], j[2], 'ZYX'));
                if (pose.bout.amount > 0 && stroke) {
                    const sampled = stroke.evaluate(pose.bout.phase * wingbeat.duration);
                    bone.quaternion.slerp(strokeRotation.fromArray(sampled), pose.bout.amount);
                }
            }
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            model.traverse((child) => {
                child.geometry?.dispose?.();
                child.skeleton?.dispose?.();
            });
            material.dispose();
        },
    };
}
