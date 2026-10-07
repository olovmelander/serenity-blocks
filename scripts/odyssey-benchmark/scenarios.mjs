/** Explicit offline balance experiments; authored production levels are never mutated. */
export const BENCHMARK_SCENARIOS = Object.freeze([
    {
        id: 'baseline', label: 'Authored rules', levelIds: null, description: 'Unchanged authored rules.',
    },
    {
        id: 'orb59-deadline210',
        label: 'Orb 59: 210 s',
        levelIds: [59],
        description: 'Keep the score and stars; extend only the deadline to 210 seconds.',
    },
    {
        id: 'orb59-deadline240',
        label: 'Orb 59: 240 s',
        levelIds: [59],
        description: 'Keep the score and stars; extend only the deadline to 240 seconds.',
    },
    {
        id: 'orb51-fall75',
        label: 'Orb 51: initial fall 75 ms',
        levelIds: [51],
        description: 'Scale the entire fall schedule; preserve score level and progression.',
    },
    {
        id: 'orb51-fall100',
        label: 'Orb 51: initial fall 100 ms',
        levelIds: [51],
        description: 'Scale the entire fall schedule; preserve score level and progression.',
    },
    {
        id: 'duel-fall850',
        label: 'Duel fall 850 ms',
        levelIds: [4, 9, 17, 26, 33, 44, 53, 58],
        description: 'Both wells use 850 ms gravity; retain the seven-frag target and opponent tier.',
    },
    {
        id: 'duel-fall700',
        label: 'Duel fall 700 ms',
        levelIds: [4, 9, 17, 26, 33, 44, 53, 58],
        description: 'Both wells use 700 ms gravity; retain the seven-frag target and opponent tier.',
    },
].map((scenario) => Object.freeze({
    ...scenario,
    levelIds: scenario.levelIds ? Object.freeze(scenario.levelIds) : null,
})));

export function supportsScenario(scenarioId, levelConfig) {
    const scenario = BENCHMARK_SCENARIOS.find((entry) => entry.id === scenarioId);
    return Boolean(levelConfig && scenario
        && (scenario.levelIds === null || scenario.levelIds.includes(levelConfig.id)));
}

export function resolveScenario(levelConfig, scenarioId = 'baseline') {
    if (!supportsScenario(scenarioId, levelConfig)) {
        throw new RangeError(`Scenario ${scenarioId} does not support orb ${levelConfig?.id}`);
    }
    const config = structuredClone(levelConfig);
    if (scenarioId.startsWith('orb59-deadline')) {
        config.victory.failure.value = Number(scenarioId.slice('orb59-deadline'.length));
    } else if (scenarioId.startsWith('orb51-fall')) {
        config.benchmarkPhysicsPolicy = { initialFallMs: Number(scenarioId.slice('orb51-fall'.length)) };
    } else if (scenarioId.startsWith('duel-fall')) {
        config.mechanics.speed.fixedDropInterval = Number(scenarioId.slice('duel-fall'.length));
    }
    return config;
}
