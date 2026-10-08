/**
 * Koi Pond — how the koi behave (CPU only, three-free, deterministic).
 *
 * Each koi keeps a lane: a slow loop of its own somewhere in the open water either side of the
 * board card. It steers toward a point a little ahead on that loop, keeps clear of its
 * neighbours, the bank and the standing rocks, rises and sinks, beats its tail in proportion
 * to its speed and coasts in between. On top of that sit the things the game asks of it:
 *
 *   startle(x, z)   a piece has landed there: the nearest fish dart away from it;
 *   leap(...)       a line is cleared: a koi runs up and clears the water in an arc;
 *   setChain(n)     a chain of clears: one fish after another leaves its lane for a single
 *                   ring round the board, all the same way, faster with every step;
 *   holdBreath      a four-line clear holds the school still for a breath; shine() lights it.
 *
 * Whatever is asked of it, a fish never leaves water it can swim in: a step that would carry it
 * onto the bank, into a rock or out of the pond is not taken, and a leap is only launched from
 * a place and on a line that brings it down in open water inside the picture.
 *
 * The school only produces numbers: poses for the renderer (writeLive), where each fish
 * presses on the water (writeWakes), and a short list of things that happened this step
 * (`events`: a fish broke the surface here, fell back there, kissed the surface...).
 */
import {
    POND, TAU, angleDelta, approach, clamp, clamp01, mulberry32, shoreDistance, smooth, waterDepth,
} from './koi-pond-core.js';
import { KOI_LIVE_STRIDE, KOI_VARIETIES } from './koi-pond-koi.js';

/** Gravity for a leaping koi: gentler than the world's, so the arc can be read. */
export const LEAP_GRAVITY = 5.6;
/** Metres a leaping koi travels over the water. */
export const LEAP_REACH = 2.5;
/** The fastest a koi ever swims, metres per second (a fright, a run-up). */
export const TOP_SPEED = 2.6;
/** The ring a chain draws the koi into: centre and radii (metres) around the board card. */
export const CHAIN_RING = Object.freeze({
    x: 0, z: -0.1, radiusX: 2.75, radiusZ: 2.05,
});

/**
 * Where the koi live, and what of the pond the camera shows — for a 16:9 screen. The world
 * replaces it per aspect (reachForAspect in koi-pond-world.js).
 *   inner/outer   each loop lies between these distances from the pond's middle line
 *   far/near      and between these z
 *   viewHalf, viewPerZ   the picture is `viewHalf − viewPerZ·z` metres half-wide at row z
 *   viewNear      the z of the picture's bottom edge
 *   card          half-width of the strip the board card hides (leaps do not land in it)
 */
export const DEFAULT_REACH = Object.freeze({
    inner: 1.95, outer: 6.5, far: -2.5, near: 2.6, viewHalf: 5.63, viewPerZ: 0.39, viewNear: 3.3, card: 1.6,
});

const MODE_CRUISE = 0;
const MODE_RUNUP = 1;
const MODE_AIR = 2;
const MODE_DIVE = 3;

function pickVariety(rand) {
    let total = 0;
    for (let i = 0; i < KOI_VARIETIES.length; i += 1) total += KOI_VARIETIES[i].weight;
    let roll = rand() * total;
    for (let i = 0; i < KOI_VARIETIES.length; i += 1) {
        roll -= KOI_VARIETIES[i].weight;
        if (roll <= 0) return i;
    }
    return 0;
}

