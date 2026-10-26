/**
 * THE SCROLL'S PACE THROUGH THE CLIMB INTO SPACE (2026-10-25). Olov: "when scrolling with the
 * mouse pad it gets a rapid speed when it goes up the mountainside, pass the clouds out in space!!"
 * The wheel slows where the climb, the lean over the Earth and the sunset below change the picture
 * fastest (src/rendering/odyssey/odyssey-scroll-pace.js), and the camera honours it for each wheel
 * step and for its speed cap. Elsewhere nothing changes.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ODYSSEY_SCROLL_PACE, odysseyScrollPace } from '../../src/rendering/odyssey/odyssey-scroll-pace.js';
import { ORBIT_EARTH_SCHEDULE, orbitEarthAt } from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { OdysseyCameraController } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';

describe('odysseyScrollPace — the wheel slows through the climb into space', () => {
    const layout = getLevelRegistry().getPresentationLayout();
    const cp = layout.chapterPositions;
    const b = cp[5];
    const span = cp[6] - b;
    const climbEnd = b + span * ORBIT_EARTH_SCHEDULE.leanOut;
    const sweep = [];
    for (let p = 0; p <= 1; p += 0.0005) sweep.push([p, odysseyScrollPace(p, cp)]);

    it('is 1 without a layout, through the act before the climb, and once the view is back on the rail', () => {
        expect(odysseyScrollPace(0.7, null)).toBe(1);
        expect(odysseyScrollPace(Number.NaN, cp)).toBe(1);
        sweep.filter(([p]) => p < 0.64 || p > cp[6]).forEach(([p, pace]) => {
            expect(pace, `p ${p.toFixed(4)}`).toBe(1);
        });
        // (the last of the sunset under the sinking Earth is a breath, not a brake)
        sweep.filter(([p]) => p > climbEnd + 0.004).forEach(([p, pace]) => {
            expect(pace, `p ${p.toFixed(4)}`).toBeGreaterThan(0.99);
        });
    });

    it('slows most where the Earth comes up out of the haze and the sun sets over it', () => {
        // (where the world becomes the Earth: its clouds go into it)
        const arrival = sweep.filter(([p]) => {
            const e = orbitEarthAt(p, cp);
            return e.presence > 0.3 && e.cloudsAway > 0.02 && e.cloudsAway < 0.98;
        });
        expect(arrival.length).toBeGreaterThan(5);
        arrival.forEach(([p, pace]) => expect(pace, `p ${p.toFixed(4)}`).toBeLessThan(0.45));
        sweep.forEach(([, pace]) => expect(pace).toBeGreaterThanOrEqual(ODYSSEY_SCROLL_PACE.floor));
        // The whole passage takes well over twice the wheel it used to, never a stop.
        const passage = sweep.filter(([p]) => p >= 0.66 && p <= climbEnd + 0.004);
        const wheel = passage.reduce((sum, [, pace]) => sum + (0.0005 / pace), 0);
        expect(wheel / (climbEnd + 0.004 - 0.66)).toBeGreaterThan(2);
    });

    it('changes smoothly, so the wheel never lurches', () => {
        // (at most 0.05 over 0.0005 of progress, ~1 u of rail: steepest where the lean ends)
        sweep.slice(1).forEach(([p, pace], i) => {
            expect(Math.abs(pace - sweep[i][1]), `p ${p.toFixed(4)}`).toBeLessThan(0.05);
        });
    });
});

describe('the camera honours the pace', () => {
    const layout = getLevelRegistry().getPresentationLayout();
    const cp = layout.chapterPositions;
    const make = () => new OdysseyCameraController(
        new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 40000),
        getOdysseyPathCurve(),
        {
            levelPositions: layout.levelPositions,
            chapterPositions: cp,
            startPosition: 0,
            idleAutoDrift: false,
        },
    );
    // A place clear of every orb's magnetic pull, so only the pace scales the step.
    const clearOfOrbs = (controller, from) => {
        for (let p = from; p < from + 0.05; p += 0.0005) {
            const nearest = controller.findNearestLevel(p);
            if (nearest === null || Math.abs(p - nearest) > controller.config.magneticRadius * 2) return p;
        }
        throw new Error(`no clear place after ${from}`);
    };

    it('moves the wheel\'s target by the pace, and caps its speed by it', () => {
        const controller = make();
        const step = (p) => {
            controller.setCurrentPosition(p);
            controller.targetPosition = p;
            controller.scroll(0.01);
            return controller.targetPosition - p;
        };
        const sky = clearOfOrbs(controller, 0.55);
        const seam = clearOfOrbs(controller, 0.712);
        const base = step(sky);
        expect(base).toBeCloseTo(0.01 * controller.config.scrollSpeed, 9);
        const slowed = step(seam);
        expect(slowed / base).toBeCloseTo(odysseyScrollPace(seam, cp), 6);
        expect(slowed / base).toBeLessThan(0.45);

        // A long swipe from the sky that runs on into the climb slows where it enters it.
        controller.setCurrentPosition(0.6);
        controller.targetPosition = 0.6;
        controller.travelModel.inputVelocity = 0;
        for (let i = 0; i < 12; i += 1) controller.scroll(0.24);
        let walked = 0.6;
        for (let wheel = 12 * 0.24 * controller.config.scrollSpeed; wheel > 1e-9; wheel -= 0.0001) {
            walked += Math.min(wheel, 0.0001) * odysseyScrollPace(walked, cp);
        }
        // (no further than the pace walked alone allows; the orbs' pull only holds it back more)
        expect(controller.targetPosition).toBeLessThanOrEqual(walked + 1e-6);
        expect(walked).toBeLessThan(0.6 + 12 * 0.24 * controller.config.scrollSpeed - 0.02);

        // A far target (a hard flick) is followed no faster than the paced cap.
        controller.setCurrentPosition(seam);
        controller.targetPosition = seam + 0.05;
        const dt = 1 / 60;
        for (let i = 0; i < 30; i += 1) {
            const from = controller.currentPosition;
            controller.updateFollow(dt);
            const cap = controller.config.maxScrollVelocity * odysseyScrollPace(from, cp) * dt;
            expect(controller.currentPosition - from, `frame ${i}`).toBeLessThanOrEqual(cap + 1e-9);
        }
        expect(controller.currentPosition).toBeGreaterThan(seam);
    });
});
