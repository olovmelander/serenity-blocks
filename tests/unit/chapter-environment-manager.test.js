import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    ChapterEnvironmentManager,
    resolveChapterBlendState,
} from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_PATH_DATA } from '../../src/rendering/odyssey/path-data.js';

describe('resolveChapterBlendState', () => {
    it('uses the configured 3->4 seam window and blends symmetrically', () => {
        const boundary = ODYSSEY_PATH_DATA.chapterPositions[3];
        const centerState = resolveChapterBlendState(boundary);
        const leftState = resolveChapterBlendState(boundary - 0.02);
        const rightState = resolveChapterBlendState(boundary + 0.02);

        expect(centerState.inSeam).toBe(true);
        expect(centerState.boundaryId).toBe('3-4');
        expect(leftState.inSeam).toBe(true);
        expect(rightState.inSeam).toBe(true);
        expect(centerState.weights[3]).toBeCloseTo(0.5, 2);
        expect(centerState.weights[4]).toBeCloseTo(0.5, 2);
        expect(leftState.weights[3]).toBeCloseTo(rightState.weights[4], 4);
        expect(leftState.weights[4]).toBeCloseTo(rightState.weights[3], 4);
    });

    it('uses the configured 6->7 seam window and blends symmetrically', () => {
        const boundary = ODYSSEY_PATH_DATA.chapterPositions[6];
        const centerState = resolveChapterBlendState(boundary);
        const leftState = resolveChapterBlendState(boundary - 0.01);
        const rightState = resolveChapterBlendState(boundary + 0.01);

        expect(centerState.inSeam).toBe(true);
        expect(centerState.boundaryId).toBe('6-7');
        expect(centerState.weights[6]).toBeCloseTo(0.5, 2);
        expect(centerState.weights[7]).toBeCloseTo(0.5, 2);
        expect(leftState.weights[6]).toBeCloseTo(rightState.weights[7], 4);
        expect(leftState.weights[7]).toBeCloseTo(rightState.weights[6], 4);
    });

    it('falls back to a single active chapter outside seam windows', () => {
        // DERIVED. p=0.42 sat mid-chapter-4 under the pre-ascent layout; after Wave 1A
        // lengthened the journey it lands elsewhere. Ask for the middle of chapter 4.
        const cp4 = getActiveOdysseyChapterPositions();
        const state = resolveChapterBlendState((cp4[3] + cp4[4]) / 2);
        expect(state.inSeam).toBe(false);
        expect(state.activeChapter).toBe(4);
        expect(state.weights[4]).toBe(1);
        expect(Object.values(state.weights).filter((weight) => weight > 0)).toHaveLength(1);
    });

    it('keeps chapter 4 alive into early chapter 5 with the widened seam', () => {
        // DERIVED from the 4->5 boundary and its own seam width, rather than two literals
        // that happened to straddle it before the ascent re-normalised every p.
        const cpb = getActiveOdysseyChapterPositions();
        const boundary45 = cpb[4];
        const inside = resolveChapterBlendState(boundary45 + 0.001);
        const outside = resolveChapterBlendState(boundary45 + 0.2);

        expect(inside.inSeam).toBe(true);
        expect(inside.boundaryId).toBe('4-5');
        expect(inside.weights[4]).toBeGreaterThan(0);
        expect(inside.weights[5]).toBeGreaterThan(0);
        expect(outside.inSeam).toBe(false);
        expect(outside.activeChapter).toBe(5);
        expect(outside.weights[4]).toBe(0);
    });
});

describe('ChapterEnvironmentManager late-game coverage', () => {
    it('registers dedicated board environments for chapters 7 and 8', async () => {
        const scene = new THREE.Scene();
        const manager = new ChapterEnvironmentManager(scene, null);

        const chapter7 = await manager.createChapterEnvironment(7);
        const chapter8 = await manager.createChapterEnvironment(8);

        expect(chapter7?.userData?.chapterId).toBe(7);
        expect(chapter8?.userData?.chapterId).toBe(8);
        expect(manager.environments.has(7)).toBe(true);
        expect(manager.environments.has(8)).toBe(true);
        // Scaled by Wave 1A: seam widths are in p, and the ascent changed what p is worth.
        // See the note atop chapter-profile.js — these preserve their original WORLD extent.
        expect(manager.getBoundaryTransition('3-4').seamWidth).toBe(0.0222);
        expect(manager.getBoundaryTransition('4-5').seamWidth).toBe(0.0443);
        expect(manager.getBoundaryTransition('3-4').preloadDistance).toBe(0.06);
        expect(manager.getBoundaryTransition('6-7').beatDurationMs).toBe(1100);
        expect(manager.getBoundaryTransition('7-8').fxPreset).toBe('neon');

        manager.dispose();
    });

    it('uses injected chapter positions when resolving blend state', () => {
        const scene = new THREE.Scene();
        const chapterPositions = [0, 0.12, 0.24, 0.36, 0.5, 0.64, 0.78, 0.9, 1];
        const manager = new ChapterEnvironmentManager(scene, null, { chapterPositions });

        const state = manager.getBlendState(0.37);

        expect(state.inSeam).toBe(true);
        expect(state.boundaryId).toBe('3-4');
    });

    it('lights the rig for the chapters it builds; the world draws the rest', async () => {
        // Perf audit 2026-10-28: 4 slots, not the 9 the old chapter 2-5 scenes sized it to
        // (every lit material evaluated all of them).
        const manager = new ChapterEnvironmentManager(new THREE.Scene(), null);
        expect(manager.persistentLightRig.children.filter((c) => c.isLight)).toHaveLength(4);
        await expect(manager.createChapterEnvironment(3)).resolves.toBeNull();
        expect(manager.environments.has(3)).toBe(false);
        manager.dispose();
    });
});
