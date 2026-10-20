/**
 * ACT II'S SET PIECES LEAVE ONLY WHERE THE CAMERA CANNOT SEE THEM (2026-10-20, in-game feedback:
 * "the rainbow and the eagle disappear too early — keep them until we have moved past").
 *
 * Both were faded on round-number progress windows, and both faded in plain view:
 *  - the bow faded over L21 -> L22 with two thirds of it on screen, and L21 (framed for "the bow
 *    beyond") parked on it at 78 %;
 *  - the eagle faded over p 0.386-0.404 with its whole thermal in frame, so the player parked at
 *    L28 watched it dissolve to 15 % in the middle of the picture.
 * The same audit moved the swallows (shrank with a third of them in view) and the summit kettle
 * (faded with a quarter in view). NOT the geese: their crossing stays in view up the wall to
 * p ~0.384, but held that long the skein passes ~6 u from the rail at p ~0.371 — they need a new
 * line, not a later fade.
 *
 * Drives the REAL OdysseyCameraController over the REAL spline with the chapter/seam feed the
 * board gives it (the settled pose — the harness of odyssey-seam-camera-continuity), and asks the
 * CPU height mirror whether the ground hides the sky. Every frame of a fade-out must show none of
 * what is fading. The frame test is padded (|ndc| < 1.1) and the fade-out is checked from a
 * little before it starts (LAG), for the camera's breathing and its lag behind its settled pose
 * in a glide (frame blend 7.2/s).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { ODYSSEY_WORLD_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_BOW, antisolarSchedule } from '../../src/rendering/odyssey/world/odyssey-sky-optics.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    ODYSSEY_EAGLE, eaglePoint, eagleRevealAt,
} from '../../src/rendering/odyssey/composition/odyssey-eagle-flight.js';
import {
    ODYSSEY_FLIGHTS, flightPositionAt, resolveFlightLanes,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import { SUMMIT_BIRDS } from '../../src/rendering/odyssey/composition/odyssey-summit-birds.js';

const FRAME = 1.1;
const LAG = 0.001;
const STEP = 0.0005;
const DEG = Math.PI / 180;

const createRig = createOdysseyCameraRig;
const poseAt = (rig, p) => rig.poseAt(p);
const parkOf = (rig, id) => rig.parkOf(id);

const scratch = new THREE.Vector3();
const fwd = new THREE.Vector3();

/** Whether world point `pt` is inside the (padded) frame. */
function inFrame(camera, pt) {
    camera.getWorldDirection(fwd);
    if (scratch.copy(pt).sub(camera.position).dot(fwd) <= 0) return false;
    scratch.copy(pt).project(camera);
    return Math.abs(scratch.x) < FRAME && Math.abs(scratch.y) < FRAME;
}

/** Whether world point `pt` reaches a pixel: in frame and not behind the ground. */
function pointSeen(camera, pt) {
    if (!inFrame(camera, pt)) return false;
    const eye = camera.position;
    const d = new THREE.Vector3().copy(pt).sub(eye);
    const len = d.length();
    d.divideScalar(len);
    for (let s = 2; s < len - 2; s += Math.max(2, s * 0.04)) {
        if (odysseyWorldHeight(eye.x + (d.x * s), eye.z + (d.z * s)) > eye.y + (d.y * s)) return false;
    }
    return true;
}

/** How many of the sky directions `dirs` reach a pixel: in frame and not behind the ground. */
function skySeen(camera, dirs) {
    let seen = 0;
    const far = new THREE.Vector3();
    const eye = camera.position;
    for (const d of dirs) {
        if (!inFrame(camera, far.copy(eye).addScaledVector(d, 10000))) continue;
        let hidden = false;
        for (let s = 4; s < 4000 && !hidden; s *= 1.06) {
            hidden = odysseyWorldHeight(eye.x + (d.x * s), eye.z + (d.z * s)) > eye.y + (d.y * s);
        }
        if (!hidden) seen += 1;
    }
    return seen;
}

/** Directions on the primary bow (above the horizon) and across the shower veil. */
function antisolarDirections() {
    const anti = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize().negate();
    const u = new THREE.Vector3(0, 1, 0).addScaledVector(anti, -anti.y).normalize();
    const w = new THREE.Vector3().crossVectors(anti, u).normalize();
    const r = ((ODYSSEY_BOW.primary[0] + ODYSSEY_BOW.primary[1]) / 2) * DEG;
    const bow = [];
    for (let i = 0; i < 360; i += 2) {
        const d = anti.clone().multiplyScalar(Math.cos(r))
            .addScaledVector(u, Math.sin(r) * Math.cos(i * DEG))
            .addScaledVector(w, Math.sin(r) * Math.sin(i * DEG));
        if (d.y > 0.02) bow.push(d);
    }
    // The veil: low sky round the antisolar azimuth (odyssey-sky-optics.js `across` x `low`).
    const veil = [];
    const antiAz = Math.atan2(anti.x, -anti.z);
    for (let da = -ODYSSEY_BOW.showerHalfWidth * 0.9; da <= ODYSSEY_BOW.showerHalfWidth * 0.9; da += 4) {
        for (let el = 1; el <= ODYSSEY_BOW.showerTop * 0.65; el += 2) {
            const az = antiAz + (da * DEG);
            veil.push(new THREE.Vector3(
                Math.sin(az) * Math.cos(el * DEG),
                Math.sin(el * DEG),
                -Math.cos(az) * Math.cos(el * DEG),
            ));
        }
    }
    return { bow, veil };
}

