/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE WHALE PASS — a humpback mother and calf circling over the Act I ascent.
 *
 * The camera climbs the water column looking UP toward the bright surface, so a whale crossing
 * overhead is a SILHOUETTE against the light — the most iconic image underwater (an underwater game, the
 * Big Blue).
 *
 * THE ANIMALS (2026-11-03): `humpback-swim.glb`, built, rigged and keyed in Blender
 * (scripts/blender/odyssey/odyssey_whales.py): a humpback with its long white flippers and wide
 * notched flukes, a 13-bone rig and a keyed stroke (a wave of heave running back to the flukes).
 * It replaced `whale-glide.glb`, a photo-to-3D mesh whose auto-rig was backwards (its swim nodded
 * the head and left the flukes still). On top of the keyed stroke the game sets the beat by the
 * pace, the calf's faster than its mother's, bends the body into its turns and rolls the flippers
 * with them (odyssey-whale-swim.js). docs/ODYSSEY_SEA_MOTION_2026-11.md.
 *
 * WHY A COMPOSITION ELEMENT, not world content: ADR-0017 lets the world's underwater span grow
 * content but not chapter-shaped special cases, and a two-actor hero beat with its own
 * choreography is exactly that — so it lives beside the steam quench, which is the same kind of
 * thing (a one-off moment staged on the rail), and the world renderer stays untouched.
 *
 * ZERO-HITCH CONTRACT (ADR-0020 / item 2.11): nothing here touches the GPU until the board says
 * so. `load()` only fetches + parses; the board compiles the group through its live-loop path
 * (`_compileGroupThroughPost(group, { live: true })`) and only then calls `markReady()`. Until
 * ready the group stays hidden, so no live frame can ever create one of its pipelines
 * synchronously. A load or compile failure leaves the ocean exactly as it was.
 *
 * The look was proven first in the playground bench `?effect=ocean-whale-pass`.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, clamp, dot, float, length, max, mix, normalView, normalWorld, normalize,
    oneMinus, positionWorld, pow, smoothstep, uniform, vec3,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import { getChapter2CreatureAssetById } from '../chapter-environments/shared/chapter-02-creature-assets.js';
import { odysseyDeepWaterDim } from '../odyssey-colour-script.js';
import { behindSteamDepth, steamVeilWeight } from './odyssey-steam-quench.js';
import {
    OCEAN_ROAM, roamAt, roamHeading, roamLane, softLimit, stepRoamArrival,
} from './odyssey-ocean-roam.js';
import { oceanLifeDrawn } from './odyssey-through-surface.js';
import {
    WHALE_BEND_BONES, WHALE_FLIPPER_BONES, WHALE_SWIM, whaleBend, whaleClipRate,
} from './odyssey-whale-swim.js';

/** The pair's asset (chapter-02-creature-assets.js). */
export const WHALE_PASS_ASSET_ID = 'humpback-swim';

/**
 * Whale length in world units (the GLB is scaled to this by its largest bound).
 *
 * THE SIZE AS SEEN, kept (2026-11-03). These read 58 and 26 until the humpback came, but the old
 * photo-to-3D GLB drew at HALF that: its positions were quantized to [-1, 1] and the dequantizing
 * half went into its skin's inverse bind matrices, so its bind-pose bounds were twice what was
 * drawn (measured: geometry box 2.0 long, skinned 1.008). What the journey has shown since
 * 2026-10-22 is a ~29 u mother and a ~13 u calf, and that is the size kept here. The routes' eye
 * clearances (tests/unit/odyssey-ch2-roam.test.js) were set for 58 / 26, so they hold with room.
 */
export const MOTHER_LENGTH = 29;
export const CALF_LENGTH = 13;
/**
 * THE PAIR ROAMS (2026-10-24; see odyssey-ocean-roam.js). It owned one stretch of the climb (orb 9,
 * 2026-10-22), then escorted the eye from a slot in the journey's view (2026-10-23), and Olov did
 * not want it following the camera. Now the mother swims her own route in the world
 * (OCEAN_ROAM.whales, high on the right of the climb's view), and the calf keeps an inner lane
 * beside her, just above and a little ahead, on the same clock.
 */
