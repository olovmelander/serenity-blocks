/**
 * Chromadelic Highway — what the planets show of play (docs/CHROMADELIC_HIGHWAY_PLANET_EVENTS_2026-10.md).
 *
 * "The board is the sun": the key light sits at the highway core behind the card, so every lit
 * limb faces the board. When the board sends light out (a clear, a quad, a level-up, a back-to-back,
 * a perfect clear, a T-spin, a deep cascade), a shell of that light runs out to the bodies and
 * washes over each one as a FRONT: an arc of the event's colour that crosses the lit face from the
 * point under the key to the terminator, flares the limb and leaves the day side glowing in its
 * colour for a moment. It reaches the hero first and the ringed ice giant a beat later, and it
 * crosses the giant's ring too. A quad's and a perfect clear's front is a prism (the spectrum
 * across its width), like the arches it turns.
 *
 * The hero's storm is LIGHTNING CELLS: soft flashes inside the cloud bands on the night side, each
 * a couple of strokes. A clear fires one per line; the storm the heat of play builds keeps firing
 * them between clears (a fever is a constant flicker). Under Reduce flashing a cell is one soft glow.
 *
 * Everything here accumulates like the rest of the theme: a newcomer never cuts a stronger live
 * front (it folds into the youngest one instead), and every value is a closed form of the event's
 * birth, so a seek replays it. Three-free: the world writes the numbers into the planets' uniforms.
 */

/** Front slots per body (planets shader reads this many). */
export const PLANET_FRONT_SLOTS = 3;
/** Lightning cells on the hero. */
export const LIGHTNING_SLOTS = 4;
/**
 * The light shell from the board, in world units per second: the hero (about 2200 u from the key)
 * catches it ~0.16 s after the clear, the ice giant (about 3900 u) ~0.28 s.
 */
export const FRONT_SPEED = 14000;
/** A front born within this of a live one adds to it (one clear's beats are one front). */
const FOLD_GAP = 0.1;
/** A full pool keeps a live front holding more than this share of a newcomer's light. */
const KEEP_SHARE = 0.5;
/** Fronts are spent after this long (the slowest afterglow is gone). */
const FRONT_LIFE = 4;
/** Lightning cells are spent after this long. */
const CELL_LIFE = 1.4;
/** A free front slot. */
const IDLE_A = Object.freeze([9, 1, 0, 0]);

export const FRONT_DEFAULTS = Object.freeze({
    amp: 1.2, // peak light of the band (scene-linear multiple of the event colour)
    width: 0.1, // the band's half-width in key-cosine units (the lit face the eye sees spans ~0.9)
    sweep: 1.5, // key-cosine units per second: a front crosses the lit face in ~0.8 s
    tau: 0.7, // the afterglow's decay
    after: 0.28, // the afterglow's share of the band
    prism: 0, // 1: the spectrum across the band's width
    rise: 0.05, // seconds to full light
});

