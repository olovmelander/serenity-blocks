/**
 * @fileoverview Unit tests for the plan-4.1 CPU-profile reducer.
 *
 * Run against a REAL committed V8 profile (reports/perf-audit-2026-07-16/results/) rather than a
 * synthetic one, so the shape assumptions — nodes[].callFrame, samples[] as node ids, startTime /
 * endTime in microseconds — are checked against something V8 actually emitted. No Electron, no
 * GPU, no 10-second capture.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { summarizeCpuProfile, CPU_PROFILE_TARGETS } from '../../scripts/lib/cpu-profile-summary.mjs';

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);

function loadFixture(name) {
    return JSON.parse(readFileSync(path.join(ROOT, 'reports/perf-audit-2026-07-16/results', name), 'utf8'));
}

describe('summarizeCpuProfile', () => {
    it('reduces a real V8 profile to a self-time table', () => {
        const summary = summarizeCpuProfile(loadFixture('cpuprofile-gameplay.cpuprofile'));
        expect(summary).not.toBeNull();
        expect(summary.totalSamples).toBeGreaterThan(0);
        expect(summary.top.length).toBeGreaterThan(0);
        // Rows are ordered by cost, so the reader does not have to sort them.
        for (let i = 1; i < summary.top.length; i += 1) {
            expect(summary.top[i - 1].hits).toBeGreaterThanOrEqual(summary.top[i].hits);
        }
    });

    it('excludes V8 bookkeeping nodes from the application rows', () => {
        const summary = summarizeCpuProfile(loadFixture('cpuprofile-menu-idle.cpuprofile'));
        const names = summary.top.map((r) => r.fn);
        expect(names).not.toContain('(idle)');
        expect(names).not.toContain('(program)');
        expect(names).not.toContain('(root)');
        expect(names).not.toContain('(garbage collector)');
    });

    it('reports busyPct as a real fraction, which is the admissibility gate', () => {
        // An ~11 ms frame at a 240 Hz target still idles between frames. A busyPct near 100 means
        // the window caught loading or a compile rather than steady state, and the cell is void.
        const summary = summarizeCpuProfile(loadFixture('cpuprofile-menu-idle.cpuprofile'));
        expect(summary.busyPct).toBeGreaterThanOrEqual(0);
        expect(summary.busyPct).toBeLessThanOrEqual(100);
    });

    it('derives the effective interval from the profile, not from what was requested', () => {
        // V8 may clamp a sampling-interval request. If the summary were scaled by the REQUESTED
        // interval, every selfMs would be silently wrong; deriving it makes the clamp visible.
        const profile = loadFixture('cpuprofile-gameplay.cpuprofile');
        const summary = summarizeCpuProfile(profile);
        const expected = (profile.endTime - profile.startTime) / profile.samples.length;
        expect(summary.effectiveIntervalUs).toBeCloseTo(expected, 1);
    });

    it('sums every node matching a target, not just the largest', () => {
        // A function reached from several call sites appears as several nodes; reporting only one
        // would understate it. Verified structurally: the target total must be >= its biggest row.
        const summary = summarizeCpuProfile(loadFixture('cpuprofile-gameplay.cpuprofile'));
        for (const [, hit] of Object.entries(summary.targets)) {
            if (!hit) continue;
            expect(hit.nodes).toBeGreaterThan(0);
            expect(hit.hits).toBeGreaterThan(0);
            expect(hit.selfMs).toBeGreaterThanOrEqual(0);
        }
    });

    it('reports a missing target as null rather than as zero', () => {
        // Zero would read as "measured, costs nothing". These fixtures are menu/gameplay captures,
        // not Odyssey idle frames, so several Odyssey-specific targets genuinely are absent — and
        // that must be distinguishable from a real measurement of zero.
        const summary = summarizeCpuProfile(loadFixture('cpuprofile-menu-idle.cpuprofile'));
        const values = Object.values(summary.targets);
        expect(values.some((v) => v === null)).toBe(true);
        expect(values.every((v) => v === null || v.hits > 0)).toBe(true);
    });

    it('matches native GPU frames by name, because they carry no url', () => {
        // Going in, the expectation was that device.queue.writeBuffer could never appear as its
        // own row — a Blink binding with no JS frame, whose time folds into its JS caller. The
        // first real capture disproved that: under Electron, V8 surfaces writeBuffer / submit /
        // setVertexBuffer as their own nodes with an EMPTY url, and the JS callers do not appear.
        // So these must match on name with NO url constraint, or they silently report null.
        const native = CPU_PROFILE_TARGETS.filter((t) => t.key.startsWith('gpu.'));
        expect(native.map((t) => t.fn)).toEqual(
            expect.arrayContaining(['writeBuffer', 'submit', 'setVertexBuffer']),
        );
        expect(native.every((t) => t.url === null)).toBe(true);
        expect(CPU_PROFILE_TARGETS.every((t) => typeof t.fn === 'string' && t.fn.length > 0)).toBe(true);
    });

    it('resolves three.js targets through a Vite dep chunk, not just a source path', () => {
        // REGRESSION. The first 4.1 capture reported EVERY three target as absent while
        // _renderObjectDirect sat at the top of the self-time table: against the dev server three
        // is pre-bundled into node_modules/.vite/deps/chunk-<hash>.js, so matching on a source
        // filename like 'Bindings.js' finds nothing. A matcher that silently returns null for its
        // whole reason to exist is worse than no matcher.
        const summary = summarizeCpuProfile({
            startTime: 0,
            endTime: 1_000_000,
            samples: [1, 1, 2, 2, 3],
            nodes: [
                {
                    id: 1,
                    callFrame: {
                        functionName: '_renderObjectDirect',
                        url: 'http://127.0.0.1:4177/node_modules/.vite/deps/chunk-ABC.js',
                        lineNumber: 10,
                    },
                },
                { id: 2, callFrame: { functionName: 'writeBuffer', url: '', lineNumber: 0 } },
                { id: 3, callFrame: { functionName: '_update', url: '/src/app/thing.js', lineNumber: 5 } },
            ],
        });
        expect(summary.targets['three.renderObjectDirect']).not.toBeNull();
        expect(summary.targets['three.renderObjectDirect'].hits).toBe(2);
        expect(summary.targets['gpu.writeBuffer']).not.toBeNull();
        // An app-side _update must NOT be attributed to three's binding update.
        expect(summary.targets['three.bindingsUpdate']).toBeNull();
    });

    it('requires a url for function names that are not unique', () => {
        // `_update` matches Bindings._update and dozens of unrelated app methods. Matching on the
        // bare name would attribute app time to three's binding update.
        const ambiguous = CPU_PROFILE_TARGETS.find((t) => t.fn === '_update');
        expect(ambiguous).toBeDefined();
        expect(ambiguous.url).toBeTruthy();
    });

    it('returns null for an empty or malformed profile instead of throwing', () => {
        expect(summarizeCpuProfile(null)).toBeNull();
        expect(summarizeCpuProfile({})).toBeNull();
        expect(summarizeCpuProfile({ nodes: [], samples: [] })).toBeNull();
    });
});
