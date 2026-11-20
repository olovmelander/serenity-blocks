/**
 * Murmuration — the light play sends through the flock (three-free).
 *
 * Every event used to be the same instrument: a hairline ring in the simulation, gone in two
 * frames. Each now has a FRONT of its own shape, drawn by the mote shader from one small table:
 *
 *   ring      a puff where a piece came to rest (in the piece's colour)
 *   chevron   the bow wave a hard drop throws up and out from where it landed
 *   beam      a ray of light from a cleared row out through both wings of the flock, each
 *             line's ray at its own height — one row, one ray, so two lines are two and four
 *             are four
 *   answer    the same rays coming back in from the frame's edges (a back-to-back)
 *   pinwheel  thin arms unwinding out of a twist and turning
 *
 * A front is a line that moves: a mote it reaches flares in the front's colour, banks, and
 * glows on behind it for FRONT_AFTERGLOW seconds, so the eye is given a band to follow.
 *
 * This class owns the table's JS side. A front's rows are a closed form of its age, so nothing
 * here keeps a timer: `update(time)` ages the fronts on the show's clock, packs the live ones
 * to the head of the rows the shader loops over, and frees those that are spent.
 *
 *   A = (x, y, age, kind)   B = (speed, width, reach, light)   C = (r, g, b, shape)
 *   D = (dx, dy, glow, wake)  a beam's direction on the right of the board (mirrored on the
 *                           left), how long a mote glows on behind the front (seconds) and how
 *                           bright that glow is beside the crest (0..1)
 *
 * x, y are world units from the swarm's focal point, on the focal plane.
 */

export const MAX_FRONTS = 10;
export const FRONT_ROWS = 4;
export const FRONT = Object.freeze({
    ring: 1, beam: 2, answer: 3, chevron: 4, pinwheel: 5,
});
/** How long a mote glows on once a front has passed it (seconds), unless the front says otherwise. */
export const FRONT_AFTERGLOW = 0.3;
/** How far a pinwheel's arms wind (radians an e-fold): open, so they read as arms and not rings. */
export const SPIRAL_WIND = 1.25;

const WHITE = Object.freeze([1, 0.97, 0.93]);

function createFront() {
    return {
        live: false,
        kind: 0,
        x: 0,
        y: 0,
        at: 0,
        speed: 0,
        width: 0.3,
        reach: 6,
        light: 0,
        r: 1,
        g: 1,
        b: 1,
        shape: 1,
        dx: 1,
        dy: 0,
        glow: FRONT_AFTERGLOW,
        wake: 0.5,
        life: 1,
        attack: 0.04,
        now: 0,
    };
}

export class FrontTable {
    /**
     * @param {{ rows?: Array<{ set: Function }>|null, count?: { value: number }|null }} [target]
     *   the renderer's `frontRows` and its `uFrontCount` uniform; without them the table only
     *   keeps its own state (tests, a torn-down swarm)
     */
    constructor(target = {}) {
        this.rows = target.rows || null;
        this.count = target.count || null;
        this.fronts = Array.from({ length: MAX_FRONTS }, createFront);
        this.live = 0;
        this.time = 0;
    }

    /** Point the table at a (new) renderer's rows. */
    attach(rows, count) {
        this.rows = rows || null;
        this.count = count || null;
    }

    /**
     * Send a front.
     * @param {{
     *   kind: number, x?: number, y?: number, speed?: number, width?: number, reach?: number,
     *   light?: number, rgb?: ArrayLike<number>|null, shape?: number, life?: number,
     *   attack?: number, delay?: number, angle?: number, glow?: number, wake?: number,
     * }} spec `speed` world units a second; `width` the crest's half-width; `reach` how far it
     *   runs; `light` its strength (1 = a clear's beam); `shape` the kind's own number (a ring's
     *   squash, a beam's half-thickness, a pinwheel's arms, signed by the way they turn); `life`
     *   seconds; `delay` seconds before it starts; `angle` a beam's climb (radians above level);
     *   `glow` seconds a mote glows on behind the front, `wake` how bright (0..1).
     */
    add(spec) {
        if (!spec || !(spec.kind > 0) || !(spec.light > 0)) return null;
        const start = this.time + Math.max(0, spec.delay || 0);
        // A free slot; failing that the front with the least light left.
        let slot = null;
        let faintest = Infinity;
        for (let i = 0; i < this.fronts.length; i += 1) {
            const f = this.fronts[i];
            if (!f.live) { slot = f; break; }
            if (f.now < faintest) { faintest = f.now; slot = f; }
        }
        const rgb = spec.rgb || WHITE;
        slot.live = true;
        slot.kind = spec.kind;
        slot.x = Number(spec.x) || 0;
        slot.y = Number(spec.y) || 0;
        slot.at = start;
        slot.speed = Number(spec.speed) || 0;
        slot.width = Math.max(0.02, spec.width ?? 0.3);
        slot.reach = Math.max(0.1, spec.reach ?? 6);
        slot.light = spec.light;
        slot.r = rgb[0]; slot.g = rgb[1]; slot.b = rgb[2];
        slot.shape = spec.shape ?? 1;
        slot.dx = Math.cos(spec.angle || 0);
        slot.dy = Math.sin(spec.angle || 0);
        slot.glow = Math.max(0.02, spec.glow ?? FRONT_AFTERGLOW);
        slot.wake = Math.max(0, Math.min(1, spec.wake ?? 0.5));
        slot.life = Math.max(0.05, spec.life ?? 1);
        slot.attack = Math.max(0.001, spec.attack ?? 0.04);
        slot.now = spec.light;
        return slot;
    }

    /** A front's light at `age`: a quick rise, then a fall over the last two fifths of its life. */
    static envelope(front, age) {
        if (!(age >= 0) || age >= front.life) return 0;
        const rise = Math.min(1, age / front.attack);
        const k = Math.max(0, Math.min(1, (age - front.life * 0.6) / (front.life * 0.4)));
        return front.light * rise * (1 - k * k * (3 - 2 * k));
    }

    /** Age every front to `time`, free the spent ones and write the live ones to the rows. */
    update(time) {
        this.time = time;
        const { rows } = this;
        let live = 0;
        for (let i = 0; i < this.fronts.length; i += 1) {
            const f = this.fronts[i];
            if (!f.live) continue;
            const age = time - f.at;
            if (age >= f.life) {
                f.live = false;
                f.now = 0;
                continue;
            }
            if (age < 0) continue; // waiting for its moment
            f.now = FrontTable.envelope(f, age);
            if (rows) {
                const base = live * FRONT_ROWS;
                rows[base].set(f.x, f.y, age, f.kind);
                rows[base + 1].set(f.speed, f.width, f.reach, f.now);
                rows[base + 2].set(f.r, f.g, f.b, f.shape);
                rows[base + 3].set(f.dx, f.dy, f.glow, f.wake);
            }
            live += 1;
        }
        this.live = live;
        if (this.count) this.count.value = live;
        return live;
    }

    /** How many fronts are alive or waiting. */
    pending() {
        let n = 0;
        for (let i = 0; i < this.fronts.length; i += 1) if (this.fronts[i].live) n += 1;
        return n;
    }

    clear() {
        for (let i = 0; i < this.fronts.length; i += 1) {
            this.fronts[i].live = false;
            this.fronts[i].now = 0;
        }
        this.live = 0;
        if (this.count) this.count.value = 0;
    }
}
