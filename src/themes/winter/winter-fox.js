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
    exp,
    float,
    fwidth,
    instanceIndex,
    length,
    max,
    mix,
    normalGeometry,
    normalLocal,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    reflect,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    DEG, EYE, LOOK, SPIRIT_RUN, WIND, groundHeight, groundNormal, smooth, wAir, wFxMaterial, wMoonShadow, wPow4,
    wSolidMaterial, wSq,
} from './winter-tsl.js';
import { FOX_BONES, FOX_MARKS, FOX_RIG } from './winter-fox-rig.js';

export const FOX_URL = new URL('./assets/arctic-fox.glb', import.meta.url).href;

/** How far a hair of length 1 stands off the skin (model metres; the tail's are longer, see the rig script). */
export const FUR_LENGTH = 0.036;
const FOX_EYE = FOX_MARKS.eye;
/** The way an eye slants: from its inner corner out, up and back (unit, for the left eye). */
const EYE_SLANT = [0.45, 0.33, -0.83];
/** The wind's bearing over the snow (unit, xz). */
const WIND_X = WIND.x / Math.hypot(WIND.x, WIND.z);
const WIND_Z = WIND.z / Math.hypot(WIND.x, WIND.z);
/**
 * Tiles of the noise texture to a model metre of coat, across the way the hair lies and along it:
 * its grain is the hairs, a few millimetres apart and some centimetres long.
 */
const FUR_ACROSS = 52;
const FUR_ALONG = 3.4;
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
function makePoser(model, rig = FOX_RIG) {
    const bones = FOX_BONES.map(([name]) => model.getObjectByName(name));
    const whole = bones.every((bone) => bone?.isBone);
    if (!whole) console.warn('[Winter] the fox model is not on the theme\'s skeleton (scripts/winter/rig-fox.mjs).');
    const spec = rig.createSpec();
    const posture = rig.createPosture();
    return {
        whole,
        posture,
        /** @param {object} p  the mind's pose */
        pose(p) {
            if (!whole) return;
            rig.solve(rig.spec(p, spec), posture);
            for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(posture.local[i]);
            bones[0].position.fromArray(posture.at[0]);
        },
    };
}

/**
 * The coats an arctic fox wears in winter. The same animal comes in two: white, and the "blue"
 * morph, which stays charcoal to blue-grey brown all winter. Colours are scene-linear albedo.
 *
 *  fur, under   its coat, and the paler fur of its belly, chin and (by `muzzle`) its muzzle
 *  skin         what is painted dark: its nose, its eyes and their rims, the line of its mouth
 *  ear          the hollows of its ears
 *  smoke        how much darker the last of its tail is (a few dark hairs at the tip of the brush)
 *  frost        how much paler the tips of its hairs are than their roots
 *  sheen        how much of the moon comes through the outline of its coat (a dark coat lets less)
 *  liner        how dark the rims of its eyes are
 *  fluff        how long its fur is against the white fox's
 */
export const FOX_COATS = Object.freeze({
    white: Object.freeze({
        fur: Object.freeze([1.0, 0.972, 0.94]),
        under: Object.freeze([1.0, 0.99, 0.975]),
        skin: Object.freeze([0.04, 0.036, 0.045]),
        ear: Object.freeze([0.6, 0.47, 0.46]),
        muzzle: 0.6,
        smoke: 0.22,
        frost: 0,
        sheen: 1,
        liner: 0.9,
        fluff: 1,
    }),
    blue: Object.freeze({
        fur: Object.freeze([0.27, 0.25, 0.265]),
        under: Object.freeze([0.4, 0.365, 0.36]),
        skin: Object.freeze([0.03, 0.028, 0.034]),
        ear: Object.freeze([0.13, 0.105, 0.11]),
        muzzle: 0.75,
        smoke: 0.15,
        frost: 0.55,
        sheen: 0.4,
        liner: 0.6,
        fluff: 0.92,
    }),
});

/** The pad of its nose: where it is (the midline; y, z) and how large (model metres). */
const NOSE_AT = [0.4545, 0.5275];
const NOSE_SIZE = [0.0158, 0.0125, 0.0122];
/**
 * The line of its mouth along the side of its muzzle: how high it runs (`y`), how much it turns
 * up toward its corner (`smile`), where its corner is and where the muzzle's front (z), and half
 * its width.
 */
