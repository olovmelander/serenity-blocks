/**
 * Fall — the red squirrel, drawn.
 *
 * The model, its rig and every clip are the theme's own, modelled, rigged and animated in Blender
 * (assets/squirrel.glb; scripts/blender/fall_squirrel.py, packed by scripts/fall/pack-squirrel.mjs;
 * see assets/ATTRIBUTION.md). The mind (fall-squirrel-mind.js) says where it is and which clips play;
 * here the clips are blended on the skeleton through three's AnimationMixer with every clip's time set
 * from the mind (never advanced by the mixer), so a seek lands on the same pose at any frame rate.
 *
 * It is lit as the grove is (fall-light.js): the one low sun stands behind the trees, so the side of it
 * we see is mostly its shadow side and what makes it is the light through its coat. The rim of its fur
 * catches the sun all round its outline, its thin ears and the locks of its plume glow when the sun is
 * behind them, it walks into and out of the trees' shadows, and its eyes keep a wet highlight. Each
 * vertex carries its coat: COLOR_0 = the colour and how much sky it sees, _fur = (how long the hair is,
 * how much light gets through it, eye, ear tuft).
 */

import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, dot, float, length, mix, normalize, normalWorld, positionWorld, pow, reflect,
    saturate, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SQUIRREL_CLIPS, SQUIRREL_SCALE } from './fall-squirrel-clips.js';

/** How far the head turns to the board at most (radians), and how the turn is shared. */
const LOOK_REACH = 1.15;
const LOOK_NECK = 0.4;

/** The fur: albedo and sky from COLOR_0, the coat's numbers from _fur. */
function createFurMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'FallSquirrelFur';
    const paint = attribute('color', 'vec4');
    const coat = attribute('_fur', 'vec4');
    // (A touch less saturated than painted: under the warm sun the rust ran to orange.)
    const albedo = mix(vec3(dot(paint.rgb, vec3(0.2126, 0.7152, 0.0722))), paint.rgb, 0.8).mul(0.92);
    const sky = saturate(paint.a);
    const fur = saturate(coat.x);
    const through = saturate(coat.y);
    const eye = saturate(coat.z);
    const world = positionWorld;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(world));
    const L = light.uSunDir;
    const sun = light.sunlight();
    // Fur wraps the light a little way round.
    const wrap = saturate(dot(N, L).add(0.42).div(1.42));
    const direct = albedo.mul(light.uSunColor).mul(wrap.mul(1.25)).mul(sun);
    const occlusion = sky.mul(0.75).add(0.25);
    const ambient = albedo.mul(light.ambient(N)).mul(occlusion).mul(1.35);
    // The outline of its coat, lit through the hair: all round when the sun is behind it.
    const grazing = saturate(dot(N, V)).oneMinus();
    const behind = saturate(dot(V, L).negate());
    const glow = pow(albedo, vec3(0.72)).mul(vec3(1.25, 1.02, 0.7));
    const rim = glow.mul(light.uSunColor).mul(pow(grazing, 3.0)).mul(behind.mul(1.05).add(0.1))
        .mul(fur.mul(0.75).add(0.25))
        .mul(sun.mul(0.85).add(0.15));
    // Thin ears and the plume's locks shine when the sun is behind them.
    const shine = glow.mul(light.uSunColor).mul(through).mul(pow(behind, 2.2).mul(0.6))
        .mul(saturate(dot(N, L).negate()).mul(0.6).add(0.4))
        .mul(sun);
    // The eyes: the sun's glint, and a catchlight from the sky over the viewer's shoulder.
    const glint = pow(saturate(dot(reflect(V.negate(), N), L)), 70).mul(light.uSunColor).mul(2.2).mul(sun);
    const catchlight = pow(saturate(dot(N, normalize(V.add(vec3(0, 0.55, 0))))), 26).mul(0.55);
    const wet = glint.add(vec3(catchlight)).mul(eye);
    const lit = direct.add(ambient).add(rim).add(shine).add(wet)
        // The grove's warm light on it, in a fever.
        .add(glow.mul(light.uSunColor).mul(light.uWarmth.mul(0.03)));
    material.fragmentNode = vec4(light.haze(lit, { world }), 1);
    return material;
}

function createAcornMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'FallSquirrelAcorn';
    const paint = attribute('color', 'vec4');
    const world = positionWorld;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(world));
    const L = light.uSunDir;
    const sun = light.sunlight();
    const lit = paint.rgb.mul(light.uSunColor.mul(saturate(dot(N, L).mul(0.7).add(0.3))).mul(sun)
        .add(light.ambient(N).mul(paint.a.mul(1.3))))
        .add(pow(saturate(dot(reflect(V.negate(), N), L)), 40).mul(light.uSunColor).mul(0.5).mul(sun));
    material.fragmentNode = vec4(light.haze(lit, { world }), 1);
    return material;
}

/** A soft shade on the bark or the litter under it (the grove's shadow map is static: it is not in it). */
function createShade() {
    const alpha = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial({
        fog: false, transparent: true, depthWrite: false,
    });
    material.name = 'FallSquirrelShade';
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    const d = length(uv().sub(vec2(0.5)).mul(2));
    const a = float(1).sub(smoothstep(0.25, 1.0, d)).mul(alpha);
    material.fragmentNode = vec4(vec3(0.03, 0.018, 0.01), a);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FallSquirrelShade';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    return { mesh, alpha };
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * @param {object} o
 * @param {import('./fall-light.js').FallLight} o.light
 * @param {object} o.gltf   the squirrel's GLTF (assets.squirrel)
 * @param {number} [o.scale]
 */
export function createSquirrel({ light, gltf, scale = SQUIRREL_SCALE }) {
    const model = cloneSkinned(gltf.scene);
    model.name = 'FallSquirrelModel';
    const material = createFurMaterial(light);
    const acornMaterial = createAcornMaterial(light);
    let body = null;
    let acorn = null;
    let triangles = 0;
    model.traverse((child) => {
        if (!child.isMesh) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m?.dispose?.());
        child.frustumCulled = false;
        child.castShadow = false;
        child.receiveShadow = false;
        if (child.isSkinnedMesh) {
            body = child;
            child.material = material;
        } else {
            acorn = child;
            child.material = acornMaterial;
        }
        triangles += child.geometry.index ? child.geometry.index.count / 3 : 0;
    });
    model.scale.setScalar(scale);
    const pivot = new THREE.Group();
    pivot.name = 'FallSquirrel';
    pivot.add(model);
    const shade = createShade();

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.enabled = false;
        action.setEffectiveWeight(0);
        action.play();
        actions[clip.name] = action;
    }
    const neck = model.getObjectByName('neck');
    const head = model.getObjectByName('head');
    const scratch = {
        parent: new THREE.Quaternion(),
        turn: new THREE.Quaternion(),
        part: new THREE.Quaternion(),
        q: new THREE.Quaternion(),
        p: new THREE.Vector3(),
        to: new THREE.Vector3(),
        fwd: new THREE.Vector3(),
        n: new THREE.Vector3(),
        m: new THREE.Matrix4(),
        identity: new THREE.Quaternion(),
    };
    const live = new Set();

    /** Turn a bone by a world rotation (premultiplied in its parent's frame). */
    const turnBone = (bone, worldTurn) => {
        bone.parent.getWorldQuaternion(scratch.parent);
        scratch.q.copy(scratch.parent).invert().multiply(worldTurn).multiply(scratch.parent);
        bone.quaternion.premultiply(scratch.q);
        bone.updateMatrixWorld(true);
    };

    /** The head (and the neck, less) turned toward the board, by `weight`. */
    const lookAt = (target, weight) => {
        if (!(weight > 0.001) || !head || !neck) return;
        head.getWorldPosition(scratch.p);
        scratch.to.set(target[0], target[1], target[2]).sub(scratch.p).normalize();
        head.getWorldQuaternion(scratch.q);
        scratch.fwd.copy(FORWARD).applyQuaternion(scratch.q);
        scratch.turn.setFromUnitVectors(scratch.fwd, scratch.to);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(scratch.turn.w)));
        // How much of the way it turns: all of it within reach, as far as it reaches beyond.
        const share = Math.min(1, LOOK_REACH / Math.max(angle, 1e-4)) * weight;
        scratch.part.slerpQuaternions(scratch.identity, scratch.turn, share * LOOK_NECK);
        turnBone(neck, scratch.part);
        // The rest is the head's, measured again from where the neck has put it.
        head.getWorldQuaternion(scratch.q);
        scratch.fwd.copy(FORWARD).applyQuaternion(scratch.q);
        head.getWorldPosition(scratch.p);
        scratch.to.set(target[0], target[1], target[2]).sub(scratch.p).normalize();
        scratch.turn.setFromUnitVectors(scratch.fwd, scratch.to);
        const rest = (share * (1 - LOOK_NECK)) / Math.max(1e-3, 1 - share * LOOK_NECK);
        scratch.part.slerpQuaternions(scratch.identity, scratch.turn, Math.min(1, rest));
        turnBone(head, scratch.part);
    };

    return {
        group: pivot,
        shade: shade.mesh,
        material,
        acornMaterial,
        triangles,
        clips: Object.keys(actions),
        /** Draw the pose the mind resolved (fall-squirrel-mind.js pose()). */
        update(pose) {
            pivot.visible = Boolean(pose?.visible);
            shade.mesh.visible = pivot.visible;
            if (!pivot.visible) return;
            pivot.position.fromArray(pose.position);
            pivot.quaternion.fromArray(pose.quaternion);
            // The clips: what the mind asks for, each at its own time; every other one off.
            let total = 0;
            for (const entry of pose.clips) total += entry.weight;
            live.forEach((name) => {
                if (!pose.clips.some((entry) => entry.name === name)) {
                    actions[name].enabled = false;
                    actions[name].setEffectiveWeight(0);
                    live.delete(name);
                }
            });
            for (const entry of pose.clips) {
                const action = actions[entry.name];
                if (!action) continue;
                const spec = SQUIRREL_CLIPS[entry.name];
                const { duration } = action.getClip();
                const t = spec?.loop === false
                    ? Math.max(0, Math.min(duration - 1e-4, entry.time))
                    : ((entry.time % duration) + duration) % duration;
                action.enabled = true;
                action.time = t;
                action.setEffectiveWeight(entry.weight / Math.max(total, 1e-6));
                live.add(entry.name);
            }
            mixer.update(0);
            pivot.updateMatrixWorld(true);
            lookAt(pose.attention, pose.look);
            if (acorn) acorn.visible = Boolean(pose.acorn);
            // The shade: on the surface under it, fainter the higher it is.
            const n = scratch.n.fromArray(pose.normal);
            shade.mesh.position.fromArray(pose.surface).addScaledVector(n, 0.02);
            scratch.fwd.copy(FORWARD).applyQuaternion(pivot.quaternion);
            scratch.fwd.addScaledVector(n, -scratch.fwd.dot(n)).normalize();
            scratch.to.crossVectors(n, scratch.fwd).normalize();
            scratch.m.makeBasis(scratch.to, n, scratch.fwd);
            shade.mesh.quaternion.setFromRotationMatrix(scratch.m);
            shade.mesh.scale.set(0.11 * scale, 1, 0.2 * scale);
            shade.alpha.value = 0.42 * Math.exp(-Math.max(0, pose.lift) * 5);
        },
        dispose() {
            mixer.stopAllAction();
            mixer.uncacheRoot(model);
            material.dispose();
            acornMaterial.dispose();
            shade.mesh.geometry.dispose();
            shade.mesh.material.dispose();
            shade.mesh.removeFromParent();
            pivot.removeFromParent();
            if (body) body.skeleton?.dispose?.();
        },
    };
}

/** Unit vectors used by the shade (exported for tests). */
export const SQUIRREL_AXES = Object.freeze({ up: UP, forward: FORWARD });
