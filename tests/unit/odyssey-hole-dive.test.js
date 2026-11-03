// THE DIVE INTO THE HOLE (2026-11-02). Olov: "can we extend the length of that chapter slightly and
// use the orb path going into the black hole instead of this neon line? ... really improve this
// visual experience." The hole looms on the way in (CH7_APPROACH), the traced hole carries the whole
// dive with the eye inside its march sphere (GREAT_HOLE_LENS_CARRIER, CH7_TRACED_HOLE), and the trip
// lingers on the run-in and at the rim (CH7_PLUNGE_TRAVEL). Played on the real camera
// (tests/unit/helpers/odyssey-camera-rig.js).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import {
    CH7_APPROACH,
    CH7_FALL,
    CH7_PLUNGE_TRAVEL,
    plungeTravelExtraMs,
    plungeTravelMeasure,
    plungeTravelProgress,
    resolveBlackHoleApproachAlpha,
    resolveBlackHoleApproachProgress,
    resolveBlackHoleFall,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import {
    CH7_TRACED_HOLE,
    createBlackHoleTranscendenceEnvironment,
    poseGreatHole,
    updateBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import {
    GREAT_HOLE_HOLE,
    GREAT_HOLE_LENS_CARRIER,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-great-hole-lens.tsl.js';

const rig = createOdysseyCameraRig();
const { cp } = rig;
const deg = (rad) => THREE.MathUtils.radToDeg(rad);
const runFrom = cp[6] - CH7_APPROACH.runIn;
const horizonAt = cp[6] + ((cp[7] - cp[6]) * CH7_FALL.horizon);
const alphaAt = (p) => resolveBlackHoleApproachAlpha(p, cp[6], cp[7]);

describe('the hole looms on the way in', () => {
    it('is the lock\'s size until the run-in, ~14 deg at the mouth and the horizon\'s at the horizon', () => {
        expect(alphaAt(runFrom - 0.001)).toBe(CH7_FALL.restAlpha);
        expect(alphaAt(rig.parkOf(47))).toBe(CH7_FALL.restAlpha);
        expect(deg(alphaAt(cp[6]))).toBeGreaterThan(12);
        expect(deg(alphaAt(cp[6]))).toBeLessThan(16);
        expect(alphaAt(horizonAt)).toBeCloseTo(CH7_FALL.horizonAlpha, 9);
        // The fall reads the same size on both sides of the chapter line.
        expect(resolveBlackHoleFall(cp[6] - 1e-7, cp).alpha).toBeCloseTo(resolveBlackHoleFall(cp[6] + 1e-7, cp).alpha, 5);
    });

    it('grows without a pause or a jump, its pace joined where it lands on the horizon', () => {
        const h = 2e-6;
        let prev = alphaAt(runFrom);
        for (let p = runFrom + h; p <= horizonAt; p += h) {
            const a = alphaAt(p);
            expect(a).toBeGreaterThanOrEqual(prev);
            expect(a - prev).toBeLessThan(THREE.MathUtils.degToRad(0.2));
            prev = a;
        }
        // No stall at the chapter line (the old growth started from a standstill there).
        const slope = (p) => (alphaAt(p + 1e-6) - alphaAt(p - 1e-6)) / 2e-6;
        expect(slope(cp[6])).toBeGreaterThan(0.6 * slope(cp[6] - 0.002));
        // The landing takes the approach's pace (within a tenth either side of the join).
        const land = resolveBlackHoleApproachProgress(CH7_APPROACH.landFrom, cp);
        const before = (alphaAt(land) - alphaAt(land - 1e-6)) / 1e-6;
        const after = (alphaAt(land + 1e-6) - alphaAt(land)) / 1e-6;
        expect(after / before).toBeGreaterThan(0.9);
        expect(after / before).toBeLessThan(1.1);
    });

    it('poses the hole bigger on the run-in, the lock\'s size before it', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 100 });
        const scaleAt = (p) => {
            poseGreatHole(group, rig.poseAt(p), 0, 0, resolveBlackHoleFall(p, cp));
            return group.userData.heroScale;
        };
        expect(scaleAt(runFrom - 0.002)).toBe(1);
        const mouth = scaleAt(cp[6]);
        expect(mouth).toBeCloseTo(Math.sin(alphaAt(cp[6])) / Math.sin(CH7_FALL.restAlpha), 1);
        expect(mouth).toBeGreaterThan(1.4);
    });
});

