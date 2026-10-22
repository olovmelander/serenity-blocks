/**
 * Grainfields — the event language's state (CPU, three-free): what each gameplay event does to the
 * sky, the light and the wind in the grain, as numbers the world writes into its uniforms.
 *
 *  - A lock tears a small gap in the deck and a sunbeam stands in the barley beside the card, on
 *    the side of the board the piece fell (its column across the free field, its row as distance:
 *    the floor near, the top far). The gap rides with the deck, so the beam walks across the field
 *    with the wind aloft. A hard drop tears a wider one and presses a ring of wind out through the
 *    stalks from where the beam lands. The hotter play runs, the wider each new beam.
 *  - A clear sends a trail of wind running out across the field from the eye's feet, laying the
 *    grain over in a lane and carrying the cleared rows' colours as glinting chaff; more lines, a
 *    wider and stronger lane (two lanes for four); each cascade wave a stronger and wider one than
 *    the last. Every clear, wave and hard drop feeds the gale (a swell the wind rides on).
 *  - A chain breaks the storm open (the deck thins step by step, the light lifts, the wind
 *    rises); when the chain ends the deck closes again over TIMING.breakOut.
 *  - A T-spin sets the wind wheeling in the stand where the piece fell (a whirl in the barley); a
 *    T-spin that clears nothing turns a smaller one.
 *  - Four lines tear the sky open over Lapporten and a front of light runs out of the gate over
 *    the fields toward the eye. Back-to-back is the gate's: every difficult clear of a run tears
 *    the sky over Lapporten (wider with each step of the run), and a second quad feeds the tear
 *    and the front of light still running instead of restarting them.
 *  - A perfect clear clears the whole sky and stills the wind a while; the deck returns later.
 *
 * Nothing here restarts what is on screen: a gap, lane or pulse that must give up its place fades
 * out (FADE), the faintest first; the tear, the front of light and the clear sky continue from
 * where they stand when they are fed again.
 *
 * Positions on the field come from the caller's `aim(x, y, distance)`: the screen point (fractions,
 * y down) the world turns into the ground point at that distance along that screen column.
 */
import { Swell } from '../shared/swell.js';
import {
    DECK, EYE, TIMING, clamp, clamp01, hexToLinear, smooth,
} from './grainfields-core.js';
import { boardFor, boardPoint, cardUnion } from './grainfields-composition.js';

/** Table sizes (the shaders' GAPS, TRAILS, PULSES): what stands at full, and room to fade out. */
export const MAX_GAPS = 16;
export const MAX_TRAILS = 9;
export const MAX_PULSES = 9;
/**
 * At most this many stand at full at once; one more asks the faintest standing to fade out over
 * FADE (seconds) instead of cutting it. The rest of each table is room for what is fading.
 */
export const LIVE = Object.freeze({ gaps: 12, trails: 6, pulses: 5 });
export const FADE = Object.freeze({ gaps: 1.2, trails: 1, pulses: 0.8 });

/**
 * How fast a lock's beam walks over the field (metres per second, along the wind aloft's way):
 * slowly, so it stands where the piece fell for most of its life (the deck itself runs at ~10 m/s,
 * which would sweep a beam forty metres out across a quarter of the frame in a second).
 */
export const BEAM_DRIFT = Object.freeze([-0.47, -0.16]);

/** Pulse kinds: a ring of wind outward, a whirl round a centre, a wave across the whole field. */
export const PULSE = Object.freeze({ ring: 0, whirl: 1, wave: 2 });

/**
 * The tear over the gate: its radius (metres) for one quad, how much wider each further quad or
 * back-to-back step that finds it open makes it, and the widest it gets.
 */
export const TEAR = Object.freeze({
    radius: 2600, grow: 450, b2b: 350, widest: 4200,
});

/**
 * The front of light out of the gate: it holds `hold` seconds and fades over `fade`; `pass` is
 * about when it reaches the eye (a quad before then feeds it, after it sends a new one); a fed
 * front is at most `gain` times as bright.
 */
export const FRONT = Object.freeze({
    delay: 0.6, speed: 2100, hold: 5, fade: 4, pass: 5.5, gain: 1.6,
});

/** A perfect clear stills the wind this long, then lets it back over STILL.back (the sky stays clear longer). */
export const STILL = Object.freeze({
    hold: 6, back: 5,
});

