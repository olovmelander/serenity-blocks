// @ts-check
// The bootstrap and driver ship to the page as SOURCE STRINGS, so a syntax check is the only
// way to test them here; new Function is the check, not an eval of untrusted input.
/* eslint-disable no-new-func */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    GPU_QUANTUM_MS,
    THEME_PERF_BOOTSTRAP,
    buildPerfVisitSource,
    classifyPipelines,
    contentMismatch,
    pinsBrokenReason,
    quantile,
    reduceVisit,
} from '../../scripts/lib/theme-perf-instrument.mjs';
import { buildThemePerfCell, rankThemePerfCells } from '../../scripts/lib/theme-perf-cell.mjs';

const BASE_THEME = readFileSync(new URL('../../src/themes/base-theme.js', import.meta.url), 'utf8');

describe('theme perf bootstrap source', () => {
    it('is syntactically valid and self-guards against double installation', () => {
        expect(() => new Function(THEME_PERF_BOOTSTRAP)).not.toThrow();
        expect(THEME_PERF_BOOTSTRAP).toContain('if (window.__THEME_PERF__) return;');
    });

    it('hooks BOTH pipeline creation paths, and records the sync one with a null duration', () => {
        // The sync call returns before the GPU compiles, so any duration measured around it is a
        // lie; it is recorded because it is the post-reveal stall candidate.
        expect(THEME_PERF_BOOTSTRAP).toContain('GPUDevice.prototype.createRenderPipelineAsync');
        expect(THEME_PERF_BOOTSTRAP).toContain('GPUDevice.prototype.createRenderPipeline =');
        const syncPush = /createRenderPipeline = function \(desc\) \{[\s\S]*?S\.pipes\.push\(\{[^}]*ms: null/;
        expect(THEME_PERF_BOOTSTRAP).toMatch(syncPush);
    });

    it('captures the pipeline label synchronously, before three resets its shared descriptor', () => {
        const asyncBody = THEME_PERF_BOOTSTRAP.slice(
            THEME_PERF_BOOTSTRAP.indexOf('createRenderPipelineAsync = function'),
            THEME_PERF_BOOTSTRAP.indexOf('const Sy ='),
        );
        expect(asyncBody.indexOf('const label =')).toBeLessThan(asyncBody.indexOf('A.call(this, desc)'));
        expect(asyncBody.indexOf('const shp =')).toBeLessThan(asyncBody.indexOf('A.call(this, desc)'));
    });

    it('pushes a GPU sample only from a resolved query, and guards it with an epoch', () => {
        const resolve = THEME_PERF_BOOTSTRAP.slice(THEME_PERF_BOOTSTRAP.indexOf('S.resolveRender'));
        expect(resolve).toContain('resolveTimestampsAsync');
        expect(resolve).toContain('epoch === S.epoch');
        expect(resolve).toContain('S.rings.gpu.push(ts)');
        // Exactly one push site for the GPU ring in the whole bootstrap.
        expect(THEME_PERF_BOOTSTRAP.match(/S\.rings\.gpu\.push/g)).toHaveLength(1);
    });

    it('bumps the epoch before clearing, so an in-flight resolve cannot land in the new window', () => {
        const reset = THEME_PERF_BOOTSTRAP.slice(THEME_PERF_BOOTSTRAP.indexOf('__THEME_PERF_RESET__'));
        expect(reset.indexOf('S.epoch += 1')).toBeLessThan(reset.indexOf('S.rings.gpu.length = 0'));
    });

    it('gates on renderer KIND, not backend (ADR-0019)', () => {
        expect(THEME_PERF_BOOTSTRAP).toContain("renderer.isWebGPURenderer === true ? 'WebGPURenderer'");
    });

    it('checks the timestamp feature before re-arming trackTimestamp', () => {
        // WebGPUBackend.init collapses trackTimestamp against feature support once and never
        // re-checks, so an unguarded flip arms writes on a device that cannot serve them.
        const arm = THEME_PERF_BOOTSTRAP.slice(THEME_PERF_BOOTSTRAP.indexOf('S.armWhenReady'));
        expect(arm.indexOf("features.has('timestamp-query')")).toBeLessThan(
            arm.indexOf('backend.trackTimestamp = true'),
        );
    });

    it('counts draws by DELTA across each render call, so a theme owning Info does not break it', () => {
        // Reading-then-resetting fought cosmic-noir/ocean/stillwater, which own Info themselves;
        // the first measured cell came back 0 draws. The lane must not reset Info at all.
        expect(THEME_PERF_BOOTSTRAP).toContain('S.countAround');
        expect(THEME_PERF_BOOTSTRAP).not.toContain('S.renderer.info.reset()');
        expect(THEME_PERF_BOOTSTRAP).toContain('S.infoResetsByTheme += 1');
    });
});

describe('base-theme seams', () => {
    it('notes the theme start BEFORE createScene, where the renderer is built', () => {
        const noteAt = BASE_THEME.indexOf('__THEME_PERF__.noteThemeStart');
        const createAt = BASE_THEME.indexOf('await this.createScene(startGeneration)');
        expect(noteAt).toBeGreaterThan(-1);
        expect(noteAt).toBeLessThan(createAt);
    });

    it('guards both seams so shipping code without the lane is a plain undefined read', () => {
        for (const hook of ['noteThemeStart', 'noteThemeStop']) {
            const at = BASE_THEME.indexOf(`__THEME_PERF__.${hook}`);
            expect(at).toBeGreaterThan(-1);
            const before = BASE_THEME.slice(Math.max(0, at - 200), at);
            expect(before).toContain('window.__THEME_PERF__');
            expect(before).toContain("typeof window !== 'undefined'");
        }
    });
});

describe('visit driver source', () => {
    const src = buildPerfVisitSource({
        themeId: 'cosmic-noir', anchorTheme: 'forest', idleMs: 20000, settleMs: 4000,
    });

    it('is syntactically valid', () => {
        expect(() => new Function(`return ${src}`)).not.toThrow();
    });

    it('drives switchTheme directly rather than the hub card', () => {
        expect(src).toContain('manager.switchTheme("cosmic-noir", true)');
        expect(src).not.toContain('selectTargetViaCard');
    });

    it('discards the compile window from the idle rings', () => {
        const resetAt = src.lastIndexOf('__THEME_PERF_RESET__()');
        const laneAt = src.indexOf('S.startLane()');
        expect(resetAt).toBeLessThan(laneAt);
    });
});

describe('reduceVisit', () => {
    const raw = {
        themeId: 't',
        anchorTheme: 'forest',
        marks: {
            t0_requested: 100,
            t2_createSceneEnter: 120,
            t3_rendererCreated: 130,
            t5_criticalReady: 400,
            t6_firstRenderCall: 410,
            t7_firstGpuWorkDone: 430,
            t8_firstRafAfterGpu: 445,
            t4_startResolved: 390,
        },
        switchWallMs: 290,
        managerReportedMs: 250,
        gpuDoneMethod: 'queue.onSubmittedWorkDone',
        compilePipes: [
            {
                label: 'renderPipeline_MeshBasicNodeMaterial_7', ms: 1200, atMs: 10, async: true, targets: 'rgba16float', samples: 1, depth: 'depth24plus',
            },
            {
                label: 'renderPipeline_Foo_9', ms: null, atMs: 20, async: false, targets: 'bgra8unorm', samples: 1, depth: null,
            },
        ],
        idlePipes: 0,
        rings: {
            wall: [16, 17, 16, 40], cpu: [2, 3, 2, 2], gpu: [1.1, 1.2, 1.15], calls: [61, 61, 61], tris: [1000, 1000, 1000],
        },
        framesObserved: 4,
        windowMs: 20000,
        longTasks: { count: 1, totalMs: 30, maxMs: 30 },
        heap: [1000, 1100, 1200],
        infoResetsByTheme: 0,
        renderer: {
            kind: 'WebGPURenderer', backend: 'webgpu', trackTimestampArmed: true, timestampUnavailableReason: null,
        },
        info: { geometries: 5, textures: 3 },
        materialsById: { 7: { type: 'MeshBasicNodeMaterial', name: null, isNodeMaterial: true } },
        pins: {
            atStart: {
                quality: 'High', targetFrameRate: 60, devicePixelRatio: 1, rendererPixelRatio: 1,
            },
            atEnd: {
                quality: 'High', targetFrameRate: 60, devicePixelRatio: 1, rendererPixelRatio: 1,
            },
        },
    };

    it('separates async and sync pipelines and never gives a sync row a duration', () => {
        const v = reduceVisit(raw);
        expect(v.pipelines.asyncCount).toBe(1);
        expect(v.pipelines.syncCount).toBe(1);
        expect(v.pipelines.syncRows[0].ms).toBeNull();
        expect(v.pipelines.asyncMaxMs).toBe(1200);
    });

    it('resolves the material class from the scene, and says so when it cannot', () => {
        const v = reduceVisit(raw);
        expect(v.pipelines.rows[0].materialClass).toBe('MeshBasicNodeMaterial');
        expect(v.pipelines.syncRows[0].materialClass).toBeNull();
        expect(v.pipelines.syncRows[0].materialClassReason).toBe('not-in-scene-at-collection');
    });

    it('flags the sticky-sampler signature when GPU samples reach the frame count', () => {
        const sticky = { ...raw, rings: { ...raw.rings, gpu: [1, 1, 1, 1] } };
        expect(reduceVisit(sticky).idle.gpuMs.stickySamplerSuspected).toBe(true);
        expect(reduceVisit(raw).idle.gpuMs.stickySamplerSuspected).toBe(false);
    });

    it('voids the allocation figure when a GC ran inside the window', () => {
        const gc = { ...raw, heap: [1000, 1200, 900, 1000] };
        const v = reduceVisit(gc);
        expect(v.memory.allocBytesPerFrame).toBeNull();
        expect(v.memory.allocVoidReason).toMatch(/GC/);
    });

    it('carries the GPU quantum so a sub-tick delta is never read as zero cost', () => {
        expect(reduceVisit(raw).idle.gpuMs.quantumMs).toBe(GPU_QUANTUM_MS);
    });
});

describe('guards', () => {
    it('quantile uses nearest-rank and returns null for an empty series', () => {
        expect(quantile([], 0.5)).toBeNull();
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
        expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    });

    it('contentMismatch requires exact draw calls and triangles within 2 %', () => {
        const mk = (c, t) => ({ content: { drawCalls: { p50: c }, triangles: { p50: t } } });
        expect(contentMismatch(mk(61, 1000), mk(61, 1015))).toBeNull();
        expect(contentMismatch(mk(61, 1000), mk(39, 1000))).toMatch(/draw calls differ/);
        expect(contentMismatch(mk(61, 1000), mk(61, 1100))).toMatch(/triangles differ/);
    });

    it('pinsBrokenReason names the pin that moved', () => {
        expect(pinsBrokenReason({ atStart: { quality: 'High' }, atEnd: { quality: 'High' } })).toBeNull();
        expect(pinsBrokenReason({ atStart: { quality: 'High' }, atEnd: { quality: 'Medium' } }))
            .toMatch(/quality moved High -> Medium/);
        expect(pinsBrokenReason(null)).toMatch(/not observed/);
    });

    it('classifyPipelines never guesses a class it cannot join', () => {
        const [row] = classifyPipelines([{ label: 'renderPipeline_X_42', async: true, ms: 5 }], {});
        expect(row.materialClass).toBeNull();
        expect(row.materialClassReason).toBe('not-in-scene-at-collection');
    });
});

describe('cell builder', () => {
    const visit = (overrides = {}) => ({
        theme: 't',
        renderer: { kind: 'WebGPURenderer' },
        switchTimings: { switchWallMs: 100 },
        pipelines: { asyncCount: 1, syncCount: 0, asyncMaxMs: 900 },
        idle: { wall: { samples: 100, p95: 16 }, gpuMs: { samples: 20, p50: 1.1, stickySamplerSuspected: false }, cpuSubmitMs: { p95: 3 } },
        content: { drawCalls: { p50: 61 }, triangles: { p50: 1000 }, infoOwnership: 'lane' },
        memory: { allocBytesPerFrame: 10 },
        pins: { atStart: { quality: 'High' }, atEnd: { quality: 'High' } },
        ...overrides,
    });

    const base = {
        theme: 't',
        anchorTheme: 'forest',
        themeMeta: {},
        manifest: {},
        runId: 'r',
        generatedAt: '2026-08-24T00:00:00.000Z',
    };

    it('voids the content guard on 0 draws instead of passing it', () => {
        const zero = visit({ content: { drawCalls: { p50: 0 }, triangles: { p50: 0 } } });
        const cell = buildThemePerfCell({ ...base, visit1: zero, visit2: zero });
        expect(cell.content.contentMatch).toBe(false);
        expect(cell.content.contentMismatchReason).toMatch(/no draw calls observed/);
    });

    it('is admissible when every guard passes', () => {
        const cell = buildThemePerfCell({ ...base, visit1: visit(), visit2: visit() });
        expect(cell.admissible).toBe(true);
        expect(cell.inadmissibleReasons).toEqual([]);
    });

    it('voids the DIFFERENTIAL on a content mismatch but keeps the single-visit timings', () => {
        // ADR-0016 requires content matching for a differential. The switch wall clock and the
        // pipeline compiles are single-visit measurements and never depended on visit 2 — ocean's
        // draws differing between visits is the lazily-streamed fauna the census predicted, and
        // suppressing its switch number over that would throw the finding away.
        const v2 = visit({ content: { drawCalls: { p50: 39 }, triangles: { p50: 1000 }, infoOwnership: 'lane' } });
        const cell = buildThemePerfCell({ ...base, visit1: visit(), visit2: v2 });
        expect(cell.drift.visitGpuP50DeltaMs).toBeNull();
        expect(cell.drift.voidReason).toMatch(/draw calls differ/);
        expect(cell.drift.admissible).toBe(false);
        expect(cell.admissible).toBe(true);
    });

    it('treats a theme with no three renderer as measurable, not failed', () => {
        const v = visit({
            renderer: { kind: null },
            content: { drawCalls: { p50: 0 }, triangles: { p50: 0 } },
            idle: { wall: { samples: 100 }, gpuMs: { samples: 0 }, cpuSubmitMs: {} },
        });
        const cell = buildThemePerfCell({ ...base, visit1: v, visit2: v });
        expect(cell.admissible).toBe(true);
        expect(cell.content.contentMismatchReason).toMatch(/owns no three renderer/);
    });

    it('does not demand a GPU series from a classic WebGLRenderer', () => {
        const v = visit({
            renderer: { kind: 'WebGLRenderer' },
            idle: { wall: { samples: 100 }, gpuMs: { samples: 0 }, cpuSubmitMs: {} },
        });
        const cell = buildThemePerfCell({ ...base, visit1: v, visit2: v });
        expect(cell.admissible).toBe(true);
    });

    it('records a theme that owns Info without disqualifying the cell', () => {
        // Delta counting is owner-agnostic, so a theme resetting Info is provenance, not a fault.
        const v = visit({ content: { drawCalls: { p50: 61 }, triangles: { p50: 1000 }, infoOwnership: 'contested' } });
        const cell = buildThemePerfCell({ ...base, visit1: v, visit2: v });
        expect(cell.content.infoOwnership).toBe('contested');
        expect(cell.admissible).toBe(true);
    });

    it('ranks by worst pipeline first, then switch wall clock', () => {
        const mk = (theme, worst, wall) => ({
            theme,
            admissible: true,
            pipelines: { asyncMaxMs: worst },
            switchTimings: { switchWallMs: wall },
            idle: {},
            content: {},
            memory: {},
            renderer: {},
        });
        const ranked = rankThemePerfCells([mk('a', 100, 900), mk('b', 3000, 100), mk('c', 100, 5000)]);
        expect(ranked.map((r) => r.theme)).toEqual(['b', 'c', 'a']);
    });
});
