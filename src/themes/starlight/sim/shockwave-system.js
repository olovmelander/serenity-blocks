/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight — Shockwave System (CPU pool)
 *
 * Expanding additive RINGS + thick light-ECHO shells for combo/Tetris/perfect
 * moments (the one space phenomenon a twinkle-wave or impulse can't draw). Few
 * and rare, so CPU-simulated like the meteors: a tiny pool of camera-facing
 * billboards (shockwave-renderer.js reads these flat arrays directly). Both
 * backends; the additive ring is visible on WebGL2 (bloom amp is WebGPU-only).
 *
 * Per-slot state (shared with the renderer's InstancedBufferAttributes):
 *   origin[i*3..]  world position the ring expands from
 *   birth[i]       spawn time (seconds)
 *   invLife[i]     1 / lifetime
 *   maxRadius[i]   world radius the ring expands to (0 = inactive/collapsed)
 *   width[i]       ring thickness (SDF, in normalized 0..1 quad space)
 *   alpha[i]       brightness
 *   color[i*3..]   ring rgb
 */

export const MAX_SHOCKWAVES = 12;

// Thin sharp bright ring (nova shockwave).
export const RING_PRESET = Object.freeze({
    width: 0.06, maxRadius: 2.2, lifetime: 0.55, alpha: 1.0, color: [1.0, 0.81, 0.42],
});
// Thick soft low-alpha shell (light echo) — usually spawned as 2–3 staggered shells.
export const ECHO_PRESET = Object.freeze({
    width: 0.42, maxRadius: 3.0, lifetime: 0.75, alpha: 0.5, color: [1.0, 0.96, 0.91],
});

export class ShockwaveSystem {
    constructor(max = MAX_SHOCKWAVES) {
        this.max = Math.max(1, Math.floor(max));
        this.origin = new Float32Array(this.max * 3);
        this.birth = new Float32Array(this.max).fill(-1000);
        this.invLife = new Float32Array(this.max).fill(1);
        this.maxRadius = new Float32Array(this.max);
        this.width = new Float32Array(this.max);
        this.alpha = new Float32Array(this.max);
        this.color = new Float32Array(this.max * 3);
        this.time = 0;
        this._cursor = 0;
    }

    _findSlot() {
        for (let i = 0; i < this.max; i += 1) {
            if ((this.time - this.birth[i]) * this.invLife[i] >= 1) return i;
        }
        const s = this._cursor;
        this._cursor = (this._cursor + 1) % this.max;
        return s;
    }

    /** Spawn one ring/shell. opts override the preset (color, maxRadius, width, alpha, lifetime). */
    spawn(origin, preset = RING_PRESET, opts = {}) {
        const i = this._findSlot();
        const col = opts.color || preset.color;
        this.origin[i * 3] = origin.x;
        this.origin[i * 3 + 1] = origin.y;
        this.origin[i * 3 + 2] = origin.z;
        this.birth[i] = this.time;
        this.invLife[i] = 1 / (opts.lifetime ?? preset.lifetime);
        this.maxRadius[i] = (opts.maxRadius ?? preset.maxRadius) * (opts.scale ?? 1);
        this.width[i] = opts.width ?? preset.width;
        this.alpha[i] = opts.alpha ?? preset.alpha;
        this.color[i * 3] = col[0];
        this.color[i * 3 + 1] = col[1];
        this.color[i * 3 + 2] = col[2];
        return i;
    }

    /** A light echo = 2 staggered soft shells expanding at different rates. */
    spawnEcho(origin, opts = {}) {
        this.spawn(origin, ECHO_PRESET, opts);
        this.spawn(origin, ECHO_PRESET, {
            ...opts,
            lifetime: (opts.lifetime ?? ECHO_PRESET.lifetime) * 1.35,
            maxRadius: (opts.maxRadius ?? ECHO_PRESET.maxRadius) * 1.45,
            alpha: (opts.alpha ?? ECHO_PRESET.alpha) * 0.6,
        });
    }

    update(dt, time) {
        this.time = time;
        // Collapse expired slots so the renderer hides them (zero-area quad).
        for (let i = 0; i < this.max; i += 1) {
            if ((time - this.birth[i]) * this.invLife[i] >= 1) this.maxRadius[i] = 0;
        }
    }

    dispose() {
        this.origin = null;
        this.birth = null;
        this.invLife = null;
        this.maxRadius = null;
        this.width = null;
        this.alpha = null;
        this.color = null;
    }
}
