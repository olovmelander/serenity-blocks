/* eslint-disable import/no-unresolved */
/**
 * Winter — the polar bear, drawn.
 *
 * The model is the theme's own (assets/polar-bear.glb: one skinned mesh on the skeleton of
 * winter-bear-rig.js, modelled in Blender and rigged by scripts/winter/model-bear.mjs; see
 * assets/ATTRIBUTION.md). It carries no clips: every frame the plan's pose (winter-bear-plan.js) is
 * solved by the rig and the rotations are copied onto its bones. It loads off the frame and joins
 * the scene when it arrives; until then the bear still walks its course as far as the plan goes —
 * it simply has no body yet.
 *
 * It is seen fifty to a hundred and forty metres off, so it is drawn for its silhouette and its
 * colour. A polar bear's coat is not the white of snow: it is a cream that turns to old ivory in
 * the low light, so against the blue snow and the dark ice it reads warm. The moon stands before the
 * viewer, so the side of it we see is its shadow side, and the outline of its coat is what the
 * moon lights through the hair. Each vertex's colour holds the coat's four numbers (the modelling
 * script paints them): the black pads of its soles, how long the hair is there, the black of its
 * nose, eyes and lips, and how much of the sky it sees.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    instanceIndex,
    length,
    max,
    mix,
    modelWorldMatrix,
    normalLocal,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    smoothstep,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    ICE_Y, LOOK, wAir, wClip, wFxMaterial, wIceSwept, wMoonShadow, wSolidMaterial, wSq,
} from './winter-tsl.js';
import {
    BEAR_BONES, BEAR_SCALE, createBearPosture, solveBear,
} from './winter-bear-rig.js';

export const BEAR_URL = new URL('./assets/polar-bear.glb', import.meta.url).href;

/** How far over the ice (metres) its mirror image is laid: in front of the ice, never through it. */
const MIRROR_LIFT = 0.03;
/** How far a hair of length 1 stands off the skin (model metres). */
const HAIR = 0.085;
/** Tiles of the noise texture to a model metre of coat: its grain is the locks of hair. */
const FUR_GRAIN = 17;
/** How thick the whole coat is: the optical depth of all its shells at the skin. */
const FUR_DENSITY = 9;

/** The same mesh drawn `count` times over its skin in one call (the attributes shared, not copied). */
function shelled(source, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(source.attributes).forEach((name) => geometry.setAttribute(name, source.attributes[name]));
    geometry.setIndex(source.index);
    geometry.instanceCount = Math.max(1, Math.round(count));
    geometry.boundingSphere = source.boundingSphere;
    geometry.boundingBox = source.boundingBox;
    return geometry;
}

/** Fetch the model. Resolves null when it cannot be read (the lake does without its bear). */
export async function loadBear(url = BEAR_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        return await new GLTFLoader().loadAsync(url);
    } catch (error) {
        console.warn('[Winter] the bear did not arrive:', error?.message || error);
        return null;
    }
}

/**
 * Pose a model from the plan's pose: the rig solves it, the bones take the answer.
 * (A model that is not on the rig's skeleton is left standing as it was made.)
 */
function makePoser(model) {
    const bones = BEAR_BONES.map(([name]) => model.getObjectByName(name));
    const whole = bones.every((bone) => bone?.isBone);
    if (!whole) console.warn('[Winter] the bear model is not on the theme\'s skeleton (model-bear.mjs).');
    const posture = createBearPosture();
    return {
        whole,
        posture,
        /** @param {object} p  the plan's pose (its spec is what the body solves) */
        pose(p) {
            if (!whole) return;
            solveBear(p.spec, posture);
            for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(posture.local[i]);
            bones[0].position.fromArray(posture.at[0]);
        },
    };
}

