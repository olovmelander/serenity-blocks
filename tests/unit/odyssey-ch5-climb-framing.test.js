/**
 * End-to-end framing guard for the Chapter 5 climb (the pattern of odyssey-ch6-hero-framing):
 * the REAL OdysseyCameraController over the REAL spline with the REAL per-chapter framing.
 *
 * Before the 2026-10-03 pass the camera levelled to the horizon while the rail kept climbing:
 * from L30 to L34 the node the camera stood on sat at the top edge of the screen (ndc y
 * 0.9-1.0), the next one was above it (1.1-1.4), and the summit was pinned to the top edge.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    CHAPTER_5_SHOTS,
    OdysseyCameraController,
    resolveChapterFramingForProgress,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import {
    ODYSSEY_ACTS,
    ODYSSEY_CAMERA_PROFILES,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import {
    ODYSSEY_MASSIFS,
    odysseyWorldHeight,
} from '../../src/rendering/odyssey/world/odyssey-world-height.js';

const BEYOND = ODYSSEY_CAMERA_PROFILES[ODYSSEY_ACTS.BEYOND];

function createRig() {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition: layout.levelPositions[0] ?? 0,
    });
    // The director eases the camera to the act profile at runtime; pin ALL of it. `drift`
    // matters: it scales the look-ahead, and a bare controller (drift 1) pitches ~9 deg higher
    // than the game does (calibrated against in-game captures, 0.1-0.3 deg agreement).
    controller.directorCamera.followDistance = BEYOND.followDistance;
    controller.directorCamera.fovBase = BEYOND.fovBase;
    controller.directorCamera.drift = BEYOND.drift;
    return { controller, layout, curve: getOdysseyPathCurve() };
}

/** The settled chapter-5 view at a global progress: a camera posed like the in-game one. */
function viewAt(rig, progress) {
    const cp = rig.layout.chapterPositions;
    const t = THREE.MathUtils.clamp((progress - cp[4]) / (cp[5] - cp[4]), 0, 1);
    const framing = resolveChapterFramingForProgress(5, t);
    rig.controller._activeFraming = framing;
    const frame = rig.controller.computeFollowFrame(progress);
    const cam = new THREE.PerspectiveCamera(BEYOND.fovBase + framing.fovOffset, 16 / 9, 0.1, 40000);
    cam.position.copy(frame.camPos);
    cam.up.copy(frame.normal);
    cam.lookAt(frame.lookTarget);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const forward = frame.lookTarget.clone().sub(frame.camPos).normalize();
    return {
        project(world) {
            const ndc = world.clone().project(cam);
            return { x: ndc.x, y: ndc.y, behind: world.clone().sub(cam.position).dot(forward) <= 0 };
        },
        headingDeg: THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)),
        pitchDeg: THREE.MathUtils.radToDeg(Math.asin(forward.y)),
    };
}

function heroSummit() {
    const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
    let best = null;
    for (let dx = -60; dx <= 60; dx += 6) {
        for (let dz = -60; dz <= 60; dz += 6) {
            const y = odysseyWorldHeight(hero.x + dx, hero.z + dz);
            if (!best || y > best.y) best = new THREE.Vector3(hero.x + dx, y, hero.z + dz);
        }
    }
    return best;
}

describe('Odyssey chapter 5 climb framing (real camera + real spline)', () => {
    const rig = createRig();
    const { levelPositions } = rig.layout;
    // Chapter 5's stations: L27 (index 26) .. L34; the climb proper is L29..L34.
    const station = (level) => levelPositions[level - 1];

    it('keeps the node underfoot and the next node on screen at every station of the climb', () => {
        for (let level = 29; level <= 34; level += 1) {
            const view = viewAt(rig, station(level));
            [level, level + 1].forEach((n) => {
                const r = view.project(rig.curve.getPointAt(station(n)));
                const where = `L${n} seen from L${level}`;
                expect(r.behind, `${where} is behind the camera`).toBe(false);
                expect(Math.abs(r.x), `${where} ndcX ${r.x.toFixed(2)}`).toBeLessThan(0.6);
                expect(r.y, `${where} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.88);
                expect(r.y, `${where} ndcY ${r.y.toFixed(2)}`).toBeGreaterThan(-0.2);
            });
        }
    });

    it('never loses the way ahead between stations', () => {
        // The point 0.015 of progress ahead (~38 u of rail) is on screen for the whole climb.
        for (let p = station(29); p <= station(34); p += 0.005) {
            const r = viewAt(rig, p).project(rig.curve.getPointAt(p + 0.015));
            expect(r.behind, `rail ahead @p=${p.toFixed(3)}`).toBe(false);
            expect(r.y, `rail ahead @p=${p.toFixed(3)} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.95);
        }
    });

    it('holds the summit mid-frame through the wall and the summit shots', () => {
        const summit = heroSummit();
        [29, 31, 32].forEach((level) => {
            const r = viewAt(rig, station(level)).project(summit);
            expect(r.behind).toBe(false);
            expect(Math.abs(r.x), `summit from L${level} ndcX ${r.x.toFixed(2)}`).toBeLessThan(0.3);
            expect(r.y, `summit from L${level} ndcY ${r.y.toFixed(2)}`).toBeGreaterThan(0.2);
            expect(r.y, `summit from L${level} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.6);
        });
    });

    it('plays three different shots: the wall, the look-out, the summit', () => {
        const wall = viewAt(rig, station(29));
        const lookOut = viewAt(rig, station(30));
        const summit = viewAt(rig, station(31));
        // The look-out pans RIGHT off the face; the summit shot pans back LEFT past the wall.
        expect(lookOut.headingDeg - wall.headingDeg).toBeGreaterThan(10);
        expect(lookOut.headingDeg - summit.headingDeg).toBeGreaterThan(20);
        expect(summit.headingDeg).toBeLessThan(wall.headingDeg);
        // ...and from the shoulder (L33) the view is level: the horizon is in the frame.
        expect(Math.abs(viewAt(rig, station(33)).pitchDeg)).toBeLessThan(8);
    });

    it('leaves the lift-off and the 5->6 hand-off poses exactly as they were', () => {
        const firstIn = Math.min(...Object.values(CHAPTER_5_SHOTS).map((shot) => shot.in[0]));
        const lastOut = Math.max(...Object.values(CHAPTER_5_SHOTS).map((shot) => shot.out[1]));
        expect(firstIn).toBeGreaterThanOrEqual(0.15);
        expect(lastOut).toBeLessThanOrEqual(0.9);
        [0, 0.05, 0.1, firstIn, lastOut, 0.95, 1].forEach((t) => {
            const framing = resolveChapterFramingForProgress(5, t);
            expect(framing.pitchDeg, `pitch @t=${t}`).toBeCloseTo(0, 9);
            expect(framing.yawDeg, `yaw @t=${t}`).toBeCloseTo(0, 9);
            expect(framing.fovOffset, `fov @t=${t}`).toBeCloseTo(0, 9);
        });
    });
});
