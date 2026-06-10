export const BOT_DIFFICULTY_TIERS = Object.freeze({
    1: Object.freeze({
        tier: 1,
        label: 'Level 1',
        reactionMs: [500, 900],
        heuristicNoise: 0.24,
        mistakeChance: 0.2,
        maxApm: 90,
        comboAggression: 0.25,
        survivalInstinct: 0.35,
        hardDropChance: 1,
        lookaheadBreadth: 3,
        lookaheadDepth: 0,
        lookaheadWeight: 0,
    }),
    2: Object.freeze({
        tier: 2,
        label: 'Level 2',
        reactionMs: [420, 760],
        heuristicNoise: 0.19,
        mistakeChance: 0.15,
        maxApm: 120,
        comboAggression: 0.32,
        survivalInstinct: 0.42,
        hardDropChance: 1,
        lookaheadBreadth: 4,
        lookaheadDepth: 0,
        lookaheadWeight: 0,
    }),
    3: Object.freeze({
        tier: 3,
        label: 'Level 3',
        reactionMs: [320, 620],
        heuristicNoise: 0.14,
        mistakeChance: 0.11,
        maxApm: 165,
        comboAggression: 0.42,
        survivalInstinct: 0.5,
        hardDropChance: 1,
        lookaheadBreadth: 4,
        lookaheadDepth: 1,
        lookaheadWeight: 0.45,
    }),
    4: Object.freeze({
        tier: 4,
        label: 'Level 4',
        reactionMs: [240, 480],
        heuristicNoise: 0.1,
        mistakeChance: 0.08,
        maxApm: 230,
        comboAggression: 0.5,
        survivalInstinct: 0.58,
        hardDropChance: 1,
        lookaheadBreadth: 5,
        lookaheadDepth: 1,
        lookaheadWeight: 0.52,
    }),
    5: Object.freeze({
        tier: 5,
        label: 'Level 5',
        reactionMs: [160, 320],
        heuristicNoise: 0.06,
        mistakeChance: 0.04,
        maxApm: 320,
        comboAggression: 0.58,
        survivalInstinct: 0.66,
        hardDropChance: 1,
        lookaheadBreadth: 5,
        lookaheadDepth: 1,
        lookaheadWeight: 0.6,
    }),
    6: Object.freeze({
        tier: 6,
        label: 'Level 6',
        reactionMs: [100, 230],
        heuristicNoise: 0.035,
        mistakeChance: 0.025,
        maxApm: 460,
        comboAggression: 0.68,
        survivalInstinct: 0.74,
        hardDropChance: 1,
        lookaheadBreadth: 6,
        lookaheadDepth: 1,
        lookaheadWeight: 0.66,
    }),
    7: Object.freeze({
        tier: 7,
        label: 'Level 7',
        reactionMs: [60, 160],
        heuristicNoise: 0.02,
        mistakeChance: 0.012,
        maxApm: 650,
        comboAggression: 0.78,
        survivalInstinct: 0.84,
        hardDropChance: 1,
        lookaheadBreadth: 7,
        lookaheadDepth: 2,
        lookaheadWeight: 0.7,
    }),
    8: Object.freeze({
        tier: 8,
        label: 'Level 8',
        reactionMs: [30, 100],
        heuristicNoise: 0.01,
        mistakeChance: 0.005,
        maxApm: 900,
        comboAggression: 0.88,
        survivalInstinct: 0.92,
        hardDropChance: 1,
        lookaheadBreadth: 8,
        lookaheadDepth: 2,
        lookaheadWeight: 0.74,
    }),
    9: Object.freeze({
        tier: 9,
        label: 'Level 9',
        reactionMs: [0, 60],
        heuristicNoise: 0.003,
        mistakeChance: 0.001,
        maxApm: 1250,
        comboAggression: 0.95,
        survivalInstinct: 0.98,
        hardDropChance: 1,
        lookaheadBreadth: 10,
        lookaheadDepth: 2,
        lookaheadWeight: 0.78,
    }),
    10: Object.freeze({
        tier: 10,
        label: 'Level 10',
        reactionMs: [0, 20],
        heuristicNoise: 0,
        mistakeChance: 0,
        maxApm: 1800,
        comboAggression: 1,
        survivalInstinct: 1.08,
        hardDropChance: 1,
        lookaheadBreadth: 12,
        lookaheadDepth: 2,
        lookaheadWeight: 0.82,
    }),
});

function pickByTier(tier, low, mid, high) {
    if (tier <= 3) return low;
    if (tier <= 6) return mid;
    return high;
}

export function normalizeDifficultyTier(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(10, Math.max(1, parsed));
}

export function getBotDifficultyConfig(value = 10) {
    const tier = normalizeDifficultyTier(value);
    const config = BOT_DIFFICULTY_TIERS[tier];
    return {
        ...config,
        reactionMs: [...config.reactionMs],
        actionIntervalMs: 60000 / config.maxApm,
        // --- Cascade-machine tactical knobs (derived from tier) ---
        // Whether the bot commits to a persistent multi-piece machine plan instead
        // of re-planning each piece greedily.
        cascadePlanning: tier >= 4,
        // Whether evaluateCandidate runs the hypothetical-trigger latent-chain probe.
        latentChainEval: tier >= 4,
        // How strongly the planner sticks to a committed machine plan (0..1).
        planCommitment: tier <= 3 ? 0 : Math.min(1, (tier - 3) / 6),
        // Whether the build-vs-fire controller / danger gate runs.
        buildVsFire: tier >= 4,
        // Minimum projected discharge depth before the controller will FIRE a machine.
        triggerDepthTarget: pickByTier(tier, 2, 4, 6),
        // Multiplier on the value of board-clearing (clean) cascade routes.
        cleanRouteBias: pickByTier(tier, 0.4, 0.8, 1.2),
        // Spare rows to top-out below which the danger gate forces downstacking.
        dangerSpareRows: pickByTier(tier, 7, 6, 5),
    };
}

export function rollReactionDelay(config, rng = Math.random) {
    const [minMs, maxMs] = config?.reactionMs || [0, 0];
    if (maxMs <= minMs) return Math.max(0, minMs);
    return Math.max(0, minMs + rng() * (maxMs - minMs));
}

export function applyHeuristicNoise(score, config, rng = Math.random) {
    const noise = Math.max(0, Number(config?.heuristicNoise) || 0);
    if (noise <= 0) return score;

    const scale = Math.max(120, Math.abs(score) * 0.08);
    return score + ((rng() * 2) - 1) * noise * scale;
}
