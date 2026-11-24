import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    beforeAll, describe, expect, it,
} from 'vitest';

import { createOdysseyWorld } from './odyssey-world-renderer.js';

/**
 * FOREST PLAN, WAVE 0a — the forest becomes measurable.
 *
 * `?odysseyWorldNoForest=1` / gpu-split `no-forest` exist so the Act II forest can be priced
 * as a differential for the first time. Until this landed, the largest content system in
 * `odyssey-world-renderer.js` (15,412 trees, 40 InstancedMesh chunks, ~462k triangles) had
 * never been measured, because nothing in the tree could switch it off — and ADR-0016 says
 * an unmeasured cost cannot fund a package. The whole overhaul is gated on the number this
 * lever produces.
 *
 * Source assertions rather than a mounted world, for the reason `odyssey-cloud-swap.test.js`
 * and `odyssey-world-default.test.js` both give: `createOdysseyWorld` needs a WebGPU device,
 * and what is worth pinning is a POLICY — that the forest ships by default, that the lever
 * removes exactly what its name claims, and that its polarity in the harness matches.
 *
 * The polarity assertions are not padding. This repo has published a wrong measurement from
 * a mis-signed lever twice: `odysseyWorldNoHeroes` was read by a path that no longer drew the
 * heroes (a flag that silently does nothing reports innocence, not absence), and `heroesMs`
 * was sign-flipped TWICE — arguments swapped AND negated — which cancels out to look
 * plausible while being derived backwards. A lever's polarity has to follow what SHIPS.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RENDERER = read('src/rendering/odyssey/world/odyssey-world-renderer.js');
const BOARD = read('src/rendering/odyssey/OdysseyBoardController.js');
const SPLIT = read('scripts/odyssey-gpu-split.mjs');
const BUDGETS = JSON.parse(read('perf-budgets.json'));

describe('the forest ships by default and can be switched off for measurement', () => {
    it('defaults the forest ON in the renderer signature', () => {
        expect(RENDERER).toMatch(/\bforest = true,/);
        // The inverse. If this ever matches, every station capture and every perf pair since
        // has been taken against a treeless Act II.
        expect(RENDERER).not.toMatch(/\bforest = false,/);
    });

    it('reads the forest as opt-OUT on the board', () => {
        expect(BOARD).toMatch(/forest:\s*!readBooleanUrlFlag\('odysseyWorldNoForest'\)/);
        // The inverse: a bare (un-negated) read would make the SHIPPED default treeless while
        // the flag's name still said "no forest" — the polarity trap, in its purest form.
        expect(BOARD).not.toMatch(/forest:\s*readBooleanUrlFlag\(/);
    });

    /**
     * The gate has to skip the BUILD, not merely the mounting: meshes built and only hidden would
     * leave the vertex and pipeline cost on both sides of the pair and price the wrong half.
     */
    it('gates the SCATTER, so no mesh and no pipeline exist on the off side', () => {
        expect(RENDERER).toMatch(/if \(forest\) \{[^]*?scatterZonedForest\(relief\.sample, scatterOptions\)/);
        expect((RENDERER.match(/scatterZonedForest\(/g) || []).length).toBe(1);
        // ...and the photographs are not fetched for a world without it.
        expect(RENDERER).toMatch(/createForestTextures\(\{ load: forest,/);
    });

    it('builds the materials on both sides, so the dispose list stays whole', () => {
        expect(RENDERER).toMatch(/const forestMats = createForestMaterials\(\{/);
        expect(RENDERER).toMatch(/forestMats\.near\.dispose\(\);/);
        expect(RENDERER).toMatch(/forestTextures\.dispose\(\);/);
    });
});

/**
 * BEHAVIOUR, not source text. `createOdysseyWorld` builds fine headless — only RENDERING
 * needs a device — so the lever's actual effect is testable, and a source assertion alone
 * would not catch a gate that was wired to the wrong variable. Both worlds are built once at
 * `low` quality (the cheap lane) and shared.
 */
describe('the lever actually removes the forest (measured, not asserted from source)', () => {
    let on;
    let off;

    beforeAll(() => {
        on = createOdysseyWorld({ quality: 'low' });
        off = createOdysseyWorld({ quality: 'low', forest: false });
    }, 30_000); // two whole worlds, synchronously: 9.6-10.9 s on a 4-core cloud runner, over the 10 s default

    const forestMeshes = (world) => {
        const found = [];
        world.group.traverse((o) => { if (o.name?.includes('forest')) found.push(o); });
        return found;
    };

    it('builds the whole forest by default', () => {
        expect(on.stats.trees).toBeGreaterThan(1000);
        expect(on.stats.forestChunks).toBeGreaterThan(10);
        // The chunks are what the GPU actually sees; stats and scene graph must agree, or the
        // differential would be priced against a count that is not on screen.
        expect(forestMeshes(on)).toHaveLength(on.stats.forestChunks);
    });

    it('leaves nothing of the forest in the scene graph when switched off', () => {
        expect(off.stats.trees).toBe(0);
        expect(off.stats.forestChunks).toBe(0);
        expect(forestMeshes(off)).toHaveLength(0);
    });

    it('disposes whole with the forest off', () => {
        expect(() => off.dispose()).not.toThrow();
        expect(() => on.dispose()).not.toThrow();
    });
});

describe('the forest gpu-split lever points at what it measures', () => {
    it('prices the forest by REMOVING it, like water and the cloud field', () => {
        // Argument order carries the sign — `delta(a, b)` is a minus b. The shipped
        // configuration must be the one that CONTAINS the feature, so a shipped system's
        // lever REMOVES it and its cost is baseline minus configuration. Positive means cost.
        expect(SPLIT).toMatch(/forestMs:\s*delta\('baseline',\s*'no-forest'\)/);
        // The double-flip that nearly published the heroes as a saving.
        expect(SPLIT).not.toMatch(/forestMs:\s*delta\('no-forest',\s*'baseline'\)/);
        expect(SPLIT).not.toMatch(/forestMs:\s*-/);
    });

    it('drives the configuration with the flag the board actually reads', () => {
        expect(SPLIT).toMatch(/id: 'no-forest'/);
        expect(SPLIT).toMatch(/odysseyWorldNoForest:\s*'1'/);
    });

    it('reads no retired lever (a dead lever reports innocence, not absence)', () => {
        ['odysseyWorldForestV1', 'odysseyWorldForestV2', 'odysseyWorldForestPaint', 'odysseyWorldProceduralTrees', 'odysseyForestGreens']
            .forEach((name) => {
                expect(BOARD, name).not.toContain(name);
                expect(SPLIT, name).not.toContain(name);
            });
    });

    /**
     * FLIPPED 2026-08-14, exactly as this test said it would be: "when the first admissible pair
     * lands this becomes a number and this assertion flips to a range check". It has landed —
     * Lane B, drift 0.000, `forestMs` 1.507 ms — so the cell is no longer allowed to go BACK to
     * null. Re-nulling a measured cell is how a hard-won number quietly leaves the ledger.
     */
    it('keeps the measured Lane B forest cost in the ledger', () => {
        const cell = BUDGETS?.budgets?.odysseyAct2ForestMsLaneB;
        expect(cell).toBeTruthy();
        expect(cell.baseline).toBeGreaterThan(0.5);
        expect(cell.baseline).toBeLessThan(5);
        expect(cell.note).toMatch(/no-forest/);
        // The pair is only meaningful with its drift and its lane recorded beside it.
        expect(cell.note).toMatch(/baselineDriftMs EXACTLY 0\.000/);
        expect(cell.note).toMatch(/Lane B/);
    });
});
