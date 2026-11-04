import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CHAPTER_SCENES, ONE_WORLD_CHAPTERS, getChapterScene,
} from '../chapter-environments/registry.js';

/**
 * ADR-0022 — Act II IS the One World, and the old chapter 2-5 scenes are gone for good.
 *
 * Mostly source assertions, deliberately: constructing OdysseyBoardController needs a WebGPU
 * device, and the thing worth pinning here is a POLICY (what ships, and that nothing can bring
 * the old scenes back) rather than a rendering behaviour. The behaviour is covered by the
 * in-game captures.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const BOARD = readFileSync(
    path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
    'utf8',
);

describe('Act II is the One World', () => {
    it('has no switch that turns the world off', () => {
        expect(BOARD).not.toMatch(/odysseyOneWorld/);
        expect(BOARD).not.toMatch(/options\.oneWorld/);
        expect(BOARD).toMatch(/this\.oneWorldEnabled = true;/);
    });

    it('draws exactly chapters 2-5, and they have no scene of their own', () => {
        // Ch1 (earth core) and Ch6+ (space onward) keep their own environments: the world's
        // height field does not describe them.
        expect([...ONE_WORLD_CHAPTERS]).toEqual([2, 3, 4, 5]);
        ONE_WORLD_CHAPTERS.forEach((id) => expect(getChapterScene(id)).toBe(null));
        expect(CHAPTER_SCENES.map((scene) => scene.id)).toEqual([1, 6, 7, 8]);
    });

    it('the old scenes stay gone', () => {
        ['deep-ocean', 'surface-world', 'mountain-peaks', 'sky-drift'].forEach((scene) => {
            const module = path.join(ROOT, `src/rendering/odyssey/chapter-environments/${scene}.js`);
            expect(existsSync(module), `${scene}.js is back`).toBe(false);
        });
    });

    it('builds the world inside a try/catch, and gives it up loudly', () => {
        // A throw in world construction must not take the whole board down. The journey plays
        // on without the world, and the player is told why it looks the way it does.
        const idx = BOARD.indexOf('createOdysseyWorld(');
        expect(idx).toBeGreaterThan(-1);
        const before = BOARD.slice(Math.max(0, idx - 900), idx);
        expect(before).toMatch(/try\s*\{/);
        const catchIdx = BOARD.indexOf('catch', idx);
        expect(catchIdx).toBeGreaterThan(idx);
        expect(BOARD.slice(catchIdx, catchIdx + 800)).toMatch(/this\._abandonOneWorld\(error\)/);
        const methodIdx = BOARD.indexOf('_abandonOneWorld(error) {');
        expect(methodIdx).toBeGreaterThan(-1);
        const method = BOARD.slice(methodIdx, methodIdx + 800);
        expect(method).toMatch(/oneWorldEnabled = false/);
        // The chapters stay the world's: there is nothing to hand them back to.
        expect(method).not.toMatch(/suppressedChapters/);
    });

    it('gives the world\'s chapters their corridor backdrop when the world is missing', () => {
        // Built after the world: a failed build leaves the sheets in (oneWorldEnabled is false).
        expect(BOARD).toMatch(/new OdysseyCorridorField\(this\.scene, \{[\s\S]{0,300}suppressedChapters: this\.oneWorldEnabled \? ONE_WORLD_CHAPTERS : \[\]/);
        // A world that fails to compile later goes after the field is built: it fills them in.
        const idx = BOARD.indexOf('_abandonWorldAfterFailedCompile(error, group) {');
        expect(BOARD.slice(idx, idx + 300)).toMatch(/this\.corridorField\?\.fillSuppressedChapters\(\)/);
    });
});
