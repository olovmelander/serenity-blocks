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
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
    GALAXY_SKY_SEAT,
    resolveCh6HeroPlaces,
    resolveOmenHandoffWindow,
    SUMMIT_EARTH_REVEAL,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { ORBIT_EARTH_SCHEDULE } from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import {
    HERO_PLANET_RADIUS,
    OMEN_SHADOW_RADIUS,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.tsl.js';
import {
    GARGANTUA_LOCK,
    resolveGargantuaLockPosition,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';
import {
    ODYSSEY_PATH_HORIZON,
    resolveOdysseyPathHorizon,
} from '../../src/rendering/odyssey/odyssey-path-horizon.js';

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

    // The planetrise (docs/ODYSSEY_INTO_SPACE_2026-10.md §4): until it ends the giant is still
    // coming up over the Earth's edge, partly behind it by design, seen on the game's camera
    // leaning down over the Earth (tests/unit/odyssey-planetrise.test.js); this bare follow frame
    // has no lean.
    const planetriseEnd = ch6Start + (ch6End - ch6Start) * ORBIT_EARTH_SCHEDULE.rise[1];

    it('keeps all three heroes inside the frame for the whole chapter', () => {
        samples.forEach((progress) => {
            const frame = frameAt(controller, chapterPositions, 6, progress);
            const heroes = heroesAt(env, frame.camPos, progress);
            if (progress < planetriseEnd) delete heroes.heroPlanet;
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
        // Entry composition: the omen rides the path (resolveOmenPathPlace, 2026-10-22), so from
        // the first frame it sits where the rail heads, in the upper centre where chapter 7 will
        // hold it; the gas giant low and right of the rail, the galaxy a far jewel upper-LEFT (the
        // level card owns the right edge).
        {
            const { frame, cam } = liveCamera(ch6Start);
            const heroes = heroesAt(env, cam, ch6Start);
            const bh = project(frame, heroes.blackHole, 16 / 9);
            const planet = project(frame, heroes.heroPlanet, 16 / 9);
            const galaxy = project(frame, heroes.galaxy, 16 / 9);
            expect(Math.abs(bh.x), `entry ndcX ${bh.x.toFixed(2)}`).toBeLessThan(0.25);
            expect(bh.y, `entry ndcY ${bh.y.toFixed(2)}`).toBeGreaterThan(0);
            expect(bh.y, `entry ndcY ${bh.y.toFixed(2)}`).toBeLessThan(0.35);
            expect(planet.x).toBeGreaterThan(0.15);
            expect(planet.y).toBeLessThan(0);
            expect(galaxy.x).toBeLessThan(-0.25);
            expect(galaxy.y).toBeGreaterThan(0.25);
            // The giant hangs LOW, below the hole, so its clearance is 2-D (as at the exit).
            expect(
                Math.hypot(planet.x - bh.x, planet.y - bh.y),
                `planet ${planet.x.toFixed(2)},${planet.y.toFixed(2)} vs bh ${bh.x.toFixed(2)},${bh.y.toFixed(2)}`,
            ).toBeGreaterThan(0.3);
            expect(planet.y).toBeLessThan(bh.y - 0.2);
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
            if (name === 'galaxy') {
                // The galaxy is at infinity (GALAXY_SKY_SEAT): a fixed distance from the eye.
                expect(project(last, world, 16 / 9).dist).toBeCloseTo(entryDist[name], 6);
                return;
            }
            expect(project(last, world, 16 / 9).dist).toBeLessThan(entryDist[name]);
        });
    });

    it('raises the gas giant after dark from behind the Earth, then holds ONE place in the world', () => {
        // Owner 2026-10-20: "how can we not have the planets like moving as we move along the
        // odyssey path? I want them to be placed in space on 1 place." The giant used to be held
        // at a fixed SCREEN spot on the rail camera from its rise to p 0.775 (PLANET_SEAM_LOCK),
        // so it slid ~32 deg against the stars as the camera turned — moving with you. It hangs at
        // one world point (PLANET_WORLD_SEAT), same place, same pole, same size, whatever the
        // camera does; it may only move on screen by the parallax of the camera's own travel.
        // ONE MOVE, THE PLANETRISE (2026-10-24, docs/ODYSSEY_INTO_SPACE_2026-10.md §4; the agreed
        // plan: "the planet rises over Earth's edge"). The Earth's limb always lies below the
        // level and the seat above it, so a giant that never moved could never be behind the
        // Earth. Before the rise it hangs at ONE point below the limb; it rises on ONE arc to the
        // seat, by progress alone (an orb close-up never moves it), and never moves again.
        const cpAll = getActiveOdysseyChapterPositions();
        const skySpan = cpAll[5] - cpAll[4];
        const span = cpAll[6] - cpAll[5];
        const revealStart = cpAll[5] - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const riseFrom = cpAll[5] - span * ORBIT_EARTH_SCHEDULE.rise[0];
        const riseTo = cpAll[5] + span * ORBIT_EARTH_SCHEDULE.rise[1];
        const places = resolveCh6HeroPlaces(cpAll);
        const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
        const measure = (progress, orbEye = false) => {
            const chapterId = progress < cpAll[5] ? 5 : 6;
            const frame = frameAt(controller, chapterPositions, chapterId, progress);
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
            updateCosmicExpanseEnvironment(env, 0.016, 1, cam, progress);
            env.updateMatrixWorld(true);
            const giant = env.userData.heroPlanet;
            const world = giant.getWorldPosition(new THREE.Vector3());
            return {
                ...project(frame, world, 16 / 9),
                world,
                camPos: frame.camPos.clone(),
                quaternion: giant.getWorldQuaternion(new THREE.Quaternion()),
                opacity: giant.userData.planet.material.opacity,
                scale: giant.scale.x,
            };
        };

        // Not in the daylight: hidden until after dark, and faded up while it is behind the Earth.
        expect(measure(revealStart - 0.01).opacity).toBeLessThan(0.01);
        expect(revealStart).toBeLessThan(riseFrom);
        const below = measure(revealStart);
        expect(measure(riseFrom).opacity).toBeGreaterThan(0.6);
        const risen = measure(riseTo);
        expect(risen.opacity).toBeGreaterThan(0.95);
        expect(below.world.distanceTo(places.planetBelow)).toBeLessThan(1e-6);
        expect(risen.world.distanceTo(places.planet)).toBeLessThan(1e-6);
        expect(risen.behind).toBe(false);
        // Lower right, clear of the rail.
        expect(risen.x).toBeGreaterThan(0.15);
        expect(risen.y).toBeLessThan(0);
        // A large planet: its world radius reads at >= 7 deg from the rail.
        const radius = HERO_PLANET_RADIUS * risen.scale;
        expect(THREE.MathUtils.radToDeg(Math.asin(radius / risen.dist))).toBeGreaterThan(7);
        const arc = places.planet.distanceTo(places.planetRiseCentre);
        let prev = below;
        let prevHeight = -Infinity;
        for (let p = revealStart; p <= ch6End; p += 0.003) {
            const where = `@p=${p.toFixed(4)}`;
            const r = measure(p);
            const orb = measure(p, true);
            // By progress alone; one size.
            expect(orb.world.distanceTo(r.world), `orb eye moved it ${where}`).toBeLessThan(1e-6);
            expect(r.scale).toBeCloseTo(below.scale, 9);
            if (p <= riseFrom) {
                expect(r.world.distanceTo(places.planetBelow), `moved below the limb ${where}`).toBeLessThan(1e-6);
            } else if (p < riseTo) {
                // On the arc, and only ever up it.
                expect(r.world.distanceTo(places.planetRiseCentre), `off the arc ${where}`).toBeCloseTo(arc, 3);
                const height = r.world.clone().sub(places.planetRiseCentre).normalize().y;
                expect(height, `fell back ${where}`).toBeGreaterThanOrEqual(prevHeight - 1e-9);
                prevHeight = height;
            } else {
                // ONE place, ONE pole — on the rail and with the eye off it.
                expect(r.world.distanceTo(places.planet), `moved ${where}`).toBeLessThan(1e-6);
                expect(r.quaternion.angleTo(risen.quaternion), `turned ${where}`).toBeLessThan(1e-6);
                // Against the sky it moves only by the parallax of the camera's own travel.
                if (prev.world.distanceTo(places.planet) < 1e-6) {
                    const step = r.world.clone().sub(r.camPos).normalize()
                        .angleTo(prev.world.clone().sub(prev.camPos).normalize());
                    const parallax = r.camPos.distanceTo(prev.camPos) / Math.min(r.dist, prev.dist);
                    expect(step, `slid against the sky ${where}`).toBeLessThanOrEqual(parallax * 1.02 + 1e-9);
                }
                expect(r.behind, `behind ${where}`).toBe(false);
                expect(Math.abs(r.x), `ndcX ${where}`).toBeLessThan(0.88);
                expect(Math.abs(r.y), `ndcY ${where}`).toBeLessThan(0.88);
            }
            prev = r;
        }
    });

    it('rides the black hole on the path, then locks it onto chapter 7 just before the seam', () => {
        // Owner 2026-10-19: "i want the black hole for example to be locked on the spine path
        // instead pf drifting towards it and then lock just before we go into the black hole and
        // chapter 7". It used to march across a quarter of the frame on the camera's height and
        // grow 3.9 -> 8.2 deg in the last 1 % of the path as it glided onto the lock. Then, parked
        // at one world point, it wandered round the rail's vanishing point by up to 0.27 of the
        // frame as the rail turned — owner 2026-10-22: "it feels like the black hole drifts, i
        // want it to be locked at the journey path we are moving on". It now rides the path: its
        // place against the rail's heading never changes.
        const handoff = resolveOmenHandoffWindow(chapterPositions);
        const curve = getOdysseyPathCurve();
        const pathLength = curve.getLength();
        // Where the rail heads on the path camera: the vanishing point of its tangent.
        const offFromHeading = (progress, r) => {
            const frame = frameAt(controller, chapterPositions, 6, progress);
            const heading = project(
                frame,
                frame.camPos.clone().addScaledVector(curve.getTangentAt(progress).normalize(), 1e5),
                16 / 9,
            );
            return new THREE.Vector2(r.x - heading.x, r.y - heading.y);
        };
        const first = omenAt(ch6Start);
        const firstOff = offFromHeading(ch6Start, first);
        let prev = { ...first, p: ch6Start };
        for (let p = ch6Start + 0.003; p < handoff.start; p += 0.003) {
            const r = omenAt(p);
            const where = `@p=${p.toFixed(4)}`;
            // Locked to the path: the rail runs into it at the same spot all chapter.
            const off = offFromHeading(p, r);
            expect(off.distanceTo(firstOff), `slid against the rail ${where}`).toBeLessThan(0.015);
            // Placed by the rail's progress, never by the eye.
            expect(omenAt(p, true).world.distanceTo(r.world), `orb eye moved it ${where}`).toBeLessThan(1e-6);
            // Already on chapter 7's place on screen, so the hand-over is a settle, not a move.
            const lock = project(
                frameAt(controller, chapterPositions, 6, p),
                resolveGargantuaLockPosition(r.cam, new THREE.Vector3()),
                16 / 9,
            );
            expect(Math.hypot(r.x - lock.x, r.y - lock.y), `off the lock's place ${where}`).toBeLessThan(0.06);
            // It closes on the eye as fast as the rail runs, and only grows; ahead and in frame.
            const travelled = (p - prev.p) * pathLength;
            expect(prev.dist - r.dist, `closing ${where}`).toBeGreaterThan(travelled * 0.7);
            expect(prev.dist - r.dist, `closing ${where}`).toBeLessThan(travelled * 1.3);
            expect(r.deg, `shrank ${where}`).toBeGreaterThanOrEqual(prev.deg - 1e-9);
            expect(r.behind).toBe(false);
            prev = { ...r, p };
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
        // One size in the world (overhaul 2026-10-20): it grows on screen by approach alone —
        // a great black hole from the first frame (~6 deg), ~1.3x by the lock, no scripted swell.
        expect(atEnd.deg / first.deg).toBeGreaterThan(1.1);
        expect(atEnd.deg / first.deg).toBeLessThan(1.6);
        expect(first.deg).toBeGreaterThan(5);
    });

    it('runs the rail into the middle of the hole, not its rim', () => {
        // Olov 2026-10-22: "does the path go in to the center of the black hole now?" The rail's
        // drawn end (it tapers out at the path horizon, odyssey-path-horizon.js) met the shadow
        // 0.8-1.1 shadow radii below its centre all chapter; the hole now sits where that end
        // points. From the chapter's first stretch to its last node the end stays in the middle.
        const { levelPositions } = layout;
        const lastNode = Math.max(...levelPositions.filter((x) => x > ch6Start && x < ch6End - 1e-6));
        const curve = getOdysseyPathCurve();
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(BEYOND.fovBase / 2));
        for (let p = ch6Start + 0.03; p <= lastNode + 1e-9; p += 0.004) {
            const hole = omenAt(p);
            const radius = (OMEN_SHADOW_RADIUS * hole.scale) / hole.dist / tanHalf;
            const horizon = resolveOdysseyPathHorizon(p, chapterPositions, levelPositions);
            const end = project(
                frameAt(controller, chapterPositions, 6, p),
                curve.getPointAt(Math.min(1, horizon - (ODYSSEY_PATH_HORIZON.soft / 2))),
                16 / 9,
            );
            // In shadow radii from the hole's centre (x aspect-corrected).
            const off = Math.hypot(((end.x - hole.x) * 16) / 9, end.y - hole.y) / radius;
            expect(off, `rail end ${off.toFixed(2)} radii off the centre @p=${p.toFixed(4)}`).toBeLessThan(0.4);
        }
    });

    it('keeps the galaxy at infinity: one direction, one distance, one turn, whatever the eye does', () => {
        // The galaxy is part of the sky (GALAXY_SKY_SEAT): a fixed direction from the eye at a
        // fixed distance, turned once. It never slides against the stars nor swells.
        const look = (p, orbEye) => {
            const { cam } = liveCamera(p, orbEye);
            updateCosmicExpanseEnvironment(env, 0.016, 1, cam, p);
            env.updateMatrixWorld(true);
            const { galaxy } = env.userData;
            const toGalaxy = galaxy.getWorldPosition(new THREE.Vector3()).sub(cam.position);
            return {
                dist: toGalaxy.length(),
                dir: toGalaxy.normalize(),
                turn: galaxy.getWorldQuaternion(new THREE.Quaternion()),
            };
        };
        const ref = look(ch6Start, false);
        const checks = [];
        for (let p = ch6Start; p <= ch6End; p += 0.004) {
            checks.push([p, false], [p, true]);
        }
        checks.forEach(([p, orbEye]) => {
            const r = look(p, orbEye);
            const where = `@p=${p.toFixed(4)}${orbEye ? ' (orb eye)' : ''}`;
            expect(r.dist, `distance ${where}`).toBeCloseTo(GALAXY_SKY_SEAT.distance, 3);
            expect(r.dir.angleTo(ref.dir), `galaxy slid ${where}`).toBeLessThan(1e-6);
            expect(r.turn.angleTo(ref.turn), `galaxy turned ${where}`).toBeLessThan(1e-6);
        });
    });
});
