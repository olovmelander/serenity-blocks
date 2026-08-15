import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GROUND PLAN, WAVE 0a — the ground becomes measurable.
 *
 * `?odysseyWorldFlatGround=1` / gpu-split `flat-ground` exist so the Act II ground's FRAGMENT
 * stack can be priced as a differential for the first time. Until this landed, the surface that
 * fills more of the frame than anything else — two detail-bump octaves, an atlas fetch, the
 * biome mixes, curvature, strata, the caustic web and the two-model shadow — had never been
 * measured, because nothing in the tree could switch it off, and ADR-0016 says an unmeasured
 * cost cannot fund a package.
 *
 * WHY THIS LEVER HAS A DIFFERENT SHAPE FROM THE OTHERS. `no-water`, `no-forest` and
 * `no-cloud-field` all never BUILD their subject. The ground cannot: the clipmap IS the world,
 * so removing it removes the station's content, everything grounded on heightAt, and the
 * frame's depth occluder — the differential would compare two different scenes while the
 * content-match guard still passed. So this copies the cloud DECK's asymmetric shape (geometry
 * constructed, only the disputed part withheld) and moves it to the fragment stage.
 *
 * Source assertions rather than a mounted world, for the reason the forest lever test gives:
 * `createOdysseyWorld` needs a WebGPU device to RENDER, and what is worth pinning is a POLICY.
 * The polarity assertions are not padding — this repo has published a wrong measurement from a
 * mis-signed lever twice (`odysseyWorldNoHeroes` read by a path that no longer drew the heroes,
 * and `heroesMs` sign-flipped twice so it cancelled out to look plausible).
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RENDERER = read('src/rendering/odyssey/world/odyssey-world-renderer.js');
const BOARD = read('src/rendering/odyssey/OdysseyBoardController.js');
const SPLIT = read('scripts/odyssey-gpu-split.mjs');
const RIG = read('src/playground/effects/act2-cloud-deck.effect.js');
const BUDGETS = JSON.parse(read('perf-budgets.json'));

