/**
 * Source contract for the Stillwater reaction prewarm (investigation §10).
 *
 * The fix is three optional-chained hops (theme -> runtime -> reactions.root)
 * plus one ordering constraint. Every one of them degrades to a SILENT no-op if
 * broken — the game keeps working, the stall just comes back. These assertions
 * are what make that a CI failure instead of a regression nobody notices.
 *
 * Convention matches tests/unit/stillwater-masterpiece-integration.test.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const THEME = read('src/themes/stillwater/stillwater-theme.js');
const RUNTIME = read('src/themes/stillwater/rendering/stillwater-runtime.js');
const BASE = read('src/themes/base-theme.js');

/** The body of warmRuntime, where the ordering constraint lives. */
function warmRuntimeSlice() {
    const start = THEME.indexOf('async warmRuntime(');
    expect(start, 'warmRuntime not found').toBeGreaterThan(-1);
    const end = THEME.indexOf('\n    renderRuntime(', start);
    expect(end, 'end of warmRuntime not found').toBeGreaterThan(start);
    return THEME.slice(start, end);
}

describe('Stillwater reaction prewarm — wiring', () => {
    it('the runtime hands out the reaction root', () => {
        expect(RUNTIME).toMatch(/getWarmupRoots:\s*\(\)\s*=>/);
        expect(RUNTIME).toMatch(/reactions\?\.root/);
    });

    it('the theme forwards the runtime roots', () => {
        expect(THEME).toMatch(/getWarmupRoots\(\)\s*\{[\s\S]*?this\.runtime\?\.getWarmupRoots\?\.\(\)/);
    });

    it('the theme reports its MRT scene pass', () => {
        expect(THEME).toMatch(/usesMrtScenePass\(\)\s*\{[\s\S]*?post\?\.useMRT === true/);
    });

    it('BaseTheme declares both hooks so non-declaring themes are unaffected', () => {
        expect(BASE).toMatch(/getWarmupRoots\(\)\s*\{\s*return \[\];\s*\}/);
        expect(BASE).toMatch(/usesMrtScenePass\(\)\s*\{\s*return false;\s*\}/);
    });
});

describe('Stillwater reaction prewarm — load-bearing ordering', () => {
    it('reveals AFTER compileAsync and BEFORE the warm render', () => {
        // This is the single most important constraint in the fix. A reveal that
        // is live across the bare compileAsync would hand the reaction materials
        // to a compile with NO render target bound, baking a one-output shader
        // for the two-attachment pass — the documented poisoned-cache black
        // screen. Do not "simplify" the reveal back above the compile.
        const slice = warmRuntimeSlice();
        const compile = slice.indexOf('compileAsync');
        const reveal = slice.indexOf('revealHiddenDrawables');
        const render = slice.indexOf("renderRuntime('warmup')");

        expect(compile).toBeGreaterThan(-1);
        expect(reveal).toBeGreaterThan(compile);
        expect(render).toBeGreaterThan(reveal);
    });

    it('updates the runtime before revealing, or the reveal un-reveals itself', () => {
        // reactions.update() re-hides anything whose expiry has passed, and every
        // expiry starts at DORMANT_BIRTH.
        const slice = warmRuntimeSlice();
        expect(slice.indexOf('this.runtime.update?.(0, 0)')).toBeLessThan(
            slice.indexOf('revealHiddenDrawables'),
        );
    });

    it('always restores visibility, even if the warm render throws', () => {
        const slice = warmRuntimeSlice();
        expect(slice).toMatch(/finally\s*\{[\s\S]*?reveal\.restore\(\)/);
    });

    it('does NOT await the GPU queue inside warmRuntime', () => {
        // Measured regression: awaiting queue.onSubmittedWorkDone() here yields
        // control for ~200-400ms while the warm render's command buffer is still
        // in flight, and activation rebuilds render targets underneath it,
        // producing a reproducible uncaptured WebGPU error
        // (Destroyed texture [depthBuffer] used in a submit) that is absent
        // without the await. The reveal alone already creates the pipelines
        // (verified in-browser: cache 77 -> 80).
        expect(warmRuntimeSlice()).not.toContain('waitForSubmittedGpuWork');
    });

    it('is disableable for A/B and as an escape hatch', () => {
        expect(warmRuntimeSlice()).toMatch(/readFlag\('stillwaterReactionWarm', true\)/);
    });
});

describe('Stillwater reaction prewarm — telemetry', () => {
    it('declares the warm counters so they survive a lifecycle reset', () => {
        for (const key of ['warmedReactionDraws', 'warmUnreachableDraws']) {
            expect(THEME, `${key} must be declared in createLifecycleCounters`).toContain(`${key}: 0`);
        }
    });
});