/**
 * The bear on the ice, and its image in the ice.
 *
 * Where the wind has swept the lake bare the ice is a mirror (winter-ground.js: it mirrors the sky
 * and the fires, more the more grazing the view, and from the game's eye three metres over the ice
 * every view of it is grazing). So the bear walks over its own reflection. The image is the same
 * skinned body drawn again, mirrored in the plane of the ice and laid flat on it along each line of
 * sight: on screen it is where the mirror image is, in depth it is on the ice, so the shore and the
 * trees in front of it hide it as they hide the ice, and the bear's own legs stand in front of it.
 * It takes as much of the ice's mirror as the ice there gives (bare, and how grazing the view), and
 * on snow there is none.
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadBear() resolved
 * @param {object} [o]
 * @param {boolean} [o.mirror=true]  draw its image in the bare ice
 * @param {number} [o.shells=0]  shells of fur drawn over its skin (0: the skin is the coat)
 */
export function createBear(u, gltf, { mirror = true, shells = 0 } = {}) {
    const layers = Math.max(0, Math.round(shells));
    const model = gltf.scene;
    const skins = [];
    model.traverse((child) => {
        if (child.isSkinnedMesh) skins.push(child);
    });
    // pad, fur length, dark, sky seen
    const vCoat = varying(attribute('color', 'vec4'), 'wBearCoat');

    /**
     * The coat's colour at world point P with normal N, seen along V (toward the eye), `height` of
     * the way from the skin (0) to the tips of the hair (1), before the air.
     */
    const coat = (P, N, V, height = float(0.7)) => {
        const dark = max(clamp(vCoat.z, 0.0, 1.0), clamp(vCoat.x, 0.0, 1.0).mul(0.85));
        const sees = clamp(vCoat.w, 0.0, 1.0);
        const fur = clamp(vCoat.y, 0.0, 1.0);
        const albedo = mix(vec3(LOOK.bearCoatR, LOOK.bearCoatG, LOOK.bearCoatB), vec3(0.03, 0.028, 0.032), dark);
        // It walks through the trees' shadows like everything else (out on the ice there are none).
        const shadow = wMoonShadow(u, P.xz).toVar();
        // Lit as the snow is (winter-ground.js), but fur: the moon's light wraps a little way round
        // it, and the sides turned from the moon fall into the blue of the sky's light.
        const wrapped = max(dot(N, u.moonDir).add(0.3).div(1.3), 0.0);
        const moonLit = u.moonCol.mul(wrapped.mul(1.05).add(0.03)).mul(shadow).mul(0.9);
        const edge = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        const behind = max(dot(V.negate(), u.moonDir), 0.0);
        const sky = u.shade.mul(N.y.mul(0.25).add(0.45)).add(u.zenith.mul(max(N.y, 0.0)).mul(0.4))
            .add(u.band.mul(0.08));
        // The snow and the ice under it light its belly a little.
        const bounce = u.shade.mul(0.22).add(u.moonCol.mul(0.06)).mul(max(N.y.negate(), 0.0));
        const toGlow = normalize(vec3(u.glowDir.x, 0.3, u.glowDir.y));
        const rose = u.glow.mul(max(dot(N, toGlow), 0.0).mul(0.4).add(0.05));
        const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
        const fires = mix(u.fire, u.crown, 0.2).mul(burning.mul(0.035)).mul(max(N.y, 0.0).mul(0.8).add(0.2));
        // (The hollows of its body — under the belly, inside the legs, the throat — see less sky.)
        const open = mix(float(0.3), float(1.0), sees);
        const light = moonLit.mul(mix(float(0.55), float(1.0), sees))
            .add(sky.add(bounce).add(rose).add(fires).mul(open));
        const lit = albedo.mul(light);
        // Against the moon the outline of its coat is lit through the hair: the longer, the more.
        const through = u.moonCol.mul(behind.mul(0.8).add(0.1)).mul(shadow.mul(0.8).add(0.2))
            .mul(float(1.0).sub(dark));
        const rim = through.mul(wSq(edge).mul(edge)).mul(fur.mul(0.5).add(0.3)).mul(LOOK.bearRim);
        // Deep in the coat it is dark; the tips stand in the light, and against the moon they glow.
        const depth = mix(float(0.8), float(1.0), smoothstep(0.0, 0.8, height));
        const halo = through.mul(wSq(height)).mul(0.45);
        return lit.mul(depth).add(rim).add(halo).mul(u.breath.mul(0.8).add(0.2));
    };

    const material = wSolidMaterial('WinterBear');
    material.side = THREE.DoubleSide;
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const V = toEye.div(max(length(toEye), 1e-3));
        // (Under shells of fur the skin is the coat's depths; without them it is the coat.)
        return wAir(u, coat(P, normalize(normalWorld), V, float(layers > 0 ? 0.0 : 0.7)), P);
    })();
    model.traverse((child) => {
        if (!child.isMesh) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m?.dispose?.());
        child.material = material;
        child.frustumCulled = false;
    });

    // ── Its coat: the same body again, in shells that stand off the skin ──
    // Each shell is a veil as thick as the share of the hairs that grow that long, so the coat is
    // dense at the skin and thins to a mist at its tips; the hair is combed back and down.
    let furMaterial = null;
    const coats = [];
    const furs = [];
    if (layers > 0) {
        furMaterial = wFxMaterial('WinterBearFur');
        furMaterial.side = THREE.FrontSide;
        const shell = float(instanceIndex).add(1.0).div(layers + 1);
        furMaterial.positionNode = Fn(() => {
            const reach = attribute('color', 'vec4').y.mul(HAIR).mul(shell);
            const grow = normalize(normalLocal.add(vec3(0.0, -0.35, -0.5).mul(shell)));
            const droop = vec3(0.0, -1.0, 0.0).mul(reach.mul(shell).mul(0.3));
            return positionLocal.add(grow.mul(reach)).add(droop);
        })();
        const vShell = varying(shell, 'wBearShell');
        const vBase = varying(positionGeometry, 'wBearBase');
        furMaterial.colorNode = Fn(() => {
            const height = clamp(vShell, 0.0, 1.0);
            // Hairs fixed to the coat where it was modelled, lying along the body.
            const grain = u.noise(vec2(vBase.x.add(vBase.y.mul(0.83)), vBase.z.mul(0.35).add(vBase.y.mul(0.31)))
                .mul(FUR_GRAIN));
            const tall = clamp(grain.r.sub(0.5).mul(1.7).add(0.55), 0.0, 1.0);
            const strand = smoothstep(height.sub(0.3), height.add(0.12), tall.mul(1.05));
            const thick = float(1.0).sub(height).pow(1.5).mul(strand.mul(0.75).add(0.25));
            const a = float(1.0).sub(thick.mul(-FUR_DENSITY / layers).exp()).mul(smoothstep(0.05, 0.25, vCoat.y));
            const P = positionWorld.toVar();
            const toEye = cameraPosition.sub(P);
            const V = toEye.div(max(length(toEye), 1e-3));
            const tone = grain.a.mul(0.12).add(0.94);
            return vec4(wAir(u, coat(P, normalize(normalWorld), V, height).mul(tone), P).mul(a), a);
        })();
        skins.forEach((skin) => {
            const geometry = shelled(skin.geometry, layers);
            coats.push(geometry);
            const fur = new THREE.SkinnedMesh(geometry, furMaterial);
            fur.name = 'WinterBearFur';
            fur.position.copy(skin.position);
            fur.quaternion.copy(skin.quaternion);
            fur.scale.copy(skin.scale);
            fur.bind(skin.skeleton, skin.bindMatrix);
            fur.frustumCulled = false;
            fur.renderOrder = 8;
            skin.parent.add(fur);
            furs.push(fur);
        });
    }

    // ── Its image in the bare ice ──
    let mirrorMaterial = null;
    const images = [];
    if (mirror) {
        mirrorMaterial = wFxMaterial('WinterBearMirror');
        // (Mirrored, its outside faces turn their backs: those are the ones that face the eye.)
        mirrorMaterial.side = THREE.BackSide;
        const body = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
        const mirrored = vec3(body.x, float(2 * ICE_Y).sub(body.y), body.z);
        // Laid on the ice along the line of sight, a hair above it.
        const flat = Fn(() => {
            const lift = cameraPosition.y.sub(ICE_Y + MIRROR_LIFT).div(max(cameraPosition.y.sub(mirrored.y), 1e-3));
            return cameraPosition.add(mirrored.sub(cameraPosition).mul(lift));
        })();
        mirrorMaterial.vertexNode = wClip(flat);
        const vBody = varying(body, 'wBearMirrorBody');
        const vFlat = varying(flat, 'wBearMirrorFlat');
        mirrorMaterial.colorNode = Fn(() => {
            const P = vFlat.toVar();
            const toEye = cameraPosition.sub(P);
            const V = toEye.div(max(length(toEye), 1e-3)).toVar();
            // What the mirror shows is the body as an eye under the ice would see it.
            const under = vec3(cameraPosition.x, float(2 * ICE_Y).sub(cameraPosition.y), cameraPosition.z);
            const fromBody = under.sub(vBody);
            const seen = coat(vBody, normalize(normalWorld), fromBody.div(max(length(fromBody), 1e-3)));
            // As much of the mirror as the ice gives here: bare, and seen at a grazing angle.
            const drift = u.noise(vec2(P.x.mul(0.043), P.z.mul(0.17)));
            const bare = wIceSwept(u, P, drift.r);
            const grazing = float(1.0).sub(clamp(V.y, 0.0, 1.0));
            const fresnel = wSq(wSq(grazing)).mul(grazing).mul(0.94).add(0.06);
            const k = bare.mul(fresnel).mul(0.66 * LOOK.bearMirror).mul(u.bearIce);
            return vec4(wAir(u, seen, P).mul(k), k);
        })();
        skins.forEach((skin) => {
            const image = new THREE.SkinnedMesh(skin.geometry, mirrorMaterial);
            image.name = 'WinterBearMirror';
            image.position.copy(skin.position);
            image.quaternion.copy(skin.quaternion);
            image.scale.copy(skin.scale);
            image.bind(skin.skeleton, skin.bindMatrix);
            image.frustumCulled = false;
            // (After the ground it lies on, before the snow that falls in front of it.)
            image.renderOrder = 4;
            skin.parent.add(image);
            images.push(image);
        });
    }

    // pivot (its place and heading on the ice) → model (its body, solved)
    const pivot = new THREE.Group();
    pivot.name = 'WinterBear';
    pivot.add(model);
    pivot.scale.setScalar(BEAR_SCALE);
    const poser = makePoser(model);

    return {
        mesh: pivot,
        material,
        mirrorMaterial,
        furMaterial,
        shells: layers,
        /** Whether the model is on the theme's skeleton (it is posed) or stands as it came. */
        rigged: poser.whole,
        triangles: skins.reduce((n, skin) => n + (skin.geometry.index ? skin.geometry.index.count / 3 : 0), 0),
        /** Draw the pose the plan resolved. */
        update(pose) {
            // (Its paws press a little into the snow on the ice.)
            pivot.position.set(pose.x, pose.y - 0.01, pose.z);
            pivot.rotation.set(0, pose.heading, 0);
            poser.pose(pose);
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            material.dispose();
            mirrorMaterial?.dispose();
            furMaterial?.dispose();
            images.forEach((image) => image.removeFromParent());
            furs.forEach((fur) => fur.removeFromParent());
            coats.forEach((geometry) => geometry.dispose());
            skins.forEach((skin) => skin.geometry.dispose());
        },
    };
}
