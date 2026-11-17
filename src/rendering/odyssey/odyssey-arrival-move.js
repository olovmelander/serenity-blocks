/**
 * THE ARRIVAL MOVE: crossing into a new chapter ends in a move, not a stop.
 *
 * A chapter arrival used to be the ride along the rail coming to rest and a sheet laid over
 * the view. Now the ride lands with the camera's gaze still off the chapter's view (down at the
 * water it has just broken through, back at the Earth it has just left) and its lens wide, and
 * over the next seconds, while the chapter's title rises, the gaze comes round onto the view
 * and the lens closes on it. The picture the player is left with is the chapter's own hero
 * framing, the one the scenery is composed for: the move only decides how you come to it.
 *
 * It is a turn of the VIEW laid on the aimed camera (as the look-around's turn is), weighted by
 * a clock: it never moves the eye, never changes what the rail's framing resolves to, and at
 * weight 0 it is the identity, so every resting view the framing guards test is untouched. It
 * rides in during the crossing (while the camera is moving fast and nothing can pop) and out
 * over `seconds` after landing. Anything else that takes the camera (the entry zoom on Begin
 * chapter, a focus, the look of the plunge) lets it go over RELEASE_SECONDS.
 *
 * Not under reduced motion. Not into chapter 1 (its opening shot is authored on the lava
 * floor) and not through the black hole's plunge into chapter 7 (the dive is that arrival).
 */
import * as THREE from 'three/webgpu';

/**
 * Where the gaze is when the ride lands, as a turn away from the chapter's view (degrees:
 * yaw + = left, pitch + = up, roll + = counter-clockwise), how long it takes to come round
 * (`seconds`) and how much wider the lens is as it lands (`fovDeg`).
 */
export const CHAPTER_ARRIVAL_MOVES = Object.freeze({
    // 2 Deep ocean: you land still looking up at the light you sank from; the gaze sinks into the deep.
    2: Object.freeze({
        yawDeg: 5, pitchDeg: 9, rollDeg: -1.5, seconds: 6, fovDeg: 4,
    }),
    // 3 Island: you break the surface looking at the water round you; the gaze lifts to the land.
    3: Object.freeze({
        yawDeg: -6, pitchDeg: -8, rollDeg: 2, seconds: 5.5, fovDeg: 5,
    }),
    // 4 Mountains: from the foothills at your feet up to the peaks.
    4: Object.freeze({
        yawDeg: 5, pitchDeg: -8, rollDeg: 0, seconds: 6, fovDeg: 4,
    }),
    // 5 Sky: the summit falls away beneath you; the gaze rises into open air.
    5: Object.freeze({
        yawDeg: -4, pitchDeg: -10, rollDeg: 1.5, seconds: 6.5, fovDeg: 5,
    }),
    // 6 Space: a last look aside at where you came from, then round to the dark ahead.
    6: Object.freeze({
        yawDeg: 8, pitchDeg: -5, rollDeg: -2.5, seconds: 7, fovDeg: 3,
    }),
    // 8 Neon city: from the sky the fold opened onto, down the boulevard.
    8: Object.freeze({
        yawDeg: -4, pitchDeg: 7, rollDeg: 0, seconds: 5.5, fovDeg: 4,
    }),
});

/** The share of the crossing at which the move starts riding in. */
export const ARRIVAL_MOVE_RIDE_IN = 0.35;
/** How quickly the move lets go when something else takes the camera (seconds). */
export const ARRIVAL_MOVE_RELEASE_SECONDS = 0.45;

const smoothstep = (lo, hi, value) => {
    const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};
const smootherstep = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * How much of the move's turn the view has (0..1).
 * @param {object} phase
 * @param {number|null} phase.travel the crossing's own progress (0..1) while it runs, else null
 * @param {number|null} phase.landed seconds since the ride landed, or null before it has
 * @param {number} phase.seconds the move's length
 */