/** How a lock's beam lands: distance (metres) by the piece's lowest row (19 the floor, 0 the top). */
export function beamDistance(row) {
    const r = clamp(Number.isFinite(row) ? row : 15, 0, 19);
    return 26 * (1 + (19 - r) * 0.24);
}

/** A beam's radius on the ground (metres), wider the farther it lands, wider for a hard drop. */
export function beamRadius(distance, hardDrop = false, b2b = 0) {
    return (1.5 + distance * 0.028) * (hardDrop ? 1.4 : 1) * (1 + 0.12 * b2b);
}

/**
 * The screen column for a board column, pushed out of the card: the left half of the board lands
 * on the field left of the card (column 0 the farthest out), the right half right of it, short of
 * the stats bar.
 */
export function freeColumn(layout, player, u) {
    const card = cardUnion(layout) || { x0: 0.4, x1: 0.6 };
    const hud = layout?.hud;
    const margin = 0.03;
    const left = [0.05, Math.max(0.08, card.x0 - margin)];
    // Right of the card, short of the stats bar; when the bar stands close beside the card, right
    // of the bar instead.
    const gap = hud ? hud.x0 - card.x1 : 1;
    const right = hud && gap < 0.1
        ? [Math.min(0.9, hud.x1 + margin), 0.95]
        : [card.x1 + margin, hud && hud.x0 > card.x1 ? hud.x0 - margin : 0.95];
    const k = clamp01(Number.isFinite(u) ? u : 0.5);
    if (k < 0.5) return left[1] + (left[0] - left[1]) * ((0.5 - k) / 0.5);
    return right[0] + (right[1] - right[0]) * ((k - 0.5) / 0.5);
}

/**
 * How far a chain of `n` breaks the storm: a single clear none; two a third; each step to six
 * another sixth (0.9 at six); past six it keeps opening, a little a step, to the whole at eleven.
 */
export function breakFor(n) {
    if (!(n >= 2)) return 0;
    const steps = clamp(0.3 + 0.16 * (n - 2), 0.3, 0.9);
    return Math.min(1, steps + 0.02 * Math.max(0, n - 6));
}

const linear = (hex) => (typeof hex === 'string' ? hexToLinear(hex) : [1, 0.86, 0.6]);

/** What is left of something fading out since `fadeAt` over `span` seconds (1 while it stands). */
function fadeLeft(item, time, span) {
    const at = item.fadeAt;
    return Number.isFinite(at) ? 1 - smooth(at, at + span, time) : 1;
}

/** How much a lane still has to give (0..1 times its power): full for four seconds, out by 7.5. */
function trailWeight(tr, time) {
    return tr.power * (1 - smooth(4, 7.5, time - tr.at));
}

/** A pulse's worth: what it still has to give, a T-spin's whirl and a level's wave above a hard drop's ring. */
function pulseWeight(p, time) {
    const age = time - p.at;
    const left = p.kind === PULSE.whirl ? 1 - smooth(3.5, 7, age) : 1 - smooth(2.5, 6, age);
    return p.power * left * (p.kind === PULSE.ring ? 1 : 2.5);
}

/**
 * A lock gap's opening (0..power): it tears open over gapOpen and closes by gapLife; one that
 * gave up its place fades out over FADE.gaps.
 */
function gapOpening(gap, time) {
    const age = time - gap.at;
    if (age < 0) return 0;
    return smooth(0, TIMING.gapOpen, age) * (1 - smooth(TIMING.gapLife * 0.45, TIMING.gapLife, age)) * gap.power
        * fadeLeft(gap, time, FADE.gaps);
}

/** A gap's worth: its full power while it is still tearing open, then what it shows. */
function gapWeight(g, time) {
    return time - g.at < TIMING.gapOpen ? g.power : gapOpening(g, time);
}

/**
 * Make room for one more in a pool. When `live` already stand at full, the faintest standing one
 * (by `weight`; the oldest of equals) starts to fade out over `span` (it is never cut); when even
 * the table is full, the one that has faded furthest goes (it is all but out by then).
 */
