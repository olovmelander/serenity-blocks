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
    SUMMIT_EARTH_REVEAL,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';

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
    controller.directorCamera.followDistance = BEYOND.followDistance;
    controller.directorCamera.fovBase = BEYOND.fovBase;
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

/** Drive the env exactly as the manager would and read back the hero world positions. */
function heroesAt(env, camPos, progress) {
    const probe = new THREE.Object3D();
    probe.position.copy(camPos);
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

    it('holds the authored thirds at entry, then DIVES the black hole onto the exit axis', () => {
        // Entry composition: black hole upper-LEFT (the destination omen / north
        // star), gas giant lower-CENTRE-right, galaxy upper-RIGHT.
        {
            const frame = frameAt(controller, chapterPositions, 6, ch6Start);
            const heroes = heroesAt(env, frame.camPos, ch6Start);
            const bh = project(frame, heroes.blackHole, 16 / 9);
            const planet = project(frame, heroes.heroPlanet, 16 / 9);
            const galaxy = project(frame, heroes.galaxy, 16 / 9);
            expect(bh.x).toBeLessThan(-0.1);
            expect(bh.y).toBeGreaterThan(0.05);
            expect(planet.x).toBeGreaterThan(0);
            expect(planet.y).toBeLessThan(0);
            expect(galaxy.x).toBeGreaterThan(0.25);
            expect(galaxy.y).toBeGreaterThan(0.05);
            expect(Math.abs(bh.x - planet.x)).toBeGreaterThan(0.3);
            expect(Math.abs(planet.x - galaxy.x)).toBeGreaterThan(0.3);
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
            expect(
                Math.abs(planet.x - bh.x),
                `planet ${planet.x.toFixed(2)} vs bh ${bh.x.toFixed(2)}`,
            ).toBeGreaterThan(0.2);
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

    it('frames the earth from the Ch5 summit, before the sky goes dark', () => {
        // The ask: "see the earth shape at the top of the mountains BEFORE it gets dark."
        // The Ch5 backdrop fade only begins at ch6Start, so every sample here is still
        // full daylight. The gas giant must already be on screen.
        // DERIVED, not literal. These were five p values inside the old ignite window
        // (summitStart 0.5873 -> summitEnd 0.6258). Wave 1A's ascent re-spaced chapter 5, so
        // the window is now 0.588 -> 0.6845 and the old samples land in its first 25% where
        // the earth is legitimately still faint. The claim is "across the ignite, the earth is
        // framed and shown", so derive the samples FROM the ignite.
        const cpAll = getActiveOdysseyChapterPositions();
        const skySpan = cpAll[5] - cpAll[4];
        const igniteStart = cpAll[5] - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const igniteEnd = cpAll[5] - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        const summitSamples = [0.30, 0.45, 0.60, 0.80, 1.0]
            .map((f) => igniteStart + (igniteEnd - igniteStart) * f);
        summitSamples.forEach((progress) => {
            expect(progress).toBeLessThan(ch6Start);
            const frame = frameAt(controller, chapterPositions, 5, progress);
            const heroes = heroesAt(env, frame.camPos, progress);
            const r = project(frame, heroes.heroPlanet, 16 / 9);
            expect(r.behind, `earth behind camera @p=${progress}`).toBe(false);
            expect(Math.abs(r.x), `earth ndcX ${r.x.toFixed(2)} @p=${progress}`).toBeLessThan(0.9);
            expect(Math.abs(r.y), `earth ndcY ${r.y.toFixed(2)} @p=${progress}`).toBeLessThan(0.9);
            // Reads as a distant world, not a near prop.
            expect(r.dist).toBeGreaterThan(600);
            // ...and it is actually SHOWN. Being framed was never the blocker on its own:
            // the chapter was hard-zero until the boundary, so the earth existed here but
            // was invisible. Opacity is the half of the fix that made it appear.
            const shown = env.userData.heroPlanet.userData.planet.material.opacity;
            expect(shown, `earth opacity ${shown.toFixed(2)} @p=${progress}`).toBeGreaterThan(0.2);
        });

        // Fully present by the last third of the window, well before the boundary.
        expect(env.userData.heroPlanet.userData.planet.material.opacity).toBeGreaterThan(0.99);
        // ...while the rest of Space is still held out of the daylight frame.
        expect(env.userData.starsNear.material.opacity).toBeLessThan(0.01);
        expect(env.userData.voidSky.visible).toBe(false);
    });
});
