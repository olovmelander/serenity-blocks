/**
 * THE OCEAN'S ESCORT (2026-10-23). Olov: "i want all of them to be visible and swimming around when
 * entering the chapter and while drifting in the chapter."
 *
 * Measured on the journey's own idle drift up the ocean before this pass: each animal owned one
 * stretch of the climb (2026-10-22), so the whale shark kept company for ~20 s, the mother and calf
 * were in frame for ~4 s and the manta for ~7 s, with long stretches of nothing but fish. Now every
 * animal escorts the eye through the whole chapter from a slot in the journey's view
 * (odyssey-ocean-escort.js). Played here on the real camera at the drift's own pace (Act I drifts
 * ~4.1 u/s), with the escort stepped the way the board steps it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    OCEAN_ESCORT,
    OCEAN_ESCORT_MOTION,
    escortLoop,
    escortLoopScale,
    resolveEscortTarget,
    stepEscortAnchor,
    stepEscortFrame,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-escort.js';
import { placeEscorted } from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 1 / 20;
const DRIFT = 4.1; // u/s along the path: Act I's idle drift
const PATH_LENGTH = 2533;
const SIZES = {
    whaleShark: 46, manta: 24, mother: 58, calf: 26,
};

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
        aspect: camera.aspect,
    };
}

describe("chapter 2's sea life escorts the eye (real camera, the drift's pace)", () => {
    const rig = createOdysseyCameraRig();
    rig.camera.aspect = 16 / 9;
    const [c1, c2] = [rig.cp[1], rig.cp[2]];
    const calfLoop = {
        ...OCEAN_ESCORT.whales.loop,
        radius: WHALE_PASS_PAIR.calf.radius,
        phase: OCEAN_ESCORT.whales.loop.phase + WHALE_PASS_PAIR.calf.phaseLead,
    };

    /** One animal's place in the escort at time `t` (the anchor stepped by `dt`; 0 only reads it). */
    function place(state, view, slot, t, loop = slot.loop, lift = 0, dt = DT) {
        const target = resolveEscortTarget(view, slot, ODYSSEY_SEA_LEVEL, { x: 0, y: 0, z: 0 });
        if (dt > 0) stepEscortAnchor(state, target, dt);
        const k = escortLoopScale(view.position, target, slot);
        const off = escortLoop(loop, t, { x: 0, y: 0, z: 0 });
        return new THREE.Vector3(
            state.pos.x + (off.x * k),
            state.pos.y + ((off.y + lift) * k),
            state.pos.z + (off.z * k),
        );
    }

    /** The drift up the ocean, each animal stepped as the board steps it. */
    const frames = (() => {
        const out = [];
        const frame = {};
        const states = { whaleShark: {}, manta: {}, whales: {} };
        let t = 0;
        for (let p = c1 + 0.004; p < c2 - 0.003; p += (DRIFT / PATH_LENGTH) * DT, t += DT) {
            const camera = rig.poseAt(p);
            camera.aspect = 16 / 9;
            camera.updateProjectionMatrix();
            const view = stepEscortFrame(frame, viewOf(camera), DT);
            const animals = {
                whaleShark: place(states.whaleShark, view, OCEAN_ESCORT.whaleShark, t),
                manta: place(states.manta, view, OCEAN_ESCORT.manta, t),
                mother: place(states.whales, view, OCEAN_ESCORT.whales, t),
                calf: place(states.whales, view, OCEAN_ESCORT.whales, t, calfLoop, WHALE_PASS_PAIR.calf.above, 0),
            };
            const orbs = rig.layout.levelPositions.filter((x) => x > p - 0.004 && x < p + 0.03)
                .map((x) => getOdysseyPathPointAt(x));
            out.push({
                p, camera: camera.clone(), animals, orbs,
            });
        }
        return out;
    })();

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(rig.camera.fov / 2));
    const onScreen = (camera, point) => {
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const ahead = point.clone().sub(camera.position).dot(forward) > 0;
        const ndc = point.clone().project(camera);
        return {
            ndc, ahead, in: ahead && Math.abs(ndc.x) < 0.98 && Math.abs(ndc.y) < 0.98,
        };
    };
    const share = (name, test) => frames
        .filter((f) => test(f, onScreen(f.camera, f.animals[name]))).length / frames.length;

    it('keeps the whole cast in frame together through the deeper half of the climb', () => {
        const deep = frames.filter((f) => f.camera.position.y < 205);
        expect(deep.length).toBeGreaterThan(frames.length * 0.4);
        const together = deep.filter((f) => Object.keys(SIZES).every((n) => onScreen(f.camera, f.animals[n]).in));
        expect(together.length / deep.length).toBeGreaterThan(0.95);
    });

    it('keeps each animal in view for most of the climb (each had one stretch of it)', () => {
        expect(share('whaleShark', (f, s) => s.in)).toBeGreaterThan(0.75);
        expect(share('manta', (f, s) => s.in)).toBeGreaterThan(0.85);
        expect(share('mother', (f, s) => s.in)).toBeGreaterThan(0.6);
        expect(share('calf', (f, s) => s.in)).toBeGreaterThan(0.65);
    });

    it('never covers the orb ahead, and reads at a sensible size', () => {
        Object.keys(SIZES).forEach((name) => {
            let over = 0;
            frames.forEach((f) => {
                const s = onScreen(f.camera, f.animals[name]);
                if (!s.in) return;
                const length = (SIZES[name] / f.animals[name].distanceTo(f.camera.position)) / (2 * tanHalf);
                expect(length, `${name} at p=${f.p.toFixed(4)}`).toBeGreaterThan(0.1);
                expect(length, `${name} at p=${f.p.toFixed(4)}`).toBeLessThan(1);
                const covers = f.orbs.some((o) => {
                    const so = onScreen(f.camera, o);
                    return so.in && Math.hypot((so.ndc.x - s.ndc.x) * (16 / 9), so.ndc.y - s.ndc.y) < length * 0.6;
                });
                if (covers) over += 1;
            });
            expect(over / frames.length, `${name} over an orb`).toBeLessThan(0.05);
        });
    });

    it('swims under the surface the whole way', () => {
        frames.forEach((f) => {
            expect(f.animals.whaleShark.y).toBeLessThan(ODYSSEY_SEA_LEVEL - OCEAN_ESCORT.whaleShark.under + 5);
            expect(f.animals.manta.y).toBeLessThan(ODYSSEY_SEA_LEVEL - OCEAN_ESCORT.manta.under + 3);
            expect(f.animals.mother.y).toBeLessThan(ODYSSEY_SEA_LEVEL - OCEAN_ESCORT.whales.under + 4);
        });
    });

    it('arrives from the blue, far off and faint, then takes its place', () => {
        const f = frames[Math.floor(frames.length * 0.3)];
        const view = viewOf(f.camera);
        const slot = OCEAN_ESCORT.whaleShark;
        const state = {};
        const at = new THREE.Vector3();
        const velocity = new THREE.Vector3();
        let fade = placeEscorted(state, view, slot, ODYSSEY_SEA_LEVEL, 0, DT, at, velocity);
        const target = resolveEscortTarget(view, slot, ODYSSEY_SEA_LEVEL, { x: 0, y: 0, z: 0 });
        const home = new THREE.Vector3(target.x, target.y, target.z).distanceTo(view.position);
        expect(at.distanceTo(view.position)).toBeGreaterThan(home * (OCEAN_ESCORT_MOTION.reach - 0.2));
        expect(fade).toBeLessThan(0.02);
        for (let t = DT; t < OCEAN_ESCORT_MOTION.arriveS + 0.5; t += DT) {
            fade = placeEscorted(state, view, slot, ODYSSEY_SEA_LEVEL, t, DT, at, velocity);
        }
        expect(fade).toBeCloseTo(1, 6);
        expect(at.distanceTo(view.position)).toBeLessThan(home * 1.3);
    });

    it('arrives again after a jump to another part of the ocean', () => {
        const state = {};
        expect(stepEscortAnchor(state, { x: 0, y: 100, z: 0 }, DT)).toBe(true);
        expect(stepEscortAnchor(state, { x: 5, y: 102, z: 0 }, DT)).toBe(false);
        expect(stepEscortAnchor(state, { x: 300, y: 102, z: 0 }, DT)).toBe(true);
    });
});