export class KoiSchool {
    /**
     * @param {object} params
     * @param {number} params.count
     * @param {number} [params.seed]
     * @param {Array<{x:number,z:number,radius:number}>} [params.rocks]  rocks standing in the water
     * @param {object} [params.reach]   see DEFAULT_REACH
     */
    constructor({
        count, seed = 7411, rocks = [], reach = DEFAULT_REACH,
    } = {}) {
        this.count = Math.max(1, Math.floor(count));
        this.seed = seed;
        this.rocks = rocks;
        this.reach = { ...DEFAULT_REACH, ...reach };
        const n = this.count;
        this.x = new Float32Array(n);
        this.y = new Float32Array(n);
        this.z = new Float32Array(n);
        this.heading = new Float32Array(n);
        this.speed = new Float32Array(n);
        this.turn = new Float32Array(n);
        this.phase = new Float32Array(n);
        this.amp = new Float32Array(n);
        this.curve = new Float32Array(n);
        this.roll = new Float32Array(n);
        this.pitch = new Float32Array(n);
        this.flare = new Float32Array(n);
        this.glow = new Float32Array(n);
        this.fear = new Float32Array(n);
        this.fleeX = new Float32Array(n);
        this.fleeZ = new Float32Array(n);
        this.leapHeading = new Float32Array(n);
        this.mode = new Uint8Array(n);
        this.timer = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.spin = new Float32Array(n);
        this.joined = new Float32Array(n);
        this.laneAngle = new Float32Array(n);
        this.kissed = new Uint8Array(n);
        /** Static per fish. */
        this.fish = [];
        this.events = [];
        this.chain = 0;
        this.hush = 0;
        this.time = 0;
        this.leapCursor = 0;
        this._point = { x: 0, z: 0 };
        this.roster();
        this.planLanes();
        this.reset();
    }

    /** Who lives in the pond. The same seed gives the same fish. */
    roster() {
        const rand = mulberry32(this.seed);
        this.fish.length = 0;
        for (let i = 0; i < this.count; i += 1) {
            // Two big fish, a few small ones, the rest in between.
            let length = 0.74 + rand() * 0.4;
            if (i < 2) length = 1.3 + rand() * 0.18;
            else if (i % 5 === 4) length = 0.48 + rand() * 0.14;
            const longFinned = rand() < 0.38;
            this.fish.push({
                variety: i === 0 ? 0 : pickVariety(rand),
                length,
                seedU: rand(),
                seedV: rand(),
                fins: longFinned ? 1.35 + rand() * 0.4 : 0.92 + rand() * 0.22,
                girth: 0.94 + rand() * 0.16,
                tone: 0.9 + rand() * 0.16,
                markBias: (rand() - 0.5) * 0.09,
                side: i % 2 === 0 ? -1 : 1,
                laneX: 0,
                laneZ: 0,
                laneRX: 1,
                laneRZ: 1,
                laneWay: 1,
                laneSkew: rand() * TAU,
                laneRate: 0.85 + rand() * 0.4,
                cruise: (0.3 + rand() * 0.16) * (0.75 + length * 0.4),
                depth: 0.16 + rand() * 0.34,
                bob: rand() * TAU,
                ringOffset: (rand() - 0.5) * 1.1,
                order: 0,
            });
        }
        // The order in which fish answer a chain: the big ones lead.
        const order = this.fish.map((f, i) => i).sort((a, b) => this.fish[b].length - this.fish[a].length);
        order.forEach((index, rank) => {
            this.fish[index].order = rank;
        });
    }

    /** The water a fish of this length needs under it. */
    static need(length) {
        return 0.3 + length * 0.16;
    }

    /** True where a fish that needs `need` metres of water can be. */
    swimmable(x, z, need) {
        if (Math.abs(x) > POND.maxX - 0.7 || z > POND.maxZ - 0.7 || z < POND.minZ + 0.5) return false;
        if (waterDepth(x, z) < need) return false;
        for (let r = 0; r < this.rocks.length; r += 1) {
            const rock = this.rocks[r];
            const dx = x - rock.x;
            const dz = z - rock.z;
            const keep = rock.radius + 0.14;
            if (dx * dx + dz * dz < keep * keep) return false;
        }
        return true;
    }

    /** How wide the picture is (half, metres) at row z. */
    viewHalfAt(z) {
        return this.reach.viewHalf - this.reach.viewPerZ * z;
    }

    /** The chain's ring fitted to the picture: narrower on a tall screen. */
    ringRadii(out = { x: 0, z: 0 }) {
        out.x = Math.min(CHAIN_RING.radiusX, Math.max(1.4, this.reach.viewHalf * 0.82 - 0.6));
        out.z = CHAIN_RING.radiusZ;
        return out;
    }

