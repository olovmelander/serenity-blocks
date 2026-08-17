import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { CameraDirector } from '../../src/themes/starlight/composition/camera-director.js';

/**
 * Starlight impact shake — the perceptual contract.
 *
 * The unit that matters is not the raw amplitude but the VIEW ROTATION it produces:
 * shake() offsets the camera position and the subsequent lookAt() re-aims at the focal
 * point, so a distant sky (this theme's entire subject) moves by ~atan(amp / 14u). The
 * shipped ladder previously sat at 0.012u ≈ 0.05° ≈ 1.3 px at 1080p — below the
 * perceptual floor, which is why locks and combos read as no shake at all. These tests
 * pin the band, not the exact numbers, so the art can be retuned without churn.
 */

const RIG_FOV = 40; // degrees, vertical — matches StarlightTheme's camera
const degOf = (rad) => (rad * 180) / Math.PI;

function makeDirector() {
    const camera = new THREE.PerspectiveCamera(RIG_FOV, 16 / 9, 0.1, 600);
    // Pin the Lissajous idle float so a shaken run and an unshaken control share one
    // trajectory and their difference IS the shake.
    const director = new CameraDirector(camera, new THREE.Vector3(0, 0, 0), { idlePhase: 0 });
    director.snapToRest();
    return { camera, director };
}

/**
 * Step a shaken director against an identical unshaken control, returning the peak
 * positional offset and the peak view rotation (position re-aim + roll) between them.
 */
function measure(amplitude, durationMs, { dt = 1 / 60, frames = 90 } = {}) {
    const shaken = makeDirector();
    const control = makeDirector();
    shaken.director.shake(amplitude, durationMs);

    let peakOffset = 0;
    let peakRotationDeg = 0;
    let maxFrameStep = 0;
    const offsets = [];
    let previous = new THREE.Vector3();

    for (let i = 0; i < frames; i += 1) {
        shaken.director.update(dt);
        control.director.update(dt);
        const offset = shaken.camera.position.clone().sub(control.camera.position);
        peakOffset = Math.max(peakOffset, offset.length());
        peakRotationDeg = Math.max(
            peakRotationDeg,
            degOf(shaken.camera.quaternion.angleTo(control.camera.quaternion)),
        );
        // Skip the step INTO frame 0: an impact starts at full amplitude by design, and
        // that attack transient is not what "continuous" is claiming about.
        if (i > 0) maxFrameStep = Math.max(maxFrameStep, offset.clone().sub(previous).length());
        previous = offset;
        offsets.push([offset.x, offset.y]);
    }

    const settledOffset = shaken.camera.position.distanceTo(control.camera.position);
    const settledRotationDeg = degOf(shaken.camera.quaternion.angleTo(control.camera.quaternion));
    return {
        peakOffset, peakRotationDeg, maxFrameStep, settledOffset, settledRotationDeg, offsets,
    };
}

describe('Starlight CameraDirector — impact shake', () => {
    it('moves the camera by about the requested amplitude, then settles completely', () => {
        const m = measure(0.2, 150);
        // Both axes can peak together, so the ceiling is amp*sqrt(2).
        expect(m.peakOffset).toBeGreaterThan(0.2 * 0.5);
        expect(m.peakOffset).toBeLessThanOrEqual(0.2 * Math.SQRT2 + 1e-9);
        // 90 frames at 60 Hz is 1.5 s — long past a 150 ms shake.
        expect(m.settledOffset).toBeLessThan(1e-9);
        // quaternion.angleTo() is an acos, so it bottoms out in float noise around 1e-6°
        // — five orders of magnitude below the ~0.1° perceptual floor.
        expect(m.settledRotationDeg).toBeLessThan(1e-3);
    });

    it('puts a lock tap and a combo slam in their intended perceptual bands', () => {
        // A lock fires on EVERY piece, so it must register without becoming a jolt:
        // a fraction of a degree, a handful of pixels at 1080p.
        const lock = measure(0.045, 90);
        expect(lock.peakRotationDeg).toBeGreaterThan(0.1);
        expect(lock.peakRotationDeg).toBeLessThan(0.6);

        // The biggest cue in the game (combo apex / perfect clear) lands a real slam
        // while staying far below anything nauseating.
        const apex = measure(0.3, 190);
        expect(apex.peakRotationDeg).toBeGreaterThan(1.0);
        expect(apex.peakRotationDeg).toBeLessThan(3.5);

        // Ordering: the ladder is monotonic in amplitude.
        expect(apex.peakRotationDeg).toBeGreaterThan(lock.peakRotationDeg * 3);
    });

    it('is a continuous oscillation, not per-frame white noise', () => {
        // The tell: with a continuous signal, halving the timestep roughly halves the
        // frame-to-frame jump. Per-frame Math.random() jitter keeps jumping the full
        // amplitude no matter how fine the steps get.
        const at60 = measure(0.2, 300, { dt: 1 / 60, frames: 30 });
        const at144 = measure(0.2, 300, { dt: 1 / 144, frames: 72 });
        expect(at144.maxFrameStep).toBeLessThan(at60.maxFrameStep * 0.75);

        // ...and the peak the viewer actually sees is refresh-rate independent.
        expect(at144.peakOffset).toBeGreaterThan(at60.peakOffset * 0.8);
    });

    it('lets a stronger shake take over but never lets a weaker one cut it short', () => {
        const { director } = makeDirector();
        director.shake(0.05, 120);
        expect(director.currentShakeAmplitude()).toBeCloseTo(0.05, 6);

        director.shake(0.02, 120); // weaker — ignored
        expect(director.currentShakeAmplitude()).toBeCloseTo(0.05, 6);

        director.shake(0.3, 200); // stronger — takes over
        expect(director.currentShakeAmplitude()).toBeCloseTo(0.3, 6);

        director.update(1 / 60);
        expect(director.currentShakeAmplitude()).toBeLessThan(0.3); // decaying
        expect(director.currentShakeAmplitude()).toBeGreaterThan(0);
    });

    it('is deterministic, so phase-locked ?t= captures stay reproducible', () => {
        expect(measure(0.2, 150).offsets).toEqual(measure(0.2, 150).offsets);
    });

    it('snapToRest rewinds the idle float, so a replayed seek lands on one framing', () => {
        // The playground replays a seek by snapToRest()-ing and re-stepping from 0. If
        // the Lissajous float kept accumulating across replays, the same ?t= would frame
        // the sky differently every time — up to the full ±0.25u idle amplitude.
        const { camera, director } = makeDirector();
        // Replay a run that FIRES shakes and samples mid-shake: the idle float, the
        // envelope and the per-trigger oscillator phase must all rewind together.
        const replay = (frames) => {
            director.snapToRest();
            const trace = [];
            for (let i = 0; i < frames; i += 1) {
                if (i === 10 || i === 40) director.shake(0.2, 150);
                director.update(1 / 60);
                trace.push([camera.position.x, camera.position.y, camera.quaternion.z]);
            }
            return trace;
        };
        expect(replay(120)).toEqual(replay(120));
        // ...and a shorter intervening run must not shift the next replay (the bug:
        // counters that survive snapToRest make the result depend on prior seeks).
        const first = replay(120);
        replay(37);
        expect(replay(120)).toEqual(first);
    });

    it('snapToRest cancels a shake in flight', () => {
        const { camera, director } = makeDirector();
        director.shake(0.3, 200);
        director.update(1 / 60);
        director.snapToRest();
        expect(director.currentShakeAmplitude()).toBe(0);
        expect(camera.position.x).toBeCloseTo(director.restPosition.x, 10);
    });
});
