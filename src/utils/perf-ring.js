/**
 * PerfRing — a fixed-size sample ring with percentile summaries and no mean.
 *
 * The measurement discipline Wave −1 of docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md makes an exit
 * criterion, in one place instead of three: **median and p99 only, never mean**; a fixed-size
 * buffer so nothing grows; and no allocation on the hot path.
 *
 * The "never mean" rule is not stylistic. This project already shipped an FPS counter that
 * reported the mean of reciprocals and read ~2x high, and a frame-time baseline whose mean hid
 * a p99 of 199 ms behind a p50 of 5.9 ms. A mean over a distribution with a tail describes a
 * frame nobody ever rendered.
 *
 * `push()` allocates nothing. `summarize()` allocates nothing after the first call — it sorts
 * into a persistent scratch array — but it is O(n log n), so callers should throttle it
 * (~4 Hz) rather than call it per frame.
 */

export const DEFAULT_CAPACITY = 240;

export class PerfRing {
    /**
     * @param {number} [capacity] samples retained; the oldest is overwritten past this.
     */
    constructor(capacity = DEFAULT_CAPACITY) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new Error(`[perf-ring] capacity must be a positive integer, got ${capacity}`);
        }
        this.capacity = capacity;
        this._buffer = new Float64Array(capacity);
        this._scratch = new Float64Array(capacity);
        this._count = 0;
    }

    /** Total samples ever pushed (not the number retained). */
    get count() {
        return this._count;
    }

    /** Samples currently retained. */
    get size() {
        return Math.min(this._count, this.capacity);
    }

    /**
     * Record one sample. Non-finite values are DROPPED rather than poisoning the percentiles —
     * `renderer.info.render.timestamp` is null until the first resolve lands.
     * @param {number} value
     * @returns {boolean} whether the sample was recorded
     */
    push(value) {
        if (!Number.isFinite(value)) return false;
        this._buffer[this._count % this.capacity] = value;
        this._count += 1;
        return true;
    }

    /** Forget every sample, keeping the allocation. Use between A/B configurations. */
    reset() {
        this._count = 0;
    }

    /**
     * Percentile summary of the retained samples. No mean — see the file header.
     * @returns {{samples:number, p50:number|null, p95:number|null, p99:number|null,
     *   min:number|null, max:number|null}}
     */
    summarize() {
        const { size } = this;
        if (size === 0) {
            return {
                samples: 0, p50: null, p95: null, p99: null, min: null, max: null,
            };
        }
        // Copy out in age order into the persistent scratch, then sort in place. subarray()
        // returns a view, not a copy, so sort() here does not allocate.
        const start = this._count > this.capacity ? this._count % this.capacity : 0;
        for (let i = 0; i < size; i += 1) {
            this._scratch[i] = this._buffer[(start + i) % this.capacity];
        }
        const view = this._scratch.subarray(0, size);
        view.sort();
        return {
            samples: size,
            p50: percentileOf(view, 0.50),
            p95: percentileOf(view, 0.95),
            p99: percentileOf(view, 0.99),
            min: view[0],
            max: view[size - 1],
        };
    }
}

/**
 * Nearest-rank percentile of an ASCENDING sorted sequence: the smallest value at or above the
 * given fraction of the samples. No interpolation, so every result is a frame that actually
 * happened.
 * @param {ArrayLike<number>} sorted
 * @param {number} fraction 0..1
 * @returns {number|null}
 */
export function percentileOf(sorted, fraction) {
    const n = sorted.length;
    if (!n) return null;
    const rank = Math.ceil(n * fraction);
    return sorted[Math.min(n - 1, Math.max(0, rank - 1))];
}
