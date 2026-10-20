/**
 * The REAL Odyssey camera over the REAL spline, posed as the board + director pose it — for
 * tests that ask "what does the player see at progress p?" (the harness of
 * odyssey-seam-camera-continuity.test.js: the settled pose a position capture photographs).
 */
import * as THREE from 'three';
import { OdysseyCameraController } from '../../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../../src/rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { resolveOrbParkProgress } from '../../../src/rendering/odyssey/odyssey-chapter-arrival.js';
import { CHAPTER_CONFIGS } from '../../../src/core/odyssey/data/chapters.js';
import {
    getCameraProfileForChapter,
} from '../../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

export function createOdysseyCameraRig() {
    const layout = getLevelRegistry().getPresentationLayout();
    const cp = layout.chapterPositions;
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 40000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: cp,
        startPosition: 0,
        idleAutoDrift: false,
    });
    const forward = new THREE.Vector3();
    const scratch = new THREE.Vector3();

    /** The settled camera at journey progress `p`, fed the seam phase and act profile. */
    function poseAt(p) {
        const bs = resolveChapterBlendState(p, CHAPTER_CONFIGS, cp);
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
        controller.setCurrentPosition(p);
        controller._teleportPending = true;
        controller.update(0);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
        return camera;
    }

    /** The chapter a level belongs to. */
    function chapterOf(id) {
        return layout.chapterRanges.find((r) => id >= r.startLevelId && id <= r.endLevelId).chapterId;
    }

    /** Where the camera parks for level `id` (its chapter's arrival offset included). */
    function parkOf(id) {
        return resolveOrbParkProgress(chapterOf(id), layout.levelPositionsById[id], cp);
    }

    /** Whether world point `pt` is in front of the eye and inside the frame padded to |ndc| < pad. */
    function inFrame(cam, pt, pad = 1) {
        cam.getWorldDirection(forward);
        if (scratch.copy(pt).sub(cam.position).dot(forward) <= 0) return false;
        scratch.copy(pt).project(cam);
        return Math.abs(scratch.x) < pad && Math.abs(scratch.y) < pad;
    }

    return {
        layout, cp, camera, controller, poseAt, chapterOf, parkOf, inFrame,
    };
}