const LIP = Object.freeze({
    y: 0.4392, smile: 0.0075, corner: 0.455, front: 0.5, width: 0.0011,
});
/** How far out of the snow its shadow is laid, and how wide the quad it is drawn on (m). */
const SHADOW_SPAN = 2.6;

/**
 * The fox on the snow.
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadFox() resolved
 * @param {object} [o]
 * @param {number} [o.shells=14]  shells of fur over the skin (0 = a painted coat)
 * @param {object} [o.coat]   its coat (FOX_COATS.white)
 * @param {object} [o.rig]    the rig its mind poses it with (FOX_RIG; a fox of another size has its own)
 * @param {boolean} [o.second]  another fox of the same model: it is drawn on a copy of the
 *     skeleton, shares the first one's mesh, and lays its own shadow on the snow (the snow's
 *     material lays the first one's)
 */
export function createFox(u, gltf, {
    shells = 14, coat = FOX_COATS.white, rig = FOX_RIG, second = false,
} = {}) {
    const model = second ? SkeletonUtils.clone(gltf.scene) : gltf.scene;
    if (second) {
        // (The copy comes with a copy of the first fox's coat of fur, if that was made first.)
        const furred = [];
        model.traverse((child) => {
            if (child.name === 'WinterFoxFur') furred.push(child);
        });
        furred.forEach((child) => child.removeFromParent());
    }
    const layers = Math.max(0, Math.round(shells));
    const skins = [];
    model.traverse((child) => {
        if (child.isSkinnedMesh) skins.push(child);
    });
    // tail, fur length (half of it), dark paint, sky seen
    const vCoat = varying(attribute('color', 'vec4'), 'wFoxCoat');
    // Where on the animal a fragment is, and which way its skin faces there (as it was modelled,
    // whatever its pose).
    const vBase = varying(positionGeometry, 'wFoxBase');
    const vRest = varying(normalGeometry, 'wFoxRest');
    /** How far its eyes are shut, and how brightly it burns (each fox its own). */
    const eyes = uniform(0);
    const glow = uniform(0);

    /**
     * What is drawn on its face, crisp, where paint between vertices would be a smudge: its eyes
     * (one dark, nearly round almond each, slanted as a fox's are, its outer corner higher and
     * further back; its lid shuts it to a line) and their rims, the pad of its nose, and the line
     * of its mouth.
     */
    const marks = () => {
        const side = vBase.x.abs();
        const fromEye = vec3(side.sub(FOX_EYE[0]), vBase.y.sub(FOX_EYE[1]), vBase.z.sub(FOX_EYE[2]));
        const along = dot(fromEye, vec3(EYE_SLANT[0], EYE_SLANT[1], EYE_SLANT[2]));
        const across = max(dot(fromEye, fromEye).sub(along.mul(along)), 0.0).sqrt();
        const almond = float(1.0).sub(smoothstep(0.0105, 0.0125, length(vec2(along.mul(0.92), across.mul(1.15)))));
        const eye = almond.mul(float(1.0).sub(smoothstep(0.0012, 0.0035, across).mul(eyes)));
        // Its eyes are lined: a dark rim, drawn out a little toward its nose.
        const rimmed = length(vec2(along.add(0.0025).mul(0.8), across.mul(1.1)));
        const liner = float(1.0).sub(smoothstep(0.0125, 0.0185, rimmed)).mul(coat.liner);
        // (The rigging script left a soft dark patch where each eye goes: the eye replaces it.)
        const patch = float(1.0).sub(smoothstep(0.02, 0.03, length(fromEye)));
        const fromNose = vec3(vBase.x, vBase.y.sub(NOSE_AT[0]), vBase.z.sub(NOSE_AT[1]));
        const padded = length(fromNose.div(vec3(NOSE_SIZE[0], NOSE_SIZE[1], NOSE_SIZE[2])));
        const nose = float(1.0).sub(smoothstep(0.9, 1.08, padded));
        // The line of its mouth runs back along each side of its muzzle and turns up at the
        // corner; a cleft joins it to its nose.
        const back = float(1.0).sub(smoothstep(LIP.corner, LIP.front, vBase.z));
        const lipY = back.mul(LIP.smile).add(LIP.y);
        const lip = float(1.0).sub(smoothstep(LIP.width, LIP.width * 2.4, vBase.y.sub(lipY).abs()))
            .mul(smoothstep(LIP.corner - 0.005, LIP.corner + 0.002, vBase.z));
        const cleft = float(1.0).sub(smoothstep(0.0008, 0.002, side))
            .mul(smoothstep(LIP.y - 0.001, LIP.y + 0.001, vBase.y))
            .mul(float(1.0).sub(smoothstep(NOSE_AT[0] - 0.008, NOSE_AT[0] - 0.003, vBase.y)))
            .mul(smoothstep(LIP.front, LIP.front + 0.008, vBase.z));
        // Where the moon stands in each eye (see shade()).
        const spot = float(1.0).sub(smoothstep(0.0012, 0.003, length(fromEye.sub(vec3(0.0, 0.0035, 0.003)))));
        return {
            eye, liner, patch, nose, mouth: max(lip, cleft), spot,
        };
    };

    /** The coat's colour `height` of the way from the skin (0) to the tips of the fur (1). */
    const shade = (height, m) => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const toView = toEye.div(max(length(toEye), 1e-3)).toVar();
        const N = normalize(normalWorld).toVar();
        const painted = clamp(vCoat.z, 0.0, 1.0);
        // (The script's paint is two things: black on its nose and eyes, a shade in its ears.)
        const earZone = smoothstep(0.552, 0.568, vBase.y);
        const hollow = smoothstep(0.08, 0.3, painted).mul(earZone);
        const black = painted.mul(float(1.0).sub(earZone)).mul(float(1.0).sub(m.patch));
        const paint = max(max(black, m.eye), max(max(m.nose, m.mouth), m.liner));
        const pale = float(1.0).sub(paint);
        const sees = clamp(vCoat.w, 0.0, 1.0);
        const tail = clamp(vCoat.x, 0.0, 1.0);
        // A winter coat is not the white of snow: it is a shade warmer, so the two part. Its
        // belly, its chin and its muzzle are paler; the last of its brush is smoked.
        const under = smoothstep(0.1, 0.75, vRest.y.negate());
        const muzzle = smoothstep(0.445, 0.5, vBase.z).mul(float(1.0).sub(smoothstep(0.47, 0.5, vBase.y)));
        const upper = vec3(coat.fur[0], coat.fur[1], coat.fur[2]);
        const lower = vec3(coat.under[0], coat.under[1], coat.under[2]);
        const fur = mix(upper, lower, max(under, muzzle.mul(coat.muzzle)))
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, tail).mul(coat.smoke)))
            .mul(height.mul(coat.frost).add(1.0));
        const coated = mix(fur, vec3(coat.ear[0], coat.ear[1], coat.ear[2]), hollow.mul(0.75));
        const albedo = mix(vec3(coat.skin[0], coat.skin[1], coat.skin[2]), coated, pale);
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
        const lightThrough = u.moonCol.mul(behind.mul(0.85).add(0.15)).mul(shadow.mul(0.8).add(0.2)).mul(pale)
            .mul(coat.sheen);
        const rim = lightThrough.mul(edge.mul(edge)).mul(1.25);
        const halo = lightThrough.mul(height.mul(height)).mul(0.95);
        // Its eyes are wet: the moon stands in each as one small point, brighter when the eye
        // is turned to mirror it (a whole eye gone white reads as blind, not bright). Its nose
        // is wet too: the sky lies on the top of it.
        const mirrored = wPow4(max(dot(reflect(toView.negate(), N), u.moonDir), 0.0));
        const glint = m.spot.mul(mirrored.mul(1.6).add(0.5)).mul(m.eye);
        const wet = u.zenith.mul(m.nose).mul(max(N.y, 0.0)).mul(0.22);
        // The fires: the outline of its coat burns in them, and its tail is their torch.
        const flame = mix(u.fire, vec3(1.0), 0.2)
            .mul(edge.mul(edge).mul(height.mul(0.8).add(0.2)).mul(1.7)
                .add(tail.mul(height.mul(1.3).add(0.35)))
                .add(0.05))
            .mul(glow)
            .mul(pale)
            .mul(1.5);
        const all = lit.add(rim).add(halo).add(u.moonCol.mul(glint).add(wet)).add(flame);
        return wAir(u, all.mul(u.breath.mul(0.8).add(0.2)), P);
    };

    // ── The skin: the animal itself, solid ──
    const material = wSolidMaterial(second ? 'WinterFoxVisitor' : 'WinterFox');
    material.side = THREE.DoubleSide;
    // (Without shells the skin is the coat: it is lit as the coat's surface, not its depths.)
    material.colorNode = Fn(() => shade(float(layers > 0 ? 0.0 : 0.7), marks()))();
    swapMaterials(model, material, !second);

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
        furMaterial = wFxMaterial(second ? 'WinterFoxVisitorFur' : 'WinterFoxFur');
        furMaterial.side = THREE.FrontSide;
        wind = uniform(new THREE.Vector3(1, 0, 0));
        // (Shell i of n stands (i + 1) / (n + 1) of the way out: none at the skin, none at the
        // very tips, where no hair is left to draw.)
        const shell = float(instanceIndex).add(1.0).div(layers + 1);
        furMaterial.positionNode = Fn(() => {
            const reach = attribute('color', 'vec4').y.mul(2.0 * FUR_LENGTH * coat.fluff).mul(shell);
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
            const m = marks();
            // Hairs are fixed to the coat where it was modelled and lie along it: nose to tail
            // over its body, down its legs, down its chest and its face. Their grain is the
            // world's noise texture, drawn out along the way the hair lies and fine across it,
            // read once for each way its skin may face and weighed by the way it does (sharply:
            // where two readings meet half and half they cross like cloth). The hairs' line
            // wanders a little over the coat. From the game's distance, where a hair is finer
            // than a pixel, the texture's mip levels hand back the hairs' average, not their noise.
            const faces = vRest.abs();
            const weigh = wSq(wSq(faces));
            const onLeg = float(1.0).sub(smoothstep(0.15, 0.27, vBase.y));
            const over = vec2(vBase.z.mul(4.1).add(vBase.y.mul(2.3)), vBase.x.mul(3.7).add(vBase.y.mul(1.9)));
            const wander = u.noise(over).r.sub(0.5).mul(0.014);
            const flank = u.noise(vec2(vBase.y.add(wander).mul(FUR_ACROSS), vBase.z.mul(FUR_ALONG)));
            const down = vBase.y.mul(FUR_ALONG);
            const legSide = u.noise(vec2(vBase.z.add(wander).mul(FUR_ACROSS).add(0.11), down.add(0.63)));
            const back = u.noise(vec2(vBase.x.add(wander).mul(FUR_ACROSS).add(0.37), vBase.z.mul(FUR_ALONG).add(0.21)));
            const front = u.noise(vec2(vBase.x.add(wander).mul(FUR_ACROSS).add(0.53), down.add(0.4)));
            const grain = mix(flank, legSide, onLeg).mul(weigh.x).add(back.mul(weigh.y)).add(front.mul(weigh.z))
                .div(weigh.x.add(weigh.y).add(weigh.z).add(1e-4));
            // How far off it is seen: a pixel that covers several hairs cannot tell them apart.
            const far = smoothstep(0.0012, 0.0045, length(fwidth(vBase)));
            const fur = clamp(vCoat.y.mul(2.0), 0.0, 2.0);
            // (Where its fur is short — its face, its paws — the hairs lie close: less of them shows.)
            const stand = mix(float(3.6), float(2.6), far).mul(smoothstep(0.2, 0.9, fur).mul(0.6).add(0.4));
            const tall = clamp(grain.r.sub(0.5).mul(stand).add(0.5), 0.0, 1.0);
            const strand = smoothstep(
                height.sub(mix(float(0.1), float(0.3), far)),
                height.add(mix(float(0.05), float(0.12), far)),
                tall.mul(1.05),
            );
            // The share of the hairs that reach this high.
            const thick = float(1.0).sub(height).pow(1.5)
                .mul(strand.mul(mix(float(0.92), float(0.75), far)).add(mix(float(0.08), float(0.25), far)));
            // (No fur stands over what is drawn on its face.)
            const bare = max(max(m.eye, m.nose), max(m.mouth, m.liner.mul(0.85)));
            const a = float(1.0).sub(thick.mul(-FUR_DENSITY / layers).exp()).mul(smoothstep(0.03, 0.2, fur))
                .mul(float(1.0).sub(bare));
            // (One hair is a little lighter, the next a little darker: up close they tell apart.)
            const tone = grain.a.mul(0.36).add(0.82);
            return vec4(shade(height, m).mul(tone).mul(a), a);
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
    pivot.scale.setScalar(rig.scale);
    const poser = makePoser(model, rig);

    // ── Its shadow, for a fox the snow's material knows nothing of ──
    // The moon lays it toward the viewer: a soft dark place on the snow, tilted with the ground.
    let whole = pivot;
    let shadow = null;
    let shadowMaterial = null;
    if (second) {
        shadowMaterial = wFxMaterial('WinterFoxShadow');
        shadowMaterial.side = THREE.FrontSide;
        shadowMaterial.polygonOffset = true;
        shadowMaterial.polygonOffsetFactor = -2;
        shadowMaterial.polygonOffsetUnits = -2;
        shadowMaterial.colorNode = Fn(() => {
            const far = length(uv().sub(0.5)).mul(SHADOW_SPAN);
            // (The same soft dark place the snow lays under the fox, gone by the quad's edge.)
            const inside = float(1.0).sub(smoothstep(0.42, 0.5, far.div(SHADOW_SPAN)));
            return vec4(0.0, 0.0, 0.0, exp(wSq(far.div(0.62)).negate()).mul(0.42).mul(inside));
        })();
        const geometry = new THREE.PlaneGeometry(SHADOW_SPAN, SHADOW_SPAN);
        geometry.rotateX(-Math.PI / 2);
        shadow = new THREE.Mesh(geometry, shadowMaterial);
        shadow.name = 'WinterFoxShadow';
        shadow.frustumCulled = false;
        shadow.renderOrder = 5;
        whole = new THREE.Group();
        whole.name = 'WinterFoxVisitor';
        whole.add(pivot);
        whole.add(shadow);
    }
    const up = new THREE.Vector3(0, 1, 0);
    const lie = new THREE.Vector3();
    const normal = [0, 1, 0];

    return {
        mesh: whole,
        material,
        furMaterial,
        shells: layers,
        coat,
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
            eyes.value = pose.eyes ?? 0;
            glow.value = pose.glow ?? 0;
            poser.pose(pose);
            if (shadow) {
                const moon = u.moonDir.value;
                const x = pose.x - moon.x * 0.55;
                const z = pose.z - moon.z * 0.55;
                groundNormal(x, z, 0.4, normal);
                shadow.position.set(x, groundHeight(x, z) + 0.03, z);
                shadow.quaternion.setFromUnitVectors(up, lie.set(normal[0], normal[1], normal[2]));
            }
            whole.updateMatrixWorld(true);
        },
        dispose() {
            material.dispose();
            furMaterial?.dispose();
            shadowMaterial?.dispose();
            shadow?.geometry.dispose();
            furs.forEach((fur) => fur.removeFromParent());
            coats.forEach((geometry) => geometry.dispose());
            // (The coat, a second fox and the fox of light are drawn from the same attributes:
            // they go once, with the first fox.)
            if (!second) skins.forEach((skin) => skin.geometry.dispose());
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
        // The veils are fainter the further they stand off. Each glows where it faces the eye and
        // is gone at its own silhouette, so the stack sums to a soft aura round the body: a veil
        // that showed only its edge drew one outline a veil, and the fox read as a contour map.
        const veilGlow = wSq(float(1.0).sub(edge)).mul(LOOK.spiritVeil);
        const fade = mix(float(1.0), veilGlow, smoothstep(0.0, 0.25, out)).mul(float(1.0).sub(out.mul(0.75)));
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
