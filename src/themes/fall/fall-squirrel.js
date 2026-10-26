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
    abs, attribute, cameraPosition, dot, float, floor, fract, fwidth, hash, length, mix, normalize, normalWorld,
    positionWorld, pow, reflect, saturate, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SQUIRREL_CLIPS, SQUIRREL_SCALE } from './fall-squirrel-clips.js';
import { FLICK_LENGTH } from './fall-squirrel-mind.js';
import { createPlumeHair } from './fall-squirrel-plume.js';

/** How far the head turns to the board at most (radians), and how the turn is shared. */
const LOOK_REACH = 1.15;
const LOOK_NECK = 0.4;
/**
 * The tail's follow-through (the mind's tailTurn and tailSurge, per bone): how much of the body's turn
 * since each bone's look back the tail keeps pointing away from (it trails the turn), and how far it
 * swings up for a life-size metre a second the body slowed by since then (down for one it gained:
 * a start leaves it behind, a stop throws it forward over the back), each held within a reach.
 */
const TRAIL_TURN = 0.8;
const TRAIL_TURN_MOST = 1.0;
const TRAIL_SURGE = 0.45;
const TRAIL_SURGE_RANGE = [-0.32, 0.55];
/**
 * A tail flick, per bone root to brush (degrees at full strength): a snap up and a smaller rebound,
 * each bone a beat after the one before, so the flick travels out to the brush.
 */
const FLICK_DEGREES = [18, 12, 8, 5, 4, 4, 4];
const FLICK_BEAT = 0.028;
/** Each tail bone's sideways axis in its own frame: square to the tail's length and to its left. */
const TAIL_SWING = new THREE.Vector3(0, 0.8, 0.6).normalize();
const TAIL_LIFT = new THREE.Vector3(1, 0, 0);

/** The flick's shape over its life (seconds): a quick up, a softer rebound, settled by FLICK_LENGTH. */
function flickShape(u) {
    if (u <= 0 || u >= FLICK_LENGTH) return 0;
    const v = Math.sin((2 * Math.PI * u) / 0.3) * Math.exp(-u / 0.18);
    return v < 0 ? v * 0.5 : v;
}

/** Hair streaks a metre across the plume (life size), combed out and back from a parting down it. */
const COMB = 360;
const COMB_SWEEP = 0.9;

/**
 * The fur: albedo and sky from COLOR_0, the coat's numbers from _fur. The plume (_fur.w a half) is
 * combed: fine streaks of hair run out from a parting down its middle and back toward the brush,
 * read in the body's rest pose (so they ride on it), and fade to their mean as they grow finer than a
 * pixel (they never shimmer at the size the game shows it). `tailBase` and `tailAxis` place the comb.
 */
function createFurMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'FallSquirrelFur';
    const paint = attribute('color', 'vec4');
    const coat = attribute('_fur', 'vec4');
    const tailBase = uniform(new THREE.Vector3(0, 0.072, -0.086));
    const tailAxis = uniform(new THREE.Vector3(0, 0.6, -0.8));
    const plume = smoothstep(0.3, 0.42, coat.w).mul(smoothstep(0.7, 0.58, coat.w));
    const rest = attribute('position', 'vec3').sub(tailBase);
    const along = dot(rest, tailAxis);
    const out = abs(rest.x);
    const lane = along.sub(out.mul(COMB_SWEEP)).mul(COMB).add(sin(along.mul(140)).mul(0.35)).add(4096);
    const streak = fract(lane);
    const strand = floor(lane);
    const hairs = smoothstep(0.0, 0.3, streak).mul(smoothstep(1.0, 0.7, streak));
    const tone = mix(float(0.84), float(1.0), hairs).mul(hash(strand).mul(0.16).add(0.91));
    const fine = saturate(fwidth(lane).mul(1.6));
    const parting = smoothstep(0.0, 0.0035, out).mul(0.22).add(0.78);
    const combed = mix(tone, float(0.92), fine).mul(parting);
    // (A touch less saturated than painted: under the warm sun the rust ran to orange.)
    const albedo = mix(vec3(dot(paint.rgb, vec3(0.2126, 0.7152, 0.0722))), paint.rgb, 0.8).mul(0.92)
        .mul(mix(float(1), combed, plume));
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
    material.userData.comb = { tailBase, tailAxis };
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
    // The plume's hair: cards on the tail's own bones (fall-squirrel-plume.js).
    const plumeHair = body ? createPlumeHair({ body, light }) : null;
    if (plumeHair) {
        triangles += plumeHair.triangles;
        // The comb laid along the plume as measured.
        const [first] = plumeHair.plume.stations;
        material.userData.comb.tailBase.value.copy(first.centre);
        material.userData.comb.tailAxis.value.copy(first.axis);
    }
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
    const tail = FLICK_DEGREES.map((_, i) => model.getObjectByName(`tail${i}`));
    const trailLift = new THREE.Quaternion();
    const trailSwing = new THREE.Quaternion();
    // The bones the layers on top of the clips turn (the look, the tail's follow-through), and their
    // clip pose as the mixer last left it. The mixer writes a bone only when its clip value changes,
    // so a layer laid on a bone whose clip held still would pile up frame on frame: each frame the
    // clip pose is put back before the mixer runs, and the layers are laid on it afresh.
    const layered = [neck, head, ...tail].filter(Boolean);
    const clipPose = layered.map((bone) => bone.quaternion.clone());
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

    /**
     * The head (and the neck, less) turned toward the board, by `weight`: a turn about the body's up
     * and a nod about the head's own side, each kept within reach. A board behind it is let go of
     * (looking round over its back is not what a squirrel does), so the turn never flips side.
     */
    const lookAt = (target, weight) => {
        if (!(weight > 0.001) || !head || !neck) return;
        pivot.updateMatrixWorld(true);
        head.getWorldPosition(scratch.p);
        scratch.to.set(target[0], target[1], target[2]).sub(scratch.p);
        // In the body's own frame: x its left, y its up, z its forward.
        scratch.q.copy(pivot.quaternion).invert();
        scratch.to.applyQuaternion(scratch.q).normalize();
        head.getWorldQuaternion(scratch.parent);
        scratch.fwd.copy(FORWARD).applyQuaternion(scratch.parent).applyQuaternion(scratch.q);
        const yawTo = Math.atan2(scratch.to.x, scratch.to.z);
        const yawNow = Math.atan2(scratch.fwd.x, scratch.fwd.z);
        const away = Math.abs(yawTo);
        const keep = weight * (1 - THREE.MathUtils.smoothstep(away, 1.9, 2.6));
        if (keep < 0.001) return;
        // (A target nearly straight along its up, out from the bark it clings to, has no side to turn
        // to: the turn fades out there and the nod does the looking.)
        const sideways = THREE.MathUtils.smoothstep(Math.hypot(scratch.to.x, scratch.to.z), 0.25, 0.6);
        const yaw = (THREE.MathUtils.clamp(yawTo, -LOOK_REACH, LOOK_REACH) - yawNow) * sideways;
        const pitchTo = Math.asin(THREE.MathUtils.clamp(scratch.to.y, -1, 1));
        const pitchNow = Math.asin(THREE.MathUtils.clamp(scratch.fwd.y, -1, 1));
        const pitch = THREE.MathUtils.clamp(pitchTo, -0.5, 0.5) - pitchNow;
        // The turn about the body's up (world), shared between neck and head.
        scratch.n.set(0, 1, 0).applyQuaternion(pivot.quaternion);
        scratch.turn.setFromAxisAngle(scratch.n, yaw * keep * LOOK_NECK);
        turnBone(neck, scratch.turn);
        scratch.turn.setFromAxisAngle(scratch.n, yaw * keep * (1 - LOOK_NECK));
        turnBone(head, scratch.turn);
        // The nod about the head's own left (a positive nod lifts the nose).
        head.getWorldQuaternion(scratch.parent);
        scratch.n.set(1, 0, 0).applyQuaternion(scratch.parent);
        scratch.turn.setFromAxisAngle(scratch.n, -pitch * keep * 0.7);
        turnBone(head, scratch.turn);
    };

    return {
        group: pivot,
        shade: shade.mesh,
        material,
        acornMaterial,
        plumeHair,
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
            layered.forEach((bone, i) => bone.quaternion.copy(clipPose[i]));
            mixer.update(0);
            layered.forEach((bone, i) => clipPose[i].copy(bone.quaternion));
            // Follow-through: the plume trails the body's turns and its starts and stops, each bone
            // bent by what its look back adds to the one before (so the bend runs down the tail), and
            // a flick now and then travelling out to the brush.
            let swungBefore = 0;
            let liftedBefore = 0;
            const flick = pose.flick ?? -1;
            const flickStrength = pose.flickStrength || 0;
            tail.forEach((bone, i) => {
                if (!bone) return;
                const swung = THREE.MathUtils.clamp(
                    -(pose.tailTurn?.[i] || 0) * TRAIL_TURN,
                    -TRAIL_TURN_MOST,
                    TRAIL_TURN_MOST,
                );
                const lifted = THREE.MathUtils.clamp(
                    -(pose.tailSurge?.[i] || 0) * TRAIL_SURGE,
                    TRAIL_SURGE_RANGE[0],
                    TRAIL_SURGE_RANGE[1],
                );
                const flicked = flick >= 0
                    ? THREE.MathUtils.degToRad(FLICK_DEGREES[i]) * flickStrength * flickShape(flick - i * FLICK_BEAT)
                    : 0;
                const lift = lifted - liftedBefore + flicked;
                const swing = swung - swungBefore;
                swungBefore = swung;
                liftedBefore = lifted;
                if (lift === 0 && swing === 0) return;
                trailLift.setFromAxisAngle(TAIL_LIFT, lift);
                trailSwing.setFromAxisAngle(TAIL_SWING, swing);
                bone.quaternion.multiply(trailSwing).multiply(trailLift);
            });
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
            plumeHair?.dispose();
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
