import { describe, expect, it } from 'vitest';
import { summarizeFeel } from '../../scripts/odyssey-benchmark/runtime.mjs';
import {
    ALL_BENCHMARK_CADENCES, BENCHMARK_CADENCES, HUMAN_PACE_CADENCES, createBenchmarkBot,
} from '../../scripts/odyssey-benchmark/profiles.mjs';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

function sample(t, height, counts = {}, extra = {}) {
    return {
        t,
        height,
        nearTop: height >= 0.9,
        singles: 0,
        doubles: 0,
        triples: 0,
        tetrises: 0,
        cascades: 0,
        goal: false,
        ...counts,
        ...extra,
    };
}

describe('benchmark feel summary (level design audit 2026-11, §5.7 level 3)', () => {
    it('reads tension, near-misses, reward gaps, shape and variety from per-piece samples', () => {
        const samples = [
            sample(0, 0.1),
            sample(10, 0.3, { singles: 1 }),
            sample(20, 0.7, { singles: 1, doubles: 1 }),
            sample(30, 0.95, { singles: 1, doubles: 1 }),
            sample(40, 0.5, { singles: 1, doubles: 1, tetrises: 1 }),
            sample(50, 0.92, {
                singles: 1, doubles: 1, tetrises: 1, cascades: 2,
            }),
            sample(60, 0.2, {
                singles: 1, doubles: 1, tetrises: 1, cascades: 2,
            }, { goal: true }),
        ];
        const feel = summarizeFeel(samples);
        expect(feel).toMatchObject({
            samples: 6,
            tension: 0.5,
            nearMisses: 2,
            notableEvents: 3,
            clears: {
                singles: 1, doubles: 1, triples: 0, tetrises: 1,
            },
            cascades: 2,
            dominantClearShare: 0.333,
        });
        // Events at 20, 40 and 50 s after a first reading at 0 s, then nothing to the last sample at 50 s.
        expect(feel.rewardGapMedianSeconds).toBe(15);
        expect(feel.rewardGapMaxSeconds).toBe(20);
        expect(feel.shape).toBeCloseTo(((0.5 + 0.92) / 2) - ((0.1 + 0.3) / 2), 3);
        expect(feel.nearMissesPerMinute).toBeCloseTo(2 / (50 / 60), 3);
    });

    it('declines to summarize too short a run', () => {
        expect(summarizeFeel([sample(0, 0.1), sample(1, 0.2)])).toBeNull();
        expect(summarizeFeel([])).toBeNull();
    });
});

describe('human-paced cadences (level design audit 2026-11, §5.7 level 2)', () => {
    it('stays outside `--cadences all` and carries a person\'s mistakes', () => {
        expect(BENCHMARK_CADENCES.map(({ id }) => id)).toEqual(['native', 'steady', 'deliberate']);
        expect(HUMAN_PACE_CADENCES.map(({ id }) => id)).toEqual(['human-casual', 'human-regular', 'human-strong']);
        expect(ALL_BENCHMARK_CADENCES).toHaveLength(6);
        const engine = new GameplayHybridEngine();
        engine.configure(getLevelById(1));
        const state = engine.createGameState({ rngSeed: 7 });
        try {
            const paces = HUMAN_PACE_CADENCES.map(({ id }) => createBenchmarkBot({
                gameState: state, actions: {}, profileId: 'stacker', cadenceId: id, decisionSeed: 3,
            }).config);
            expect(paces.map((config) => config.mistakeChance)).toEqual([0.06, 0.04, 0.02]);
            const perPiece = paces.map((config) => (config.reactionMs[0] + config.reactionMs[1]) / 2
                + 4 * config.actionIntervalMs);
            expect(perPiece[0]).toBeGreaterThan(perPiece[1]);
            expect(perPiece[1]).toBeGreaterThan(perPiece[2]);
        } finally { state.reset(); engine.reset(); }
    });
});
