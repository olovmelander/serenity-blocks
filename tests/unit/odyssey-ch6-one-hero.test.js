/**
 * CHAPTER 6, ONE HERO AT A TIME (CHAPTER_6_SHOTS, 2026-11-02; the owner: "a more well compositioned
 * chapter 6"). From p ~0.78 to 0.81 every frame was one picture (the galaxy upper left, the ringed
 * giant lower right, the rail between them), then the black hole rose between the two. The heroes
 * stay where they are in the world; each orb now turns the view to its own hero. On the game's own
 * camera (the rig) and the real chapter environment.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    CHAPTER_6_SHOTS,
    resolveChapterFramingForProgress,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { getChapterPathRange, getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import {
    createCosmicExpanseEnvironment,
    resolveOmenHandoffWindow,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import {
    ODYSSEY_ACTS,
    ODYSSEY_CAMERA_PROFILES,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

const BEYOND = ODYSSEY_CAMERA_PROFILES[ODYSSEY_ACTS.BEYOND];

describe('Odyssey chapter 6: one hero at a time (real camera, real heroes)', () => {
    const rig = createOdysseyCameraRig();
    const { cp, layout } = rig;
    const curve = getOdysseyPathCurve();
    const env = createCosmicExpanseEnvironment({ particleCount: 200 });
    const range = getChapterPathRange(6);
    env.position.set(range.center.x, range.center.y, range.center.z);
    env.userData.yStart = range.start.y;
    env.userData.yEnd = range.end.y;
    env.userData.chapterOpacity = 1;
    const tOf = (p) => (p - cp[5]) / (cp[6] - cp[5]);
    const park = (id) => rig.parkOf(id);

    /** The game's camera parked at orb `id`, and where its heroes and orbs fall on screen (16:9). */
    function viewAt(id) {
        const p = park(id);
        const cam = rig.poseAt(p);
        updateCosmicExpanseEnvironment(env, 0.016, 1, cam, p);
        env.updateMatrixWorld(true);
        const forward = cam.getWorldDirection(new THREE.Vector3());
        const at = (world) => {
            const ndc = world.clone().project(cam);
            return { x: ndc.x, y: ndc.y, behind: world.clone().sub(cam.position).dot(forward) <= 0 };
        };
        const { blackHole, heroPlanet, galaxy } = env.userData;
        const next = layout.levelPositions.find((x) => x > layout.levelPositionsById[id] + 1e-6);
        return {
            fov: cam.fov,
            hole: at(blackHole.getWorldPosition(new THREE.Vector3())),
            giant: at(heroPlanet.getWorldPosition(new THREE.Vector3())),
            galaxy: at(galaxy.getWorldPosition(new THREE.Vector3())),
            node: at(curve.getPointAt(layout.levelPositionsById[id])),
            next: at(curve.getPointAt(next)),
        };
    }
    const outOfFrame = (r) => r.behind || Math.abs(r.x) > 1 || Math.abs(r.y) > 1;

    it('keys every view on an orb of the chapter, from after the planetrise to before the hole', () => {
        // The keys sit on the parks of L38..L45 (a re-layout must move them with the orbs).
        const parks = [38, 39, 40, 41, 42, 43, 44, 45].map((id) => tOf(park(id)));
        expect(CHAPTER_6_SHOTS.length).toBe(parks.length);
        CHAPTER_6_SHOTS.forEach((key, i) => expect(key.t, `key ${i}`).toBeCloseTo(parks[i], 2));
        // Zero through the planetrise and from L45 on: the rail into the hole (RAIL_END_AIM), the hole's
        // hand-off to chapter 7's lock and the 6->7 seam are as they were.
        const handoff = resolveOmenHandoffWindow(cp);
        [0, 0.1, CHAPTER_6_SHOTS[0].t, CHAPTER_6_SHOTS[CHAPTER_6_SHOTS.length - 1].t, tOf(handoff.start), 0.95, 1]
            .forEach((t) => {
                const f = resolveChapterFramingForProgress(6, t);
                expect(f.yawDeg, `yaw @t=${t}`).toBe(0);
                expect(f.pitchDeg, `pitch @t=${t}`).toBe(0);
                expect(f.fovOffset, `fov @t=${t}`).toBe(0);
            });
    });

    it('holds the ringed giant at L39, the galaxy at L41, the rising hole at L42-L43', () => {
        // L39: the giant near the middle on a long lens; the galaxy out of frame.
        const giant = viewAt(39);
        expect(Math.abs(giant.giant.x), `giant ${giant.giant.x.toFixed(2)}`).toBeLessThan(0.3);
        expect(Math.abs(giant.giant.y), `giant ${giant.giant.y.toFixed(2)}`).toBeLessThan(0.3);
        expect(giant.fov).toBeLessThan(BEYOND.fovBase - 6);
        expect(outOfFrame(giant.galaxy), `galaxy ${giant.galaxy.x.toFixed(2)},${giant.galaxy.y.toFixed(2)}`).toBe(true);
        // L41: the galaxy near the middle; the giant out of frame.
        const galaxy = viewAt(41);
        expect(Math.abs(galaxy.galaxy.x), `galaxy ${galaxy.galaxy.x.toFixed(2)}`).toBeLessThan(0.3);
        expect(Math.abs(galaxy.galaxy.y), `galaxy ${galaxy.galaxy.y.toFixed(2)}`).toBeLessThan(0.3);
        expect(outOfFrame(galaxy.giant), `giant ${galaxy.giant.x.toFixed(2)},${galaxy.giant.y.toFixed(2)}`).toBe(true);
        // L42-L43: the hole rises in the frame, the galaxy to its left; the giant sunk to the corner.
        [42, 43].forEach((id) => {
            const v = viewAt(id);
            expect(v.hole.behind).toBe(false);
            expect(Math.abs(v.hole.x), `L${id} hole x`).toBeLessThan(0.4);
            expect(Math.abs(v.hole.y), `L${id} hole y`).toBeLessThan(0.5);
            expect(v.galaxy.x, `L${id} galaxy left of the hole`).toBeLessThan(v.hole.x - 0.3);
            expect(v.giant.y, `L${id} giant y ${v.giant.y.toFixed(2)}`).toBeLessThan(-0.85);
        });
    });

    it('keeps the orb underfoot and the next orb in frame at every turned view', () => {
        [39, 40, 41, 42, 43, 44].forEach((id) => {
            const v = viewAt(id);
            [['node', v.node], ['next', v.next]].forEach(([name, r]) => {
                expect(r.behind, `L${id} ${name} behind`).toBe(false);
                expect(Math.abs(r.x), `L${id} ${name} x ${r.x.toFixed(2)}`).toBeLessThan(0.7);
                expect(Math.abs(r.y), `L${id} ${name} y ${r.y.toFixed(2)}`).toBeLessThan(0.75);
            });
        });
    });

    it("turns calmly between the orbs, and holds each orb's view where it parks", () => {
        // The authored moves: continuous, no pan faster than 6 deg per 0.001 of progress (chapter 3's
        // orbs pan up to ~7), the lens under 3.
        const span = cp[6] - cp[5];
        const step = 0.0002;
        const perMilli = (a, b, key) => Math.abs(b[key] - a[key]) / ((step * span) / 0.001);
        let prev = resolveChapterFramingForProgress(6, 0);
        for (let t = step; t <= 1 + 1e-9; t += step) {
            const f = resolveChapterFramingForProgress(6, t);
            expect(perMilli(prev, f, 'yawDeg'), `yaw slope @t=${t.toFixed(4)}`).toBeLessThan(6);
            expect(perMilli(prev, f, 'pitchDeg'), `pitch slope @t=${t.toFixed(4)}`).toBeLessThan(6);
            expect(perMilli(prev, f, 'fovOffset'), `fov slope @t=${t.toFixed(4)}`).toBeLessThan(3);
            prev = f;
        }
        // Parked, the view is exactly its key: a small drift off the stop does not pan it.
        CHAPTER_6_SHOTS.forEach((key) => {
            const at = resolveChapterFramingForProgress(6, key.t);
            const near = resolveChapterFramingForProgress(6, key.t + 0.002);
            expect(Math.abs(near.yawDeg - at.yawDeg), `yaw drift at t=${key.t}`).toBeLessThan(0.05);
            expect(Math.abs(near.pitchDeg - at.pitchDeg), `pitch drift at t=${key.t}`).toBeLessThan(0.05);
        });
        // The game's camera never steps: under the seam budget of 7 deg per 0.001 of progress.
        const forward = new THREE.Vector3();
        let last = null;
        for (let p = park(38); p <= park(46); p += 0.0005) {
            rig.poseAt(p).getWorldDirection(forward);
            if (last) {
                const turn = THREE.MathUtils.radToDeg(last.angleTo(forward));
                expect(turn, `view step @p=${p.toFixed(4)}`).toBeLessThan(3.5);
            }
            last = forward.clone();
        }
    });
});
