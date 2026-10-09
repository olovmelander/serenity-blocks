/* eslint-disable import/no-unresolved */
/**
 * Winter — the fox, drawn.
 *
 * The model is the theme's own arctic fox (assets/arctic-fox.glb: one skinned mesh, eighteen
 * bones, ten clips; see assets/ATTRIBUTION.md). It loads off the frame and joins the scene
 * when it arrives; until then the fox is still there as far as the choreography goes (its
 * mind, winter-fox-mind.js, never waits) — its sparks and prints simply have no body yet.
 *
 * Two bodies are made of it:
 *  - the fox on the snow, posed from the mind's pose every frame (clip, time within it, the
 *    cross-fade from the clip before, a turn of the tail). White fur lit by the moon behind
 *    it, so its edge glows; as the chain grows the coat takes the fires' light, tail first;
 *  - the fox of light: the same animal bounding across the sky, kilometres long, drawn in
 *    aurora — what four lines call up.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionWorld,
    smoothstep,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    DEG, EYE, FOX_SCALE, SPIRIT_RUN, smooth, wAir, wFxMaterial, wSolidMaterial,
} from './winter-tsl.js';
import { FOX_CLIPS } from './winter-fox-mind.js';

export const FOX_URL = new URL('./assets/arctic-fox.glb', import.meta.url).href;

/** Fetch the model. Resolves null when it cannot be read (the night does without its body). */
export async function loadFox(url = FOX_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        return await new GLTFLoader().loadAsync(url);
    } catch (error) {
        console.warn('[Winter] the fox did not arrive:', error?.message || error);
        return null;
    }
}

/** Per vertex: how much of it belongs to the tail (the sum of its tail bones' weights). */
function markTail(mesh) {
    const { geometry, skeleton } = mesh;
    if (!geometry || !skeleton || geometry.getAttribute('aTail')) return;
    const index = geometry.getAttribute('skinIndex');
    const weight = geometry.getAttribute('skinWeight');
    const { count } = geometry.getAttribute('position');
    const tail = new Float32Array(count);
    if (index && weight) {
        const isTail = skeleton.bones.map((bone) => /^tail/i.test(bone.name));
        for (let v = 0; v < count; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                if (isTail[index.getComponent(v, k)]) sum += weight.getComponent(v, k);
            }
            tail[v] = sum;
        }
    }
    geometry.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
}

/** Give every mesh of a model one material; `retire` disposes what it replaces (the file's own). */
function swapMaterials(model, material, retire = true) {
    const replaced = [];
    model.traverse((child) => {
        if (!child.isMesh) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => replaced.push(m));
        child.material = material;
        child.frustumCulled = false;
    });
    if (retire) replaced.forEach((m) => m?.dispose?.());
}

/** Pose a model from named clips: the one it is in, and the one it is leaving. */
function makePoser(model, animations) {
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    (animations || []).forEach((clip) => {
        const action = mixer.clipAction(clip);
        action.play();
        action.paused = true;
        action.setEffectiveWeight(0);
        actions[clip.name] = action;
    });
    const names = Object.keys(actions);
    const tails = [];
    model.traverse((child) => {
        if (child.isBone && /^tail/i.test(child.name)) tails.push(child);
    });
    // What the mixer last gave each tail bone. It writes a bone only when its value changes, so
    // the turn added below has to be taken off again before it runs, or it piles up.
    const tailRest = tails.map((bone) => bone.quaternion.clone());
    let turned = false;
    return {
        mixer,
        has: (name) => Boolean(actions[name]),
        pose(clip, clipTime, from, fromTime, blend, tailSwing = 0) {
            if (turned) for (let i = 0; i < tails.length; i++) tails[i].quaternion.copy(tailRest[i]);
            names.forEach((name) => {
                const action = actions[name];
                let w = 0;
                if (name === clip) w = from === clip ? 1 : blend;
                else if (name === from) w = 1 - blend;
                action.setEffectiveWeight(w);
                if (w > 0) {
                    const clipLength = FOX_CLIPS[name] || action.getClip().duration || 1;
                    const t = name === clip ? clipTime : fromTime;
                    action.time = Math.max(0, Math.min(clipLength - 1e-4, t));
                }
            });
            mixer.update(0);
            for (let i = 0; i < tails.length; i++) {
                tailRest[i].copy(tails[i].quaternion);
                tails[i].rotateZ(tailSwing * (0.5 + i * 0.35));
            }
            turned = true;
        },
        dispose() {
            mixer.stopAllAction();
            mixer.uncacheRoot(model);
        },
    };
}