    /**
     * Give every fish a loop of water: an ellipse that lies wholly in water deep enough to
     * swim, in the reach on its side, clear of the standing rocks.
     */
    planLanes() {
        const rand = mulberry32(this.seed ^ 0x2f6e2b1);
        const { reach } = this;
        for (let i = 0; i < this.count; i += 1) {
            const f = this.fish[i];
            const need = KoiSchool.need(f.length) + 0.12;
            let lane = null;
            for (let tries = 0; tries < 80 && !lane; tries += 1) {
                const span = Math.max(0.6, reach.outer - reach.inner);
                const rx = Math.min(0.8 + rand() * 1.0, span * 0.5);
                const rz = 0.7 + rand() * 0.9;
                const cx = reach.inner + rx + rand() * Math.max(0.05, span - 2 * rx);
                const cz = reach.far + rz + rand() * Math.max(0.1, reach.near - reach.far - 2 * rz);
                let ok = true;
                for (let k = 0; k < 8 && ok; k += 1) {
                    const a = (k / 8) * TAU;
                    ok = this.swimmable(f.side * cx + Math.cos(a) * rx * 1.25, cz + Math.sin(a) * rz * 1.25, need);
                }
                if (ok) {
                    lane = {
                        laneX: f.side * cx, laneZ: cz, laneRX: rx, laneRZ: rz,
                    };
                }
            }
            // (Nothing fitted: a small loop out in the middle of the reach always does.)
            Object.assign(f, lane || {
                laneX: f.side * Math.min(3.9, (reach.inner + reach.outer) * 0.5), laneZ: 0.6, laneRX: 0.7, laneRZ: 0.7,
            });
            f.laneWay = rand() < 0.5 ? -1 : 1;
        }
    }

    /** The picture changed shape: the koi take new loops inside it (they swim there). */
    setReach(reach) {
        this.reach = { ...DEFAULT_REACH, ...reach };
        this.planLanes();
    }

    /**
     * Everyone back in their lanes, spread round their loops. `time` turns the starting places,
     * so two captures taken at different times show two different ponds.
     */
    reset(time = 0) {
        const rand = mulberry32(this.seed ^ 0x5f3759df);
        for (let i = 0; i < this.count; i += 1) {
            const f = this.fish[i];
            this.laneAngle[i] = rand() * TAU + time * 0.19 * f.laneWay * f.laneRate;
            const target = this.lanePoint(i, this.laneAngle[i]);
            this.x[i] = target.x;
            this.z[i] = target.z;
            this.y[i] = -f.depth;
            // Along the loop, the way this fish goes round it.
            const next = this.lanePoint(i, this.laneAngle[i] + f.laneWay * 0.2, { x: 0, z: 0 });
            this.heading[i] = Math.atan2(next.z - target.z, next.x - target.x);
            this.speed[i] = f.cruise;
            this.turn[i] = 0;
            this.phase[i] = rand() * TAU;
            this.amp[i] = 0.7;
            this.curve[i] = 0;
            this.roll[i] = 0;
            this.pitch[i] = 0;
            this.flare[i] = 0;
            this.glow[i] = 0;
            this.fear[i] = 0;
            this.mode[i] = MODE_CRUISE;
            this.timer[i] = 0;
            this.vy[i] = 0;
            this.spin[i] = 0;
            this.joined[i] = 0;
            this.kissed[i] = 0;
        }
        this.events.length = 0;
        this.chain = 0;
        this.hush = 0;
        this.time = time;
        this.leapCursor = 0;
    }

    /** A point on a fish's own lane at `angle` round the lane's centre. */
    lanePoint(i, angle, out = { x: 0, z: 0 }) {
        const f = this.fish[i];
        const wobble = Math.sin(angle * 2 + f.laneSkew) * 0.18;
        out.x = f.laneX + Math.cos(angle) * f.laneRX * (1 + wobble);
        out.z = f.laneZ + Math.sin(angle) * f.laneRZ * (1 - wobble * 0.6);
        return out;
    }

