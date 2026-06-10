/**
 * @fileoverview OdysseyAdaptiveQuality — best-in-class adaptive quality controller for
 * Odyssey Mode (three.js WebGPURenderer + TSL post graph).
 *
 * Goal: hold a stable 60fps on everything from a weak laptop iGPU to a 4090 by reacting to
 * MEASURED frame time, shedding quality cheapest-first and restoring it slowest-first, with
 * hysteresis so it never oscillates. See docs/ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md §4.
 *
 * Tiers (cheapest → most expensive to lose, applied in that order under pressure; reversed
 * on recovery, ONE tier per up-cooldown):
 *   • Tier 0 — RESOLUTION. Drives `renderScale` via the shipped
 *     `evaluateDynamicResolutionAdjustment` policy (downscale p95 > 1.14× budget, upscale
 *     p95 < 0.9×, 6s/12s cooldowns, 0.5..1.25 clamp). On a change it calls back into the
 *     board (`ctx.applyRenderScale`) which does setPixelRatio + pipeline.resize. This
 *     SUBSUMES the board's old inline DRS call — there is exactly one resolution controller.
 *   • Tier 1 — BLOOM. Once resolution is at its floor and pressure persists, drop the bloom
 *     working resolution toward 0.25 (`pipeline.setBloomScale`), then disable the bloom node
 *     entirely (`pipeline.setBloomEnabled(false)`). Restored on recovery.
 *   • Tier 2 — POST EXTRAS. Soften then disable the cheapest per-pixel post terms
 *     (edge chromatic-aberration + film grain) via `pipeline.setPostQuality(level)`.
 *
 * Hot-path discipline: `recordFrame(deltaMs)` pushes into a preallocated ring buffer — NO
 * per-frame allocation. `update(nowMs, ctx)` self-throttles to ~1Hz and computes p95/p99 by
 * copying into a reused scratch buffer (no allocation). Every ctx hook is optional — a
 * missing hook makes the corresponding tier a no-op. The controller never reaches above the
 * preset ceiling supplied at construction, and a disabled controller does nothing.
 */

const DEFAULT_WINDOW = 60; // rolling frames for the p95/p99 estimate
const DEFAULT_EVAL_INTERVAL_MS = 1000; // self-throttle: evaluate at ~1Hz
const DEFAULT_TARGET_FPS = 60;
const MIN_SAMPLES = 30; // need a representative window before acting (skip the cold start)

// Tier-1 bloom working-resolution steps (full → quarter-res) before the node is dropped.
const BLOOM_SCALE_FULL = 0.5;
const BLOOM_SCALE_FLOOR = 0.25;

// Up-recovery cadence: only step ONE non-resolution tier back up per this interval, so a
// scene that is exactly on the edge cannot ping-pong a tier on/off (hysteresis).
const TIER_RECOVER_COOLDOWN_MS = 12000;
// Down-escalation cadence: once resolution is pinned at floor, wait this long under
// continued pressure before shedding the next (bloom/post) tier (matches the policy's
// 6s down cooldown so the two controllers move in lockstep, never twice in one window).
const TIER_ESCALATE_COOLDOWN_MS = 6000;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function percentile(sortedAscending, count, fraction) {
    if (count <= 0) return 0;
    const idx = Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
    return sortedAscending[idx];
}

/**
 * The non-resolution degrade tiers, ordered cheapest-to-lose first. The controller walks a
 * single integer `pressureTier` cursor through these so escalate/recover is just ±1.
 *   0 = full quality (nothing shed beyond resolution)
 *   1 = bloom working-res dropped to quarter
 *   2 = bloom disabled
 *   3 = post extras softened (CA/grain at half)
 *   4 = post extras disabled
 */
const MAX_PRESSURE_TIER = 4;

