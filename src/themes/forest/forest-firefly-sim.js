/**
 * Forest — the fireflies (pure typed-array simulation).
 *
 * Two populations share one buffer. The ambient fireflies each keep a home among the ferns
 * or the lower boughs, wander around it on a closed-form path and flash on their own slow
 * clocks; the game can push them about, and they drift back. As a combo wakes the forest
 * they fall into step, until the whole wood flashes in waves that roll out from the board.
 * The reserve stays dark until the game calls for it: puffs thrown from the board, jets,
 * the garlands that wind up the old trunks, dew shaken from the boughs, and the great stag
 * the fireflies gather into.
 *
 * The drawing code (forest-fireflies.js) re-evaluates the same path and the same flash in
 * the vertex shader at earlier times to lay each firefly's trail behind it, so
 * `forestFireflyWander` and `forestFireflyFlash` must stay in step with their TSL twins.
 *
 * No scene objects and no allocation per frame: the same code runs on both backends, in
 * the playground's deterministic `seek`, and in the unit tests.
 */
const TAU = Math.PI * 2;

export const FOREST_FIREFLY_AMBIENT = 0;
export const FOREST_FIREFLY_SPARK = 1;
export const FOREST_FIREFLY_DEW = 2;
/** How fast the shared flash runs out from the hearth, as phase per metre. */
export const FOREST_SYNC_PHASE_PER_METRE = 0.042;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A firefly's own pace: some dawdle, some hurry. */
export function forestFireflyPace(seed) {
    const second = (seed * 13.7) % 1;
    return 0.7 + second * 0.9;
}

/** Offset of an ambient firefly from its home at time `t` (written to `out`). */
export function forestFireflyWander(seed, t, out) {
    const phase = seed * TAU;
    const time = t * forestFireflyPace(seed);
    out[0] = Math.sin(time * 0.31 + phase) * 1.3 + Math.sin(time * 0.83 + phase * 3) * 0.34
        + Math.sin(time * 1.9 + phase * 5.3) * 0.12;
    out[1] = Math.sin(time * 0.47 + phase * 1.9) * 0.5 + Math.sin(time * 1.31 + phase * 4.1) * 0.16;
    out[2] = Math.cos(time * 0.27 + phase * 1.3) * 1.3 + Math.cos(time * 0.71 + phase * 2.7) * 0.3;
    return out;
}

/** One flash and its dimmer echo, for a phase 0..1 through the firefly's cycle. */
function signal(phase) {
    const flash = (phase - 0.14) / 0.055;
    const echo = (phase - 0.33) / 0.09;
    return Math.exp(-flash * flash) + 0.34 * Math.exp(-echo * echo);
}

/**
 * Brightness of an ambient firefly's own light at time `t`.
 * `sync` 0..1 is how far the forest has fallen into step; `beat` is the shared clock's
 * phase and `away` the firefly's distance from the hearth, so the shared flash travels.
 */
export function forestFireflyFlash(seed, t, sync = 0, beat = 0, away = 0) {
    const period = 2.6 + seed * 4.2;
    const own = (((t / period + seed * 7.13) % 1) + 1) % 1;
    const shared = (((beat - away * FOREST_SYNC_PHASE_PER_METRE + seed * 0.05) % 1) + 1) % 1;
    // Fireflies join the chorus one by one as it grows.
    const joined = clamp((sync - ((seed * 5.3) % 1) * 0.8) / 0.2, 0, 1);
    return signal(own) * (1 - joined) + signal(shared) * 1.25 * joined;
}