    /** A point on the chain's ring at `angle`, on this fish's own track of it. */
    ringPoint(i, angle, out = { x: 0, z: 0 }) {
        const f = this.fish[i];
        const radii = this.ringRadii(this._radii || (this._radii = { x: 0, z: 0 }));
        out.x = CHAIN_RING.x + Math.cos(angle) * (radii.x + f.ringOffset * Math.min(1, radii.x / CHAIN_RING.radiusX));
        out.z = CHAIN_RING.z + Math.sin(angle) * (radii.z + f.ringOffset * 0.5);
        return out;
    }

    /**
     * Where fish `i` should head: the point a little way on from where it IS on its lane (so a
     * fish that was frightened off rejoins beside itself, never across the loop), blended onto
     * the chain's ring by `joined`.
     */
    aim(i, joined, out = { x: 0, z: 0 }) {
        const f = this.fish[i];
        const onLane = Math.atan2((this.z[i] - f.laneZ) / f.laneRZ, (this.x[i] - f.laneX) / f.laneRX);
        this.lanePoint(i, onLane + f.laneWay * 0.6, out);
        if (joined <= 0) return out;
        const ax = out.x;
        const az = out.z;
        const onRing = Math.atan2((this.z[i] - CHAIN_RING.z) / CHAIN_RING.radiusZ, (this.x[i] - CHAIN_RING.x) / CHAIN_RING.radiusX);
        this.ringPoint(i, onRing + 0.5, out);
        out.x = ax + (out.x - ax) * joined;
        out.z = az + (out.z - az) * joined;
        return out;
    }

    /** A chain of `n` clears is running (0 = it broke). */
    setChain(n) {
        this.chain = Math.max(0, Math.round(n));
    }

    /** Every fish takes fire at once (a four-line clear); it fades over a few seconds. */
    shine(amount = 1) {
        for (let i = 0; i < this.count; i += 1) this.glow[i] = Math.max(this.glow[i], amount);
    }

    /** Hold the school still for `seconds` (the breath before a four-line clear answers). */
    holdBreath(seconds) {
        this.hush = Math.max(this.hush, seconds);
    }

    /** Something hit the water at (x, z): fish within `reach` metres dart away. */
    startle(x, z, strength = 1, reach = 2.6) {
        for (let i = 0; i < this.count; i += 1) {
            if (this.mode[i] !== MODE_CRUISE) continue;
            const dx = this.x[i] - x;
            const dz = this.z[i] - z;
            const d = Math.hypot(dx, dz);
            if (d > reach) continue;
            const fright = strength * (1 - d / reach);
            if (fright > this.fear[i]) {
                this.fear[i] = Math.min(1.4, fright);
                const inv = 1 / Math.max(d, 0.05);
                this.fleeX[i] = dx * inv;
                this.fleeZ[i] = dz * inv;
            }
        }
    }

    /**
     * Would a leap from (x, z) along `heading` come down well: in water deep enough, clear of
     * the rocks, inside the picture and not behind the card?
     */
    landsWell(x, z, heading, need) {
        const { reach } = this;
        const lx = x + Math.cos(heading) * LEAP_REACH;
        const lz = z + Math.sin(heading) * LEAP_REACH;
        if (!this.swimmable(lx, lz, need + 0.14)) return false;
        // Room to swim on after the splash.
        if (!this.swimmable(lx + Math.cos(heading) * 0.6, lz + Math.sin(heading) * 0.6, need)) return false;
        for (let r = 0; r < this.rocks.length; r += 1) {
            if (Math.hypot(lx - this.rocks[r].x, lz - this.rocks[r].z) < this.rocks[r].radius + 0.55) return false;
        }
        if (Math.abs(lx) > this.viewHalfAt(lz) - 0.35 || lz > reach.viewNear - 0.4) return false;
        if (Math.abs(lx) < reach.card) return false;
        // The middle of the arc must be in the picture too.
        const mx = (x + lx) * 0.5;
        const mz = (z + lz) * 0.5;
        return Math.abs(mx) < this.viewHalfAt(mz) - 0.2 && Math.abs(mx) > reach.card - 0.5;
    }

    /** The line fish `i` could leap along from where it is now (nearest its heading), or null. */
    leapLine(i) {
        const need = KoiSchool.need(this.fish[i].length);
        for (let a = 0; a < 13; a += 1) {
            const swing = Math.ceil(a / 2) * 0.42 * (a % 2 ? 1 : -1);
            const heading = this.heading[i] + swing;
            if (this.landsWell(this.x[i], this.z[i], heading, need)) return { heading, swing: Math.abs(swing) };
        }
        return null;
    }

