import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The harness must not publish a differential between two runs that rendered different
 * scenes. The 2026-08-12 Lane A run did exactly that: `baseline` 53 draws / 758,151 tris vs
 * `baseline-repeat` 39 / 535,543 — the camera had drifted off the seeked station — and the
 * resulting 0.786 ms of scene difference was published as `baselineDriftMs`, i.e. as thermal
 * drift. A wrong number is worse than a missing one, because it gets quoted.
 *
 * Source-asserted: the harness is an Electron entry point that cannot be imported under
 * vitest (it touches `app.commandLine` at module scope). What must not regress is that the
 * guard exists, is applied to the drift figure, and records WHY it voided.
 */
const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);
const SRC = readFileSync(path.join(ROOT, 'scripts/odyssey-gpu-split.mjs'), 'utf8');

describe('gpu-split content-match guard', () => {
    it('compares draw calls and triangles between the two baselines', () => {
        expect(SRC).toMatch(/function contentMismatch\(/);
        expect(SRC).toMatch(/A\.drawCalls !== B\.drawCalls/);
        expect(SRC).toMatch(/Math\.abs\(ta - tb\) > Math\.max\(ta, tb\) \* 0\.02/);
    });

    it('voids baselineDriftMs on a mismatch instead of publishing it', () => {
        expect(SRC).toMatch(/const driftMismatch = contentMismatch\('baseline', 'baseline-repeat', results\)/);
        expect(SRC).toMatch(/baselineDriftMs: driftMismatch \? null : delta\('baseline', 'baseline-repeat'\)/);
    });

    it('records the reason, so a null reads as "voided" rather than "not run"', () => {
        expect(SRC).toMatch(/baselineDriftVoidReason: driftMismatch/);
    });
});
