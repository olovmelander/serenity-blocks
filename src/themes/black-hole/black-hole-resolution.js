/**
 * Dynamic resolution for the Black Hole theme. Nearly all of the frame is one fragment
 * shader whose cost is proportional to the pixels drawn, so render scale is the one lever
 * that follows load exactly. The controller is plain numbers: its owner feeds it the work a
 * frame took and applies the scale it returns.
 *
 * It prefers measured GPU render time, which is the real fill cost. Where the backend cannot
 * report that it falls back to frame time, and frame time is a poorer witness in four ways,
 * each of which is handled here:
 *
 * - It cannot show headroom: a frame never arrives early. So when frames are on time the
 *   controller probes upward, and keeps a scale that just failed off-limits for a while —
 *   longer each time the probe fails again — so the picture cannot pump.
 * - It is ragged: frames land on whole refresh intervals. So it is averaged over about a
 *   second, and acted on only once it has read late twice running and stopped moving.
 * - It must be the browser's cadence, not the owner's: a theme that draws on only some
 *   animation frames, to hold a frame-rate cap, would otherwise mistake its own cap for load.
 * - It is late for reasons that have nothing to do with pixels. So every run of steps down
 *   is judged against the reading it started from, and if two steps bought nothing the
 *   resolution is handed back rather than left blurred at the floor.
 */
const STEP_DOWN_HARD = 0.08;
const STEP_DOWN = 0.05;
const STEP_UP = 0.05;
/** A step up that would stop this close to its limit goes all the way. */
const SNAP = 0.02;
/** Seconds after start (pipelines are still compiling) and after each change. */
const WARMUP = 2.5;
const COOLDOWN = 0.75;
const INTERVAL = 0.5;
/** A reading above this multiple of its budget is late; below `ROOM` there is room to grow. */
const LATE = 1.12;
const ROOM_GPU = 0.85;
const ROOM_FRAME = 1.04;
/** This many frames over four times the budget, in a row, count as load rather than a hitch. */
const LONG_FRAME_RUN = 4;
/** A GPU sample older than this is stale; fall back to frame time. */
const GPU_FRESH_SECONDS = 0.5;
/** Seconds the frame-time average looks back over. */
const FRAME_SMOOTHING = 1;
/** Evaluations in a row that frame time must read late before a step down. */
const LATE_RUN = 2;
/** Frame time has stopped moving when two evaluations agree this closely. */
const SETTLED = 0.04;
/** Evaluations in a row that must read on time before a run of steps down is over. */
const CALM_RUN = 4;
/**
 * Seconds a scale that proved too costly stays off-limits to the upward probe. Each probe
 * that fails straight away doubles the wait, up to the longest.
 */
