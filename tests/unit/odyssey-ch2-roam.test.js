/**
 * THE OCEAN'S ANIMALS ROAM (2026-10-24). Olov: "i dont want the big fishes to follow the movement
 * of the camera, i just want them to swim around freely and so they can be seen when we are moving
 * along the journey!"
 *
 * Each animal swims its own route in the world on the clock alone (odyssey-ocean-roam.js); the
 * camera moves past them. Played here on the real camera over the journey's own drift up the
 * ocean (Act I drifts ~4.1 u/s) from eight clock phases, since the clock is wherever the player's
 * time has put it when they reach the sea.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    OCEAN_ROAM, roamAt, roamLane,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 0.2;
const DRIFT = 4.1; // u/s along the path: Act I's idle drift
const PATH_LENGTH = 2533;
const PHASES = [0, 17, 33, 52, 71, 94, 117, 139];
const ROUTES = {
    whaleShark: OCEAN_ROAM.whaleShark,
    manta: OCEAN_ROAM.manta,
    mother: OCEAN_ROAM.whales,
    calf: roamLane(OCEAN_ROAM.whales, WHALE_PASS_PAIR.calf),
};
const SIZES = {
    whaleShark: 46, manta: 24, mother: 58, calf: 26,
};
/** How far from the eye each keeps (its body clear of the lens), and under the surface. */
const CLEAR = {
    whaleShark: 45, manta: 30, mother: 55, calf: 36,
};
const UNDER = {
    whaleShark: 9, manta: 4, mother: 9, calf: 7,
};
const APART = [
    ['whaleShark', 'mother', 62], ['whaleShark', 'calf', 45], ['whaleShark', 'manta', 42],
    ['mother', 'manta', 50], ['calf', 'manta', 34],
];
const NAMES = Object.keys(ROUTES);

