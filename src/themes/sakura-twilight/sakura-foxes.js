/**
 * Sakura Twilight — the two foxes, drawn.
 *
 * The model is the garden's red fox (assets/sakura-fox.glb: the glTF sample fox, rounded and
 * put on the fox rig by scripts/sakura/rig-fox.mjs — see assets/ATTRIBUTION.md). It carries no
 * clips: every frame each fox's pose, resolved by the pair's mind (sakura-fox-mind.js), is
 * solved by the rig (sakura-fox-rig.js on ../shared/fox-rig.js) and the rotations are copied
 * onto its bones.
 *
 * It is lit by the garden's own rig — the moon, the violet sky, the lanterns it sits beside —
 * instead of scene lights, so it sits in the picture on both backends. Its coat is fur, not
 * paint: over the skin the mesh is drawn again in shells that stand off it, each a veil as
 * thick as the share of the hairs that grow that long, so it has a soft outline the moon and
 * the lanterns catch. The model had no eyes to speak of: they are drawn where its eyes are.
 *
 * Each vertex's colour holds the coat's numbers (the rigging script bakes them): how far along
 * the brush it is, how long its fur is there, and how much of the sky it sees.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, dot, float, instanceIndex, length, max, mix, modelWorldMatrixInverse,
    normalLocal, normalWorld, normalize, positionGeometry, positionLocal, positionWorld, smoothstep, texture, uniform,
    uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SAKURA_STONE_LANTERNS } from './sakura-composition.js';
import { sakuraPathZ, sakuraTerrainHeight } from './sakura-terrain.js';
import { SAKURA_FOX_PAIR, SakuraFoxMind } from './sakura-fox-mind.js';
import { SAKURA_FOX_BONES, SAKURA_FOX_MARKS, createSakuraFoxRig } from './sakura-fox-rig.js';

/** Shells of fur over the skin at each quality (0: the coat is painted on the skin). */
export const SAKURA_FOX_FUR = Object.freeze({
    Minimal: 0, Low: 5, Medium: 8, High: 12, Ultra: 16, Extreme: 20,
});
/** How far a hair of length 1 stands off the skin (model metres; the brush's are longer). */
const FUR_LENGTH = 0.042;
/** Tiles of the noise texture to a model metre of coat: its grain is the hairs. */
const FUR_GRAIN = 3.4;
/** How thick the whole coat is: the optical depth of all its shells at the skin. */
const FUR_DENSITY = 9;
const EYE = SAKURA_FOX_MARKS.eye;
/** The way an eye slants: from its inner corner out, up and back (unit, for the left eye). */
const EYE_SLANT = [0.5, 0.3, -0.812];
/** How hard each thing a fox does lifts the petals lying round it (a burst in the petal simulation). */
const KICKS = Object.freeze({
    leap: Object.freeze({ radius: 2.8, power: 13, up: 8 }),
    land: Object.freeze({ radius: 1.9, power: 8, up: 6 }),
    shake: Object.freeze({ radius: 1.3, power: 5, up: 5 }),
    dig: Object.freeze({ radius: 1.0, power: 3.5, up: 4.5 }),
});

/** The same mesh drawn `count` times in one call: the attributes are the mesh's own. */
function shelled(source, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(source.attributes).forEach((name) => geometry.setAttribute(name, source.attributes[name]));
    geometry.setIndex(source.index);
    geometry.instanceCount = Math.max(1, Math.round(count));
    geometry.boundingSphere = source.boundingSphere;
    geometry.boundingBox = source.boundingBox;
    return geometry;
}

