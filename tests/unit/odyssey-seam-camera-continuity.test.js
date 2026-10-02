/**
 * SEAMLESS PASS (2026-10-02) — the camera crosses every chapter seam without a step.
 *
 * Drives the REAL OdysseyCameraController over the REAL live spline and layout, with the seam
 * phase and act-camera blend fed exactly as the board/director feed them, and measures the
 * camera between progress samples 0.0005 apart across all seven seam windows.
 *
 * Before this pass a teleport capture (the harness's own view of the game) stepped:
 *   - 30-32 u of look target per 0.001 p at every seam ENTRY (the x1.4 look-ahead switching on
 *     with the first frame of seam envelope),
 *   - 3-30 u of eye at every BOUNDARY (the chapter framing switched; a 2.4/s ease hid it live),
 *   - 4->5: 39 deg of view direction and a ~128 deg roll snap in one 0.0002 p step (the swoop),
 *   - 7->8: a 78 deg quaternion step (the city's stage basis adopted only after the boundary).
 * and in live play a wall-clock FOV pulse (+7-8 deg) fired at seam entry and again at the boundary.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    OdysseyCameraController,
    resolveJourneyFraming,
    resolveChapterFramingForProgress,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { getCameraProfileForChapter } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { seamHalfWidth, seamWindowAt } from '../../src/rendering/odyssey/transitions/odyssey-seam-schedule.js';

const STEP = 0.0005;
// Per-seam limits, per 0.001 p of progress: eye (u), look target (u), aim (deg). Plain travel
// moves the eye ~2.5 u per 0.001 p (2533 u journey). Two seams sit on rail geometry that moves
// the camera on its own: 6->7 is the hairpin (damped by HAIRPIN_67 to ~6.3 u / ~5.3 deg), and
// 7->8 crosses the black hole's rail twist at p ~0.952, which swung the eye 11.2 u per 0.001 p
// in the pre-pass controller with no seam logic involved (now ~9.7 with the stage basis easing
// in). Every limit sits far below the step it retires (see the header).
const LIMITS = Object.freeze({
    1: { eye: 4.5, target: 7, view: 2 },
    2: { eye: 4.5, target: 7, view: 2.5 },
    3: { eye: 4.5, target: 7, view: 2 },
    4: { eye: 5, target: 7, view: 5 },
    5: { eye: 4.5, target: 7, view: 2.5 },
    6: { eye: 8, target: 10, view: 7 },
    7: { eye: 11, target: 8, view: 7 },
});

function createController() {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 20000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition: 0,
        idleAutoDrift: false,
    });
    return { controller, camera, chapterPositions: layout.chapterPositions };
}

/** What the board + director feed the camera at `p` (seam phase, act-camera blend). */
function feed(controller, chapterPositions, p) {
    const bs = resolveChapterBlendState(p, CHAPTER_CONFIGS, chapterPositions);
    const a = getCameraProfileForChapter(bs.sourceChapter);
    const b = getCameraProfileForChapter(bs.targetChapter);
    const t = bs.seamProgress || 0;
    controller.directorCameraTarget.followDistance = THREE.MathUtils.lerp(a.followDistance, b.followDistance, t);
    controller.directorCameraTarget.fovBase = THREE.MathUtils.lerp(a.fovBase, b.fovBase, t);
    if (bs.inSeam) {
        controller.setSeamPhase({
            boundaryId: bs.boundaryId,
            seamPhase: bs.seamPhase,
            envelope: bs.seamEnvelope,
            direction: 1,
            intensity: 0.9,
            vista: bs.targetChapter >= 5 ? 1.08 : 0.9,
        });
    } else {
        controller.clearSeamPhase();
    }
    return bs;
}

/** Settled (teleport) pose at p — what a position capture photographs. */
function settledPose(controller, camera, chapterPositions, p) {
    feed(controller, chapterPositions, p);
    controller.setCurrentPosition(p);
    controller._teleportPending = true;
    controller.update(0);
    return {
        eye: camera.position.clone(),
        target: controller.lookAtTarget.clone(),
        dir: controller.lookAtTarget.clone().sub(camera.position).normalize(),
    };
}

