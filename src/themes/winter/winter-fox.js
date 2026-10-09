/* eslint-disable import/no-unresolved */
/**
 * Winter — the fox, drawn.
 *
 * The model is the theme's own arctic fox (assets/arctic-fox.glb: one skinned mesh on the
 * skeleton of winter-fox-rig.js, rigged by scripts/winter/rig-fox.mjs; see
 * assets/ATTRIBUTION.md). It carries no clips: every frame the mind's pose
 * (winter-fox-mind.js) is solved by the rig and the rotations are copied onto its bones. It
 * loads off the frame and joins the scene when it arrives; until then the fox is still there as
 * far as the choreography goes — its sparks and prints simply have no body yet.
 *
 * Two bodies are made of it:
 *  - the fox on the snow. Its coat is fur, not paint: over the skin the mesh is drawn again in
 *    shells that stand off it, each a veil as thick as the share of the hairs that grow that
 *    long, so the fox has a soft, deep outline. The scene is lit from behind — the moon stands
 *    before the viewer — so the side of it we see is its shadow side, a shade warmer than the
 *    snow and darker, and the outline of its coat is what the moon lights. As the chain grows that
 *    outline takes the fires' colour, tail first;
 *  - the fox of light: the same animal bounding across the sky, kilometres long, drawn in
 *    aurora — what four lines call up.
 *
 * Each vertex's colour holds the coat's four numbers (the rigging script paints them): how far
 * along the tail it is, how long its fur is there, how dark it is painted (nose, eyes, the
 * hollows of its ears) and how much of the sky it sees.
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
    normalLocal,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    reflect,
    smoothstep,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    DEG, EYE, FOX_SCALE, SPIRIT_RUN, WIND, smooth, wAir, wFxMaterial, wMoonShadow, wPow4, wSolidMaterial,
} from './winter-tsl.js';
import {
    FOX_BONES, FOX_MARKS, createFoxPosture, createFoxSpec, foxSpec, solveFox,
} from './winter-fox-rig.js';

export const FOX_URL = new URL('./assets/arctic-fox.glb', import.meta.url).href;

/** How far a hair of length 1 stands off the skin (model metres; the tail's are longer, see the rig script). */
export const FUR_LENGTH = 0.036;
const FOX_EYE = FOX_MARKS.eye;
/** The way an eye slants: from its inner corner out, up and back (unit, for the left eye). */
const EYE_SLANT = [0.45, 0.33, -0.83];
/** The wind's bearing over the snow (unit, xz). */
const WIND_X = WIND.x / Math.hypot(WIND.x, WIND.z);
const WIND_Z = WIND.z / Math.hypot(WIND.x, WIND.z);
/** Tiles of the noise texture to a model metre of coat: its grain is the hairs. */
const FUR_GRAIN = 5.5;
/** How thick the whole coat is: the optical depth of all its shells at the skin. */
const FUR_DENSITY = 9;

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

/**
 * The same mesh drawn `shells` times over its skin in one call: the attributes are the mesh's
 * own (shared, not copied), only the count differs.
 */
