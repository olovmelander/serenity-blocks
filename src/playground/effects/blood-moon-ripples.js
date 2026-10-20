/**
 * Rings on the salt flat's film of water: a piece lock drops one, a clear several. A fixed pool
 * of rows written in place, live rows kept at the front so the shader loops over the live count
 * only. No allocation after construction; no three.js.
 */

export const RIPPLE_LIFETIME = 5.5;

/** Rings each gameplay cue drops, and how strong they are (0..1.5). */
const CUES = Object.freeze({
    lock: [1, 0.55],
    clear: [1, 0.75],
    combo: [1, 0.9],
    tspin: [2, 1],
    tetris: [3, 1.1],
    perfectClear: [4, 1.25],
    levelUp: [2, 0.85],
});

export function rippleCue(kind, payload) {
    const cue = CUES[kind];
    if (!cue) return null;
    let [count, strength] = cue;
    if (kind === 'clear') {
        const lines = Math.max(1, Math.min(4, Math.floor(Number(payload?.lineCount ?? payload?.lines) || 1)));
        count = lines >= 2 ? 2 : 1;
        strength += lines * 0.08;
    }
    return { count, strength };
}

export class BloodMoonRipples {
    constructor(capacity = 8) {
        this.capacity = Math.max(1, Math.floor(capacity));
        this.rows = Array.from({ length: this.capacity }, () => ({
            x: 0, z: 0, age: 0, strength: 0,
        }));
        this.count = 0;
    }

    /** Add a ring at world (x, z); when full, the oldest ring gives up its row. */
    add(x, z, strength) {
        if (![x, z, strength].every(Number.isFinite) || strength <= 0) return;
        let row;
        if (this.count < this.capacity) {
            row = this.rows[this.count];
            this.count += 1;
        } else {
            let oldest = 0;
            for (let i = 1; i < this.count; i++) if (this.rows[i].age > this.rows[oldest].age) oldest = i;
            row = this.rows[oldest];
        }
        row.x = x; row.z = z; row.age = 0; row.strength = Math.min(1.5, strength);
    }

    update(delta) {
        const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 60)) : 0;
        let live = 0;
        for (let i = 0; i < this.count; i++) {
            const row = this.rows[i];
            row.age += dt;
            if (row.age < RIPPLE_LIFETIME) {
                if (live !== i) {
                    // Swap so the expired row's object stays in the pool.
                    const keep = this.rows[live];
                    this.rows[live] = row;
                    this.rows[i] = keep;
                }
                live += 1;
            }
        }
        this.count = live;
    }

    reset() { this.count = 0; }

    /** Copy the live rows into vec4-like targets (x, z, age, strength); returns the count. */
    write(targets) {
        const n = Math.min(this.count, targets.length);
        for (let i = 0; i < n; i++) {
            const row = this.rows[i];
            targets[i].x = row.x; targets[i].y = row.z; targets[i].z = row.age; targets[i].w = row.strength;
        }
        for (let i = n; i < targets.length; i++) {
            targets[i].x = 0; targets[i].y = 0; targets[i].z = RIPPLE_LIFETIME; targets[i].w = 0;
        }
        return n;
    }
}