/**
 * Strip comments before asserting that a term is ABSENT.
 *
 * Not fussiness: every "this term is gone" assertion below failed on its first run by matching
 * the very comment that explains why the term is gone. A retirement note naming what it retired
 * is exactly the prose a well-documented removal leaves behind, so an absence test that reads
 * comments can never pass a codebase that documents itself.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const RENDERER_CODE = code(RENDERER);

describe('the painted ground ships and can be flattened for measurement', () => {
    it('defaults the lever OFF in the renderer signature', () => {
        expect(RENDERER).toMatch(/\bflatGround = false,/);
        // The inverse. If this ever matches, every capture and every perf pair since has been
        // taken against a grey ground and the whole overhaul is invisible in-game.
        expect(RENDERER).not.toMatch(/\bflatGround = true,/);
    });

    it('reads the lever as opt-IN on the board', () => {
        expect(BOARD).toMatch(/flatGround: readBooleanUrlFlag\('odysseyWorldFlatGround'\)/);
        // A negated read would make the SHIPPED default the grey measurement ground while the
        // flag's name still said "flat ground" — the polarity trap in its purest form.
        expect(BOARD).not.toMatch(/flatGround: !readBooleanUrlFlag\(/);
    });

    /**
     * The lever must withhold the FRAGMENT work and nothing else. If it also skipped geometry,
     * the pair would compare two different scenes; if it skipped nothing, it would measure zero.
     * These two assertions pin both halves against the source.
     */
    it('keeps the geometry identical and swaps only the colour graph', () => {
        // positionNode is built BEFORE the branch, so both sides displace the same vertices.
        const posThenBranch = RENDERER.indexOf('groundMat.positionNode = vec3(');
        const branch = RENDERER.indexOf('if (flatGround) {');
        expect(posThenBranch).toBeGreaterThan(0);
        expect(branch).toBeGreaterThan(posThenBranch);
        // One assignment of colorNode, outside the branch, fed by whichever colour was built.
        // Matched loosely on the ARGUMENT LIST: what this test protects is that a single
        // assignment consumes `groundColour`, not how many tuning parameters applyAerial takes.
        // It first failed when the ground gained its own aerial rate and ceiling — a real
        // change, but not the one this assertion exists to catch.
        expect(RENDERER).toMatch(/groundMat\.colorNode = toOutput\(applyAerial\(groundColour, positionWorld/);
        expect(RENDERER).not.toMatch(/groundMat\.colorNode = toOutput\(applyAerial\(lit,/);
    });

    /**
     * ...and the withheld work must be REAL. A lever that skipped a graph nobody could see
     * would collect a p50 identical to baseline and report a real cost as zero (the heroes'
     * lesson). These are the expensive terms by name; each must live on the painted side only.
     */
    it('withholds the terms the overhaul actually spends on', () => {
        const flatStart = RENDERER.indexOf('if (flatGround) {');
        const flatEnd = RENDERER.indexOf('    } else {', flatStart);
        const flat = code(RENDERER.slice(flatStart, flatEnd));
        expect(flat.length).toBeGreaterThan(100);
        ['groundTex', 'detailTex', 'strata', 'kRock', 'caustic', 'shadeChroma'].forEach((term) => {
            expect(flat).not.toContain(term);
        });
        // The flat side still reads the ONE fetch every lit surface needs, or it would be
        // measuring "no lighting" rather than "no mesostructure".
        expect(flat).toMatch(/flatNdl.*sunVis|sunVis.*flatNdl/s);
    });

    it('is reachable on the graded rig, so the A/B can be SEEN and not only timed', () => {
        expect(RIG).toMatch(/flatGround: params\?\.get\?\.\('flatGround'\) === '1'/);
    });
});

describe('the ground gpu-split lever points at what it measures', () => {
    it('prices the fragment stack by REMOVING it, like water, clouds and the forest', () => {
        // `delta(a, b)` is a minus b, and argument order carries the sign. The shipped
        // configuration must be the one that CONTAINS the feature, so a shipped system's lever
        // REMOVES it and its cost is baseline minus configuration. Positive means cost.
        expect(SPLIT).toMatch(/groundFragMs:\s*delta\('baseline',\s*'flat-ground'\)/);
        // The double-flip that nearly published the heroes as a saving.
        expect(SPLIT).not.toMatch(/groundFragMs:\s*delta\('flat-ground',\s*'baseline'\)/);
        expect(SPLIT).not.toMatch(/groundFragMs:\s*-/);
    });

    it('drives the configuration with the flag the board actually reads', () => {
        expect(SPLIT).toMatch(/id: 'flat-ground'/);
        expect(SPLIT).toMatch(/odysseyWorldFlatGround:\s*'1'/);
    });

    /**
     * FLIPPED 2026-08-15, exactly as this test said it would be: "when the first admissible pair
     * lands this becomes a number and this assertion flips to a range check". It has landed —
     * Lane B, drift EXACTLY 0.000, `groundFragMs` 2.49 ms — so the cell is no longer allowed to
     * go BACK to null. Re-nulling a measured cell is how a hard-won number quietly leaves the
     * ledger.
     */
    it('keeps the measured Lane B ground-fragment cost in the ledger', () => {
        const cell = BUDGETS?.budgets?.odysseyAct2GroundFragMsLaneB;
        expect(cell).toBeTruthy();
        expect(cell.baseline).toBeGreaterThan(1);
        expect(cell.baseline).toBeLessThan(5);
        expect(cell.max).toBeGreaterThan(cell.baseline);
        expect(cell.note).toMatch(/flat-ground/);
        // The pair is only meaningful with its drift and its lane recorded beside it. Note the
        // assertion is that a drift is STATED, not that it is zero: the first admissible pair
        // happened to land at exactly 0.000 and this test pinned that literal, which then
        // failed the moment an honest re-measurement recorded -0.066. A gate that only passes
        // for the luckiest possible reading teaches the next session to delete the gate.
        expect(cell.note).toMatch(/baselineDriftMs\s+(EXACTLY\s+)?-?\d/);
        expect(cell.note).toMatch(/Lane B/);
        // The caveat has to travel with the number, exactly as the deck's does.
        expect(cell.note).toMatch(/FLOOR, not a ceiling/);
    });
});

/**
 * DEAD-LEVER SWEEP (ADR-0015). Two terms were RETIRED during the overhaul after measuring
 * negative, and a retired term that is still read is worse than one that was never written: it
 * reports innocence rather than absence.
 */
describe('the retired terms are gone from the read paths', () => {
    it('no longer applies far pre-desaturation, which measured negative twice', () => {
        expect(RENDERER_CODE).not.toMatch(/presatWindow/);
        expect(RENDERER_CODE).not.toMatch(/ODYSSEY_GROUND_DISTANCE\.presat\b/);
    });

    it('no longer multiplies wide occlusion over the whole lit result', () => {
        // It reaches the image through `ambient` instead — occlusion darkens the sky fill it
        // actually blocks, and leaves direct sun alone. Both together drove a hollow in shadow
        // to 0.195 against the measured 0.27-0.32 band.
        expect(RENDERER_CODE).not.toMatch(/GROUND_AO_STRENGTH/);
        expect(RENDERER).toMatch(/const ambient = mix\(/);
    });

    it('no longer runs procedural noise on the ground, per the file own header law', () => {
        // "Detail comes from a TILED TEXTURE, not procedural noise: ~1 ALU against ~100, worth
        // 6.5 ms." The caustic web was the last exception in this graph and is now a fetch.
        const groundStart = RENDERER.indexOf('    // ── ground ──');
        const groundEnd = RENDERER.indexOf('    // ── sky ──');
        expect(groundStart).toBeGreaterThan(0);
        expect(groundEnd).toBeGreaterThan(groundStart);
        expect(code(RENDERER.slice(groundStart, groundEnd))).not.toContain('snoise3');
    });

    it('killed the sin-times-cos grain plaid the paint replaced', () => {
        // 175 u period at +-3.5%, biome-agnostic — the "uniform full-screen grain multiply"
        // the premium analysis names as an amateur tell, and a second owner of the variegation
        // the moisture field now owns.
        expect(RENDERER_CODE).not.toMatch(/grain\.x\.sin\(\)\.mul\(grain\.y\.cos\(\)\)/);
    });
});
