/**
 * THE OCEAN'S ANIMALS ARE MET, AND LEAVE OUT OF VIEW (2026-10-20, in-game feedback: coming up
 * from chapter 1 "the whale and things just pop up", and the visitors dissolved in plain view).
 *
 * Both were switched on by progress. The glide from orb 5 to orb 6 takes about a second, and in
 * that second the steam cleared, the ocean's life came on and the whales' and the shark's fades
 * ran 0 -> 1 with the animals already in frame 65-130 u from the eye. Now they ARRIVE on the
 * clock, swimming in from the blue (stepVisitorPassage, the whales' too since 2026-10-22), and
 * LEAVE by diving outward and under the eye, which looks up — out of frame before their alpha
 * drops.
 *
 * Plays the journey through the ocean on the real camera (tests/unit/helpers/odyssey-camera-rig):
 * a one-second glide between orbs and a long park at each, the passage stepped on that clock.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { odysseyQuenchCarry } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { steamQuenchSeamT } from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import {
    OCEAN_VISITOR_CAST, VISITOR_PASSAGE, resolveOceanVisitorCentre, stepVisitorPassage,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';
import { WHALE_PASS_STAGE } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 1 / 30;
const GLIDE_S = 1;
const PARK_S = 20;
const FRAME = 1.1;

describe("Act I's ocean animals (real camera, the board's clock)", () => {
    const rig = createOdysseyCameraRig();
    const [c1, c2] = [rig.cp[1], rig.cp[2]];
    // Each animal's loop centre: the rail at its `at` of chapter 2's span (the board's placeOf).
    const centreOf = (at) => getOdysseyPathPointAt(c1 + ((c2 - c1) * at));
    const whaleAxis = centreOf(WHALE_PASS_STAGE.at);

    /** The journey through the ocean as the player makes it: glide, park, glide, park... */
    function* playthrough() {
        const stops = [5, 6, 7, 8, 9, 10, 11].map((id) => rig.parkOf(id));
        let p = stops[0];
        for (let i = 1; i < stops.length; i += 1) {
            const from = p;
            const to = stops[i];
            for (let t = 0; t < GLIDE_S; t += DT) yield from + ((to - from) * (t / GLIDE_S));
            for (let t = 0; t < PARK_S; t += DT) yield to;
            p = to;
        }
    }

    /** What the board feeds the animals at `p`: the water, the chapter, the steam's life carry. */
    function waterAt(p, eyeY) {
        const submerged = THREE.MathUtils.clamp((ODYSSEY_SEA_LEVEL + 2 - eyeY) / 14, 0, 1);
        const { life } = odysseyQuenchCarry(steamQuenchSeamT(p, c1));
        return { submerged, life, inChapter: p > c1 && p < c2 + 0.01 };
    }

    /** A visitor's loop, every bearing, as world points with the passage offset. */
    function visitorPlaces(cast, offset) {
        const { loop } = cast;
        const centre = resolveOceanVisitorCentre(cast, rig.cp);
        return Array.from({ length: 36 }, (_, i) => {
            const a = (i / 36) * Math.PI * 2;
            const r = loop.radius + (Math.sin((a * 2) + (loop.phase * 3)) * loop.wobble) + offset.radial;
            return new THREE.Vector3(
                centre.x + (Math.cos(a) * r),
                cast.y + (Math.sin((a * 1.5) + loop.phase) * loop.lift) + offset.up,
                centre.z + (Math.sin(a) * r),
            );
        });
    }

    OCEAN_VISITOR_CAST.forEach((cast) => {
        it(`${cast.name}: arrives from the blue, keeps you company, and is out of frame before it fades`, () => {
            const state = {};
            let met = null;
            let company = 0;
            let left = false;
            let breached = false;
            for (const p of playthrough()) {
                const camera = rig.poseAt(p);
                const eyeY = camera.position.y;
                const water = waterAt(p, eyeY);
                const on = water.inChapter && water.submerged > 0.5 && water.life > 0.001;
                const wasWith = state.phase === 'in';
                const passage = stepVisitorPassage(state, {
                    camY: eyeY, on, dt: DT, window: cast.window,
                });
                // The eye leaving the water ends every animal at once: there is nothing to see.
                if (wasWith && !on && state.phase !== 'in' && state.phase !== 'out') breached = true;
                const alpha = passage.alpha * water.life;
                if (!passage.shown || alpha <= 0.01) continue;
                const places = visitorPlaces(cast, passage);
                const nearest = Math.min(...places.map((pt) => pt.distanceTo(camera.position)));
                if (met === null) met = { p, nearest, alpha };
                if (state.phase === 'in' && passage.radial < 1) company += DT;
                if (state.phase === 'out') {
                    left = true;
                    // Fading (alpha below full) only once nothing of it can be in frame.
                    if (alpha < 0.99) {
                        const inView = places.filter((pt) => rig.inFrame(camera, pt, FRAME)).length;
                        expect(inView, `${cast.name} in frame while fading at p=${p.toFixed(4)}`).toBe(0);
                    }
                }
            }
            // Met far off, faint, after the steam has thinned: never switched on at the eye. (Its
            // whole arrival ring is measured, and a loop centred ahead of the eye, like the manta's,
            // brings the ring's near side to ~0.65 of the reach.)
            expect(met).not.toBeNull();
            expect(met.nearest).toBeGreaterThan(VISITOR_PASSAGE.reach * 0.6);
            expect(met.alpha).toBeLessThan(0.2);
            expect(met.p).toBeGreaterThan(c1);
            // It did keep company on its loop for a while, and did leave.
            expect(company).toBeGreaterThan(10);
            // It left by swimming away, or (the manta, which waits just under the surface at the
            // last orb) was still with you when the eye broke the surface.
            expect(left || breached).toBe(true);
        });
    });

    it('the whale pair swims in from beyond its orbit, faint at first, once the steam has thinned', () => {
        // On the journey: the first frame the pair may show, it is far beyond its lane and faint.
        const state = {};
        let met = null;
        for (const p of playthrough()) {
            const camera = rig.poseAt(p);
            const water = waterAt(p, camera.position.y);
            const on = water.inChapter && water.submerged > 0.5 && water.life > 0.001;
            const passage = stepVisitorPassage(state, {
                camY: camera.position.y, on, dt: DT, window: WHALE_PASS_STAGE.window,
            });
            if (!passage.shown || passage.alpha * water.life <= 0.01) continue;
            const { radius, depth } = WHALE_PASS_STAGE.mother;
            let nearest = Infinity;
            for (let a = 0; a < Math.PI * 2; a += 0.2) {
                const r = radius + passage.radial;
                const pt = new THREE.Vector3(whaleAxis.x + (Math.cos(a) * r), ODYSSEY_SEA_LEVEL - depth, whaleAxis.z + (Math.sin(a) * r));
                nearest = Math.min(nearest, pt.distanceTo(camera.position));
            }
            met = { p, nearest, alpha: passage.alpha };
            break;
        }
        expect(met).not.toBeNull();
        expect(met.p).toBeGreaterThan(c1);
        expect(met.nearest).toBeGreaterThan(VISITOR_PASSAGE.reach * 0.8);
        expect(met.alpha).toBeLessThan(0.2);
    });
});