export const WHALE_PASS_PAIR = Object.freeze({
    calf: Object.freeze({
        inward: 12, shorter: 8, above: 5, lead: 0.35,
    }),
});

/**
 * Model-space bounds from the BIND-POSE geometry bounds. `Box3.setFromObject` on a skinned mesh
 * runs SkinnedMesh.computeBoundingBox, which applies every bone to every vertex on the CPU —
 * ~35 ms per whale, twice, on the main thread right after the reveal (pre-merge review). The
 * geometry's own box is a cheap linear pass, computed once and shared by every cached clone, and
 * the glide pose is close enough to the bind pose for a size normalisation.
 */
function bindPoseBounds(model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    model.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box;
}

/**
 * The back-lit silhouette, in the medium: dark back, a soft belly lit by scattered light from
 * below, the surface light wrapping the edge (fresnel, strongest on faces toward the surface),
 * and colour-with-distance toward the water colour so the whales sit IN the sea.
 *
 * OPAQUE since the seamless pass. It was a transparent material (blend state, the transparent
 * queue, a read-modify-write of the HDR target on every whale fragment) whose only use of alpha
 * was the depth-window fade — and a dark silhouette fading over the water it swims in is exactly
 * a silhouette dissolving INTO the water colour. So the fade now rides the same haze the
 * distance already uses (fade 0 = pure water colour, and the group is hidden there), which keeps
 * the pair in the opaque queue: early-Z, no blend, no sort.
 */
function createWhaleMaterial(uWater, uFade) {
    const material = new THREE.MeshBasicNodeMaterial();
    const nW = normalize(normalWorld);
    const belly = clamp(nW.y.negate(), 0.0, 1.0);
    const towardSurface = clamp(nW.y, 0.0, 1.0);
    // Clamped: a dot of unit vectors can round past 1, and pow of a negative base is NaN, which
    // bloom spreads into a black block (as the water surface's caustics, odyssey-water-surface.tsl.js).
    const fres = pow(clamp(oneMinus(abs(dot(normalize(normalView), vec3(0, 0, 1)))), 0.0, 1.0), 2.5);
    // The humpback's own marks, baked per vertex in Blender (COLOR_0): r the fins' white (the long
    // flippers, the flukes' underside), g the belly's, b how open the skin is to the light (ao).
    // The belly keeps only a hint of its white: from below the pair stays a silhouette.
    const marks = attribute('color', 'vec4');
    const white = clamp(marks.x.mul(0.85).add(marks.y.mul(0.22)), 0.0, 1.0);
    const open = mix(float(0.72), float(1.0), clamp(marks.z, 0.0, 1.0));
    let body = mix(vec3(0.016, 0.042, 0.064), vec3(0.085, 0.17, 0.22), pow(belly, 1.4).mul(0.85));
    // White skin seen through the water: pale teal, brighter where it turns to the light below.
    body = mix(body, vec3(0.22, 0.36, 0.42).mul(belly.mul(0.35).add(0.65)), white).mul(open);
    body = body.add(vec3(0.50, 0.80, 0.90).mul(fres).mul(towardSurface.mul(0.6).add(0.25)).mul(0.5));
    const dist = length(positionWorld.sub(cameraPosition));
    const haze = smoothstep(30.0, 360.0, dist).mul(0.88);
    material.colorNode = mix(body, uWater, max(haze, oneMinus(uFade)));
    // Behind the 1->2 steam while it is up: it arrives there, never through it.
    material.depthNode = behindSteamDepth(positionWorld);
    material.depthWrite = true;
    // One closed skin wound outward (the Blender build checks it), so its back faces never show.
    material.side = THREE.FrontSide;
    // It carries its own colour-with-distance; scene fog is the chapter-profile lerp and would
    // paint it in whatever the seam happens to be doing (the repo's four-times-paid fog trap).
    material.fog = false;
    return material;
}

