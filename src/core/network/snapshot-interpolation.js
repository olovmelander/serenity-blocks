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
        this.interpolationDelay = config.interpolationDelay || 50;

        // Max buffer size to prevent memory leaks
        this.maxBufferSize = 10;

        // Map of steamId -> Array<Snapshot>
        this.playerBuffers = new Map();

        // Debug mode
        this.debug = false;

        // === PERFORMANCE OPTIMIZATIONS ===
        // Cache last interpolation results to avoid recalculating same frame
        this._lastRenderTime = 0;
        this._resultCache = new Map(); // steamId -> { time, result }
        // Pre-allocated interpolation objects (reused to avoid allocations)
        this._interpolatedPieces = new Map();
        this._stateScratch = new Map();
    }

    /**
     * Add a new state snapshot
     * @param {Object} fullState - The full game state snapshot from host
     */
    addSnapshot(fullState) {
        if (!fullState || !fullState.players) return;

        const timestamp = fullState.timestamp || Date.now();

        fullState.players.forEach((playerData) => {
            const { steamId } = playerData;
            if (!this.playerBuffers.has(steamId)) {
                this.playerBuffers.set(steamId, []);
            }

            const buffer = this.playerBuffers.get(steamId);

            // Add new snapshot (sorted by time implicitly if arrival is ordered)
            // We ensure ordering by tick or timestamp
            if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                if (timestamp <= last.timestamp) {
                    // Out of order or duplicate, ignore given we handle jitter elsewhere
                    // or just push if we trust the source.
                    // For interpolation, strictly increasing time is required.
                    return;
                }
            }

            // Store lightweight snapshot for interpolation
            // We only need interpolate-able data (piece position) + full state reference
            buffer.push({
                timestamp,
                data: playerData,
            });

            // Prune buffer
            if (buffer.length > this.maxBufferSize) {
                buffer.shift();
            }
        });
    }

    /**
     * Get interpolated state for a specific player at the current render time
     * @param {string} steamId - Player Steam ID
     * @param {number} renderTime - Current time - interpolation delay
     * @returns {Object|null} Interpolated player state
     */
    getInterpolatedState(steamId, renderTime) {
        // PERF: Check cache first - same frame returns cached result
        const cached = this._resultCache.get(steamId);
        if (cached && cached.time === renderTime) {
            return cached.result;
        }

        // Apply interpolation delay (render in the past)
        const delayedTime = renderTime - this.interpolationDelay;

        const buffer = this.playerBuffers.get(steamId);
        if (!buffer || buffer.length === 0) return null;

        // 1. If only one snapshot, return it (nothing to interpolate)
        if (buffer.length === 1) {
            return buffer[0].data;
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
            return buffer[0].data;
        }

        // If we are past the newest snapshot (lag / packet loss), return newest
        if (!toNode) {
            return fromNode.data;
        }

        // 4. Interpolate
        const result = this._interpolate(steamId, fromNode, toNode, delayedTime);

        // PERF: Cache result for this frame
        this._resultCache.set(steamId, { time: renderTime, result });

        return result;
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

    /**
     * Clear buffer for a player
     */
    reset(steamId) {
        if (steamId) {
            this.playerBuffers.delete(steamId);
            this._stateScratch.delete(steamId);
            this._interpolatedPieces.delete(steamId);
        } else {
            this.playerBuffers.clear();
            this._stateScratch.clear();
            this._interpolatedPieces.clear();
        }
    }
}