    /**
     * Send a koi over the water. Picks the best-placed fish on `side` (−1 left, +1 right, 0 any)
     * that is cruising; returns its index, or −1 if none could go.
     * @param {object} [options]
     * @param {number} [options.side=0]
     * @param {number} [options.power=1]   how high (1 ≈ a metre)
     * @param {number} [options.delay=0]   seconds before it starts its run
     * @param {boolean} [options.twist]    it turns over in the air
     */
    leap({
        side = 0, power = 1, delay = 0, twist = false,
    } = {}) {
        let best = -1;
        let bestScore = -Infinity;
        let bestHeading = 0;
        for (let k = 0; k < this.count; k += 1) {
            const i = (k + this.leapCursor) % this.count;
            if (this.mode[i] !== MODE_CRUISE) continue;
            if (side !== 0 && Math.sign(this.x[i]) !== side) continue;
            // In the picture, out in open water, and big fish first.
            if (Math.abs(this.x[i]) > this.viewHalfAt(this.z[i]) - 0.3 || this.z[i] > this.reach.viewNear - 0.5) continue;
            const open = Math.min(1.5, shoreDistance(this.x[i], this.z[i]));
            if (open <= 0.6) continue;
            const line = this.leapLine(i);
            if (!line) continue;
            const score = open + this.fish[i].length * 1.2 - line.swing * 0.8 - k * 0.02;
            if (score > bestScore) {
                bestScore = score;
                best = i;
                bestHeading = line.heading;
            }
        }
        if (best < 0) return -1;
        this.leapHeading[best] = bestHeading;
        this.leapCursor = (best + 1) % this.count;
        this.mode[best] = MODE_RUNUP;
        this.timer[best] = -Math.max(0, delay);
        this.vy[best] = 2.9 + 0.75 * clamp(power, 0.4, 2.2);
        const way = best % 2 ? 1 : -1;
        this.spin[best] = twist ? way : 0;
        return best;
    }