/**
 * @param {object} opts
 * @param {number} opts.seaLevel world Y of the sea surface
 * @param {THREE.Color} opts.shallowColour water colour near the surface
 * @param {THREE.Color} opts.deepColour water colour in the abyss
 */
export function createWhalePass({
    seaLevel, shallowColour, deepColour,
}) {
    const group = new THREE.Group();
    group.name = 'odyssey-whale-pass';
    group.visible = false;
    const uWater = uniform(new THREE.Color().copy(shallowColour));
    const uFade = uniform(0);
    const material = createWhaleMaterial(uWater, uFade);
    const actors = [];
    let ready = false;
    let loaded = false;
    // The pair's arrival (one, the mother's): it fades in from the blue once the water allows it.
    let arrival = {};
    const scratchColour = new THREE.Color();
    const position = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const heading = new THREE.Vector3();
    const motherRoute = OCEAN_ROAM.whales;
    const calfRoute = roamLane(motherRoute, WHALE_PASS_PAIR.calf);
    const scratchQ = new THREE.Quaternion();
    const restQ = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    const FORWARD = new THREE.Vector3(0, 0, -1);

    /** A bone of the rig with the model's up (and forward) axis in its own frame at rest. */
    function boneRef(model, name) {
        const bone = model.getObjectByName(name);
        if (!bone) return null;
        bone.getWorldQuaternion(restQ);
        const inv = restQ.clone().invert();
        return {
            bone,
            up: UP.clone().applyQuaternion(inv).normalize(),
            forward: FORWARD.clone().applyQuaternion(inv).normalize(),
        };
    }

    /** The turn on top of the keyed stroke: a C through the spine, the flippers rolled with it. */
    function bendInto(actor, speed) {
        const b = whaleBend(actor.turn, speed, actor.length);
        for (let i = 0; i < actor.bend.length; i += 1) {
            const ref = actor.bend[i];
            ref.bone.quaternion.multiply(scratchQ.setFromAxisAngle(ref.up, b * ref.share));
        }
        const roll = b * WHALE_SWIM.flipperRoll;
        for (let i = 0; i < actor.flippers.length; i += 1) {
            const ref = actor.flippers[i];
            ref.bone.quaternion.multiply(scratchQ.setFromAxisAngle(ref.forward, roll));
        }
    }

    async function addActor(url, bodyLength, phase, path, who) {
        const { scene: model, animations } = await loadOdysseyGltfCached(url);
        const size = bindPoseBounds(model).getSize(new THREE.Vector3());
        model.scale.setScalar(bodyLength / Math.max(size.x, size.y, size.z, 1e-3));
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.material = material;
            // A skinned mesh's bind-pose bounds do not follow the swim; the pair is large and
            // always near the view, so culling would only ever drop a fluke at the edge.
            o.frustumCulled = false;
        });
        const holder = new THREE.Group();
        holder.add(model);
        group.add(holder);
        model.updateMatrixWorld(true);
        const bend = WHALE_BEND_BONES.map((b) => {
            const ref = boneRef(model, b.name);
            return ref ? { ...ref, share: b.share * b.dir } : null;
        }).filter(Boolean);
        const flippers = WHALE_FLIPPER_BONES.map((n) => boneRef(model, n)).filter(Boolean);
        const mixer = animations[0] ? new THREE.AnimationMixer(model) : null;
        if (mixer) {
            const action = mixer.clipAction(animations[0]);
            action.play();
            // Desync the pair's stroke so they do not swim in lockstep.
            action.time = phase * (animations[0].duration || 1);
        }
        actors.push({
            holder, mixer, phase, path, who, length: bodyLength, bend, flippers, yaw: null, turn: 0,
        });
    }

    return {
        group,
        /** Fetch + parse only; no GPU work. Resolves true when both actors are in the group. */
        async load() {
            if (loaded) return true;
            const rec = getChapter2CreatureAssetById(WHALE_PASS_ASSET_ID);
            if (!rec?.url) return false;
            await addActor(rec.url, MOTHER_LENGTH, 0, motherRoute, 'mother');
            await addActor(rec.url, CALF_LENGTH, 0.37, calfRoute, 'calf');
            loaded = true;
            return true;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /**
         * @param {number} time seconds
         * @param {number} delta seconds
         * @param {THREE.Camera} camera
         * @param {number} submerged 0..1 (the world's underwater blend; kept for the board's
         *   call, the eye's own height decides since 2026-10-31)
         * @param {boolean} inChapter whether the camera is inside the ocean chapter's span
         * @param {number} [presence] 0..1 ocean-life presence from the world's 1->2 carry
         *   (`oneWorld.state.lifePresence`): the pair arrives with the fish as the quench thins,
         *   never inside Earth Core's cavern. Defaults to 1 (no carry wired = today's behaviour).
         */
        update(time, delta, camera, submerged, inChapter, presence = 1) {
            const camY = camera?.position?.y ?? seaLevel;
            const depth = seaLevel - camY;
            const life = Number.isFinite(presence) ? Math.min(Math.max(presence, 0), 1) : 1;
            const dt = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 0.1);
            // Drawn while the eye is in the water (no longer from ~5 u under it: that switched
            // animals off in front of the eye). The pair is never in frame from above the surface
            // (it keeps to the deep, behind the breach), so unlike the visitors it stays opaque and
            // is not drawn through the surface (odyssey-through-surface.js).
            const on = oceanLifeDrawn({
                ready, inChapter, life, eyeY: camY, seaLevel,
            });
            if (!on) {
                // Out of the water (or the chapter): the pair arrives afresh next time.
                arrival = {};
                group.visible = false;
                return;
            }

            // Water colour at the camera's depth: shallow near the surface, abyss far below.
            const t = THREE.MathUtils.clamp((depth - 20) / 220, 0, 1);
            // ...dimmed by the same depth rule as the world's water (the deep is dark), so the
            // pair dissolves into the water actually around it.
            uWater.value.copy(scratchColour.copy(shallowColour).lerp(deepColour, t))
                .multiplyScalar(odysseyDeepWaterDim(depth / 140));

            // Under a thick veil of the 1->2 steam the pair is already here when it clears.
            if (steamVeilWeight() > 0.3) arrival.arrive = 1;
            const fade = stepRoamArrival(arrival, dt);
            for (let i = 0; i < actors.length; i += 1) {
                const actor = actors[i];
                // Each on its own route (the clock's, never the camera's); the calf's beside hers.
                roamAt(actor.path, time, position, velocity);
                actor.holder.position.copy(position);
                const speed = velocity.length();
                // The stroke, quicker as it swims faster (the calf's quicker than hers); the mixer
                // integrates the rate, so a change of pace never jumps it.
                if (actor.mixer) actor.mixer.update(dt * whaleClipRate(speed, actor.path.speed, actor.who));
                // Heading from its velocity, mostly level. The GLB leads with -Z, so yaw so that
                // -Z points along it.
                roamHeading(velocity, heading, { x: 0, y: 0, z: 1 });
                const yaw = Math.atan2(-heading.x, -heading.z);
                if (actor.yaw !== null && dt > 0) {
                    const d = Math.atan2(Math.sin(yaw - actor.yaw), Math.cos(yaw - actor.yaw));
                    actor.turn += ((d / dt) - actor.turn) * (1 - Math.exp(-dt * 2));
                }
                actor.yaw = yaw;
                // It banks a little INTO its turn (the inside flank down; until 2026-11-03 the
                // sign leaned it out), and bends into it.
                actor.holder.rotation.set(0, yaw, softLimit(actor.turn * 0.9, 0.3));
                bendInto(actor, speed);
            }
            uFade.value = fade * life;
            group.visible = uFade.value > 0.01;
        },
        dispose() {
            actors.forEach((a) => a.mixer?.stopAllAction());
            material.dispose();
            // Geometry is shared with the glTF cache (fromSharedGltfCache) — never disposed here.
            group.removeFromParent();
        },
    };
}