export class ForestFireflySim {
    constructor({
        count = 2400, reserve = 1300, rng = Math.random, homes = null, groundHeight = () => 0,
        hearth = { x: 0, z: 0 },
    } = {}) {
        this.count = Math.max(2, Math.floor(count));
        this.reserve = clamp(Math.floor(reserve), 1, this.count - 1);
        this.ambient = this.count - this.reserve;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.hearth = hearth;
        const n = this.count;
        this.x = new Float32Array(n);
        this.y = new Float32Array(n);
        this.z = new Float32Array(n);
        this.vx = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.vz = new Float32Array(n);
        this.life = new Float32Array(n);
        this.span = new Float32Array(n);
        // Seconds since a spark was lit (a spark holding its place in the stag does not age
        // toward its end, but it was still lit at some moment).
        this.lit = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.size = new Float32Array(n);
        this.seed = new Float32Array(n);
        this.kind = new Uint8Array(n);
        // A bound spark is drawn to a place of its own (the stag); 0 = free.
        this.bound = new Float32Array(n);
        this.tx = new Float32Array(n);
        this.ty = new Float32Array(n);
        this.tz = new Float32Array(n);
        this.home = new Float32Array(this.ambient * 3);
        this.homeFloor = new Float32Array(this.ambient);
        this.homeAway = new Float32Array(this.ambient);
        // Instance buffers read by the renderer:
        //   home      xyz of an ambient firefly's home, and its seed (static)
        //   place     ambient: offset from the wander path; spark: position; and the size
        //   velocity  xyz, and the kind (0 ambient, 1 spark, 2 dew)
        //   glow      brightness, heat, distance from the hearth, how long a trail it draws
        this.outHome = new Float32Array(n * 4);
        this.outPlace = new Float32Array(n * 4);
        this.outVelocity = new Float32Array(n * 4);
        this.outGlow = new Float32Array(n * 4);
        this.beat = 0;
        this.sync = 0;
        this.wander = [0, 0, 0];
        this.pull = [0, 0, 0];
        for (let i = 0; i < n; i += 1) {
            this.seed[i] = rng();
            this.size[i] = 0.1 + rng() * 0.07;
        }
        for (let i = 0; i < this.ambient; i += 1) {
            let hx;
            let hy;
            let hz;
            if (homes && homes.length >= 3) {
                const pick = Math.floor(rng() * (homes.length / 3)) * 3;
                hx = homes[pick] + (rng() - 0.5) * 1.6;
                hy = homes[pick + 1] + (rng() - 0.5) * 0.6;
                hz = homes[pick + 2] + (rng() - 0.5) * 1.6;
            } else {
                hx = (rng() * 2 - 1) * 16;
                hz = 9 - rng() * 30;
                hy = groundHeight(hx, hz) + 0.9 + rng() * 2.6;
            }
            const floor = groundHeight(hx, hz);
            // High enough that the wander never dips into the moss.
            hy = Math.max(hy, floor + 0.85);
            this.home.set([hx, hy, hz], i * 3);
            this.homeFloor[i] = floor;
            this.homeAway[i] = Math.hypot(hx - hearth.x, hz - hearth.z);
            this.outHome.set([hx, hy, hz, this.seed[i]], i * 4);
        }
        for (let i = this.ambient; i < n; i += 1) this.outHome[i * 4 + 3] = this.seed[i];
        this.reset();
    }

    reset() {
        this.time = 0;
        this.beat = 0;
        this.sync = 0;
        this.cursor = this.ambient;
        this.x.fill(0);
        this.y.fill(0);
        this.z.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.life.fill(0);
        this.span.fill(1);
        this.lit.fill(0);
        this.heat.fill(0);
        this.bound.fill(0);
        this.kind.fill(FOREST_FIREFLY_AMBIENT, 0, this.ambient);
        this.kind.fill(FOREST_FIREFLY_SPARK, this.ambient);
        this.outGlow.fill(0);
        this.outVelocity.fill(0);
        this.outPlace.fill(0);
        this.write(0);
    }

    /** Light one reserve spark; when none is dark, the one nearest its end is taken. */
    spawn(x, y, z, vx, vy, vz, {
        life = 2.4, heat = 0, size = 0.085, kind = FOREST_FIREFLY_SPARK,
    } = {}) {
        if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return -1;
        let selected = -1;
        let least = Infinity;
        for (let step = 0; step < this.reserve; step += 1) {
            const index = this.ambient + ((this.cursor - this.ambient + step) % this.reserve);
            if (this.life[index] <= 0) {
                selected = index;
                break;
            }
            // A spark that belongs to the stag is never taken for something else.
            if (this.bound[index] <= 0 && this.life[index] < least) {
                least = this.life[index];
                selected = index;
            }
            // A full pool is searched only a little way: the oldest of the next few will do.
            if (step >= 24 && selected >= 0) break;
        }
        if (selected < 0) return -1;
        this.cursor = this.ambient + ((selected - this.ambient + 1) % this.reserve);
        this.x[selected] = x;
        this.y[selected] = y;
        this.z[selected] = z;
        this.vx[selected] = vx;
        this.vy[selected] = vy;
        this.vz[selected] = vz;
        const lifetime = Number.isFinite(life) ? Math.max(0.2, life) : 2.4;
        this.life[selected] = lifetime;
        this.span[selected] = lifetime;
        this.lit[selected] = 0;
        this.heat[selected] = Number.isFinite(heat) ? clamp(heat, 0, 1) : 0;
        this.size[selected] = Number.isFinite(size) ? clamp(size, 0.02, 0.4) : 0.085;
        this.kind[selected] = kind === FOREST_FIREFLY_DEW ? FOREST_FIREFLY_DEW : FOREST_FIREFLY_SPARK;
        this.bound[selected] = 0;
        return selected;
    }

