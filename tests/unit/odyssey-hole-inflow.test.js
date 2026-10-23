/**
 * THE PATH FLOWS INTO THE HOLE (2026-10-23). Olov: "now it feels like the orb path just quits
 * before we go into the black hole, i want this to be a seamless experience, almost like as the
 * black hole is a huge black hole orb on the path that we gets sucked in to."
 *
 * Measured on the real 48 -> 49 trip before this pass: the rail ended at orb 49 while the
 * camera-locked hole held the frame's centre (the orb slid half a frame away from it, the rail a
 * stub at the bottom), the photon ring sat in the hole's centre plane where the shadow hid it from
 * ~20 deg (the plunge was a flat black disc), the omen's lens target and Gargantua's both fed the
 * post lens through the plunge (a ghost of the ring across the shadow), and the whole plunge took
 * ~0.12 s of a ~1 s trip. Played here on the real camera (tests/unit/helpers/odyssey-camera-rig.js).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import {
    getChapterTransitionForChapter,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import {
    ODYSSEY_PATH_INFLOW,
    buildOdysseyPathInflow,
    createOdysseyPathInflowStream,
    resolveOdysseyPathInflowWeight,
    writeOdysseyPathInflowStrip,
} from '../../src/rendering/odyssey/odyssey-path-inflow.js';
import { resolveOdysseyPathReveal } from '../../src/rendering/odyssey/odyssey-path-horizon.js';
import {
    CH7_FALL,
    CH7_FALL_LOCK,
    CH7_PLUNGE_TRAVEL,
    plungeTravelExtraMs,
    plungeTravelMeasure,
    plungeTravelProgress,
    resolveBlackHoleFall,
    resolveBlackHoleFallDepth,
    resolvePlungeStretch,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import {
    resolveGargantuaFallPosition,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';
import {
    CH7_GARGANTUA,
    createBlackHoleTranscendenceEnvironment,
    updateBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const rig = createOdysseyCameraRig();
const { cp, layout } = rig;
const curve = getOdysseyPathCurve();
const mouth = cp[6];
const start = curve.getPointAt(mouth);
const tangent = curve.getTangentAt(mouth).normalize();
const reveal = resolveOdysseyPathReveal(cp, layout.levelPositions);

/** The hole as chapter 7 poses it for the camera at `p` (poseGargantua). */
function holeAt(camera, p) {
    const fall = resolveBlackHoleFall(p, cp);
    const depth = fall.active ? resolveBlackHoleFallDepth(fall.alpha) : CH7_FALL_LOCK.depth;
    const centre = resolveGargantuaFallPosition(camera, new THREE.Vector3(), depth, fall.centring);
    const d = centre.distanceTo(camera.position);
    return { centre, d, radius: fall.active ? d * Math.sin(fall.alpha) : CH7_FALL_LOCK.shadowRadius };
}

function layAt(p, stream = createOdysseyPathInflowStream()) {
    const camera = rig.poseAt(p);
    const hole = holeAt(camera, p);
    const laid = buildOdysseyPathInflow({
        eye: camera.position,
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
        tanHalfFov: Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
        centre: hole.centre,
        radius: hole.radius,
        start,
        tangent,
    }, stream);
    return {
        camera, hole, laid, stream,
    };
}

const pointOf = (stream, i) => new THREE.Vector3().fromArray(stream.points, i * 3);

