/**
 * Fall — the leaves in the air.
 *
 * A small deterministic particle simulation in plain typed arrays (no GPU state, so both
 * renderer backends and the unit tests run the very same code). Each leaf has a position,
 * a velocity and a flutter phase: it drops from a crown, swings from side to side as real
 * leaves do, lands, rests, and is taken up again by wind, by a gust front, or by one of
 * the gameplay force fields (bursts, jets and the combo vortex).
 *
 * Ambient leaves cycle crown -> air -> ground forever. Reserve leaves stay hidden until an
 * event spawns them, then land and fade back into the reserve.
 */

export const LEAF_IDLE = 0;
export const LEAF_AIR = 1;
export const LEAF_REST = 2;
export const LEAF_FADE = 3;

const FALL_ACCEL = 4.6;
const FALL_DRAG = 3.0;
const WIND_DRAG = 2.4;
const FADE_SECONDS = 1.4;

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

export class FallLeafSim {
    constructor({
        count, reserve = 0, rng = Math.random, groundHeight = () => 0, crownPoints = null,
        bounds = {
            minX: -46, maxX: 46, minZ: -72, maxZ: 19, maxY: 34,
        },
    }) {
        this.count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
        this.reserve = Number.isFinite(reserve) ? clamp(Math.floor(reserve), 0, this.count) : 0;
        this.ambient = this.count - this.reserve;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.crownPoints = crownPoints && crownPoints.length >= 4 ? crownPoints : null;
        this.bounds = bounds;
        const n = this.count;
        this.position = new Float32Array(n * 3);
        this.velocity = new Float32Array(n * 3);
        this.angles = new Float32Array(n * 3); // yaw, pitch, roll
        this.spin = new Float32Array(n); // roll rate
        this.phase = new Float32Array(n);
        this.rate = new Float32Array(n); // flutter frequency
        this.size = new Float32Array(n);
        this.scale = new Float32Array(n); // 0..1 fade
        this.timer = new Float32Array(n);
        this.heading = new Float32Array(n);
        this.state = new Uint8Array(n);
        this.species = new Uint8Array(n);
        this.tone = new Float32Array(n);
        // Render buffers: xyz + drawn size, and an orientation quaternion.
        this.outPosition = new Float32Array(n * 4);
        this.outRotation = new Float32Array(n * 4);
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
            this.size[i] = 0.2 + this.random() * 0.2;
            this.rate[i] = 3.2 + this.random() * 2.6;
            this.phase[i] = this.random() * Math.PI * 2;
            this.heading[i] = this.random() * Math.PI * 2;
            this.tone[i] = this.random();
            this.species[i] = 0;
            this.spin[i] = 0;
            this.scale[i] = 0;
            this.timer[i] = 0;
            this.state[i] = LEAF_IDLE;
            this.velocity.fill(0, i * 3, i * 3 + 3);
            if (i < this.ambient) {
                // Start mid-cycle: most leaves already lie on the floor, some are falling.
                if (this.random() < 0.68) this.rest(i, true);
                else this.release(i, this.random());
            }
        }
        this.write();
    }

    /** Let an ambient leaf go from a crown; `fallen` (0..1) pre-ages its fall. */
    release(index, fallen = 0) {
        const o = index * 3;
        let x;
        let y;
        let z;
        if (this.crownPoints) {
            const pick = Math.floor(this.random() * (this.crownPoints.length / 4)) * 4;
            x = this.crownPoints[pick] + (this.random() - 0.5) * 1.6;
            y = this.crownPoints[pick + 1] - this.random() * 0.8;
            z = this.crownPoints[pick + 2] + (this.random() - 0.5) * 1.6;
        } else {
            const { bounds } = this;
            x = bounds.minX + (bounds.maxX - bounds.minX) * this.random();
            z = bounds.minZ + (bounds.maxZ - bounds.minZ) * this.random();
            y = 8 + this.random() * 10;
        }
        const ground = this.groundHeight(x, z);
        y = ground + (y - ground) * (1 - fallen * 0.92);
        this.position[o] = x;
        this.position[o + 1] = y;
        this.position[o + 2] = z;
        this.velocity[o] = 0;
        this.velocity[o + 1] = -0.4 - this.random() * 0.6;
        this.velocity[o + 2] = 0;
        this.state[index] = LEAF_AIR;
        this.scale[index] = 1;
        this.timer[index] = 0;
        this.spin[index] = (this.random() - 0.5) * 3;
    }

    /** Put a leaf on the ground (used for the opening scatter). */
    rest(index, scatter = false) {
        const o = index * 3;
        if (scatter) {
            const { bounds } = this;
            const z = bounds.maxZ - 3 - this.random() ** 1.5 * (bounds.maxZ - bounds.minZ) * 0.7;
            const x = (this.random() * 2 - 1) * (14 + (bounds.maxZ - z) * 0.5);
            this.position[o] = x;
            this.position[o + 2] = z;
            this.species[index] = Math.floor(this.random() * 3);
        }
        this.position[o + 1] = this.groundHeight(this.position[o], this.position[o + 2]) + 0.045;
        this.velocity.fill(0, o, o + 3);
        this.angles[o] = this.random() * Math.PI * 2;
        this.angles[o + 1] = -Math.PI / 2 + (this.random() - 0.5) * 0.35;
        this.angles[o + 2] = (this.random() - 0.5) * 0.3;
        this.state[index] = LEAF_REST;
        this.scale[index] = 1;
        this.timer[index] = scatter ? this.random() * 14 : 0;
        this.spin[index] = 0;
    }

    /**
     * Take a hidden reserve leaf and throw it into the air. Returns its index, or -1 when
     * the scene has no reserve (the tier then simply shows a smaller burst).
     */
    spawn(x, y, z, vx, vy, vz, species = 0) {
        if (this.reserve <= 0) return -1;
        let chosen = -1;
        let oldest = -1;
        for (let step = 0; step < this.reserve; step += 1) {
            const index = this.ambient + ((this.cursor - this.ambient + step) % this.reserve);
            if (this.state[index] === LEAF_IDLE) {
                chosen = index;
                break;
            }
            // Otherwise reuse the event leaf that has been lying around the longest.
            if (this.state[index] !== LEAF_AIR && this.timer[index] > oldest) {
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
        this.state[chosen] = LEAF_AIR;
        this.scale[chosen] = 1;
        this.timer[chosen] = 0;
        this.species[chosen] = species;
        this.spin[chosen] = (this.random() - 0.5) * 14;
        this.phase[chosen] = this.random() * Math.PI * 2;
        return chosen;
    }

    /**
     * Advance the simulation.
     * env.windX, env.windZ   unit wind direction
     * env.breeze  number   steady wind speed (m/s)
     * env.gust    number   extra wind speed (m/s) pulsing across the grove
     * env.front {x, strength, width, direction} | null   a gust front crossing along world x
     * env.fields [{kind:'burst'|'jet'|'vortex', ...}]   gameplay force fields
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
        let airborne = 0;
        for (let i = 0; i < this.count; i += 1) {
            const state = this.state[i];
            if (state !== LEAF_IDLE) {
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
                let kicked = frontPush > 0.6 || (gust > 2.2 && swell > 1.15);
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
                            ay += (field.lift * (y < field.top ? 1 : -0.6) + FALL_ACCEL * 0.92) * hold;
                            kicked = kicked || hold > 0.15;
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
                if (state === LEAF_AIR) {
                    airborne += 1;
                    this.phase[i] += this.rate[i] * step;
                    const swing = Math.sin(this.phase[i]);
                    const heading = this.heading[i] + time * 0.21;
                    // The side-to-side swoop of a falling leaf, slowing at each turn.
                    const speed = Math.hypot(this.velocity[o], this.velocity[o + 1], this.velocity[o + 2]);
                    const calm = clamp(1.4 - speed * 0.16, 0.15, 1);
                    ax += Math.cos(heading) * swing * 3.4 * calm;
                    az += Math.sin(heading) * swing * 3.4 * calm;
                    ay += Math.abs(Math.cos(this.phase[i])) * 1.5 * calm;
                    const speedHere = (breeze + gust) * swell;
                    const localWindX = windX * speedHere + frontPush * 7 * (front ? front.direction : 1);
                    const localWindZ = windZ * speedHere;
                    ax += (localWindX - this.velocity[o]) * WIND_DRAG;
                    az += (localWindZ - this.velocity[o + 2]) * WIND_DRAG;
                    ay += -FALL_ACCEL - this.velocity[o + 1] * FALL_DRAG + frontPush * 2.4
                        + Math.sin(x * 0.21 + z * 0.17 + time * 0.9) * 0.5 * stir;
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
                    // Orientation follows the motion: banking into the swing, tumbling at speed.
                    this.spin[i] += ((speed * 1.6 + 0.4) * Math.sign(this.spin[i] || 1) - this.spin[i]) * step * 1.5;
                    this.angles[o] += (swing * 0.6 + 0.3) * step;
                    this.angles[o + 1] = -0.9 + swing * 0.85 * calm;
                    this.angles[o + 2] += this.spin[i] * step * (1.2 - calm);
                    const ground = this.groundHeight(nextX, nextZ) + 0.045;
                    if (nextY <= ground && this.velocity[o + 1] <= 0) {
                        this.rest(i);
                        this.position[o + 1] = ground;
                    } else if (nextX < bounds.minX || nextX > bounds.maxX || nextZ < bounds.minZ
                        || nextZ > bounds.maxZ || nextY > bounds.maxY) {
                        this.retire(i);
                    }
                } else if (state === LEAF_REST) {
                    this.timer[i] += step;
                    if (kicked) {
                        // Wind or a force field lifts the leaf back into the air.
                        this.state[i] = LEAF_AIR;
                        this.velocity[o] = ax * 0.05 + (this.random() - 0.5) * 0.8
                            + frontPush * 2.5 * (front ? front.direction : 1);
                        this.velocity[o + 1] = 1.4 + this.random() * 1.8 + Math.max(0, ay) * 0.05 + frontPush * 1.2;
                        this.velocity[o + 2] = az * 0.05 + (this.random() - 0.5) * 0.8;
                        this.spin[i] = (this.random() - 0.5) * 10;
                        this.timer[i] = 0;
                    } else if (this.timer[i] > (i < this.ambient ? 18 : 5)) {
                        this.state[i] = LEAF_FADE;
                        this.timer[i] = 0;
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

    /** Ambient leaves start a new fall; event leaves return to the hidden reserve. */
    retire(index) {
        if (index < this.ambient) this.release(index);
        else {
            this.state[index] = LEAF_IDLE;
            this.scale[index] = 0;
            this.timer[index] = 0;
        }
    }

    /** Fill the render buffers: position + size, and yaw * pitch * roll as a quaternion. */
    write() {
        const { outPosition, outRotation } = this;
        for (let i = 0; i < this.count; i += 1) {
            const o = i * 3;
            const p = i * 4;
            outPosition[p] = this.position[o];
            outPosition[p + 1] = this.position[o + 1];
            outPosition[p + 2] = this.position[o + 2];
            outPosition[p + 3] = this.state[i] === LEAF_IDLE ? 0 : this.size[i] * this.scale[i];
            const halfYaw = this.angles[o] * 0.5;
            const halfPitch = this.angles[o + 1] * 0.5;
            const halfRoll = this.angles[o + 2] * 0.5;
            const cy = Math.cos(halfYaw);
            const sy = Math.sin(halfYaw);
            const cp = Math.cos(halfPitch);
            const sp = Math.sin(halfPitch);
            const cr = Math.cos(halfRoll);
            const sr = Math.sin(halfRoll);
            // q = qYaw(Y) * qPitch(X) * qRoll(Z): the leaf lies in its XY plane.
            outRotation[p] = cy * sp * cr + sy * cp * sr;
            outRotation[p + 1] = sy * cp * cr - cy * sp * sr;
            outRotation[p + 2] = cy * cp * sr - sy * sp * cr;
            outRotation[p + 3] = cy * cp * cr + sy * sp * sr;
        }
    }

    counts() {
        const counts = {
            idle: 0, air: 0, rest: 0, fade: 0,
        };
        const keys = ['idle', 'air', 'rest', 'fade'];
        for (let i = 0; i < this.count; i += 1) counts[keys[this.state[i]]] += 1;
        return counts;
    }
}