const PROBE_HOLD = 20;
const PROBE_HOLD_LONGEST = 160;
/** A step down this soon after a step up means the probe failed. */
const PROBE_FAILED_WITHIN = 12;
/** Each step down must cut the reading by this fraction of where the run started. */
const FUTILE_GAIN = 0.03;
/** Seconds without stepping down after a run that bought nothing; doubles each time it recurs. */
const FUTILE_HOLD = 30;
const FUTILE_HOLD_LONGEST = 240;
/** Changes kept for diagnostics. */
const HISTORY = 16;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export class ResolutionController {
    constructor({ minScale = 0.5, targetFps = 60, enabled = true } = {}) {
        this.enabled = enabled;
        this.minScale = minScale;
        this.scale = 1;
        this.gpu = { ms: 0, valid: false, at: -Infinity };
        this.usingGpu = false;
        this.setTargetFps(targetFps);
        this.reset();
    }

    setTargetFps(fps) {
        const target = Math.max(30, Number.isFinite(fps) ? fps : 60);
        this.targetMs = 1000 / target;
        // Render time excludes present and vsync, so it is held to a tighter budget.
        this.gpuTargetMs = Math.max(6, this.targetMs * 0.8);
    }

    reset() {
        this.scale = 1;
        this.averageMs = this.targetMs;
        this.elapsed = 0;
        this.warmup = WARMUP;
        this.cooldown = 0;
        this.ceiling = 1;
        this.ceilingHold = 0;
        this.probeHold = PROBE_HOLD;
        this.sinceUp = Infinity;
        this.downHold = 0;
        this.futileHold = FUTILE_HOLD;
        this.longFrames = 0;
        this.lateRun = 0;
        this.calmRun = 0;
        this.previousRatio = null;
        this.endRun();
        /** The last few changes, newest last: what the scale became, when, and on what reading. */
        this.history = [];
        this.usingGpu = false;
        this.gpu.ms = 0;
        this.gpu.valid = false;
        this.gpu.at = -Infinity;
    }

    /** Forget the run of steps down in progress: the next one is judged afresh. */
    endRun() {
        this.runSteps = 0;
        this.runScale = this.scale;
        this.runRatio = 0;
    }

    /** Record a measured GPU render time (milliseconds) taken at simulation time `at`. */
    noteGpuTime(ms, at) {
        if (!(ms > 0)) return;
        this.gpu.ms = this.gpu.valid ? this.gpu.ms * 0.8 + ms * 0.2 : ms;
        this.gpu.valid = true;
        this.gpu.at = at;
    }

    /**
     * @param {number} delta seconds since the previous frame this controller was shown
     * @param {number} time simulation seconds
     * @param {number} [cadence] seconds between the browser's animation frames over that
     *   stretch — shorter than `delta` when the owner skipped some to hold a frame-rate cap
     * @returns {boolean} true when `scale` changed and should be applied
     */
    update(delta, time, cadence = delta) {
        if (!this.enabled || !(delta > 0)) return false;
        const usingGpu = this.gpu.valid && time - this.gpu.at < GPU_FRESH_SECONDS;
        const workMs = usingGpu ? this.gpu.ms : (cadence > 0 ? cadence : delta) * 1000;
        const targetMs = usingGpu ? this.gpuTargetMs : this.targetMs;
        if (usingGpu !== this.usingGpu) {
            // The two signals live on different time bases: start the average over.
            this.usingGpu = usingGpu;
            this.averageMs = targetMs;
            this.previousRatio = null;
            this.endRun();
        }
        if (this.warmup > 0) {
            this.warmup = Math.max(0, this.warmup - delta);
            this.averageMs = targetMs;
            return false;
        }
        // A long frame or two is a compile, a tab switch or a collection, not sustained load;
        // a run of them is a device that cannot keep up at all.
        this.longFrames = workMs > targetMs * 4 ? this.longFrames + 1 : 0;
        if (this.longFrames > 0 && this.longFrames < LONG_FRAME_RUN) return false;
        const weight = usingGpu ? 0.1 : 1 - Math.exp(-delta / FRAME_SMOOTHING);
        this.averageMs += (workMs - this.averageMs) * weight;
        this.elapsed += delta;
        this.cooldown = Math.max(0, this.cooldown - delta);
        this.downHold = Math.max(0, this.downHold - delta);
        this.sinceUp += delta;
        this.ceilingHold = Math.max(0, this.ceilingHold - delta);
        if (this.ceilingHold === 0) this.ceiling = 1;
        if (this.elapsed < INTERVAL) return false;
        this.elapsed = 0;

        const ratio = this.averageMs / targetMs;
        const late = ratio > LATE;
        const settled = this.previousRatio !== null && Math.abs(ratio - this.previousRatio) < ratio * SETTLED;
        this.previousRatio = ratio;
        this.lateRun = late ? this.lateRun + 1 : 0;
        this.calmRun = late ? 0 : this.calmRun + 1;
        if (this.cooldown > 0) return false;

        let next = this.scale;
        if (late) {
            if (this.downHold > 0 || this.scale <= this.minScale) return false;
            if (!usingGpu && (this.lateRun < LATE_RUN || !settled)) return false;
            if (this.runSteps === 0) {
                this.runScale = this.scale;
                this.runRatio = ratio;
            }
            const bought = this.runSteps === 0 || ratio < this.runRatio * (1 - FUTILE_GAIN * this.runSteps);
            if (bought && this.runSteps > 0) this.futileHold = FUTILE_HOLD;
            if (!bought && this.runSteps >= 2) {
                // Pixels are not what this frame is waiting on: give back all of them.
                next = this.runScale;
                this.downHold = this.futileHold;
                this.futileHold = Math.min(FUTILE_HOLD_LONGEST, this.futileHold * 2);
                this.ceiling = 1;
                this.ceilingHold = 0;
                this.endRun();
            } else {
                next = Math.max(this.minScale, this.scale - (ratio > 1.2 ? STEP_DOWN_HARD : STEP_DOWN));
                this.runSteps += 1;
                this.probeHold = this.sinceUp < PROBE_FAILED_WITHIN
                    ? Math.min(PROBE_HOLD_LONGEST, this.probeHold * 2) : PROBE_HOLD;
                this.ceiling = next;
                this.ceilingHold = this.probeHold;
            }
        } else {
            // One on-time reading between two late ones is noise; a run of them ends the episode.
            if (this.calmRun >= CALM_RUN) this.endRun();
            const room = ratio < (usingGpu ? ROOM_GPU : ROOM_FRAME);
            if (room) {
                // Steps down and up differ in size: land on the top rather than just short of it.
                const top = Math.min(1, this.ceiling);
                next = this.scale + STEP_UP > top - SNAP ? top : this.scale + STEP_UP;
            }
        }
        if (Math.abs(next - this.scale) < SNAP / 4) return false;
        if (next > this.scale) this.sinceUp = 0;
        this.history.push({
            time: round(time, 1), scale: round(next, 2), ratio: round(ratio, 2), gpu: usingGpu,
        });
        if (this.history.length > HISTORY) this.history.shift();
        this.scale = next;
        this.cooldown = COOLDOWN;
        return true;
    }

    getDiagnostics() {
        return {
            enabled: this.enabled,
            scale: this.scale,
            usingGpu: this.usingGpu,
            averageMs: this.averageMs,
            gpuMs: this.gpu.valid ? this.gpu.ms : null,
            history: this.history.slice(),
        };
    }
}
