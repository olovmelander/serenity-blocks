// @ts-check
// The bench's in-page halves ship as SOURCE STRINGS, so a syntax check is the only way to test
// them here; new Function is the check, not an eval of untrusted input.
/* eslint-disable no-new-func */
import { describe, expect, it } from 'vitest';
import {
    BENCH_BOOTSTRAP,
    buildLoadSource,
    buildStartSource,
    buildWindowSource,
    classifyBottleneck,
    frameStats,
    loadFreeze,
    percentile,
    summarizeCell,
    themePresentRate,
} from '../../scripts/lib/theme-fleet-bench-page.mjs';
import { buildTable } from '../../scripts/theme-fleet-bench.mjs';

const BUDGET = 1000 / 240;

/** rAF timestamps for `n` frames of `ms` each, starting at `t0`. */
const frames = (n, ms, t0 = 1000) => Array.from({ length: n + 1 }, (_, i) => t0 + i * ms);

describe('theme fleet bench page sources', () => {
    it('are syntactically valid scripts', () => {
        expect(() => new Function(BENCH_BOOTSTRAP)).not.toThrow();
        expect(() => new Function(`return ${buildStartSource({ quality: 'High', targetFps: 0, anchorTheme: 'nimbus-veil', introWaitMs: 1 })}`)).not.toThrow();
        expect(() => new Function(`return ${buildLoadSource({ themeId: 'summer' })}`)).not.toThrow();
        for (const kind of ['rest', 'storm', 'gpu']) {
            expect(() => new Function(`return ${buildWindowSource({ kind, ms: 10 })}`)).not.toThrow();
        }
    });

    it('measures the real in-play switch, not the perf lane\'s forced classic one', () => {
        expect(BENCH_BOOTSTRAP).toContain("removeItem('serenity.themeSwitchBehind')");
        expect(buildLoadSource({ themeId: 'x' })).toContain("backgroundMode: 'Specific', backgroundTheme: target");
    });

    it('keeps GPU timestamps off outside an explicit gpu window', () => {
        expect(BENCH_BOOTSTRAP).toContain('!B.allowTimestamps');
        expect(buildWindowSource({ kind: 'rest', ms: 1 })).toContain('be.trackTimestamp = false');
    });
});

describe('theme fleet bench reducers', () => {
    it('percentile interpolates and ignores non-finite values', () => {
        expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
        expect(percentile([5, NaN, 1], 100)).toBe(5);
        expect(percentile([], 50)).toBeNull();
    });

    it('frameStats reads fps and the frames over the 240 fps budget', () => {
        const t = frames(240, 3);
        t.push(t[t.length - 1] + 20); // one 20 ms hitch
        const s = frameStats(t, { budgetMs: BUDGET });
        expect(s.frames).toBe(241);
        expect(s.p50).toBe(3);
        expect(s.max).toBe(20);
        expect(s.overBudget).toBe(1);
        expect(s.over16).toBe(1);
        expect(s.janks).toBe(1);
        expect(s.fps).toBeCloseTo(241 / 0.74, 0);
        expect(frameStats([1, 2])).toBeNull();
    });

    it('loadFreeze reports the longest frame and the frozen time', () => {
        const t = [0, 4, 8, 120, 124, 200];
        const f = loadFreeze(t, [[10, 110], [130, 60]]);
        expect(f.longestFrameMs).toBe(112);
        expect(f.framesOver50).toBe(2);
        expect(f.framesOver100).toBe(1);
        expect(f.frozenMs).toBe(188);
        expect(f.longTaskMaxMs).toBe(110);
        expect(f.longTaskSumMs).toBe(170);
    });

    it('themePresentRate counts only the theme container\'s canvas', () => {
        const presents = [
            { key: '2|summer-theme', n: 500 },
            { key: '3|#game-canvas', n: 900 },
        ];
        expect(themePresentRate(presents, 'summer', 2000)).toBe(250);
        expect(themePresentRate(presents, 'forest', 2000)).toBeNull();
    });

    it('classifyBottleneck names what limits a frame', () => {
        expect(classifyBottleneck({ fps: 300, p50: 3.3, busyP50: 2, gpuUtil: 80 })).toBe('ok');
        expect(classifyBottleneck({ fps: 200, p50: 5, busyP50: 2, gpuUtil: 97 })).toBe('gpu');
        expect(classifyBottleneck({ fps: 200, p50: 5, busyP50: 4.4, gpuUtil: 60 })).toBe('main');
        expect(classifyBottleneck({ fps: 200, p50: 5, busyP50: 2, gpuUtil: 60 })).toBe('other');
    });

    it('summarizeCell turns a raw cell into table numbers', () => {
        const win = (ms) => ({
            ms: 1000,
            frameTimes: frames(250, ms),
            busy: Array(251).fill(1.5),
            presents: [{ key: '1|summer-theme', n: 250 }],
            rings: { cpu: [], gpu: [], calls: Array(251).fill(40), tris: [] },
            gpuUtil: { util: 50 },
            procCpu: { renderer: 3.125 },
        });
        const cell = {
            themeId: 'summer',
            quality: 'High',
            cores: 32,
            phases: {
                rest: win(4),
                storm1: win(5),
                storm2: win(4),
                load1: { marks: { shown: 900, full: 3100 }, frameTimes: [0, 10, 90], longTasks: [], loafs: [] },
            },
        };
        const s = summarizeCell(cell, { budgetMs: BUDGET });
        expect(s.ok).toBe(true);
        expect(s.rest.fps).toBe(250);
        expect(s.rest.limit).toBe('ok');
        expect(s.storm1.fps).toBe(200);
        expect(s.storm1.gpuMsEst).toBe(2.5);
        expect(s.rest.procCores.renderer).toBe(1);
        expect(s.rest.draws.p50).toBe(40);
        expect(s.load1.shown).toBe(900);
        expect(s.load1.longestFrameMs).toBe(80);
        const table = buildTable([s], { budgetMs: BUDGET });
        expect(table).toContain('| summer | 250 | 200 |');
        expect(table.split('\n')[0]).toContain('Storm fps (worst)');
    });
});