export function arrivalMoveWeight({ travel, landed, seconds }) {
    if (landed !== null && landed !== undefined) return 1 - smootherstep(landed / Math.max(0.1, seconds));
    if (travel === null || travel === undefined) return 0;
    return smoothstep(ARRIVAL_MOVE_RIDE_IN, 1, travel);
}

/**
 * Start a chapter's arrival move, before its crossing begins.
 * @param {object|null} controller OdysseyCameraController
 * @param {number} chapterId the chapter being arrived in
 * @param {{reducedMotion?: boolean}} [options]
 * @returns {boolean} whether the chapter has a move and it was started
 */
export function beginChapterArrivalMove(controller, chapterId, { reducedMotion = false } = {}) {
    const spec = CHAPTER_ARRIVAL_MOVES[chapterId];
    if (!controller || !spec || reducedMotion || controller.prefersReducedMotion?.() === true) {
        if (controller) controller.arrivalMove = null;
        return false;
    }
    controller.arrivalMove = {
        spec, travel: null, landedAt: null, releasing: false, release: 1, weight: 0,
    };
    return true;
}

/** The crossing is over (however it ended): the move comes round from here. */
export function landChapterArrivalMove(controller, now = performance.now()) {
    const move = controller?.arrivalMove;
    if (move && move.landedAt === null) move.landedAt = now;
}

/** Let the move go (the chapter begins, or the player goes to the map): it eases out. */
export function endChapterArrivalMove(controller) {
    if (controller?.arrivalMove) controller.arrivalMove.releasing = true;
}

/**
 * Lay this frame's share of the move on the aimed camera. Call last in the controller's update,
 * after lookAt and the look-around's turn.
 * @param {object} controller OdysseyCameraController
 * @param {number} deltaTime seconds
 * @param {number} [now] ms
 * @returns {number} the weight applied (0: nothing)
 */
export function applyArrivalMove(controller, deltaTime, now = performance.now()) {
    const move = controller.arrivalMove;
    if (!move) return 0;
    const travel = controller.pathTravel;
    if (!move.travel && move.landedAt === null && travel?.active) {
        if (travel.plunge) {
            // The dive into the hole is its own arrival.
            controller.arrivalMove = null;
            return 0;
        }
        move.travel = travel;
        // The lens widens through the crossing and closes as the gaze comes round: one hump
        // whose fullest is about where the ride lands.
        controller.triggerFovPulse?.('expand', {
            amount: move.spec.fovDeg,
            duration: travel.duration / 1000 + move.spec.seconds * 0.8,
        });
    }
    if (move.travel && !move.travel.active) landChapterArrivalMove(controller, now);
    // Anything else that takes the camera lets the move go.
    const foreign = controller.mode !== 'follow' || controller.portalApproach?.active
        || (controller.isAnimating && controller.animationKind !== 'path-travel')
        || controller.prefersReducedMotion?.() === true;
    if (foreign) move.releasing = true;
    if (move.releasing) {
        move.release = Math.max(0, move.release - Math.max(0, deltaTime) / ARRIVAL_MOVE_RELEASE_SECONDS);
    }
    const landed = move.landedAt === null ? null : (now - move.landedAt) / 1000;
    const weight = arrivalMoveWeight({
        travel: move.travel?.active ? Math.min(1, move.travel.elapsed / move.travel.duration) : null,
        landed,
        seconds: move.spec.seconds,
    }) * move.release * move.release * (3 - 2 * move.release);
    move.weight = weight;
    if ((landed !== null && landed >= move.spec.seconds) || move.release <= 0) {
        controller.arrivalMove = null;
        return 0;
    }
    if (weight <= 1e-5 || !controller.camera) return 0;
    const { yawDeg, pitchDeg, rollDeg } = move.spec;
    const { degToRad } = THREE.MathUtils;
    // Pan, then tilt, then roll, about the camera's own axes: real degrees on the aimed view.
    if (yawDeg) controller.camera.rotateY(degToRad(yawDeg) * weight);
    if (pitchDeg) controller.camera.rotateX(degToRad(pitchDeg) * weight);
    if (rollDeg) controller.camera.rotateZ(degToRad(rollDeg) * weight);
    return weight;
}
