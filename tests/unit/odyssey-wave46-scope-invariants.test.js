import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ONE_WORLD_CHAPTERS } from '../../src/rendering/odyssey/chapter-environments/registry.js';

/**
 * WHAT THE RETIRED CHAPTERS DID NOT TAKE WITH THEM.
 *
 * The chapter 2-5 scenes are gone (ADR-0022), but the seam machinery they grew up with is not
 * theirs alone: the chapters that still draw depend on it. Each test here pins a consumer whose
 * existence makes a further deletion unsafe, so a tidy-up of "old diorama code" breaks a test
 * instead of the game.
 *
 * If one of these fails, do not "fix" it by loosening the test. It means someone deleted a
 * live consumer, and the question is whether that consumer was supposed to die first.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const CHAPTER_DIR = 'src/rendering/odyssey/chapter-environments';

describe('Wave 6 — most ecotone bridges belong to chapters that still draw', () => {
    /** The real construct, not the comment string the plan counted. */
    const bridgesIn = (rel) => (read(rel).match(/material\.uniforms = \{/g) ?? []).length;

    it('chapters 1, 7 and 8 carry the majority of bridges and still render', () => {
        const live = {
            'ch1 earth-core': bridgesIn(`${CHAPTER_DIR}/earth-core.js`)
                + bridgesIn(`${CHAPTER_DIR}/earth-core.tsl.js`),
            'ch7 black-hole': bridgesIn(`${CHAPTER_DIR}/black-hole-transcendence.tsl.js`),
            'ch8 urban-dreams': bridgesIn(`${CHAPTER_DIR}/urban-dreams.tsl.js`),
        };
        Object.entries(live).forEach(([label, count]) => {
            expect(count, `${label} must keep its uOpacity bridges`).toBeGreaterThan(0);
        });
        // r181 makes material.opacity a DEAD WRITE wherever an opacityNode is authored, so the
        // bridge IS the crossfade. Remove these and ch1/7/8 snap on and off at their seams.
        const total = Object.values(live).reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThanOrEqual(30);
    });

    it('none of chapters 1, 6, 7, 8 is drawn by the One World', () => {
        [1, 6, 7, 8].forEach((id) => expect(ONE_WORLD_CHAPTERS).not.toContain(id));
    });

    it('SEAM_56 survives — it is what the player sees at the 5->6 act edge', () => {
        // The world's fog handoff weight ramps to ZERO at the act edges, so at 5->6 the
        // bridged colour is the visible one. The 3-4 and 4-5 windows were the stale pair.
        const bridges = read(`${CHAPTER_DIR}/shared/seam-bridges.js`);
        expect(bridges).toMatch(/SEAM_56_AURORA_BRIDGE/);
        expect(read('src/rendering/odyssey/ChapterEnvironmentManager.js'))
            .toMatch(/SEAM_56_AURORA_BRIDGE/);
    });
});
