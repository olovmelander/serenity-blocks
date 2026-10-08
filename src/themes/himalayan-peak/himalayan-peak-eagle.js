/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak — the eagle.
 *
 * One golden eagle soaring over the cloud sea, between the pass and the sun: a dark shape
 * against the light with the sun on the edges of its wings. The model is the theme's own (a
 * golden eagle rebuilt from one photograph and rigged with a flap cycle; see
 * assets/ATTRIBUTION.md). It loads off the frame and simply appears on its round when it has
 * arrived; nothing waits for it.
 *
 * Its flight is closed form in the world clock — a wide, leaning circle on the pass's updraft,
 * the wingbeat taken from the clock too — so a seek shows the same bird in the same place.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, attribute, float, mix, normalView, vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EYE, TAU } from './himalayan-peak-core.js';

export const EAGLE_URL = new URL('./assets/eagle.glb', import.meta.url).href;

/** The bird's largest dimension as drawn (metres): larger than life, as a long lens shows it. */
const SPAN = 7.5;
/** Seconds one round of its circle takes. */
export const EAGLE_ROUND = 74;

/** Where the eagle is at `time`: position, heading (unit) and bank on its round. */
export function eaglePath(time, out = {
    x: 0, y: 0, z: 0, hx: 1, hy: 0, hz: 0, bank: 0,
}) {
    const a = (time / EAGLE_ROUND) * TAU + 0.9;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.x = EYE.x + 250 + c * 215;
    out.y = EYE.y + 46 + Math.sin(a * 2 + 0.6) * 15 + s * 11;
    out.z = EYE.z - 370 - s * 150;
    // The tangent of the round.
    const dx = -s * 215;
    const dy = (Math.cos(a * 2 + 0.6) * 30 + c * 11) * 0.25;
    const dz = -c * 150;
    const len = Math.hypot(dx, dy, dz) || 1;
    out.hx = dx / len;
    out.hy = dy / len;
    out.hz = dz / len;
    out.bank = 0.34 + Math.sin(a * 3) * 0.06;
    return out;
}

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

/**
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadEagle() resolved
 */
export function createEagle(u, gltf) {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(SPAN / (Math.max(size.x, size.y, size.z) || 1));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'HimalayanPeakEagle';
    material.fog = false;
    material.colorNode = Fn(() => {
        // The baked plumage only as a whisper of tone: it is a shape against the light.
        const tone = attribute('color', 'vec4').rgb.dot(vec3(0.3, 0.6, 0.1));
        const body = u.shade.mul(0.22).add(vec3(0.018, 0.016, 0.02)).add(tone.mul(0.03));
        const edge = float(1.0).sub(normalView.z.abs());
        const rim = edge.mul(edge).mul(edge).mul(u.power.mul(0.7).add(0.3));
        return mix(body, u.sunCol.mul(0.55), rim).mul(u.breath.mul(0.85).add(0.15));
    })();
    const replaced = [];
    model.traverse((child) => {
        if (!child.isMesh) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => replaced.push(m));
        child.material = material;
        child.frustumCulled = false;
    });
    replaced.forEach((m) => m?.dispose?.());

    const pivot = new THREE.Group();
    pivot.name = 'HimalayanPeakEagle';
    pivot.add(model);
    const mixer = gltf.animations?.[0] ? new THREE.AnimationMixer(model) : null;
    mixer?.clipAction(gltf.animations[0]).play();
    const forward = new THREE.Vector3(0, 0, 1);
    const heading = new THREE.Vector3();
    const at = eaglePath(0);

    return {
        mesh: pivot,
        material,
        /** Put the bird where it is at `time`. */
        update(time) {
            eaglePath(time, at);
            pivot.position.set(at.x, at.y, at.z);
            pivot.quaternion.setFromUnitVectors(forward, heading.set(at.hx, at.hy, at.hz));
            pivot.rotateZ(at.bank);
            // An unhurried beat, from the clock.
            mixer?.setTime(time * 0.62);
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            mixer?.stopAllAction();
            model.traverse((child) => child.geometry?.dispose?.());
            material.dispose();
        },
    };
}
