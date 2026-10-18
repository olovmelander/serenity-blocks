/**
 * Grainfields — the event language's state (CPU, three-free): what each gameplay event does to the
 * sky, the light and the wind in the grain, as numbers the world writes into its uniforms.
 *
 *  - A lock tears a small gap in the deck and a sunbeam stands in the barley beside the card, on
 *    the side of the board the piece fell (its column across the free field, its row as distance:
 *    the floor near, the top far). The gap rides with the deck, so the beam walks across the field
 *    with the wind aloft. A hard drop tears a wider one and presses a ring of wind out through the
 *    stalks from where the beam lands.
 *  - A clear sends a trail of wind running out across the field from the eye's feet, laying the
 *    grain over in a lane and carrying the cleared rows' colours as glinting chaff; more lines, a
 *    wider and stronger lane (two lanes for four).
 *  - A chain breaks the storm open (the deck thins step by step, the light lifts, the wind
 *    rises); when the chain ends the deck closes again over TIMING.breakOut.
 *  - A T-spin sets the wind wheeling in the stand where the piece fell (a whirl in the barley).
 *  - Four lines tear the sky open over Lapporten and a front of light runs out of the gate over
 *    the fields toward the eye.
 *  - A perfect clear clears the whole sky and stills the wind; the deck returns after a while.
 *  - Back-to-back makes every beam wider and brighter, the wind stronger.
 *
 * Positions on the field come from the caller's `aim(x, y, distance)`: the screen point (fractions,
 * y down) the world turns into the ground point at that distance along that screen column.
 */
import {
    DECK, EYE, TIMING, clamp, clamp01, hexToLinear, smooth,
} from './grainfields-core.js';
import { boardFor, boardPoint, cardUnion } from './grainfields-composition.js';

/** Table sizes (the shaders' GAPS, TRAILS, PULSES). */
export const MAX_GAPS = 12;
export const MAX_TRAILS = 6;
export const MAX_PULSES = 6;

/**
 * How fast a lock's beam walks over the field (metres per second, along the wind aloft's way):
 * slowly, so it stands where the piece fell for most of its life (the deck itself runs at ~10 m/s,
 * which would sweep a beam forty metres out across a quarter of the frame in a second).
 */
export const BEAM_DRIFT = Object.freeze([-0.47, -0.16]);

/** Pulse kinds: a ring of wind outward, a whirl round a centre, a wave across the whole field. */
export const PULSE = Object.freeze({ ring: 0, whirl: 1, wave: 2 });

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

const linear = (hex) => (typeof hex === 'string' ? hexToLinear(hex) : [1, 0.86, 0.6]);

export class GrainfieldsReactions {
    constructor() {
        this.reset();
    }

    reset() {
        /** Lock gaps: { x, z (deck-fixed), radius, at, rgb, power, beam } */
        this.gaps = [];
        /** Wind trails: { x, z, at, power, hx, hz, curl, width, rgb, side } */
        this.trails = [];
        /** Pulses: { x, z, at, power, kind, speed, width } */
        this.pulses = [];
        this.combo = 0;
        this.b2b = 0;
        this.breakFrom = 0;
        this.breakTo = 0;
        this.breakAt = -1e6;
        this.tearAt = -1e6;
        this.tearX = 0;
        this.tearZ = 0;
        this.flareAt = -1e6;
        this.perfectAt = -1e6;
        this.trailSide = 1;
        this.lastLockAt = -1e6;
    }

    // ── Events ──────────────────────────────────────────────────────────────────────

