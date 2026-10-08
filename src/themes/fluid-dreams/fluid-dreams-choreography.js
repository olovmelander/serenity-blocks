/**
 * Fluid Dreams — the choreography: where every body of liquid is, each frame.
 *
 * Three-free and renderer-free. It owns the tables the liquid material reads (balls, group
 * bounds, ring trains, stains, wave packets) and the handful of scalars that go with them, and
 * moves them through time: the Great Drop turning on its thread, its kin dripping into the sea,
 * and the board's events —
 *
 *   lock     a droplet of the piece's colour arcs out of the card and falls into the sea beside
 *            it: a ring train runs out, a jet stands up out of the crater and pinches off a
 *            bead, and the colour stays in the water as a stain (a hard drop throws three and
 *            hits harder);
 *   clear    a wave packet leaves the foot of the board, one crest per line; every stain it
 *            crosses flares and lets go, and a bead of that light climbs the thread into the
 *            Great Drop, which swells and takes the colour;
 *   combo    the Drop buds one satellite per step of the chain and the whole sea charges;
 *   T-spin   the sea under the Drop winds into a funnel;
 *   four lines   the sea holds its breath, the Drop lets go of its thread and falls: a crown of
 *            liquid stands up round the crater, a ring of split light crosses the sky, and the
 *            Drop is lifted back into the air on the column that follows;
 *   perfect  the sea turns to glass and a double ring opens overhead.
 *
 * Everything here is a function of the event history and the clock, stepped with the frame's
 * delta, so a seek + replay reproduces a frame exactly.
 */
import {
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_TRAVEL,
    DREAMFIRE,
    DYE_HOLD,
    DYE_SLOTS,
    FLIGHT_TIME,
    GROUP_BLEND,
    GROUP_CAPACITY,
    GROUP_COUNT,
    GROUP_HERO,
    GROUP_KIN,
    GROUP_LEFT,
    GROUP_RIGHT,
    GROUP_START,
    HERO,
    HUSH_HOLD,
    JET_TIME,
    MAX_BALLS,
    PLUNGE,
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    SMOOTH_K,
    TAU,
    WAVE_SLOTS,
    approach,
    clamp01,
    clearRadius,
    lerp,
    mulberry32,
    powerForCombo,
    ringRadius,
    smooth,
} from './fluid-dreams-core.js';

const GRAVITY = 9.8;
/**
 * How far past a group's surface its pull on the sea's union is still worth marching for: the
 * meniscus, plus what the group's own union swells it by.
 */
const boundMargin = (g) => SMOOTH_K * 4.4 + GROUP_BLEND[g] * 1.4;
const FLIGHT_SLOTS = 8;
const JET_SLOTS = 8;
const CROWN_SPOKES = 10;
/** Where a jet's root and shaft stand in its height, and how thick each is. */
const JET_COLUMN = Object.freeze([[0.28, 0.3], [0.66, 0.21]]);
/** How much the Great Drop draws itself in before it falls. */
const SQUEEZE = 0.05;
const WHITE = Object.freeze([1, 1, 1]);

function rows(count) {
    return Array.from({ length: count }, () => ({
        x: 0, y: 0, z: 0, w: 0,
    }));
}

const mix3 = (out, a, b, t) => {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
};

