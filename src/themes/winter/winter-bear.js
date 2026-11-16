/* eslint-disable import/no-unresolved */
/**
 * Winter — the polar bears, drawn.
 *
 * The models are the theme's own (assets/polar-bear.glb and assets/polar-bear-cub.glb: each one
 * skinned mesh on the skeleton of winter-bear-rig.js, modelled in Blender and rigged by
 * scripts/winter/model-bear.mjs; see assets/ATTRIBUTION.md). They carry no clips: every frame the
 * plan's pose (winter-bear-plan.js) is solved by the rig and the rotations are copied onto the
 * bones. They load off the frame and join the scene when they arrive; until then the bear still
 * walks its course as far as the plan goes — it simply has no body yet.
 *
 * One grown body is every grown bear: who walks a lap (the big male, a smaller and slimmer female)
 * is the pose's size, how broad it is, the tone of its coat and the length of its hair. The cub
 * has a body of its own, on the same skeleton, drawn beside its mother on the laps that have one.
 * Both wear the same three materials: what differs between them reaches the shader per object.
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
    uniform,
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
export const BEAR_CUB_URL = new URL('./assets/polar-bear-cub.glb', import.meta.url).href;

/** How far over the ice (metres) its mirror image is laid: in front of the ice, never through it. */
const MIRROR_LIFT = 0.03;
/** How far a hair of length 1 stands off the skin (model metres). */
const HAIR = 0.085;
/** Tiles of the noise texture to a model metre of coat: its grain is the locks of hair. */
const FUR_GRAIN = 17;
/** How much further its longest hair stands off than HAIR (a share of it). */
const LONG_HAIR = 0.7;
/** How thick the whole coat is: the optical depth of all its shells at the skin. */
const FUR_DENSITY = 9;
/** The cub's shells of fur, against its mother's. */
const CUB_SHELLS = 0.6;
/** Frames the cub's body is drawn for when it arrives, lap with a cub or not (its pipelines). */
const CUB_WARM_FRAMES = 8;

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

/**
 * Fetch the models. Resolves null when the bear's cannot be read (the lake does without its bear);
 * the cub's rides along as `cub` (null if it cannot be read: its mother then walks alone).
 */
