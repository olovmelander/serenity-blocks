/**
 * The life on the glide between two orbs (src/rendering/odyssey/odyssey-glide-life.js) and the
 * move a chapter arrival lands in (odyssey-arrival-move.js). Both must leave every resting view
 * exactly as the rail's framing made it: they are zero at the ends of what they ride on.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GLIDE_LIFE, applyGlideLife, glideBankTarget, glideEnvelope, glideTakesLife,
} from '../../src/rendering/odyssey/odyssey-glide-life.js';
import {
    ARRIVAL_MOVE_RELEASE_SECONDS, ARRIVAL_MOVE_RIDE_IN, CHAPTER_ARRIVAL_MOVES, applyArrivalMove, arrivalMoveWeight,
    beginChapterArrivalMove, endChapterArrivalMove, landChapterArrivalMove,
} from '../../src/rendering/odyssey/odyssey-arrival-move.js';

/** A stand-in for the camera controller: a camera looking down -z from the origin. */
function controller(extra = {}) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    return {
        camera,
        mode: 'follow',
        followCameraUp: new THREE.Vector3(0, 1, 0),
        lookAtTarget: new THREE.Vector3(0, 0, -50),
        directorCamera: { followDistance: 28 },
        currentPosition: 0.5,
        chapter1EndPosition: 0.065,
        _pendingViewRoll: 0,
        prefersReducedMotion: () => false,
        triggerFovPulse: vi.fn(),
        ...extra,
    };
}
const trip = (extra = {}) => ({
    active: true, elapsed: 0, duration: 2000, direction: 1, ...extra,
});

describe('the glide between two orbs', () => {
    it('follows one envelope that is nothing at both ends, in value and in slope', () => {
        expect(glideEnvelope(0)).toBe(0);
        expect(glideEnvelope(1)).toBeCloseTo(0, 10);
        expect(glideEnvelope(0.5)).toBeCloseTo(1);
        expect(glideEnvelope(0.01)).toBeLessThan(0.002);
        expect(glideEnvelope(0.99)).toBeLessThan(0.002);
        expect(glideEnvelope(-3)).toBe(0);
        expect(glideEnvelope(7)).toBeCloseTo(0, 10);
    });

    it('banks toward the side the view swings to, never past its limit', () => {
        const limit = THREE.MathUtils.degToRad(GLIDE_LIFE.bankDeg);
        expect(glideBankTarget(10, 0.5)).toBeGreaterThan(0);
        expect(glideBankTarget(-10, 0.5)).toBeLessThan(0);
        expect(glideBankTarget(10000, 0.5)).toBeCloseTo(limit);
        expect(glideBankTarget(-10000, 0.5)).toBeCloseTo(-limit);
        expect(glideBankTarget(10000, 0)).toBe(0);
        expect(GLIDE_LIFE.bankDeg).toBeLessThanOrEqual(3);
    });

    it('is for an orb-to-orb ride only: not the opening sweep, the plunge, a settle or reduced motion', () => {
        expect(glideTakesLife(trip(), false)).toBe(true);
        expect(glideTakesLife(trip(), true)).toBe(false);
        expect(glideTakesLife(trip({ sweep: true }), false)).toBe(false);
        expect(glideTakesLife(trip({ plunge: { from: 0, to: 1 } }), false)).toBe(false);
        expect(glideTakesLife(trip({ duration: 300 }), false)).toBe(false);
        expect(glideTakesLife(trip({ active: false }), false)).toBe(false);
        expect(glideTakesLife(null, false)).toBe(false);
    });

    it('breathes once over the trip, rolls into a swing and lands level on the frame it was given', () => {
        const c = controller();
        const travel = trip();
        const steps = 120;
        let mostRoll = 0;
        for (let i = 0; i <= steps; i++) {
            travel.elapsed = (travel.duration * i) / steps;
            // The trip places the camera on the rail each frame: here the view swings steadily left.
            c.camera.position.set(0, 0, 0);
            const yaw = THREE.MathUtils.degToRad(20 * (i / steps));
            c.lookAtTarget.set(-Math.sin(yaw) * 50, 0, -Math.cos(yaw) * 50);
            c._pendingViewRoll = 0;
            applyGlideLife(c, travel);
            mostRoll = Math.max(mostRoll, c._pendingViewRoll);
            // The eye and its aim are the rail's, every frame: the life never moves them.
            expect(c.camera.position.lengthSq()).toBe(0);
            expect(c.lookAtTarget.y).toBe(0);
        }
        // One breath, sized and timed to the trip.
        expect(c.triggerFovPulse).toHaveBeenCalledTimes(1);
        expect(c.triggerFovPulse).toHaveBeenCalledWith('expand', { amount: GLIDE_LIFE.fovDeg, duration: 2 });
        // It banked left (the swing was to the left), within its limit.
        expect(mostRoll).toBeGreaterThan(THREE.MathUtils.degToRad(0.4));
        expect(mostRoll).toBeLessThanOrEqual(THREE.MathUtils.degToRad(GLIDE_LIFE.bankDeg) + 1e-9);
        // The last frame is level.
        expect(Math.abs(c._pendingViewRoll)).toBeLessThan(1e-6);
    });

    it('banks the other way for a swing to the right, and adds to a roll already asked for this frame', () => {
        const c = controller();
        const travel = trip();
        for (let i = 0; i <= 60; i++) {
            travel.elapsed = (travel.duration * i) / 120;
            const yaw = THREE.MathUtils.degToRad(-20 * (i / 120));
            c.lookAtTarget.set(-Math.sin(yaw) * 50, 0, -Math.cos(yaw) * 50);
            c._pendingViewRoll = 0.01;
            applyGlideLife(c, travel);
        }
        expect(c._pendingViewRoll).toBeLessThan(0.01);
        expect(travel.glideLife.roll).toBeLessThan(0);
    });

    it('does nothing for a trip that takes no life, and leaves the breath to a chapter arrival', () => {
        const still = controller({ prefersReducedMotion: () => true });
        expect(applyGlideLife(still, trip({ elapsed: 500 }))).toBe(false);
        expect(still.triggerFovPulse).not.toHaveBeenCalled();
        const arriving = controller({ arrivalMove: { spec: CHAPTER_ARRIVAL_MOVES[4] } });
        expect(applyGlideLife(arriving, trip({ elapsed: 500 }))).toBe(true);
        expect(arriving.triggerFovPulse).not.toHaveBeenCalled();
    });
});

