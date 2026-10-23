/**
 * THE OCEAN'S ANIMALS ARE MET, NOT SWITCHED ON (2026-10-20, in-game feedback: coming up from
 * chapter 1 "the whale and things just pop up").
 *
 * The glide from orb 5 to orb 6 takes about a second, and in that second the steam clears and the
 * ocean's life comes on. The animals ARRIVE: they swim in from the blue, from far beyond their place,
 * faint, once the steam has thinned. Since 2026-10-23 they then keep the eye company for the rest of
 * the ocean (odyssey-ocean-escort.js), and only the water ending (the breach, the chapter's edge)
 * ends them.
 *
 * Plays the journey through the ocean on the real camera (tests/unit/helpers/odyssey-camera-rig):
 * a one-second glide between orbs and a long park at each, the escort stepped on that clock.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { odysseyQuenchCarry } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { steamQuenchSeamT } from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import {
    OCEAN_ESCORT, resolveEscortTarget, stepEscortFrame,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-escort.js';
import { placeEscorted } from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 1 / 30;
const GLIDE_S = 1;
const PARK_S = 20;

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

    function viewOf(camera) {
        camera.updateMatrixWorld(true);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        return {
            position: camera.position.clone(),
            forward,
            up,
            right: new THREE.Vector3().crossVectors(forward, up),
            tanHalf: Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
            aspect: 16 / 9,
        };
    }

    Object.entries(OCEAN_ESCORT).forEach(([name, slot]) => {
        it(`${name}: met far off and faint once the steam has thinned, then keeps you company`, () => {
            const frame = {};
            let state = {};
            let met = null;
            let company = 0;
            let ended = false;
            let t = 0;
            const at = new THREE.Vector3();
            const velocity = new THREE.Vector3();
            for (const p of playthrough()) {
                t += DT;
                const camera = rig.poseAt(p);
                camera.aspect = 16 / 9;
                camera.updateProjectionMatrix();
                const view = stepEscortFrame(frame, viewOf(camera), DT);
                const water = waterAt(p, camera.position.y);
                const on = water.inChapter && water.submerged > 0.5 && water.life > 0.001;
                if (!on) {
                    // The board resets it out of the water: it arrives afresh next time.
                    if (state.pos) ended = true;
                    state = {};
                    continue;
                }
                const fade = placeEscorted(state, view, slot, ODYSSEY_SEA_LEVEL, t, DT, at, velocity) * water.life;
                if (fade <= 0.01) continue;
                if (met === null) {
                    const home = resolveEscortTarget(view, slot, ODYSSEY_SEA_LEVEL, { x: 0, y: 0, z: 0 });
                    met = {
                        p,
                        distance: at.distanceTo(camera.position),
                        home: new THREE.Vector3(home.x, home.y, home.z).distanceTo(camera.position),
                        fade,
                    };
                }
                if (fade > 0.9 && rig.inFrame(camera, at, 1)) company += DT;
            }
            // Met far off (out beyond its place), faint, in the ocean: never switched on at the eye.
            expect(met).not.toBeNull();
            expect(met.p).toBeGreaterThan(c1);
            expect(met.distance).toBeGreaterThan(met.home * 1.3);
            expect(met.fade).toBeLessThan(0.2);
            // It keeps company for most of the ocean's parks (5 parks of 20 s), and the water ending
            // (the breach) is what ends it.
            expect(company, `${name} in frame and arrived`).toBeGreaterThan(60);
            expect(ended).toBe(true);
        });
    });
});
