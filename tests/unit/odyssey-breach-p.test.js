/**
 * ODYSSEY_BREACH_P must be where the EYE actually breaks the surface on the LIVE spline.
 *
 * It had gone stale (0.20023, measured two layouts ago, vs the live 0.137), so the 2->3
 * surface-break stinger fired ~150 u after the breach. This recomputes the crossing with the real
 * camera — settled at each progress, fed the seam phase and act camera the board and director
 * feed it — and pins the constant to it. A re-layout or a framing change that moves the eye
 * must update the constant (world/odyssey-world-height.js), not this test.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OdysseyCameraController } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve, getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { getCameraProfileForChapter } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_BREACH_P, ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';

function bisectRising(f, lo, hi) {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 48; i += 1) {
        const m = (a + b) / 2;
        if (f(m) < ODYSSEY_SEA_LEVEL) a = m; else b = m;
    }
    return (a + b) / 2;
}

describe('ODYSSEY_BREACH_P (live layout)', () => {
    const layout = getLevelRegistry().getPresentationLayout();
    const cp = layout.chapterPositions;
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 20000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: cp,
        startPosition: 0,
        idleAutoDrift: false,
    });

    const eyeY = (p) => {
        const bs = resolveChapterBlendState(p, CHAPTER_CONFIGS, cp);
        const a = getCameraProfileForChapter(bs.sourceChapter);
        const b = getCameraProfileForChapter(bs.targetChapter);
        const s = bs.seamProgress || 0;
        controller.directorCameraTarget.followDistance = THREE.MathUtils.lerp(a.followDistance, b.followDistance, s);
        controller.directorCameraTarget.fovBase = THREE.MathUtils.lerp(a.fovBase, b.fovBase, s);
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
        return camera.position.y;
    };

    it('is the progress at which the eye crosses sea level', () => {
        // Search the ocean ascent: chapter 2 into the start of chapter 3.
        const eyeBreach = bisectRising(eyeY, cp[1] + (cp[2] - cp[1]) * 0.5, cp[2] + 0.02);
        expect(Math.abs(ODYSSEY_BREACH_P - eyeBreach)).toBeLessThan(3e-4);
    });

    it('sits just after the rail crosses, inside the 2->3 seam', () => {
        const railBreach = bisectRising((p) => getOdysseyPathPointAt(p).y, cp[1], cp[2] + 0.02);
        expect(ODYSSEY_BREACH_P).toBeGreaterThan(railBreach);
        expect(ODYSSEY_BREACH_P - railBreach).toBeLessThan(0.01);
        const blend = resolveChapterBlendState(ODYSSEY_BREACH_P, CHAPTER_CONFIGS, cp);
        expect(blend.boundaryId).toBe('2-3');
    });
});
