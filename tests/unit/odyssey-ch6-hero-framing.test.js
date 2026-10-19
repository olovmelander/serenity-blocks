/**
 * End-to-end framing guard for the Chapter 6 "Space" heroes.
 *
 * This is the test the Ch6 placement work was missing: it drives the REAL
 * OdysseyCameraController over the REAL authored spline with the REAL per-chapter
 * framing, builds the REAL cosmic-expanse environment, and projects each hero through a
 * camera configured exactly like the in-game follow camera. Nothing here re-implements
 * production maths except the final projection, so it cannot drift away from the game.
 *
 * Before the 2026-08 fix the heroes measured 31-68 deg off a ~49 deg horizontal /
 * ~33 deg vertical half-FOV — the gas giant reached ndcX -1.00 by p=0.68, i.e. entirely
 * off the left of the screen for most of the chapter.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    OdysseyCameraController,
    resolveChapterFramingForProgress,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../../src/rendering/odyssey/path-utils.js';
import {
    ODYSSEY_ACTS,
    ODYSSEY_CAMERA_PROFILES,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import {
    APPROACH,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
    PLANET_SEAM_LOCK,
    resolveOmenHandoffWindow,
    SUMMIT_EARTH_REVEAL,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { OMEN_SHADOW_RADIUS } from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.tsl.js';
import {
    GARGANTUA_LOCK,
    resolveGargantuaLockPosition,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';

// Chapters 5-7 run the BEYOND act camera language (followDistance 42, fovBase 66).
const BEYOND = ODYSSEY_CAMERA_PROFILES[ODYSSEY_ACTS.BEYOND];

// Narrowest and widest realistic windows. ndcY is aspect-independent (vertical FOV is
// fixed), so the narrow 4:3 case is the binding one for horizontal placement.
const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 21 / 9];

function createRealController() {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition: layout.levelPositions[0] ?? 0,
    });
    // The director eases the camera toward the act profile at runtime; pin it so the
    // frame under test is the settled BEYOND framing rather than a transient blend.
    // `drift` too: it scales the look-ahead, and a bare controller (drift 1) pitches several
    // degrees higher than the game does (calibrated against in-game captures, 2026-10-03).
    controller.directorCamera.followDistance = BEYOND.followDistance;
    controller.directorCamera.fovBase = BEYOND.fovBase;
    controller.directorCamera.drift = BEYOND.drift;
    return { controller, layout };
}

/**
 * Settled follow frame for a chapter at a global progress. computeFollowFrame returns
 * SHARED scratch vectors, so everything is cloned before the next call.
 */
function frameAt(controller, chapterPositions, chapterId, progress) {
    const start = chapterPositions[chapterId - 1];
    const end = chapterPositions[chapterId] ?? 1;
    const inChapter = THREE.MathUtils.clamp((progress - start) / Math.max(1e-6, end - start), 0, 1);
    controller._activeFraming = resolveChapterFramingForProgress(chapterId, inChapter);
    const frame = controller.computeFollowFrame(progress);
    return {
        camPos: frame.camPos.clone(),
        lookTarget: frame.lookTarget.clone(),
        cameraUp: frame.normal.clone(),
    };
}

function project(frame, worldPoint, aspect) {
    const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, aspect, 0.1, 20000);
    cam.position.copy(frame.camPos);
    cam.up.copy(frame.cameraUp);
    cam.lookAt(frame.lookTarget);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const ndc = worldPoint.clone().project(cam);
    const forward = frame.lookTarget.clone().sub(frame.camPos).normalize();
    const toHero = worldPoint.clone().sub(frame.camPos);
    return {
        x: ndc.x,
        y: ndc.y,
        behind: toHero.dot(forward) <= 0,
        offAxis: THREE.MathUtils.radToDeg(forward.angleTo(toHero)),
        dist: toHero.length(),
    };
}

/**
 * Drive the env exactly as the manager would and read back the hero world positions. `eye` is a
 * position (a bare probe: no view direction, so no camera-seated poses) or a real camera.
 */
