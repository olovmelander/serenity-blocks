/**
 * THE SWALLOW FLY-BY (2026-11-03, composition/odyssey-swallow-flyby.js): now and then one barn
 * swallow sweeps up the meadow past the orbs' seats L16-L24 and is gone.
 *
 *  - WHERE: clear of every seat's eye (each orb's rail point + (0, 1.8, 10.2)), of the rail's
 *    glide camera, of the rail and the orbs, of the ground and the tree crowns; it enters and
 *    leaves out of every seat's frame and every glide camera's in the swallows' window.
 *  - WHEN: 90-190 s apart, each pass inside its own period; shown only if it starts with the
 *    camera in the meadow (never popping in mid-pass).
 *  - HOW: a C2 route at an even speed, no corner in its path or its bank; bursts of beats with
 *    glides through the swerves; one more instance in the swallows' draw (none with the lever).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import {
    FLIGHT_KIND, createOdysseyFlights, flightFrameAt, resolveFlightLanes, birdBeatOf,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import {
    ODYSSEY_SWALLOW_FLYBY, createSwallowFlybyArming, swallowFlybyDuration, swallowFlybyPassAt, swallowFlybyPointAt,
} from '../../src/rendering/odyssey/composition/odyssey-swallow-flyby.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';

const CFG = ODYSSEY_SWALLOW_FLYBY;
const S = CFG.route.length - 3;
const D = swallowFlybyDuration();
const rig = createOdysseyCameraRig();
const route = Array.from({ length: 1201 }, (_, k) => new THREE.Vector3(...swallowFlybyPointAt((k / 1200) * S)));

/** The seated camera at orb `id`: 10.2 u behind its rail point, 1.8 u above, looking at it. */
function seat(id) {
    const orb = getOdysseyPathPointAt(rig.layout.levelPositionsById[id]);
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 40000);
    cam.position.set(orb.x, orb.y + 1.8, orb.z + 10.2);
    cam.lookAt(orb.x, orb.y, orb.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return { cam, orb: new THREE.Vector3(orb.x, orb.y, orb.z) };
}
const SEATS = [16, 17, 18, 19, 20, 21, 22, 23, 24].map(seat);

describe('the swallow fly-by: where it flies', () => {
    it('keeps clear of every seat\'s eye and orb, the glide camera and the rail', () => {
        let eye = Infinity;
        let orb = Infinity;
        SEATS.forEach((s) => route.forEach((q) => {
            eye = Math.min(eye, q.distanceTo(s.cam.position));
            orb = Math.min(orb, q.distanceTo(s.orb));
        }));
        expect(eye, 'eye').toBeGreaterThan(15);
        expect(eye, 'eye').toBeLessThan(25); // it does come near: that is the point
        expect(orb, 'orb').toBeGreaterThan(15);
        const ps = Array.from({ length: 70 }, (_, k) => 0.196 + (k * 0.002));
        const cams = ps.map((p) => rig.poseAt(p).position.clone());
        const rails = ps.map((p) => { const r = getOdysseyPathPointAt(p); return new THREE.Vector3(r.x, r.y, r.z); });
        const nearest = (pts) => Math.min(...pts.map((c) => Math.min(...route.map((q) => q.distanceTo(c)))));
        const glide = nearest(cams);
        const rail = nearest(rails);
        expect(glide, 'glide camera').toBeGreaterThan(15);
        expect(rail, 'rail').toBeGreaterThan(15);
    });

    it('flies over the ground and the tree crowns', () => {
        const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const trees = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, spacing: 15 }).placements
            .filter((t) => t.x > -560 && t.x < 0 && t.z > -560 && t.z < 0);
        let ground = Infinity;
        let crowns = Infinity;
        route.forEach((q) => {
            ground = Math.min(ground, q.y - odysseyWorldHeight(q.x, q.z));
            trees.forEach((t) => {
                // A generous crown: 5 u x its spread across, 28 u x its height tall.
                if (Math.hypot(t.x - q.x, t.z - q.z) < (5 * t.scaleXZ) + 3) crowns = Math.min(crowns, q.y - (t.y + (28 * t.scaleY)));
            });
        });
        expect(ground).toBeGreaterThan(30);
        expect(crowns).toBeGreaterThan(3);
    });

    it('comes into every seat\'s frame big, and starts and ends out of every frame', () => {
        const inFrame = (cam, q) => rig.inFrame(cam, q);
        SEATS.forEach((s, k) => {
            const seen = route.filter((q) => inFrame(s.cam, q));
            expect(seen.length, `L${16 + k} sees it`).toBeGreaterThan(20);
            // Wingspan 2.0 u: in frame nearer than ~50 u it is over ~50 px across at 1440p; it
            // passes the eye itself (just out of frame) within 30 u.
            const nearest = Math.min(...seen.map((q) => q.distanceTo(s.cam.position)));
            expect(nearest, `L${16 + k} sees it near`).toBeLessThan(50);
            const passes = Math.min(...route.map((q) => q.distanceTo(s.cam.position)));
            expect(passes, `L${16 + k} passed near`).toBeLessThan(30);
            expect(inFrame(s.cam, route[0]), `L${16 + k} start`).toBe(false);
            expect(inFrame(s.cam, route[route.length - 1]), `L${16 + k} end`).toBe(false);
        });
        for (let p = 0.196; p <= 0.334; p += 0.002) {
            const cam = rig.poseAt(p);
            expect(inFrame(cam, route[0]), `glide p=${p.toFixed(3)} start`).toBe(false);
            expect(inFrame(cam, route[route.length - 1]), `glide p=${p.toFixed(3)} end`).toBe(false);
        }
    });
});