/**
 * The fox on the snow.
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadFox() resolved
 */
export function createFox(u, gltf) {
    const model = gltf.scene;
    model.traverse((child) => {
        if (child.isSkinnedMesh) markTail(child);
    });
    const material = wSolidMaterial('WinterFox');
    material.side = THREE.DoubleSide;
    const vTail = varying(attribute('aTail', 'float'), 'wFoxTail');
    const vCoat = varying(attribute('color', 'vec3'), 'wFoxCoat');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const V = toEye.div(max(length(toEye), 1e-3)).toVar();
        const N = normalize(normalWorld).toVar();
        const coat = clamp(vCoat, 0.0, 1.0);
        // The pale coat lights up; the dark eyes and nose must not.
        const pale = clamp(coat.x.mul(1.3).sub(0.2), 0.0, 1.0);
        const albedo = mix(coat, vec3(0.93, 0.95, 1.0), pale.mul(0.85));
        // Fur scatters: the light wraps far round it, and comes through at the edge.
        const ndl = dot(N, u.moonDir);
        const wrapped = max(ndl.add(0.7).div(1.7), 0.0);
        const facing = clamp(dot(N, V), 0.0, 1.0);
        const edge = float(1.0).sub(facing);
        const behind = max(dot(V.negate(), u.moonDir), 0.0);
        const rim = u.moonCol.mul(edge.mul(edge)).mul(behind.mul(0.85).add(0.15)).mul(2.0).mul(pale);
        const skyFill = u.shade.mul(N.y.mul(0.3).add(0.85)).add(u.zenith.mul(max(N.y, 0.0)).mul(0.5)).add(u.band.mul(0.16));
        const toGlow = normalize(vec3(u.glowDir.x, 0.25, u.glowDir.y));
        const rose = u.glow.mul(max(dot(N, toGlow), 0.0).mul(0.55).add(0.06));
        const lit = albedo.mul(u.moonCol.mul(wrapped).mul(0.8).add(skyFill.mul(1.35)).add(rose.mul(1.3))).add(rim);
        // The fires: the coat's edge burns in them, and the tail is their torch.
        const tail = clamp(vTail, 0.0, 1.0);
        const flame = mix(u.fire, vec3(1.0), 0.2)
            .mul(edge.mul(edge).mul(1.6).add(0.14).add(tail.mul(1.5)))
            .mul(u.foxGlow).mul(pale)
            .mul(1.5);
        return wAir(u, lit.add(flame).mul(u.breath.mul(0.8).add(0.2)), P);
    })();
    swapMaterials(model, material);

    const pivot = new THREE.Group();
    pivot.name = 'WinterFox';
    pivot.add(model);
    pivot.scale.setScalar(FOX_SCALE);
    const poser = makePoser(model, gltf.animations);

    return {
        mesh: pivot,
        material,
        /** Draw the pose the mind resolved; `tailSwing` in radians. */
        update(pose, tailSwing = 0) {
            pivot.position.set(pose.x, pose.y + pose.lift - 0.02, pose.z);
            pivot.rotation.set(0, pose.heading, 0);
            poser.pose(pose.clip, pose.clipTime, pose.from, pose.fromTime, pose.blend, tailSwing);
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            poser.dispose();
            material.dispose();
            // (The fox of light is drawn from the same geometry: it goes once, here.)
            model.traverse((child) => child.geometry?.dispose?.());
        },
    };
}

/** How far off the fox of light runs, and how much of the sky it spans. */
const SPIRIT_FAR = 5600;
const SPIRIT_SPAN = 23 * DEG;

/**
 * Where the fox of light is `k` of the way across the sky (0..1): bearing and elevation
 * (radians), from behind the hero fell on the left to past the moon on the right.
 */
