/**
 * THE OCEAN'S ANIMALS ARE MET, NOT SWITCHED ON (2026-10-20, in-game feedback: coming up from
 * chapter 1 "the whale and things just pop up").
 *
 * The glide from orb 5 to orb 6 takes about a second, and in that second the steam clears and the
 * ocean's life comes on. The animals are met far off and faint: since 2026-10-24 each roams its own
 * route high in the column (odyssey-ocean-roam.js), and once the water allows it, it fades in from
 * the water colour over a few seconds. Only the water ending (the breach, the chapter's edge) ends
 * it.
 *
 * Plays the journey through the ocean on the real camera (tests/unit/helpers/odyssey-camera-rig):
 * a one-second glide between orbs and a long park at each, on the board's clock.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { odysseyQuenchCarry } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { steamQuenchSeamT } from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import {
    OCEAN_ROAM, roamAt, roamLane, stepRoamArrival,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import {
    oceanLifeDrawn, throughSurfaceShare,
} from '../../src/rendering/odyssey/composition/odyssey-through-surface.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 1 / 30;
const GLIDE_S = 1;
const PARK_S = 20;
const ROUTES = {
    whaleShark: OCEAN_ROAM.whaleShark,
    manta: OCEAN_ROAM.manta,
    mother: OCEAN_ROAM.whales,
    calf: roamLane(OCEAN_ROAM.whales, WHALE_PASS_PAIR.calf),
};

describe("Act I's ocean animals (real camera, the board's clock)", () => {
    const rig = createOdysseyCameraRig();
    rig.camera.aspect = 16 / 9;
    const [c1, c2] = [rig.cp[1], rig.cp[2]];

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

    Object.entries(ROUTES).forEach(([name, path]) => {
        it(`${name}: met far off and faint once the steam has thinned, then swims its own route`, () => {
            let state = {};
            let met = null;
            let company = 0;
            let ended = false;
            let t = 0;
            const at = new THREE.Vector3();
            for (const p of playthrough()) {
                t += DT;
                const camera = rig.poseAt(p);
                camera.aspect = 16 / 9;
                camera.updateProjectionMatrix();
                const water = waterAt(p, camera.position.y);
                roamAt(path, t, at);
                const on = oceanLifeDrawn({
                    ready: true,
                    inChapter: water.inChapter,
                    life: water.life,
                    eyeY: camera.position.y,
                    seaLevel: ODYSSEY_SEA_LEVEL,
                    seen: throughSurfaceShare(camera.position, at, ODYSSEY_SEA_LEVEL),
                });
                if (!on) {
                    // The board resets it out of the water: it arrives afresh next time.
                    if (state.arrive !== undefined) ended = true;
                    state = {};
                    continue;
                }
                const fade = stepRoamArrival(state, DT) * water.life;
                if (fade <= 0.01) continue;
                if (met === null) met = { p, distance: at.distanceTo(camera.position), fade };
                if (fade > 0.9 && rig.inFrame(camera, at, 1)) company += DT;
            }
            // Met far off and faint, in the ocean: never switched on at the eye.
            expect(met).not.toBeNull();
            expect(met.p).toBeGreaterThan(c1);
            expect(met.distance).toBeGreaterThan(100);
            expect(met.fade).toBeLessThan(0.2);
            // It is seen through part of the ocean's parks (5 parks of 20 s) as it swims its route,
            // and the water ending (the breach) is what ends it.
            expect(company, `${name} in frame and arrived`).toBeGreaterThan(15);
            expect(ended).toBe(true);
        });
    });

    /**
     * PASSED, NEVER SWITCHED OFF IN VIEW (2026-10-31, Olov: "the fishes pops away right in front of
     * the camera, we need to wait until we have moved past them across the surface of the sea").
     * The manta glides just under the surface ahead of orb 10, and the glide to orb 11 carries the
     * eye up through the surface. Over that glide, from many clock phases and at several paces, no
     * animal may stop being drawn while it is in frame and would still show (through the surface,
     * once the eye is above it): it leaves by leaving the frame or by fading into the reflection.
     */
    it('carries every animal through the breach until the climb has passed it', () => {
        const from = rig.parkOf(10);
        const to = rig.parkOf(11);
        const at = new THREE.Vector3();
        let mantaSeenFromAbove = 0;
        Object.entries(ROUTES).forEach(([name, path]) => {
            for (let k = 0; k < 24; k += 1) {
                for (const glideS of [1, 3]) {
                    const t0 = (k / 24) * path.period;
                    let wasDrawn = false;
                    for (let t = 0; t <= glideS + 2; t += DT) {
                        const p = from + ((to - from) * Math.min(1, t / glideS));
                        const camera = rig.poseAt(p);
                        camera.aspect = 16 / 9;
                        camera.updateProjectionMatrix();
                        const eye = camera.position;
                        roamAt(path, t0 + t, at);
                        const water = waterAt(p, eye.y);
                        const seen = throughSurfaceShare(eye, at, ODYSSEY_SEA_LEVEL);
                        const drawn = oceanLifeDrawn({
                            ready: true,
                            inChapter: water.inChapter,
                            life: water.life,
                            eyeY: eye.y,
                            seaLevel: ODYSSEY_SEA_LEVEL,
                            seen,
                        });
                        const inView = rig.inFrame(camera, at, 1.1);
                        if (wasDrawn && !drawn) {
                            expect(inView && seen > 0.02, `${name} switched off in view at p ${p.toFixed(4)}`)
                                .toBe(false);
                        }
                        if (name === 'manta' && drawn && inView && eye.y > ODYSSEY_SEA_LEVEL) mantaSeenFromAbove += 1;
                        wasDrawn = drawn;
                    }
                }
            }
        });
        // The manta is still there under the surface once the eye has broken through it.
        expect(mantaSeenFromAbove).toBeGreaterThan(0);
    });
});
