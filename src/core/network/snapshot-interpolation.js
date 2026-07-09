/**
 * Snapshot Interpolator
 *
 * Provides linear interpolation between game state snapshots to ensure
 * smooth rendering (60Hz+) from lower-rate network updates (30Hz).
 *
 * Logic:
 * - Buffers valid snapshots.
 * - Interpolates "active" pieces (x, y) based on render timestamp.
 * - For "discrete" state (grid, score, etc.), uses the most recent valid state.
 * - Handles interpolation delay (buffer time) to ensure there are always two snapshots to interpolate between.
 */

export class SnapshotInterpolator {
    constructor(config = {}) {
        // Interpolation delay in ms (must be > packet interval)
        // 30Hz = 33ms interval. Delay ~50-60ms is usually safe.
        this.interpolationDelay = Number.isFinite(config.interpolationDelay)
            ? config.interpolationDelay
            : 50;
        this.adaptive = config.adaptive === true;
        this.minInterpolationDelay = Number.isFinite(config.minInterpolationDelay)
            ? config.minInterpolationDelay
            : this.interpolationDelay;
        this.maxInterpolationDelay = Number.isFinite(config.maxInterpolationDelay)
            ? config.maxInterpolationDelay
            : Math.max(this.minInterpolationDelay, 180);
        this.jitterSafetyMultiplier = Number.isFinite(config.jitterSafetyMultiplier)
            ? config.jitterSafetyMultiplier
            : 2.5;
        this.jitterEwmaAlpha = Number.isFinite(config.jitterEwmaAlpha)
            ? Math.max(0.01, Math.min(1, config.jitterEwmaAlpha))
            : 0.2;
        this.simTickMs = Number.isFinite(config.simTickMs) && config.simTickMs > 0
            ? config.simTickMs
            : 1000 / 60;
        this.snapshotIntervalMs = Number.isFinite(config.snapshotIntervalMs) && config.snapshotIntervalMs > 0
            ? config.snapshotIntervalMs
            : 1000 / 30;

        // Max buffer size to prevent memory leaks
        this.maxBufferSize = Number.isFinite(config.maxBufferSize)
            ? config.maxBufferSize
            : (this.adaptive ? 24 : 10);

        // Map of steamId -> Array<Snapshot>
        this.playerBuffers = new Map();
        this.playerTimelines = new Map();
        this.playerStats = new Map();

        // Debug mode
        this.debug = false;

        // === PERFORMANCE OPTIMIZATIONS ===
        // Cache last interpolation results to avoid recalculating same frame
        this._lastRenderTime = 0;
        this._resultCache = new Map(); // steamId -> { time, result }
        this._bufferVersions = new Map();
        // Pre-allocated interpolation objects (reused to avoid allocations)
        this._interpolatedPieces = new Map();
        this._stateScratch = new Map();
    }