    /** Give a live spark a place to fly to and hold (`grip` 0 lets it go again). */
    bind(index, x, y, z, grip = 1) {
        if (!(index >= this.ambient && index < this.count) || this.life[index] <= 0) return false;
        if (![x, y, z].every(Number.isFinite)) return false;
        this.bound[index] = Number.isFinite(grip) ? Math.max(0, grip) : 1;
        this.tx[index] = x;
        this.ty[index] = y;
        this.tz[index] = z;
        return true;
    }

    /** Let every bound spark go; they drift off and fade over `linger` seconds. */
    release(linger = 2.2) {
        for (let i = this.ambient; i < this.count; i += 1) {
            if (this.bound[i] > 0) {
                this.bound[i] = 0;
                if (this.life[i] > 0) {
                    this.life[i] = Math.min(this.life[i], linger * (0.5 + this.seed[i]));
                    this.span[i] = Math.max(this.span[i], this.life[i]);
                }
            }
        }
    }

    /** Acceleration of every force field at a point; `share` scales how much of it is felt. */
    force(fields, index, px, py, pz, share, out) {
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (let f = 0; f < fields.length; f += 1) {
            const field = fields[f];
            if (field.kind === 'vortex') {
                const dx = px - field.x;
                const dz = pz - field.z;
                const distance = Math.hypot(dx, dz) + 1e-4;
                if (distance < field.reach && py < field.top + 2 && py > field.floor - 1) {
                    const rx = dx / distance;
                    const rz = dz / distance;
                    const tx = -rz * field.turn;
                    const tz = rx * field.turn;
                    const radial = this.vx[index] * rx + this.vz[index] * rz;
                    const around = this.vx[index] * tx + this.vz[index] * tz;
                    // Turn at the orbit's rate, settle on its radius (with the pull an orbit
                    // needs toward its centre), and climb.
                    const swing = (field.spin * distance - around) * field.grip;
                    const draw = -(distance - field.radius) * field.pull - radial * 2 * Math.sqrt(field.pull)
                        - (around * around) / distance;
                    ax += tx * swing + rx * draw;
                    az += tz * swing + rz * draw;
                    ay += py < field.top ? field.lift : -field.lift * 1.5;
                }
            } else {
                const dx = px - field.x;
                const dy = py - field.y;
                const dz = pz - field.z;
                const distance = Math.hypot(dx, dy, dz) + 1e-4;
                if (distance < field.radius) {
                    const falloff = (1 - distance / field.radius) ** 2;
                    if (field.kind === 'burst') {
                        ax += (dx / distance) * field.power * falloff;
                        ay += (dy / distance) * field.power * falloff + field.up * falloff;
                        az += (dz / distance) * field.power * falloff;
                    } else {
                        ax += field.dx * field.power * falloff;
                        ay += field.dy * field.power * falloff;
                        az += field.dz * field.power * falloff;
                    }
                }
            }
        }
        out[0] = ax * share;
        out[1] = ay * share;
        out[2] = az * share;
    }