function makeRoom(list, time, live, table, span, weight) {
    let standing = 0;
    for (let i = 0; i < list.length; i++) if (!Number.isFinite(list[i].fadeAt)) standing += 1;
    if (standing >= live) {
        let victim = null;
        let least = Infinity;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (Number.isFinite(item.fadeAt)) continue;
            const w = weight(item, time);
            if (w < least) {
                least = w;
                victim = item;
            }
        }
        if (victim) victim.fadeAt = time;
    }
    while (list.length >= table) {
        let index = 0;
        let least = Infinity;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const left = Number.isFinite(item.fadeAt) ? fadeLeft(item, time, span) * weight(item, time) : Infinity;
            if (left < least) {
                least = left;
                index = i;
            }
        }
        list.splice(index, 1);
    }
}

/** Keep, in place and in order, what `alive(item, time)` keeps (no allocation). */
function keep(list, time, alive) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (alive(item, time)) list[n++] = item;
    }
    list.length = n;
}
const gapAlive = (g, time) => time - g.at < TIMING.gapLife && fadeLeft(g, time, FADE.gaps) > 0;
const trailAlive = (tr, time) => time - tr.at < 8 && fadeLeft(tr, time, FADE.trails) > 0;
const pulseAlive = (p, time) => time - p.at < 10 && fadeLeft(p, time, FADE.pulses) > 0;

export class GrainfieldsReactions {
    constructor() {
        /**
         * The gale: every clear, cascade wave and hard drop feeds it and it falls away over a few
         * seconds once the hands rest; the wind in the grain rides on it (the world reads it).
         */
        this.galeSwell = new Swell({
            attack: 0.4, release: 5, ceiling: 1, knee: 0.6,
        });
        this.reset();
    }

    reset() {
        /** Lock gaps: { x, z (deck-fixed), radius, at, rgb, power, beam, fadeAt } */
        this.gaps = [];
        /** Wind trails: { x, z, at, power, hx, hz, curl, width, rgb, side, fadeAt } */
        this.trails = [];
        /** Pulses: { x, z, at, power, kind, speed, width, fadeAt } */
        this.pulses = [];
        this.combo = 0;
        this.b2b = 0;
        this.b2bFrom = 0;
        this.b2bAt = -1e6;
        this.breakFrom = 0;
        this.breakTo = 0;
        this.breakAt = -1e6;
        this.tearAt = -1e6;
        this.tearFrom = 0;
        this.tearRadius = TEAR.radius;
        this.tearX = 0;
        this.tearZ = 0;
        this.flareAt = -1e6;
        this.flareGain = 1;
        this.flareEnd = -1e6;
        this.flareTail = 0;
        this.flareTailAt = -1e6;
        this.perfectAt = -1e6;
        this.perfectFrom = 0;
        this.stillFrom = 0;
        this.trailSide = 1;
        this.lastLockAt = -1e6;
        this.galeSwell.reset();
    }

    // ── Events ──────────────────────────────────────────────────────────────────────

    /**
     * A lock: `aim(x, y, distance)` → [x, y, z] the ground point; `deck` → { drift: [x, z],
     * sunDir: [x, y, z] } for where the beam's gap is torn; `heat` (0..1, the surge's level) widens
     * the beam the hotter play runs.
     */
    lock(c, time, {
        layout, aim, deck, heat = 0,
    }) {
        this.lastLockAt = time;
        const rows = Array.isArray(c?.rows) ? c.rows : [];
        const row = rows.length ? Math.max(...rows) : 15;
        const distance = beamDistance(row);
        const x = freeColumn(layout, c?.player || 0, c?.u);
        const board = boardFor(layout, c?.player || 0);
        const y = board ? boardPoint(board, 0.5, row).y : 0.7;
        const ground = aim(x, y, distance);
        if (!ground) return null;
        const hard = c?.hardDrop === true;
        const warm = clamp01(Number(heat) || 0);
        const radius = beamRadius(distance, hard, this.b2b) * (1 + 0.15 * warm);
        // The gap where the sun's ray through the landing point meets the deck (deck-fixed).
        const [sx, sy, sz] = deck.sunDir;
        const lift = Math.max(0, DECK.base - ground[1]) / Math.max(0.035, sy);
        const gap = {
            // Where the sun's ray through the landing point meets the deck (world, at the tear).
            x: ground[0] + sx * lift,
            z: ground[2] + sz * lift,
            radius,
            at: time,
            rgb: linear(c?.color),
            power: hard ? 1 : 0.85,
            hard,
            // Where the beam lands, and the deck's drift then (the gap rides with the deck).
            footX: ground[0],
            footY: ground[1],
            footZ: ground[2],
            driftX: deck.drift[0],
            driftZ: deck.drift[1],
            fadeAt: Infinity,
        };
        makeRoom(this.gaps, time, LIVE.gaps, MAX_GAPS, FADE.gaps, gapWeight);
        this.gaps.push(gap);
        if (hard) {
            const fall = clamp((Number(c?.distance) || 6) / 16, 0.3, 1.4);
            this.addPulse({
                x: ground[0], z: ground[2], at: time, power: 0.75 * fall, kind: PULSE.ring, speed: 16, width: 5,
            });
            this.galeSwell.hit(0.03, time);
        }
        return gap;
    }

