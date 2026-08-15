/**
 * ACT II CLOUD DECK — the GRADED rig (cloud plan Wave 0).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `odyssey-world`. The existing world effect builds the real
 * world but grades it like a playground: `createOdysseyWorld({ quality, railSamples })` takes the
 * world's OWN defaults (applyExposure true, outputScale 1, outputSaturation 1) and renders
 * straight to the canvas with `NoToneMapping` and no post stack. The game does none of those
 * things — it hands the world a deliberately flatter, dimmer image budget and then puts manual
 * ACES, a master film stock and a per-chapter signature on top. Tuning a cloud colour against the
 * ungraded page is how the deck's palette was authored "soft grey" and shipped as "ragged NAVY
 * shards across Ch5's sky" (odyssey-world-renderer.js, the note above `cloudBase`, capture-
 * diagnosed 2026-08-12). The cloud plan's Wave 0 therefore requires a rig that cannot lie about
 * colour, and this is it: the REAL world, the REAL `OdysseyTslPipeline`, and the output contract
 * imported from `odyssey-world-grade.js` — the same module the board imports, so the two cannot
 * drift.
 *
 * It is deliberately a rig for the DECK, not a port target. Nothing is cloned out of the renderer
 * here; the deck material being iterated is the shipped one, so a screenshot from this page is a
 * screenshot of the code that will ship.
 *
 * URL PARAMS
 *   ?p=0.42            journey progress to park at (default: ch4 mid, the measured station)
 *   ?pitch=18          camera pitch in DEGREES, + is up (default: +18, framing the deck)
 *   ?yaw=0             camera yaw offset in degrees off the rail tangent
 *   ?post=0            bypass the post stack — the A/B that shows what the grade is doing
 *   ?chapter=4         override the grade's chapter signature (default: derived from p)
 *   ?worldOnly=clouds  substring mesh filter (the renderer's compile-bisect lever)
 *
 * ⚠️ `?t=` freezes update()'s dt (repo lesson, Vesper): with a fixed t the drift terms stop
 * advancing, so shimmer/crawl checks need two captures at DIFFERENT t, never one frozen frame.
 */

import * as THREE from 'three/webgpu';
import { createOdysseyWorld } from '../../rendering/odyssey/world/odyssey-world-renderer.js';
import {
    ONE_WORLD_APPLY_EXPOSURE,
    ONE_WORLD_OUTPUT_SCALE,
    ONE_WORLD_OUTPUT_SATURATION,
    ONE_WORLD_SKY_RADIUS,
} from '../../rendering/odyssey/world/odyssey-world-grade.js';
import { ODYSSEY_EYE_RAIL_OFFSET_Y } from '../../rendering/odyssey/world/odyssey-world-height.js';
import { OdysseyTslPipeline } from '../../rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathPointAt,
} from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'act2-cloud-deck',
    title: 'Act II — cloud deck (graded)',
    description: 'The real deck through the real ACES + master + chapter grade. Colour-truthful.',
};

const readNumber = (params, key, fallback) => {
    const raw = Number.parseFloat(params?.get?.(key));
    return Number.isFinite(raw) ? raw : fallback;
};

/** Which chapter's grade signature applies at progress `p` (1-indexed, as the pipeline wants). */
function chapterAt(p) {
    const cp = getActiveOdysseyChapterPositions();
    let ch = 1;
    for (let i = 1; i < cp.length; i += 1) if (p >= cp[i]) ch = i + 1;
    return ch;
}