function shelled(source, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(source.attributes).forEach((name) => geometry.setAttribute(name, source.attributes[name]));
    geometry.setIndex(source.index);
    geometry.instanceCount = Math.max(1, Math.round(count));
    geometry.boundingSphere = source.boundingSphere;
    geometry.boundingBox = source.boundingBox;
    return geometry;
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

/**
 * Pose a model from the mind's pose: the rig solves it, the bones take the answer.
 * (A model that is not on the rig's skeleton is left standing as it was made.)
 */
function makePoser(model) {
    const bones = FOX_BONES.map(([name]) => model.getObjectByName(name));
    const whole = bones.every((bone) => bone?.isBone);
    if (!whole) console.warn('[Winter] the fox model is not on the theme\'s skeleton (scripts/winter/rig-fox.mjs).');
    const spec = createFoxSpec();
    const posture = createFoxPosture();
    return {
        whole,
        posture,
        /** @param {object} p  the mind's pose */
        pose(p) {
            if (!whole) return;
            solveFox(foxSpec(p, spec), posture);
            for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(posture.local[i]);
            bones[0].position.fromArray(posture.at[0]);
        },
    };
}

/**
 * The fox on the snow.
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadFox() resolved
 * @param {object} [o]
 * @param {number} [o.shells=14]  shells of fur over the skin (0 = a painted coat)
 */
export function createFox(u, gltf, { shells = 14 } = {}) {
    const model = gltf.scene;
    const layers = Math.max(0, Math.round(shells));
    const skins = [];
    model.traverse((child) => {
        if (child.isSkinnedMesh) skins.push(child);
    });
    // tail, fur length (half of it), dark paint, sky seen
    const vCoat = varying(attribute('color', 'vec4'), 'wFoxCoat');
    // Where on the animal a fragment is (as it was modelled, whatever its pose).
    const vBase = varying(positionGeometry, 'wFoxBase');

    /** The coat's colour `height` of the way from the skin (0) to the tips of the fur (1). */
    const shade = (height) => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const toView = toEye.div(max(length(toEye), 1e-3)).toVar();
        const N = normalize(normalWorld).toVar();
        // Its eyes are drawn here, crisp, where the rigging script left a soft dark patch for
        // them (paint between vertices is a smudge): one dark almond each, slanted as a fox's
        // are, its outer corner higher and further back. Its lid shuts it to a line.
        const fromEye = vec3(vBase.x.abs().sub(FOX_EYE[0]), vBase.y.sub(FOX_EYE[1]), vBase.z.sub(FOX_EYE[2]));
        const along = dot(fromEye, vec3(EYE_SLANT[0], EYE_SLANT[1], EYE_SLANT[2]));
        const across = max(dot(fromEye, fromEye).sub(along.mul(along)), 0.0).sqrt();
        const almond = float(1.0).sub(smoothstep(0.0095, 0.012, length(vec2(along.mul(0.72), across.mul(1.45)))));
        const eye = almond.mul(float(1.0).sub(smoothstep(0.0012, 0.0035, across).mul(u.foxEyes)));
        const patch = float(1.0).sub(smoothstep(0.02, 0.03, length(fromEye)));
        const paint = max(clamp(vCoat.z, 0.0, 1.0).mul(float(1.0).sub(patch)), eye);
        const pale = float(1.0).sub(paint);
        const sees = clamp(vCoat.w, 0.0, 1.0);
        const tail = clamp(vCoat.x, 0.0, 1.0);
        // A winter coat is not the white of snow: it is a shade warmer, so the two part.
        const albedo = mix(vec3(0.04, 0.036, 0.045), vec3(1.0, 0.972, 0.94), pale);
        // It walks through the trees' shadows like everything else on the snow.
        const shadow = wMoonShadow(u, P.xz).toVar();
        // Fur scatters: the moon's light wraps far round it.
        const wrapped = max(dot(N, u.moonDir).add(0.5).div(1.5), 0.0);
        const facing = clamp(dot(N, toView), 0.0, 1.0);
        const edge = float(1.0).sub(facing);
        const behind = max(dot(toView.negate(), u.moonDir), 0.0);
        // Deep in the coat it is dark; the tips stand in the light.
        const depth = mix(float(0.44), float(1.0), smoothstep(0.0, 0.8, height));
        // The sky lights it from above and the snow from below — each less where its own body
        // is in the way (under its belly, inside its legs, at its throat).
        const sky = u.shade.mul(N.y.mul(0.35).add(0.5)).add(u.zenith.mul(max(N.y, 0.0)).mul(0.5)).add(u.band.mul(0.1));
        const bounce = u.shade.mul(0.32).add(u.moonCol.mul(shadow).mul(0.1)).mul(max(N.y.negate(), 0.0));
        const toGlow = normalize(vec3(u.glowDir.x, 0.25, u.glowDir.y));
        const rose = u.glow.mul(max(dot(N, toGlow), 0.0).mul(0.42).add(0.05));
        const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
        const fires = mix(u.fire, u.crown, 0.2).mul(burning.mul(0.04)).mul(max(N.y, 0.0).mul(0.8).add(0.2));
        const open = mix(float(0.22), float(1.0), sees);
        const light = u.moonCol.mul(wrapped).mul(shadow).mul(0.74).mul(mix(float(0.5), float(1.0), sees))
            .add(sky.add(bounce).add(rose).add(fires).mul(open));
        const lit = albedo.mul(light).mul(depth);
        // Against the moon the coat's outline is lit from within, and its tips glow.
        const lightThrough = u.moonCol.mul(behind.mul(0.85).add(0.15)).mul(shadow.mul(0.8).add(0.2)).mul(pale);
        const rim = lightThrough.mul(edge.mul(edge)).mul(1.25);
        const halo = lightThrough.mul(height.mul(height)).mul(0.95);
        // Its eyes are wet: the moon stands in each as one small point, brighter when the eye
        // is turned to mirror it (a whole eye gone white reads as blind, not bright).
        const spot = float(1.0).sub(smoothstep(0.0012, 0.003, length(fromEye.sub(vec3(0.0, 0.0035, 0.003)))));
        const mirrored = wPow4(max(dot(reflect(toView.negate(), N), u.moonDir), 0.0));
        const glint = spot.mul(mirrored.mul(1.6).add(0.5)).mul(eye);
        // The fires: the outline of its coat burns in them, and its tail is their torch.
        const flame = mix(u.fire, vec3(1.0), 0.2)
            .mul(edge.mul(edge).mul(height.mul(0.8).add(0.2)).mul(1.7)
                .add(tail.mul(height.mul(1.3).add(0.35)))
                .add(0.05))
            .mul(u.foxGlow)
            .mul(pale)
            .mul(1.5);
        return wAir(u, lit.add(rim).add(halo).add(u.moonCol.mul(glint)).add(flame)
            .mul(u.breath.mul(0.8).add(0.2)), P);
    };

    // ── The skin: the animal itself, solid ──
    const material = wSolidMaterial('WinterFox');
    material.side = THREE.DoubleSide;
    // (Without shells the skin is the coat: it is lit as the coat's surface, not its depths.)
    material.colorNode = Fn(() => shade(float(layers > 0 ? 0.0 : 0.7)))();
    swapMaterials(model, material);

    // ── The coat: the same mesh again, in shells that stand off the skin ──
    // Each shell is a veil: as thick as the share of the hairs that grow that long, so the coat
    // is dense at the skin and thins to a mist at its tips. Drawn inner to outer in one call,
    // front faces only, so each lies over the one inside it.
    let furMaterial = null;
    // Which way the wind blows as the fox, turned as it is, feels it (the model's own frame).
    let wind = null;
    const coats = [];
    const furs = [];
    if (layers > 0) {
        furMaterial = wFxMaterial('WinterFoxFur');
        furMaterial.side = THREE.FrontSide;
        wind = uniform(new THREE.Vector3(1, 0, 0));
        // (Shell i of n stands (i + 1) / (n + 1) of the way out: none at the skin, none at the
        // very tips, where no hair is left to draw.)
        const shell = float(instanceIndex).add(1.0).div(layers + 1);
        furMaterial.positionNode = Fn(() => {
            const reach = attribute('color', 'vec4').y.mul(2.0 * FUR_LENGTH).mul(shell);
            // A hair leaves the skin along its normal and is combed back and down as it grows.
            const grow = normalize(normalLocal.add(vec3(0.0, -0.3, -0.55).mul(shell)));
            const droop = vec3(0.0, -1.0, 0.0).mul(reach.mul(shell).mul(0.32));
            // The wind is in it: the tips lean with the gusts.
            const blown = wind.mul(u.gale.mul(0.52)).mul(reach.mul(shell));
            return positionLocal.add(grow.mul(reach)).add(droop).add(blown);
        })();
        const vShell = varying(shell, 'wFoxShell');
        furMaterial.colorNode = Fn(() => {
            const height = clamp(vShell, 0.0, 1.0);
            // Hairs are fixed to the coat where it was modelled, and lie along the body: a fine
            // grain, stretched nose to tail, says how long the hairs are at each spot. (It is
            // the world's noise texture, so from the game's distance, where a hair is finer than
            // a pixel, its mip levels hand back the hairs' average instead of their noise.)
            const grain = u.noise(vec2(
                vBase.x.add(vBase.y.mul(0.83)),
                vBase.z.mul(0.4).add(vBase.y.mul(0.31)),
            ).mul(FUR_GRAIN));
            const tall = clamp(grain.r.sub(0.5).mul(2.6).add(0.5), 0.0, 1.0);
            const strand = smoothstep(height.sub(0.3), height.add(0.12), tall.mul(1.05));
            // The share of the hairs that reach this high.
            const thick = float(1.0).sub(height).pow(1.5).mul(strand.mul(0.75).add(0.25));
            const fur = clamp(vCoat.y.mul(2.0), 0.0, 2.0);
            const a = float(1.0).sub(thick.mul(-FUR_DENSITY / layers).exp()).mul(smoothstep(0.03, 0.2, fur));
            // (One hair is a little lighter, the next a little darker: up close they tell apart.)
            const tone = grain.a.mul(0.36).add(0.82);
            return vec4(shade(height).mul(tone).mul(a), a);
        })();
        skins.forEach((skin) => {
            const geometry = shelled(skin.geometry, layers);
            coats.push(geometry);
            const fur = new THREE.SkinnedMesh(geometry, furMaterial);
            fur.name = 'WinterFoxFur';
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

    // pivot (its place and heading on the snow, larger than life) → model (its body, solved)
    const pivot = new THREE.Group();
    pivot.name = 'WinterFox';
    pivot.add(model);
    pivot.scale.setScalar(FOX_SCALE);
    const poser = makePoser(model);

    return {
        mesh: pivot,
        material,
        furMaterial,
        shells: layers,
        /** Whether the model is on the theme's skeleton (it is posed) or stands as it came. */
        rigged: poser.whole,
        /** Draw the pose the mind resolved. */
        update(pose) {
            // (Its paws press a little way into the snow.)
            pivot.position.set(pose.x, pose.y + pose.lift - 0.02, pose.z);
            pivot.rotation.set(0, pose.heading, 0);
            if (wind) {
                const sin = Math.sin(pose.heading);
                const cos = Math.cos(pose.heading);
                wind.value.set(WIND_X * cos - WIND_Z * sin, 0, WIND_X * sin + WIND_Z * cos);
            }
            poser.pose(pose);
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            material.dispose();
            furMaterial?.dispose();
            furs.forEach((fur) => fur.removeFromParent());
            coats.forEach((geometry) => geometry.dispose());
            // (The coat and the fox of light are drawn from the same attributes: they go once, here.)
            skins.forEach((skin) => skin.geometry.dispose());
        },
    };
}

/** How far off the fox of light runs, and how much of the sky it spans. */
const SPIRIT_FAR = 5600;
const SPIRIT_SPAN = 23 * DEG;
/** Cycles of its gallop a second: long and unhurried. */
const SPIRIT_GAIT = 0.85;

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
 * @param {object} [o]
 * @param {number} [o.shells=5]  veils of light it wears over its body (0 = the body alone)
 */
export function createSpiritFox(u, gltf, { shells = 5 } = {}) {
    const model = SkeletonUtils.clone(gltf.scene);
    const coats = [];
    // (The clone comes with a copy of the fox's coat of fur, if that was made first: light has none.)
    const furred = [];
    model.traverse((child) => {
        if (child.name === 'WinterFoxFur') furred.push(child);
    });
    furred.forEach((child) => child.removeFromParent());
    model.traverse((child) => {
        if (!child.isSkinnedMesh) return;
        // (The body itself and a veil for every shell.)
        child.geometry = shelled(child.geometry, Math.max(0, Math.round(shells)) + 1);
        coats.push(child.geometry);
    });
    const layers = Math.max(1, Math.round(shells));
    const material = wFxMaterial('WinterSpiritFox');
    const veil = shells > 0 ? float(instanceIndex).div(layers) : float(0.0);
    if (shells > 0) {
        // Each veil stands further off the body and streams back from it: an aura, not a shell.
        material.positionNode = Fn(() => {
            const reach = veil.mul(0.085).mul(attribute('color', 'vec4').y.add(0.6));
            const stream = vec3(0.0, 0.25, -1.0).mul(veil.mul(veil).mul(0.12));
            return positionLocal.add(normalLocal.mul(reach)).add(stream);
        })();
    }
    const vVeil = varying(veil, 'wSpiritVeil');
    const vBody = varying(positionGeometry, 'wSpiritBody');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const toView = normalize(cameraPosition.sub(P));
        const N = normalize(normalWorld);
        const edge = float(1.0).sub(clamp(dot(N, toView).abs(), 0.0, 1.0));
        const out = clamp(vVeil, 0.0, 1.0);
        // It is drawn in aurora: rays stand in it and run along it, green at the foot, violet above.
        const along = vBody.z;
        const rays = u.noise(vec2(along.mul(1.7).sub(u.time.mul(0.35)), vBody.y.mul(0.12).add(0.4))).r;
        const drift = u.noise(vec2(along.mul(0.5).add(u.time.mul(0.05)), vBody.y.mul(0.6))).a;
        const tall = clamp(vBody.y.div(0.65), 0.0, 1.0);
        const colour = mix(u.fire, u.crown, smoothstep(0.25, 1.0, tall)).add(vec3(1.0).mul(edge.mul(edge).mul(0.5)));
        const body = edge.mul(edge).mul(1.7).add(rays.mul(rays).mul(1.2)).add(drift.mul(0.25))
            .add(0.06);
        // Its head burns brightest; behind, it is already going out.
        const fore = smoothstep(-0.55, 0.45, along).mul(0.75).add(0.25);
        // The veils are fainter the further they stand off, and only their edges show.
        const fade = mix(float(1.0), edge.mul(edge).mul(0.55), smoothstep(0.0, 0.25, out)).mul(float(1.0).sub(out.mul(0.75)));
        return vec4(colour.mul(body).mul(fore).mul(fade).mul(u.spirit.z)
            .mul(u.breath)
            .mul(1.5), 0.0);
    })();
    // (The clone still carries the fox's own material: it is replaced, not retired.)
    swapMaterials(model, material, false);
    const pivot = new THREE.Group();
    pivot.name = 'WinterSpiritFox';
    pivot.add(model);
    pivot.visible = false;
    // The model is about a metre long, nose to tail.
    const scale = (2 * SPIRIT_FAR * Math.tan(SPIRIT_SPAN / 2)) / 1.08;
    pivot.scale.setScalar(scale);
    const poser = makePoser(model);
    const at = spiritPath(0);
    // A full gallop, its tail streaming and swinging behind it.
    const stride = {
        clip: 'Run', clipTime: 0, from: 'Run', fromTime: 0, blend: 1, phase: 0, speed: 7, amp: 1, tailYaw: 0, tailLift: 0.55,
    };

    return {
        mesh: pivot,
        material,
        shells: Math.max(0, Math.round(shells)),
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
            stride.phase = age * SPIRIT_GAIT;
            stride.tailYaw = Math.sin(age * 2.4) * 0.22;
            poser.pose(stride);
            pivot.updateMatrixWorld(true);
            return smooth(0, 0.07, k) * (1 - smooth(0.8, 1, k));
        },
        dispose() {
            material.dispose();
            coats.forEach((geometry) => geometry.dispose());
        },
    };
}