    /**
     * A clear: its lane of wind from the eye's feet out over the field. A cascade's waves each blow
     * a stronger, wider lane than the one before. A back-to-back clear tears the sky over the gate.
     */
    clear(c, time, { layout, aim }) {
        const lines = clamp(Math.round(Number(c?.lines) || 1), 1, 4);
        const depth = clamp(Math.round(Number(c?.cascade) || 1), 1, 10) - 1;
        const rgb = this.rowColour(c);
        const lanes = lines >= 4 ? 2 : 1;
        for (let k = 0; k < lanes; k++) {
            this.trailSide = -this.trailSide;
            const side = this.trailSide;
            const card = cardUnion(layout) || { x0: 0.4, x1: 0.6 };
            const x = side < 0 ? Math.max(0.06, card.x0 - 0.06) : Math.min(0.94, card.x1 + 0.06);
            const start = aim(x, 0.92, 6);
            const far = aim(x + side * 0.08, 0.5, 600);
            if (!start || !far) continue;
            const hx = far[0] - start[0];
            const hz = far[2] - start[2];
            const len = Math.hypot(hx, hz) || 1;
            makeRoom(this.trails, time, LIVE.trails, MAX_TRAILS, FADE.trails, trailWeight);
            this.trails.push({
                x: start[0],
                z: start[2],
                at: time + k * 0.35,
                power: 0.55 + 0.15 * lines + 0.1 * Math.min(depth, 5),
                hx: hx / len,
                hz: hz / len,
                curl: side * (0.00012 + 0.00005 * lines),
                width: 3 + 2.2 * lines + 1.5 * this.b2b + 1.6 * Math.min(depth, 6),
                rgb,
                side,
                fadeAt: Infinity,
            });
        }
        // The gale: more lines, and each deeper wave, blow harder.
        this.galeSwell.hit(0.06 * lines + 0.07 * depth, time);
        if (c?.tspin) {
            const g = aim(freeColumn(layout, c?.player || 0, 0.5 + 0.35 * this.trailSide), 0.75, 42);
            if (g) {
                this.addPulse({
                    x: g[0], z: g[2], at: time, power: 1, kind: PULSE.whirl, speed: 9, width: 14,
                });
            }
        }
        if (lines >= 4) this.quad(time);
        if (c?.b2b) this.gate(time, Math.max(1, this.b2b));
        if (c?.perfect) this.perfect(time);
    }

    /**
     * A T-spin that cleared nothing: a small whirl in the stand where the piece fell. Returns it
     * (null when the aim cannot place it).
     */
    spin(c, time, { layout, aim }) {
        const g = aim(freeColumn(layout, c?.player || 0, Number.isFinite(c?.u) ? c.u : 0.5), 0.75, 34);
        if (!g) return null;
        return this.addPulse({
            x: g[0], z: g[2], at: time, power: 0.55, kind: PULSE.whirl, speed: 9, width: 9,
        });
    }

    /**
     * Four lines: the tear over the gate and the front of light. A tear still open is fed (from
     * where it stands, and wider); a front still on its way to the eye is fed (brighter, held
     * longer); once it has passed, a new one runs out of the gate while the old light fades.
     */
    quad(time) {
        this.feedTear(time, TEAR.grow);
        const age = time - this.flareAt;
        if (age >= -FRONT.delay && age < FRONT.pass) {
            this.flareGain = Math.min(FRONT.gain, this.flareGain + 0.3);
            this.flareEnd = Math.max(this.flareEnd, time + FRONT.delay + FRONT.hold);
        } else {
            this.flareTail = this.flareGlow(time);
            this.flareTailAt = time;
            this.flareAt = time + FRONT.delay;
            this.flareGain = 1;
            this.flareEnd = this.flareAt + FRONT.hold;
        }
    }