/** The progress span over which `strength(p)` falls from full to nothing (after its peak). */
function fadeOutSpan(strength, from, to) {
    let start = null;
    for (let p = from; p <= to; p += STEP) {
        const s = strength(p);
        if (start === null && s < 0.999) start = p;
        if (start !== null && s === 0) return [start, p];
    }
    throw new Error('no fade-out found');
}

describe('Act II set pieces fade only out of view (real camera, live spline, height mirror)', () => {
    const rig = createRig();
    const actT = (p) => (p - rig.cp[1]) / (rig.cp[5] - rig.cp[1]);
    const dirs = antisolarDirections();

    it('holds the bow and its shower full while L21 looks at them', () => {
        const park = parkOf(rig, 21);
        expect(antisolarSchedule(actT(park)).bow).toBeGreaterThan(0.999);
        expect(antisolarSchedule(actT(park)).veil).toBeGreaterThan(0.999);
        // ...and L21 does look at them (the guard below would be vacuous otherwise).
        expect(skySeen(poseAt(rig, park), dirs.bow)).toBeGreaterThan(10);
    });

    it('fades the bow only where no part of it reaches the screen', () => {
        const [a, b] = fadeOutSpan((p) => antisolarSchedule(actT(p)).bow, parkOf(rig, 21), rig.cp[4]);
        for (let p = a - LAG; p <= b; p += STEP) {
            expect(skySeen(poseAt(rig, p), dirs.bow), `bow seen at p=${p.toFixed(4)}`).toBe(0);
        }
    });

    it('fades the shower only where no part of it reaches the screen', () => {
        const [a, b] = fadeOutSpan((p) => antisolarSchedule(actT(p)).veil, parkOf(rig, 21), rig.cp[4]);
        for (let p = a - LAG; p <= b; p += STEP) {
            expect(skySeen(poseAt(rig, p), dirs.veil), `shower seen at p=${p.toFixed(4)}`).toBe(0);
        }
    });

    // The bird anywhere on its thermal over one round (a seek can show any of them).
    const loop = [];
    for (let s = 0; s < ODYSSEY_EAGLE.round; s += 0.5) {
        const e = eaglePoint(s);
        loop.push(new THREE.Vector3(e.x, e.y, e.z));
    }
    const birdsInFrame = (camera) => loop.filter((pt) => inFrame(camera, pt)).length;

    it('keeps the eagle full while L28 looks at it, and draws none at L29', () => {
        const l28 = parkOf(rig, 28);
        expect(eagleRevealAt(l28)).toBe(1);
        expect(birdsInFrame(poseAt(rig, l28))).toBeGreaterThan(loop.length * 0.8);
        // Past it by L29: a parked orb never draws a bird it cannot see.
        expect(eagleRevealAt(parkOf(rig, 29))).toBe(0);
    });

    it('fades the eagle only once the climb has carried its whole thermal out of frame', () => {
        const [a, b] = fadeOutSpan((p) => eagleRevealAt(p), ODYSSEY_EAGLE.window[1], rig.cp[5]);
        for (let p = a - LAG; p <= b; p += STEP) {
            expect(birdsInFrame(poseAt(rig, p)), `eagle in frame at p=${p.toFixed(4)}`).toBe(0);
        }
    });

    /** Fade-out of a progress window [a, b, c, d] (the smoothstep pair every set piece uses). */
    const windowWeight = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1])
        * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

    it('shrinks the swallows away only once neither party is in view', () => {
        const flock = ODYSSEY_FLIGHTS.findIndex((f) => f.id === 'swallows');
        const { window } = ODYSSEY_FLIGHTS[flock];
        const places = [];
        resolveFlightLanes().filter((lane) => lane.flock === flock).forEach((lane) => {
            for (let t = 0; t < 30; t += 1) {
                const q = flightPositionAt(lane, t);
                places.push(new THREE.Vector3(q.x, q.y, q.z));
            }
        });
        const [a, b] = fadeOutSpan((p) => windowWeight(window, p), window[1], rig.cp[5]);
        for (let p = a - LAG; p <= b; p += STEP) {
            const camera = poseAt(rig, p);
            const seen = places.filter((pt) => pointSeen(camera, pt)).length;
            expect(seen, `swallows seen at p=${p.toFixed(4)}`).toBe(0);
        }
    });

    it('fades the summit kettle only once the climb has carried it out of view', () => {
        // Every place a bird can be: all round the thermal, at both lane radii and both heights.
        const [cx, cy, cz] = SUMMIT_BIRDS.centre;
        const places = [];
        for (let deg = 0; deg < 360; deg += 10) {
            SUMMIT_BIRDS.radius.forEach((r) => {
                [-1, 1].forEach((h) => places.push(new THREE.Vector3(
                    cx + (Math.cos(deg * DEG) * r),
                    cy + (h * SUMMIT_BIRDS.heightSpread),
                    cz + (Math.sin(deg * DEG) * r),
                )));
            });
        }
        const { window } = SUMMIT_BIRDS;
        const [a, b] = fadeOutSpan((p) => windowWeight(window, p), window[1], rig.cp[5]);
        for (let p = a - LAG; p <= b; p += STEP) {
            const camera = poseAt(rig, p);
            const seen = places.filter((pt) => pointSeen(camera, pt)).length;
            expect(seen, `summit birds seen at p=${p.toFixed(4)}`).toBe(0);
        }
    });
});
