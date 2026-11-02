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
    CHAPTER_5_CLIMB_SHOTS,
    CHAPTER_5_SHOTS,
    OdysseyCameraController,
    resolveChapterFramingForProgress,
    resolveJourneyFraming,
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
function viewAt(rig, progress, journey = false) {
    const cp = rig.layout.chapterPositions;
    const t = THREE.MathUtils.clamp((progress - cp[4]) / (cp[5] - cp[4]), 0, 1);
    // `journey`: the seam-blended framing the game uses inside a seam window (L27 sits on the
    // 4->5 boundary, where chapter 4's exit and chapter 5's entry framings are blended).
    const framing = journey ? resolveJourneyFraming(progress, cp) : resolveChapterFramingForProgress(5, t);
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
        forward,
        fovDeg: BEYOND.fovBase + framing.fovOffset,
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

    it('frames L28 from its own stop, not on the top edge', () => {
        // The open item since 2026-10-20: from L28's stop the orb sat at ndc y ~0.84 in game, the eye
        // looking up the face at it (it was parked between the face shot and the lift). (L27 sits on
        // the 4->5 seam, framed by the seam blend this bare rig does not model; in game it is ~0.47.)
        [28].forEach((level) => {
            const r = viewAt(rig, station(level)).project(rig.curve.getPointAt(station(level)));
            expect(r.behind, `L${level}`).toBe(false);
            expect(r.y, `L${level} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.6);
            expect(r.y, `L${level} ndcY ${r.y.toFixed(2)}`).toBeGreaterThan(-0.3);
        });
    });

    it('never loses the way ahead between stations', () => {
        // The point 0.015 of progress ahead (~38 u of rail) is on screen for the whole climb.
        for (let p = station(29); p <= station(34); p += 0.005) {
            const r = viewAt(rig, p).project(rig.curve.getPointAt(p + 0.015));
            expect(r.behind, `rail ahead @p=${p.toFixed(3)}`).toBe(false);
            expect(r.y, `rail ahead @p=${p.toFixed(3)} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.95);
        }
    });

    it('holds the summit mid-frame at the wall (L29) and as the horn looms (L31)', () => {
        const summit = heroSummit();
        [29, 31].forEach((level) => {
            const r = viewAt(rig, station(level)).project(summit);
            expect(r.behind).toBe(false);
            expect(Math.abs(r.x), `summit from L${level} ndcX ${r.x.toFixed(2)}`).toBeLessThan(0.3);
            expect(r.y, `summit from L${level} ndcY ${r.y.toFixed(2)}`).toBeGreaterThan(0.2);
            expect(r.y, `summit from L${level} ndcY ${r.y.toFixed(2)}`).toBeLessThan(0.6);
        });
    });

    it('holds a different view at every orb of the climb (CHAPTER_5_CLIMB_SHOTS, 2026-11)', () => {
        // Before 2026-11 the summit cone sat dead ahead from L28 to L32. Now: the wall (L29), across
        // the west slope (L30), the horn on a long lens (L31), out east (L32), down from the
        // shoulder (L33).
        const summit = heroSummit();
        const views = Object.fromEntries([29, 30, 31, 32, 33].map((level) => [level, viewAt(rig, station(level))]));
        const where = (level) => views[level].project(summit);
        // L30 turns west off the wall: the summit stands on the right, the slope and sky to the left.
        expect(views[30].headingDeg - views[29].headingDeg).toBeLessThan(-20);
        expect(where(30).x, `summit from L30 ndcX ${where(30).x.toFixed(2)}`).toBeGreaterThan(0.15);
        // L31 is the tightest lens of the climb.
        [29, 30, 32, 33].forEach((level) => {
            expect(views[31].fovDeg, `L31 lens vs L${level}`).toBeLessThan(views[level].fovDeg - 6);
        });
        // L32 turns east past the wall: the summit at the left edge, the open air to the right.
        expect(views[32].headingDeg - views[29].headingDeg).toBeGreaterThan(15);
        expect(where(32).x, `summit from L32 ndcX ${where(32).x.toFixed(2)}`).toBeLessThan(-0.4);
        // L33 looks out from the shoulder, lowest of all: the horizon in the frame.
        [29, 30, 31, 32].forEach((level) => {
            expect(views[33].pitchDeg, `L33 pitch vs L${level}`).toBeLessThan(views[level].pitchDeg - 6);
        });
        expect(Math.abs(views[33].pitchDeg)).toBeLessThan(8);
        // Each orb's view is its own: neighbours differ by a real turn or a real change of lens.
        for (let level = 29; level < 33; level += 1) {
            const a = views[level];
            const b = views[level + 1];
            const turn = THREE.MathUtils.radToDeg(a.forward.angleTo(b.forward));
            expect(turn + Math.abs(a.fovDeg - b.fovDeg), `L${level} -> L${level + 1}`).toBeGreaterThan(12);
        }
    });

    it("changes the climb's view smoothly, and holds each orb's view exactly where it parks", () => {
        const cp = rig.layout.chapterPositions;
        const span = cp[5] - cp[4];
        // The authored moves from L28's stop on: continuous, with a bounded slope (no pan faster
        // than ~1.5 deg per 0.001 of journey progress; a glide between two orbs is ~0.05). (Before
        // L28 the ledge shot's short tilt is older, and steeper.)
        const step = 0.0002;
        const from = CHAPTER_5_CLIMB_SHOTS[0].t;
        let prev = resolveChapterFramingForProgress(5, from);
        for (let t = from + step; t <= 1 + 1e-9; t += step) {
            const f = resolveChapterFramingForProgress(5, t);
            for (const key of ['yawDeg', 'pitchDeg', 'fovOffset']) {
                const perMilli = Math.abs(f[key] - prev[key]) / ((step * span) / 0.001);
                expect(perMilli, `${key} slope @t=${t.toFixed(4)}`).toBeLessThan(1.5);
            }
            prev = f;
        }
        // Parked at an orb the view is exactly its key: zero slope there, so a small drift off the
        // stop does not pan it.
        CHAPTER_5_CLIMB_SHOTS.forEach((key) => {
            const at = resolveChapterFramingForProgress(5, key.t);
            const near = resolveChapterFramingForProgress(5, key.t + 0.002);
            expect(Math.abs(near.yawDeg - at.yawDeg), `yaw drift at t=${key.t}`).toBeLessThan(0.05);
        });
        // The real camera turns continuously along the whole climb: no step between neighbours.
        let last = null;
        for (let p = station(28); p <= station(34); p += 0.0005) {
            const { forward } = viewAt(rig, p);
            if (last) {
                const turn = THREE.MathUtils.radToDeg(last.angleTo(forward));
                expect(turn, `view step @p=${p.toFixed(4)}`).toBeLessThan(1.5);
            }
            last = forward;
        }
    });

    it('leaves the 5->6 hand-off pose exactly as it was, and the climb shots after the face shot', () => {
        // The face shot (2026-10-20, below) owns the lift-off; L28's small tilt (2026-11-01) comes in
        // after it, and every shot is gone before the hand-off.
        const climb = Object.entries(CHAPTER_5_SHOTS).filter(([name]) => name !== 'face').map(([, s]) => s);
        const firstIn = Math.min(...climb.map((shot) => shot.in[0]));
        const lastOut = Math.max(...climb.map((shot) => shot.out[1]));
        expect(firstIn).toBeGreaterThanOrEqual(CHAPTER_5_SHOTS.face.out[0]);
        expect(lastOut).toBeLessThanOrEqual(0.9);
        expect(CHAPTER_5_SHOTS.face.out[1]).toBeLessThanOrEqual(0.12);
        [lastOut, 0.95, 1].forEach((t) => {
            const framing = resolveChapterFramingForProgress(5, t);
            expect(framing.pitchDeg, `pitch @t=${t}`).toBeCloseTo(0, 9);
            expect(framing.yawDeg, `yaw @t=${t}`).toBeCloseTo(0, 9);
            expect(framing.fovOffset, `fov @t=${t}`).toBeCloseTo(0, 9);
        });
    });

    it('looks at the face, not the empty sky, at lift-off (L27 on the 4->5 boundary)', () => {
        // Before 2026-10-20 the entry framing pitched ~60 deg up the near-vertical rail: the summit
        // sat in the bottom third under a frame of empty sky.
        const view = viewAt(rig, station(27), true);
        expect(view.pitchDeg).toBeLessThan(50);
        expect(view.pitchDeg).toBeGreaterThan(25);
        const summit = view.project(heroSummit());
        expect(summit.behind).toBe(false);
        expect(summit.y, `summit ndcY ${summit.y.toFixed(2)}`).toBeGreaterThan(-0.15);
        // ...and the orb underfoot stays on screen.
        const node = view.project(rig.curve.getPointAt(station(27)));
        expect(node.y, `node ndcY ${node.y.toFixed(2)}`).toBeLessThan(0.85);
    });
});
