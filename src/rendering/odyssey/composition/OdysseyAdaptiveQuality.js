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
        // The floor the CONSUMER actually clamps to. Defaults to the policy's own 0.5 so every
        // existing caller keeps its behaviour; the Odyssey board passes its stricter legibility
        // floor (ODYSSEY_RENDER_SCALE_FLOOR) because it clamps there regardless. A controller
        // that does not know the real floor spends whole cooldowns proposing steps its consumer
        // silently discards — 36 s of "recovering" with no pixel ever returning.
        this.resolutionFloor = Number.isFinite(opts.resolutionFloor) ? opts.resolutionFloor : 0.5;
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
        // The pipeline's AUTHORED bloom scale — the value tier 0 must RESTORE, not a constant.
        // Defaults to BLOOM_SCALE_FULL so existing callers/tests are unchanged; the board seats
        // the real value (ODYSSEY_BLOOM_SCALE, or the ?odysseyPerfBloomScale override) through
        // setBaselineBloomScale once the pipeline exists. Latching a hardcoded 0.5 against a
        // pipeline authored at 0.25 is what made tier-0 recovery RAISE bloom above authored.
        this._baselineBloomScale = Number.isFinite(opts.baselineBloomScale)
            ? opts.baselineBloomScale
            : BLOOM_SCALE_FULL;
        this._appliedBloomScale = this._baselineBloomScale;
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

    /**
     * Seat the AUTHORED bloom scale the ladder must return to at tier 0. The board calls this
     * once the post pipeline exists, reading the value back off the pipeline so the
     * ?odysseyPerfBloomScale override is honoured too — otherwise a perf A/B that dips and
     * recovers silently stops measuring the scale it asked for.
     * @param {number} scale
     */
    setBaselineBloomScale(scale) {
        if (!Number.isFinite(scale)) return;
        this._baselineBloomScale = Math.min(1, Math.max(0.1, scale));
        if (this._pressureTier === 0) this._appliedBloomScale = this._baselineBloomScale;
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
     * Discard the current frame-time window + re-base the evaluation/stability clocks so the NEXT
     * window is measured from a clean slate. The board calls this once the startup background
     * chapter-load + render-warm settle: those frames are main-thread-blocked by synchronous JS
     * chapter builds (NOT GPU-bound), so if they reach the resolution policy it slashes renderScale
     * for the whole session (the board then reads low-res even at 200+fps, since recovery is a slow
     * +step/cooldown climb). Leaves renderScale + the escalated tier untouched — measurement state only.
     * @param {number} [nowMs=0] monotonic clock used to re-base the eval + stability timers.
     */
    resetFrameWindow(nowMs = 0) {
        this._frameCount = 0;
        this._frameHead = 0;
        this._lastEvalAt = nowMs;
        this._stableSince = nowMs;
        this._floorPressureSince = 0;
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
        // Clamp into [floor, ceiling] in ONE expression — order matters. Clamping up to the
        // floor after clamping down to the ceiling could re-raise `next` above the ceiling once
        // a preset seats a baseline below the floor (getPackagedWindowsRecommendedSettings
        // already returns 0.65 for a 9 MP display), so the ceiling must win.
        next = Math.min(this.baselineRenderScale, Math.max(next, this._resolutionFloor()));
        // Re-test AFTER clamping: this is what kills the dead step. At the floor the policy
        // keeps proposing a lower scale, the clamp puts it back, and `changed` must go false so
        // no cooldown is stamped — otherwise every discarded proposal costs a full window and
        // `atFloor` never latches, delaying the bloom/post ladder that is the actual relief.
        changed = changed && next !== this.renderScale;

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
     * The render-scale floor this controller's CONSUMER actually clamps to — not the policy's.
     * Defaults to the policy's own 0.5; the Odyssey board seats 0.65 because `_applyRenderScale`
     * clamps there for legibility. Proposing a step below the consumer's floor is not a smaller
     * picture, it is a discarded write plus a wasted cooldown.
     * @private
     */
    _resolutionFloor() {
        return this.resolutionFloor;
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
        // Math.min is what makes the ratchet impossible: a shed tier can never ask for MORE
        // bloom than the authored baseline, and tier 0 restores exactly the baseline.
        const bloomScale = tier >= 1
            ? Math.min(BLOOM_SCALE_FLOOR, this._baselineBloomScale)
            : this._baselineBloomScale;
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
