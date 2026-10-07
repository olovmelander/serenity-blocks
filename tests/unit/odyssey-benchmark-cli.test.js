import { describe, expect, it } from 'vitest';
import {
    attemptKey, buildTasks, parseOptions, validateResumeConfiguration,
} from '../../scripts/odyssey-benchmark.mjs';

describe('Odyssey benchmark command configuration', () => {
    it('pairs the same independent seeds across all selected levels and policies', () => {
        const options = parseOptions([
            '--levels', '1-2,2,4', '--profiles=stacker,expert', '--samples=2', '--seed-start=42',
        ]);
        const tasks = buildTasks(options);
        expect(options.levelIds).toEqual([1, 2, 4]);
        expect(tasks).toHaveLength(12);
        expect(new Set(tasks.map(attemptKey)).size).toBe(12);
        for (const levelId of options.levelIds) {
            for (const profile of options.profileIds) {
                expect(tasks.filter((task) => task.levelId === levelId && task.profile === profile)
                    .map((task) => task.seed)).toEqual([42, 43]);
            }
        }
        expect(attemptKey({ levelId: 4, profileId: 'expert', seed: 42 })).toBe('4:expert:42:baseline:native');
    });

    it.each([
        ['--samples=0'], ['--levels=60'], ['--levels=5-2'], ['--profiles=magic'],
        ['--workers=17'], ['--wall-ms=0'], ['--samples=2.5'], ['--levels'],
        ['--samples=2', '--samples=3'], ['--unknown'], ['--output', '--resume'], ['--trace=false'],
        ['--scenarios=unknown'], ['--cadences=unknown'], ['--lap-seconds=0'],
        ['--levels=1', '--scenarios=orb59-deadline210'],
    ])('rejects an invalid run instead of silently changing its sample or budgets: %j', (...args) => {
        expect(() => parseOptions(args)).toThrow();
    });

    it('keeps simulation, piece and real compute budgets distinct and explicit', () => {
        const options = parseOptions([
            '--levels=1', '--profiles=stacker', '--max-seconds=60', '--max-pieces=75',
            '--wall-ms=2500', '--trace', '--resume',
        ]);
        expect(buildTasks(options)[0]).toMatchObject({
            maxSimSeconds: 60, maxPieces: 75, wallBudgetMs: 2500, trace: true,
        });
        expect(options.resume).toBe(true);
    });

    it('pairs scenarios and cadences independently without creating unsupported orb experiments', () => {
        const options = parseOptions([
            '--levels=51,59', '--profiles=cascade', '--scenarios=all',
            '--cadences=native,steady', '--samples=2', '--seed-start=42', '--lap-seconds=full',
        ]);
        const tasks = buildTasks(options);
        expect(tasks).toHaveLength(24);
        expect(new Set(tasks.map(attemptKey)).size).toBe(24);
        expect(tasks.every((task) => task.lapWindowSeconds === null)).toBe(true);
        expect(tasks.filter((task) => task.levelId === 51)
            .every((task) => !task.scenarioId.startsWith('orb59') && !task.scenarioId.startsWith('duel'))).toBe(true);
        for (const task of tasks) {
            expect(tasks.filter((candidate) => candidate.levelId === task.levelId
                && candidate.scenarioId === task.scenarioId && candidate.cadenceId === task.cadenceId)
                .map((candidate) => candidate.seed)).toEqual([42, 43]);
        }
        expect(parseOptions(['--lap-seconds=60']).lapWindowSeconds).toBe(60);
    });

    it('refuses to mix changed application rules, runtime or experiment settings into a checkpoint', () => {
        const config = {
            ...parseOptions(['--levels=59', '--profiles=cascade']),
            revision: {
                head: 'fixed-head',
                benchmarkHash: 'fixed-benchmark',
                applicationHash: 'original-rules',
                runtime: { node: 'v24.14.0', platform: 'win32', arch: 'x64' },
            },
            effectiveLevels: [{ scenarioId: 'baseline', level: { id: 59, target: 160000 } }],
            visiblePreviews: 3,
        };
        expect(() => validateResumeConfiguration(config, { ...config, workers: 6 })).not.toThrow();
        for (const changed of [
            { revision: { ...config.revision, applicationHash: 'changed-physics' } },
            { revision: { ...config.revision, runtime: { ...config.revision.runtime, node: 'v25.0.0' } } },
            { effectiveLevels: [{ scenarioId: 'baseline', level: { id: 59, target: 150000 } }] },
            { cadenceIds: ['steady'] }, { lapWindowSeconds: 60 }, { capabilitiesOnly: true },
        ]) {
            expect(() => validateResumeConfiguration(config, { ...config, ...changed }))
                .toThrow(/Resume configuration differs/);
        }
    });
});
