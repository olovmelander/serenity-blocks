/**
 * Create the immutable ownership bundle for one Odyssey level attempt.
 * Mutable lifecycle fields are kept on the bundle so stale async callbacks can
 * be fenced without consulting whichever attempt the mode currently exposes.
 */
export function createOdysseyLevelSession({
    gameState,
    generation,
    hybridEngine,
    levelConfig,
    levelId,
    rngDescriptor,
    simulationClock,
}) {
    return {
        gameState,
        generation,
        hybridEngine,
        levelConfig,
        levelId,
        rngDescriptor,
        duel: null,
        disposeOutcome: null,
        physicsCallbacks: null,
        retired: false,
        retirementGeneration: null,
        simulationClock,
    };
}

/**
 * Mark an attempt as unable to accept further simulation work and stop its RAF.
 * The mode owns other drivers (FRC/interval/input) and stops those synchronously
 * before calling this boundary.
 */
export function retireOdysseyLevelSession(session, cancelFrame = globalThis.cancelAnimationFrame) {
    if (!session) return null;

    session.retired = true;
    const { disposeOutcome } = session;
    session.disposeOutcome = null;
    disposeOutcome?.();
    session.duel?.stop();
    const { gameState } = session;
    if (!gameState) return session;

    gameState.isStopped = true;
    if (gameState.animationId !== null && gameState.animationId !== undefined) {
        cancelFrame?.(gameState.animationId);
        gameState.animationId = null;
    }
    return session;
}

/** Drain only the promise captured from this attempt; never touch a replacement. */
export async function drainOdysseyLevelSession(session) {
    const states = session?.duel?.players || [session?.gameState];
    const results = await Promise.allSettled(states.map(async (gameState) => {
        const physicsPromise = gameState?.latestPhysicsPromise;
        if (!physicsPromise) return;
        try {
            await physicsPromise;
        } finally {
            if (gameState.latestPhysicsPromise === physicsPromise) {
                gameState.latestPhysicsPromise = null;
                gameState.isProcessingPhysics = false;
            }
        }
    }));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
}

/** Fence every callback, including the hybrid engine's metric wrappers. */
export function fenceOdysseyPhysicsCallbacks(callbacks, isActive) {
    return Object.fromEntries(Object.entries(callbacks).map(([name, callback]) => [
        name,
        typeof callback === 'function'
            ? (...args) => (isActive() ? callback(...args) : undefined)
            : callback,
    ]));
}
