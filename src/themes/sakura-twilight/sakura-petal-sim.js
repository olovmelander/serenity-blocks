/**
 * Sakura Twilight — the petals in the air.
 *
 * A small deterministic particle simulation in plain typed arrays (no GPU state, so both
 * renderer backends and the unit tests run the very same code). A petal lets go of a
 * crown, tumbles down in the slow side-slipping flutter of something that weighs almost
 * nothing, and settles — on the grass, where it lies until the wind or the game lifts it,
 * or on the lake, where it floats and drifts as part of a raft.
 *
 * Ambient petals cycle crown -> air -> ground or water forever. Reserve petals stay
 * hidden until an event spawns them; those carry a light of their own that fades as they
 * fall, then land and fade back into the reserve.
 */

export const PETAL_IDLE = 0;
export const PETAL_AIR = 1;
export const PETAL_REST = 2;
export const PETAL_FLOAT = 3;
export const PETAL_FADE = 4;

const FALL_ACCEL = 2.6;
const FALL_DRAG = 2.9;
const WIND_DRAG = 2.2;
const FADE_SECONDS = 1.6;
const GLOW_FADE = 0.42;

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

export class SakuraPetalSim {
    /**
     * `surface(x, z)` is the height a petal lands on (ground, or the lake's level) and
     * `waterLevel` tells the two apart. `crownPoints` are [x, y, z, tone] quadruples.
     */
    constructor({
        count, reserve = 0, rng = Math.random, surface = () => 0, waterLevel = -Infinity, crownPoints = null,
        bounds = {
            minX: -60, maxX: 60, minZ: -76, maxZ: 20, maxY: 40,
        },
    }) {
        this.count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
        this.reserve = Number.isFinite(reserve) ? clamp(Math.floor(reserve), 0, this.count) : 0;
        this.ambient = this.count - this.reserve;
        this.rng = rng;
        this.surface = surface;
        this.waterLevel = waterLevel;
        this.crownPoints = crownPoints && crownPoints.length >= 4 ? crownPoints : null;
        this.bounds = bounds;
        const n = this.count;
        this.position = new Float32Array(n * 3);
        this.velocity = new Float32Array(n * 3);
        this.angles = new Float32Array(n * 3); // yaw, pitch, roll
        this.spin = new Float32Array(n);
        this.phase = new Float32Array(n);
        this.rate = new Float32Array(n); // flutter frequency
        this.size = new Float32Array(n);
        this.scale = new Float32Array(n); // 0..1 fade
        this.timer = new Float32Array(n);
        this.heading = new Float32Array(n);
        this.glow = new Float32Array(n); // the light an event petal carries
        this.state = new Uint8Array(n);
        // Render buffers: xyz + drawn size, an orientation quaternion, and (tone, glow).
        this.outPosition = new Float32Array(n * 4);
        this.outRotation = new Float32Array(n * 4);
        this.outLook = new Float32Array(n * 2);
        this.time = 0;
        this.airborne = 0;
        this.cursor = this.ambient;
        this.reset();
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? clamp(value, 0, 0.999999) : 0.5;
    }

    reset() {
        this.time = 0;
        this.cursor = this.ambient;
        for (let i = 0; i < this.count; i += 1) {
            this.size[i] = 0.11 + this.random() * 0.09;
            this.rate[i] = 4.2 + this.random() * 3.4;
            this.phase[i] = this.random() * Math.PI * 2;
            this.heading[i] = this.random() * Math.PI * 2;
            this.outLook[i * 2] = this.random();
            this.spin[i] = 0;
            this.scale[i] = 0;
            this.timer[i] = 0;
            this.glow[i] = 0;
            this.state[i] = PETAL_IDLE;
            this.velocity.fill(0, i * 3, i * 3 + 3);
            if (i < this.ambient) {
                // Start mid-cycle: some petals are already down, the rest are falling.
                if (this.random() < 0.42) this.settle(i, true);
                else this.release(i, this.random());
            }
        }
        this.write();
    }

    /** Let an ambient petal go from a crown; `fallen` (0..1) pre-ages its fall. */
    release(index, fallen = 0) {
        const o = index * 3;
        let x;
        let y;
        let z;
        if (this.crownPoints) {
            const pick = Math.floor(this.random() * (this.crownPoints.length / 4)) * 4;
            x = this.crownPoints[pick] + (this.random() - 0.5) * 1.4;
            y = this.crownPoints[pick + 1] - this.random() * 0.6;
            z = this.crownPoints[pick + 2] + (this.random() - 0.5) * 1.4;
            this.outLook[index * 2] = clamp(this.crownPoints[pick + 3] + (this.random() - 0.5) * 0.4, 0, 1);
        } else {
            const { bounds } = this;
            x = bounds.minX + (bounds.maxX - bounds.minX) * this.random();
            z = bounds.minZ + (bounds.maxZ - bounds.minZ) * this.random();
            y = 6 + this.random() * 9;
        }
        const ground = this.surface(x, z);
        y = ground + (y - ground) * (1 - fallen * 0.92);
        this.position[o] = x;
        this.position[o + 1] = y;
        this.position[o + 2] = z;
        this.velocity[o] = 0;
        this.velocity[o + 1] = -0.2 - this.random() * 0.4;
        this.velocity[o + 2] = 0;
        this.state[index] = PETAL_AIR;
        this.scale[index] = 1;
        this.timer[index] = 0;
        this.glow[index] = 0;
        this.spin[index] = (this.random() - 0.5) * 4;
    }

