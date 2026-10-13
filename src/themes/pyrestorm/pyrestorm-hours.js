/**
 * Pyrestorm — the watches of the night (three-free).
 *
 * Five palettes of the sky, the air, the ash and the lightning, in hue order along a line from an
 * ember dusk to a steel dawn: ember dusk (crimson afterglow behind the volcano) → magenta night →
 * violet night → indigo deep night → steel dawn (a rose glow rising on the right). The wheel walks
 * there and back along that line (dusk … dawn … dusk), so no mix ever crosses the colour wheel
 * through grey.
 *
 * The wheel's place = clock / TIMING.watch + the levels gained. The clock alone turns it (a watch
 * every 100 s, resting 15 % of each step at either end so every palette is really seen); a
 * level-up steps it forward from wherever the last turn was headed, eased over TIMING.levelTurn.
 * A new run starts at level 1 without moving the light.
 */
import {
    TIMING, clamp, lerp, smooth,
} from './pyrestorm-core.js';

export const WATCHES = Object.freeze([
    Object.freeze({
        name: 'ember dusk',
        zenith: [0.011, 0.006, 0.02],
        horizon: [0.038, 0.013, 0.02],
        dusk: [0.15, 0.03, 0.022],
        duskBearing: -0.62,
        haze: [0.045, 0.017, 0.02],
        ambient: [0.03, 0.016, 0.024],
        ash: [0.17, 0.15, 0.145],
        bolt: [2.3, 1.7, 2.7],
        fire: [1.0, 0.33, 0.07],
        stars: 0.35,
        lavaHeat: 1.0,
        hazeDensity: 1.1,
    }),
    Object.freeze({
        name: 'magenta night',
        zenith: [0.011, 0.004, 0.021],
        horizon: [0.03, 0.01, 0.03],
        dusk: [0.06, 0.012, 0.04],
        duskBearing: -0.5,
        haze: [0.033, 0.012, 0.03],
        ambient: [0.022, 0.011, 0.028],
        ash: [0.16, 0.145, 0.155],
        bolt: [2.3, 1.45, 2.9],
        fire: [1.0, 0.31, 0.08],
        stars: 0.6,
        lavaHeat: 1.04,
        hazeDensity: 1.0,
    }),
    Object.freeze({
        name: 'violet night',
        zenith: [0.006, 0.004, 0.02],
        horizon: [0.018, 0.013, 0.04],
        dusk: [0.022, 0.013, 0.045],
        duskBearing: 0.0,
        haze: [0.021, 0.014, 0.035],
        ambient: [0.014, 0.012, 0.03],
        ash: [0.15, 0.145, 0.16],
        bolt: [1.9, 1.65, 3.1],
        fire: [1.0, 0.34, 0.085],
        stars: 0.9,
        lavaHeat: 1.08,
        hazeDensity: 0.95,
    }),
    Object.freeze({
        name: 'indigo deep night',
        zenith: [0.002, 0.003, 0.014],
        horizon: [0.008, 0.012, 0.035],
        dusk: [0.007, 0.013, 0.035],
        duskBearing: 0.3,
        haze: [0.012, 0.014, 0.03],
        ambient: [0.008, 0.01, 0.024],
        ash: [0.14, 0.14, 0.155],
        bolt: [1.5, 1.85, 3.1],
        fire: [1.0, 0.37, 0.09],
        stars: 1.0,
        lavaHeat: 1.12,
        hazeDensity: 0.9,
    }),
    Object.freeze({
        name: 'steel dawn',
        zenith: [0.012, 0.02, 0.05],
        horizon: [0.05, 0.055, 0.095],
        dusk: [0.13, 0.055, 0.065],
        duskBearing: 0.62,
        haze: [0.055, 0.055, 0.085],
        ambient: [0.05, 0.055, 0.08],
        ash: [0.19, 0.185, 0.19],
        bolt: [1.85, 2.1, 2.9],
        fire: [1.0, 0.38, 0.1],
        stars: 0.12,
        lavaHeat: 0.94,
        hazeDensity: 1.15,
    }),
]);

