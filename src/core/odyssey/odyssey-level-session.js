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
}) {
    return {
        gameState,
        generation,
        hybridEngine,
        levelConfig,
        levelId,
        physicsCallbacks: null,
        retired: false,
        retirementGeneration: null,
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
    const { gameState } = session;
    if (!gameState) return session;

    gameState.isStopped = true;
    if (gameState.animationId) {
        cancelFrame?.(gameState.animationId);
        gameState.animationId = null;
    }
    return session;
}

/** Drain only the promise captured from this attempt; never touch a replacement. */
export async function drainOdysseyLevelSession(session) {
    const gameState = session?.gameState;
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
