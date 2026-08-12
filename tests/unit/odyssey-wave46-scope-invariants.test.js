import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WAVES 4 AND 6 — the deletions that must NOT happen, encoded so they cannot be re-proposed.
 *
 * Both waves were written as "delete code only the ?odysseyOneWorld=0 fallback reaches". A
 * 13-agent audit tested that premise with two independent adversarial lenses per target and
 * ALL EIGHT passes refuted it. The plan now records the corrected scope in prose — but prose
 * does not fail a build, and this exact claim has already been believed twice. These tests
 * are the enforcement: each one pins a specific consumer whose existence makes a proposed
 * deletion unsafe, so re-deriving the wrong plan breaks a test instead of the game.
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

describe('Wave 4 — the canonical chain has live consumers outside the suppressed chapters', () => {
    it('the WINTER THEME depends on mountain-language, so it can never be an Odyssey-only delete', () => {
        // The single biggest miss in the original scoping: a shipped game theme, unrelated to
        // Odyssey's chapters, imports the shared alpine language for its own mountains.
        const winter = read('src/themes/winter/winter-theme.js');
        expect(winter).toMatch(/from '\.\.\/\.\.\/rendering\/odyssey\/chapter-environments\/shared\/mountain-language\.js'/);
        expect(winter).toMatch(/mountainCpuDisplacement|mountainColorNode|resolveMountainTreatment/);
    });

    it('canonical-mountain-range is reachable from playground effects, which SHIP', () => {
        // vite.config.js registers playground.html as a rollup input, so these effects and
        // everything they import are part of the production bundle — deleting the module
        // breaks `vite build`, not just a dev page.
        const vite = read('vite.config.js');
        expect(vite).toMatch(/playground: path\.resolve\(projectRoot, 'playground\.html'\)/);
        const effects = readdirSync(path.join(ROOT, 'src/playground/effects'))
            .filter((f) => f.endsWith('.effect.js'))
            .filter((f) => read(`src/playground/effects/${f}`).includes('canonical-mountain-range'));
        expect(effects.length).toBeGreaterThan(0);
    });

    it('the LIVE world still derives its silhouette from the shared spec authority', () => {
        // Wave 4's deletable part is done: the peak geometry moved to world/odyssey-peak-specs.js
        // and the legacy builder derives from it. What must not regress is that direction.
        expect(existsSync(path.join(ROOT, 'src/rendering/odyssey/world/odyssey-peak-specs.js'))).toBe(true);
        expect(read(`${CHAPTER_DIR}/shared/canonical-mountain-range.js`))
            .toMatch(/import \{ ODYSSEY_PEAK_SPECS \}/);
    });
});

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

    it('none of chapters 1, 7, 8 is suppressed by One World', () => {
        const board = read('src/rendering/odyssey/OdysseyBoardController.js');
        const ids = board.match(/const ONE_WORLD_CHAPTERS = \[([^\]]+)\]/)[1]
            .split(',').map((t) => Number(t.trim()));
        [1, 6, 7, 8].forEach((id) => expect(ids).not.toContain(id));
    });

    it('SEAM_56 survives — it is what the player sees at the 5->6 act edge', () => {
        // The world's fog handoff weight ramps to ZERO at the act edges, so at 5->6 the
        // bridged colour is the visible one. The 3-4 and 4-5 windows were the stale pair.
        const bridges = read(`${CHAPTER_DIR}/shared/seam-bridges.js`);
        expect(bridges).toMatch(/SEAM_56_AURORA_BRIDGE/);
        expect(read('src/rendering/odyssey/ChapterEnvironmentManager.js'))
            .toMatch(/SEAM_56_AURORA_BRIDGE/);
    });

    it("ch2's fallback-only bridges are KEPT, because the fallback is kept", () => {
        // The audit listed these as the one safe deletion. They stopped being safe the moment
        // we decided to keep ?odysseyOneWorld=0 as a real crash-recovery path (ADR-0015):
        // deleting them degrades the recovery instead of costing nothing.
        expect(bridgesIn(`${CHAPTER_DIR}/deep-ocean.tsl.js`)).toBeGreaterThan(0);
    });
});