/** Deterministic 0..1 sequence for a seed (mulberry32): seeks replay the same lightning. */
export function seededRandom(seed) {
    let a = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class PlanetEvents {
    constructor() {
        this.fronts = new Array(PLANET_FRONT_SLOTS).fill(null);
        this.cells = new Array(LIGHTNING_SLOTS).fill(null);
        this.cellSeq = 0;
        this.stormClock = 0;
        /** Reduce flashing: fronts rise slowly and burn at 60 %, lightning is one soft glow. */
        this.calm = false;
    }

    reset() {
        this.fronts.fill(null);
        this.cells.fill(null);
        this.cellSeq = 0;
        this.stormClock = 0;
    }

    // ── Fronts ───────────────────────────────────────────────────────────────

    /** The light a front still holds `age` seconds after its birth (band + afterglow, at the hero). */
    frontLight(f, time) {
        const age = time - f.birth;
        if (age < 0) return f.amp;
        if (age > FRONT_LIFE) return 0;
        return f.amp * (Math.exp(-age / 1.1) + f.after * Math.exp(-age / f.tau));
    }

    /**
     * Send a front out of the board at `time`. A free slot first; a front born within FOLD_GAP
     * takes the newcomer's light (it brightens, widens and, if the newcomer is stronger, takes its
     * colour); a full pool gives up its weakest front only when that one is mostly spent next to
     * the newcomer, else the newcomer folds into the youngest. Returns the front carrying the light.
     */
    front(opts, time) {
        const p = { ...FRONT_DEFAULTS, ...opts };
        if (this.calm) {
            p.amp *= 0.6;
            p.rise = Math.max(p.rise, 0.25);
        }
        const rgb = p.rgb ? { r: p.rgb.r, g: p.rgb.g, b: p.rgb.b } : { r: 1, g: 1, b: 1 };
        let free = -1;
        let youngest = -1;
        let weakest = -1;
        let weakestE = Infinity;
        for (let i = 0; i < this.fronts.length; i++) {
            const f = this.fronts[i];
            const e = f ? this.frontLight(f, time) : 0;
            if (!f || e < 0.01) {
                if (free < 0) free = i;
                continue;
            }
            if (youngest < 0 || f.birth > this.fronts[youngest].birth) youngest = i;
            if (e < weakestE) {
                weakestE = e;
                weakest = i;
            }
        }
        if (youngest >= 0 && Math.abs(time - this.fronts[youngest].birth) < FOLD_GAP) {
            return this.fold(this.fronts[youngest], p, rgb, time);
        }
        let i = free;
        if (i < 0 && weakestE < KEEP_SHARE * p.amp) i = weakest;
        if (i < 0) return this.fold(this.fronts[youngest], p, rgb, time);
        this.fronts[i] = {
            birth: time,
            amp: p.amp,
            width: p.width,
            sweep: p.sweep,
            tau: p.tau,
            after: p.after,
            prism: p.prism,
            rise: p.rise,
            rgb,
        };
        return this.fronts[i];
    }

    /** Add a newcomer's light to a live front (it never drops; it keeps its birth and place). */
    fold(f, p, rgb, time) {
        const e = this.frontLight(f, time);
        if (p.amp > e) {
            f.rgb = rgb;
            f.prism = Math.max(f.prism, p.prism);
        } else {
            const k = p.amp / (e + p.amp);
            f.rgb = {
                r: f.rgb.r + (rgb.r - f.rgb.r) * k,
                g: f.rgb.g + (rgb.g - f.rgb.g) * k,
                b: f.rgb.b + (rgb.b - f.rgb.b) * k,
            };
        }
        f.amp = Math.min(f.amp + p.amp * 0.7, 3.2);
        f.width = Math.max(f.width, p.width);
        f.tau = Math.max(f.tau, p.tau);
        return f;
    }

    /**
     * Write one body's front uniforms for the frame.
     * @param {number} time
     * @param {number} delay   seconds the light takes to reach this body (distance / FRONT_SPEED)
     * @param {number} extent  the body's reach in its own radii (1; a ringed body its ring's outer edge)
     * @param {Array<{a: {set: Function}, c: {set: Function}}>} out  per-slot Vector4 pairs
     */
    writeFronts(time, delay, extent, out) {
        for (let i = 0; i < out.length; i++) {
            const f = this.fronts[i];
            const age = f ? time - f.birth - delay : -1;
            if (!f || age <= 0 || age > FRONT_LIFE) {
                out[i].a.set(IDLE_A[0], IDLE_A[1], IDLE_A[2], IDLE_A[3]);
                out[i].c.set(0, 0, 0, 0);
                continue;
            }
            // The band starts just off the body on the key's side and runs away from the key. Over
            // a ring (beyond the globe) it runs twice as fast and at full light, so the globe
            // catches it a beat after the ring, not a second later; it fades from the globe on.
            const ringRun = Math.max(0, extent - 1);
            const tRing = ringRun / (2 * f.sweep);
            const s = age < tRing
                ? extent + 1.5 * f.width - age * 2 * f.sweep
                : 1 + 1.5 * f.width - (age - tRing) * f.sweep;
            const rise = Math.min(1, age / f.rise);
            const onGlobe = Math.max(0, age - tRing);
            const band = f.amp * rise * Math.exp(-onGlobe / 1.1);
            const after = f.amp * f.after * rise * Math.exp(-onGlobe / f.tau);
            out[i].a.set(s, 1 / Math.max(0.02, f.width), band, f.prism);
            out[i].c.set(f.rgb.r, f.rgb.g, f.rgb.b, after);
        }
    }

    // ── Lightning ────────────────────────────────────────────────────────────

    /**
     * Fire a lightning cell at `time`: a free slot, else the one closest to done. Its place on the
     * night side is picked the first frame it is drawn (the hero's current light), from its serial.
     */
    strike(time, { amp = 1, size = 0.1 } = {}) {
        let slot = -1;
        let oldest = -1;
        for (let i = 0; i < this.cells.length; i++) {
            const c = this.cells[i];
            if (!c || time - c.birth > CELL_LIFE) {
                slot = i;
                break;
            }
            if (oldest < 0 || c.birth < this.cells[oldest].birth) oldest = i;
        }
        if (slot < 0) slot = oldest;
        const seq = this.cellSeq++;
        const rand = seededRandom(seq * 31 + 7);
        this.cells[slot] = {
            birth: time,
            amp,
            size: size * (0.8 + 0.4 * rand()),
            seq,
            dir: null,
            // Two or three strokes, the later ones weaker (a cloud-to-cloud flash flickers).
            strokes: [0, 0.05 + 0.07 * rand(), 0.15 + 0.12 * rand()],
            third: rand() < 0.6,
        };
        return this.cells[slot];
    }

    /** One cell's light `age` seconds after its strike (`flicker` 0 under Reduce flashing). */
    cellLight(c, age, flicker = 1) {
        if (age < 0 || age > CELL_LIFE) return 0;
        let strokes = 0;
        const weights = [1, 0.75, c.third ? 0.55 : 0];
        for (let k = 0; k < 3; k++) {
            const a = age - c.strokes[k];
            if (a >= 0) strokes += weights[k] * Math.exp(-a / 0.035);
        }
        const glow = 0.28 * Math.exp(-age / 0.3);
        const soft = 0.45 * Math.min(1, age / 0.15) * Math.exp(-age / 0.45);
        return c.amp * (flicker * (Math.min(strokes, 1.4) + glow) + (1 - flicker) * soft);
    }

    /**
     * The storm between clears: cells at `rate` per second (closed-form accumulator on the world
     * clock, so a seek that replays the same deltas fires the same cells).
     */
    rumble(rate, delta, time) {
        if (!(rate > 0) || !(delta > 0)) return 0;
        this.stormClock += rate * delta;
        let fired = 0;
        while (this.stormClock >= 1) {
            this.stormClock -= 1;
            const r = seededRandom(this.cellSeq * 13 + 3);
            this.strike(time, { amp: 0.45 + 0.4 * r(), size: 0.08 });
            fired += 1;
        }
        return fired;
    }

    /**
     * Resolve the cells for the frame: each new cell takes its place from `pickSite(rand)` (a unit
     * vector in the hero's own frame, or null when there is no place yet), then its light.
     * @returns {Array<{dir: object|null, size: number, light: number}>}
     */
    resolveCells(time, flicker, pickSite) {
        return this.cells.map((c) => {
            if (!c) return null;
            if (!c.dir && pickSite) c.dir = pickSite(seededRandom(c.seq * 7 + 1));
            return { dir: c.dir, size: c.size, light: this.cellLight(c, time - c.birth, flicker) };
        });
    }
}
