/**
 * Host-Side Input Jitter Buffer - Phase 4
 *
 * Collects inputs from all players and releases them for processing
 * at consistent tick intervals, smoothing out network jitter.
 *
 * This provides fair input timing for all players regardless of latency,
 * preventing low-latency players from having an unfair advantage.
 */

/**
 * Input types for tracking
 */
export const INPUT_TYPES = {
    MOVE_LEFT: 'move_left',
    MOVE_RIGHT: 'move_right',
    ROTATE_CW: 'rotate_cw',
    ROTATE_CCW: 'rotate_ccw',
    SOFT_DROP: 'soft_drop',
    HARD_DROP: 'hard_drop',
};

/**
 * Host-Side Input Jitter Buffer
 *
 * Buffers incoming inputs from peers and releases them in tick-aligned batches.
 */
export class InputJitterBuffer {
    constructor(config = {}) {
        // Buffer depth in ticks (1-3, default 2)
        // Higher = more jitter smoothing but more latency
        this.bufferDepth = config.bufferDepth ?? 2;
        this.targetBufferDepth = this.bufferDepth;
        this.adaptiveEnabled = config.adaptive ?? true;

        // Adaptive Jitter Tracking
        this.playerStats = new Map(); // playerId -> { offsets: [], sum: 0, count: 0 }
        this.historySize = 20; // Samples to keep
        this.maxBufferDepth = config.maxBufferDepth ?? 8; // Cap at ~260ms latency at 30Hz
        this.minBufferDepth = config.minBufferDepth ?? 2; // Min ~66ms at 30Hz
        this.lastDepthAdjustTick = -1;

        // Target tick rate (30Hz = 33.3ms per tick)
        this.tickRate = config.tickRate ?? 30;
        this.tickInterval = 1000 / this.tickRate;

        // Per-player input queues, keyed by tick
        // Map<playerId, Map<tick, Input[]>>
        this.playerBuffers = new Map();

        // Current processing tick
        this.currentTick = 0;
        this.processCursor = this.currentTick - this.bufferDepth;
        this.clockEpoch = 0;

        // Last input tick seen per player (for gap detection)
        this.lastInputTick = new Map();

        // Stats for monitoring
        this.stats = {
            inputsBuffered: 0,
            inputsProcessed: 0,
            inputsDropped: 0, // Too old (stale)
            inputsInterpolated: 0, // Missing, used empty input
            inputsTooFuture: 0, // Too far ahead (possible cheat)
            avgJitterMs: 0,
            avgOffsetTicks: 0,
            maxOffsetTicks: 0,
        };

        // Debug mode
        this.debugMode = false;
    }

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Initialize buffer for a new player
     */
    addPlayer(playerId) {
        if (!this.playerBuffers.has(playerId)) {
            this.playerBuffers.set(playerId, new Map());
            this.lastInputTick.set(playerId, this.currentTick);
            this.playerStats.set(playerId, { offsets: [], sum: 0 });
            this._log(`Added player to jitter buffer: ${playerId}`);
        }
    }

    /**
     * Remove a player from the buffer
     */
    removePlayer(playerId) {
        this.playerBuffers.delete(playerId);
        this.lastInputTick.delete(playerId);
        this.playerStats.delete(playerId);
        this._log(`Removed player from jitter buffer: ${playerId}`);
    }

    /**
     * Add an input to the buffer
     * @param {string} playerId - Player's Steam ID
     * @param {number} tick - Client's tick for this input
     * @param {Object} input - The input data { type, timestamp, ... }
     * @returns {boolean} True if input was accepted
     */
    addInput(playerId, tick, input, options = {}) {
        // Ensure player buffer exists
        if (!this.playerBuffers.has(playerId)) {
            this.addPlayer(playerId);
        }

        const scheduledTick = Math.round(Number(tick));
        if (!Number.isFinite(scheduledTick)) {
            this.stats.inputsDropped++;
            this._log(`Dropped input from ${playerId}: invalid tick ${tick}`);
            return false;
        }

        // ADAPTIVE LOGIC: Track offset (CurrentServerTick - ClientTick)
        if (this.adaptiveEnabled) {
            const jitterTick = Number.isFinite(Number(options.jitterTick))
                ? Math.round(Number(options.jitterTick))
                : scheduledTick;
            this._trackJitter(playerId, this.currentTick - jitterTick);
        }

        // Validate tick is reasonable
        const minTick = this.processCursor;
        const defaultFutureTicks = this.bufferDepth + 2;
        const requestedFutureTicks = Number(options.maxFutureTicks);
        const maxFutureTicks = Number.isSafeInteger(requestedFutureTicks)
            && requestedFutureTicks >= defaultFutureTicks
            ? Math.min(requestedFutureTicks, 64)
            : defaultFutureTicks;
        const maxTick = this.currentTick + maxFutureTicks;

        if (scheduledTick < minTick) {
            // Input is too old - reject
            this.stats.inputsDropped++;
            this._log(`Dropped stale input from ${playerId}: tick ${scheduledTick} < ${minTick}`);
            return false;
        }

        if (scheduledTick > maxTick) {
            // Input is too far in the future - possible time manipulation
            this.stats.inputsTooFuture++;
            this._log(`Dropped future input from ${playerId}: tick ${scheduledTick} > ${maxTick}`);
            return false;
        }

        // Get or create player's buffer
        const playerBuffer = this.playerBuffers.get(playerId);

        // Get or create tick's input list
        if (!playerBuffer.has(scheduledTick)) {
            playerBuffer.set(scheduledTick, []);
        }

        // Add input with metadata
        const enrichedInput = {
            ...input,
            _receivedAt: Number.isFinite(Number(options.receivedAt)) ? Number(options.receivedAt) : Date.now(),
            _tick: scheduledTick,
            _rawTick: Number.isFinite(Number(options.jitterTick))
                ? Math.round(Number(options.jitterTick))
                : scheduledTick,
            _scheduleSource: options.scheduleSource || 'buffer',
            _lateClamped: options.lateClamped === true,
            _playerId: playerId,
        };

        playerBuffer.get(scheduledTick).push(enrichedInput);
        this.stats.inputsBuffered++;

        // Update last seen tick
        const lastTick = this.lastInputTick.get(playerId) || 0;
        if (scheduledTick > lastTick) {
            this.lastInputTick.set(playerId, scheduledTick);
        }

        return true;
    }