const KEYS = ['zenith', 'horizon', 'dusk', 'haze', 'ambient', 'ash', 'bolt', 'fire'];
const SCALARS = ['duskBearing', 'stars', 'lavaHeat', 'hazeDensity'];
/** The walk: dusk → dawn → dusk (eight steps round). */
export const WALK = Object.freeze([0, 1, 2, 3, 4, 3, 2, 1]);

/** A light record the world reuses (no allocation per frame). */
export function createWatchLight() {
    const L = {
        place: 0, from: 0, to: 0, mix: 0,
    };
    for (const k of KEYS) L[k] = [0, 0, 0];
    for (const k of SCALARS) L[k] = 0;
    return L;
}

/** Rest shares at each end of a step: the displayed fraction of a raw fraction. */
export function restEase(f, rest = TIMING.watchRest) {
    return smooth(rest, 1 - rest, f);
}

/** The light at a place on the wheel (place 0 = ember dusk, 4 = steel dawn, 8 = dusk again). */
export function watchAt(place, out = createWatchLight()) {
    const p = Number.isFinite(place) ? Math.max(0, place) : 0;
    const step = Math.floor(p);
    const frac = restEase(p - step);
    const from = WALK[step % WALK.length];
    const to = WALK[(step + 1) % WALK.length];
    const A = WATCHES[from];
    const B = WATCHES[to];
    for (const k of KEYS) {
        for (let c = 0; c < 3; c++) out[k][c] = lerp(A[k][c], B[k][c], frac);
    }
    for (const k of SCALARS) out[k] = lerp(A[k], B[k], frac);
    out.place = p;
    out.from = from;
    out.to = to;
    out.mix = frac;
    return out;
}

/**
 * The wheel: the clock turns it; a level-up steps it forward from where the last turn was
 * headed (never back to a level's "own" place: after a long run, level 2 must not turn the night
 * back hours); a new run keeps the light where it is.
 */
export class WatchWheel {
    constructor() {
        this.reset();
    }

    reset() {
        this.offsetFrom = 0;
        this.offsetTo = 0;
        this.turnAt = -1e6;
        this.lastLevel = 1;
    }

    /** The levels gained so far as an eased offset at `time`. */
    offset(time) {
        const k = smooth(0, TIMING.levelTurn, time - this.turnAt);
        return lerp(this.offsetFrom, this.offsetTo, k);
    }

    /** The wheel's raw place at `time`. */
    place(time) {
        return Math.max(0, time) / TIMING.watch + this.offset(time);
    }

    levelUp(level, time, instant = false) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        const gained = n - this.lastLevel;
        this.lastLevel = n;
        if (gained <= 0) return;
        if (instant) {
            this.offsetTo += gained;
            this.offsetFrom = this.offsetTo;
            this.turnAt = -1e6;
            return;
        }
        this.offsetFrom = this.offset(time);
        this.offsetTo += gained;
        this.turnAt = time;
    }

    /** A new run starts on level 1; the night stays where it is. */
    newRun() {
        this.lastLevel = 1;
    }

    /** The run is on this level now (a step down never turns the night back). */
    setLevel(level) {
        this.lastLevel = Math.max(1, Math.round(Number(level) || 1));
    }

    exportState() {
        return {
            offsetFrom: this.offsetFrom, offsetTo: this.offsetTo, turnAt: this.turnAt, lastLevel: this.lastLevel,
        };
    }

    importState(s) {
        if (!s) return;
        this.offsetFrom = clamp(s.offsetFrom, 0, 1e6);
        this.offsetTo = clamp(s.offsetTo, 0, 1e6);
        this.turnAt = Number.isFinite(s.turnAt) ? s.turnAt : -1e6;
        this.lastLevel = Math.max(1, Math.round(s.lastLevel) || 1);
    }
}