    /**
     * Add a new state snapshot
     * @param {Object} fullState - The full game state snapshot from host
     * @param {Object} options - Optional receive metadata
     */
    addSnapshot(fullState, options = {}) {
        if (!fullState || !fullState.players) return;

        const receivedAt = this._finiteNumber(options.receivedAt)
            ?? this._finiteNumber(fullState.receivedAt)
            ?? Date.now();
        const sourceTimestamp = this._finiteNumber(fullState.timestamp) ?? receivedAt;
        const orderingKey = this._orderingKey(fullState, sourceTimestamp);

        fullState.players.forEach((playerData) => {
            const { steamId } = playerData;
            if (!this.playerBuffers.has(steamId)) {
                this.playerBuffers.set(steamId, []);
            }

            const buffer = this.playerBuffers.get(steamId);
            const stats = this._getStatsMutable(steamId);
            let timestamp = sourceTimestamp;

            // Add new snapshot (sorted by time implicitly if arrival is ordered)
            // We ensure ordering by tick or timestamp
            if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                const isOlderOrDuplicate = Number.isFinite(orderingKey) && Number.isFinite(last.orderingKey)
                    ? orderingKey <= last.orderingKey
                    : timestamp <= last.timestamp;
                if (isOlderOrDuplicate) {
                    // Out of order or duplicate, ignore given we handle jitter elsewhere
                    // or just push if we trust the source.
                    // For interpolation, strictly increasing time is required.
                    stats.droppedSnapshots += 1;
                    return;
                }
            }

            timestamp = this.adaptive
                ? this._timelineTimestamp(steamId, fullState, receivedAt, sourceTimestamp)
                : sourceTimestamp;

            if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                if (timestamp <= last.timestamp) timestamp = last.timestamp + 0.001;
            }

            const snapshotSeq = this._finiteNumber(fullState.snapshotSeq);
            if (snapshotSeq != null && stats.lastSnapshotSeq != null && snapshotSeq > stats.lastSnapshotSeq + 1) {
                stats.sequenceGaps += snapshotSeq - stats.lastSnapshotSeq - 1;
            }
            if (snapshotSeq != null) stats.lastSnapshotSeq = snapshotSeq;
            stats.snapshots += 1;
            stats.lastReceivedAt = receivedAt;

            // Store lightweight snapshot for interpolation
            // We only need interpolate-able data (piece position) + full state reference
            buffer.push({
                timestamp,
                data: playerData,
                receivedAt,
                orderingKey,
                simTick: this._finiteNumber(fullState.simTick),
                snapshotSeq,
                roundGeneration: this._finiteNumber(fullState.roundGeneration),
            });

            // Prune buffer
            if (buffer.length > this.maxBufferSize) {
                buffer.shift();
            }
            this._bufferVersions.set(steamId, (this._bufferVersions.get(steamId) || 0) + 1);
            this._resultCache.delete(steamId);
        });
    }

    /**
     * Get interpolated state for a specific player at the current render time
     * @param {string} steamId - Player Steam ID
     * @param {number} renderTime - Current time - interpolation delay
     * @returns {Object|null} Interpolated player state
     */
    getInterpolatedState(steamId, renderTime) {
        const interpolationDelay = this.getInterpolationDelay(steamId);
        const version = this._bufferVersions.get(steamId) || 0;

        // PERF: Check cache first - same frame returns cached result
        const cached = this._resultCache.get(steamId);
        if (cached && cached.time === renderTime && cached.version === version && cached.delay === interpolationDelay) {
            return cached.result;
        }

        // Apply interpolation delay (render in the past)
        const delayedTime = renderTime - interpolationDelay;

        const buffer = this.playerBuffers.get(steamId);
        if (!buffer || buffer.length === 0) return null;
        const cacheResult = (result) => {
            this._resultCache.set(steamId, {
                time: renderTime,
                version,
                delay: interpolationDelay,
                result,
            });
            return result;
        };
        const stats = this._getStatsMutable(steamId);

        // 1. If only one snapshot, return it (nothing to interpolate)
        if (buffer.length === 1) {
            stats.holdLastFrames += 1;
            return cacheResult(buffer[0].data);
        }

        // 2. Find the two snapshots surrounding the delayedTime
        // We want: fromState.timestamp <= delayedTime <= toState.timestamp
        let fromNode = null;
        let toNode = null;

        for (let i = buffer.length - 1; i >= 0; i--) {
            const snapshot = buffer[i];
            if (snapshot.timestamp <= delayedTime) {
                fromNode = snapshot;
                toNode = buffer[i + 1]; // The next one in future
                break;
            }
        }

        // 3. Handle edge cases

        // If we are strictly behind the oldest snapshot (rendering too far in past or just joined)
        if (!fromNode) {
            stats.underflowFrames += 1;
            return cacheResult(buffer[0].data);
        }

        // If we are past the newest snapshot (lag / packet loss), return newest
        if (!toNode) {
            stats.holdLastFrames += 1;
            return cacheResult(fromNode.data);
        }

        // 4. Interpolate
        const result = this._interpolate(steamId, fromNode, toNode, delayedTime);

        // PERF: Cache result for this frame
        return cacheResult(result);
    }

    getInterpolationDelay(steamId) {
        if (!this.adaptive) return this.interpolationDelay;
        const stats = this.playerStats.get(steamId);
        const jitterMs = stats ? Math.max(stats.jitterMs || 0, (stats.maxJitterMs || 0) * 0.5) : 0;
        const delay = this.minInterpolationDelay + jitterMs * this.jitterSafetyMultiplier;
        return Math.max(this.minInterpolationDelay, Math.min(this.maxInterpolationDelay, delay));
    }

    getStats(steamId) {
        const stats = this.playerStats.get(steamId);
        const buffer = this.playerBuffers.get(steamId);
        return {
            adaptive: this.adaptive,
            interpolationDelay: this.getInterpolationDelay(steamId),
            minInterpolationDelay: this.minInterpolationDelay,
            maxInterpolationDelay: this.maxInterpolationDelay,
            jitterMs: stats?.jitterMs || 0,
            maxJitterMs: stats?.maxJitterMs || 0,
            snapshots: stats?.snapshots || 0,
            droppedSnapshots: stats?.droppedSnapshots || 0,
            sequenceGaps: stats?.sequenceGaps || 0,
            holdLastFrames: stats?.holdLastFrames || 0,
            underflowFrames: stats?.underflowFrames || 0,
            bufferSize: buffer?.length || 0,
        };
    }

    getAllStats() {
        const out = {};
        this.playerBuffers.forEach((_, steamId) => {
            out[steamId] = this.getStats(steamId);
        });
        return out;
    }

    /**
     * Perform the interpolation
     */
    _getScratchState(steamId, template) {
        if (!this._stateScratch.has(steamId)) {
            this._stateScratch.set(steamId, {});
        }
        const scratch = this._stateScratch.get(steamId);
        Object.keys(scratch).forEach((key) => {
            if (!(key in template)) {
                delete scratch[key];
            }
        });
        Object.assign(scratch, template);
        return scratch;
    }

    _getScratchPiece(steamId) {
        if (!this._interpolatedPieces.has(steamId)) {
            this._interpolatedPieces.set(steamId, {
                type: null, shape: null, x: 0, y: 0, rotation: 0, color: null,
            });
        }
        return this._interpolatedPieces.get(steamId);
    }

    _interpolate(steamId, fromNode, toNode, targetTime) {
        const fromState = fromNode.data;
        const toState = toNode.data;

        // Calculate factor (0.0 to 1.0)
        const duration = toNode.timestamp - fromNode.timestamp;
        let t = 0;
        if (duration > 0) {
            t = (targetTime - fromNode.timestamp) / duration;
        }

        // Clamp t
        t = Math.max(0, Math.min(1, t));

        // === INTERPOLATION LOGIC ===

        // 1. Current Piece Position (Linear Interpolation)
        // Only interpolate if it's the SAME piece (same type/id if available)
        // Detecting "same piece" can be tricky without unique IDs, but type check is decent proxy
        let interpolatedPiece = toState.currentPiece; // Default to target state

        if (fromState.currentPiece && toState.currentPiece) {
            // Check heuristic: if distance is huge, it's likely a new spawn or hard drop
            const dx = Math.abs(toState.currentPiece.x - fromState.currentPiece.x);
            const dy = Math.abs(toState.currentPiece.y - fromState.currentPiece.y);

            // Should interpolate?
            const canInterpolate = (
                fromState.currentPiece.type === toState.currentPiece.type // Same piece type
                && dx < 5 && dy < 5 // Not a teleport/spawn (heuristic)
            );

            if (canInterpolate) {
                // PERF: Reuse pre-allocated piece object instead of creating new one
                const piece = this._getScratchPiece(steamId);
                const toPiece = toState.currentPiece;
                piece.type = toPiece.type;
                piece.shape = toPiece.shape;
                piece.x = this._lerp(fromState.currentPiece.x, toPiece.x, t);
                piece.y = this._lerp(fromState.currentPiece.y, toPiece.y, t);
                piece.rotation = toPiece.rotation;
                piece.color = toPiece.color;
                interpolatedPiece = piece;
            }
        }

        // 2. Default to "toState" for discrete data (grid, score, etc.).
        // Return a reusable wrapper so buffered snapshots stay immutable.
        const out = this._getScratchState(steamId, toState);
        out.currentPiece = interpolatedPiece;
        return out;
    }

    _lerp(start, end, t) {
        return start + (end - start) * t;
    }

    _finiteNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    _orderingKey(fullState, fallback) {
        return this._finiteNumber(fullState.snapshotSeq)
            ?? this._finiteNumber(fullState.tick)
            ?? this._finiteNumber(fullState.simTick)
            ?? fallback;
    }

    _timelineKey(fullState) {
        const simTick = this._finiteNumber(fullState.simTick);
        if (simTick != null) {
            return { type: 'simTick', value: simTick, unitMs: this.simTickMs };
        }
        const snapshotSeq = this._finiteNumber(fullState.snapshotSeq);
        if (snapshotSeq != null) {
            return { type: 'snapshotSeq', value: snapshotSeq, unitMs: this.snapshotIntervalMs };
        }
        const tick = this._finiteNumber(fullState.tick);
        if (tick != null) {
            return { type: 'tick', value: tick, unitMs: this.snapshotIntervalMs };
        }
        return null;
    }

    _timelineTimestamp(steamId, fullState, receivedAt, fallbackTimestamp) {
        const key = this._timelineKey(fullState);
        if (!key) return fallbackTimestamp;

        const roundGeneration = this._finiteNumber(fullState.roundGeneration);
        let timeline = this.playerTimelines.get(steamId);
        const shouldReset = !timeline
            || timeline.type !== key.type
            || key.value < timeline.lastValue
            || (roundGeneration != null && timeline.roundGeneration != null && roundGeneration !== timeline.roundGeneration);

        if (shouldReset) {
            timeline = {
                type: key.type,
                unitMs: key.unitMs,
                baseValue: key.value,
                baseLocalTime: receivedAt,
                lastValue: key.value,
                lastTimestamp: null,
                lastReceivedAt: null,
                roundGeneration,
            };
            this.playerTimelines.set(steamId, timeline);
        }

        let timestamp = timeline.baseLocalTime + (key.value - timeline.baseValue) * timeline.unitMs;
        if (timeline.lastTimestamp != null && timestamp <= timeline.lastTimestamp) {
            timestamp = timeline.lastTimestamp + 0.001;
        }

        this._recordTimelineJitter(steamId, timeline, timestamp, receivedAt);

        timeline.lastValue = key.value;
        timeline.lastTimestamp = timestamp;
        timeline.lastReceivedAt = receivedAt;
        if (roundGeneration != null) timeline.roundGeneration = roundGeneration;

        return timestamp;
    }

    _recordTimelineJitter(steamId, timeline, timestamp, receivedAt) {
        if (timeline.lastTimestamp == null || timeline.lastReceivedAt == null) return;
        const expectedGap = timestamp - timeline.lastTimestamp;
        const arrivalGap = receivedAt - timeline.lastReceivedAt;
        if (expectedGap <= 0 || arrivalGap < 0) return;

        const sample = Math.abs(arrivalGap - expectedGap);
        const stats = this._getStatsMutable(steamId);
        stats.jitterMs = stats.jitterSamples === 0
            ? sample
            : stats.jitterMs * (1 - this.jitterEwmaAlpha) + sample * this.jitterEwmaAlpha;
        stats.maxJitterMs = Math.max(sample, stats.maxJitterMs * 0.95);
        stats.jitterSamples += 1;
        stats.lastArrivalGapMs = arrivalGap;
        stats.lastTimelineGapMs = expectedGap;
    }

    _getStatsMutable(steamId) {
        if (!this.playerStats.has(steamId)) {
            this.playerStats.set(steamId, {
                snapshots: 0,
                droppedSnapshots: 0,
                sequenceGaps: 0,
                holdLastFrames: 0,
                underflowFrames: 0,
                jitterMs: 0,
                maxJitterMs: 0,
                jitterSamples: 0,
                lastSnapshotSeq: null,
                lastReceivedAt: null,
                lastArrivalGapMs: 0,
                lastTimelineGapMs: 0,
            });
        }
        return this.playerStats.get(steamId);
    }

    /**
     * Clear buffer for a player
     */
    reset(steamId) {
        if (steamId) {
            this.playerBuffers.delete(steamId);
            this.playerTimelines.delete(steamId);
            this.playerStats.delete(steamId);
            this._stateScratch.delete(steamId);
            this._interpolatedPieces.delete(steamId);
            this._resultCache.delete(steamId);
            this._bufferVersions.delete(steamId);
        } else {
            this.playerBuffers.clear();
            this.playerTimelines.clear();
            this.playerStats.clear();
            this._stateScratch.clear();
            this._interpolatedPieces.clear();
            this._resultCache.clear();
            this._bufferVersions.clear();
        }
    }
}