    /**
     * Add a batch of inputs at once (common pattern)
     * @param {string} playerId
     * @param {Array} inputs - Array of { tick, ...inputData }
     * @returns {number} Number of inputs accepted
     */
    addInputBatch(playerId, inputs) {
        let accepted = 0;
        for (const input of inputs) {
            const { tick, ...inputData } = input;
            if (this.addInput(playerId, tick, inputData)) {
                accepted++;
            }
        }
        return accepted;
    }

    /**
     * Get all inputs for the current tick (called by game loop)
     * Returns inputs that are ready to be processed.
     *
     * @returns {Map<playerId, Input[]>} Inputs to process this tick
     */
    getInputsForTick() {
        const tickToProcess = this.processCursor;
        const inputs = new Map();

        for (const [playerId, playerBuffer] of this.playerBuffers) {
            if (playerBuffer.has(tickToProcess)) {
                // Get and remove inputs for this tick
                const tickInputs = playerBuffer.get(tickToProcess);
                inputs.set(playerId, tickInputs);
                playerBuffer.delete(tickToProcess);
                this.stats.inputsProcessed += tickInputs.length;
            } else {
                // No input for this tick - player may have dropped packet
                // Return empty array (no action)
                inputs.set(playerId, []);
                this.stats.inputsInterpolated++;
            }
        }

        return inputs;
    }

    /**
     * Peek at inputs for a specific tick without consuming them
     * Useful for prediction/reconciliation
     */
    peekInputsForTick(tick) {
        const inputs = new Map();

        for (const [playerId, playerBuffer] of this.playerBuffers) {
            if (playerBuffer.has(tick)) {
                inputs.set(playerId, [...playerBuffer.get(tick)]);
            } else {
                inputs.set(playerId, []);
            }
        }

        return inputs;
    }

    /**
     * Advance to next tick (called by game loop after processing)
     */
    advanceTick() {
        this.currentTick++;
        this.processCursor++;

        // Clean up old buffered inputs (shouldn't happen if buffer is working)
        const oldestAllowed = this.processCursor - 2;

        for (const [playerId, playerBuffer] of this.playerBuffers) {
            for (const tick of playerBuffer.keys()) {
                if (tick < oldestAllowed) {
                    // These inputs are too old, they were never processed
                    const droppedCount = playerBuffer.get(tick).length;
                    this.stats.inputsDropped += droppedCount;
                    playerBuffer.delete(tick);
                    this._log(`Cleaned up ${droppedCount} old inputs from ${playerId} at tick ${tick}`);
                }
            }
        }
    }

    /**
     * Sync current tick (for joining/resuming)
     */
    setCurrentTick(tick) {
        this.currentTick = tick;
        this.processCursor = this.currentTick - this.bufferDepth;
        this._log(`Jitter buffer tick synced to ${tick}`);
    }

    /**
     * Get buffer status for a specific player
     */
    getPlayerBufferStatus(playerId) {
        const playerBuffer = this.playerBuffers.get(playerId);
        if (!playerBuffer) {
            return { exists: false, pendingTicks: 0, pendingInputs: 0 };
        }

        let pendingInputs = 0;
        for (const inputs of playerBuffer.values()) {
            pendingInputs += inputs.length;
        }

        return {
            exists: true,
            pendingTicks: playerBuffer.size,
            pendingInputs,
            lastInputTick: this.lastInputTick.get(playerId) || 0,
            ticksBehind: this.currentTick - (this.lastInputTick.get(playerId) || 0),
        };
    }