describe('the swallow fly-by: when', () => {
    it('passes 90-190 s apart, each pass inside its own period', () => {
        expect(D).toBeGreaterThan(15);
        expect(D).toBeLessThan(30);
        const starts = [];
        for (let n = 0; n < 300; n += 1) {
            const pass = swallowFlybyPassAt((n * CFG.period) + 1);
            expect(pass.start).toBeGreaterThanOrEqual(n * CFG.period);
            expect(pass.start + D).toBeLessThan((n + 1) * CFG.period);
            starts.push(pass.start);
        }
        const gaps = starts.slice(1).map((s, i) => s - starts[i]);
        expect(Math.min(...gaps)).toBeGreaterThan(90);
        expect(Math.max(...gaps)).toBeLessThan(190);
    });

    it('is shown only for a pass that starts with the camera in the meadow, never popping in mid-pass', () => {
        const t0 = swallowFlybyPassAt(1).start;
        const inMeadow = createSwallowFlybyArming();
        inMeadow.step(t0 - 0.03, 0.26);
        expect(inMeadow.step(t0 + 0.01, 0.26)).toBe(true);
        expect(inMeadow.step(t0 + 5, 0.40)).toBe(true); // flies on to its end, the camera gone
        expect(inMeadow.step(t0 + D + 0.1, 0.40)).toBe(false);
        const elsewhere = createSwallowFlybyArming();
        elsewhere.step(t0 - 0.03, 0.15);
        expect(elsewhere.step(t0 + 0.01, 0.15)).toBe(false);
        expect(elsewhere.step(t0 + 2, 0.26)).toBe(false); // the camera arrived mid-pass: still hidden
        const joined = createSwallowFlybyArming();
        expect(joined.step(t0 + 3, 0.26)).toBe(false); // the board woke mid-pass
        // The draw: the swallows' mesh stays on while an armed pass flies, even out of their window.
        const flights = createOdysseyFlights();
        flights.update(t0 - 0.03, 0.26);
        flights.update(t0 + 0.01, 0.26);
        expect(flights.flybyArmed).toBe(true);
        flights.update(t0 + 1, 0.36);
        expect(flights.meshes[1].visible).toBe(true);
        flights.update(t0 + D + 1, 0.36);
        expect(flights.meshes[1].visible).toBe(false);
        flights.dispose();
    });
});

describe('the swallow fly-by: how it flies', () => {
    const lane = resolveFlightLanes().find((l) => l.flyby);
    const t0 = swallowFlybyPassAt(1).start;
    const worstAcc = (f, a, b, h) => {
        let worst = 0;
        for (let t = a + h; t < b - h; t += h) worst = Math.max(worst, Math.abs((f(t - h) - (2 * f(t)) + f(t + h)) / (h * h)));
        return worst;
    };
    const corner = (f) => worstAcc(f, t0 + 0.5, t0 + D - 0.5, 1 / 960) / worstAcc(f, t0 + 0.5, t0 + D - 0.5, 1 / 240);

    it('flies an even ~38 u/s with no corner in its path or its bank', () => {
        const speeds = [];
        for (let t = t0 + 0.2; t < t0 + D - 0.2; t += 0.1) {
            const a = flightFrameAt(lane, t).position;
            const b = flightFrameAt(lane, t + 0.05).position;
            speeds.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.05);
        }
        expect(Math.min(...speeds)).toBeGreaterThan(30);
        expect(Math.max(...speeds)).toBeLessThan(45);
        [0, 1, 2].forEach((k) => expect(corner((t) => flightFrameAt(lane, t).position[k])).toBeLessThan(1.3));
        expect(corner((t) => flightFrameAt(lane, t).bank)).toBeLessThan(1.3);
        // It banks hard in its swerves (a swallow snapping an insect), softly limited.
        const banks = [];
        for (let t = t0; t < t0 + D; t += 0.1) banks.push(Math.abs(flightFrameAt(lane, t).bank));
        expect(Math.max(...banks)).toBeGreaterThan(0.8);
        expect(Math.max(...banks)).toBeLessThan(1.0);
    });

    it('beats in bursts and glides swept through its swerves', () => {
        let beating = 0;
        let n = 0;
        for (let t = t0; t < t0 + D; t += 0.1) { beating += birdBeatOf(lane, t).weight; n += 1; }
        expect(beating / n).toBeGreaterThan(0.2);
        expect(beating / n).toBeLessThan(0.7);
    });

    it('is one more instance in the swallows\' draw, and none with the lever', () => {
        const flights = createOdysseyFlights();
        expect(flights.meshes[1].geometry.instanceCount).toBe(13);
        expect(flights.lanes.filter((l) => l.flyby)).toHaveLength(1);
        expect(flights.lanes.find((l) => l.flyby).kind).toBe(FLIGHT_KIND.SWALLOW);
        flights.dispose();
        const without = createOdysseyFlights({ flyby: null });
        expect(without.meshes[1].geometry.instanceCount).toBe(12);
        expect(without.lanes.some((l) => l.flyby)).toBe(false);
        without.dispose();
    });
});
