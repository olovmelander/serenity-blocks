/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE WHALE PASS — a mother and calf circling over the Act I ascent.
 *
 * The camera climbs the water column looking UP toward the bright surface, so a whale crossing
 * overhead is a SILHOUETTE against the light — the most iconic image underwater (ABZÛ, the
 * Big Blue). The project already owned the asset (`whale-glide.glb`, the photo→3D→rig pipeline
 * in assets/chapter-02/creatures/), but only the suppressed Deep Ocean diorama ever used it, so
 * on the default One World path the ocean had fish and nothing that made you look up.
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
    abs, cameraPosition, clamp, dot, length, max, mix, normalView, normalWorld, normalize, oneMinus,
    positionWorld, pow, smoothstep, uniform, vec3,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import { getChapter2CreatureAssetById } from '../chapter-environments/shared/chapter-02-creature-assets.js';
import { odysseyDeepWaterDim } from '../odyssey-colour-script.js';
import { placeEscorted } from './odyssey-ocean-visitors.js';
import { OCEAN_ESCORT, escortHeading } from './odyssey-ocean-escort.js';

/** Whale length in world units (the GLB is auto-scaled to this by its largest bound). */
const MOTHER_LENGTH = 58;
const CALF_LENGTH = 26;
/**
 * THE PAIR ESCORTS THE EYE (2026-10-23; see odyssey-ocean-escort.js). It owned one stretch of the
 * climb (orb 9, 2026-10-22) and was in frame for ~4 s of the journey's own drift up the ocean. Now
 * it keeps the eye company through the whole chapter: the mother swims loops round her escort
 * anchor (OCEAN_ESCORT.whales, the right of the view), and the calf keeps an inner lane just above
 * her, a little ahead.
 */