export function spiritPath(k, out = { bearing: 0, elevation: 0, slope: 0 }) {
    out.bearing = (-0.86 + 1.72 * k) * 44 * DEG;
    // It bounds: a long arc with three leaps on it.
    out.elevation = (13 + 9 * Math.sin(k * Math.PI) + 1.7 * Math.abs(Math.sin(k * Math.PI * 3.5))) * DEG;
    out.slope = (9 * Math.cos(k * Math.PI) * Math.PI) / (1.72 * 44);
    return out;
}

/**
 * The fox of light.
 * @param {object} u
 * @param {object} gltf
 */
export function createSpiritFox(u, gltf) {
    const model = SkeletonUtils.clone(gltf.scene);
    const material = wFxMaterial('WinterSpiritFox');
    const vBody = varying(positionGeometry, 'wSpiritBody');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const V = normalize(cameraPosition.sub(P));
        const N = normalize(normalWorld);
        const edge = float(1.0).sub(clamp(dot(N, V).abs(), 0.0, 1.0));
        // It is drawn in aurora: rays stand in it and run along it, green at the foot, violet above.
        const along = vBody.z;
        const rays = u.noise(vec2(along.mul(1.7).sub(u.time.mul(0.35)), vBody.y.mul(0.12).add(0.4))).r;
        const veil = u.noise(vec2(along.mul(0.5).add(u.time.mul(0.05)), vBody.y.mul(0.6))).a;
        const tall = clamp(vBody.y.div(0.65), 0.0, 1.0);
        const colour = mix(u.fire, u.crown, smoothstep(0.25, 1.0, tall)).add(vec3(1.0).mul(edge.mul(edge).mul(0.5)));
        const body = edge.mul(edge).mul(1.7).add(rays.mul(rays).mul(1.2)).add(veil.mul(0.25))
            .add(0.06);
        // Its head burns brightest; behind, it is already going out.
        const fore = smoothstep(-0.55, 0.45, along).mul(0.75).add(0.25);
        return vec4(colour.mul(body).mul(fore).mul(u.spirit.z).mul(u.breath)
            .mul(1.5), 0.0);
    })();
    // (The clone still carries the fox's own material: it is replaced, not retired.)
    swapMaterials(model, material, false);
    const pivot = new THREE.Group();
    pivot.name = 'WinterSpiritFox';
    pivot.add(model);
    pivot.visible = false;
    // The model is about a metre long, nose to tail.
    const scale = (2 * SPIRIT_FAR * Math.tan(SPIRIT_SPAN / 2)) / 1.03;
    pivot.scale.setScalar(scale);
    const poser = makePoser(model, gltf.animations);
    const at = spiritPath(0);

    return {
        mesh: pivot,
        material,
        /**
         * @param {number} age  seconds since it was called up (< 0 or > SPIRIT_RUN: gone)
         * @returns {number} how brightly it burns now (0..1)
         */
        update(age) {
            const k = age / SPIRIT_RUN;
            if (!(k > 0 && k < 1)) {
                pivot.visible = false;
                return 0;
            }
            pivot.visible = true;
            spiritPath(k, at);
            const c = Math.cos(at.elevation);
            pivot.position.set(
                EYE.x + Math.sin(at.bearing) * c * SPIRIT_FAR,
                EYE.y + Math.sin(at.elevation) * SPIRIT_FAR - scale * 0.3,
                EYE.z - Math.cos(at.bearing) * c * SPIRIT_FAR,
            );
            // It runs across the view, left to right, nose up on the climb and down after.
            pivot.rotation.set(0, Math.PI / 2 - at.bearing * 0.6, 0);
            pivot.rotateX(-Math.atan(at.slope) * 0.6);
            poser.pose('Run', (age * 0.62) % FOX_CLIPS.Run, 'Run', 0, 1, 0);
            pivot.updateMatrixWorld(true);
            return smooth(0, 0.07, k) * (1 - smooth(0.8, 1, k));
        },
        dispose() {
            poser.dispose();
            material.dispose();
        },
    };
}