    /** Back-to-back: the sky over Lapporten tears (wider with every step of the run). */
    gate(time, level) {
        this.feedTear(time, 0);
        const want = TEAR.radius + TEAR.b2b * clamp(level, 1, 4);
        this.tearRadius = Math.min(TEAR.widest, Math.max(this.tearRadius, want));
    }

    /** Open the tear over the gate from where it stands now; one still open grows by `grow` metres. */
    feedTear(time, grow) {
        const open = this.tear(time);
        this.tearRadius = open > 0.05 ? Math.min(TEAR.widest, this.tearRadius + grow) : TEAR.radius;
        this.tearFrom = open;
        this.tearAt = time;
    }

    /** A perfect clear: the sky clears (and the wind stills) from where they stand now. */
    perfect(time) {
        const [sky, still] = this.clearSky(time);
        this.perfectFrom = sky;
        this.stillFrom = still;
        this.perfectAt = time;
    }

    /** The true combo: a chain of two or more breaks the storm open, step by step. */
    setCombo(n, time) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next === this.combo) return;
        this.breakFrom = this.breaking(time);
        this.breakTo = breakFor(next);
        this.breakAt = time;
        this.combo = next;
    }

    /** The back-to-back level (0..4); the wind it adds eases in and out (`time`; -1e6: at once). */
    setB2B(level, time = -1e6) {
        const next = clamp(Math.round(Number(level) || 0), 0, 4);
        if (next === this.b2b) return;
        this.b2bFrom = this.b2bShown(time);
        this.b2bAt = time;
        this.b2b = next;
    }

    /** The back-to-back level as the wind shows it: in over a second, out over four. */
    b2bShown(time) {
        const span = this.b2b > this.b2bFrom ? 1 : 4;
        return this.b2bFrom + (this.b2b - this.b2bFrom) * smooth(0, span, time - this.b2bAt);
    }

    /** A level-up: a wave of wind across the whole field. */
    levelUp(time) {
        this.addPulse({
            x: EYE.x, z: EYE.z - 900, at: time, power: 0.9, kind: PULSE.wave, speed: 34, width: 60,
        });
    }

    addPulse(p) {
        makeRoom(this.pulses, p.at, LIVE.pulses, MAX_PULSES, FADE.pulses, pulseWeight);
        const pulse = { ...p, fadeAt: Infinity };
        this.pulses.push(pulse);
        return pulse;
    }

    rowColour(c) {
        const codes = c?.rowCodes;
        if (!codes?.length || !c?.palette) return [1, 0.86, 0.6];
        const sum = [0, 0, 0];
        let n = 0;
        for (let i = 0; i < codes.length; i++) {
            const col = c.palette[codes[i]];
            if (!col) continue;
            sum[0] += col[0];
            sum[1] += col[1];
            sum[2] += col[2];
            n += 1;
        }
        return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [1, 0.86, 0.6];
    }

    // ── State over time ─────────────────────────────────────────────────────────────

    /** The storm's break (0..1): eases toward the chain's level, closes slowly after it. */
    breaking(time) {
        const span = this.breakTo > this.breakFrom ? TIMING.breakIn : TIMING.breakOut;
        return this.breakFrom + (this.breakTo - this.breakFrom) * smooth(0, span, time - this.breakAt);
    }

    /** The gale (0..1): what the clears, waves and hard drops have blown up, falling away at rest. */
    gale(time) {
        return this.galeSwell.valueAt(time);
    }

    /** How far a lock's beam has walked since its gap tore (metres, world xz). */
    static gapShift(gap, time) {
        const age = Math.max(0, time - gap.at);
        return [BEAM_DRIFT[0] * age, BEAM_DRIFT[1] * age];
    }

    /** A lock gap's opening (0..power): see gapOpening. */
    static gapStrength(gap, time) {
        return gapOpening(gap, time);
    }

    /** The tear over the gate (0..1): it opens from where it stood over tearIn, closes by tearLife. */
    tear(time) {
        const age = time - this.tearAt;
        const from = this.tearFrom;
        const closing = 1 - smooth(TIMING.tearLife * 0.5, TIMING.tearLife, age);
        return (from + (1 - from) * smooth(0, TIMING.tearIn, age)) * closing;
    }

    /** The front of light from the gate: (strength 0..gain, metres from it). */
    flare(time) {
        const age = time - this.flareAt;
        if (age < 0 || time > this.flareEnd + FRONT.fade) return [0, 0];
        const fading = 1 - smooth(this.flareEnd, this.flareEnd + FRONT.fade, time);
        return [smooth(0, 0.4, age) * fading * this.flareGain, age * FRONT.speed];
    }

    /** The light the quads lift over the frame: the running front, or what is left of the last one. */
    flareGlow(time) {
        const tail = this.flareTail * (1 - smooth(this.flareTailAt, this.flareTailAt + 3, time));
        return Math.max(this.flare(time)[0], tail);
    }

    /** A perfect clear's clear sky (0..1) and the stillness of the wind (0..1). */
    clearSky(time) {
        const age = time - this.perfectAt;
        const rise = smooth(0, 2.5, age);
        const sky = (this.perfectFrom + (1 - this.perfectFrom) * rise)
            * (1 - smooth(TIMING.clearHold, TIMING.clearHold + TIMING.clearReturn, age));
        const still = (this.stillFrom + (1 - this.stillFrom) * rise)
            * (1 - smooth(STILL.hold, STILL.hold + STILL.back, age));
        return [sky, still];
    }

    /**
     * Write the event state into the shaders' uniforms for this frame; returns the scalars the post
     * and the wind follow ({ breaking, tear, flare, clearSky, still }).
     */
    writeUniforms(u, time) {
        this.prune(time);
        let n = 0;
        for (let i = 0; i < this.gaps.length && n < MAX_GAPS; i++) {
            const g = this.gaps[i];
            const s = GrainfieldsReactions.gapStrength(g, time);
            if (s <= 0) continue;
            const [dx, dz] = GrainfieldsReactions.gapShift(g, time);
            const drift = u.drift.value;
            u.tables.gaps[n * 2].set(g.x + dx + drift.x, g.z + dz + drift.y, g.radius, s);
            u.tables.gaps[n * 2 + 1].set(g.rgb[0], g.rgb[1], g.rgb[2], g.at);
            n += 1;
        }
        u.gapCount.value = n;
        n = 0;
        for (let i = 0; i < this.trails.length && n < MAX_TRAILS; i++) {
            const tr = this.trails[i];
            u.tables.trails[n * 3].set(tr.x, tr.z, tr.at, tr.power * fadeLeft(tr, time, FADE.trails));
            u.tables.trails[n * 3 + 1].set(tr.hx, tr.hz, tr.curl, tr.width);
            u.tables.trails[n * 3 + 2].set(tr.rgb[0], tr.rgb[1], tr.rgb[2], tr.side);
            n += 1;
        }
        u.trailCount.value = n;
        n = 0;
        for (let i = 0; i < this.pulses.length && n < MAX_PULSES; i++) {
            const p = this.pulses[i];
            u.tables.pulses[n * 2].set(p.x, p.z, p.at, p.power * fadeLeft(p, time, FADE.pulses));
            u.tables.pulses[n * 2 + 1].set(p.kind, p.speed, p.width, 0);
            n += 1;
        }
        u.pulseCount.value = n;
        const breaking = this.breaking(time);
        u.breaking.value = breaking;
        const tear = this.tear(time);
        u.tear.value.set(this.tearX, this.tearZ, this.tearRadius, tear);
        const [front, distance] = this.flare(time);
        u.flare.value = front;
        u.flareFront.value = distance;
        const [clearSky, still] = this.clearSky(time);
        u.clearSky.value = clearSky;
        u.still.value = still;
        return {
            breaking, tear, flare: this.flareGlow(time), clearSky, still,
        };
    }

    /** Forget what has run its course (in place: no allocation). */
    prune(time) {
        keep(this.gaps, time, gapAlive);
        keep(this.trails, time, trailAlive);
        keep(this.pulses, time, pulseAlive);
    }
}