    /**
     * Advance the simulation. `env` is { windX, windZ, gust, glow, heat, sync, beatRate,
     * settled, fields }.
     */
    step(dt, env = {}) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
        this.time += step;
        const fields = env.fields || [];
        const gust = Number.isFinite(env.gust) ? env.gust : 0;
        const windX = Number.isFinite(env.windX) ? env.windX : 1;
        const windZ = Number.isFinite(env.windZ) ? env.windZ : 0;
        const settled = env.settled === true;
        this.sync = clamp(Number.isFinite(env.sync) ? env.sync : 0, 0, 1);
        this.beat += step * (Number.isFinite(env.beatRate) ? clamp(env.beatRate, 0, 3) : 0.3);
        const t = this.time;
        const { pull, wander } = this;
        if (step > 0) {
            // Ambient fireflies: `x,y,z` hold their displacement from the wander path.
            for (let i = 0; i < this.ambient; i += 1) {
                forestFireflyWander(this.seed[i], t, wander);
                this.force(
                    fields,
                    i,
                    this.home[i * 3] + wander[0] + this.x[i],
                    this.home[i * 3 + 1] + wander[1] + this.y[i],
                    this.home[i * 3 + 2] + wander[2] + this.z[i],
                    0.4,
                    pull,
                );
                // A settled forest lets its fireflies sink toward the moss.
                const lift = this.home[i * 3 + 1] - this.homeFloor[i] - 0.4 + this.y[i];
                const sink = settled ? -0.5 * Math.max(0, lift) : 0;
                this.vx[i] += (pull[0] + windX * gust * 0.8 - this.x[i] * 1.1 - this.vx[i] * 1.5) * step;
                this.vy[i] += (pull[1] + sink - this.y[i] * (settled ? 0.1 : 1.1) - this.vy[i] * 1.5) * step;
                this.vz[i] += (pull[2] + windZ * gust * 0.8 - this.z[i] * 1.1 - this.vz[i] * 1.5) * step;
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
                const lowest = this.homeFloor[i] + 0.12 - this.home[i * 3 + 1] - wander[1];
                if (this.y[i] < lowest) {
                    this.y[i] = lowest;
                    this.vy[i] = Math.max(0, this.vy[i]);
                }
            }
            // Sparks: free flight under drag, a little lift, a wandering breeze and the fields.
            for (let i = this.ambient; i < this.count; i += 1) {
                if (this.life[i] <= 0) continue;
                const phase = this.seed[i] * 40;
                if (this.bound[i] > 0) {
                    // A spark with a place to be flies to it and holds, trembling a little.
                    const grip = 9 * this.bound[i];
                    const hover = 0.05;
                    this.vx[i] += ((this.tx[i] + Math.sin(phase + t * 1.9) * hover - this.x[i]) * grip
                        - this.vx[i] * 5) * step;
                    this.vy[i] += ((this.ty[i] + Math.cos(phase * 0.7 + t * 2.3) * hover - this.y[i]) * grip
                        - this.vy[i] * 5) * step;
                    this.vz[i] += ((this.tz[i] + Math.sin(phase * 0.3 + t * 1.7) * hover - this.z[i]) * grip
                        - this.vz[i] * 5) * step;
                } else if (this.kind[i] === FOREST_FIREFLY_DEW) {
                    // Dew falls, and the air slows it.
                    this.vx[i] += (windX * gust * 1.2 - this.vx[i] * 0.9) * step;
                    this.vy[i] += (-6.5 - this.vy[i] * 0.9) * step;
                    this.vz[i] += (windZ * gust * 1.2 - this.vz[i] * 0.9) * step;
                } else {
                    this.force(fields, i, this.x[i], this.y[i], this.z[i], 1, pull);
                    const lift = settled ? -1.6 : 0.45;
                    this.vx[i] += (pull[0] - this.vx[i] * 1.5 + windX * gust * 1.4
                        + Math.sin(phase + t * 2.1 + this.y[i] * 1.3) * 1.3) * step;
                    this.vy[i] += (pull[1] - this.vy[i] * 1.5 + lift
                        + Math.cos(phase * 0.7 + t * 1.7 + this.x[i] * 1.1) * 0.8) * step;
                    this.vz[i] += (pull[2] - this.vz[i] * 1.5 + windZ * gust * 1.4
                        + Math.sin(phase * 0.3 + t * 1.9 + this.z[i] * 1.2) * 1.3) * step;
                }
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
                this.lit[i] += step;
                // The stag's sparks do not age while they hold their places.
                if (!(this.bound[i] > 0)) this.life[i] -= step * (settled ? 1.6 : 1);
                const floor = this.groundHeight(this.x[i], this.z[i]);
                if (this.y[i] < floor + 0.05) {
                    if (this.kind[i] === FOREST_FIREFLY_DEW) this.life[i] = 0;
                    else {
                        this.y[i] = floor + 0.05;
                        this.vy[i] = Math.abs(this.vy[i]) * 0.3;
                        this.life[i] *= 0.85;
                    }
                }
            }
        }
        this.write(
            clamp(Number.isFinite(env.glow) ? env.glow : 0, 0, 1),
            clamp(Number.isFinite(env.heat) ? env.heat : 0, 0, 1),
        );
    }

    /** Fill the instance buffers from the current state. */
    write(glow = 0, heat = 0) {
        const t = this.time;
        const { outPlace, outGlow, outVelocity } = this;
        for (let i = 0; i < this.ambient; i += 1) {
            const o = i * 4;
            outPlace[o] = this.x[i];
            outPlace[o + 1] = this.y[i];
            outPlace[o + 2] = this.z[i];
            outPlace[o + 3] = this.size[i];
            outVelocity[o] = this.vx[i];
            outVelocity[o + 1] = this.vy[i];
            outVelocity[o + 2] = this.vz[i];
            outVelocity[o + 3] = FOREST_FIREFLY_AMBIENT;
            // The shader works the flash out again for every point of the trail; this
            // copy is what the forest floor is lit by.
            outGlow[o] = 0.012 + forestFireflyFlash(this.seed[i], t, this.sync, this.beat, this.homeAway[i])
                + glow * 0.45;
            outGlow[o + 1] = heat * 0.6;
            outGlow[o + 2] = this.homeAway[i];
            outGlow[o + 3] = 1;
        }
        for (let i = this.ambient; i < this.count; i += 1) {
            const o = i * 4;
            const life = this.life[i];
            if (life <= 0) {
                outPlace[o + 3] = 0;
                outGlow[o] = 0;
                continue;
            }
            const dew = this.kind[i] === FOREST_FIREFLY_DEW;
            const flicker = dew ? 0.45 + 0.55 * Math.sin(t * 31 + this.seed[i] * 90) ** 2
                : 0.8 + 0.2 * Math.sin(t * 17 + this.seed[i] * 50);
            // A spark holding its place in the stag stays lit; a free one burns down.
            const burn = this.bound[i] > 0 ? 1 : (life / this.span[i]) ** 0.6;
            outPlace[o] = this.x[i];
            outPlace[o + 1] = this.y[i];
            outPlace[o + 2] = this.z[i];
            outPlace[o + 3] = this.size[i];
            outVelocity[o] = this.vx[i];
            outVelocity[o + 1] = this.vy[i];
            outVelocity[o + 2] = this.vz[i];
            outVelocity[o + 3] = this.kind[i];
            outGlow[o] = Math.min(1, this.lit[i] / 0.07) * burn * flicker * 1.2;
            outGlow[o + 1] = Math.max(this.heat[i], heat * 0.6);
            outGlow[o + 2] = 0;
            outGlow[o + 3] = dew ? 0.5 : 1;
        }
    }

    /** Add every lit firefly near the floor to a ForestLightField. */
    shed(field) {
        if (!field) return;
        const { wander, outGlow } = this;
        const t = this.time;
        field.sum.fill(0);
        for (let i = 0; i < this.ambient; i += 1) {
            const light = outGlow[i * 4];
            if (light > 0.12) {
                forestFireflyWander(this.seed[i], t, wander);
                field.add(
                    this.home[i * 3] + wander[0] + this.x[i],
                    this.home[i * 3 + 2] + wander[2] + this.z[i],
                    this.home[i * 3 + 1] + wander[1] + this.y[i] - this.homeFloor[i],
                    light,
                );
            }
        }
        for (let i = this.ambient; i < this.count; i += 1) {
            const light = outGlow[i * 4];
            if (light > 0.12 && this.kind[i] !== FOREST_FIREFLY_DEW && this.y[i] < 8) {
                field.add(this.x[i], this.z[i], this.y[i] - this.groundHeight(this.x[i], this.z[i]), light * 0.8);
            }
        }
        field.commit();
    }

    counts() {
        let live = 0;
        let bound = 0;
        for (let i = this.ambient; i < this.count; i += 1) {
            if (this.life[i] > 0) live += 1;
            if (this.bound[i] > 0) bound += 1;
        }
        return {
            ambient: this.ambient, reserve: this.reserve, live, bound,
        };
    }
}
