const DEFAULT_STAGE_ORDER = [
    'core-ready',
    'intro-started',
    'menu-ready',
    'deferred-services-ready',
];

export function createBootStageCoordinator({
    stageOrder = DEFAULT_STAGE_ORDER,
    dispatchTarget = null,
} = {}) {
    const orderedStages = Array.isArray(stageOrder) && stageOrder.length > 0
        ? [...stageOrder]
        : [...DEFAULT_STAGE_ORDER];
    const stageIndex = new Map(orderedStages.map((stage, index) => [stage, index]));
    const completedStages = [];
    const completedSet = new Set();
    const waiters = new Map();

    const flushStageWaiters = (stage, payload) => {
        const stageWaiters = waiters.get(stage);
        if (!stageWaiters || stageWaiters.length === 0) {
            return;
        }

        waiters.delete(stage);
        stageWaiters.forEach((resolve) => resolve(payload));
    };

    const dispatchStageEvent = (payload) => {
        if (!dispatchTarget?.dispatchEvent) {
            return;
        }

        dispatchTarget.dispatchEvent(new CustomEvent('serenity:boot-stage', {
            detail: payload,
        }));
    };

    return {
        stageOrder: orderedStages,
        mark(stage, detail = null) {
            if (!stageIndex.has(stage)) {
                throw new Error(`Unknown boot stage: ${stage}`);
            }

            if (completedSet.has(stage)) {
                return {
                    stage,
                    detail,
                    order: completedStages.length - 1,
                    duplicate: true,
                };
            }

            const payload = {
                stage,
                detail,
                order: completedStages.length,
                timestamp: Date.now(),
            };

            completedSet.add(stage);
            completedStages.push(payload);
            flushStageWaiters(stage, payload);
            dispatchStageEvent(payload);

            return {
                ...payload,
                duplicate: false,
            };
        },
        has(stage) {
            return completedSet.has(stage);
        },
        getCompletedStages() {
            return completedStages.map((entry) => ({ ...entry }));
        },
        waitFor(stage) {
            if (completedSet.has(stage)) {
                const existing = completedStages.find((entry) => entry.stage === stage) || null;
                return Promise.resolve(existing ? { ...existing } : null);
            }

            return new Promise((resolve) => {
                const stageWaiters = waiters.get(stage) || [];
                stageWaiters.push(resolve);
                waiters.set(stage, stageWaiters);
            });
        },
    };
}
