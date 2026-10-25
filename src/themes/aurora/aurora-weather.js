/**
 * Sky weather: where along each arc the display is awake.
 *
 * A real display is never one even curtain. Stretches of an arc flare into tall, sharp,
 * coloured rays while the rest of it glows as a quiet, smooth band, and the activity wanders
 * along the arcs. Each resting arc carries WEATHER.slots activity cells (aurora-field.js),
 * which the march sums at every sample to decide how bright, how rayed, how tall and how
 * coloured the curtain is there:
 *
 *   ambient   the first WEATHER.ambient cells per arc wander on their own. Each lives one
 *             cycle of its own period: born at a hashed place in view, it swells, drifts
 *             and fades, then comes back somewhere else. They are a pure function of the
 *             weather clock, so the sky replays exactly and draws on no random stream.
 *   event     the rest answer play. A hit near a cell still lit JOINS it (a Swell: it adds,
 *             it never restarts), so quick play builds one blazing stretch instead of
 *             flickering many; a cell may spread (a clear's front running out along the
 *             arc) and drift (a surge carrying its light along the sky).
 *
 * A cell's `tops` colours the tall rays where it stands: above zero the red oxygen crown,
 * below zero the blue-violet of sunlit ray tops.
 *
 * Plain numbers: no three, no DOM, no timers.
 */
import { Swell } from '../shared/swell.js';
import { AURORA_ARCS, CORONA_ARC_INDEX, WEATHER } from './aurora-field.js';
import { hash2 } from './aurora-noise.js';

const RESTING_ARCS = AURORA_ARCS.filter((arc) => arc.index !== CORONA_ARC_INDEX);
/** Seconds of weather each ambient cell lives, per arc and slot: no common beat. */
const AMBIENT_PERIODS = [43, 29, 37, 53, 61, 31];
/** Ambient cells are born within this view azimuth of straight ahead, radians. */
const AMBIENT_REACH = 0.8;
/** How far an ambient cell wanders over its life, radians at most. */
const AMBIENT_WANDER = 0.3;
/** Bearings stop short of the arc's ends, where it runs into the horizon. */
const BEARING_LIMIT = 1.45;
/** A cell is never narrower or wider than this, radians of half-width. */
const MIN_WIDTH = 0.04;
const MAX_WIDTH = 1.4;
/** Seconds a cell's spread takes to ease off (1/e). */
const SPREAD_EASE = 1.1;
/** A travelling cell may run this far along its arc, radians: just past where it leaves view. */
const TRAVEL_LIMIT = 1.55;
/**
 * Each resting arc's folds deepen and relax on their own slow beat (seconds of weather),
 * so an arc is sometimes a nearly straight band and sometimes a deep S; never in step.
 */
const FOLD_PERIODS = [97, 131, 113];
const FOLD_BREATH = 0.42;
/** Below this an event cell is free for the next hit. */
const SPENT = 0.02;
/** A hit this recent still holds its cell, though its light may not have arrived. */
const HOLD = 0.4;
/** Cells moving at bearing rates this close (rad/s) may join. */
const SAME_PACE = 0.12;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};

/** Bearing along an arc under a view azimuth, held short of the arc's ends. */
export function bearingForAzimuth(arc, azimuth) {
    return clamp(azimuth - arc.angle, -BEARING_LIMIT, BEARING_LIMIT);
}

export class AuroraWeather {
    constructor() {
        /** What the march reads: per arc, WEATHER.slots × [bearing, 1/width, strength, tops]. */
        this.cells = new Float32Array(AURORA_ARCS.length * WEATHER.slots * 4);
        /** Per arc, how deep its folds run against its resting sway (the corona's stay 1). */
        this.folds = new Float32Array(AURORA_ARCS.length).fill(1);
        this.events = [];
        for (const arc of RESTING_ARCS) {
            for (let slot = WEATHER.ambient; slot < WEATHER.slots; slot += 1) {
                this.events.push({
                    row: arc.index,
                    slot,
                    swell: new Swell({
                        attack: 0.16, release: 2.8, ceiling: 1.3, knee: 0.85,
                    }),
                    level: 0,
                    bearing: 0,
                    pace: 0,
                    width: 0.1,
                    spread: 0,
                    tops: 0,
                    lastHit: -Infinity,
                    lastAmount: 0,
                });
            }
        }
        this.reset();
    }

    reset() {
        this.time = 0;
        /** Runs faster as the storm builds, so the weather turns over quicker in hot play. */
        this.clock = 0;
        /** How stirred up the sky is (0 calm … 1 substorm): ambient cells swell with it. */
        this.vigour = 0;
        for (const cell of this.events) {
            cell.swell.reset();
            cell.level = 0;
            cell.lastHit = -Infinity;
            cell.lastAmount = 0;
            cell.spread = 0;
            cell.pace = 0;
        }
        this.cells.fill(0);
        this.paint();
    }

    /** What is left of an event cell, counting a hit whose light is still on its way. */
    remaining(cell) {
        return Math.max(cell.level, this.time - cell.lastHit < HOLD ? cell.lastAmount : 0);
    }