    /** One step of `dt` seconds. */
    step(dt) {
        if (!(dt > 0)) return;
        this.events.length = 0;
        this.time += dt;
        const t = this.time;
        this.hush = Math.max(0, this.hush - dt);
        const held = this.hush > 0 ? 1 : 0;
        const charge = clamp01(this.chain / 9);
        const point = this._point;

        for (let i = 0; i < this.count; i += 1) {
            const f = this.fish[i];
            if (this.mode[i] === MODE_AIR) {
                this.fly(i, dt);
                continue;
            }
            const need = KoiSchool.need(f.length);

            // ── Does this fish swim the chain's ring yet? The big ones first. ──
            const wants = this.chain >= 2 && f.order < (this.chain - 1) * (this.count / 7) ? 1 : 0;
            this.joined[i] += (wants - this.joined[i]) * approach(wants ? 1.6 : 0.7, dt);
            const joined = smooth(0, 1, this.joined[i]);
            const glowTarget = wants ? 0.25 + charge * 0.9 : 0;
            this.glow[i] += (glowTarget - this.glow[i]) * approach(glowTarget > this.glow[i] ? 2.2 : 0.55, dt);

            // ── The lane: head for a point a little way on along the loop ──
            const pace = f.cruise * f.laneRate * (1 + joined * (0.5 + charge * 1.5));
            const ahead = this.aim(i, joined, point);
            let wantX = ahead.x - this.x[i];
            let wantZ = ahead.z - this.z[i];
            const wantLen = Math.hypot(wantX, wantZ) || 1;
            wantX /= wantLen;
            wantZ /= wantLen;

            // ── Keep clear of neighbours ──
            for (let j = 0; j < this.count; j += 1) {
                if (j === i || this.mode[j] === MODE_AIR) continue;
                const dx = this.x[i] - this.x[j];
                const dz = this.z[i] - this.z[j];
                const room = (f.length + this.fish[j].length) * 0.5;
                const d2 = dx * dx + dz * dz;
                if (d2 < room * room && d2 > 1e-6 && Math.abs(this.y[i] - this.y[j]) < 0.22) {
                    const d = Math.sqrt(d2);
                    const push = ((room - d) / room) * 2.4;
                    wantX += (dx / d) * push;
                    wantZ += (dz / d) * push;
                }
            }
            // ── Fright: away from what fell, hard, for a moment ──
            const fear = this.fear[i];
            if (fear > 0.01) {
                wantX += this.fleeX[i] * fear * 3.2;
                wantZ += this.fleeZ[i] * fear * 3.2;
                this.fear[i] *= Math.exp(-dt * 2.4);
            } else this.fear[i] = 0;
            // ── Keep off the bank and the rocks (this outweighs everything above) ──
            const fx = Math.cos(this.heading[i]);
            const fz = Math.sin(this.heading[i]);
            const lookAhead = 0.55 + this.speed[i] * 0.45;
            const probeX = this.x[i] + fx * lookAhead;
            const probeZ = this.z[i] + fz * lookAhead;
            const depthAhead = waterDepth(probeX, probeZ);
            const margin = need + 0.12;
            if (depthAhead < margin) {
                // Toward deeper water: the bed's own slope, or (ashore, where it is flat) the pond.
                const e = 0.3;
                let gx = waterDepth(probeX + e, probeZ) - waterDepth(probeX - e, probeZ);
                let gz = waterDepth(probeX, probeZ + e) - waterDepth(probeX, probeZ - e);
                if (Math.hypot(gx, gz) < 1e-4) {
                    gx = f.laneX - this.x[i];
                    gz = f.laneZ - this.z[i];
                }
                const g = Math.hypot(gx, gz) || 1;
                const urgency = (1 - depthAhead / margin) * 7;
                wantX += (gx / g) * urgency;
                wantZ += (gz / g) * urgency;
            }
            for (let r = 0; r < this.rocks.length; r += 1) {
                const rock = this.rocks[r];
                const dx = this.x[i] - rock.x;
                const dz = this.z[i] - rock.z;
                const d = Math.hypot(dx, dz);
                const keep = rock.radius + 0.55 + f.length * 0.3;
                if (d < keep && d > 1e-4) {
                    const push = ((keep - d) / keep) * 5;
                    wantX += (dx / d) * push;
                    wantZ += (dz / d) * push;
                }
            }

            // ── A leap begins with a run ──
            let burst = fear * 2.2;
            let rise = 0;
            if (this.mode[i] === MODE_RUNUP) {
                this.timer[i] += dt;
                if (this.timer[i] > 0) {
                    burst += 2.6;
                    rise = 1;
                    // It commits to a line that lands well FROM WHERE IT NOW IS.
                    const line = this.leapLine(i);
                    if (line) this.leapHeading[i] = line.heading;
                    wantX = Math.cos(this.leapHeading[i]);
                    wantZ = Math.sin(this.leapHeading[i]);
                    const lined = Math.abs(angleDelta(this.heading[i], this.leapHeading[i])) < 0.22;
                    const ready = this.timer[i] > 0.38 && this.y[i] > -0.09;
                    if (ready && lined && line && this.landsWell(this.x[i], this.z[i], this.heading[i], need)) this.launch(i);
                    // It could not find its line: it thinks better of it.
                    else if (this.timer[i] > 1.6) this.mode[i] = MODE_CRUISE;
                }
            } else if (this.mode[i] === MODE_DIVE) {
                this.timer[i] += dt;
                if (this.timer[i] > 0.7) this.mode[i] = MODE_CRUISE;
            }

            // ── Turn, swim ──
            const wantHeading = Math.atan2(wantZ, wantX);
            const error = angleDelta(this.heading[i], wantHeading);
            const agility = 2.2 + fear * 5 + (this.mode[i] === MODE_RUNUP ? 3 : 0);
            const turnWanted = clamp(error * 2.4, -agility, agility) * (1 - held * 0.85);
            this.turn[i] += (turnWanted - this.turn[i]) * approach(5.5, dt);
            this.heading[i] += this.turn[i] * dt;
            // Burst and glide: a koi beats its tail a few times, then coasts.
            const glide = 0.72 + 0.28 * Math.sin(t * (0.55 + f.laneRate * 0.2) + f.bob * 3);
            const speedWanted = Math.min(TOP_SPEED, pace * glide * (1 + burst)) * (1 - held * 0.9);
            this.speed[i] += (speedWanted - this.speed[i]) * approach(speedWanted > this.speed[i] ? 4.5 : 1.3, dt);
            this.speed[i] = Math.min(this.speed[i], TOP_SPEED);
            const v = this.speed[i];
            // A step is only taken into water it can swim in; otherwise it slides along the
            // obstacle, or stops and turns for home.
            const nx = this.x[i] + Math.cos(this.heading[i]) * v * dt;
            const nz = this.z[i] + Math.sin(this.heading[i]) * v * dt;
            if (this.swimmable(nx, nz, need)) {
                this.x[i] = nx;
                this.z[i] = nz;
            } else {
                if (this.swimmable(nx, this.z[i], need)) this.x[i] = nx;
                else if (this.swimmable(this.x[i], nz, need)) this.z[i] = nz;
                this.speed[i] *= Math.exp(-dt * 6);
                const home = Math.atan2(f.laneZ - this.z[i], f.laneX - this.x[i]);
                this.heading[i] += angleDelta(this.heading[i], home) * approach(5, dt);
                this.fear[i] = 0;
            }

            // ── Depth: its own level, a slow rise and fall, never into the bed ──
            const bed = waterDepth(this.x[i], this.z[i]);
            // Now and then it comes up to the surface, mouth first.
            const surfacing = this.mode[i] === MODE_CRUISE && Math.sin(t * 0.21 + f.bob * 5) > 0.92;
            let level = f.depth + 0.07 * Math.sin(t * 0.31 + f.bob) - joined * 0.05;
            if (surfacing) level = 0.045;
            if (this.mode[i] === MODE_DIVE) level = 0.55;
            if (rise) level = 0.03;
            level = Math.min(level, Math.max(0.045, bed - 0.1 - f.length * 0.1));
            this.y[i] += (-level - this.y[i]) * approach(rise ? 7 : 1.5, dt);

            // ── The body ──
            const beat = clamp(v / Math.max(0.05, f.cruise), 0, 3.5);
            this.phase[i] += dt * (2.6 + beat * 4.4 + Math.abs(this.turn[i]) * 0.8);
            const ampWanted = clamp(0.3 + beat * 0.42 + Math.abs(this.turn[i]) * 0.22, 0.25, 1.75);
            this.amp[i] += (ampWanted - this.amp[i]) * approach(5, dt);
            this.curve[i] += (clamp(this.turn[i] * 0.42, -1, 1) - this.curve[i]) * approach(6, dt);
            this.roll[i] += (clamp(-this.turn[i] * 0.16 * Math.min(1, beat), -0.4, 0.4) - this.roll[i]) * approach(4, dt);
            let nose = surfacing ? 0.16 : 0;
            if (rise) nose = 0.32;
            this.pitch[i] += (nose - this.pitch[i]) * approach(5, dt);
            const brake = clamp01((speedWanted < v * 0.8 ? 1 : 0) + Math.abs(this.turn[i]) * 0.3);
            this.flare[i] += (brake - this.flare[i]) * approach(3.5, dt);

            // The kiss: once each time it comes up.
            if (!surfacing) this.kissed[i] = 0;
            else if (!this.kissed[i] && this.y[i] > -0.075) {
                this.kissed[i] = 1;
                this.events.push({
                    type: 'kiss',
                    x: this.x[i] + Math.cos(this.heading[i]) * f.length * 0.45,
                    z: this.z[i] + Math.sin(this.heading[i]) * f.length * 0.45,
                    power: f.length,
                    index: i,
                });
            }
        }
    }

