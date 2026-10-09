/**
 * Verdant Hills — what the wind carries (pure typed-array simulation).
 *
 * Two populations share one buffer. The ambient part is the down that is always adrift over
 * a June hillside: each tuft keeps a home, wanders around it, can be pushed about and drifts
 * back. The reserve stays hidden until the game calls for it: dandelion seed shaken loose
 * by a lock, chaff and petals blown out of the grass by a clear, oak leaves torn off by the
 * great gust, the whirl a combo winds around the board. Chaff tumbles and side-slips as it
 * falls; seed is lighter than air; all of it goes with the wind.
 *
 * No scene objects and no allocation per frame: the same code runs on both backends, in
 * the playground's deterministic `seek`, and in the unit tests.
 */
const TAU = Math.PI * 2;
/** Tints a piece of chaff can have (see verdantHillsChaffPalette); the eighth is down. */
export const VERDANT_HILLS_TINTS = 7;

/** What a particle is: it decides how it falls and how it is drawn. */
export const VERDANT_HILLS_PARTICLES = Object.freeze({ chaff: 0, seed: 1, pollen: 2 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class VerdantHillsSeedSim {
    constructor({
        count = 1200, reserve = 760, rng = Math.random, homes = null, groundHeight = () => -1e6,
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
        this.kind = new Uint8Array(n);
        this.tint = new Uint8Array(n);
        this.size = new Float32Array(n);
        this.spin = new Float32Array(n);
        this.seed = new Float32Array(n);
        this.home = new Float32Array(this.ambient * 3);
        // Instance buffers read by the renderer: place (xyz, size) and look (tint, particle
        // kind, spin in radians, brightness).
        this.outPlace = new Float32Array(n * 4);
        this.outLook = new Float32Array(n * 4);
        this.pull = [0, 0, 0];
        for (let i = 0; i < n; i += 1) {
            this.seed[i] = rng();
            this.size[i] = 0.05 + rng() * 0.03;
        }
        for (let i = 0; i < this.ambient; i += 1) {
            if (homes && homes.length >= 3) {
                const pick = Math.floor(rng() * (homes.length / 3)) * 3;
                this.home.set([homes[pick] + (rng() - 0.5) * 1.6, homes[pick + 1] + (rng() - 0.5),
                    homes[pick + 2] + (rng() - 0.5) * 1.6], i * 3);
            } else {
                this.home.set([(rng() * 2 - 1) * 16, 2.4 + rng() * 3.6, -2 - rng() * 22], i * 3);
            }
        }
        this.reset();
    }

    reset() {
        this.time = 0;
        this.cursor = this.ambient;
        this.x.fill(0);
        this.y.fill(0);
        this.z.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.life.fill(0);
        this.span.fill(1);
        this.spin.fill(0);
        this.kind.fill(VERDANT_HILLS_PARTICLES.chaff);
        for (let i = 0; i < this.ambient; i += 1) this.kind[i] = VERDANT_HILLS_PARTICLES.seed;
        this.outLook.fill(0);
        this.outPlace.fill(0);
        this.write(0, 0);
    }

    /**
     * Release one reserve particle; when none is free, the one nearest its end is taken.
     * `tint` outside 0..6 picks one of the seven at random.
     */
    spawn(x, y, z, vx, vy, vz, {
        life = 2.6, kind = VERDANT_HILLS_PARTICLES.chaff, tint = -1, size = 0.06,
    } = {}) {
        if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return -1;
        let selected = -1;
        let least = Infinity;
        let spare = -1;
        for (let step = 0; step < this.reserve; step += 1) {
            const index = this.ambient + ((this.cursor - this.ambient + step) % this.reserve);
            if (this.life[index] <= 0) {
                selected = index;
                break;
            }
            // Should the whole pool be in flight, the oldest of the next few will do.
            if (step < 25 && this.life[index] < least) {
                least = this.life[index];
                spare = index;
            }
        }
        if (selected < 0) selected = spare;
        this.cursor = this.ambient + ((selected - this.ambient + 1) % this.reserve);
        this.x[selected] = x;
        this.y[selected] = y;
        this.z[selected] = z;
        this.vx[selected] = vx;
        this.vy[selected] = vy;
        this.vz[selected] = vz;
        const lifetime = Number.isFinite(life) ? Math.max(0.2, life) : 2.6;
        this.life[selected] = lifetime;
        this.span[selected] = lifetime;
        this.kind[selected] = kind === VERDANT_HILLS_PARTICLES.seed || kind === VERDANT_HILLS_PARTICLES.pollen
            ? kind : VERDANT_HILLS_PARTICLES.chaff;
        this.tint[selected] = Number.isInteger(tint) && tint >= 0 && tint < VERDANT_HILLS_TINTS
            ? tint : Math.floor(this.seed[selected] * VERDANT_HILLS_TINTS * 0.9999);
        this.size[selected] = Number.isFinite(size) ? clamp(size, 0.01, 0.6) : 0.06;
        this.spin[selected] = this.seed[selected] * TAU;
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
                if (distance < field.reach && py < field.top + 2.5) {
                    const rx = dx / distance;
                    const rz = dz / distance;
                    const tx = -rz * field.turn;
                    const tz = rx * field.turn;
                    const radial = this.vx[index] * rx + this.vz[index] * rz;
                    const around = this.vx[index] * tx + this.vz[index] * tz;
                    // Turn at the orbit's rate, settle on its radius (with the pull an orbit
                    // needs toward its centre), and hold the whirl's height.
                    const swing = (field.spin * distance - around) * field.grip;
                    const draw = -(distance - field.radius) * field.pull - radial * 2 * Math.sqrt(field.pull)
                        - (around * around) / distance;
                    ax += tx * swing + rx * draw;
                    az += tz * swing + rz * draw;
                    ay += (field.top - py) * field.lift - this.vy[index] * 1.4;
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
     * Advance the simulation. `env` is { windX, windZ, wind, gust, glow, heat, settled, fields }.
     */
    step(dt, env = {}) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
        this.time += step;
        const fields = env.fields || [];
        const gust = Number.isFinite(env.gust) ? env.gust : 0;
        const breeze = Number.isFinite(env.wind) ? env.wind : 0.3;
        const windX = Number.isFinite(env.windX) ? env.windX : 1;
        const windZ = Number.isFinite(env.windZ) ? env.windZ : 0;
        const settled = env.settled === true;
        const t = this.time;
        const { pull } = this;
        if (step > 0) {
            // Ambient down: `x,y,z` hold its displacement from the wander path.
            for (let i = 0; i < this.ambient; i += 1) {
                const phase = this.seed[i] * TAU;
                const hx = this.home[i * 3] + Math.sin(t * 0.21 + phase) * 2.2 + Math.sin(t * 0.63 + phase * 3) * 0.5;
                const hy = this.home[i * 3 + 1] + Math.sin(t * 0.37 + phase * 1.9) * 0.7;
                const hz = this.home[i * 3 + 2] + Math.cos(t * 0.17 + phase * 1.3) * 1.8;
                this.force(fields, i, hx + this.x[i], hy + this.y[i], hz + this.z[i], 0.5, pull);
                this.vx[i] += (pull[0] + windX * gust * 1.6 - this.x[i] * 0.8 - this.vx[i] * 1.2) * step;
                this.vy[i] += (pull[1] - this.y[i] * 0.8 - this.vy[i] * 1.2) * step;
                this.vz[i] += (pull[2] + windZ * gust * 1.6 - this.z[i] * 0.8 - this.vz[i] * 1.2) * step;
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
                this.spin[i] += step * (0.4 + this.seed[i]);
            }
            for (let i = this.ambient; i < this.count; i += 1) {
                if (this.life[i] <= 0) continue;
                const phase = this.seed[i] * 40;
                const kind = this.kind[i];
                this.force(fields, i, this.x[i], this.y[i], this.z[i], 1, pull);
                let drag = 1.6;
                let weight = settled ? -2.6 : -1.3;
                let carried = 1.5 + gust * 3.4;
                let wander = 1.7;
                if (kind === VERDANT_HILLS_PARTICLES.seed) {
                    drag = 1;
                    weight = settled ? -0.5 : 0.3;
                    carried = 2.2 + gust * 3.6;
                    wander = 0.8;
                } else if (kind === VERDANT_HILLS_PARTICLES.pollen) {
                    drag = 2.2;
                    weight = settled ? -0.6 : 0.45;
                    carried = 1.6 + gust * 2.6;
                    wander = 1.1;
                }
                // Chaff falls like a leaf: it side-slips one way, stalls, then the other.
                const slip = Math.sin(phase + t * 2.6 + this.y[i] * 1.3);
                this.vx[i] += (pull[0] - this.vx[i] * drag + windX * breeze * carried + slip * wander) * step;
                this.vy[i] += (pull[1] - this.vy[i] * drag + weight
                    + Math.abs(Math.cos(phase * 0.7 + t * 2.6 + this.x[i] * 1.1)) * wander * 0.55) * step;
                this.vz[i] += (pull[2] - this.vz[i] * drag + windZ * breeze * carried
                    + Math.sin(phase * 0.3 + t * 1.9 + this.z[i] * 1.2) * wander) * step;
                this.x[i] += this.vx[i] * step;
                this.y[i] += this.vy[i] * step;
                this.z[i] += this.vz[i] * step;
                const speed = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
                this.spin[i] += step * (1.6 + speed * 2.4) * (this.seed[i] > 0.5 ? 1 : -1);
                this.life[i] -= step * (settled ? 1.5 : 1);
                const floor = this.groundHeight(this.x[i], this.z[i]);
                if (this.y[i] < floor + 0.04) {
                    // It has come down in the grass, and is soon lost among the blades.
                    this.y[i] = floor + 0.04;
                    this.vx[i] *= 0.4;
                    this.vz[i] *= 0.4;
                    this.vy[i] = Math.abs(this.vy[i]) * 0.2;
                    this.life[i] = Math.min(this.life[i], this.span[i] * 0.2);
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
        const { outPlace, outLook } = this;
        for (let i = 0; i < this.ambient; i += 1) {
            const phase = this.seed[i] * TAU;
            const o = i * 4;
            outPlace[o] = this.home[i * 3] + Math.sin(t * 0.21 + phase) * 2.2 + Math.sin(t * 0.63 + phase * 3) * 0.5
                + this.x[i];
            outPlace[o + 1] = this.home[i * 3 + 1] + Math.sin(t * 0.37 + phase * 1.9) * 0.7 + this.y[i];
            outPlace[o + 2] = this.home[i * 3 + 2] + Math.cos(t * 0.17 + phase * 1.3) * 1.8 + this.z[i];
            outPlace[o + 3] = this.size[i];
            outLook[o] = VERDANT_HILLS_TINTS;
            outLook[o + 1] = VERDANT_HILLS_PARTICLES.seed;
            outLook[o + 2] = this.spin[i];
            outLook[o + 3] = 0.24 + 0.12 * Math.sin(t * 0.9 + phase * 5) + glow * 0.3;
        }
        for (let i = this.ambient; i < this.count; i += 1) {
            const o = i * 4;
            const life = this.life[i];
            if (life <= 0) {
                outPlace[o + 3] = 0;
                outLook[o + 3] = 0;
                continue;
            }
            const age = this.span[i] - life;
            outPlace[o] = this.x[i];
            outPlace[o + 1] = this.y[i];
            outPlace[o + 2] = this.z[i];
            // Chaff shrinks away at the end of its life rather than fading: it is not glass.
            const fade = Math.min(1, age / 0.08) * Math.min(1, (life / this.span[i]) / 0.18);
            outPlace[o + 3] = this.size[i] * (this.kind[i] === VERDANT_HILLS_PARTICLES.chaff ? fade : 1);
            outLook[o] = this.tint[i];
            outLook[o + 1] = this.kind[i];
            outLook[o + 2] = this.spin[i];
            outLook[o + 3] = fade * (0.85 + heat * 0.5 + glow * 0.25);
        }
    }

    counts() {
        let live = 0;
        for (let i = this.ambient; i < this.count; i += 1) if (this.life[i] > 0) live += 1;
        return { ambient: this.ambient, reserve: this.reserve, live };
    }
}
