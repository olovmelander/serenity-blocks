/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight — Meteor / Shooting-Star System (CPU sim)
 *
 * Shooting stars are RARE and FEW (≤48 at the top tier), so a GPU compute
 * dispatch buys nothing — they're simulated on the CPU and drawn as a tiny
 * pool of velocity-stretched instanced billboards (meteor-renderer.js reads
 * these arrays directly). This also means meteors work on the WebGL2 fallback.
 *
 * Spawns are STRICTLY event-bound in-game (line clears / combos / hard drops /
 * the rare wishing star / the game-over comet) plus a very rare idle drift, so
 * each streak feels earned. Showers fan out from a RADIANT point above the board.
 *
 * Per-slot state lives in flat Float32Arrays (shared with the renderer's
 * InstancedBufferAttributes — mutate here, flag needsUpdate there):
 *   head[i*3..]  world head position
 *   dir[i*3..]   normalized travel direction (world)
 *   len[i]       current streak length (world units; 0 = inactive/collapsed)
 *   age[i]       0..1 normalized lifetime (>=1 → inactive)
 *   heat[i]      0..1 color/size class (faint → fireball)
 */
import * as THREE from 'three';

export const METEOR_BUDGETS = Object.freeze({
    Minimal: 4,
    Low: 8,
    Medium: 16,
    High: 24,
    Ultra: 32,
    Extreme: 48,
});

export function getMeteorBudget(qualityName) {
    return METEOR_BUDGETS[qualityName] || METEOR_BUDGETS.High;
}

const _tmpDir = new THREE.Vector3();

export class MeteorSystem {
    constructor(maxMeteors = 24, options = {}) {
        this.max = Math.max(1, Math.floor(maxMeteors));
        this.allowFireball = options.allowFireball !== false;
        // Spawn heads SCATTERED across the whole VISIBLE frame. Sized to the
        // game camera frustum (camera z=14, FOV 40°): at the near spawn depth the
        // visible half-width is ~±12 / half-height ~±7, so a wider span would
        // spawn meteors off-screen (the "not all over the screen" bug). Kept at a
        // safe background depth so a streak never smears through the near plane.
        // yMax extends a bit above the top so meteors fall INTO view from above.
        this.spawnSpan = options.spawnSpan || {
            x: 12, yMin: -7, yMax: 10, zNear: -6, zFar: -13,
        };

        this.head = new Float32Array(this.max * 3);
        this.dir = new Float32Array(this.max * 3);
        this.len = new Float32Array(this.max);
        this.age = new Float32Array(this.max).fill(2); // 2 = inactive
        this.life = new Float32Array(this.max).fill(1);
        this.speed = new Float32Array(this.max);
        this.heat = new Float32Array(this.max);

        this._cursor = 0;
    }

    _findSlot() {
        // Prefer an inactive slot; otherwise recycle the oldest (round-robin).
        for (let i = 0; i < this.max; i += 1) {
            if (this.age[i] >= 1) return i;
        }
        const s = this._cursor;
        this._cursor = (this._cursor + 1) % this.max;
        return s;
    }

    /**
     * Spawn a shooting star.
     * @param {object} [opts]
     * @param {number} [opts.heat]      0..1 color/size class (faint→fireball)
     * @param {number} [opts.speed]     world units / second
     * @param {number} [opts.lifetime]  seconds
     * @param {THREE.Vector3} [opts.dir] explicit travel direction (else fanned from radiant)
     * @param {number} [opts.spread]    angular jitter from the radiant fan (radians-ish)
     */
    spawn(opts = {}) {
        const i = this._findSlot();
        const heat = opts.heat ?? 0.4;
        const isFireball = this.allowFireball && heat >= 0.85;

        // Travel direction: downward-diagonal with wide per-meteor variation so
        // streaks criss-cross the sky instead of all pointing the same way.
        if (opts.dir) {
            _tmpDir.copy(opts.dir).normalize();
        } else {
            _tmpDir.set(
                (Math.random() - 0.5) * 1.6,
                -(0.35 + Math.random() * 0.7), // mostly downward
                (Math.random() - 0.5) * 0.8,
            ).normalize();
        }

        // Head SCATTERED across the whole frame at a safe background depth.
        const s = this.spawnSpan;
        this.head[i * 3] = (Math.random() * 2 - 1) * s.x;
        this.head[i * 3 + 1] = s.yMin + Math.random() * (s.yMax - s.yMin);
        this.head[i * 3 + 2] = s.zFar + Math.random() * (s.zNear - s.zFar);
        this.dir[i * 3] = _tmpDir.x;
        this.dir[i * 3 + 1] = _tmpDir.y;
        this.dir[i * 3 + 2] = _tmpDir.z;

        // Calmer than before: slower + shorter streaks so a sudden bright slash
        // doesn't flash the whole screen (additive + bloom amplify long streaks).
        const speed = opts.speed ?? (12 + Math.random() * 10) * (isFireball ? 0.8 : 1);
        const lifetime = opts.lifetime ?? (1.0 + Math.random() * 0.9) * (isFireball ? 1.4 : 1);
        this.speed[i] = speed;
        this.len[i] = speed * (isFireball ? 0.12 : 0.09); // stretch ∝ speed
        this.life[i] = lifetime;
        this.age[i] = 0;
        this.heat[i] = heat;
        return i;
    }

    /** Convenience spawners for event tiers. */
    spawnFaint() { return this.spawn({ heat: 0.35 }); }

    spawnBright() { return this.spawn({ heat: 0.6 }); }

    spawnWishingStar() {
        return this.spawn({
            heat: 0.7, speed: 14, lifetime: 1.8, spread: 0.4,
        });
    }

    spawnFireball() { return this.spawn({ heat: 1.0, spread: 0.5 }); }

    spawnShower(count = 3, heat = 0.5) {
        for (let k = 0; k < count; k += 1) this.spawn({ heat });
    }

    update(dt) {
        for (let i = 0; i < this.max; i += 1) {
            if (this.age[i] >= 1) {
                this.len[i] = 0;
                continue;
            }
            const sp = this.speed[i];
            this.head[i * 3] += this.dir[i * 3] * sp * dt;
            this.head[i * 3 + 1] += this.dir[i * 3 + 1] * sp * dt;
            this.head[i * 3 + 2] += this.dir[i * 3 + 2] * sp * dt;
            this.age[i] += dt / this.life[i];
            if (this.age[i] >= 1) this.len[i] = 0;
        }
    }

    /** True if any meteor is currently active (for flash/event logic). */
    hasActive() {
        for (let i = 0; i < this.max; i += 1) {
            if (this.age[i] < 1) return true;
        }
        return false;
    }

    dispose() {
        this.head = null;
        this.dir = null;
        this.len = null;
        this.age = null;
        this.life = null;
        this.speed = null;
        this.heat = null;
    }
}