describe('Odyssey seam camera continuity (real camera, live spline)', () => {
    const { controller, camera, chapterPositions } = createController();

    for (let source = 1; source <= 7; source += 1) {
        it(`crosses seam ${source}->${source + 1} with no eye/target/aim step`, () => {
            const boundary = chapterPositions[source];
            const w = seamHalfWidth(source);
            let prev = null;
            const worst = { eye: 0, target: 0, view: 0 };
            for (let p = boundary - w - 0.001; p <= boundary + w + 0.001 + 1e-9; p += STEP) {
                const pose = settledPose(controller, camera, chapterPositions, p);
                if (prev) {
                    const scale = 0.001 / STEP;
                    worst.eye = Math.max(worst.eye, pose.eye.distanceTo(prev.eye) * scale);
                    worst.target = Math.max(worst.target, pose.target.distanceTo(prev.target) * scale);
                    worst.view = Math.max(worst.view, THREE.MathUtils.radToDeg(pose.dir.angleTo(prev.dir)) * scale);
                }
                prev = pose;
            }
            const where = `seam ${source}->${source + 1}`;
            expect(worst.eye, `${where} eye u/0.001p`).toBeLessThan(LIMITS[source].eye);
            expect(worst.target, `${where} target u/0.001p`).toBeLessThan(LIMITS[source].target);
            expect(worst.view, `${where} aim deg/0.001p`).toBeLessThan(LIMITS[source].view);
        });
    }

    it('no longer swoops or rolls at 4->5 (was dirY 0.94 -> 0.69 and a ~128 deg roll snap)', () => {
        const boundary = chapterPositions[4];
        const before = settledPose(controller, camera, chapterPositions, boundary - 0.0002);
        const beforeQuat = camera.quaternion.clone();
        const after = settledPose(controller, camera, chapterPositions, boundary + 0.0002);
        expect(Math.abs(after.dir.y - before.dir.y)).toBeLessThan(0.01);
        expect(THREE.MathUtils.radToDeg(camera.quaternion.angleTo(beforeQuat))).toBeLessThan(2);
    });

    it('is already on the city stage basis at the 7->8 boundary (alignment starts at the window start)', () => {
        const boundary = chapterPositions[7];
        const start = boundary - seamHalfWidth(7);
        expect(resolveJourneyFraming(start, chapterPositions).stage).toBeCloseTo(0, 6);
        expect(resolveJourneyFraming(boundary - 0.25 * seamHalfWidth(7), chapterPositions).stage).toBeGreaterThan(0.5);
        // ~80 % aligned at the boundary (the city is fully drawn there), complete by 0.7 of the window.
        expect(resolveJourneyFraming(boundary, chapterPositions).stage).toBeGreaterThan(0.75);
        expect(resolveJourneyFraming(start + 1.4 * seamHalfWidth(7), chapterPositions).stage).toBeCloseTo(1, 6);
    });

    it('equals the plain chapter framing at every seam window edge (continuous by construction)', () => {
        for (let source = 1; source <= 7; source += 1) {
            const boundary = chapterPositions[source];
            const w = seamHalfWidth(source);
            const local = (id, p) => (p - chapterPositions[id - 1]) / (chapterPositions[id] - chapterPositions[id - 1]);
            const atStart = resolveJourneyFraming(boundary - w, chapterPositions);
            const plainStart = resolveChapterFramingForProgress(source, local(source, boundary - w));
            const atEnd = resolveJourneyFraming(boundary + w, chapterPositions);
            const plainEnd = resolveChapterFramingForProgress(source + 1, local(source + 1, boundary + w));
            Object.keys(plainStart).forEach((key) => {
                expect(atStart[key], `${source}->${source + 1} start ${key}`).toBeCloseTo(plainStart[key], 5);
                expect(atEnd[key], `${source}->${source + 1} end ${key}`).toBeCloseTo(plainEnd[key], 5);
            });
            expect(seamWindowAt(boundary, chapterPositions)?.source).toBe(source);
        }
    });

    it('plays no wall-clock beat while travelling: no FOV pulse, no per-frame eye lurch', () => {
        const live = createController();
        const realNow = performance.now.bind(performance);
        let now = realNow();
        performance.now = () => now;
        try {
            for (let source = 1; source <= 7; source += 1) {
                const boundary = live.chapterPositions[source];
                const w = seamHalfWidth(source);
                const startP = boundary - w - 0.002;
                const endP = boundary + w + 0.002;
                feed(live.controller, live.chapterPositions, startP);
                live.controller.setCurrentPosition(startP);
                live.controller.targetPosition = startP;
                for (let i = 0; i < 240; i += 1) { now += 1000 / 60; live.controller.update(1 / 60); }
                let lastChapter = null;
                let prevEye = live.camera.position.clone();
                let prevFov = live.camera.fov;
                const steps = [];
                let worstFovStep = 0;
                const dp = 0.00006; // ~9 u/s
                for (let p = startP; p <= endP; p += dp) {
                    const bs = feed(live.controller, live.chapterPositions, p);
                    if (lastChapter !== null && bs.activeChapter !== lastChapter) {
                        // What the board does at the flip (it used to fire the FOV pulse + vista beat).
                        live.controller.onChapterChange(bs.activeChapter);
                        live.controller.triggerVistaBeat({ chapterId: bs.activeChapter, intensity: 1 });
                    }
                    if (lastChapter === null || bs.inSeam !== (lastChapter !== null)) {
                        live.controller.triggerChapterSeam({ durationMs: 900, intensity: 0.9 });
                    }
                    lastChapter = bs.activeChapter;
                    live.controller.targetPosition = p;
                    live.controller.currentPosition = p;
                    now += 1000 / 60;
                    live.controller.update(1 / 60);
                    steps.push(live.camera.position.distanceTo(prevEye));
                    worstFovStep = Math.max(worstFovStep, Math.abs(live.camera.fov - prevFov));
                    prevEye = live.camera.position.clone();
                    prevFov = live.camera.fov;
                }
                const sorted = [...steps].sort((x, y) => x - y);
                const median = sorted[Math.floor(sorted.length / 2)];
                const worst = sorted[sorted.length - 1];
                // The pulse widened ~7 deg inside ~0.5 s (> 0.2 deg per frame); the act FOV blend
                // moves far slower than that.
                expect(worstFovStep, `seam ${source}->${source + 1} FOV deg/frame`).toBeLessThan(0.08);
                expect(worst, `seam ${source}->${source + 1} worst eye step vs median`)
                    .toBeLessThan(Math.max(0.6, median * 4));
            }
        } finally {
            performance.now = realNow;
        }
    });
});