export class SakuraFoxes {
    /**
     * `fox` is the parsed glTF ({ scene }) or null when it failed to load.
     * @param {object} o
     * @param {object} o.light    the garden's light rig
     * @param {object|null} o.fox
     * @param {string} [o.quality]
     */
    constructor({ light, fox, quality = 'High' }) {
        this.light = light;
        this.fox = fox;
        this.shells = SAKURA_FOX_FUR[quality] ?? SAKURA_FOX_FUR.High;
        this.group = new THREE.Group();
        this.group.name = 'SakuraFoxes';
        this.owned = [];
        this.foxes = [];
        this.mind = new SakuraFoxMind({
            pathZ: sakuraPathZ,
            height: sakuraTerrainHeight,
            // (They go round the lanterns that stand by the path, and stop beside them.)
            lanterns: SAKURA_STONE_LANTERNS.map((lantern) => [lantern.x, lantern.z]),
        });
        this.time = 0;
        this.startled = 0;
        this.signals = { moon: 0, lanterns: 0 };
        /**
         * Where a fox has just come down, shaken itself or scraped at the ground: bursts for
         * the petal simulation, which lifts whatever lies there (each lives a fifth of a second).
         */
        this.kicks = [];
        /** How far their eyes are shut (one number for the pair would blink them together). */
        this.uEyes = [uniform(0), uniform(0)];
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    /**
     * The coat's colour `height` of the way from the skin (0) to the tips of the fur (1), for the
     * fox whose eyes `eyes` are.
     */
    coat(source, height, eyes) {
        const { light } = this;
        const world = positionWorld.toVar();
        const normal = normalize(normalWorld).toVar();
        const view = normalize(cameraPosition.sub(world)).toVar();
        const paint = varying(attribute('color', 'vec4'), 'sakuraFoxCoat');
        const base = varying(positionGeometry, 'sakuraFoxBase');
        const sees = clamp(paint.w, 0.0, 1.0);
        const brush = clamp(paint.x, 0.0, 1.0);
        // Its own colours: rust, white and the dark of its legs — taken a little off their
        // brightest, as a coat in moonlight is.
        const dyed = source?.map ? texture(source.map, uv()).rgb : vec3(0.6, 0.2, 0.05);
        const grey = dot(dyed, vec3(0.3, 0.55, 0.15));
        const fur = mix(vec3(grey), dyed, 0.8).mul(0.8);
        // Its eyes, drawn where a fox's are — on its brow, where the top of its face turns
        // into its cheek — and as a fox's are: one dark almond each, slanted, its outer corner
        // higher and further back. Its lid shuts it to a line along that slant.
        const fromEye = vec3(base.x.abs().sub(EYE[0]), base.y.sub(EYE[1]), base.z.sub(EYE[2]));
        const along = dot(fromEye, vec3(EYE_SLANT[0], EYE_SLANT[1], EYE_SLANT[2]));
        const across = max(dot(fromEye, fromEye).sub(along.mul(along)), 0.0).sqrt();
        const almond = float(1.0).sub(smoothstep(0.0105, 0.013, length(vec2(along.mul(0.7), across.mul(1.5)))));
        const open = float(1.0).sub(smoothstep(0.0012, 0.0035, across).mul(eyes));
        const eye = almond.mul(open);
        // (No fur grows over it or close round it.)
        const socket = float(1.0).sub(smoothstep(0.016, 0.024, length(fromEye)));
        const albedo = mix(fur, vec3(0.012, 0.01, 0.012), eye);
        // Deep in the coat it is dark; the tips stand in the light.
        const depth = mix(float(0.46), float(1.0), smoothstep(0.0, 0.8, height));
        // The moon wraps far round fur, and reaches it only where the trees let it.
        const wrapped = max(dot(normal, light.uMoonDir).add(0.5).div(1.5), 0.0);
        const moon = light.uMoonColor.mul(wrapped).mul(light.moonlight());
        // The sky and the ground light it too, less where its own body is in the way.
        const ambient = light.ambient(normal).mul(mix(float(0.3), float(1.0), sees));
        // The lanterns it sits beside warm the side turned to them.
        const lamp = varying(light.lamps(positionWorld), 'sakuraFoxLamp').mul(mix(float(0.5), float(1.0), sees));
        const lit = albedo.mul(moon.mul(0.95).add(ambient.mul(1.15)).add(lamp.mul(0.95))).mul(depth);
        // A fox between the eye and the moon is drawn round with a silver edge, and the tips of
        // its coat glow.
        const edge = float(1.0).sub(clamp(dot(normal, view), 0.0, 1.0));
        const behind = clamp(dot(view, light.uMoonDir).negate().mul(0.6).add(0.55), 0.0, 1.0);
        const silver = light.uMoonColor.mul(behind).mul(light.moonlight().mul(0.8).add(0.2))
            .mul(edge.mul(edge).mul(0.5).add(height.mul(height).mul(0.32)))
            .mul(float(1.0).sub(eye))
            .mul(mix(fur, vec3(1.0), 0.45))
            .mul(brush.mul(0.6).add(1.0));
        // Its eyes are wet: a point of the moon stands in each.
        const spot = float(1.0).sub(smoothstep(0.0012, 0.003, length(fromEye.sub(vec3(0.0, 0.0035, 0.004)))));
        const glint = light.uMoonColor.add(lamp.mul(0.3)).mul(spot).mul(eye).mul(0.9);
        return {
            colour: light.haze(lit.add(silver).add(glint), { world }), eye, socket, paint, base,
        };
    }

    /** The skin and (when the tier has shells) the fur over it, for the fox whose eyes `eyes` are. */
    createMaterials(source, eyes) {
        const { light, shells } = this;
        const skin = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        skin.name = 'SakuraFoxSkin';
        // (Without shells the skin is the coat: it is lit as the coat's surface, not its depths.)
        skin.colorNode = Fn(() => vec4(this.coat(source, float(shells > 0 ? 0.0 : 0.7), eyes).colour, 1.0))();
        if (!(shells > 0)) return { skin, fur: null };

        // Each shell is a veil: as thick as the share of the hairs that grow that long. Drawn
        // inner to outer in one call, front faces only, premultiplied "over".
        const fur = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
        }));
        fur.name = 'SakuraFoxFur';
        fur.blending = THREE.CustomBlending;
        fur.blendSrc = THREE.OneFactor;
        fur.blendDst = THREE.OneMinusSrcAlphaFactor;
        fur.blendSrcAlpha = THREE.OneFactor;
        fur.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        fur.forceSinglePass = true;
        // (Shell i of n stands (i + 1) / (n + 1) of the way out.)
        const shell = float(instanceIndex).add(1.0).div(shells + 1);
        fur.positionNode = Fn(() => {
            const reach = attribute('color', 'vec4').y.mul(2.0 * FUR_LENGTH).mul(shell);
            // A hair leaves the skin along its normal and is combed back and down as it grows.
            const grow = normalize(normalLocal.add(vec3(0.0, -0.3, -0.6).mul(shell)));
            const droop = vec3(0.0, -1.0, 0.0).mul(reach.mul(shell).mul(0.3));
            // The wind is in it: the tips lean with it and with the gusts, whichever way it stands.
            const wind = modelWorldMatrixInverse.mul(vec4(light.uWindDir, 0.0)).xyz
                .mul(light.uWind.add(light.uGust.mul(1.6)).mul(0.5))
                .mul(reach.mul(shell));
            return positionLocal.add(grow.mul(reach)).add(droop).add(wind);
        })();
        const vShell = varying(shell, 'sakuraFoxShell');
        fur.colorNode = Fn(() => {
            const height = clamp(vShell, 0.0, 1.0);
            const coat = this.coat(source, height, eyes);
            const vBase = coat.base;
            // Hairs lie along the body: a fine grain, stretched nose to tail, says how long they
            // are at each spot. (It is the garden's noise texture, so from the game's distance its
            // mip levels hand back the hairs' average instead of their sparkle.)
            const grain = light.noise(vec2(
                vBase.x.add(vBase.y.mul(0.83)),
                vBase.z.mul(0.4).add(vBase.y.mul(0.31)),
            ).mul(FUR_GRAIN));
            const tall = clamp(grain.a.sub(0.5).mul(2.4).add(0.5), 0.0, 1.0);
            const strand = smoothstep(height.sub(0.3), height.add(0.12), tall.mul(1.05));
            const thick = float(1.0).sub(height).pow(1.5).mul(strand.mul(0.75).add(0.25));
            const long = clamp(coat.paint.y.mul(2.0), 0.0, 2.0);
            // (No fur grows on its eyes.)
            const a = float(1.0).sub(thick.mul(-FUR_DENSITY / shells).exp())
                .mul(smoothstep(0.03, 0.2, long))
                .mul(float(1.0).sub(coat.socket));
            const tone = grain.b.mul(0.36).add(0.82);
            return vec4(coat.colour.mul(tone).mul(a), a);
        })();
        return { skin, fur };
    }

    /** A soft dark patch under each fox: the static shadow map cannot follow them. */
    createShadeMaterial() {
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false,
        }));
        material.name = 'SakuraFoxShade';
        material.colorNode = vec3(0.004, 0.004, 0.012);
        material.opacityNode = smoothstep(0, 1, clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0.0, 1.0)).mul(0.5);
        return material;
    }

    build() {
        if (!this.fox?.scene) return this;
        const shadeGeometry = this.own(new THREE.PlaneGeometry(1, 1));
        shadeGeometry.rotateX(-Math.PI / 2);
        const shadeMaterial = this.createShadeMaterial();
        let coats = null;
        let warned = false;
        SAKURA_FOX_PAIR.forEach((plan, index) => {
            const model = SkeletonUtils.clone(this.fox.scene);
            model.name = `SakuraFoxModel ${index}`;
            const skins = [];
            model.traverse((child) => {
                if (child.isSkinnedMesh) skins.push(child);
            });
            const source = skins[0] ? [].concat(skins[0].material)[0] : null;
            const materials = this.createMaterials(source, this.uEyes[index]);
            skins.forEach((skin) => {
                Object.assign(skin, {
                    material: materials.skin, castShadow: false, receiveShadow: false, frustumCulled: false,
                });
                if (!materials.fur) return;
                // (Both foxes are the same mesh: one geometry of shells does for the pair.)
                if (!coats) coats = this.own(shelled(skin.geometry, this.shells));
                const fur = new THREE.SkinnedMesh(coats, materials.fur);
                fur.name = `SakuraFoxFur ${index}`;
                fur.position.copy(skin.position);
                fur.quaternion.copy(skin.quaternion);
                fur.scale.copy(skin.scale);
                fur.bind(skin.skeleton, skin.bindMatrix);
                fur.frustumCulled = false;
                fur.renderOrder = 3;
                skin.parent.add(fur);
            });
            const bones = SAKURA_FOX_BONES.map(([name]) => model.getObjectByName(name));
            const rigged = bones.every((bone) => bone?.isBone);
            if (!rigged && !warned) {
                warned = true;
                console.warn('[Sakura] the fox model is not on the theme\'s skeleton (scripts/sakura/rig-fox.mjs).');
            }
            // pivot (its place and heading on the path, its size) → model (its body, solved)
            const pivot = new THREE.Group();
            pivot.name = `SakuraFox ${index}`;
            pivot.scale.setScalar(plan.scale);
            pivot.add(model);
            const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
            shade.name = `SakuraFoxShade ${index}`;
            shade.renderOrder = 2;
            this.group.add(pivot, shade);
            const rig = createSakuraFoxRig(plan.scale);
            this.foxes.push({
                model: pivot,
                body: model,
                bones,
                rigged,
                rig,
                spec: rig.createSpec(),
                posture: rig.createPosture(),
                shade,
                plan,
                mind: this.mind.foxes[index],
            });
        });
        this.place();
        return this;
    }

    /** Where the viewer stands (the camera, on the ground): the foxes turn to face it. */
    setViewer(x, z) {
        this.mind.setViewer(x, z);
    }

    /** Put each fox where its mind has it, in the pose its mind has it in. */
    place() {
        this.foxes.forEach((fox, index) => {
            const { pose } = fox.mind;
            fox.model.position.set(pose.x, pose.y + pose.lift - 0.012, pose.z);
            fox.model.rotation.set(0, pose.heading, 0);
            if (fox.rigged) {
                fox.rig.solve(fox.rig.spec(pose, fox.spec), fox.posture);
                for (let i = 0; i < fox.bones.length; i++) fox.bones[i].quaternion.fromArray(fox.posture.local[i]);
                fox.bones[0].position.fromArray(fox.posture.at[0]);
            }
            this.uEyes[index].value = pose.eyes;
            // Its shade lies under its body: longer along it than across, fainter as it leaps.
            const low = pose.clip === 'CurlSleep' ? 0.8 : 1;
            fox.shade.position.set(pose.x, pose.y + 0.03, pose.z);
            fox.shade.rotation.y = pose.heading;
            fox.shade.scale.set(0.55 * fox.plan.scale * low, 1, 1.25 * fox.plan.scale * low);
            fox.shade.visible = pose.lift < 0.9;
        });
    }

    update(dt, frame = {}) {
        if (!this.foxes.length || !Number.isFinite(dt) || dt <= 0) return;
        const { mind, signals } = this;
        this.time += dt;
        const { time } = this;
        const read = (value) => (Number.isFinite(value) ? value : 0);
        const gust = read(frame.gust);
        const hush = read(frame.hush);
        const moon = read(frame.moon);
        const lanterns = read(frame.lanterns);
        // The wind dies and the lanterns burn low: they sleep; when it stirs again they wake.
        if (hush > 0.5 && !mind.asleep) mind.sleep(time);
        else if (hush < 0.2 && mind.asleep) mind.wake(time);
        if (!mind.asleep) {
            // A hard gust startles them once; they settle before it can happen again.
            this.startled = Math.max(0, this.startled - dt);
            if (gust > 0.6 && this.startled === 0) {
                this.startled = 5;
                mind.startle(1);
            }
            // Four lines flare the moon: they leap for it.
            if (moon > 0.85 && signals.moon <= 0.85) mind.pounce(time);
            // A piece locks and the lanterns breathe: they look up from what they are doing,
            // out over the water where the ring runs.
            if (lanterns > signals.lanterns + 0.12) mind.attend(0, 2.5, -6, time + 1.1, 0.8);
        }
        signals.moon = moon;
        signals.lanterns = lanterns;
        // The stream of petals a chain winds up sets them running.
        mind.step(dt, time, { power: read(frame.heat) * 0.9, surge: 0 });
        // What a fox does to the petals lying where it is.
        this.kicks = this.kicks.filter((kick) => {
            kick.age += dt;
            return kick.age < 0.2;
        });
        this.foxes.forEach((fox) => {
            fox.mind.events.forEach((event) => {
                const force = KICKS[event.type === 'land' && !event.soft ? 'leap' : event.type];
                if (!force) return;
                const { pose } = fox.mind;
                this.kicks.push({
                    kind: 'burst', x: pose.x, y: pose.y - 0.25, z: pose.z, age: 0, ...force,
                });
            });
        });
        this.place();
    }

    /** Back to the opening pose (the playground replays time from zero). */
    reset() {
        this.time = 0;
        this.startled = 0;
        this.signals.moon = 0;
        this.signals.lanterns = 0;
        this.kicks.length = 0;
        this.mind.reset(0);
        this.place();
    }

    dispose() {
        this.foxes.forEach((fox) => {
            fox.body.traverse((child) => {
                if (child.isSkinnedMesh) child.skeleton?.dispose();
            });
        });
        this.foxes.length = 0;
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