export const WHALE_PASS_PAIR = Object.freeze({
    calf: Object.freeze({ radius: 13, phaseLead: 0.5, above: 5 }),
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
 * the pair in the opaque queue: early-Z, no blend, no sort. Double-sided stays: the GLB is an
 * unindexed triangle soup authored doubleSided, and a culled hole in a 58 u hero would show.
 * (Its unused COLOR_0 is never uploaded: the node material reads no vertex colour, and WebGPU
 * only binds the attributes a pipeline uses — it is CPU memory in the shared glTF cache only.)
 */
function createWhaleMaterial(uWater, uFade) {
    const material = new THREE.MeshBasicNodeMaterial();
    const nW = normalize(normalWorld);
    const belly = clamp(nW.y.negate(), 0.0, 1.0);
    const towardSurface = clamp(nW.y, 0.0, 1.0);
    // Clamped: a dot of unit vectors can round past 1, and pow of a negative base is NaN, which
    // bloom spreads into a black block (as the water surface's caustics, odyssey-water-surface.tsl.js).
    const fres = pow(clamp(oneMinus(abs(dot(normalize(normalView), vec3(0, 0, 1)))), 0.0, 1.0), 2.5);
    let body = mix(vec3(0.016, 0.042, 0.064), vec3(0.085, 0.17, 0.22), pow(belly, 1.4).mul(0.85));
    body = body.add(vec3(0.50, 0.80, 0.90).mul(fres).mul(towardSurface.mul(0.6).add(0.25)).mul(0.5));
    const dist = length(positionWorld.sub(cameraPosition));
    const haze = smoothstep(30.0, 360.0, dist).mul(0.88);
    material.colorNode = mix(body, uWater, max(haze, oneMinus(uFade)));
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
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
    // The pair's escort: one anchor (the mother's), arriving from the blue the first time.
    let escortState = {};
    const scratchColour = new THREE.Color();
    const position = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const heading = new THREE.Vector3();
    const slot = OCEAN_ESCORT.whales;
    const calfLoop = Object.freeze({
        ...slot.loop,
        radius: WHALE_PASS_PAIR.calf.radius,
        phase: slot.loop.phase + WHALE_PASS_PAIR.calf.phaseLead,
    });

    async function addActor(url, bodyLength, phase, loop, above) {
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
        const mixer = animations[0] ? new THREE.AnimationMixer(model) : null;
        if (mixer) {
            const action = mixer.clipAction(animations[0]);
            action.play();
            // Desync the pair's stroke so they do not swim in lockstep.
            action.time = phase * (animations[0].duration || 1);
        }
        actors.push({
            holder, mixer, phase, loop, above, state: escortState, yaw: null, turn: 0,
        });
    }

    return {
        group,
        /** Fetch + parse only; no GPU work. Resolves true when both actors are in the group. */
        async load() {
            if (loaded) return true;
            const rec = getChapter2CreatureAssetById('whale-glide');
            if (!rec?.url) return false;
            await addActor(rec.url, MOTHER_LENGTH, 0, slot.loop, 0);
            await addActor(rec.url, CALF_LENGTH, 0.37, calfLoop, WHALE_PASS_PAIR.calf.above);
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
         * @param {number} submerged 0..1 (the world's underwater blend)
         * @param {boolean} inChapter whether the camera is inside the ocean chapter's span
         * @param {number} [presence] 0..1 ocean-life presence from the world's 1->2 carry
         *   (`oneWorld.state.lifePresence`): the pair arrives with the fish as the quench thins,
         *   never inside Earth Core's cavern. Defaults to 1 (no carry wired = today's behaviour).
         * @param {import('./odyssey-ocean-escort.js').EscortView|null} [view] the escort formation's
         *   view (the board: stepEscortFrame over the rail camera); none, nothing is drawn
         */
        update(time, delta, camera, submerged, inChapter, presence = 1, view = null) {
            const camY = camera?.position?.y ?? seaLevel;
            const depth = seaLevel - camY;
            const life = Number.isFinite(presence) ? Math.min(Math.max(presence, 0), 1) : 1;
            const dt = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 0.1);
            const on = ready && !!view && inChapter && submerged > 0.5 && life > 0.001;
            if (!on) {
                // Out of the water (or the chapter): the pair arrives afresh next time.
                escortState = {};
                group.visible = false;
                return;
            }

            // Water colour at the camera's depth: shallow near the surface, abyss far below.
            const t = THREE.MathUtils.clamp((depth - 20) / 220, 0, 1);
            // ...dimmed by the same depth rule as the world's water (the deep is dark), so the
            // pair dissolves into the water actually around it.
            uWater.value.copy(scratchColour.copy(shallowColour).lerp(deepColour, t))
                .multiplyScalar(odysseyDeepWaterDim(depth / 140));

            let fade = 0;
            actors.forEach((actor, i) => {
                if (actor.mixer) actor.mixer.update(dt * 0.8);
                // Both ride the one anchor: the mother's escort, stepped once (by the mother); the
                // calf only reads it, on its inner lane above her.
                const state = escortState;
                const arrived = i === 0
                    ? placeEscorted(state, view, slot, seaLevel, time, dt, position, velocity, actor.loop, actor.above)
                    : placeEscorted(state, view, slot, seaLevel, time, 0, position, velocity, actor.loop, actor.above);
                if (i === 0) fade = arrived;
                // A gentle bob of its own.
                position.y += Math.sin((time * 0.27) + (actor.phase * 5)) * 2.5;
                actor.holder.position.copy(position);
                // Heading from its velocity, mostly level. The GLB leads with -Z (see
                // deep-ocean-manta.js _whaleBaseFwd), so yaw so that -Z points along it.
                escortHeading(velocity, heading, { x: 0, y: 0, z: 1 });
                const yaw = Math.atan2(-heading.x, -heading.z);
                if (actor.yaw !== null && dt > 0) {
                    const d = Math.atan2(Math.sin(yaw - actor.yaw), Math.cos(yaw - actor.yaw));
                    actor.turn += ((d / dt) - actor.turn) * (1 - Math.exp(-dt * 2));
                }
                actor.yaw = yaw;
                // It banks a little into its turn.
                actor.holder.rotation.set(0, yaw, THREE.MathUtils.clamp(-actor.turn * 0.9, -0.3, 0.3));
            });
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