describe('the move a chapter arrival lands in', () => {
    it('has a move for each crossing but the opening and the dive', () => {
        expect(Object.keys(CHAPTER_ARRIVAL_MOVES).map(Number)).toEqual([2, 3, 4, 5, 6, 8]);
        for (const move of Object.values(CHAPTER_ARRIVAL_MOVES)) {
            // A turn of the gaze you can read, never one that loses the view: the first orb stays in frame.
            expect(Math.hypot(move.yawDeg, move.pitchDeg)).toBeGreaterThan(5);
            expect(Math.hypot(move.yawDeg, move.pitchDeg)).toBeLessThan(13);
            expect(Math.abs(move.rollDeg)).toBeLessThanOrEqual(3);
            expect(move.seconds).toBeGreaterThanOrEqual(5);
            expect(move.seconds).toBeLessThanOrEqual(8);
        }
    });

    it('rides in during the crossing and comes round to nothing after the landing', () => {
        expect(arrivalMoveWeight({ travel: 0, landed: null, seconds: 6 })).toBe(0);
        expect(arrivalMoveWeight({ travel: ARRIVAL_MOVE_RIDE_IN, landed: null, seconds: 6 })).toBe(0);
        expect(arrivalMoveWeight({ travel: 0.7, landed: null, seconds: 6 })).toBeGreaterThan(0.3);
        expect(arrivalMoveWeight({ travel: 1, landed: null, seconds: 6 })).toBe(1);
        // Landing is continuous with the end of the crossing, and the gaze settles with no step.
        expect(arrivalMoveWeight({ travel: null, landed: 0, seconds: 6 })).toBe(1);
        expect(arrivalMoveWeight({ travel: null, landed: 3, seconds: 6 })).toBeCloseTo(0.5);
        expect(arrivalMoveWeight({ travel: null, landed: 6, seconds: 6 })).toBe(0);
        expect(arrivalMoveWeight({ travel: null, landed: 5.99, seconds: 6 })).toBeLessThan(1e-6);
        expect(arrivalMoveWeight({ travel: null, landed: null, seconds: 6 })).toBe(0);
    });

    it('turns the aimed view during the crossing, widens the lens once, and ends on the view untouched', () => {
        const c = controller();
        expect(beginChapterArrivalMove(c, 4)).toBe(true);
        const travel = trip({ duration: 2200 });
        c.pathTravel = travel;
        const aim = () => {
            c.camera.position.set(0, 0, 0);
            c.camera.up.set(0, 1, 0);
            c.camera.lookAt(c.lookAtTarget);
        };
        const forward = () => new THREE.Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
        let now = 1000;
        // Early in the crossing: bound to the trip, the lens pulse started, the view still the rail's.
        travel.elapsed = 100;
        aim();
        expect(applyArrivalMove(c, 0.016, now)).toBe(0);
        expect(c.triggerFovPulse).toHaveBeenCalledTimes(1);
        expect(c.triggerFovPulse.mock.calls[0][1].amount).toBe(CHAPTER_ARRIVAL_MOVES[4].fovDeg);
        expect(forward().z).toBeCloseTo(-1, 6);
        // As it lands the gaze is off the view: down at the foothills (chapter 4 starts low).
        travel.elapsed = travel.duration;
        aim();
        expect(applyArrivalMove(c, 0.016, now)).toBeCloseTo(1);
        expect(forward().y).toBeLessThan(-0.1);
        // The crossing ends: from here the gaze comes round.
        travel.active = false;
        now += 16;
        aim();
        expect(applyArrivalMove(c, 0.016, now)).toBeGreaterThan(0.99);
        now += CHAPTER_ARRIVAL_MOVES[4].seconds * 500;
        aim();
        const half = applyArrivalMove(c, 0.016, now);
        expect(half).toBeGreaterThan(0.3);
        expect(half).toBeLessThan(0.7);
        // Done: the view is exactly what the rail aimed, and the move is gone.
        now += CHAPTER_ARRIVAL_MOVES[4].seconds * 600;
        aim();
        expect(applyArrivalMove(c, 0.016, now)).toBe(0);
        expect(c.arrivalMove).toBeNull();
        expect(forward().z).toBeCloseTo(-1, 9);
        expect(c.triggerFovPulse).toHaveBeenCalledTimes(1);
    });

    it('lets go smoothly when the chapter begins or something else takes the camera', () => {
        const c = controller();
        beginChapterArrivalMove(c, 3);
        landChapterArrivalMove(c, 0);
        expect(applyArrivalMove(c, 0.016, 100)).toBeGreaterThan(0.9);
        endChapterArrivalMove(c);
        const first = applyArrivalMove(c, ARRIVAL_MOVE_RELEASE_SECONDS / 2, 116);
        expect(first).toBeGreaterThan(0.2);
        expect(first).toBeLessThan(0.8);
        expect(applyArrivalMove(c, ARRIVAL_MOVE_RELEASE_SECONDS, 200)).toBe(0);
        expect(c.arrivalMove).toBeNull();
        // The entry zoom (a focus animation) releases it without being asked.
        beginChapterArrivalMove(c, 3);
        landChapterArrivalMove(c, 0);
        c.mode = 'focus';
        applyArrivalMove(c, 0.1, 100);
        expect(c.arrivalMove.releasing).toBe(true);
    });

    it('never plays into chapter 1, through the plunge, or under reduced motion', () => {
        const c = controller();
        expect(beginChapterArrivalMove(c, 1)).toBe(false);
        expect(beginChapterArrivalMove(c, 7)).toBe(false);
        expect(c.arrivalMove).toBeNull();
        expect(beginChapterArrivalMove(c, 4, { reducedMotion: true })).toBe(false);
        expect(beginChapterArrivalMove(controller({ prefersReducedMotion: () => true }), 4)).toBe(false);
        expect(beginChapterArrivalMove(null, 4)).toBe(false);
        // A crossing that turns out to be the plunge drops the move.
        beginChapterArrivalMove(c, 8);
        c.pathTravel = trip({ plunge: { from: 0, to: 1 } });
        expect(applyArrivalMove(c, 0.016, 0)).toBe(0);
        expect(c.arrivalMove).toBeNull();
        expect(c.triggerFovPulse).not.toHaveBeenCalled();
        // No move at all: nothing happens and nothing is read.
        expect(applyArrivalMove(controller(), 0.016, 0)).toBe(0);
        expect(() => { landChapterArrivalMove(null); endChapterArrivalMove(null); }).not.toThrow();
    });
});
