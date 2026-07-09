const WARMUP_MODE_ALIASES = Object.freeze({
    current: 'current',
    focus: 'current',
    focused: 'current',
    minimal: 'current',
    full: 'full',
    journey: 'full',
    all: 'full',
    off: 'off',
    none: 'off',
    skip: 'off',
});

function finitePositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeOdysseyWarmupMode(value, { fastStartOff = false } = {}) {
    const key = String(value || '').trim().toLowerCase();
    if (key && WARMUP_MODE_ALIASES[key]) {
        return WARMUP_MODE_ALIASES[key];
    }

    return fastStartOff ? 'full' : 'current';
}

export function resolveOdysseyTargetFrameRate({
    explicit = null,
    urlValue = null,
    settingsValue = null,
    detectedRefreshRate = null,
    fallback = 60,
} = {}) {
    const candidates = [explicit, urlValue, settingsValue, detectedRefreshRate, fallback];
    for (const candidate of candidates) {
        const number = finitePositiveNumber(candidate);
        if (number !== null) {
            return Math.min(1000, Math.max(30, Math.round(number)));
        }
    }
    return 60;
}

export function resolveOdysseyAdaptiveFrameRate({
    desiredTargetFrameRate = null,
    detectedRefreshRate = null,
    fallback = 60,
} = {}) {
    const desired = resolveOdysseyTargetFrameRate({
        explicit: desiredTargetFrameRate,
        fallback,
    });
    const detected = finitePositiveNumber(detectedRefreshRate);
    if (detected !== null) {
        const detectedTarget = Math.min(1000, Math.max(30, Math.round(detected)));
        return Math.min(desired, detectedTarget);
    }
    return desired;
}

export function summarizeFrameTimes(samples = [], targetFrameRate = 60) {
    const values = samples
        .map((sample) => Number(sample))
        .filter((sample) => Number.isFinite(sample) && sample >= 0)
        .sort((a, b) => a - b);
    const count = values.length;
    const budgetMs = 1000 / resolveOdysseyTargetFrameRate({ explicit: targetFrameRate });
    if (count === 0) {
        return {
            count: 0,
            budgetMs,
            p50: 0,
            p95: 0,
            p99: 0,
            max: 0,
            overBudget: 0,
            overBudgetPct: 0,
        };
    }

    const percentile = (fraction) => {
        const index = Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
        return values[index];
    };
    const overBudget = values.reduce((total, sample) => total + (sample > budgetMs ? 1 : 0), 0);

    return {
        count,
        budgetMs,
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        max: values[count - 1],
        overBudget,
        overBudgetPct: (overBudget / count) * 100,
    };
}

export default {
    normalizeOdysseyWarmupMode,
    resolveOdysseyAdaptiveFrameRate,
    resolveOdysseyTargetFrameRate,
    summarizeFrameTimes,
};