export function create({
    scene, camera, renderer, params, sizes,
}) {
    // The clipmap reaches tens of thousands of units; the playground's default frustum clips the
    // sky dome away and the sky renders black at altitude. (Same numbers as `odyssey-world`.)
    if (camera) {
        camera.near = 1.0;
        camera.far = 30000;
        camera.updateProjectionMatrix();
    }

    const p = Math.min(0.999, Math.max(0, readNumber(params, 'p', 0.42)));
    const pitchDeg = readNumber(params, 'pitch', 18);
    const yawDeg = readNumber(params, 'yaw', 0);
    // Free-camera controls for ART REVIEW. The station framing answers "what does the player
    // see here"; these answer "is the sky any good", which needs distance and angle.
    //   ?dist=900    pull the camera BACK along its own view axis (0 = at the rail)
    //   ?height=250  raise/lower the camera without moving the aim point
    const backOff = readNumber(params, 'dist', 0);
    const lift = readNumber(params, 'height', 0);
    const postEnabled = params?.get?.('post') !== '0';
    const gradeChapter = Math.round(readNumber(params, 'chapter', chapterAt(p)));

    const railSamples = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    // THE GAME'S OPTIONS, from the shared contract module. Change them there, not here.
    const world = createOdysseyWorld({
        quality: params?.get?.('worldQuality') === 'low' ? 'low' : 'high',
        railSamples,
        applyExposure: ONE_WORLD_APPLY_EXPOSURE,
        outputScale: ONE_WORLD_OUTPUT_SCALE,
        outputSaturation: ONE_WORLD_OUTPUT_SATURATION,
        skyRadius: ONE_WORLD_SKY_RADIUS,
        // Opt-IN since the 2026-08-14 retirement, matching the board's polarity — a rig that
        // shows heroes by default previews a sky the game does not ship. `?heroes=1` restores
        // them here exactly as `?odysseyWorldHeroes=1` does in-game.
        heroes: params?.get?.('heroes') === '1',
        // Forest plan Wave 0b: `?forestPaint=1` swaps the incumbent facet-normal forest for
        // the blob-normal + banded-ramp probe. This rig is where that verdict has to be
        // taken — the flat playground page is how the cloud deck was authored "soft grey"
        // and shipped as "navy shards".
        forestPaint: params?.get?.('forestPaint') === '1',
        // The roster ships since the swap; `?forestV1=1` previews the retired cone forest.
        forestV2: params?.get?.('forestV1') !== '1',
        // Ground plan Wave 0a: `?flatGround=1` is the pricing lever's look, reachable here so
        // an A/B against the painted ground can be taken on the SAME graded rig the verdict
        // is taken on — a lever whose visual effect nobody has ever seen is a lever nobody
        // can sanity-check.
        flatGround: params?.get?.('flatGround') === '1',
    });
    scene.add(world.group);

    const only = params?.get?.('worldOnly');
    if (only) {
        const wanted = only.split(',').map((t) => t.trim()).filter(Boolean);
        world.group.traverse((o) => {
            if (!o.isMesh) return;
            const keep = wanted.some((w) => o.name.includes(w));
            o.visible = keep;
            // Also record the intent: the renderer rewrites `.visible` on forest meshes every
            // frame for its CPU distance/submerged gate, so a one-shot write alone is silently
            // undone and the forest stays on screen no matter what this filter says.
            o.userData.filterVisible = keep;
        });
    }

    // The renderer must stay LINEAR: tonemapping is manual ACES inside the post graph, exactly
    // as the board sets it (OdysseyBoardController: `renderer.toneMapping = NoToneMapping`).
    // Leaving the playground's default here would tone-map twice.
    let post = null;
    if (postEnabled) {
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        post = new OdysseyTslPipeline(renderer, scene, camera, {
            enableBloom: true,
            bloomStrength: 0.32,
            bloomThreshold: 0.85,
            bloomRadius: 0.7,
            sceneSamples: 4,
        });
        post.setSize(Math.max(1, sizes?.width || 1280), Math.max(1, sizes?.height || 720));
    }

    // The per-chapter grade signature only applies when a directorState is passed (the pipeline
    // falls back to the master film stock otherwise), and chapter 4 lifts saturation a further
    // ~1.10 over master — which is precisely the term that turned the deck's base tone navy. A
    // rig without it would under-report the crush it exists to catch.
    const directorState = {
        activeChapter: gradeChapter,
        sourceChapter: gradeChapter,
        targetChapter: gradeChapter,
        seamProgress: 0,
        energy: 0,
        beatPulse: 0,
    };

    const cp = getActiveOdysseyChapterPositions();
    const actT = (p - cp[1]) / (cp[5] - cp[1]);
    const pt = getOdysseyPathPointAt(p);
    const eyeY = pt.y + ODYSSEY_EYE_RAIL_OFFSET_Y;

    // eslint-disable-next-line no-console
    console.log('[act2-cloud-deck]', JSON.stringify({
        p, chapter: gradeChapter, eyeY: Number(eyeY.toFixed(1)), post: postEnabled, ...world.stats,
    }));

    return {
        cameraRadius: 1200,
        update(time, delta) {
            world.update(time, pt, actT, eyeY);
            post?.update(Number.isFinite(delta) ? delta : 0, directorState);
        },
        camera(time, cam) {
            const behind = getOdysseyPathPointAt(Math.max(0, p - 0.012));
            const tx = pt.x - behind.x;
            const tz = pt.z - behind.z;
            const tl = Math.hypot(tx, tz) || 1;
            // Park AT the station — this rig is for looking at one sky, not riding the journey.
            const yaw = (yawDeg * Math.PI) / 180;
            const dirX = ((tx / tl) * Math.cos(yaw)) - ((tz / tl) * Math.sin(yaw));
            const dirZ = ((tx / tl) * Math.sin(yaw)) + ((tz / tl) * Math.cos(yaw));
            const rise = Math.tan((pitchDeg * Math.PI) / 180) * 100;
            // The AIM point is anchored to the station, so `dist` widens the same framing
            // instead of sliding the subject out of shot.
            const baseX = pt.x - ((tx / tl) * 30);
            const baseZ = pt.z - ((tz / tl) * 30);
            const aimX = baseX + (dirX * 100);
            const aimY = eyeY + rise;
            const aimZ = baseZ + (dirZ * 100);
            cam.position.set(baseX - (dirX * backOff), eyeY + lift, baseZ - (dirZ * backOff));
            cam.lookAt(aimX, aimY, aimZ);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize(w, h) {
            post?.setSize(Math.max(1, w), Math.max(1, h));
        },
        dispose() {
            scene.remove(world.group);
            world.dispose();
            post?.dispose?.();
        },
    };
}