    /** Lay a petal down where it is; `scatter` first picks a spot for the opening state. */
    settle(index, scatter = false) {
        const o = index * 3;
        if (scatter) {
            const { bounds } = this;
            const z = bounds.maxZ - 2 - this.random() ** 1.4 * (bounds.maxZ - bounds.minZ) * 0.62;
            this.position[o] = (this.random() * 2 - 1) * (12 + (bounds.maxZ - z) * 0.55);
            this.position[o + 2] = z;
        }
        const level = this.surface(this.position[o], this.position[o + 2]);
        const afloat = level <= this.waterLevel + 0.001;
        this.position[o + 1] = level + (afloat ? 0.012 : 0.03);
        this.velocity.fill(0, o, o + 3);
        this.angles[o] = this.random() * Math.PI * 2;
        this.angles[o + 1] = -Math.PI / 2 + (afloat ? 0 : (this.random() - 0.5) * 0.4);
        this.angles[o + 2] = afloat ? 0 : (this.random() - 0.5) * 0.3;
        this.state[index] = afloat ? PETAL_FLOAT : PETAL_REST;
        this.scale[index] = 1;
        this.timer[index] = scatter ? this.random() * 16 : 0;
        this.spin[index] = 0;
    }

    /**
     * Take a hidden reserve petal and throw it into the air. `glow` (0..1) is the light it
     * carries. Returns its index, or -1 when the scene has no reserve.
     */
    spawn(x, y, z, vx, vy, vz, glow = 0.8) {
        if (this.reserve <= 0) return -1;
        let chosen = -1;
        let oldest = -1;
        for (let step = 0; step < this.reserve; step += 1) {
            const index = this.ambient + ((this.cursor - this.ambient + step) % this.reserve);
            if (this.state[index] === PETAL_IDLE) {
                chosen = index;
                break;
            }
            // Otherwise reuse the event petal that has been lying around the longest.
            if (this.state[index] !== PETAL_AIR && this.timer[index] > oldest) {
                oldest = this.timer[index];
                chosen = index;
            }
        }
        if (chosen < 0) return -1;
        this.cursor = this.ambient + ((chosen - this.ambient + 1) % this.reserve);
        const o = chosen * 3;
        this.position[o] = x;
        this.position[o + 1] = y;
        this.position[o + 2] = z;
        this.velocity[o] = vx;
        this.velocity[o + 1] = vy;
        this.velocity[o + 2] = vz;
        this.state[chosen] = PETAL_AIR;
        this.scale[chosen] = 1;
        this.timer[chosen] = 0;
        this.glow[chosen] = clamp(glow, 0, 1);
        this.spin[chosen] = (this.random() - 0.5) * 16;
        this.phase[chosen] = this.random() * Math.PI * 2;
        return chosen;
    }