describe('the rail flows on into the black hole (the inflow)', () => {
    it('is drawn exactly while the rail ends at the mouth, and hands over to the rail inside', () => {
        const wIn = getChapterTransitionForChapter(5).seamWidth;
        const from = cp[5] + wIn;
        expect(resolveOdysseyPathInflowWeight(cp[5], cp, layout.levelPositions)).toBe(0);
        expect(resolveOdysseyPathInflowWeight(from, cp, layout.levelPositions)).toBe(0);
        [from + ODYSSEY_PATH_INFLOW.fadeIn, rig.parkOf(44), rig.parkOf(48), mouth, reveal.start].forEach((p) => {
            expect(resolveOdysseyPathInflowWeight(p, cp, layout.levelPositions), `p=${p}`).toBeCloseTo(1, 6);
        });
        // Handed over while the way on is laid out (the rail's own reveal), gone by the next orb.
        let prev = 1;
        for (let p = reveal.start; p <= reveal.end; p += 0.0002) {
            const w = resolveOdysseyPathInflowWeight(p, cp, layout.levelPositions);
            expect(w).toBeLessThanOrEqual(prev + 1e-9);
            prev = w;
        }
        expect(resolveOdysseyPathInflowWeight(reveal.end, cp, layout.levelPositions)).toBe(0);
        expect(resolveOdysseyPathInflowWeight(rig.parkOf(49), cp, layout.levelPositions)).toBe(0);
        expect(resolveOdysseyPathInflowWeight(0.95, cp, layout.levelPositions)).toBe(0);
    });

    it('runs from the mouth orb into the middle of the hole all through the trip in, in front of the shadow', () => {
        for (let p = rig.parkOf(48); p <= reveal.start; p += 0.0005) {
            const {
                camera, hole, laid, stream,
            } = layAt(p);
            expect(laid, `p=${p.toFixed(4)}`).toBe(true);
            expect(stream.visibility, `p=${p.toFixed(4)}`).toBeGreaterThan(0.3);
            // It leaves the orb itself...
            expect(pointOf(stream, 0).distanceTo(start)).toBeLessThan(1e-3);
            // ...and ends in the middle of the hole's disc as the eye sees it.
            const n = stream.t.length;
            const toCentre = hole.centre.clone().sub(camera.position).normalize();
            const toEnd = pointOf(stream, n - 1).sub(camera.position).normalize();
            const alpha = Math.asin(hole.radius / hole.d);
            expect(toEnd.angleTo(toCentre) / alpha, `p=${p.toFixed(4)}`).toBeLessThan(0.05);
            // Every point is nearer the eye than the shadow's near surface: it draws over the
            // shadow into the centre (the shadow writes depth).
            for (let i = 0; i < n; i += 1) {
                expect(pointOf(stream, i).distanceTo(camera.position)).toBeLessThan(hole.d - hole.radius);
            }
            // One unbroken line on screen.
            let last = pointOf(stream, 0).project(camera);
            for (let i = 1; i < n; i += 1) {
                const ndc = pointOf(stream, i).project(camera);
                expect(Math.hypot(ndc.x - last.x, ndc.y - last.y), `p=${p.toFixed(4)} i=${i}`).toBeLessThan(0.08);
                last = ndc;
            }
        }
    });

    it('closes on the centre the way the disk turns, and flares where it crosses the photon ring', () => {
        const { stream } = layAt(0.8709 + 0.002);
        const peak = Math.max(...stream.rim);
        expect(peak).toBeGreaterThan(0.9);
        // Inside the disc it heads for the centre: `inner` grows to ~1 at the far end.
        expect(stream.inner[stream.t.length - 1]).toBeGreaterThan(0.95);
        expect(stream.inner[0]).toBe(0);
    });

    it('is a camera-facing strip that never flips over', () => {
        const { camera, stream } = layAt(0.874);
        const n = stream.t.length;
        const positions = new Float32Array(n * 6);
        const attributes = new Float32Array(n * 8);
        writeOdysseyPathInflowStrip(stream, camera.position, positions, attributes);
        expect(positions.every(Number.isFinite)).toBe(true);
        let prevSide = null;
        for (let i = 0; i < n; i += 1) {
            const a = new THREE.Vector3().fromArray(positions, i * 6);
            const b = new THREE.Vector3().fromArray(positions, (i * 6) + 3);
            const side = b.clone().sub(a).normalize();
            const view = pointOf(stream, i).sub(camera.position).normalize();
            expect(Math.abs(side.dot(view))).toBeLessThan(1e-3);
            if (prevSide) expect(side.dot(prevSide)).toBeGreaterThan(0);
            prevSide = side;
            expect(attributes[(i * 8) + 3]).toBe(-1);
            expect(attributes[(i * 8) + 7]).toBe(1);
        }
    });
});

describe('the plunge takes its time', () => {
    const ease = (r) => (r < 0.5 ? 4 * r * r * r : 1 - (((-2 * r) + 2) ** 3) / 2);
    const stretch = resolvePlungeStretch(cp);

    /** Milliseconds a trip spends between the mouth and the inside point, eased in the measure. */
    function plungeMs(p0, p1, warped = true) {
        const T = 900 + (Math.abs(p1 - p0) * 2600) + (warped ? plungeTravelExtraMs(p0, p1, cp) : 0);
        const m0 = plungeTravelMeasure(p0, cp);
        const m1 = plungeTravelMeasure(p1, cp);
        let tIn = null;
        let tOut = null;
        for (let t = 0; t <= T; t += 1) {
            const e = ease(t / T);
            const p = warped ? plungeTravelProgress(m0 + ((m1 - m0) * e), cp) : p0 + ((p1 - p0) * e);
            if (tIn === null && p >= stretch.from) tIn = t;
            if (tOut === null && p >= stretch.to) tOut = t;
        }
        return { plunge: tOut - tIn, total: T };
    }

    it('gives the plunge a second of the 48 -> 49 trip instead of seven frames', () => {
        const before = plungeMs(rig.parkOf(48), rig.parkOf(49), false);
        const after = plungeMs(rig.parkOf(48), rig.parkOf(49));
        expect(before.plunge).toBeLessThan(150);
        expect(after.plunge).toBeGreaterThan(900);
        expect(after.total).toBeLessThan(4000);
    });

    it('inverts exactly, and leaves trips that never reach the plunge as they were', () => {
        for (let p = 0; p <= 1; p += 0.0013) {
            expect(plungeTravelProgress(plungeTravelMeasure(p, cp), cp)).toBeCloseTo(p, 10);
        }
        const [a, b] = [rig.parkOf(6), rig.parkOf(12)];
        const ma = plungeTravelMeasure(a, cp);
        const mb = plungeTravelMeasure(b, cp);
        [0.1, 0.5, 0.9].forEach((e) => {
            expect(plungeTravelProgress(ma + ((mb - ma) * e), cp)).toBeCloseTo(a + ((b - a) * e), 10);
        });
        expect(plungeTravelExtraMs(a, b, cp)).toBe(0);
    });

    it('gives a long trip through the hole only a little more time', () => {
        expect(plungeTravelExtraMs(rig.parkOf(48), rig.parkOf(49), cp)).toBeCloseTo(CH7_PLUNGE_TRAVEL.extraMs, 6);
        expect(plungeTravelExtraMs(rig.parkOf(30), rig.parkOf(56), cp)).toBe(0);
    });

    describe('on the real camera controller', () => {
        afterEach(() => vi.restoreAllMocks());

        it('travels 48 -> 49 slowly through the plunge and lands exactly', () => {
            let now = 1000;
            vi.spyOn(performance, 'now').mockImplementation(() => now);
            const { controller } = rig;
            const from = rig.parkOf(48);
            const to = rig.parkOf(49);
            const duration = 900 + (Math.abs(to - from) * 2600) + plungeTravelExtraMs(from, to, cp);
            controller.setCurrentPosition(from);
            controller.travelToPosition(to, duration, { startPosition: from });
            let tIn = null;
            let tOut = null;
            let prev = from;
            for (let t = 0; t <= duration + 32; t += 16) {
                now += 16;
                controller.updatePathTravel();
                const p = controller.getCurrentPosition();
                expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
                prev = p;
                if (tIn === null && p >= stretch.from) tIn = t;
                if (tOut === null && p >= stretch.to) tOut = t;
            }
            expect(controller.getCurrentPosition()).toBe(to);
            expect(tOut - tIn).toBeGreaterThan(900);
        });
    });
});

