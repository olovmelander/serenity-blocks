import { describe, expect, it } from 'vitest';
import {
    attemptKey, buildTasks, parseOptions, validateResumeConfiguration,
} from '../../scripts/odyssey-benchmark.mjs';

describe('Odyssey benchmark command configuration', () => {
    it('includes all 60 current orbs and accepts the new finale without reusing historical scenario positions', () => {
        expect(parseOptions([]).levelIds).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
        const options = parseOptions(['--levels=59-60', '--samples=1', '--profiles=stacker', '--scenarios=all']);
        expect(buildTasks(options).filter((task) => task.scenarioId.startsWith('orb59'))
            .map((task) => task.levelId)).toEqual([60, 60]);
        expect(parseOptions(['--construction-levels=49,56,60']).constructionLevelIds).toEqual([49, 56, 60]);
    });
    it('keeps the four established policies as defaults and requires explicit experimental selection', () => {
        expect(parseOptions([]).profileIds).toEqual(['stacker', 'cascade', 'expert', 'quad']);
        expect(parseOptions(['--profiles=chain']).profileIds).toEqual(['chain']);
        expect(parseOptions(['--profiles=duelist']).profileIds).toEqual(['duelist']);
        expect(parseOptions(['--profiles=chain,duelist,chain']).profileIds).toEqual(['chain', 'duelist']);
        const all = parseOptions(['--levels=56', '--samples=1', '--profiles=all']);
        expect(all.profileIds).toEqual(['stacker', 'cascade', 'expert', 'quad', 'duelist', 'chain']);
        expect(buildTasks(all).map((task) => task.profile)).toEqual(all.profileIds);
    });

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
        ['--samples=0'], ['--levels=61'], ['--levels=5-2'], ['--profiles=magic'],
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

    it('defaults to bounded empty-board construction without expanding the timed campaign', () => {
        const options = parseOptions(['--levels=60', '--profiles=chain', '--samples=1']);
        expect(options.constructionLevelIds).toEqual([]);
        expect(options.constructionSeeds).toEqual([1001, 1002, 1003]);
        expect(options.constructionMaxPieces).toBe(40);
        expect(buildTasks(options)).toHaveLength(1);
    });

    it('keeps authored solo construction, seeds and piece budgets separate from timed attempt settings', () => {
        const options = parseOptions([
            '--levels=1', '--profiles=chain', '--samples=2', '--seed-start=42', '--max-pieces=75',
            '--construction-levels=49,56,60,56', '--construction-seeds=0,4294967295',
            '--construction-pieces=128',
        ]);
        expect(options.constructionLevelIds).toEqual([49, 56, 60]);
        expect(options.constructionSeeds).toEqual([0, 4294967295]);
        expect(options.constructionMaxPieces).toBe(128);
        const tasks = buildTasks(options);
        expect(tasks).toHaveLength(2);
        expect(tasks.map((task) => task.seed)).toEqual([42, 43]);
        expect(tasks.every((task) => task.levelId === 1 && task.maxPieces === 75)).toBe(true);
        expect(parseOptions(['--construction-levels=49-52']).constructionLevelIds).toEqual([49, 50, 51, 52]);
        expect(parseOptions(['--construction-pieces=1']).constructionMaxPieces).toBe(1);
    });

    it.each([4, 9, 16, 25, 32, 44, 53, 59])('rejects authored construction for duel orb %i', (levelId) => {
        expect(() => parseOptions([`--construction-levels=56,${levelId}`]))
            .toThrow(/solo orbs only/);
    });

    it.each([
        ['--construction-levels=all'], ['--construction-levels=0'], ['--construction-levels=61'],
        ['--construction-levels=60-56'], ['--construction-levels='],
        ['--construction-seeds=42,42'], ['--construction-seeds=01,1'],
        ['--construction-seeds=-1'], ['--construction-seeds=4294967296'],
        ['--construction-seeds=2.5'], ['--construction-seeds=1e3'], ['--construction-seeds='],
        ['--construction-pieces=0'], ['--construction-pieces=129'], ['--construction-pieces=2.5'],
        ['--construction-pieces=128', '--construction-pieces=40'],
    ])('rejects invalid construction selection or budget: %j', (...args) => {
        expect(() => parseOptions(args)).toThrow();
    });

    it('pairs scenarios and cadences independently without creating unsupported orb experiments', () => {
        const options = parseOptions([
            '--levels=51,60', '--profiles=cascade', '--scenarios=all',
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
            ...parseOptions(['--levels=60', '--profiles=cascade']),
            revision: {
                head: 'fixed-head',
                benchmarkHash: 'fixed-benchmark',
                applicationHash: 'original-rules',
                runtime: { node: 'v24.14.0', platform: 'win32', arch: 'x64' },
            },
            effectiveLevels: [{ scenarioId: 'baseline', level: { id: 60, target: 160000 } }],
            visiblePreviews: 3,
            humanPlanningPreviewLimit: 3,
            opponentKnowledgePolicy: 'production-full-real-bag',
            opponentVisiblePreviewCount: 3,
            opponentPlanningPreviewLimit: null,
        };
        expect(() => validateResumeConfiguration(config, { ...config, workers: 6 })).not.toThrow();
        for (const changed of [
            { revision: { ...config.revision, applicationHash: 'changed-physics' } },
            { revision: { ...config.revision, runtime: { ...config.revision.runtime, node: 'v25.0.0' } } },
            { effectiveLevels: [{ scenarioId: 'baseline', level: { id: 60, target: 150000 } }] },
            { cadenceIds: ['steady'] }, { lapWindowSeconds: 60 }, { capabilitiesOnly: true },
            { humanPlanningPreviewLimit: 4 }, { opponentVisiblePreviewCount: 4 },
            { opponentKnowledgePolicy: 'restricted-three-previews' }, { opponentPlanningPreviewLimit: 3 },
            { opponentKnowledgePolicy: undefined }, { opponentPlanningPreviewLimit: undefined },
        ]) {
            expect(() => validateResumeConfiguration(config, { ...config, ...changed }))
                .toThrow(/Resume configuration differs/);
        }
    });

    it('refuses to reuse capability evidence after changing construction contexts, seeds or budget', () => {
        const config = parseOptions([
            '--profiles=chain', '--construction-levels=56,60', '--construction-seeds=41,42',
            '--construction-pieces=128', '--capabilities-only',
        ]);
        expect(() => validateResumeConfiguration(config, { ...config, workers: 1 })).not.toThrow();
        for (const [key, value] of [
            ['constructionLevelIds', [56]],
            ['constructionLevelIds', undefined],
            ['constructionSeeds', [41, 43]],
            ['constructionSeeds', [42, 41]],
            ['constructionSeeds', undefined],
            ['constructionMaxPieces', 40],
            ['constructionMaxPieces', undefined],
        ]) {
            expect(() => validateResumeConfiguration(config, { ...config, [key]: value }))
                .toThrow(`Resume configuration differs: ${key}; use a new output directory`);
        }
    });
});