export async function loadBear(url = BEAR_URL, cubUrl = BEAR_CUB_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        const loader = new GLTFLoader();
        const [gltf, cub] = await Promise.all([
            loader.loadAsync(url),
            cubUrl ? loader.loadAsync(cubUrl).catch((error) => {
                console.warn('[Winter] the bear cub did not arrive:', error?.message || error);
                return null;
            }) : null,
        ]);
        gltf.cub = cub;
        return gltf;
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
 *
 * A lap may bring a cub (the pose's `cub`): it is drawn the same way, in its own body, where the
 * tier draws a coat of shells at all (every tier but the lowest; `cub` says otherwise).
 * @param {object} u     shared uniforms
 * @param {object} gltf  what loadBear() resolved (its `cub`: the cub's model, or none)
 * @param {object} [o]
 * @param {boolean} [o.mirror=true]  draw its image in the bare ice
 * @param {number} [o.shells=0]  shells of fur drawn over its skin (0: the skin is the coat)
 * @param {boolean} [o.cub]  draw the cub on the laps that have one (default: where shells > 0)
 */
export function createBear(u, gltf, { mirror = true, shells = 0, cub } = {}) {
    const layers = Math.max(0, Math.round(shells));
    // What differs from one body to the next reaches the three materials per object (userData.bear).
    const own = (key, fallback) => uniform(fallback)
        .onObjectUpdate(({ object }) => object.userData.bear?.[key] ?? fallback);
    /** The tone of its coat (0 white .. 1 old ivory), how long its hair stands, its shells of fur. */
    const uTone = own('tone', 0.5);
    const uHair = own('hair', 1);
    const uLayers = own('layers', Math.max(1, layers));
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
        // (Bear by bear the coat runs from nearly white to old ivory; the look's cream is the middle.)
        const cream = vec3(LOOK.bearCoatR, LOOK.bearCoatG, LOOK.bearCoatB)
            .mul(mix(vec3(1.03, 1.065, 1.16), vec3(0.97, 0.935, 0.84), uTone));
        const albedo = mix(cream, vec3(0.03, 0.028, 0.032), dark);
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

    // ── Its coat: the same body again, in shells that stand off the skin ──
    // Each shell is a veil as thick as the share of the hairs that grow that long, so the coat is
    // dense at the skin and thins to a mist at its tips; the hair is combed back and down.
    let furMaterial = null;
    if (layers > 0) {
        furMaterial = wFxMaterial('WinterBearFur');
        furMaterial.side = THREE.FrontSide;
        const shell = float(instanceIndex).add(1.0).div(uLayers.add(1.0));
        furMaterial.positionNode = Fn(() => {
            // Where the hair is long (the locks behind its legs, its trousers, the fringe under its
            // belly, a cub's fluff) it stands further off the skin yet, and hangs.
            const fur = attribute('color', 'vec4').y;
            const long = smoothstep(0.6, 1.0, fur);
            const reach = fur.mul(long.mul(LONG_HAIR).add(1.0)).mul(uHair.mul(HAIR)).mul(shell);
            const grow = normalize(normalLocal.add(vec3(0.0, -0.35, -0.5).mul(shell)));
            const droop = vec3(0.0, -1.0, 0.0).mul(reach.mul(shell).mul(long.mul(0.45).add(0.3)));
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
            const a = float(1.0).sub(thick.mul(float(-FUR_DENSITY).div(uLayers)).exp())
                .mul(smoothstep(0.05, 0.25, vCoat.y));
            const P = positionWorld.toVar();
            const toEye = cameraPosition.sub(P);
            const V = toEye.div(max(length(toEye), 1e-3));
            const tone = grain.a.mul(0.12).add(0.94);
            return vec4(wAir(u, coat(P, normalize(normalWorld), V, height).mul(tone), P).mul(a), a);
        })();
    }

    // ── Its image in the bare ice ──
    let mirrorMaterial = null;
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
    }

    /**
     * One body dressed for the scene: its skin in the coat's material, its shells of fur and its
     * image in the ice (each the same buffers and skeleton drawn again), on a pivot that is its place
     * and heading on the ice.
     */
    const dress = (model, name, furLayers) => {
        const skins = [];
        model.traverse((child) => {
            if (child.isSkinnedMesh) skins.push(child);
        });
        /** What the materials read of this body (per object). */
        const look = { tone: 0.5, hair: 1, layers: Math.max(1, furLayers) };
        model.traverse((child) => {
            if (!child.isMesh) return;
            (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m?.dispose?.());
            child.material = material;
            child.frustumCulled = false;
            child.userData.bear = look;
        });
        const again = (skin, geometry, drawn, suffix, order) => {
            const mesh = new THREE.SkinnedMesh(geometry, drawn);
            mesh.name = `${name}${suffix}`;
            mesh.position.copy(skin.position);
            mesh.quaternion.copy(skin.quaternion);
            mesh.scale.copy(skin.scale);
            mesh.bind(skin.skeleton, skin.bindMatrix);
            mesh.frustumCulled = false;
            mesh.renderOrder = order;
            mesh.userData.bear = look;
            skin.parent.add(mesh);
            return mesh;
        };
        const coats = [];
        const furs = [];
        if (furMaterial && furLayers > 0) {
            skins.forEach((skin) => {
                const geometry = shelled(skin.geometry, furLayers);
                coats.push(geometry);
                furs.push(again(skin, geometry, furMaterial, 'Fur', 8));
            });
        }
        // (Its image: after the ground it lies on, before the snow that falls in front of it.)
        const images = mirrorMaterial
            ? skins.map((skin) => again(skin, skin.geometry, mirrorMaterial, 'Mirror', 4))
            : [];
        const pivot = new THREE.Group();
        pivot.name = name;
        pivot.add(model);
        pivot.scale.setScalar(BEAR_SCALE);
        const poser = makePoser(model);
        return {
            pivot,
            look,
            poser,
            shells: furs.length ? furLayers : 0,
            triangles: skins.reduce((n, skin) => n + (skin.geometry.index ? skin.geometry.index.count / 3 : 0), 0),
            /** Draw a pose: its place and heading, who it is, and its bones. */
            update(pose) {
                const size = BEAR_SCALE * (pose.size ?? 1);
                // (Its paws press a little into the snow on the ice.)
                pivot.position.set(pose.x, pose.y - 0.01 * (pose.size ?? 1), pose.z);
                pivot.rotation.set(0, pose.heading, 0);
                pivot.scale.set(size * (pose.slim ?? 1), size, size);
                look.tone = pose.tone ?? 0.5;
                look.hair = pose.hair ?? 1;
                poser.pose(pose);
                pivot.updateMatrixWorld(true);
            },
            dispose() {
                images.forEach((image) => image.removeFromParent());
                furs.forEach((fur) => fur.removeFromParent());
                coats.forEach((geometry) => geometry.dispose());
                skins.forEach((skin) => skin.geometry.dispose());
            },
        };
    };

    const bear = dress(gltf.scene, 'WinterBear', layers);
    // The cub: where the tier draws a coat of shells at all, in a few fewer of them (it is half
    // its mother's size on screen).
    const withCub = (cub ?? layers > 0) && gltf.cub?.scene;
    const young = withCub ? dress(gltf.cub.scene, 'WinterBearCub', Math.ceil(layers * CUB_SHELLS)) : null;
    const root = new THREE.Group();
    root.name = 'WinterBears';
    root.add(bear.pivot);
    if (young) {
        root.add(young.pivot);
        // Drawn out of sight for its first frames, so its pipelines are not built on the frame it
        // first walks in beside its mother.
        young.warm = CUB_WARM_FRAMES;
    }

    return {
        mesh: root,
        material,
        mirrorMaterial,
        furMaterial,
        shells: layers,
        /** Whether the model is on the theme's skeleton (it is posed) or stands as it came. */
        rigged: bear.poser.whole,
        /** The triangles of one drawing of each body (the image and each shell draw them again). */
        triangles: bear.triangles,
        cubTriangles: young ? young.triangles : 0,
        cubShells: young ? young.shells : 0,
        /** Draw the pose the plan resolved (and its cub's, on a lap that has one). */
        update(pose) {
            bear.update(pose);
            if (!young) return;
            const there = Boolean(pose.cub?.present);
            if (there) young.update(pose.cub);
            else if (young.warm > 0) {
                // (Beside the bear, which starts every lap past the frame's edge.)
                young.warm -= 1;
                young.update({ ...pose, size: 0.4 });
            }
            young.pivot.visible = there || young.warm > 0;
        },
        dispose() {
            material.dispose();
            mirrorMaterial?.dispose();
            furMaterial?.dispose();
            bear.dispose();
            young?.dispose();
        },
    };
}