    /**
     * Advance the simulation.
     * env.windX, env.windZ   unit wind direction
     * env.breeze  number   steady wind speed (m/s)
     * env.gust    number   extra wind speed (m/s) pulsing across the garden
     * env.front {x, strength, width, direction} | null   a gust front crossing along world x
     * env.fields [{kind:'burst'|'jet'|'vortex'|'lift', ...}]   gameplay force fields
     */
    step(dt, env = {}) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const step = Math.min(dt, 0.05);
        this.time += step;
        const { time } = this;
        const windX = env.windX ?? 1;
        const windZ = env.windZ ?? 0;
        const breeze = env.breeze ?? 0;
        const gust = env.gust ?? 0;
        const { front } = env;
        const fields = env.fields || [];
        const { bounds } = this;
        const swellTime = time * 0.85;
        const stir = breeze + gust;
        const glowKeep = Math.exp(-GLOW_FADE * step);
        let airborne = 0;
        for (let i = 0; i < this.count; i += 1) {
            const state = this.state[i];
            if (state !== PETAL_IDLE) {
                const o = i * 3;
                const x = this.position[o];
                const y = this.position[o + 1];
                const z = this.position[o + 2];
                // Local wind: the breeze, a rolling swell and (when present) the gust front.
                const swell = 0.65 + 0.7 * (0.5 + 0.5 * Math.sin(x * 0.05 + z * 0.02 - swellTime));
                let frontPush = 0;
                if (front) {
                    const offset = (x - front.x) / front.width;
                    frontPush = Math.exp(-offset * offset) * front.strength;
                }
                let ax = 0;
                let ay = 0;
                let az = 0;
                let kicked = frontPush > 0.55 || (gust > 2.2 && swell > 1.15);
                for (let f = 0; f < fields.length; f += 1) {
                    const field = fields[f];
                    const dx = x - field.x;
                    const dz = z - field.z;
                    if (field.kind === 'vortex') {
                        const radial = Math.hypot(dx, dz) || 0.001;
                        if (radial < field.reach && y < field.top + 2) {
                            const nx = dx / radial;
                            const nz = dz / radial;
                            const hold = clamp(1 - Math.abs(radial - field.radius) / field.reach, 0, 1);
                            const pull = (field.radius - radial) * field.pull;
                            // Tangential drive toward the orbital speed, a spring to the ring,
                            // and a slow climb that tips over at the top of the column.
                            ax += (-nz * field.spin * field.turn - this.velocity[o]) * field.grip * hold + nx * pull;
                            az += (nx * field.spin * field.turn - this.velocity[o + 2]) * field.grip * hold + nz * pull;
                            ay += (field.lift * (y < field.top ? 1 : -0.6) + FALL_ACCEL * 0.95) * hold;
                            kicked = kicked || hold > 0.15;
                        }
                    } else if (field.kind === 'lift') {
                        // A broad updraught: everything lying inside the disc is breathed upward.
                        const radial = Math.hypot(dx, dz);
                        if (radial < field.radius && y < field.top) {
                            const falloff = 1 - radial / field.radius;
                            ay += field.power * falloff + FALL_ACCEL * 0.9;
                            ax += (-dz / (radial + 0.5)) * field.swirl * falloff;
                            az += (dx / (radial + 0.5)) * field.swirl * falloff;
                            kicked = kicked || falloff > 0.1;
                        }
                    } else {
                        const dy = y - field.y;
                        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
                        if (distance < field.radius) {
                            const falloff = 1 - distance / field.radius;
                            if (field.kind === 'burst') {
                                const push = field.power * falloff * falloff;
                                ax += (dx / distance) * push;
                                ay += (dy / distance) * push * 0.6 + field.up * falloff;
                                az += (dz / distance) * push;
                            } else {
                                ax += field.dx * field.power * falloff;
                                ay += field.dy * field.power * falloff;
                                az += field.dz * field.power * falloff;
                            }
                            kicked = kicked || falloff > 0.12;
                        }
                    }
                }
                if (state === PETAL_AIR) {
                    airborne += 1;
                    this.phase[i] += this.rate[i] * step;
                    const swing = Math.sin(this.phase[i]);
                    const heading = this.heading[i] + time * 0.27;
                    // A petal side-slips one way, stalls, and slips back the other.
                    const speed = Math.hypot(this.velocity[o], this.velocity[o + 1], this.velocity[o + 2]);
                    const calm = clamp(1.4 - speed * 0.18, 0.15, 1);
                    ax += Math.cos(heading) * swing * 2.9 * calm;
                    az += Math.sin(heading) * swing * 2.9 * calm;
                    ay += Math.abs(Math.cos(this.phase[i])) * 1.0 * calm;
                    const speedHere = (breeze + gust) * swell;
                    const localWindX = windX * speedHere + frontPush * 7 * (front ? front.direction : 1);
                    const localWindZ = windZ * speedHere;
                    ax += (localWindX - this.velocity[o]) * WIND_DRAG;
                    az += (localWindZ - this.velocity[o + 2]) * WIND_DRAG;
                    ay += -FALL_ACCEL - this.velocity[o + 1] * FALL_DRAG + frontPush * 2.6
                        + Math.sin(x * 0.21 + z * 0.17 + time * 0.9) * 0.55 * stir;
                    this.velocity[o] += ax * step;
                    this.velocity[o + 1] += ay * step;
                    this.velocity[o + 2] += az * step;
                    const nextX = x + this.velocity[o] * step;
                    const nextY = y + this.velocity[o + 1] * step;
                    const nextZ = z + this.velocity[o + 2] * step;
                    this.position[o] = nextX;
                    this.position[o + 1] = nextY;
                    this.position[o + 2] = nextZ;
                    this.timer[i] += step;
                    this.glow[i] *= glowKeep;
                    // Orientation follows the motion: rocking with the slip, tumbling at speed.
                    this.spin[i] += ((speed * 2.2 + 0.6) * Math.sign(this.spin[i] || 1) - this.spin[i]) * step * 1.5;
                    this.angles[o] += (swing * 0.8 + 0.4) * step;
                    this.angles[o + 1] = -0.9 + swing * 0.95 * calm;
                    this.angles[o + 2] += this.spin[i] * step * (1.25 - calm);
                    const level = this.surface(nextX, nextZ) + 0.03;
                    if (nextY <= level && this.velocity[o + 1] <= 0) {
                        this.settle(i);
                    } else if (nextX < bounds.minX || nextX > bounds.maxX || nextZ < bounds.minZ
                        || nextZ > bounds.maxZ || nextY > bounds.maxY) {
                        this.retire(i);
                    }
                } else if (state === PETAL_REST || state === PETAL_FLOAT) {
                    this.timer[i] += step;
                    this.glow[i] *= glowKeep;
                    if (state === PETAL_FLOAT) {
                        // A raft drifts with the breeze and is nudged along by any passing push.
                        const drift = 0.045 * stir * swell + frontPush * 0.5;
                        this.position[o] += (windX * drift + ax * 0.004) * step;
                        this.position[o + 2] += (windZ * drift + az * 0.004) * step;
                        this.angles[o] += 0.12 * step * (1 + frontPush * 4);
                        if (this.surface(this.position[o], this.position[o + 2]) > this.waterLevel + 0.001) {
                            this.state[i] = PETAL_REST;
                        }
                    }
                    if (kicked) {
                        // Wind or a force field lifts the petal back into the air.
                        this.state[i] = PETAL_AIR;
                        this.velocity[o] = ax * 0.05 + (this.random() - 0.5) * 0.8
                            + frontPush * 2.5 * (front ? front.direction : 1);
                        this.velocity[o + 1] = 1.2 + this.random() * 1.6 + Math.max(0, ay) * 0.05 + frontPush * 1.2;
                        this.velocity[o + 2] = az * 0.05 + (this.random() - 0.5) * 0.8;
                        this.spin[i] = (this.random() - 0.5) * 12;
                        this.timer[i] = 0;
                    } else {
                        let stay = 6;
                        if (i < this.ambient) stay = state === PETAL_FLOAT ? 16 : 9;
                        if (this.timer[i] > stay) {
                            this.state[i] = PETAL_FADE;
                            this.timer[i] = 0;
                        }
                    }
                } else {
                    this.timer[i] += step;
                    this.scale[i] = clamp(1 - this.timer[i] / FADE_SECONDS, 0, 1);
                    if (this.timer[i] >= FADE_SECONDS) this.retire(i);
                }
            }
        }
        this.airborne = airborne;
        this.write();
    }

    /** Ambient petals start a new fall; event petals return to the hidden reserve. */
    retire(index) {
        if (index < this.ambient) this.release(index);
        else {
            this.state[index] = PETAL_IDLE;
            this.scale[index] = 0;
            this.timer[index] = 0;
            this.glow[index] = 0;
        }
    }

    /** Fill the render buffers: position + size, yaw * pitch * roll as a quaternion, glow. */
    write() {
        const { outPosition, outRotation, outLook } = this;
        for (let i = 0; i < this.count; i += 1) {
            const o = i * 3;
            const p = i * 4;
            outPosition[p] = this.position[o];
            outPosition[p + 1] = this.position[o + 1];
            outPosition[p + 2] = this.position[o + 2];
            outPosition[p + 3] = this.state[i] === PETAL_IDLE ? 0 : this.size[i] * this.scale[i];
            outLook[i * 2 + 1] = this.glow[i];
            const halfYaw = this.angles[o] * 0.5;
            const halfPitch = this.angles[o + 1] * 0.5;
            const halfRoll = this.angles[o + 2] * 0.5;
            const cy = Math.cos(halfYaw);
            const sy = Math.sin(halfYaw);
            const cp = Math.cos(halfPitch);
            const sp = Math.sin(halfPitch);
            const cr = Math.cos(halfRoll);
            const sr = Math.sin(halfRoll);
            // q = qYaw(Y) * qPitch(X) * qRoll(Z): the petal lies in its XY plane.
            outRotation[p] = cy * sp * cr + sy * cp * sr;
            outRotation[p + 1] = sy * cp * cr - cy * sp * sr;
            outRotation[p + 2] = cy * cp * sr - sy * sp * cr;
            outRotation[p + 3] = cy * cp * cr + sy * sp * sr;
        }
    }

    counts() {
        const counts = {
            idle: 0, air: 0, rest: 0, afloat: 0, fade: 0,
        };
        const keys = ['idle', 'air', 'rest', 'afloat', 'fade'];
        for (let i = 0; i < this.count; i += 1) counts[keys[this.state[i]]] += 1;
        return counts;
    }
}
