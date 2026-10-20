/**
 * AN ORB HOLDS ITS SIZE UNTIL THE EYE IS PAST IT (2026-10-20, in-game feedback: "some of the
 * orbs shrink away before we have passed them").
 *
 * The eye trails its rail point by the act's follow distance, so leaving an orb flies the camera
 * straight at it. Two rules shrank orbs on that approach, with the orb ahead of the eye and in
 * frame:
 *  - the NEAR-LENS FADE took every orb to nothing inside 13 u of the eye. Most orbs slide out of
 *    the bottom of the frame ~9-11 u away, so they visibly shrank on the way; on the steep climbs
 *    (chapter 5, the black hole, the city) the eye passes through the orb and the fade emptied the
 *    middle of the picture (L28: scale 0 at 4 u, dead centre). It is now a CAP on apparent size
 *    (NODE_NEAR_CAP): an orb stops growing at the close-up's size instead of shrinking away.
 *  - chapter 1's QUENCH started once the RAIL POINT reached an orb, ~24 u before the eye did
 *    (L4/L5 shrank to ~0.4 in view). It now starts when the eye passes the orb.
 *
 * Runs the node manager's own rules (nodeNearCapScale, _getChapterOneNodeQuench) against the real
 * camera over the whole journey. Far orbs beyond the manager's 0.225 p draw band are out of scope
 * (they appear as distant specks; nothing there is being passed).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    LevelNodeManager, NODE_NEAR_CAP, getOdysseyNodeGlowRadius, nodeNearCapScale,
} from '../../src/rendering/odyssey/LevelNodeManager.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const STEP = 0.0005;
const DRAW_BAND = 0.225;
const CAP_TAN = Math.tan(THREE.MathUtils.degToRad(NODE_NEAR_CAP.maxDeg));

describe('Odyssey orbs hold their size until the eye is past them (real camera, whole journey)', () => {
    const rig = createOdysseyCameraRig();
    // The manager's placement and chapter-1 quench, run on a stand-in with the live camera.
    const manager = {
        camera: rig.camera,
        cameraProgress: 0,
        focusedLevelId: null,
        cachedBasePositions: new Map(),
        pathEvaluator: (t, target) => rig.controller.getPathDataAt(t, target).position,
        _groundSampler: odysseyWorldHeight,
        _groundClearance: 7,
        _groundRange: [rig.cp[1], rig.cp[5]],
    };
    manager._getPathPoint = LevelNodeManager.prototype._getPathPoint.bind(manager);
    manager._eyePassedNode = LevelNodeManager.prototype._eyePassedNode.bind(manager);
    const quench = LevelNodeManager.prototype._getChapterOneNodeQuench.bind(manager);
    const orbs = Object.entries(rig.layout.levelPositionsById).map(([key, pathPosition]) => {
        const id = Number(key);
        const chapter = rig.chapterOf(id);
        const seat = manager._getPathPoint(pathPosition, new THREE.Vector3());
        manager.cachedBasePositions.set(id, seat);
        return {
            config: { id, chapter },
            pathPosition,
            seat,
            group: { position: seat },
            radius: getOdysseyNodeGlowRadius(chapter),
        };
    });

    /** Every orb ahead of the eye and in frame, at every sample of the journey. */
    function eachOrbInView(visit) {
        for (let p = 0; p <= 1 + 1e-9; p += STEP) {
            const camera = rig.poseAt(p);
            manager.cameraProgress = p;
            orbs.forEach((orb) => {
                if (Math.abs(orb.pathPosition - p) >= DRAW_BAND) return;
                if (!rig.inFrame(camera, orb.seat)) return;
                visit(orb, p, camera.position.distanceTo(orb.seat));
            });
        }
    }

    it('never quenches a chapter-1 orb the eye has not passed', () => {
        let looked = 0;
        eachOrbInView((orb, p) => {
            if (orb.config.chapter !== 1) return;
            looked += 1;
            expect(quench(orb), `L${orb.config.id} quenched in view at p=${p.toFixed(4)}`).toBe(0);
        });
        expect(looked).toBeGreaterThan(50);
    });

    it('never shows an orb in view smaller than full size or the close-up cap', () => {
        let capped = 0;
        eachOrbInView((orb, p, distance) => {
            const scale = nodeNearCapScale(distance, orb.radius) * (1 - quench(orb));
            const apparent = (scale * orb.radius) / distance;
            const floor = Math.min(orb.radius / distance, CAP_TAN);
            if (scale < 1) capped += 1;
            expect(apparent, `L${orb.config.id} at p=${p.toFixed(4)} (${distance.toFixed(1)} u)`)
                .toBeGreaterThan(floor - 1e-6);
        });
        // The steep climbs do bring the eye through orbs: the cap is exercised, not vacuous.
        expect(capped).toBeGreaterThan(0);
    });

    it('lets an orb that leaves through the frame edge go at full size (the meadow orbs)', () => {
        // L13 and L22 slide out of the bottom of the frame as the eye passes over them.
        [13, 22].forEach((id) => {
            const orb = orbs.find((o) => o.config.id === id);
            for (let p = orb.pathPosition; p <= orb.pathPosition + 0.03; p += STEP) {
                const camera = rig.poseAt(p);
                if (!rig.inFrame(camera, orb.seat)) continue;
                expect(nodeNearCapScale(camera.position.distanceTo(orb.seat), orb.radius), `L${id} p=${p.toFixed(4)}`)
                    .toBe(1);
            }
        });
    });
});