function heroesAt(env, eye, progress) {
    let probe = eye;
    if (!eye?.isCamera) {
        probe = new THREE.Object3D();
        probe.position.copy(eye);
    }
    updateCosmicExpanseEnvironment(env, 0.016, 1, probe, progress);
    env.updateMatrixWorld(true);
    return {
        blackHole: env.userData.blackHole.getWorldPosition(new THREE.Vector3()),
        heroPlanet: env.userData.heroPlanet.getWorldPosition(new THREE.Vector3()),
        galaxy: env.userData.galaxy.getWorldPosition(new THREE.Vector3()),
    };
}

describe('Odyssey chapter 6 hero framing (real camera + real spline)', () => {
    const { controller, layout } = createRealController();
    const { chapterPositions } = layout;
    const ch6Start = chapterPositions[5];
    const ch6End = chapterPositions[6];

    const env = createCosmicExpanseEnvironment({ particleCount: 200 });
    const range = getChapterPathRange(6);
    env.position.set(range.center.x, range.center.y, range.center.z);
    env.userData.yStart = range.start.y;
    env.userData.yEnd = range.end.y;
    env.userData.chapterOpacity = 1;

    // Sample the whole chapter, including the old p=0.73 crest that used to spike the
    // aim to 68 deg off-axis.
    const samples = [];
    for (let i = 0; i <= 12; i += 1) {
        samples.push(ch6Start + (ch6End - ch6Start) * (i / 12));
    }

    // A real perspective camera on the path at `progress`, or — `orbEye` — the same eye moved off
    // the rail and turned away, the way an orb close-up moves it.
    const liveCamera = (progress, orbEye = false) => {
        const frame = frameAt(controller, chapterPositions, 6, progress);
        const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
        cam.position.copy(frame.camPos);
        cam.up.copy(frame.cameraUp);
        if (orbEye) {
            cam.position.add(new THREE.Vector3(14, -6, 9));
            cam.lookAt(frame.lookTarget.clone().add(new THREE.Vector3(-30, -12, 25)));
        } else {
            cam.lookAt(frame.lookTarget);
        }
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        return { frame, cam };
    };
    const omenAt = (progress, orbEye = false) => {
        const { frame, cam } = liveCamera(progress, orbEye);
        updateCosmicExpanseEnvironment(env, 0.016, 1, cam, progress);
        env.updateMatrixWorld(true);
        const { blackHole } = env.userData;
        const world = blackHole.getWorldPosition(new THREE.Vector3());
        const r = project(frame, world, 16 / 9);
        const deg = THREE.MathUtils.radToDeg(Math.atan2(OMEN_SHADOW_RADIUS * blackHole.scale.x, r.dist));
        return {
            ...r, world, cam, scale: blackHole.scale.x, deg,
        };
    };

    it('keeps all three heroes inside the frame for the whole chapter', () => {
        samples.forEach((progress) => {
            const frame = frameAt(controller, chapterPositions, 6, progress);
            const heroes = heroesAt(env, frame.camPos, progress);
            ASPECTS.forEach((aspect) => {
                Object.entries(heroes).forEach(([name, world]) => {
                    const r = project(frame, world, aspect);
                    const where = `${name} @p=${progress.toFixed(3)} aspect=${aspect.toFixed(2)}`;
                    expect(r.behind, `${where} is behind the camera`).toBe(false);
                    // 0.88 rather than 1.0 so a hero is never merely clinging to the edge.
                    expect(Math.abs(r.x), `${where} ndcX ${r.x.toFixed(2)}`).toBeLessThan(0.88);
                    expect(Math.abs(r.y), `${where} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.88);
                });
            });
        });
    });

    it('sets the black hole at the end of the rail from the first frame, and flies into it', () => {
        // Entry composition (2026-10-19): the omen hangs on the rail's own line ahead
        // (OMEN_SPINE_ANCHOR), so from the first frame it sits where the path leads, near the
        // frame's centre; the gas giant lower-right of the rail, the galaxy a far jewel upper-LEFT
        // (the level card owns the right edge).
        {
            // A real camera: the giant is still on the seam's screen seat here.
            const { frame, cam } = liveCamera(ch6Start);
            const heroes = heroesAt(env, cam, ch6Start);
            const bh = project(frame, heroes.blackHole, 16 / 9);
            const planet = project(frame, heroes.heroPlanet, 16 / 9);
            const galaxy = project(frame, heroes.galaxy, 16 / 9);
            expect(Math.abs(bh.x), `entry ndcX ${bh.x.toFixed(2)}`).toBeLessThan(0.25);
            expect(Math.abs(bh.y), `entry ndcY ${bh.y.toFixed(2)}`).toBeLessThan(0.25);
            expect(planet.x).toBeGreaterThan(0.15);
            expect(planet.y).toBeLessThan(0);
            expect(galaxy.x).toBeLessThan(-0.25);
            expect(galaxy.y).toBeGreaterThan(0.25);
            expect(Math.abs(bh.x - planet.x)).toBeGreaterThan(0.3);
            expect(Math.abs(planet.x - galaxy.x)).toBeGreaterThan(0.6);
        }
        // Exit (owner direction 2026-08-15): the rail flies STRAIGHT INTO the black
        // hole — it IS the transition into chapter 7. The hole sits on the flight
        // axis; the other heroes stay clear of the dive line.
        {
            const frame = frameAt(controller, chapterPositions, 6, ch6End);
            const heroes = heroesAt(env, frame.camPos, ch6End);
            const bh = project(frame, heroes.blackHole, 16 / 9);
            const planet = project(frame, heroes.heroPlanet, 16 / 9);
            const galaxy = project(frame, heroes.galaxy, 16 / 9);
            expect(Math.abs(bh.x), `dive ndcX ${bh.x.toFixed(2)}`).toBeLessThan(0.2);
            expect(Math.abs(bh.y), `dive ndcY ${bh.y.toFixed(2)}`).toBeLessThan(0.25);
            expect(bh.offAxis, `dive off-axis ${bh.offAxis.toFixed(1)} deg`).toBeLessThan(10);
            // The giant hangs LOW, below the dive line (2026-10-19), so its clearance is 2-D.
            expect(
                Math.hypot(planet.x - bh.x, planet.y - bh.y),
                `planet ${planet.x.toFixed(2)},${planet.y.toFixed(2)} vs bh ${bh.x.toFixed(2)},${bh.y.toFixed(2)}`,
            ).toBeGreaterThan(0.3);
            expect(planet.y).toBeLessThan(bh.y - 0.2);
            expect(
                Math.abs(galaxy.x - bh.x),
                `galaxy ${galaxy.x.toFixed(2)} vs bh ${bh.x.toFixed(2)}`,
            ).toBeGreaterThan(0.3);
        }
    });

    it('closes on the heroes rather than letting them shrink away', () => {
        const first = frameAt(controller, chapterPositions, 6, ch6Start);
        const entry = heroesAt(env, first.camPos, ch6Start);
        const entryDist = Object.fromEntries(
            Object.entries(entry).map(([k, v]) => [k, project(first, v, 16 / 9).dist]),
        );

        const last = frameAt(controller, chapterPositions, 6, ch6End);
        const exit = heroesAt(env, last.camPos, ch6End);
        Object.entries(exit).forEach(([name, world]) => {
            expect(project(last, world, 16 / 9).dist).toBeLessThan(entryDist[name]);
        });
    });

    it('raises the gas giant after dark and holds it in one place through the hand-off', () => {
        // Owner reports 2026-10-02: the giant was "seen very early and then drifts as we get into
        // space" — it faded up into the daylight sky and slid diagonally across the whole frame as
        // the camera pitched up with the climb, then parked on the rail and shrank. Now it rises
        // after dark and is seated from the camera (PLANET_SEAM_LOCK) until the authored march,
        // which already sits there, takes over. Replayed with a REAL perspective camera: the seat
        // is only applied to one (headless callers keep the authored poses).
        const cpAll = getActiveOdysseyChapterPositions();
        const skySpan = cpAll[5] - cpAll[4];
        const spaceSpan = cpAll[6] - cpAll[5];
        const riseStart = cpAll[5] - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const riseEnd = cpAll[5] - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        const lockEnd = cpAll[5] + spaceSpan * PLANET_SEAM_LOCK.handoverFrom;
        const marchFrom = cpAll[5] + spaceSpan * PLANET_SEAM_LOCK.handoverTo;
        const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
        const measure = (progress) => {
            const chapterId = progress < cpAll[5] ? 5 : 6;
            const frame = frameAt(controller, chapterPositions, chapterId, progress);
            cam.position.copy(frame.camPos);
            cam.up.copy(frame.cameraUp);
            cam.lookAt(frame.lookTarget);
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld(true);
            updateCosmicExpanseEnvironment(env, 0.016, 1, cam, progress);
            env.updateMatrixWorld(true);
            const world = env.userData.heroPlanet.getWorldPosition(new THREE.Vector3());
            return {
                ...project(frame, world, 16 / 9),
                opacity: env.userData.heroPlanet.userData.planet.material.opacity,
                scale: env.userData.heroPlanet.scale.x,
            };
        };

        // Not in the daylight: hidden until after dark.
        expect(measure(riseStart - 0.01).opacity).toBeLessThan(0.01);
        // Risen and seated by the window's end; from there to the hand-over it does not move on
        // screen however the camera pitches and turns, and it stays clear of the rail (x > 0.15).
        const seat = measure(riseEnd);
        expect(seat.opacity).toBeGreaterThan(0.95);
        expect(seat.behind).toBe(false);
        expect(seat.x).toBeGreaterThan(0.15);
        for (let p = riseEnd; p <= lockEnd; p += 0.004) {
            const r = measure(p);
            expect(Math.hypot(r.x - seat.x, r.y - seat.y), `drift @p=${p.toFixed(4)}`).toBeLessThan(0.01);
            expect(r.scale).toBeCloseTo(seat.scale, 3);
        }
        // The hand-over to the authored march is smooth: no jump on screen or in size.
        let prev = measure(lockEnd);
        for (let p = lockEnd + 0.002; p <= marchFrom + 0.01; p += 0.002) {
            const r = measure(p);
            expect(Math.hypot(r.x - prev.x, r.y - prev.y), `jump @p=${p.toFixed(4)}`).toBeLessThan(0.04);
            expect(Math.abs(r.scale - prev.scale) / prev.scale, `size jump @p=${p.toFixed(4)}`).toBeLessThan(0.04);
            prev = r;
        }
        // The authored entry scale is unchanged (masterpiece pass x1.35).
        expect(APPROACH.planetA.s).toBeCloseTo((34 / 28) * 1.35, 6);
    });

    it('hangs the black hole at ONE place on the spine, then locks it onto chapter 7 just before the seam', () => {
        // Owner 2026-10-19: "i want the black hole for example to be locked on the spine path
        // instead pf drifting towards it and then lock just before we go into the black hole and
        // chapter 7". It used to march across a quarter of the frame on the camera's height and
        // grow 3.9 -> 8.2 deg in the last 1 % of the path as it glided onto the lock.
        const handoff = resolveOmenHandoffWindow(chapterPositions);
        const first = omenAt(ch6Start);
        let prevDeg = 0;
        for (let p = ch6Start; p < handoff.start; p += 0.003) {
            const r = omenAt(p);
            const where = `@p=${p.toFixed(4)}`;
            // It never moves — neither with travel nor when the eye leaves the rail.
            expect(r.world.distanceTo(first.world), `moved ${where}`).toBeLessThan(1e-6);
            expect(omenAt(p, true).world.distanceTo(first.world), `orb eye moved it ${where}`).toBeLessThan(1e-6);
            // It only grows, with progress, and stays ahead and in frame.
            expect(r.deg, `shrank ${where}`).toBeGreaterThanOrEqual(prevDeg - 1e-9);
            expect(r.behind).toBe(false);
            expect(Math.abs(r.x)).toBeLessThan(0.3);
            expect(Math.abs(r.y)).toBeLessThan(0.35);
            prevDeg = r.deg;
        }
        // On the path camera it is already where ch7's lock holds the hole, so the lock that
        // follows is a settle, not a move.
        const atStart = omenAt(handoff.start);
        const lockAtStart = project(
            frameAt(controller, chapterPositions, 6, handoff.start),
            resolveGargantuaLockPosition(atStart.cam, new THREE.Vector3()),
            16 / 9,
        );
        expect(Math.hypot(atStart.x - lockAtStart.x, atStart.y - lockAtStart.y)).toBeLessThan(0.03);
        // At the hand-over it IS the lock, at ch7's size.
        const atEnd = omenAt(handoff.end);
        const lockAtEnd = resolveGargantuaLockPosition(atEnd.cam, new THREE.Vector3());
        expect(atEnd.world.distanceTo(lockAtEnd)).toBeLessThan(1e-3);
        expect(atEnd.scale).toBeCloseTo(GARGANTUA_LOCK.shadowRadius / OMEN_SHADOW_RADIUS, 6);
        // And it came from small and far: the north star grows ~2.7x across the chapter.
        expect(atEnd.deg / first.deg).toBeGreaterThan(2.4);
        expect(first.deg).toBeGreaterThan(2);
    });

    it('leaves the gas giant where the rail sees it when an orb close-up takes the eye', () => {
        // The seam's screen seat is taken on the RAIL camera the board publishes
        // (camera.userData.railCamera): an eye off the rail no longer drags the giant into its
        // own view (it used to be glued into every close-up, and half-glued across the hand-over).
        const cpAll = getActiveOdysseyChapterPositions();
        const spaceSpan = cpAll[6] - cpAll[5];
        const to = cpAll[5] + spaceSpan * PLANET_SEAM_LOCK.handoverTo;
        for (let p = cpAll[5] - 0.01; p <= to + 0.004; p += 0.004) {
            const rail = liveCamera(p).cam;
            updateCosmicExpanseEnvironment(env, 0.016, 1, rail, p);
            env.updateMatrixWorld(true);
            const onRail = env.userData.heroPlanet.getWorldPosition(new THREE.Vector3());
            const orb = liveCamera(p, true).cam;
            orb.userData.railCamera = rail;
            updateCosmicExpanseEnvironment(env, 0.016, 1, orb, p);
            env.updateMatrixWorld(true);
            const offRail = env.userData.heroPlanet.getWorldPosition(new THREE.Vector3());
            expect(offRail.distanceTo(onRail), `@p=${p.toFixed(4)}`).toBeLessThan(1e-6);
        }
    });

    it('gives the gas giant and the galaxy one place each once the seam lets the giant go', () => {
        const from = ch6Start + (ch6End - ch6Start) * PLANET_SEAM_LOCK.handoverTo;
        const placesAt = (progress, orbEye) => {
            const { cam } = liveCamera(progress, orbEye);
            updateCosmicExpanseEnvironment(env, 0.016, 1, cam, progress);
            env.updateMatrixWorld(true);
            const { heroPlanet, galaxy } = env.userData;
            return {
                planet: heroPlanet.getWorldPosition(new THREE.Vector3()),
                planetScale: heroPlanet.scale.x,
                galaxy: galaxy.getWorldPosition(new THREE.Vector3()),
                galaxyTurn: galaxy.quaternion.clone(),
            };
        };
        const ref = placesAt(from, false);
        for (let p = from; p <= ch6End; p += 0.004) {
            [false, true].forEach((orbEye) => {
                const r = placesAt(p, orbEye);
                const where = `@p=${p.toFixed(4)}${orbEye ? ' (orb eye)' : ''}`;
                expect(r.planet.distanceTo(ref.planet), `giant moved ${where}`).toBeLessThan(1e-6);
                expect(r.planetScale).toBeCloseTo(ref.planetScale, 9);
                expect(r.galaxy.distanceTo(ref.galaxy), `galaxy moved ${where}`).toBeLessThan(1e-6);
                expect(r.galaxyTurn.angleTo(ref.galaxyTurn), `galaxy turned ${where}`).toBeLessThan(1e-6);
            });
        }
    });
});