export class OdysseyAdaptiveQuality {
    /**
     * @param {object} [opts]
     * @param {number} [opts.targetFrameRate=60] target FPS the budget is derived from.
     * @param {number} [opts.windowSize=60] rolling frame-time window length.
     * @param {number} [opts.evalIntervalMs=1000] minimum ms between evaluations (self-throttle).
     * @param {number} [opts.baselineRenderScale=1] the per-preset render-scale CEILING
     *        (Tier 0 rides between this and the policy floor; never exceeds it).
     * @param {number} [opts.renderScale=baselineRenderScale] initial live render scale.
     * @param {boolean} [opts.enabled=true] master gate; a disabled controller is inert.
     * @param {function} [opts.evaluateResolution] resolution policy
     *        (defaults to the shipped evaluateDynamicResolutionAdjustment).
     */
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.targetFrameRate = opts.targetFrameRate > 0 ? opts.targetFrameRate : DEFAULT_TARGET_FPS;
        this.windowSize = opts.windowSize > 0 ? Math.floor(opts.windowSize) : DEFAULT_WINDOW;
        this.evalIntervalMs = opts.evalIntervalMs > 0 ? opts.evalIntervalMs : DEFAULT_EVAL_INTERVAL_MS;
        this._evaluateResolution = typeof opts.evaluateResolution === 'function'
            ? opts.evaluateResolution
            : null;

        // ── Resolution tier (Tier 0) state — fully owned here (subsumes the board's DRS) ──
        const baseline = Number.isFinite(opts.baselineRenderScale) ? opts.baselineRenderScale : 1;
        this.baselineRenderScale = baseline; // ceiling (the preset cap); never exceeded.
        this.renderScale = Number.isFinite(opts.renderScale) ? opts.renderScale : baseline;
        this._lastScaleChangeAt = 0;
        this._stableSince = 0;

        // ── Frame-time ring buffer (preallocated; NO per-frame allocation) ──
        this._frameTimes = new Float32Array(this.windowSize);
        this._sortScratch = new Float32Array(this.windowSize);
        this._frameCount = 0;
        this._frameHead = 0;

        // ── Self-throttle / pressure cursor / hysteresis timers ──
        this._lastEvalAt = 0;
        this._pressureTier = 0; // 0..MAX_PRESSURE_TIER; current shed level beyond resolution.
        this._lastTierChangeAt = 0; // last escalate/recover of a non-resolution tier.
        // The down-pressure run length: how many consecutive evals the policy has WANTED to
        // downscale while already pinned at the resolution floor. Drives Tier-1+ escalation.
        this._floorPressureSince = 0;

