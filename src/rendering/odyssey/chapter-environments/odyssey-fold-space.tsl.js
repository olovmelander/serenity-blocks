/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE FOLD — chapter 7's other dimension (2026-10-26; eight places since the masterpiece pass,
 * 2026-11-17).
 *
 * Olov: "I want it to feel like we are in another dimension within this chapter. Visually
 * stunning, trippy and an amazing feeling travelling through this chapter." Past the horizon the
 * black hole is a door, not a tunnel: the eye comes out into a space with rules of its own, and
 * every orb inside sits in a different PLACE of it (odyssey-fold-places.tsl.js: a tide of colour
 * overhead, a lattice winding through itself, a storm-lit nave, a flock, stairs with three downs,
 * the inside of a jewel, strokes of paint, and the hall that straightens into the city).
 *
 * THIS FILE is the room the eye is in and how one room gives way to the next:
 *  - the view ray is turned into the room's frame (`turn`: the look-around's turn taken back out,
 *    so the room stays where it is while the eye looks about in it);
 *  - ONE place is drawn per pixel. While the space folds from a room into the next, the new room
 *    OPENS THROUGH the old one from its door (a direction in the view) in a widening wave, as the
 *    fold itself opened at the crossing: inside the wave the new place, outside it the old, a
 *    thin rim of light split into its colours between them. Each pixel walks only the place it
 *    shows (a per-pixel branch: the places take no screen derivative), so a room half open costs
 *    what a whole one does.
 *
 * Inline TSL (call inside a Fn).
 */
import * as THREE from 'three/webgpu';
import {
    If,
    Loop,
    acos,
    cameraProjectionMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    int,
    mix,
    normalize,
    screenSize,
    smoothstep,
    step,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';
import { hash21 } from './shared/odyssey-tsl-noise.js';
import { CH7_FOLD_PLACE_BUILDERS } from './odyssey-fold-places.tsl.js';

export { CH7_FOLD_PLACES, CH7_FOLD_PLACE } from './odyssey-fold-places.tsl.js';

export const CH7_FOLD = Object.freeze({
    /** Walk steps per pixel on High (the quality tiers pass their own: CH7_QUALITY_TIERS.foldSteps). */
    steps: 32,
    /** World units travelled per unit of the warp drive's phase. */
    travel: 0.85,
    /**
     * How a room opens through the last: the wave runs out from the door to `reach` radians (past
     * the frame's far corner from any door), its front `width` wide, with a rim of light `edge`
     * wide and `front` strong.
     */
    wave: Object.freeze({
        reach: 2.1, width: 0.075, edge: 0.014, front: 0.42,
    }),
});

/**
 * The room's uniforms (written each frame from odyssey-fold-rooms.js and odyssey-fold-clock.js).
 *  placeA, placeB, morph   the place the eye is in, the next, and how far the next has opened
 *  door                    where the next room opens from (unit, in the view: +z ahead)
 *  turn                    the view's turn into the room's frame
 *  exit                    how far the room is the way out (its light at the end shows)
 *  straight                how far the hall has straightened into the city's grid (the way out)
 *  pour                    the mouth's angle (rad): the city's light pours in from it (the way out)
 *  mood                    the clock's three slow moods (0..1)
 *  event                   the happening: strength, age (s), seed, quarter turns made
 *  flash                   flashScale(): what a frame-wide brightening keeps (ADR-0021)
 */
export function createFoldRoomUniforms() {
    return {
        placeA: uniform(0),
        placeB: uniform(0),
        morph: uniform(0),
        door: uniform(new THREE.Vector3(0, 0, 1)),
        turn: uniform(new THREE.Matrix3()),
        exit: uniform(0),
        straight: uniform(0),
        pour: uniform(0),
        mood: uniform(new THREE.Vector3(0.5, 0.5, 0.5)),
        event: uniform(new THREE.Vector4(0, 0, 0, 0)),
        flash: uniform(1),
    };
}

/**
 * THE FOLD's colour for one view ray (linear; call inside a Fn).
 * @param {object} o
 * @param {*} o.ray the view ray in the hole's frame (+Z toward the eye, so forward is -Z)
 * @param {*} o.time seconds
 * @param {*} o.phase the warp drive's travelled distance
 * @param {*} [o.motion] 0 under reduced motion (nothing turns or drifts by the clock)
 * @param {number} [o.steps] walk steps (the tier's)
 * @param {object} [o.room] createFoldRoomUniforms()
 * @returns {*} vec3 node
 */
export function foldSpaceColour({
    ray, time, phase, motion = float(1), steps = CH7_FOLD.steps, room = null,
}) {
    const R = room ?? createFoldRoomUniforms();
    const V = CH7_FOLD;
    // ROOT-PINNED before every branch: what more than one place reads.
    const view = normalize(vec3(ray.x, ray.y, ray.z.negate())).toVar('fvView');
    const rd = normalize(R.turn.mul(view)).toVar('fvRd');
    const tm = time.mul(motion).toVar('fvTime');
    const zEye = phase.mul(V.travel).toVar('fvEye');
    // One pixel's angle (radians), for line widths: from the lens, never a screen derivative.
    const pix = float(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y)).toVar('fvPix');
    // A fixed random fraction of a step for each ray (by its direction, so it holds on the scene).
    const jitter = hash21(vec2(view.x.mul(731.7).add(view.z.mul(113.1)), view.y.mul(1931.3))).toVar('fvJitter');

    // ── THE NEXT ROOM OPENING THROUGH THIS ONE ──
    const W = V.wave;
    const theta = acos(clamp(dot(view, R.door), -1.0, 1.0)).toVar('fvTheta');
    const wave = R.morph.mul(W.reach + W.width).sub(W.width).toVar('fvWave');
    const inNext = float(1).sub(smoothstep(wave.sub(W.width), wave.add(W.width), theta))
        .mul(step(0.0005, R.morph)).toVar('fvInNext');
    const out = vec3(0).toVar('fvOut');
    const ctx = {
        rd,
        tm,
        zEye,
        pix,
        jitter,
        mood: R.mood,
        event: R.event.x,
        eventAge: R.event.y,
        eventSeed: R.event.z,
        turns: R.event.w,
        flash: R.flash,
        straight: R.straight,
        pour: R.pour,
        steps,
    };
    Loop({
        start: int(0), end: int(2), type: 'int', condition: '<', name: 'fvSide',
    }, ({ fvSide }) => {
        const second = float(fvSide).toVar('fvSecond');
        const kind = mix(R.placeA, R.placeB, second).toVar('fvKind');
        const weight = mix(float(1).sub(inNext), inNext, second).toVar('fvWeight');
        If(weight.greaterThan(0.003), () => {
            const col = vec3(0).toVar('fvCol');
            CH7_FOLD_PLACE_BUILDERS.forEach((place, id) => {
                If(kind.greaterThan(id - 0.5).and(kind.lessThan(id + 0.5)), () => {
                    col.assign(place(ctx));
                });
            });
            out.addAssign(col.mul(weight));
        });
    });
    // The wave's front: the rim of a lens, a thin edge of light split into its colours (violet
    // inside, red out), lit only while the wave is under way.
    const off = theta.sub(wave).div(W.edge);
    const live = smoothstep(0.0, 0.05, R.morph).mul(float(1).sub(smoothstep(0.62, 0.8, R.morph)));
    const spectrum = vec3(0.5).add(vec3(0.5).mul(cos(off.mul(0.9).add(vec3(0.0, 2.1, 4.2)))));
    const rim = spectrum.mul(exp(off.mul(off).negate())).mul(live).mul(W.front);
    return out.add(rim);
}

export default foldSpaceColour;
