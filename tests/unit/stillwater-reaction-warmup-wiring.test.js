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
    it('reveals BEFORE the bound compile and BEFORE the warm render', () => {
        // INVERTED 2026-08-26 (sweep §30), and the inversion is load-bearing in the new
        // direction. The original ordering (reveal AFTER compile) guarded a hazard of the BARE
        // compileAsync: no target bound, one-output shaders baked under an MRT-agnostic key.
        // The compile is now compileGroupThroughPost, which holds the scene pass's target and
        // MRT across the whole await — so a reveal live across it warms hidden materials under
        // the exact live context. Keeping the reveal after the compile costs 18 scene-pass
        // pipelines compiled synchronously on the first live frame (measured; they were hidden
        // at warm time and outside getWarmupRoots()). Do not "restore" the reveal below the
        // compile without also unbinding it.
        const slice = warmRuntimeSlice();
        const compile = slice.indexOf('compileGroupThroughPost(');
        const reveal = slice.indexOf('revealHiddenDrawables');
        const render = slice.indexOf("renderRuntime('warmup')");

        expect(compile).toBeGreaterThan(-1);
        expect(reveal).toBeGreaterThan(-1);
        expect(reveal).toBeLessThan(compile);
        expect(render).toBeGreaterThan(compile);
    });

    it('the reveal spans the whole scene, and the reflector context gets its own bound pass', () => {
        // 44 residual sync pipelines, classified (sweep §30): 18 were hidden-at-warm scene
        // materials (the reveal used to cover only the 3 reaction roots), 16 were the same
        // materials compiled AGAIN for the reflector's target formats. The first class needs
        // the scene-wide reveal; the second needs a compile bound to a reflector-shaped target
        // (HalfFloatType, samples 0 — ReflectorNode.js:412; the pipeline cache keys on formats,
        // not texture identity).
        const slice = warmRuntimeSlice();
        expect(slice).toMatch(/revealHiddenDrawables\(this\.scene,/);
        expect(slice).toMatch(/reflectorWarmTarget = new THREE\.RenderTarget\(/);
        expect(slice).toMatch(/type: THREE\.HalfFloatType/);
        expect(slice).toMatch(/reflectorWarmTarget\.dispose\(\)/);
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