    /** The moment a running koi leaves the water. */
    launch(i) {
        const f = this.fish[i];
        this.mode[i] = MODE_AIR;
        this.timer[i] = 0;
        // Over the water in LEAP_REACH metres, whatever its size.
        this.speed[i] = (LEAP_REACH * LEAP_GRAVITY) / (2 * this.vy[i]);
        this.events.push({
            type: 'breach', x: this.x[i], z: this.z[i], power: f.length * (this.vy[i] / 3.4), index: i,
        });
    }

    /** A koi in the air: a ballistic arc, nose along its path, tail still working. */
    fly(i, dt) {
        const f = this.fish[i];
        this.timer[i] += dt;
        this.vy[i] -= LEAP_GRAVITY * dt;
        this.y[i] += this.vy[i] * dt;
        const v = this.speed[i];
        this.x[i] += Math.cos(this.heading[i]) * v * dt;
        this.z[i] += Math.sin(this.heading[i]) * v * dt;
        this.pitch[i] = Math.atan2(this.vy[i], v) * 0.92;
        this.roll[i] += this.spin[i] * dt * 5.2;
        this.phase[i] += dt * 17;
        this.amp[i] += (1.5 - this.amp[i]) * approach(8, dt);
        this.curve[i] *= Math.exp(-dt * 3);
        this.flare[i] += (1 - this.flare[i]) * approach(6, dt);
        this.glow[i] = Math.max(this.glow[i], 0.5);
        if (this.y[i] < -0.03 && this.vy[i] < 0) {
            this.mode[i] = MODE_DIVE;
            this.timer[i] = 0;
            this.roll[i] = 0;
            this.spin[i] = 0;
            this.speed[i] = Math.min(v * 0.6, TOP_SPEED);
            this.events.push({
                type: 'splash', x: this.x[i], z: this.z[i], power: f.length * clamp(-this.vy[i] / 3.4, 0.5, 1.6), index: i,
            });
        }
    }