    /**
     * Get overall buffer statistics
     */
    getStats() {
        const playerStats = {};
        for (const playerId of this.playerBuffers.keys()) {
            playerStats[playerId] = this.getPlayerBufferStatus(playerId);
        }

        return {
            currentTick: this.currentTick,
            processCursor: this.processCursor,
            bufferDepth: this.bufferDepth,
            tickRate: this.tickRate,
            playerCount: this.playerBuffers.size,
            ...this.stats,
            playerStats,
        };
    }

    /**
     * Track incoming packet jitter offset
     */
    _trackJitter(playerId, offset) {
        const stats = this.playerStats.get(playerId);
        if (!stats) return;

        stats.offsets.push(offset);
        stats.sum += offset;

        if (stats.offsets.length > this.historySize) {
            const removed = stats.offsets.shift();
            stats.sum -= removed;
        }

        // Update target depth every 10 ticks or so
        if (
            stats.offsets.length >= this.historySize
            && this.currentTick % 10 === 0
            && this.lastDepthAdjustTick !== this.currentTick
        ) {
            this.lastDepthAdjustTick = this.currentTick;
            this._updateAdaptiveDepth();
        }
    }

    /**
     * Recalculate target buffer depth based on worst player stats
     */
    _updateAdaptiveDepth() {
        if (this.playerStats.size === 0) return;

        let maxRequiredDepth = this.minBufferDepth;
        let totalStdDev = 0;
        let totalAvgOffset = 0;
        let maxObservedOffset = 0;
        let playerCount = 0;

        for (const stats of this.playerStats.values()) {
            if (stats.offsets.length < 5) continue;

            const avg = stats.sum / stats.offsets.length;
            const variance = stats.offsets.reduce((sum, val) => sum + (val - avg) ** 2, 0) / stats.offsets.length;
            const stdDev = Math.sqrt(variance);
            totalStdDev += stdDev;
            totalAvgOffset += avg;
            maxObservedOffset = Math.max(maxObservedOffset, ...stats.offsets);
            playerCount += 1;

            // Target: Average delay + 2 * Jitter (95% confidence)
            // But offset is (Server - Client).
            // We want to ensure ServerTick - Depth <= ClientTick
            // i.e. Depth >= ServerTick - ClientTick = Offset
            // So we need BufferDepth to cover the Average Offset + Jitter.

            // Wait, offset is the "lag".
            // If lag is 5 ticks (160ms), we need buffer depth > 5?
            // No, buffer depth is "time held in buffer".
            // Offset is "transmission latency in ticks".
            // If offset is 5, it means packet arrives at T=105 but claims to be T=100.
            // If we process at T-2 (103), we miss it.
            // If we process at T-6 (99), we catch it.
            // So BufferDepth must be > MaxOffset.

            const requiredDepth = Math.ceil(avg + 2 * stdDev);
            maxRequiredDepth = Math.max(maxRequiredDepth, requiredDepth);
        }

        if (playerCount > 0) {
            this.stats.avgJitterMs = (totalStdDev / playerCount) * this.tickInterval;
            this.stats.avgOffsetTicks = totalAvgOffset / playerCount;
            this.stats.maxOffsetTicks = maxObservedOffset;
        }

        // Clamp
        maxRequiredDepth = Math.min(Math.max(maxRequiredDepth, this.minBufferDepth), this.maxBufferDepth);

        // Smooth transition
        if (maxRequiredDepth !== this.targetBufferDepth) {
            // Move 1 step towards target
            if (maxRequiredDepth > this.targetBufferDepth) this.targetBufferDepth++;
            else this.targetBufferDepth--; // Shrink slower? No, symmetrical for now.

            // Processing uses a monotonic cursor, so depth changes affect future
            // acceptance windows without skipping or replaying buffered ticks.
            this.bufferDepth = this.targetBufferDepth;

            if (this.debugMode) {
                this._log(`Adaptive Depth adjusted: ${this.bufferDepth} (Target: ${maxRequiredDepth})`);
            }
        }
    }

    _log(msg) {
        if (this.debugMode) {
            console.log(`[JitterBuffer] ${msg}`);
        }
    }

    /**
     * Reset statistics (for debugging)
     */
    resetStats() {
        this.stats = {
            inputsBuffered: 0,
            inputsProcessed: 0,
            inputsDropped: 0,
            inputsInterpolated: 0,
            inputsTooFuture: 0,
            avgJitterMs: 0,
            avgOffsetTicks: 0,
            maxOffsetTicks: 0,
        };
    }

    /**
     * Clear all buffers (for match restart)
     */
    clear() {
        this.playerBuffers.clear();
        this.lastInputTick.clear();
        this.clockEpoch += 1;
        this.currentTick = 0;
        this.processCursor = this.currentTick - this.bufferDepth;
        this.lastDepthAdjustTick = -1;
        this.resetStats();
        this._log('Jitter buffer cleared');
    }

    /**
     * Internal logging
     */
}

/**
 * Singleton instance for the host
 */
let _instance = null;

export function getInputJitterBuffer(config = {}) {
    if (!_instance) {
        _instance = new InputJitterBuffer(config);
    }
    return _instance;
}

export function resetInputJitterBuffer() {
    if (_instance) {
        _instance.clear();
    }
    _instance = null;
}