describe('the hole stays a black hole all the way in', () => {
    it('rides the photon ring on the shadow\'s silhouette, so the shadow never hides it', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 100 });
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 20000);
        camera.position.set(240, 1300, -1100);
        camera.lookAt(camera.position.x, camera.position.y + 0.3, camera.position.z - 1);
        camera.updateMatrixWorld(true);
        [0.3, 0.6, 0.85, 1].forEach((u) => {
            const p = cp[6] + ((cp[7] - cp[6]) * CH7_FALL.horizon * u);
            updateBlackHoleTranscendenceEnvironment(group, 1 / 60, 3, camera, p);
            group.updateMatrixWorld(true);
            const fall = resolveBlackHoleFall(p, cp);
            const ring = group.userData.distantHole.userData.photonRing;
            const centre = ring.getWorldPosition(new THREE.Vector3());
            const inner = CH7_GARGANTUA.shadowRadius * CH7_GARGANTUA.photonInner
                * ring.getWorldScale(new THREE.Vector3()).x;
            const seen = Math.atan(inner / centre.distanceTo(camera.position));
            // The ring's inner edge is on the silhouette (the centre plane put it at
            // atan(sin alpha): 35 deg for a 45 deg hole, behind the shadow).
            expect(THREE.MathUtils.radToDeg(Math.abs(seen - fall.alpha)), `u=${u}`).toBeLessThan(0.4);
            expect(ring.material.uniforms.uOpacity.value).toBeCloseTo(1, 6);
        });
        // Without a camera (headless smoke) there is no silhouette: the centre plane, never NaN/inf.
        updateBlackHoleTranscendenceEnvironment(group, 1 / 60, 3, null, cp[6] + 0.005);
        const ring = group.userData.distantHole.userData.photonRing;
        expect(ring.position.z).toBe(0);
        expect(ring.scale.x).toBe(1);
    });

    it('feeds the post lens from one hole only once Gargantua has the shadow', () => {
        const feed = (gargantuaLive) => {
            const setLensTarget = vi.fn();
            const omen = Object.assign(new THREE.Vector3(1, 2, 3), { lensStrength: 0.5 });
            const gargantua = new THREE.Vector3(4, 5, 6);
            const board = {
                postProcessingStack: { setLensTarget },
                cinematicJourneyActive: true,
                lastActiveChapter: 7,
                environmentManager: {
                    environments: new Map([
                        [6, { group: { visible: true, userData: { lensWorldPos: omen } } }],
                        [7, {
                            group: {
                                visible: true,
                                userData: {
                                    lensWorldPos: gargantua,
                                    distantHole: { userData: { horizon: { visible: gargantuaLive } } },
                                },
                            },
                        }],
                    ]),
                },
                _isGargantuaShadowLive: OdysseyBoardController.prototype._isGargantuaShadowLive,
            };
            OdysseyBoardController.prototype._feedBlackHoleLens.call(board, {
                inSeam: true, sourceChapter: 6, targetChapter: 7,
            });
            return setLensTarget.mock.calls.map(([target]) => (target === omen ? 'omen' : 'gargantua'));
        };
        // Before the hand-over both set it (the omen first, Gargantua last: one spot there)...
        expect(feed(false)).toEqual(['omen', 'gargantua']);
        // ...after it, through the plunge, only the hole that is growing.
        expect(feed(true)).toEqual(['gargantua']);
    });
});