    /** True while fish `i` is out of the water. */
    airborne(i) {
        return this.mode[i] === MODE_AIR;
    }

    /** Poses for the renderer (KOI_LIVE_STRIDE floats per fish). */
    writeLive(out) {
        for (let i = 0; i < this.count; i += 1) {
            const o = i * KOI_LIVE_STRIDE;
            out[o] = this.x[i];
            out[o + 1] = this.y[i];
            out[o + 2] = this.z[i];
            out[o + 3] = this.heading[i];
            out[o + 4] = this.phase[i];
            out[o + 5] = this.amp[i];
            out[o + 6] = this.curve[i];
            out[o + 7] = this.pitch[i];
            out[o + 8] = this.roll[i];
            out[o + 9] = this.glow[i];
            out[o + 10] = this.flare[i];
            out[o + 11] = 1;
        }
    }

    /**
     * Where each fish presses on the water this step, `stride` floats each: x, z, push
     * (metres), radius (metres), then the light it leaves behind and that light's radius.
     * A fish deep down does not mark the surface; only a fish alight leaves light.
     * @returns {number} entries written
     */
    writeWakes(out, dt, stride = 6) {
        let n = 0;
        for (let i = 0; i < this.count; i += 1) {
            if (this.mode[i] === MODE_AIR) continue;
            const f = this.fish[i];
            const near = clamp01(1 - (-this.y[i] - 0.04) / 0.42);
            const lit = this.glow[i] > 0.05 ? this.glow[i] * this.joined[i] : 0;
            if (near <= 0.02 && lit <= 0) continue;
            const push = this.speed[i] * dt * 0.12 * near * near * (0.5 + f.length * 0.7) * (1 + this.amp[i] * 0.4);
            // Just behind the shoulders, swinging with the tail.
            const back = f.length * 0.12;
            const swing = Math.sin(this.phase[i] - 2.4) * this.amp[i] * f.length * 0.05;
            const hx = Math.cos(this.heading[i]);
            const hz = Math.sin(this.heading[i]);
            const o = n * stride;
            out[o] = this.x[i] - hx * back - hz * swing;
            out[o + 1] = this.z[i] - hz * back + hx * swing;
            out[o + 2] = push;
            out[o + 3] = 0.09 + f.length * 0.1;
            if (stride >= 6) {
                // Light pours off a fish that is swimming the chain's ring.
                out[o + 4] = lit * dt * 1.5 * Math.min(1.5, this.speed[i]);
                out[o + 5] = 0.07 + f.length * 0.075;
            }
            n += 1;
        }
        return n;
    }
}