describe("chapter 2's sea life roams its own sea (real camera, the drift's pace)", () => {
    const rig = createOdysseyCameraRig();
    const [c1, c2] = [rig.cp[1], rig.cp[2]];
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(rig.camera.fov / 2));
    const pose = (p) => {
        const camera = rig.poseAt(p).clone();
        camera.aspect = 16 / 9;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        return camera;
    };
    const place = (name, t) => {
        const at = roamAt(ROUTES[name], t, { x: 0, y: 0, z: 0 });
        return new THREE.Vector3(at.x, at.y, at.z);
    };
    const onScreen = (camera, point, size = 1) => {
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const ahead = point.clone().sub(camera.position).dot(forward) > 0;
        const ndc = point.clone().project(camera);
        const length = (size / point.distanceTo(camera.position)) / (2 * tanHalf);
        return {
            ndc, length, in: ahead && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95,
        };
    };

    /** The drift up the ocean: the eye at each step, and the orbs ahead of it. */
    const drift = (() => {
        const out = [];
        for (let p = c1 + 0.004; p < c2 - 0.003; p += (DRIFT / PATH_LENGTH) * DT) {
            const orbs = rig.layout.levelPositions.filter((x) => x > p - 0.004 && x < p + 0.03)
                .map((x) => getOdysseyPathPointAt(x));
            out.push({ p, camera: pose(p), orbs });
        }
        return out;
    })();
    const parks = [6, 8, 9, 10].map((id) => ({
        id,
        camera: pose(rig.parkOf(id)),
        orb: getOdysseyPathPointAt(rig.layout.levelPositionsById[id]),
    }));

    it('keeps something big in frame along the whole drift, whatever the clock', () => {
        const shares = PHASES.map((t0) => drift.filter((f, i) => NAMES
            .some((n) => onScreen(f.camera, place(n, t0 + (i * DT))).in)).length / drift.length);
        expect(Math.min(...shares)).toBeGreaterThan(0.75);
        expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeGreaterThan(0.85);
        // ...and in every stretch of the climb (the deep, the bend, under the surface).
        const sixths = [0, 1, 2, 3, 4, 5].map((k) => {
            const lo = Math.floor((drift.length * k) / 6);
            const hi = Math.floor((drift.length * (k + 1)) / 6);
            let seen = 0;
            PHASES.forEach((t0) => {
                for (let i = lo; i < hi; i += 1) {
                    if (NAMES.some((n) => onScreen(drift[i].camera, place(n, t0 + (i * DT))).in)) seen += 1;
                }
            });
            return seen / (PHASES.length * (hi - lo));
        });
        sixths.forEach((s, k) => expect(s, `stretch ${k}`).toBeGreaterThan(0.7));
    });

    it('lets every animal be seen for a fair share of the drift', () => {
        NAMES.forEach((n) => {
            let seen = 0;
            PHASES.forEach((t0) => drift.forEach((f, i) => {
                if (onScreen(f.camera, place(n, t0 + (i * DT))).in) seen += 1;
            }));
            expect(seen / (PHASES.length * drift.length), n).toBeGreaterThan(0.25);
        });
    });

    it('keeps one in frame at the orbs the eye parks at', () => {
        const expected = {
            6: 0.9, 8: 0.9, 9: 0.5, 10: 0.9,
        };
        parks.forEach(({ id, camera }) => {
            let any = 0;
            let n = 0;
            for (let t = 0; t < 300; t += 1) {
                n += 1;
                if (NAMES.some((name) => onScreen(camera, place(name, t)).in)) any += 1;
            }
            expect(any / n, `orb ${id}`).toBeGreaterThan(expected[id]);
        });
    });

    it('never covers the orb ahead, and reads at a sensible size', () => {
        NAMES.forEach((n) => {
            let shown = 0;
            let over = 0;
            PHASES.forEach((t0) => drift.forEach((f, i) => {
                const s = onScreen(f.camera, place(n, t0 + (i * DT)), SIZES[n]);
                if (!s.in) return;
                shown += 1;
                expect(s.length, `${n} at p=${f.p.toFixed(4)}`).toBeGreaterThan(0.1);
                expect(s.length, `${n} at p=${f.p.toFixed(4)}`).toBeLessThan(0.9);
                if (f.orbs.some((o) => {
                    const so = onScreen(f.camera, o);
                    return so.in && Math.hypot((so.ndc.x - s.ndc.x) * (16 / 9), so.ndc.y - s.ndc.y) < s.length * 0.6;
                })) over += 1;
            }));
            expect(over / shown, `${n} over an orb`).toBeLessThan(0.02);
        });
    });

    it('keeps clear of the eye on the drift and at every park, and of each other', () => {
        const eyes = [...drift.map((f) => f.camera), ...parks.map((k) => k.camera)];
        for (let t = 0; t < 400; t += 0.5) {
            const at = Object.fromEntries(NAMES.map((n) => [n, place(n, t)]));
            NAMES.forEach((n) => {
                const nearest = Math.min(...eyes.map((c) => c.position.distanceTo(at[n])));
                expect(nearest, `${n} at t=${t}`).toBeGreaterThan(CLEAR[n]);
            });
            APART.forEach(([a, b, min]) => expect(at[a].distanceTo(at[b]), `${a}/${b} at t=${t}`).toBeGreaterThan(min));
        }
    });

    it('swims under the surface, and loops round enough to turn like an animal its size', () => {
        NAMES.forEach((n) => {
            const r = ROUTES[n];
            let tightest = Infinity;
            let slowest = Infinity;
            const h = 0.25;
            for (let t = 0; t < 600; t += h) {
                const a = place(n, t - h);
                const b = place(n, t);
                const c = place(n, t + h);
                expect(b.y, `${n} at t=${t}`).toBeLessThan(ODYSSEY_SEA_LEVEL - UNDER[n]);
                // The radius of its path in the water's plane (it swims mostly level).
                const v = new THREE.Vector2(c.x - a.x, c.z - a.z).divideScalar(2 * h);
                const acc = new THREE.Vector2(c.x - (2 * b.x) + a.x, c.z - (2 * b.z) + a.z).divideScalar(h * h);
                const bend = Math.abs((v.x * acc.y) - (v.y * acc.x));
                if (bend > 1e-9) tightest = Math.min(tightest, (v.length() ** 3) / bend);
                slowest = Math.min(slowest, v.length());
            }
            expect(tightest, `${n} turn radius`).toBeGreaterThan(0.3 * SIZES[n]);
            // Its pace swells and slackens but it never stops.
            expect(slowest, `${n} slowest`).toBeGreaterThan(0.3 * r.speed);
        });
    });
});