/** Seconds after a clear at which its packet passes a point `dist` metres from the origin. */
export function clearPassTime(dist) {
    return CLEAR_TRAVEL * clamp01(dist / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

export class FluidChoreography {
    /**
     * @param {object} [options]
     * @param {number} [options.satellites] the most satellites this tier raises
     * @param {number} [options.lobes] lobes turning inside the Great Drop
     * @param {boolean} [options.crown] draw the crown of a four-line clear as liquid (else spray only)
     * @param {number} [options.crownSpokes] points of that crown (three balls each)
     * @param {(burst: object) => void} [options.emit] spray sink: { kind, x, y, z, color, power }
     */
    constructor(options = {}) {
        this.maxSatellites = Math.max(0, Math.min(HERO.satellites, options.satellites ?? HERO.satellites));
        this.lobes = Math.max(2, Math.min(HERO.lobes, options.lobes ?? HERO.lobes));
        this.crown = options.crown !== false;
        this.crownSpokes = Math.max(4, Math.min(CROWN_SPOKES, Math.round(options.crownSpokes ?? CROWN_SPOKES)));
        this.emit = options.emit || null;

        this.tables = {
            balls: rows(MAX_BALLS * 2),
            groups: rows(GROUP_COUNT * 2),
            rings: rows(RING_SLOTS * 2),
            dye: rows(DYE_SLOTS * 2),
            waves: rows(WAVE_SLOTS * 2),
        };
        this.counts = { rings: 0, dye: 0, waves: 0 };
        this.live = new Int32Array(GROUP_COUNT);

        /** Where the picture stands (world metres); the world sets these from the camera. */
        this.scene = {
            hero: [-10, 9.5, -23],
            heroScale: 1,
            kin: [16, 6.5, -30],
            foot: [0, -9],
        };

        // What the material reads beside the tables.
        this.stem = {
            x: 0, z: 0, flare: 5, cap: 8, waist: 0.2, foot: 1.1, top: 0.9, off: 9, glow: 0,
        };
        this.beads = [{ y: -10, amp: 0 }, { y: -10, amp: 0 }];
        this.vortex = {
            x: 0, z: 0, depth: 0, radius: 6, phase: 0, arms: 0,
        };
        this.hero = {
            x: 0, y: 9, z: -24, r: HERO.radius, body: 0, blend: 1.5, bias: 0.05, glow: 0,
        };
        this.heroTint = [0.8, 0.55, 1.0];
        this.prism = { radius: 0, strength: 0, width: 0.06 };
        this.swell = 1;
        this.charge = 0;
        this.surge = 0;
        this.filmShift = 0;
        this.skyFlash = 0;
        /** For the post stack. */
        this.flash = 0;
        this.kick = 0;
        this.hush = 0;

        this.random = mulberry32(90210);
        this.reducedMotion = false;
        this._tmp = [0, 0, 0];
        this.reset();
    }

    /** Back to rest: no event in flight, no charge, the sea clean. */
    reset() {
        this.time = 0;
        this.combo = 0;
        this.charge = 0;
        this.surge = 0;
        this.swell = 1;
        this.filmShift = 0;
        this.skyFlash = 0;
        this.flash = 0;
        this.kick = 0;
        this.hush = 0;
        this.gulp = 0;
        this.gulpTarget = 0;
        this.fed = [0, 0, 0];
        this.fedAmount = 0;
        this.spin = 0;
        this.satGrow = new Float32Array(HERO.satellites);
        this.flights = Array.from({ length: FLIGHT_SLOTS }, () => ({ active: false }));
        this.jets = Array.from({ length: JET_SLOTS }, () => ({ active: false }));
        this.ringPool = Array.from({ length: RING_SLOTS }, () => ({ active: false, t0: -1e9 }));
        this.dyePool = Array.from({ length: DYE_SLOTS }, () => ({ active: false, t0: -1e9 }));
        this.wavePool = Array.from({ length: WAVE_SLOTS }, () => ({ active: false, t0: -1e9 }));
        this.gulps = [{ at: Infinity }, { at: Infinity }];
        this.plunge = {
            active: false, t0: 0, impact: false, rain: -1, at: [0, 0],
        };
        this.twist = { active: false, t0: 0 };
        this.glass = { active: false, t0: 0 };
        this.dripCycle = null;
        this.idleBead = -1;
        this.random = mulberry32(90210);
        this.prism.strength = 0;
        this.prism.radius = 0;
        this.prism.on = false;
        this.prism.t0 = 0;
        this.vortex.depth = 0;
        this.vortex.arms = 0;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures). Clears every event in flight. */
    seek(time) {
        this.reset();
        this.time = Math.max(0, time);
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /**
     * A piece locked. `from` is where its droplet leaves the card, `to` where it meets the sea.
     * @param {{ from: number[], to: number[], color: number[], hardDrop?: boolean }} lock
     */
    lock({
        from, to, color, hardDrop = false,
    }) {
        this._flight(from, to, color, hardDrop ? 1.75 : 1, 0);
        if (hardDrop) {
            // two smaller ones either side, a breath behind
            const dx = to[0] - from[0];
            const side = dx < 0 ? -1 : 1;
            this._flight(from, [to[0] + side * 1.9, to[1] - 1.6], color, 0.7, 0.07, true);
            this._flight(from, [to[0] - side * 1.3, to[1] + 1.4], color, 0.6, 0.12, true);
            this.kick = Math.max(this.kick, 0.35);
        }
        this.filmShift += hardDrop ? 0.09 : 0.05;
    }

    _flight(from, to, color, power, delay, minor = false) {
        let slot = this.flights.find((f) => !f.active);
        if (!slot) {
            slot = this.flights.reduce((a, b) => (a.t0 < b.t0 ? a : b));
        }
        slot.active = true;
        slot.t0 = this.time + delay;
        slot.from = [from[0], from[1], from[2]];
        slot.to = [to[0], to[1]];
        slot.color = [color[0], color[1], color[2]];
        slot.power = power;
        slot.minor = minor;
        slot.shed = -1;
        // never into the thread's foot: beside it
        const sx = slot.to[0] - this.stem.x;
        const sz = slot.to[1] - this.stem.z;
        const near = Math.hypot(sx, sz);
        const clear = 3.4 * this.scene.heroScale;
        if (near < clear) {
            const push = clear / Math.max(near, 0.01);
            slot.to[0] = this.stem.x + (near < 0.01 ? clear : sx * push);
            slot.to[1] = this.stem.z + sz * push;
        }
        slot.group = slot.to[0] < this.scene.foot[0] ? GROUP_LEFT : GROUP_RIGHT;
    }

    /**
     * Lines cleared. `origin` is the sea point under the board the packet leaves from.
     * @param {{ origin: number[], lines: number, tspin?: boolean, perfect?: boolean }} clear
     */
    clear({
        origin, lines, tspin = false, perfect = false,
    }) {
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        const { time } = this;
        const quad = n >= 4;
        this._wave(origin[0], origin[1], n, quad ? 1.25 : 1, quad ? HUSH_HOLD : 0);
        // every stain the packet crosses flares and lets go
        for (let i = 0; i < this.dyePool.length; i += 1) {
            const s = this.dyePool[i];
            if (!s.active || s.releaseAt < Infinity) continue;
            const dist = Math.hypot(s.x - origin[0], s.z - origin[1]);
            s.releaseAt = time + (quad ? HUSH_HOLD : 0) + clearPassTime(dist);
        }
        // a bead of light climbs the thread when the packet reaches its foot
        const toFoot = Math.hypot(this.stem.x - origin[0], this.stem.z - origin[1]);
        this._gulp(time + clearPassTime(toFoot) + (quad ? HUSH_HOLD : 0), 0.22 + n * 0.08);
        this.flash = Math.max(this.flash, 0.25 + n * 0.12);
        this.kick = Math.max(this.kick, 0.2 + n * 0.12);
        this.filmShift += 0.06 * n;
        if (quad) this._startPlunge();
        if (tspin) {
            this.twist.active = true;
            this.twist.t0 = time;
        }
        if (perfect) {
            // (after four lines the sea turns to glass once the crown has gone up)
            this.glass.active = true;
            this.glass.t0 = time + (quad ? HUSH_HOLD + PLUNGE.fall + 1.6 : 0);
        }
    }

    _wave(x, z, lines, power, delay) {
        let slot = this.wavePool.find((w) => !w.active);
        if (!slot) slot = this.wavePool.reduce((a, b) => (a.t0 < b.t0 ? a : b));
        slot.active = true;
        slot.t0 = this.time + delay;
        slot.x = x;
        slot.z = z;
        slot.lines = lines;
        slot.power = power;
    }

    _gulp(at, amp) {
        const slot = this.gulps[0].at <= this.gulps[1].at ? this.gulps[1] : this.gulps[0];
        const free = this.gulps.find((g) => g.at === Infinity) || slot;
        free.at = at;
        free.amp = amp;
    }

    _startPlunge() {
        const p = this.plunge;
        // a second four-line clear while the Drop is still down only sends its wave
        if (p.active && this.time - p.t0 < PLUNGE.total - 0.8) return;
        p.active = true;
        p.t0 = this.time + HUSH_HOLD;
        p.impact = false;
        p.rain = -1;
    }

    /** The true combo (0 = the chain broke). */
    setCombo(combo) {
        this.combo = Math.max(0, Math.round(Number(combo) || 0));
    }

    /** A new level: a soft packet from the foot of the board and a breath of light. */
    levelUp() {
        this._wave(this.scene.foot[0], this.scene.foot[1], 2, 0.7, 0);
        this.flash = Math.max(this.flash, 0.5);
        this.skyFlash = Math.max(this.skyFlash, 0.7);
        this.filmShift += 0.2;
    }

    /** `spare`: a ring that is only decoration is dropped when the pool is full. */
    _ring(x, z, amp, reach, color, delay = 0, spare = false) {
        let slot = this.ringPool.find((r) => !r.active);
        if (!slot) {
            if (spare) return;
            // a full pool gives up its faintest train, never a bright one
            const now = this.time;
            const left = (r) => r.amp * Math.exp(-Math.max(0, now - r.t0) * RING_FADE);
            slot = this.ringPool.reduce((a, b) => (left(a) < left(b) ? a : b));
        }
        slot.active = true;
        slot.t0 = this.time + delay;
        slot.x = x;
        slot.z = z;
        slot.amp = amp;
        slot.reach = reach;
        slot.color = [color[0], color[1], color[2]];
    }

    _stain(x, z, strength, color) {
        const now = this.time;
        const left = (s) => (s.releaseAt < Infinity ? 0 : s.strength * Math.exp(-Math.max(0, now - s.t0) / DYE_HOLD));
        // colour landing in colour joins it: one deeper stain, not two
        for (let i = 0; i < this.dyePool.length; i += 1) {
            const s = this.dyePool[i];
            if (!s.active || s.releaseAt < Infinity || Math.hypot(s.x - x, s.z - z) > 2.4) continue;
            const had = left(s);
            const share = strength / (strength + had + 1e-6);
            s.color[0] = lerp(s.color[0], color[0], share);
            s.color[1] = lerp(s.color[1], color[1], share);
            s.color[2] = lerp(s.color[2], color[2], share);
            s.strength = Math.min(1.4, had + strength * 0.6);
            s.t0 = now - 0.5; // its strength starts over, without a second fade-in; its spread stays
            return;
        }
        let slot = this.dyePool.find((s) => !s.active);
        // a full pool gives up its faintest stain
        if (!slot) slot = this.dyePool.reduce((a, b) => (left(a) < left(b) ? a : b));
        slot.active = true;
        slot.t0 = this.time;
        slot.born = this.time;
        slot.x = x;
        slot.z = z;
        slot.strength = strength;
        slot.color = [color[0], color[1], color[2]];
        slot.releaseAt = Infinity;
        slot.fedDone = false;
    }

    _burst(kind, x, y, z, color, power) {
        this.emit?.({
            kind, x, y, z, color, power,
        });
    }

    // ── per frame ───────────────────────────────────────────────────────────────

    /**
     * Advance to `time` and rewrite every table.
     * @param {number} time seconds
     * @param {number} dt seconds since the last update (0 while a capture holds a frame)
     * @param {object} palette the current (eased) palette: arrays keyed like FLUID_PALETTES
     */
    update(time, dt, palette) {
        this.time = time;
        const calm = this.reducedMotion ? 0.45 : 1;

        // ── scalars ──
        const power = powerForCombo(this.combo);
        this.charge += (power - this.charge) * approach(power > this.charge ? 3.2 : 0.9, dt);
        this.surge *= Math.exp(-dt / 2.2);
        this.flash *= Math.exp(-dt / 0.28);
        this.kick *= Math.exp(-dt / 0.22);
        this.skyFlash *= Math.exp(-dt / 0.9);
        this.filmShift *= Math.exp(-dt / 1.3);
        this.gulpTarget *= Math.exp(-dt / 0.55);
        this.gulp += (this.gulpTarget - this.gulp) * approach(9, dt);
        this.fedAmount *= Math.exp(-dt / 14);
        this.spin += dt * (0.22 + this.charge * 0.5 + this.surge * 0.6) * calm;

        const p = this.plunge;
        const pt = p.active ? time - p.t0 : -1; // < 0 during the hush
        const hushing = p.active && pt < 0;
        this.hush += ((hushing ? 1 : 0) - this.hush) * approach(hushing ? 14 : 4, dt);
        const glassAge = this.glass.active ? time - this.glass.t0 : -1;
        if (this.glass.active && glassAge > 5.5) this.glass.active = false;
        const glass = this.glass.active ? smooth(0, 0.5, glassAge) * (1 - smooth(3.6, 5.5, glassAge)) : 0;
        const swellTarget = (1 + this.charge * 0.35 + this.surge * 0.3) * (1 - this.hush * 0.85)
            * (1 - glass * 0.94) * calm;
        this.swell += (swellTarget - this.swell) * approach(5, dt);

        this.live.fill(0);
        this._updateHero(time, dt, palette, pt, calm);
        this._updateKin(time, palette, calm);
        this._updateFlights(time);
        this._updateJets(time);
        this._updateSea(time, glass);
        this._writeBounds();
    }

    _put(group, x, y, z, r, color, glow) {
        const n = this.live[group];
        if (n >= GROUP_CAPACITY[group] || !(r > 0.02)) return;
        const i = (GROUP_START[group] + n) * 2;
        const a = this.tables.balls[i];
        a.x = x;
        a.y = y;
        a.z = z;
        a.w = r;
        const b = this.tables.balls[i + 1];
        b.x = color[0];
        b.y = color[1];
        b.z = color[2];
        b.w = glow;
        this.live[group] = n + 1;
    }

    // ── the Great Drop ──────────────────────────────────────────────────────────

    _updateHero(time, dt, palette, pt, calm) {
        const sc = this.scene;
        const scale = sc.heroScale;
        const p = this.plunge;
        const { stem } = this;

        // the body's colour: pale glass leaning to the palette's third ink, plus what it was fed
        const base = mix3(this._tmp, palette.inkC, WHITE, 0.3);
        const fedMix = clamp01(this.fedAmount * 0.75);
        this.heroTint[0] = lerp(base[0], this.fed[0], fedMix);
        this.heroTint[1] = lerp(base[1], this.fed[1], fedMix);
        this.heroTint[2] = lerp(base[2], this.fed[2], fedMix);

        // beads climbing the thread (a clear's light, or the sea's slow feeding at rest)
        const idle = Math.floor((time + 3.1) / 8.5);
        if (idle !== this.idleBead) {
            if (this.idleBead >= 0 && !p.active) this._gulp(time, 0.13);
            this.idleBead = idle;
        }
        for (let i = 0; i < 2; i += 1) {
            const g = this.gulps[i];
            const bead = this.beads[i];
            const age = time - g.at;
            if (age >= 0 && age < 0.95) {
                const k = age / 0.95;
                bead.y = k * k * (3 - 2 * k) * stem.cap;
                bead.amp = g.amp * Math.sin(Math.PI * Math.min(1, k * 1.08)) * scale;
            } else {
                bead.y = -10;
                bead.amp = 0;
                if (age >= 0.95 && g.at !== Infinity) {
                    // it arrives: the Drop swallows
                    this.gulpTarget = Math.min(1.6, this.gulpTarget + g.amp * 2.2);
                    g.at = Infinity;
                }
            }
        }

        const swellR = 1 + HERO.swell * this.charge + this.gulp * 0.07;
        let R = HERO.radius * scale * swellR;
        // where it hangs at rest; a plunge leaves from here and returns to here, so nothing jumps
        const cx = sc.hero[0] + Math.sin(time * 0.21) * 0.35 * calm;
        let cy = sc.hero[1] + Math.sin(time * 0.37) * 0.3 * calm;
        const cz = sc.hero[2] + Math.cos(time * 0.17) * 0.3 * calm;
        let spread = 1; // how far the lobes stand out of the core
        let stemOn = 1;
        let stemFoot = 0.8;
        let stemWaist = 0.1 + this.charge * 0.14 + this.surge * 0.12;
        let crownAge = -1;

        if (p.active) {
            if (pt < 0) {
                // the hush: it gathers itself
                const k = 1 + pt / HUSH_HOLD; // 0 → 1
                spread = 1 - 0.55 * k;
                R *= 1 - SQUEEZE * k;
                cy += 0.25 * k;
            } else if (pt < PLUNGE.fall) {
                const k = pt / PLUNGE.fall;
                R *= 1 - SQUEEZE;
                cy = lerp(cy + 0.25, -R * 0.55, k * k);
                spread = 0.45;
                stemOn = 0;
            } else {
                if (!p.impact) {
                    p.impact = true;
                    p.at = [cx, cz];
                    this._impact(cx, cz, R);
                }
                crownAge = pt - PLUNGE.fall;
                const riseAt = 0.55;
                if (crownAge < riseAt) {
                    R *= 1 - SQUEEZE;
                    cy = -R * (0.55 + 1.2 * (crownAge / riseAt));
                    spread = 0.45;
                    stemOn = 0;
                } else {
                    // lifted back on the column that follows the crater
                    const k = clamp01((crownAge - riseAt) / PLUNGE.rise);
                    R *= 1 - SQUEEZE * (1 - smooth(0, 0.6, k));
                    const e = 1 - (1 - k) ** 3;
                    const over = Math.sin(k * Math.PI) * 0.9 * (1 - k);
                    cy = lerp(-R * 1.75, cy, e) + over;
                    spread = lerp(0.45, 1, smooth(0.25, 1, k));
                    // the column: a thick neck that thins to the thread as the Drop climbs
                    stemWaist = lerp(1.25, stemWaist, smooth(0.15, 0.95, k));
                    stemFoot = lerp(2.4, 0.8, smooth(0.2, 1, k));
                }
                if (pt > PLUNGE.total) p.active = false;
            }
        }

        this.hero.x = cx;
        this.hero.y = cy;
        this.hero.z = cz;
        this.hero.r = R;

        // ── the thread ──
        stem.x = cx;
        stem.z = cz;
        stem.cap = cy;
        stem.flare = Math.max(0.2, cy - R * 0.92);
        stem.waist = stemWaist * scale;
        stem.foot = stemFoot * scale;
        stem.top = R * 0.26;
        stem.off = stemOn > 0 && cy > R * 0.3 ? 0 : 9;
        stem.glow = this.charge * 0.25 + this.surge * 0.3;

        // ── the body: a core and lobes turning through it, joined by a soft union of their own ──
        const glow = this.charge * 0.08 + this.surge * 0.2 + this.gulp * 0.1;
        const tint = this.heroTint;
        // The union swells what it joins by about blend·ln(overlap); the balls are drawn smaller
        // by that much, and the rest is taken back out as a bias on the distance.
        const blend = R * 0.4;
        this.hero.blend = blend;
        this.hero.bias = Math.exp(-(blend * 0.55) / SMOOTH_K);
        this.hero.glow = glow;
        this.hero.body = 0;
        if (cy > -R * 1.6) {
            this._put(GROUP_HERO, cx, cy, cz, R * 0.8, tint, glow);
            for (let j = 0; j < this.lobes; j += 1) {
                const a = this.spin * (0.8 + j * 0.23) + j * 1.9;
                const b = this.spin * (0.55 + j * 0.17) + j * 2.7;
                const reach = R * 0.56 * spread;
                const lr = R * (0.5 + 0.07 * Math.sin(time * 0.31 + j * 1.7)) * (0.72 + 0.28 * spread);
                this._put(
                    GROUP_HERO,
                    cx + Math.cos(a) * reach * (0.95 + 0.25 * Math.sin(b)),
                    cy + Math.sin(b) * reach * 0.72,
                    cz + Math.sin(a) * reach * 0.7,
                    lr,
                    tint,
                    glow,
                );
            }
            this.hero.body = this.live[GROUP_HERO];
        }

        // ── satellites: one buds off for every step of the chain ──
        // (a falling Drop takes them with it at once: the crown needs their room in the table)
        const falling = p.active && pt >= 0;
        const want = falling ? 0 : Math.min(this.maxSatellites, this.combo);
        for (let j = 0; j < HERO.satellites; j += 1) {
            const target = j < want ? 1 : 0;
            const g = this.satGrow[j];
            let rate = target > g ? 2.6 : 1.6;
            if (falling) rate = 12;
            this.satGrow[j] = g + (target - g) * approach(rate, dt);
            const grow = this.satGrow[j];
            if (grow < 0.02 || cy < R) continue;
            const orbit = R * (0.55 + grow * (1.22 + j * 0.09));
            const a = this.spin * (2.1 + j * 0.37) + j * (TAU / 5.3);
            const tilt = 0.5 + j * 0.71;
            const ox = Math.cos(a) * orbit;
            const oy = Math.sin(a) * orbit * Math.sin(tilt) * 0.62;
            const oz = Math.sin(a) * orbit * Math.cos(tilt) * 0.55;
            const hue = [palette.inkA, palette.inkB, palette.sun][j % 3];
            const c = mix3([0, 0, 0], hue, WHITE, 0.12);
            const sr = (0.42 + (j % 4) * 0.08) * scale * grow;
            this._put(GROUP_HERO, cx + ox, cy + oy, cz + oz, sr, c, 0.7 + this.charge * 0.8);
        }

        // ── the crown: a wall of liquid stands up round the crater, draws into points, and each
        //    point throws a bead ──
        if (crownAge >= 0 && crownAge < PLUNGE.crown && this.crown) {
            const k = crownAge / PLUNGE.crown;
            const ring = R * (0.8 + 1.05 * (1 - Math.exp(-crownAge * 3.0)));
            const stand = Math.max(0, Math.sin(Math.PI * Math.min(1, crownAge / 1.3))) ** 0.8;
            const wall = 3.0 * scale * stand;
            const c = mix3([0, 0, 0], tint, DREAMFIRE, 0.45);
            const flight = crownAge - 0.2;
            for (let j = 0; j < this.crownSpokes; j += 1) {
                const a = (j / this.crownSpokes) * TAU + 0.26;
                const wob = 1 + 0.14 * Math.sin(j * 2.4);
                const cx0 = Math.cos(a);
                const cz0 = Math.sin(a) * 0.92;
                const x = p.at[0] + cx0 * ring * wob;
                const z = p.at[1] + cz0 * ring * wob;
                const lean = 0.3 * stand;
                this._put(GROUP_HERO, x, wall * 0.3 - 0.45, z, 0.82 * scale * (1 - k * 0.45), c, 0.4 * (1 - k));
                this._put(
                    GROUP_HERO,
                    x + cx0 * lean,
                    wall * 0.7 * wob - 0.25,
                    z + cz0 * lean,
                    0.58 * scale * stand,
                    c,
                    0.6 * (1 - k),
                );
                if (flight > 0) {
                    const y = 1.9 * scale + 7.4 * wob * flight - 0.5 * GRAVITY * flight * flight;
                    const out = 0.5 + flight * 1.7;
                    const br = 0.36 * scale * (1 - k * 0.3);
                    if (y > -0.4) this._put(GROUP_HERO, x + cx0 * out, y, z + cz0 * out, br, c, 1.5 * (1 - k));
                }
            }
        }

        // what the crown threw comes back down as rain
        if (crownAge >= 0.55 && crownAge < 2.5) {
            const beat = Math.floor(crownAge / 0.07);
            if (beat !== p.rain) {
                p.rain = beat;
                this._burst('rain', p.at[0], 13 + this.random() * 5, p.at[1] + 4, DREAMFIRE, 1);
            }
        }

        // ── the funnel a T-spin winds ──
        const tw = this.twist;
        const { vortex } = this;
        if (tw.active) {
            const age = time - tw.t0;
            const env = smooth(0, 0.35, age) * (1 - smooth(1.5, 2.8, age));
            vortex.x = sc.hero[0];
            vortex.z = sc.hero[2];
            vortex.depth = 1.15 * env * scale;
            vortex.radius = 4.6 * scale;
            vortex.arms = 0.55 * env;
            vortex.phase = age * 7.5;
            this.spin += dt * 2.4 * env;
            if (age > 2.8) {
                tw.active = false;
                vortex.depth = 0;
                vortex.arms = 0;
            }
        }
    }

    /** The Great Drop meets the sea. */
    _impact(x, z, R) {
        const fire = DREAMFIRE;
        this.surge = 1.0;
        this.flash = 1;
        this.kick = 1;
        this.skyFlash = 0.7;
        this.prism.t0 = this.time;
        this.prism.on = true;
        this._ring(x, z, 0.34, 46, fire);
        this._ring(x, z, 0.2, 34, fire, 0.35);
        this._wave(x, z, 4, 1.5, 0);
        this._burst('crown', x, 0.2, z, fire, R);
        // everything the sea was holding goes up with it
        for (let i = 0; i < this.dyePool.length; i += 1) {
            const s = this.dyePool[i];
            if (s.active && s.releaseAt === Infinity) s.releaseAt = this.time + Math.hypot(s.x - x, s.z - z) / 60;
        }
        this.fedAmount = Math.min(1.3, this.fedAmount + 0.5);
    }

    // ── the kin ─────────────────────────────────────────────────────────────────

    _updateKin(time, palette, calm) {
        const sc = this.scene;
        const s = sc.heroScale;
        const c0 = mix3([0, 0, 0], palette.inkB, WHITE, 0.45);
        const c1 = mix3([0, 0, 0], palette.inkA, WHITE, 0.45);
        const [kx, ky, kz] = sc.kin;
        const bob = (f, ph) => Math.sin(time * f + ph) * 0.35 * calm;
        const bodies = [
            [kx, ky + bob(0.31, 0.4), kz, 1.7 * s, c0],
            [kx + 3.3 * s, ky + 2.5 * s + bob(0.43, 2.1), kz + 2.2, 0.95 * s, c1],
            [kx - 2.5 * s, ky - 1.5 * s + bob(0.37, 4.2), kz + 3.4, 0.62 * s, c0],
        ];
        for (let i = 0; i < bodies.length; i += 1) {
            const b = bodies[i];
            this._put(GROUP_KIN, b[0], b[1], b[2], b[3], b[4], 0.06 + this.charge * 0.2);
        }
        // one of them lets a drip go every few seconds
        const period = 5.6;
        const cycle = Math.floor(time / period);
        const local = time - cycle * period;
        const who = bodies[cycle % 2 === 0 ? 0 : 1];
        const startY = who[1] - who[3] * 0.9;
        const hangTime = 1.1;
        if (this.dripCycle === null) {
            // the first frame after a seek or a reset: a drip that already fell is not replayed
            const fallen = local > hangTime + Math.sqrt((2 * Math.max(0, startY - 0.1)) / GRAVITY);
            this.dripCycle = fallen ? cycle : cycle - 1;
        }
        if (local < hangTime) {
            // it swells out of the body's underside
            const k = local / hangTime;
            this._put(GROUP_KIN, who[0], startY - k * 0.5, who[2], 0.3 * s * (0.4 + 0.6 * k), who[4], 0.2);
        } else {
            const fall = local - hangTime;
            const y = startY - 0.5 - 0.5 * GRAVITY * fall * fall;
            if (y > -0.4) {
                this._put(GROUP_KIN, who[0], y, who[2], 0.3 * s, who[4], 0.3);
            } else if (this.dripCycle !== cycle) {
                this.dripCycle = cycle;
                this._ring(who[0], who[2], 0.2, 12, who[4]);
                this._burst('drip', who[0], 0.05, who[2], who[4], 0.5);
            }
        }
    }

    // ── a lock's droplet, and the jet where it lands ────────────────────────────

    _updateFlights(time) {
        for (let i = 0; i < this.flights.length; i += 1) {
            const f = this.flights[i];
            if (!f.active) continue;
            const age = time - f.t0;
            if (age < 0) continue;
            const k = age / FLIGHT_TIME;
            if (k >= 1) {
                f.active = false;
                this._land(f);
                continue;
            }
            // out of the card, over, and down: the fall accelerates
            const e = k * k * (0.55 + 0.45 * k);
            const x = lerp(f.from[0], f.to[0], k);
            const z = lerp(f.from[2], f.to[1], k);
            const lift = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.9 * (1 - k * 0.4);
            const y = lerp(f.from[1], -0.1, e) + lift;
            const r = 0.3 * Math.sqrt(f.power) * (0.55 + 0.45 * smooth(0, 0.25, k));
            this._put(f.group, x, y, z, r, f.color, 3.2);
            // it sheds a string of fine drops behind it
            const shed = Math.floor(age / 0.035);
            if (shed !== f.shed) {
                f.shed = shed;
                this._burst('trail', x, y, z, f.color, 1);
            }
        }
    }

    _land(f) {
        const [x, z] = f.to;
        if (f.minor) {
            // a side droplet: a ring and a splash, no more (a fast player must not fill the pools)
            this._ring(x, z, 0.07 * f.power, RING_REACH * 0.5, f.color, 0, true);
            this._burst('splash', x, 0.05, z, f.color, f.power * 0.7);
            return;
        }
        const jet = this.jets.find((j) => !j.active) || this.jets.reduce((a, b) => (a.t0 < b.t0 ? a : b));
        jet.active = true;
        jet.t0 = f.t0 + FLIGHT_TIME;
        jet.x = x;
        jet.z = z;
        jet.color = f.color;
        jet.power = f.power;
        jet.group = f.group;
        jet.back = false;
        this._ring(x, z, 0.11 + 0.07 * f.power, RING_REACH * (0.7 + 0.3 * f.power), f.color);
        this._stain(x, z, 0.5 + 0.28 * f.power, f.color);
        this._burst('splash', x, 0.05, z, f.color, f.power);
    }

    _updateJets(time) {
        for (let i = 0; i < this.jets.length; i += 1) {
            const j = this.jets[i];
            if (!j.active) continue;
            const age = time - j.t0;
            if (age < 0) continue;
            const life = JET_TIME * Math.sqrt(j.power);
            if (age > life) {
                j.active = false;
                continue;
            }
            const root = Math.sqrt(j.power);
            // the column: a root and a shaft up out of the crater and back, close enough to be one
            // tapering body
            const ck = Math.min(1, age / (0.72 * root));
            if (ck < 1) {
                const height = 1.3 * j.power * Math.sin(Math.PI * ck);
                const fade = 1 - 0.3 * ck;
                for (let c = 0; c < JET_COLUMN.length; c += 1) {
                    const [at, thick] = JET_COLUMN[c];
                    const lit = (1 + c * 0.3) * (1 - ck);
                    this._put(j.group, j.x, -0.3 + height * at, j.z, thick * root * fade, j.color, lit);
                }
            }
            // its tip: carried up with the column, then thrown clear of it (the neck between them
            // thins and parts), a moment's hang, and back into the sea
            const v0 = 5.3 * root;
            const y = -0.25 + v0 * age - 0.5 * GRAVITY * age * age;
            if (y > -0.3) {
                this._put(j.group, j.x, y, j.z, 0.17 * root, j.color, 2.2);
            } else if (!j.back && age > 0.3) {
                j.back = true;
                this._ring(j.x, j.z, 0.05 * j.power, 7, j.color, 0, true);
            }
        }
    }

    // ── the sea's tables ────────────────────────────────────────────────────────

    _updateSea(time, glass) {
        const t = this.tables;
        // ring trains
        let n = 0;
        for (let i = 0; i < this.ringPool.length; i += 1) {
            const r = this.ringPool[i];
            if (!r.active) continue;
            const age = time - r.t0;
            if (age < 0) continue;
            const fade = Math.exp(-age * RING_FADE) * (1 - glass * 0.7);
            if (fade < 0.012) {
                r.active = false;
                continue;
            }
            const radius = ringRadius(age, r.reach);
            const a = t.rings[n * 2];
            a.x = r.x;
            a.y = r.z;
            a.z = radius;
            a.w = r.amp * fade * smooth(0, 0.08, age);
            const b = t.rings[n * 2 + 1];
            b.x = r.color[0];
            b.y = r.color[1];
            b.z = r.color[2];
            b.w = 0.55 + radius * 0.085;
            n += 1;
        }
        this.counts.rings = n;

        // stains: they spread slowly and fade; a clear's packet makes them flare and let go
        n = 0;
        for (let i = 0; i < this.dyePool.length; i += 1) {
            const s = this.dyePool[i];
            if (!s.active) continue;
            const age = time - s.t0;
            let k = s.strength * smooth(0, 0.5, age) * Math.exp(-age / DYE_HOLD);
            const since = time - s.releaseAt;
            if (since >= 0) {
                k *= (1 + 1.1 * Math.exp(-since / 0.22)) * Math.exp(-since / 0.7);
                if (!s.fedDone) {
                    // its colour goes to the Great Drop
                    s.fedDone = true;
                    const w = 0.35;
                    this.fed[0] = lerp(this.fed[0], s.color[0], this.fedAmount > 0.05 ? w : 1);
                    this.fed[1] = lerp(this.fed[1], s.color[1], this.fedAmount > 0.05 ? w : 1);
                    this.fed[2] = lerp(this.fed[2], s.color[2], this.fedAmount > 0.05 ? w : 1);
                    this.fedAmount = Math.min(1.3, this.fedAmount + 0.22);
                }
            }
            if (k < 0.008 && age > 1) {
                s.active = false;
                continue;
            }
            const a = t.dye[n * 2];
            a.x = s.x;
            a.y = s.z;
            a.z = 1.5 + 2.4 * (1 - Math.exp(-(time - s.born) / 6)) + (since >= 0 ? since * 3 : 0);
            a.w = k * (1 + glass * 1.2);
            const b = t.dye[n * 2 + 1];
            b.x = s.color[0];
            b.y = s.color[1];
            b.z = s.color[2];
            b.w = 0;
            n += 1;
        }
        this.counts.dye = n;

        // wave packets
        n = 0;
        for (let i = 0; i < this.wavePool.length; i += 1) {
            const w = this.wavePool[i];
            if (!w.active) continue;
            const age = time - w.t0;
            if (age < 0) continue;
            const life = CLEAR_TRAVEL * 1.25;
            if (age > life) {
                w.active = false;
                continue;
            }
            const radius = clearRadius(age);
            const fade = (1 - age / life) ** 2 * smooth(0, 0.12, age);
            const a = t.waves[n * 2];
            a.x = w.x;
            a.y = w.z;
            a.z = radius;
            a.w = ((0.26 + 0.07 * w.lines) * w.power * fade) / (1 + radius / 55);
            const b = t.waves[n * 2 + 1];
            b.x = (1.5 + 0.75 * w.lines) * (1 + radius / 70);
            b.y = (w.lines * TAU) / 3;
            b.z = (0.2 + 0.1 * w.lines) * w.power * fade;
            b.w = 0;
            n += 1;
        }
        this.counts.waves = n;

        // the ring of split light a four-line clear sends across the sky
        const pr = this.prism;
        // How far a four-line ring owns the sky: wholly from the hush until well after the
        // impact, then it lets go, so a perfect clear's ring eases in under it.
        let owned = this.plunge.active && !this.plunge.impact ? 1 : 0;
        let quad = 0;
        if (pr.on) {
            const age = time - pr.t0;
            quad = 0.95 * Math.exp(-age / 1.15) * smooth(0, 0.1, age);
            owned = 1 - smooth(2.5, 4.5, age);
            if (age > 5) pr.on = false;
        }
        let glassRing = 0;
        if (this.glass.active) {
            const age = time - this.glass.t0;
            glassRing = 1.1 * smooth(0, 0.6, age) * (1 - smooth(3.4, 5.4, age)) * (1 - owned);
        }
        if (glassRing > quad) {
            // a perfect clear's own ring: wide, pale and slow
            pr.radius = 0.5 + (time - this.glass.t0) * 0.12;
            pr.width = 0.07;
            pr.strength = glassRing;
        } else {
            if (pr.on) {
                pr.radius = 0.1 + (time - pr.t0) * 0.62;
                pr.width = 0.035 + (time - pr.t0) * 0.022;
            }
            pr.strength = quad;
        }
    }

    /** One bounding sphere per group, wide enough to hold everything its balls can bridge to. */
    _writeBounds() {
        const { balls, groups } = this.tables;
        for (let g = 0; g < GROUP_COUNT; g += 1) {
            const n = this.live[g];
            const row = groups[g * 2];
            groups[g * 2 + 1].x = n;
            groups[g * 2 + 1].y = g === GROUP_HERO ? this.hero.body : 0;
            if (n === 0 && !(g === GROUP_HERO && this.stem.off < 4)) {
                row.x = 0;
                row.y = -1000;
                row.z = 0;
                row.w = 0.001;
                continue;
            }
            let x0 = Infinity;
            let y0 = Infinity;
            let z0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            let z1 = -Infinity;
            const start = GROUP_START[g];
            for (let i = 0; i < n; i += 1) {
                const b = balls[(start + i) * 2];
                x0 = Math.min(x0, b.x - b.w);
                x1 = Math.max(x1, b.x + b.w);
                y0 = Math.min(y0, b.y - b.w);
                y1 = Math.max(y1, b.y + b.w);
                z0 = Math.min(z0, b.z - b.w);
                z1 = Math.max(z1, b.z + b.w);
            }
            const threaded = g === GROUP_HERO && this.stem.off < 4;
            // the thread runs from the sea to the Drop, swaying
            const reach = this.stem.foot + 1.2;
            if (threaded) {
                x0 = Math.min(x0, this.stem.x - reach);
                x1 = Math.max(x1, this.stem.x + reach);
                z0 = Math.min(z0, this.stem.z - reach);
                z1 = Math.max(z1, this.stem.z + reach);
                y0 = Math.min(y0, 0);
                y1 = Math.max(y1, this.stem.cap);
            }
            // nothing under the sea is seen: the sphere need not reach down for it
            y0 = Math.max(y0, -0.8);
            const cx = (x0 + x1) * 0.5;
            const cy = (y0 + y1) * 0.5;
            const cz = (z0 + z1) * 0.5;
            let radius = threaded ? Math.hypot(this.stem.x - cx, cy, this.stem.z - cz) + reach : 0;
            for (let i = 0; i < n; i += 1) {
                const b = balls[(start + i) * 2];
                const by = Math.max(b.y, -0.8 - b.w);
                radius = Math.max(radius, Math.hypot(b.x - cx, by - cy, b.z - cz) + b.w);
            }
            row.x = cx;
            row.y = cy;
            row.z = cz;
            row.w = radius + boundMargin(g);
        }
    }

    /** True while anything event-driven is still in flight. */
    isBusy() {
        return this.plunge.active || this.twist.active || this.glass.active
            || this.flights.some((f) => f.active) || this.jets.some((j) => j.active);
    }
}
