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
import { stepVisitorPassage } from './odyssey-ocean-visitors.js';

/** Whale length in world units (the GLB is auto-scaled to this by its largest bound). */
const MOTHER_LENGTH = 58;
const CALF_LENGTH = 26;
/**
 * THE PAIR'S STRETCH (2026-10-22, one encounter per stretch; see odyssey-ocean-visitors.js). The
 * pair used to circle the rail itself at 32 u, 42 u under the surface, on show for the whole climb
 * (eye 97-273), so at orb 9 it swam 38 u over the eye, overflowing the frame, among the whale
 * shark and the manta, and from orb 10 (eye 272, looking ahead along the surface) it was behind
 * the eye. It now owns orb 9 (the eye parks at y ~207): a loop centred on the rail just past it
 * (the board puts `at` of chapter 2's span there), the mother 13 u under the surface on a 28 u lane
 * and the calf on an inner lane above her, scored on the real camera: the mother in frame for
 * ~85 % of a lap at ~0.7 of the frame and never over the orb. It arrives and leaves by swimming
 * with the eye's height (stepVisitorPassage): from 190 (after the whale shark has gone) until the
 * eye heads for orb 10, where the manta waits.
 */
export const WHALE_PASS_STAGE = Object.freeze({
    at: 0.62,
    window: Object.freeze([190, 250]),
    mother: Object.freeze({ radius: 28, depth: 13 }),
    calf: Object.freeze({ radius: 20, depth: 8 }),
});
const ORBIT_PERIOD_S = 92;

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
    const fres = pow(oneMinus(abs(dot(normalize(normalView), vec3(0, 0, 1)))), 2.5);
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
 * @param {{x:number, z:number}} opts.axis world XZ of the pair's loop centre (the board: the rail at
 *   WHALE_PASS_STAGE.at of chapter 2's span)
 * @param {number} opts.seaLevel world Y of the sea surface
 * @param {THREE.Color} opts.shallowColour water colour near the surface
 * @param {THREE.Color} opts.deepColour water colour in the abyss
 */
export function createWhalePass({
    axis, seaLevel, shallowColour, deepColour,
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
    // The pair's passage: in from the blue when the eye reaches its stretch, away when it leaves.
    const passageState = {};
    const scratchColour = new THREE.Color();

    async function addActor(url, bodyLength, phase, radius, depth) {
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
            holder, mixer, phase, radius, depth,
        });
    }

    return {
        group,
        /** Fetch + parse only; no GPU work. Resolves true when both actors are in the group. */
        async load() {
            if (loaded) return true;
            const rec = getChapter2CreatureAssetById('whale-glide');
            if (!rec?.url) return false;
            await addActor(rec.url, MOTHER_LENGTH, 0, WHALE_PASS_STAGE.mother.radius, WHALE_PASS_STAGE.mother.depth);
            await addActor(rec.url, CALF_LENGTH, 0.37, WHALE_PASS_STAGE.calf.radius, WHALE_PASS_STAGE.calf.depth);
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
         */
        update(time, delta, camera, submerged, inChapter, presence = 1) {
            const camY = camera?.position?.y ?? seaLevel;
            const depth = seaLevel - camY;
            const life = Number.isFinite(presence) ? Math.min(Math.max(presence, 0), 1) : 1;
            const on = ready && inChapter && submerged > 0.5 && life > 0.001;
            const passage = stepVisitorPassage(passageState, {
                camY, on, dt: Math.max(0, delta || 0), window: WHALE_PASS_STAGE.window,
            });
            uFade.value = passage.shown ? passage.alpha * life : 0;
            group.visible = passage.shown && uFade.value > 0.01;
            if (!group.visible) return;

            // Water colour at the camera's depth: shallow near the surface, abyss far below.
            const t = THREE.MathUtils.clamp((depth - 20) / 220, 0, 1);
            // ...dimmed by the same depth rule as the world's water (the deep is dark), so the
            // pair dissolves into the water actually around it.
            uWater.value.copy(scratchColour.copy(shallowColour).lerp(deepColour, t))
                .multiplyScalar(odysseyDeepWaterDim(depth / 140));

            const omega = (Math.PI * 2) / ORBIT_PERIOD_S;
            actors.forEach((actor) => {
                if (actor.mixer) actor.mixer.update(Math.max(0, delta) * 0.8);
                // Calf slightly ahead on an inner lane; both bob and bank gently into the turn.
                const a = (time * omega) + (actor.phase * 0.9);
                // Arriving or leaving: farther out along the same bearing (and, leaving past the
                // eye, down under it).
                const radius = actor.radius + passage.radial;
                const x = axis.x + Math.cos(a) * radius;
                const z = axis.z + Math.sin(a) * radius;
                const y = seaLevel - actor.depth + (Math.sin((time * 0.27) + (actor.phase * 5)) * 3.5) + passage.up;
                actor.holder.position.set(x, y, z);
                // Heading along the orbit tangent (counter-clockwise). The GLB leads with -Z
                // (see deep-ocean-manta.js _whaleBaseFwd), so yaw so that -Z points along the
                // tangent (-sin a, 0, cos a).
                actor.holder.rotation.set(0, Math.atan2(Math.sin(a), -Math.cos(a)), -0.12);
            });
        },
        dispose() {
            actors.forEach((a) => a.mixer?.stopAllAction());
            material.dispose();
            // Geometry is shared with the glTF cache (fromSharedGltfCache) — never disposed here.
            group.removeFromParent();
        },
    };
}
