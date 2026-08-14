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
     * The gate has to skip the BUILD, not merely the mounting. The forest's own measured
     * header law is that its cost is VERTEX, not fill ("collapsing distant instances to
     * degenerate triangles changed nothing; giving three real bounds to cull against halved
     * it"), so a gate that constructed 40 InstancedMeshes and only hid them would leave the
     * vertex and pipeline cost on both sides of the pair and price the wrong half.
     */
    it('gates the SCATTER, so no mesh and no pipeline exist on the off side', () => {
        // `forest && !forestV2` since Wave 3: the two forests are alternatives, so the
        // incumbent's scatter is gated on BOTH. The lever still switches the whole forest off.
        expect(RENDERER).toMatch(/const trees = \(forest && !forestV2\)\s*\n\s*\? scatterTrees\(/);
        // ...and nothing else may re-introduce an ungated scatter.
        expect(RENDERER).not.toMatch(/const trees = scatterTrees\(/);
        // The v2 forest is gated too, or `?odysseyWorldNoForest=1` would leave half a forest.
        expect(RENDERER).toMatch(/if \(forest && forestV2\) \{/);
    });

    /**
     * ADR-0015: a measurement lever is only honest while the thing it removes is still
     * genuinely built on the other side. Asserting the default alone would still pass if the
     * forest were deleted outright.
     */
    it('keeps the forest itself intact — the lever removes it, it is not gone', () => {
        // Loose on the parameter list: Wave 0b gave it a `blobNormals` argument. This test is
        // about the builder still EXISTING, not about its arity.
        expect(RENDERER).toMatch(/function buildTreeGeometry\(/);
        expect(RENDERER).toMatch(/export function scatterTrees\(/);
        expect(RENDERER).toMatch(/odyssey-world-forest-chunk/);
    });

    /**
     * `treeMat` must stay a `const`-declared NodeMaterial built on BOTH sides of the pair:
     * the fog opt-out lint in odyssey-world-lints.test.js requires the fog=false list to
     * equal the set of const NodeMaterial declarations exactly, and the dispose list has to
     * keep covering it. Building it unconditionally is also what keeps the gate a small diff
     * with no dangling references — TSL nodes are plain JS until a mesh using them renders.
     */
    it('builds treeMat unconditionally so the fog and dispose lists still cover it', () => {
        expect(RENDERER).toMatch(/const treeMat = new THREE\.MeshBasicNodeMaterial\(\);/);
        const list = /\[groundMat, waterMat, skyMat, treeMat, [^\]]*\]\.forEach/;
        expect(RENDERER).toMatch(new RegExp(`${list.source}\\(\\(m\\) => \\{ m\\.fog = false; \\}\\)`));
        expect(RENDERER).toMatch(new RegExp(`${list.source}\\(\\(m\\) => m\\.dispose\\(\\)\\)`));
    });
});

/**
 * BEHAVIOUR, not source text. `createOdysseyWorld` builds fine headless — only RENDERING
 * needs a device — so the lever's actual effect is testable, and a source assertion alone
 * would not catch a gate that was wired to the wrong variable. Both worlds are built once at
 * `low` quality (the cheap lane: 6,028 trees / 39 chunks) and shared.
 */
describe('the lever actually removes the forest (measured, not asserted from source)', () => {
    let on;
    let off;

    beforeAll(() => {
        on = createOdysseyWorld({ quality: 'low' });
        off = createOdysseyWorld({ quality: 'low', forest: false });
    });

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

    /**
     * The claim the gate's own comment makes, made falsifiable: `treeMat` is built on BOTH
     * sides. `dispose()` unconditionally calls `treeMat.dispose()`, so if the material had
     * been gated away with the meshes this would throw on a dangling reference — which is
     * also exactly how the fog opt-out lint and the dispose list would have started lying.
     */
    it('still builds treeMat with the forest off, so dispose stays whole', () => {
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

    /**
     * SWAP POLARITY (2026-08-14). The roster ships, so baseline CONTAINS it and `forestMs`
     * prices the NEW forest; the retired incumbent is the opt-in lever, priced against the
     * forest's absence. And the migration flag must be DEAD EVERYWHERE it was read — a lever
     * that silently does nothing reports innocence, not absence.
     */
    it('flips the harness polarity with the swap and kills the migration flag', () => {
        expect(SPLIT).toMatch(/id: 'forest-v1'/);
        expect(SPLIT).toMatch(/odysseyWorldForestV1:\s*'1'/);
        expect(SPLIT).toMatch(/forestV1Ms:\s*delta\('forest-v1',\s*'no-forest'\)/);
        expect(BOARD).toMatch(/forestV2:\s*!readBooleanUrlFlag\('odysseyWorldForestV1'\)/);
        // The dead-lever law, enforced: nothing may READ the retired migration flag.
        expect(BOARD).not.toMatch(/readBooleanUrlFlag\('odysseyWorldForestV2'\)/);
        expect(SPLIT).not.toMatch(/odysseyWorldForestV2/);
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
