/**
 * Golden Forest — the fireflies (pure typed-array simulation).
 *
 * Two populations share one buffer. The ambient fireflies each keep a home among the
 * boughs or over the shallows, wander around it and flash on their own slow clocks; the
 * world can push them about, and they drift back. The reserve stays dark until the game
 * calls for it: sparks thrown from the board, jets, the river a combo winds around it.
 * A spark that touches the lake goes out and leaves a ring.
 *
 * No scene objects and no allocation per frame: the same code runs on both backends, in
 * the playground's deterministic `seek`, and in the unit tests.
 */
const TAU = Math.PI * 2;
// At most one spark's ring per cooldown: the lake's pool is small and belongs to the game.
const MAX_TOUCHES = 1;
const TOUCH_COOLDOWN = 0.22;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class GoldenForestSparkSim {
    constructor({
        count = 1200, reserve = 480, rng = Math.random, homes = null, groundHeight = () => -1,
    } = {}) {
        this.count = Math.max(2, Math.floor(count));
        this.reserve = clamp(Math.floor(reserve), 1, this.count - 1);
        this.ambient = this.count - this.reserve;
        this.rng = rng;
        this.groundHeight = groundHeight;
        const n = this.count;
        this.x = new Float32Array(n);
        this.y = new Float32Array(n);
        this.z = new Float32Array(n);
        this.vx = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.vz = new Float32Array(n);
        this.life = new Float32Array(n);
        this.span = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.size = new Float32Array(n);
        this.seed = new Float32Array(n);
        this.home = new Float32Array(this.ambient * 3);
        // Instance buffers read by the renderer: place (xyz, size), glow (brightness,
        // heat, streak, seed) and velocity (xyz, -).
        this.outPlace = new Float32Array(n * 4);
        this.outGlow = new Float32Array(n * 4);
        this.outVelocity = new Float32Array(n * 4);
        this.touches = Array.from({ length: MAX_TOUCHES }, () => ({ x: 0, z: 0, strength: 0 }));
        this.touchCount = 0;
        this.touchCooldown = 0;
        for (let i = 0; i < n; i += 1) {
            this.seed[i] = rng();
            this.size[i] = 0.12 + rng() * 0.1;
        }
        for (let i = 0; i < this.ambient; i += 1) {
            if (homes && homes.length >= 3) {
                const pick = Math.floor(rng() * (homes.length / 3)) * 3;
                this.home.set([homes[pick] + (rng() - 0.5) * 1.6, homes[pick + 1] + (rng() - 0.5),
                    homes[pick + 2] + (rng() - 0.5) * 1.6], i * 3);
            } else {
                this.home.set([(rng() * 2 - 1) * 16, 0.4 + rng() * 3.2, 9 - rng() * 22], i * 3);
            }
        }
        this.reset();
    }

    reset() {
        this.time = 0;
        this.cursor = this.ambient;
        this.touchCount = 0;
        this.touchCooldown = 0;
        this.x.fill(0);
        this.y.fill(0);
        this.z.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.life.fill(0);
        this.span.fill(1);
        this.heat.fill(0);
        this.outGlow.fill(0);
        this.outVelocity.fill(0);
        this.outPlace.fill(0);
        this.write(0, 0);
    }

    /** Light one reserve spark; when none is dark, the one nearest its end is taken. */
    spawn(x, y, z, vx, vy, vz, life = 2.4, heat = 0, size = 0.085) {
        if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return -1;
        let selected = -1;
        let least = Infinity;
        for (let step = 0; step < this.reserve; step += 1) {
            const index = this.ambient + ((this.cursor - this.ambient + step) % this.reserve);
            if (this.life[index] <= 0) {
                selected = index;
                break;
            }
            if (this.life[index] < least) {
                least = this.life[index];
                selected = index;
            }
            // A full pool is searched only a little way: the oldest of the next few will do.
            if (step >= 24 && selected >= 0) break;
        }
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
        this.heat[selected] = Number.isFinite(heat) ? clamp(heat, 0, 1) : 0;
        this.size[selected] = Number.isFinite(size) ? clamp(size, 0.02, 0.4) : 0.085;
        return selected;
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
                if (distance < field.reach && py < field.top + 2) {
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
     * Advance the simulation. `env` is { windX, windZ, gust, glow, heat, settled, fields }.
     */
    step(dt, env = {}) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
        this.time += step;
        this.touchCount = 0;
        this.touchCooldown = Math.max(0, this.touchCooldown - step);
        const fields = env.fields || [];
        const gust = Number.isFinite(env.gust) ? env.gust : 0;
        const windX = Number.isFinite(env.windX) ? env.windX : 1;
        const windZ = Number.isFinite(env.windZ) ? env.windZ : 0;
        const settled = env.settled === true;
        const t = this.time;
        const pull = this.pull || (this.pull = [0, 0, 0]);
        if (step > 0) {
            // Ambient fireflies: `x,y,z` hold their displacement from the wander path.
            for (let i = 0; i < this.ambient; i += 1) {
                const phase = this.seed[i] * TAU;
                const hx = this.home[i * 3] + Math.sin(t * 0.31 + phase) * 1.3 + Math.sin(t * 0.83 + phase * 3) * 0.3;
                const hy = this.home[i * 3 + 1] + Math.sin(t * 0.47 + phase * 1.9) * 0.55;
                const hz = this.home[i * 3 + 2] + Math.cos(t * 0.27 + phase * 1.3) * 1.3;
                this.force(fields, i, hx + this.x[i], hy + this.y[i], hz + this.z[i], 0.4, pull);
                this.vx[i] += (pull[0] + windX * gust * 0.8 - this.x[i] * 1.1 - this.vx[i] * 1.5) * step;
                this.vy[i] += (pull[1] - this.y[i] * 1.1 - this.vy[i] * 1.5) * step;
                this.vz[i] += (pull[2] + windZ * gust * 0.8 - this.z[i] * 1.1 - this.vz[i] * 1.5) * step;
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
            }
            // Sparks: free flight under drag, a little lift, a wandering breeze and the fields.
            for (let i = this.ambient; i < this.count; i += 1) {
                if (this.life[i] <= 0) continue;
                const phase = this.seed[i] * 40;
                this.force(fields, i, this.x[i], this.y[i], this.z[i], 1, pull);
                const sink = settled ? -2.2 : 0.7;
                this.vx[i] += (pull[0] - this.vx[i] * 1.5 + windX * gust * 1.4
                    + Math.sin(phase + t * 2.1 + this.y[i] * 1.3) * 1.5) * step;
                this.vy[i] += (pull[1] - this.vy[i] * 1.5 + sink
                    + Math.cos(phase * 0.7 + t * 1.7 + this.x[i] * 1.1) * 0.9) * step;
                this.vz[i] += (pull[2] - this.vz[i] * 1.5 + windZ * gust * 1.4
                    + Math.sin(phase * 0.3 + t * 1.9 + this.z[i] * 1.2) * 1.5) * step;
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
                this.life[i] -= step * (settled ? 1.6 : 1);
                if (this.y[i] < 0.6) {
                    const floor = this.groundHeight(this.x[i], this.z[i]);
                    if (floor < 0 && this.y[i] < 0.02) {
                        // The lake takes it: a spark that touches water leaves a ring.
                        if (this.touchCount < MAX_TOUCHES && this.touchCooldown <= 0) {
                            const touch = this.touches[this.touchCount];
                            touch.x = this.x[i];
                            touch.z = this.z[i];
                            touch.strength = 0.16 + 0.1 * this.seed[i];
                            this.touchCount += 1;
                            this.touchCooldown = TOUCH_COOLDOWN;
                        }
                        this.life[i] = 0;
                    } else if (floor >= 0 && this.y[i] < floor + 0.05) {
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
    write(glow, heat) {
        const t = this.time;
        const {
            outPlace, outGlow, outVelocity,
        } = this;
        for (let i = 0; i < this.ambient; i += 1) {
            const phase = this.seed[i] * TAU;
            const o = i * 4;
            outPlace[o] = this.home[i * 3] + Math.sin(t * 0.31 + phase) * 1.3 + Math.sin(t * 0.83 + phase * 3) * 0.3
                + this.x[i];
            outPlace[o + 1] = Math.max(
                0.06,
                this.home[i * 3 + 1] + Math.sin(t * 0.47 + phase * 1.9) * 0.55 + this.y[i],
            );
            outPlace[o + 2] = this.home[i * 3 + 2] + Math.cos(t * 0.27 + phase * 1.3) * 1.3 + this.z[i];
            outPlace[o + 3] = this.size[i];
            // A firefly's signal: a quick flash and a dimmer echo, on its own clock.
            const beat = (t / (3.2 + this.seed[i] * 3.6) + this.seed[i] * 7) % 1;
            const flash = Math.exp(-(((beat - 0.15) / 0.07) ** 2)) + 0.3 * Math.exp(-(((beat - 0.4) / 0.1) ** 2));
            outGlow[o] = 0.1 + flash * 0.95 + glow * 0.75;
            outGlow[o + 1] = glow * 0.25;
            outGlow[o + 2] = Math.min(1, Math.hypot(this.vx[i], this.vy[i], this.vz[i]) * 0.1);
            outGlow[o + 3] = this.seed[i];
            outVelocity[o] = this.vx[i] + Math.cos(t * 0.31 + phase) * 0.4;
            outVelocity[o + 1] = this.vy[i] + Math.cos(t * 0.47 + phase * 1.9) * 0.26;
            outVelocity[o + 2] = this.vz[i] - Math.sin(t * 0.27 + phase * 1.3) * 0.35;
        }
        for (let i = this.ambient; i < this.count; i += 1) {
            const o = i * 4;
            const life = this.life[i];
            if (life <= 0) {
                outPlace[o + 3] = 0;
                outGlow[o] = 0;
                continue;
            }
            const age = this.span[i] - life;
            const flicker = 0.78 + 0.22 * Math.sin(t * 17 + this.seed[i] * 50);
            outPlace[o] = this.x[i];
            outPlace[o + 1] = this.y[i];
            outPlace[o + 2] = this.z[i];
            outPlace[o + 3] = this.size[i];
            outGlow[o] = Math.min(1, age / 0.07) * (life / this.span[i]) ** 0.6 * flicker * 1.25;
            outGlow[o + 1] = Math.max(this.heat[i], heat);
            outGlow[o + 2] = Math.min(1, Math.hypot(this.vx[i], this.vy[i], this.vz[i]) * 0.13);
            outGlow[o + 3] = this.seed[i];
            outVelocity[o] = this.vx[i];
            outVelocity[o + 1] = this.vy[i];
            outVelocity[o + 2] = this.vz[i];
        }
    }

    counts() {
        let live = 0;
        for (let i = this.ambient; i < this.count; i += 1) if (this.life[i] > 0) live += 1;
        return { ambient: this.ambient, reserve: this.reserve, live };
    }
}