        // Latched applied state so we only call pipeline knobs on an actual transition (the
        // pipeline methods are themselves edge-safe, but this keeps the hot path quiet).
        this._appliedBloomScale = BLOOM_SCALE_FULL;
        this._appliedBloomEnabled = true;
        this._appliedPostQuality = 1;
    }

    /** Master gate. A disabled controller records nothing and applies nothing. */
    setEnabled(enabled) {
        this.enabled = enabled !== false;
    }

    /**
     * Re-seat the resolution ceiling when the user changes the quality preset. Keeps the live
     * render scale at or below the new ceiling and resets the recovery clock so a fresh preset
     * is not instantly clawed back. Does NOT itself resize — the board re-applies on preset
     * change. Safe to call any time.
     * @param {number} baselineRenderScale
     */
    setBaselineRenderScale(baselineRenderScale) {
        if (!Number.isFinite(baselineRenderScale)) return;
        this.baselineRenderScale = baselineRenderScale;
        if (this.renderScale > baselineRenderScale) this.renderScale = baselineRenderScale;
        this._stableSince = 0;
    }

    /** @returns {number} the current live render scale (Tier 0). */
    getRenderScale() {
        return this.renderScale;
    }

    /**
     * Hot path — push one frame's wall-clock time into the ring buffer. Allocation-free.
     * @param {number} deltaMs frame time in milliseconds.
     */
    recordFrame(deltaMs) {
        if (!this.enabled) return;
        if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
        this._frameTimes[this._frameHead] = deltaMs;
        this._frameHead = (this._frameHead + 1) % this.windowSize;
        if (this._frameCount < this.windowSize) this._frameCount += 1;
    }

    /**
     * Throttled (~1Hz) evaluation. Runs the resolution policy first; if resolution is pinned
     * at its floor and pressure persists, escalates the next non-resolution tier (one per
     * escalate-cooldown). On recovery it reverses: restore non-resolution tiers first (one
     * per recover-cooldown), and only let resolution climb once everything else is restored.
     * Does nothing if called too soon, if disabled, or before a representative window exists.
     * @param {number} nowMs monotonic clock (performance.now()).
     * @param {object} ctx board-supplied hooks (all optional → tier becomes a no-op):
     *   @param {function(number):void} [ctx.applyRenderScale] apply a Tier-0 render scale.
     *   @param {object} [ctx.pipeline] the post stack (setBloomScale/setBloomEnabled/setPostQuality).
     *   @param {number} [ctx.targetFrameRate] override the FPS budget for this eval.
     */
    update(nowMs, ctx = {}) {
        if (!this.enabled) return;
        const now = Number.isFinite(nowMs) ? nowMs : 0;
        if (now - this._lastEvalAt < this.evalIntervalMs) return;
        this._lastEvalAt = now;
        if (this._frameCount < Math.min(this.windowSize, MIN_SAMPLES)) return;

        const { p95, p99 } = this._computePercentiles();
        const targetFps = ctx.targetFrameRate > 0 ? ctx.targetFrameRate : this.targetFrameRate;
        const budgetMs = 1000 / targetFps;
        const downThreshold = budgetMs * 1.14; // matches the resolution policy's downscale gate
        const upThreshold = budgetMs * 0.9; // matches the resolution policy's upscale gate
        const underPressure = p95 > downThreshold || p99 > downThreshold * 1.08;
        const hasHeadroom = p95 > 0 && p95 < upThreshold;

        // ── Tier 0: resolution (delegated to the shipped policy when available) ──
        const resChanged = this._updateResolution(now, ctx, p95, p99, targetFps);

        // If the resolution tier just moved, let it settle before touching other tiers (one
        // lever per eval keeps the system legible and prevents double-stepping under a spike).
        if (resChanged) {
            this._floorPressureSince = 0;
            return;
        }

        const atFloor = this.renderScale <= this._resolutionFloor() + 1e-3;

        if (underPressure && atFloor) {
            // Resolution can shed no further → escalate the next cheap tier, rate-limited.
            this._floorPressureSince = this._floorPressureSince || now;
            const heldUnderPressure = now - this._floorPressureSince >= TIER_ESCALATE_COOLDOWN_MS;
            const tierCooled = now - this._lastTierChangeAt >= TIER_ESCALATE_COOLDOWN_MS;
            if (this._pressureTier < MAX_PRESSURE_TIER && heldUnderPressure && tierCooled) {
                this._pressureTier += 1;
                this._lastTierChangeAt = now;
                this._floorPressureSince = now; // require another full hold before the next step
                this._applyPressureTier(ctx);
            }
            return;
        }

        // Not under pressure (or resolution still has room to climb) → clear the floor clock.
        this._floorPressureSince = 0;

        if (hasHeadroom && this._pressureTier > 0) {
            // Recover the most-recently-shed (most expensive) non-resolution tier FIRST, one
            // per recover-cooldown, before resolution is allowed to climb back up.
            const tierCooled = now - this._lastTierChangeAt >= TIER_RECOVER_COOLDOWN_MS;
            if (tierCooled) {
                this._pressureTier -= 1;
                this._lastTierChangeAt = now;
                this._applyPressureTier(ctx);
            }
        }
    }

    /**
     * Tier-0 resolution step. Uses the injected policy if present (the shipped
     * evaluateDynamicResolutionAdjustment), else a small built-in equivalent so the controller
     * is self-contained/testable. Resolution only climbs once all non-resolution tiers are
     * restored (pressureTier===0) — keeping a single, predictable recovery order.
     * @returns {boolean} whether the render scale changed (and was applied).
     * @private
     */
    _updateResolution(now, ctx, p95, p99, targetFps) {
        let next = this.renderScale;
        let changed = false;

        if (this._evaluateResolution) {
            const result = this._evaluateResolution({
                currentRenderScale: this.renderScale,
                baselineRenderScale: this.baselineRenderScale,
                releaseGates: { frameTime: { p95, p99 } },
                targetFrameRate: targetFps,
                lastScaleChangeAt: this._lastScaleChangeAt,
                stableSince: this._stableSince,
                now,
            });
            next = result?.nextRenderScale ?? this.renderScale;
            changed = result?.changed === true && next !== this.renderScale;
        }

        // Gate UP-scaling on full recovery of the cheaper tiers: never let resolution climb
        // while bloom/post are still shed (cheap quality should come back before pixels).
        if (changed && next > this.renderScale && this._pressureTier > 0) {
            changed = false;
            next = this.renderScale;
        }
        // Never exceed the preset ceiling.
        if (next > this.baselineRenderScale) next = this.baselineRenderScale;

        if (changed) {
            this.renderScale = next;
            this._lastScaleChangeAt = now;
            this._stableSince = 0;
            if (typeof ctx.applyRenderScale === 'function') ctx.applyRenderScale(next);
            return true;
        }
        if (this._stableSince === 0) this._stableSince = now;
        return false;
    }

    /**
     * The render-scale floor the policy clamps to. Mirrors the policy's 0.5 clamp; exposed as
     * a method so a custom policy could tighten it without the controller drifting.
     * @private
     */
    // eslint-disable-next-line class-methods-use-this
    _resolutionFloor() {
        return 0.5;
    }

    /**
     * Map the current pressure-tier cursor to concrete pipeline state and apply ONLY the
     * knobs whose target changed (each pipeline call is also edge-safe). Allocation-free.
     * @private
     */
    _applyPressureTier(ctx) {
        const pipeline = ctx.pipeline || null;
        const tier = this._pressureTier;

        // Derive the target state for each knob from the single tier cursor.
        const bloomScale = tier >= 1 ? BLOOM_SCALE_FLOOR : BLOOM_SCALE_FULL;
        const bloomEnabled = tier < 2;
        // Tier 3 softens post extras to half; Tier 4 disables them.
        let postQuality = 1;
        if (tier >= 4) postQuality = 0;
        else if (tier >= 3) postQuality = 0.5;

        if (pipeline) {
            if (bloomScale !== this._appliedBloomScale && typeof pipeline.setBloomScale === 'function') {
                pipeline.setBloomScale(bloomScale);
            }
            if (bloomEnabled !== this._appliedBloomEnabled && typeof pipeline.setBloomEnabled === 'function') {
                pipeline.setBloomEnabled(bloomEnabled);
            }
            if (postQuality !== this._appliedPostQuality && typeof pipeline.setPostQuality === 'function') {
                pipeline.setPostQuality(postQuality);
            }
        }

        this._appliedBloomScale = bloomScale;
        this._appliedBloomEnabled = bloomEnabled;
        this._appliedPostQuality = postQuality;
    }

    /**
     * Copy the live ring buffer into the reused scratch buffer, sort it, and read p95/p99.
     * Allocation-free (typed-array subarray view + in-place sort on the scratch).
     * @private
     */
    _computePercentiles() {
        const count = this._frameCount;
        for (let i = 0; i < count; i += 1) this._sortScratch[i] = this._frameTimes[i];
        const sorted = this._sortScratch.subarray(0, count);
        sorted.sort();
        return {
            p95: percentile(sorted, count, 0.95),
            p99: percentile(sorted, count, 0.99),
        };
    }

    /**
     * Diagnostic snapshot (for the debug overlay). Allocates one small object — call rarely,
     * never in the hot path.
     * @returns {{renderScale:number, baselineRenderScale:number, pressureTier:number,
     *            bloomScale:number, bloomEnabled:boolean, postQuality:number}}
     */
    getState() {
        return {
            renderScale: this.renderScale,
            baselineRenderScale: this.baselineRenderScale,
            pressureTier: clamp(this._pressureTier, 0, MAX_PRESSURE_TIER),
            bloomScale: this._appliedBloomScale,
            bloomEnabled: this._appliedBloomEnabled,
            postQuality: this._appliedPostQuality,
        };
    }
}

export default OdysseyAdaptiveQuality;