    /**
     * A lock: `aim(x, y, distance)` → [x, y, z] the ground point; `deck` → { drift: [x, z],
     * sunDir: [x, y, z] } for where the beam's gap is torn.
     */
    lock(c, time, { layout, aim, deck }) {
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
        const radius = beamRadius(distance, hard, this.b2b);
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
        };
        this.gaps.push(gap);
        while (this.gaps.length > MAX_GAPS) this.gaps.shift();
        if (hard) {
            const fall = clamp((Number(c?.distance) || 6) / 16, 0.3, 1.4);
            this.addPulse({
                x: ground[0], z: ground[2], at: time, power: 0.75 * fall, kind: PULSE.ring, speed: 16, width: 5,
            });
        }
        return gap;
    }

    /** A clear: its lane of wind from the eye's feet out over the field. */
    clear(c, time, { layout, aim }) {
        const lines = clamp(Math.round(Number(c?.lines) || 1), 1, 4);
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
            this.trails.push({
                x: start[0],
                z: start[2],
                at: time + k * 0.35,
                power: 0.55 + 0.15 * lines,
                hx: hx / len,
                hz: hz / len,
                curl: side * (0.00012 + 0.00005 * lines),
                width: 3 + 2.2 * lines + 1.5 * this.b2b,
                rgb,
                side,
            });
        }
        while (this.trails.length > MAX_TRAILS) this.trails.shift();
        if (c?.tspin) {
            const g = aim(freeColumn(layout, c?.player || 0, 0.5 + 0.35 * this.trailSide), 0.75, 42);
            if (g) {
                this.addPulse({
                    x: g[0], z: g[2], at: time, power: 1, kind: PULSE.whirl, speed: 9, width: 14,
                });
            }
        }
        if (lines >= 4) this.quad(time);
        if (c?.perfect) this.perfect(time);
    }

    /** Four lines: the tear over the gate and the front of light. */
    quad(time) {
        this.tearAt = time;
        this.flareAt = time + 0.6;
    }

    perfect(time) {
        this.perfectAt = time;
    }

    /** The true combo: a chain of two or more breaks the storm open, step by step. */
    setCombo(n, time) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next === this.combo) return;
        this.breakFrom = this.breaking(time);
        this.breakTo = next >= 2 ? clamp(0.3 + 0.16 * (next - 2), 0.3, 0.9) : 0;
        this.breakAt = time;
        this.combo = next;
    }

    setB2B(level) {
        this.b2b = clamp(Math.round(Number(level) || 0), 0, 4);
    }

    /** A level-up: a wave of wind across the whole field. */
    levelUp(time) {
        this.addPulse({
            x: EYE.x, z: EYE.z - 900, at: time, power: 0.9, kind: PULSE.wave, speed: 34, width: 60,
        });
    }

    addPulse(p) {
        this.pulses.push(p);
        while (this.pulses.length > MAX_PULSES) this.pulses.shift();
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

    /** How far a lock's beam has walked since its gap tore (metres, world xz). */
    static gapShift(gap, time) {
        const age = Math.max(0, time - gap.at);
        return [BEAM_DRIFT[0] * age, BEAM_DRIFT[1] * age];
    }

    /** A lock gap's opening (0..1): it tears open over gapOpen and closes by gapLife. */
    static gapStrength(gap, time) {
        const age = time - gap.at;
        if (age < 0) return 0;
        return smooth(0, TIMING.gapOpen, age) * (1 - smooth(TIMING.gapLife * 0.45, TIMING.gapLife, age)) * gap.power;
    }

    /** The tear over the gate (0..1). */
    tear(time) {
        const age = time - this.tearAt;
        return smooth(0, TIMING.tearIn, age) * (1 - smooth(TIMING.tearLife * 0.5, TIMING.tearLife, age));
    }

    /** The front of light from the gate: (strength 0..1, metres from it). */
    flare(time) {
        const age = time - this.flareAt;
        if (age < 0 || age > 9) return [0, 0];
        return [smooth(0, 0.4, age) * (1 - smooth(5, 9, age)), age * 2100];
    }

    /** A perfect clear's clear sky (0..1) and the stillness of the wind (0..1). */
    clearSky(time) {
        const age = time - this.perfectAt;
        const s = smooth(0, 2.5, age) * (1 - smooth(TIMING.clearHold, TIMING.clearHold + TIMING.clearReturn, age));
        return [s, s];
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
            u.tables.trails[n * 3].set(tr.x, tr.z, tr.at, tr.power);
            u.tables.trails[n * 3 + 1].set(tr.hx, tr.hz, tr.curl, tr.width);
            u.tables.trails[n * 3 + 2].set(tr.rgb[0], tr.rgb[1], tr.rgb[2], tr.side);
            n += 1;
        }
        u.trailCount.value = n;
        n = 0;
        for (let i = 0; i < this.pulses.length && n < MAX_PULSES; i++) {
            const p = this.pulses[i];
            u.tables.pulses[n * 2].set(p.x, p.z, p.at, p.power);
            u.tables.pulses[n * 2 + 1].set(p.kind, p.speed, p.width, 0);
            n += 1;
        }
        u.pulseCount.value = n;
        const breaking = this.breaking(time);
        u.breaking.value = breaking;
        const tear = this.tear(time);
        u.tear.value.set(this.tearX, this.tearZ, 2600, tear);
        const [flare, front] = this.flare(time);
        u.flare.value = flare;
        u.flareFront.value = front;
        const [clearSky, still] = this.clearSky(time);
        u.clearSky.value = clearSky;
        u.still.value = still;
        return {
            breaking, tear, flare, clearSky, still,
        };
    }

    /** Forget what has run its course. */
    prune(time) {
        this.gaps = this.gaps.filter((g) => time - g.at < TIMING.gapLife);
        this.trails = this.trails.filter((tr) => time - tr.at < 8);
        this.pulses = this.pulses.filter((p) => time - p.at < 10);
    }
}
