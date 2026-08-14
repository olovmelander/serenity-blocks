/**
 * ODYSSEY ACT II — the real world, in the playground.
 *
 * A thin wrapper. Everything lives in src/rendering/odyssey/world/odyssey-world-renderer.js so
 * the game and this page render the SAME world from the same code — which is the point of
 * extracting it: a playground that diverges from the build it is meant to be iterating on is
 * worse than no playground.
 *
 * The camera rides the REAL Odyssey spline. What you are looking at is chapters 2 through 5 as
 * one continuous surface, with no chapter environments, no crossfade and no seams.
 */

import { createOdysseyWorld } from '../../rendering/odyssey/world/odyssey-world-renderer.js';
import { ODYSSEY_EYE_RAIL_OFFSET_Y } from '../../rendering/odyssey/world/odyssey-world-height.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathPointAt,
} from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'odyssey-world',
    title: 'Odyssey — Act II as one world',
    description: 'The real height field + real spline: ch2-ch5 with no chapters',
};

export function create({ scene, camera, params }) {
    // The clipmap reaches tens of thousands of units, so the playground's default 0.1/20000
    // frustum clips the sky dome away entirely and the sky renders black at altitude. Pull the
    // near plane out while widening the far one: 0.1/30000 is a depth ratio of 300,000, which
    // invites z-fighting between the ground and a water sheet metres above it.
    if (camera) {
        camera.near = 1.0;
        camera.far = 30000;
        camera.updateProjectionMatrix();
    }

    const quality = params?.get?.('worldQuality') === 'low' ? 'low' : 'high';
    // The world does not know the rail; the caller samples it. 48 points across the journey
    // seat the underwater god-ray shafts along the real submerged stretch.
    const railSamples = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    const world = createOdysseyWorld({ quality, railSamples });
    scene.add(world.group);

    // COMPILE BISECT LEVER — ?worldOnly=ground,sky (comma list; substring match on mesh name).
    // The first in-game/playground render pays one synchronous pipeline-compile bill for every
    // visible mesh; when that bill inexplicably runs to minutes (2026-08-12: 155 s), the only
    // way to attribute it is to compile one material family at a time. An invisible mesh
    // creates no pipeline, so hiding is exclusion. No param = everything visible = unchanged.
    const only = params?.get?.('worldOnly');
    if (only) {
        const wanted = only.split(',').map((t) => t.trim()).filter(Boolean);
        world.group.traverse((o) => {
            if (o.isMesh) o.visible = wanted.some((w) => o.name.includes(w));
        });
    }

    // eslint-disable-next-line no-console
    console.log('[odyssey-world]', JSON.stringify(world.stats));
    if (typeof window !== 'undefined') window.__ODYSSEY_WORLD__ = world.stats;

    const cp = getActiveOdysseyChapterPositions();
    const ACT_START = cp[1];
    const ACT_END = cp[5];
    const LOOP_SECONDS = 60;

    const railAt = (time) => ACT_START
        + ((ACT_END - ACT_START) * Math.min(1, Math.max(0, (time % LOOP_SECONDS) / LOOP_SECONDS)));

    return {
        cameraRadius: 1200,
        update(time) {
            const p = railAt(time);
            const pt = getOdysseyPathPointAt(p);
            // Pass the EYE the camera() hook below actually uses — uSubmerged is driven by
            // the eye now, and omitting it falls back to the old rail contract, which put
            // this playground 32 u above its own camera.
            world.update(time, pt, (p - ACT_START) / (ACT_END - ACT_START), pt.y + ODYSSEY_EYE_RAIL_OFFSET_Y);
        },
        camera(time, cam) {
            const p = railAt(time);
            const pt = getOdysseyPathPointAt(p);
            const ahead = getOdysseyPathPointAt(Math.min(1, p + 0.055));
            const behind = getOdysseyPathPointAt(Math.max(0, p - 0.012));
            const tx = pt.x - behind.x;
            const tz = pt.z - behind.z;
            const tl = Math.hypot(tx, pt.y - behind.y, tz) || 1;
            cam.position.set(pt.x - ((tx / tl) * 30), pt.y + ODYSSEY_EYE_RAIL_OFFSET_Y, pt.z - ((tz / tl) * 30));

            // Look ALONG the rail with the pitch CLAMPED. Aiming straight at a point further
            // down the path pitches ~37 degrees up through Ch5's climb and the whole world
            // leaves the frustum; biasing the aim toward the camera's own altitude
            // over-corrects into a top-down view of dirt. The shipped build solves this with
            // per-chapter framing overrides; a clamp is the same idea without the table.
            const dx = ahead.x - cam.position.x;
            const dy = ahead.y - cam.position.y;
            const dz = ahead.z - cam.position.z;
            const horiz = Math.hypot(dx, dz) || 1;
            const pitch = Math.max(-0.30, Math.min(0.16, dy / horiz));
            cam.lookAt(cam.position.x + dx, cam.position.y + (pitch * horiz), cam.position.z + dz);
        },
        resize() {},
        dispose() {
            scene.remove(world.group);
            world.dispose();
        },
    };
}