describe('the traced hole carries the dive', () => {
    const group = createBlackHoleTranscendenceEnvironment({ particleCount: 100 });
    const hero = group.userData.distantHole.userData;
    const { lens } = hero;

    it('stays on while the eye goes in, the painted parts never drawn', () => {
        expect(lens).toBeTruthy();
        const ringFrom = resolveBlackHoleApproachProgress(CH7_TRACED_HOLE.ringFrom, cp);
        for (let p = cp[6] + 0.0005; p < ringFrom; p += 0.0008) {
            const camera = rig.poseAt(p);
            updateBlackHoleTranscendenceEnvironment(group, 1 / 60, 3, camera, p);
            expect(lens.mesh.visible, `p ${p.toFixed(4)}`).toBe(true);
            expect(lens.uniforms.reveal.value, `p ${p.toFixed(4)}`).toBeGreaterThan(0.99);
            expect(hero.photonRing.visible).toBe(false);
            expect(hero.disk.visible).toBe(false);
            expect(group.userData.infallEmbers?.visible ?? false).toBe(false);
        }
        // Gone once the hole has swallowed the frame.
        const past = resolveBlackHoleApproachProgress(CH7_TRACED_HOLE.ringTo + 1, cp);
        updateBlackHoleTranscendenceEnvironment(group, 1 / 60, 3, rig.poseAt(past), past);
        expect(lens.mesh.visible).toBe(false);
    });

    it('keeps its carrier ahead of the eye, behind the rail, without moving the hole', () => {
        const p = resolveBlackHoleApproachProgress(30, cp);
        const camera = rig.poseAt(p);
        updateBlackHoleTranscendenceEnvironment(group, 1 / 60, 3, camera, p);
        group.updateMatrixWorld(true);
        lens.update(hero.diskPivot, 0, 1, null);
        const rs = lens.uniforms.rs.value;
        lens.update(hero.diskPivot, 0, 1, camera.position);
        expect(lens.uniforms.rs.value).toBe(rs);
        const hole = lens.uniforms.hole.value;
        const carrier = rs * GREAT_HOLE_HOLE.BOUND * lens.mesh.scale.x;
        // The eye is inside the march sphere, so the carrier has shrunk...
        expect(hole.distanceTo(camera.position)).toBeLessThan(rs * GREAT_HOLE_HOLE.BOUND);
        expect(lens.mesh.scale.x).toBeLessThan(1);
        // ...to keep its front `front` units ahead of the eye: past the rail (the mouth orb is
        // within ~80 u) and in front of the shadow's near surface.
        expect(hole.distanceTo(camera.position) - carrier).toBeCloseTo(GREAT_HOLE_LENS_CARRIER.front, 3);
        expect(hole.distanceTo(camera.position) - (rs * GREAT_HOLE_HOLE.CRITICAL)).toBeGreaterThan(GREAT_HOLE_LENS_CARRIER.front);
        // Far away, the whole sphere as before.
        lens.update(hero.diskPivot, 0, 1, camera.position.clone().addScaledVector(hole.clone().sub(camera.position).normalize(), -1e5));
        expect(lens.mesh.scale.x).toBe(1);
    });
});

describe('the trip lingers on the way in and at the rim', () => {
    const ease = (r) => (r < 0.5 ? 4 * r * r * r : 1 - (((-2 * r) + 2) ** 3) / 2);

    /** The 48 -> 49 trip as the camera controller plays it: when each mark is first reached (ms). */
    function marks() {
        const from = rig.parkOf(48);
        const to = rig.parkOf(49);
        const T = 900 + (Math.abs(to - from) * 2600) + plungeTravelExtraMs(from, to, cp);
        const m0 = plungeTravelMeasure(from, cp);
        const m1 = plungeTravelMeasure(to, cp);
        const at = {};
        for (let t = 0; t <= T; t += 2) {
            const p = plungeTravelProgress(m0 + ((m1 - m0) * ease(t / T)), cp);
            const a = deg(alphaAt(p));
            [['mouth', p >= cp[6]], ['d40', a >= 40], ['d60', a >= 60]].forEach(([k, hit]) => {
                if (hit && at[k] === undefined) at[k] = t;
            });
        }
        return { ...at, total: T };
    }

    it('watches the hole loom for over a second and hangs at the rim for half of one', () => {
        const m = marks();
        expect(m.mouth).toBeGreaterThan(1200);
        expect(m.d60 - m.d40).toBeGreaterThan(450);
        expect(m.total).toBeLessThan(5500);
    });

    it('is a measure that only grows, with the beat where the rim crosses the frame', () => {
        let prev = -Infinity;
        for (let p = runFrom - 0.01; p <= horizonAt + 0.01; p += 1e-5) {
            const m = plungeTravelMeasure(p, cp);
            expect(m).toBeGreaterThan(prev);
            prev = m;
        }
        const beat = resolveBlackHoleApproachProgress(CH7_PLUNGE_TRAVEL.beatDeg, cp);
        const weight = (p) => (plungeTravelMeasure(p + 1e-5, cp) - plungeTravelMeasure(p - 1e-5, cp)) / 2e-5;
        expect(weight(beat)).toBeGreaterThan(weight(cp[6] + 0.002) * 3);
    });
});