    /**
     * Wake a stretch of an arc around `bearing` (radians), `width` wide (half-width, radians).
     * `spread` (rad/s, easing off) widens it, `pace` (rad/s, steady) carries it along the arc
     * and `tops` colours its tall rays. A hit where a cell is still lit, moving the same way,
     * joins that cell; otherwise it takes a free cell, or the faintest. Allocates nothing.
     */
    wake(row, bearing, width, amount, spread = 0, pace = 0, tops = 0, delay = 0) {
        if (!(amount > 0) || !Number.isFinite(bearing) || !Number.isFinite(width)) return false;
        const at = this.time + Math.max(0, delay);
        const centre = clamp(bearing, -BEARING_LIMIT, BEARING_LIMIT);
        const reach = clamp(width, MIN_WIDTH, MAX_WIDTH);
        let chosen = null;
        let weakest = Infinity;
        let fallback = null;
        for (const cell of this.events) {
            if (cell.row !== row) continue;
            const left = this.remaining(cell);
            if (left > SPENT
                && Math.abs(cell.bearing - centre) < cell.width + reach * 0.5
                && Math.abs(cell.pace - pace) < SAME_PACE) {
                chosen = cell;
                break;
            }
            if (left < weakest) {
                weakest = left;
                fallback = cell;
            }
        }
        if (!fallback && !chosen) return false;
        if (chosen) {
            // Join: the cell leans toward the new hit by its share of the light.
            const share = amount / (this.remaining(chosen) + amount);
            chosen.bearing += (centre - chosen.bearing) * share * 0.5;
            chosen.width = Math.max(chosen.width, reach);
            chosen.spread = Math.max(chosen.spread, spread);
            chosen.pace += (pace - chosen.pace) * share;
            chosen.tops += (tops - chosen.tops) * share;
        } else {
            chosen = fallback;
            chosen.swell.reset();
            chosen.level = 0;
            chosen.bearing = centre;
            chosen.width = reach;
            chosen.spread = spread;
            chosen.pace = pace;
            chosen.tops = tops;
        }
        chosen.swell.hit(amount, at);
        chosen.lastHit = at;
        chosen.lastAmount = Math.min(1.3, amount);
        return true;
    }

    /** Advance by `dt` seconds; `vigour` (0…1) is how stirred up the sky is. */
    update(dt, vigour = 0) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.vigour = clamp(Number.isFinite(vigour) ? vigour : 0, 0, 1);
        this.time += step;
        this.clock += step * (1 + this.vigour * 1.2);
        for (const cell of this.events) {
            cell.level = cell.swell.valueAt(this.time);
            // A cell moves once its light has arrived, and only while it lasts.
            if (cell.level <= 0) continue;
            cell.bearing = clamp(cell.bearing + cell.pace * step, -TRAVEL_LIMIT, TRAVEL_LIMIT);
            cell.width = Math.min(MAX_WIDTH, cell.width + cell.spread * step);
            cell.spread *= Math.exp(-step / SPREAD_EASE);
        }
        this.paint();
    }

    /**
     * One ambient cell, from the weather clock alone: born at a hashed bearing in view, it
     * swells over the first quarter of its cycle, wanders, and fades over the last third.
     */
    ambient(arc, slot, out, offset) {
        const n = arc.index * WEATHER.ambient + slot;
        const period = AMBIENT_PERIODS[n % AMBIENT_PERIODS.length];
        const u = this.clock / period + ((n * 0.618 + 0.29) % 1);
        const cycle = Math.floor(u);
        const f = u - cycle;
        const h = (k) => hash2(cycle, n * 7 + k, 0x5eed);
        const life = smoothstep(0, 0.24, f) * (1 - smoothstep(0.62, 1, f));
        const azimuth = (h(0) * 2 - 1) * AMBIENT_REACH + (h(1) * 2 - 1) * AMBIENT_WANDER * f;
        const width = 0.09 + h(2) * 0.17;
        const strength = life * (0.5 + h(3) * 0.55) * (1 + this.vigour * 0.6);
        // Most cells lean clearly one way: red-crowned or violet-topped.
        const lean = h(4) * 2 - 1;
        out[offset] = bearingForAzimuth(arc, azimuth);
        out[offset + 1] = 1 / width;
        out[offset + 2] = strength;
        out[offset + 3] = Math.sign(lean) * Math.sqrt(Math.abs(lean));
    }

    /** Pack every cell, and each arc's fold depth, for the march. */
    paint() {
        const { cells } = this;
        for (const arc of RESTING_ARCS) {
            const period = FOLD_PERIODS[arc.index % FOLD_PERIODS.length];
            this.folds[arc.index] = 1 + FOLD_BREATH * Math.sin((this.clock / period + arc.index * 0.37) * Math.PI * 2);
            for (let slot = 0; slot < WEATHER.ambient; slot += 1) {
                this.ambient(arc, slot, cells, (arc.index * WEATHER.slots + slot) * 4);
            }
        }
        for (const cell of this.events) {
            const o = (cell.row * WEATHER.slots + cell.slot) * 4;
            cells[o] = cell.bearing;
            cells[o + 1] = 1 / cell.width;
            cells[o + 2] = cell.level;
            cells[o + 3] = cell.tops;
        }
    }

    getDiagnostics() {
        return {
            clock: this.clock,
            vigour: this.vigour,
            liveEvents: this.events.filter((cell) => cell.level > SPENT).length,
        };
    }
}
