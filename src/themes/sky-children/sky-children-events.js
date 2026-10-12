/**
 * Sky Children — Irisfall: the event effects, in closed form (three-free).
 *
 * Every visible beat of a lock or a clear is a record in a preallocated ring: when it began, where
 * from and where to, its colour. Each frame `emit(time, push)` evaluates every live record at
 * `time` and pushes its lights (sky-children-fx.js glows): nothing is integrated, so seeking to any
 * time and replaying reproduces the frame exactly, and nothing is allocated at event time.
 *
 *   lock     0.00 a light-copy of the piece just outside the card's edge at its rows, in its locked
 *                orientation, white-hot, cooling to its colour by 0.12
 *            0.12 the four cells melt into beads that run together
 *            0.24 a thread of light-water springs out: a head and its droplets on a glistening arc
 *                 to the pool that will hold the colour
 *            land a crown of glints at the pool (the world rings the pool and fills it)
 *   drop     no melt: the cells fire at once as a straight jet (0.12 s), an afterglow along it, a
 *            double crown
 *   sheet    a cleared row leaves the card's side as a short sheet of light-water at its height:
 *            shot outward, then falling into the Deep
 *   crown    glints thrown up and falling back (landings, splashes)
 */
import { clamp01, smooth } from './sky-children-core.js';
import { unproject } from './sky-children-frame.js';

export const LOCK = Object.freeze({
    cool: 0.12, melt: 0.24, flight: 0.85, jet: 0.2, afterglow: 0.5, droplets: 20, lag: 0.007, shock: 0.55, sparks: 10,
});
/** The landing: a ring over the pool and a pillar of the colour standing up out of it. */
export const LANDING = Object.freeze({ ring: 0.7, pillar: 0.9 });
/** Where a lock's sparks may fly (beside the HUD they keep off it). */
export const SPARKS = Object.freeze({
    round: 0, vertical: 1, up: 2, down: 3,
});
const RING = 5;
const GLINT = 3;
const STREAK = 4;
const SOFT = 6;

/** A uniform Catmull-Rom point between p1 and p2 (p0, p3 their neighbours), one axis. */
const catmull = (p0, p1, p2, p3, u) => 0.5 * ((2 * p1) + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
    + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
export const CROWN_LIFE = 0.6;
export const SHEET_LIFE = 1.9;
/** The pour's gravity (m/s²), quicker than true gravity so it reads as falling from here. */
const SHEET_G = 26;
const G = 9.81;

function makeRing(n, make) {
    return { items: Array.from({ length: n }, make), next: 0 };
}

function take(ring) {
    const r = ring.items[ring.next];
    ring.next = (ring.next + 1) % ring.items.length;
    return r;
}

const v3 = () => [0, 0, 0];

/** A quadratic Bézier point. */
function bez(a, c, b, t, out) {
    const u = 1 - t;
    for (let i = 0; i < 3; i++) out[i] = u * u * a[i] + 2 * u * t * c[i] + t * t * b[i];
    return out;
}

export class EventEffects {
    /**
     * @param {object} sizes  { threads, droplets, crowns, sheets }
     */
    constructor({
        threads = 12, droplets = LOCK.droplets, crowns = 16, sheets = 48,
    } = {}) {
        this.droplets = droplets;
        this.locks = makeRing(threads, () => ({
            at: -1e4,
            from: v3(),
            ctrl: v3(),
            to: v3(),
            colour: [1, 1, 1],
            cells: new Float32Array(8),
            hasCells: false,
            right: v3(),
            up: v3(),
            cell: 1,
            hard: false,
            flight: LOCK.flight,
            landed: true,
            pool: -1,
            silent: false,
            narrow: false,
            sparks: 0,
            sx: [0, 0, 0],
            sy: [0, 0, 0],
            d0: 40,
            d1: 400,
            via: false,
            pts: new Float32Array(12),
            cum: new Float32Array(6),
            npts: 0,
            total: 0,
        }));
        /** The camera model the threads are drawn through (screen-space arcs). */
        this.cam = null;
        this.crowns = makeRing(crowns, () => ({
            at: -1e4, pos: v3(), colour: [1, 1, 1], count: 12, size: 1, speed: 6, flash: false,
        }));
        this.sheets = makeRing(sheets, () => ({
            at: -1e4, from: v3(), dir: v3(), colour: [1, 1, 1], length: 10, speed: 30, size: 1,
        }));
        this.landings = [];
        /** Threads displaced from the ring while still in flight: they land at once (their pool
         * still takes the colour). Preallocated, reused. */
        this.forced = Array.from({ length: threads }, () => ({
            pool: -1, colour: [1, 1, 1], to: v3(), hard: false, used: false,
        }));
        this.scratch = { p: v3(), q: v3() };
    }

    reset() {
        this.forced.forEach((f) => { f.used = false; });
        [this.locks, this.crowns, this.sheets].forEach((ring) => ring.items.forEach((r) => { r.at = -1e4; }));
        this.locks.items.forEach((r) => { r.landed = true; });
    }

    /** The camera model the threads' screen-space arcs are unprojected through. */
    setCamera(cam) {
        this.cam = cam;
    }

    /**
     * A lock's light: from a point outside the card (world, and its frame position `fromScreen`),
     * its cells laid in the plane of the screen (`right`, `up` world units per cell), to a pool's
     * world position (frame position `toScreen`). The thread flies a clean arc ON SCREEN (a world
     * path between a near point and a far one would leap across the frame in its first tenth),
     * its distance growing geometrically so its beads shrink as it goes.
     * Returns the landing time (when the pool should take the colour).
     */
    lock(at, {
        from, to, right, up, cells = null, cellSize = 1, colour, hardDrop = false, flight = LOCK.flight, lift = 0.1,
        pool = -1, fromScreen = null, toScreen = null, viaScreen = null, sparks = SPARKS.round,
    }) {
        const r = take(this.locks);
        if (!r.landed && r.pool >= 0) {
            const f = this.forced.find((x) => !x.used);
            if (f) {
                f.used = true;
                f.pool = r.pool;
                f.hard = r.hard;
                for (let i = 0; i < 3; i++) { f.colour[i] = r.colour[i]; f.to[i] = r.to[i]; }
            }
        }
        r.at = at;
        // Where the sparks may fly: all round, or (beside the HUD) only up and down, up, or down.
        r.sparks = sparks;
        r.narrow = sparks === SPARKS.vertical;
        r.pool = pool;
        if (fromScreen && toScreen) {
            r.sx[0] = fromScreen[0]; r.sy[0] = fromScreen[1];
            r.sx[2] = toScreen[0]; r.sy[2] = toScreen[1];
            r.sx[1] = (fromScreen[0] + toScreen[0]) / 2;
            r.sy[1] = Math.min(fromScreen[1], toScreen[1]) - (hardDrop ? 0 : lift);
            r.d0 = Math.hypot(from[0], from[1], from[2]);
            r.d1 = Math.hypot(to[0], to[1], to[2]);
            r.via = Boolean(viaScreen);
            r.npts = 0;
            if (viaScreen) {
                // Round the HUD: one smooth curve (Catmull-Rom) through the copy, the waypoints past
                // the HUD, the arc's crest and the pool, run at an even pace along its length.
                const { pts } = r;
                let m = 0;
                const add = (x, y) => {
                    pts[m * 2] = x;
                    pts[m * 2 + 1] = y;
                    m += 1;
                };
                add(fromScreen[0], fromScreen[1]);
                for (let i = 0; i + 1 < viaScreen.length && m < 4; i += 2) add(viaScreen[i], viaScreen[i + 1]);
                const lx = pts[(m - 1) * 2];
                const ly = pts[(m - 1) * 2 + 1];
                add((lx + toScreen[0]) / 2, Math.min(ly, toScreen[1]) - (hardDrop ? 0.02 : lift * 0.6));
                add(toScreen[0], toScreen[1]);
                r.npts = m;
                r.cum[0] = 0;
                for (let i = 1; i < m; i++) {
                    r.cum[i] = r.cum[i - 1] + Math.hypot((pts[i * 2] - pts[i * 2 - 2]) * 1.78, pts[i * 2 + 1] - pts[i * 2 - 1]);
                }
                r.total = r.cum[m - 1];
            }
        } else {
            r.d0 = -1;
        }
        r.hard = hardDrop;
        r.flight = hardDrop ? LOCK.jet : flight;
        for (let i = 0; i < 3; i++) {
            r.from[i] = from[i];
            r.to[i] = to[i];
            r.right[i] = right[i] * cellSize;
            r.up[i] = up[i] * cellSize;
            r.colour[i] = colour[i];
        }
        r.hasCells = Array.isArray(cells) || cells instanceof Float32Array;
        if (r.hasCells) for (let i = 0; i < 8; i++) r.cells[i] = cells[i];
        // The arc's control point: over the middle, lifted by a share of the distance.
        const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        for (let i = 0; i < 3; i++) r.ctrl[i] = (from[i] + to[i]) / 2;
        r.ctrl[1] += hardDrop ? 0 : d * lift;
        r.landed = false;
        r.cell = cellSize;
        return at + (hardDrop ? LOCK.jet : LOCK.melt + flight);
    }

    crown(at, pos, colour, {
        count = 12, size = 1, speed = 6, flash = false,
    } = {}) {
        const r = take(this.crowns);
        r.at = at;
        for (let i = 0; i < 3; i++) { r.pos[i] = pos[i]; r.colour[i] = colour[i]; }
        r.count = count;
        r.size = size;
        r.speed = speed;
        r.flash = flash;
    }

    /** A row's sheet off one side of the card: `dir` the outward unit vector (world). */
    sheet(at, from, dir, colour, { length = 12, speed = 26, size = 0.9 } = {}) {
        const r = take(this.sheets);
        r.at = at;
        for (let i = 0; i < 3; i++) { r.from[i] = from[i]; r.dir[i] = dir[i]; r.colour[i] = colour[i]; }
        r.length = length;
        r.speed = speed;
        r.size = size;
    }

    /**
     * Push every live light at `time`. push(x, y, z, radius, r, g, b, shape, mx, my, mz, stretch).
     */
    emit(time, push) {
        const { p, q } = this.scratch;
        // ── Locks ──
        for (const r of this.locks.items) {
            const age = time - r.at;
            const life = Math.max(LOCK.shock, r.hard ? LOCK.jet + LOCK.afterglow : LOCK.melt + r.flight + 0.05);
            if (age < 0 || age > life) continue;
            const [cr, cg, cb] = r.colour;
            if (age < LOCK.shock) {
                // The shock: a ring of the piece's light running out from the copy, and sparks
                // thrown off it, slowing, falling a little.
                const k = age / LOCK.shock;
                const grow = 1 - (1 - k) ** 3;
                const ringB = (1 - k) ** 2 * (r.hard ? 1.6 : 1.1);
                push(
                    r.from[0],
                    r.from[1],
                    r.from[2],
                    r.cell * (0.9 + (r.hard ? 2.0 : 1.4) * grow * (r.narrow ? 0.6 : 1)),
                    (cr * 0.7 + 0.3) * ringB,
                    (cg * 0.7 + 0.3) * ringB,
                    (cb * 0.7 + 0.3) * ringB,
                    RING,
                );
                const sparks = r.hard ? LOCK.sparks * 2 : LOCK.sparks;
                const sb = (1 - k) ** 2 * 5;
                for (let j = 0; j < sparks; j++) {
                    const jitter = (((j * 0.618 + r.at) % 1) - 0.5);
                    let a = (j / sparks) * Math.PI * 2 + r.at * 7.3;
                    if (r.sparks === SPARKS.vertical) a = (j % 2 ? 1 : -1) * (Math.PI / 2 + jitter * 0.7);
                    else if (r.sparks === SPARKS.up) a = Math.PI / 2 + jitter * 2.2;
                    else if (r.sparks === SPARKS.down) a = -Math.PI / 2 + jitter * 2.2;
                    const g = r.sparks === SPARKS.up ? 0 : 1;
                    const v = r.cell * (5 + 4 * ((j * 0.618 + r.at) % 1)) * (r.hard ? 1.4 : 1);
                    const go = (v * (1 - Math.exp(-age * 6))) / 6;
                    const sx = Math.cos(a) * go;
                    const sy = Math.sin(a) * go - 0.5 * r.cell * 12 * age * age * g;
                    const x = r.from[0] + (r.right[0] * sx + r.up[0] * sy) / r.cell;
                    const y = r.from[1] + (r.right[1] * sx + r.up[1] * sy) / r.cell;
                    const z = r.from[2] + (r.right[2] * sx + r.up[2] * sy) / r.cell;
                    push(x, y, z, r.cell * 0.32, (cr * 0.5 + 0.5) * sb, (cg * 0.5 + 0.5) * sb, (cb * 0.5 + 0.5) * sb, GLINT);
                }
            }
            if (!r.hard && age < LOCK.melt) {
                // The copy: white-hot cooling to the colour, then melting into beads.
                const cool = smooth(0, LOCK.cool, age);
                const melt = smooth(LOCK.cool, LOCK.melt, age);
                const heat = 3 * (1 - cool) + 1.6 * cool;
                const wr = (1 - cool) + cr * cool;
                const wg = (1 - cool) + cg * cool;
                const wb = (1 - cool) + cb * cool;
                const n = r.hasCells ? 4 : 1;
                for (let k = 0; k < n; k++) {
                    const cx = r.hasCells ? r.cells[k * 2] * (1 - melt * 0.7) : 0;
                    const cy = r.hasCells ? r.cells[k * 2 + 1] * (1 - melt * 0.7) : 0;
                    const x = r.from[0] + r.right[0] * cx + r.up[0] * cy;
                    const y = r.from[1] + r.right[1] * cx + r.up[1] * cy;
                    const z = r.from[2] + r.right[2] * cx + r.up[2] * cy;
                    const rad = r.cell * (0.55 - melt * 0.2);
                    push(x, y, z, rad, wr * heat, wg * heat, wb * heat, melt > 0.5 ? 0 : 2);
                }
                continue;
            }
            // The thread (or the jet): a ribbon of light-water — a thin hot core streaked bead to
            // bead (each streak reaches past the next, so it is one line at any distance) inside a
            // soft halo, tapering to its tail; a teardrop head with a glint; droplets let go of
            // the tail.
            const start = r.hard ? 0 : LOCK.melt;
            const t = age - start;
            if (t < 0 || (!r.hard && t > r.flight + 0.05)) continue;
            const head = clamp01(t / r.flight);
            const n = (r.hard ? this.droplets * 3 : this.droplets * 2);
            const fade = r.hard ? 1 - smooth(LOCK.jet, LOCK.jet + LOCK.afterglow, age) : 1;
            for (let k = 0; k < n; k++) {
                const s = r.hard ? head * (1 - k / n) : clamp01((t - k * LOCK.lag) / r.flight);
                if (s <= 0) continue;
                if (s >= 1 && !r.hard) continue;
                this.pathAt(r, s, p);
                const sNext = r.hard ? head * (1 - (k + 1) / n) : clamp01((t - (k + 1) * LOCK.lag) / r.flight);
                this.pathAt(r, Math.max(0, sNext), q);
                const dx = q[0] - p[0];
                const dy = q[1] - p[1];
                const dz = q[2] - p[2];
                const gap = Math.hypot(dx, dy, dz);
                const k01 = k / n;
                const taper = (1 - k01) ** 1.5;
                if (k === 0) {
                    // The head: a teardrop leaning back along its path, and its glint.
                    push(p[0], p[1], p[2], r.cell * 0.7, cr * 6 * fade, cg * 6 * fade, cb * 6 * fade, STREAK, dx, dy, dz, 2.4);
                    push(
                        p[0],
                        p[1],
                        p[2],
                        r.cell * 1.7,
                        (cr * 0.4 + 0.6) * 2.6 * fade,
                        (cg * 0.4 + 0.6) * 2.6 * fade,
                        (cb * 0.4 + 0.6) * 2.6 * fade,
                        GLINT,
                    );
                    continue;
                }
                // The core: thin, hot, a little whiter than the colour.
                const core = r.cell * (r.hard ? 0.32 : 0.2) * (0.45 + 0.55 * taper);
                const stretch = (gap / (2 * core)) * 1.6 + 1;
                const hb = (r.hard ? 4.6 : 3.4) * taper * fade;
                push(p[0], p[1], p[2], core, (cr * 0.7 + 0.3) * hb, (cg * 0.7 + 0.3) * hb, (cb * 0.7 + 0.3) * hb, STREAK, dx, dy, dz, stretch);
                // The halo: soft and dim round it (every other bead is enough).
                if (k % 2 === 1) {
                    const halo = Math.max(r.cell * 0.62 * (0.4 + 0.6 * taper), gap * 1.6);
                    const ab = 0.7 * taper * fade * Math.min(1, (r.cell * 0.62) / halo + 0.25);
                    push(p[0], p[1], p[2], halo, cr * ab, cg * ab, cb * ab, SOFT);
                }
                if (k % 6 === 4 && k01 > 0.45) {
                    // A droplet let go of the tail, falling away.
                    const dt = k * LOCK.lag;
                    const fall = 0.5 * G * dt * dt;
                    push(p[0], p[1] - fall, p[2], r.cell * 0.22, cr * 2 * fade, cg * 2 * fade, cb * 2 * fade, 0);
                } else if (k % 5 === 2) {
                    // A sparkle shed from the thread, twinkling as it hangs.
                    const tw = 0.5 + 0.5 * Math.sin(time * 40 + k * 2.1);
                    const sb = 2.2 * tw * (1 - k01) * fade;
                    push(
                        p[0] + r.up[0] * 0.6,
                        p[1] + r.up[1] * 0.6 - k01 * r.cell,
                        p[2] + r.up[2] * 0.6,
                        r.cell * 0.28,
                        (cr * 0.5 + 0.5) * sb,
                        (cg * 0.5 + 0.5) * sb,
                        (cb * 0.5 + 0.5) * sb,
                        GLINT,
                    );
                }
            }
        }
        // ── Crowns (and a landing's ring and pillar) ──
        for (const r of this.crowns.items) {
            const age = time - r.at;
            if (age < 0 || age > (r.flash ? Math.max(CROWN_LIFE, LANDING.pillar) : CROWN_LIFE)) continue;
            if (r.flash) {
                const kp = clamp01(age / LANDING.pillar);
                if (kp < 1) {
                    // The pillar: a slim column of the colour standing up out of the pool, its base
                    // brightest (stacked soft glows: a streak this thin vanishes at distance).
                    const rise = r.size * 34 * (0.3 + 0.7 * smooth(0, 0.35, kp));
                    const pb = (1 - kp) ** 1.3 * smooth(0, 0.06, age) * 1.8;
                    const steps = 9;
                    for (let j = 0; j < steps; j++) {
                        const f = j / (steps - 1);
                        const w = r.size * 0.62 * (1 - f * 0.55) * (1 - kp * 0.35);
                        const b = pb * (1 - f * 0.8) * (j === 0 ? 1.6 : 1);
                        push(r.pos[0], r.pos[1] + rise * f, r.pos[2], w, r.colour[0] * b, r.colour[1] * b, r.colour[2] * b, SOFT);
                    }
                }
                if (age > CROWN_LIFE) continue;
            }
            const fade = 1 - smooth(CROWN_LIFE * 0.4, CROWN_LIFE, age);
            for (let k = 0; k < r.count; k++) {
                const a = (k / r.count) * Math.PI * 2 + r.at * 3.1;
                const v = r.speed * (0.7 + 0.3 * ((k * 0.618) % 1));
                const x = r.pos[0] + Math.cos(a) * v * 0.4 * age;
                const z = r.pos[2] + Math.sin(a) * v * 0.4 * age;
                const y = r.pos[1] + v * age - 0.5 * G * age * age;
                const b = 3.2 * fade;
                push(x, y, z, r.size * 0.5, r.colour[0] * b, r.colour[1] * b, r.colour[2] * b, 3);
            }
        }
        // ── Sheets: a cleared row's light poured off the card's side: a stream of light-water
        //    leaving the edge over a fraction of a second, each bead on its own ballistic arc,
        //    so together they draw one curving ribbon out and down into the Deep ──
        for (const r of this.sheets.items) {
            const age = time - r.at;
            if (age < 0 || age > SHEET_LIFE) continue;
            const [cr, cg, cb] = r.colour;
            // The flash where the row leaves the card.
            if (age < 0.3) {
                const fb = (1 - age / 0.3) ** 2 * 3.2;
                push(r.from[0], r.from[1], r.from[2], r.size * 2.4, cr * fb, cg * fb, cb * fb, 0);
            }
            const drops = 26;
            let px = r.from[0];
            let py = r.from[1];
            let pz = r.from[2];
            for (let k = 0; k < drops; k++) {
                const a = age - k * 0.018;
                if (a < 0) break;
                // Out along the row with drag, a little lift, then curling over and down (a pour,
                // faster than true gravity: at this distance true gravity reads as drifting).
                const out = (r.speed * 0.55 * (1 - Math.exp(-a * 2.2))) / 2.2;
                const x = r.from[0] + r.dir[0] * out;
                const z = r.from[2] + r.dir[2] * out;
                const y = r.from[1] + 1.2 * a - 0.5 * SHEET_G * a * a;
                const fade = 1 - smooth(0.9, 1.4, a);
                if (fade <= 0) {
                    px = x; py = y; pz = z;
                    continue;
                }
                const mx = px - x;
                const my = py - y;
                const mz = pz - z;
                const gap = k === 0 ? 0 : Math.hypot(mx, my, mz);
                const size = r.size * (0.5 - 0.22 * (k / drops));
                const b = 2.8 * fade * (k === 0 ? 1.4 : 1);
                if (k === 0) {
                    push(x, y, z, size * 1.2, cr * b, cg * b, cb * b, 0);
                } else {
                    // A streak reaching back past the bead before it: one unbroken pour; a white
                    // core in a soft halo of the colour.
                    const stretch = (gap / (2 * size)) * 1.6 + 1;
                    push(x, y, z, size, (cr * 0.6 + 0.4) * b, (cg * 0.6 + 0.4) * b, (cb * 0.6 + 0.4) * b, STREAK, mx, my, mz, stretch);
                    if (k % 2 === 0) push(x, y, z, Math.max(size * 1.8, gap * 1.4), cr * b * 0.3, cg * b * 0.3, cb * b * 0.3, SOFT);
                }
                if (k % 4 === 1) {
                    // Glints riding the ribbon, and a bead let go below it.
                    const tw = 0.5 + 0.5 * Math.sin(time * 37 + k * 1.9 + r.at * 11);
                    push(
                        x,
                        y,
                        z,
                        size * 0.9,
                        (cr * 0.5 + 0.5) * 2.4 * fade * tw,
                        (cg * 0.5 + 0.5) * 2.4 * fade * tw,
                        (cb * 0.5 + 0.5) * 2.4 * fade * tw,
                        3,
                    );
                    const dt = Math.max(0, a - 0.15);
                    push(x, y - 0.5 * G * dt * dt, z, size * 0.4, cr * b * 0.6, cg * b * 0.6, cb * b * 0.6, 0);
                }
                px = x; py = y; pz = z;
            }
        }
    }

    /** A point of a lock's thread at s (0..1): on its screen arc when it has one, else in the world. */
    pathAt(r, s, out) {
        if (r.d0 > 0 && this.cam) {
            let x;
            let y;
            if (r.via && r.npts > 1) {
                const L = clamp01(s) * r.total;
                let i = 0;
                while (i < r.npts - 2 && r.cum[i + 1] < L) i += 1;
                const seg = Math.max(1e-6, r.cum[i + 1] - r.cum[i]);
                const u = clamp01((L - r.cum[i]) / seg);
                const P = r.pts;
                const i0 = Math.max(0, i - 1);
                const i3 = Math.min(r.npts - 1, i + 2);
                x = catmull(P[i0 * 2], P[i * 2], P[(i + 1) * 2], P[i3 * 2], u);
                y = catmull(P[i0 * 2 + 1], P[i * 2 + 1], P[(i + 1) * 2 + 1], P[i3 * 2 + 1], u);
            } else {
                const t = s;
                const u = 1 - t;
                x = u * u * r.sx[0] + 2 * u * t * r.sx[1] + t * t * r.sx[2];
                y = u * u * r.sy[0] + 2 * u * t * r.sy[1] + t * t * r.sy[2];
            }
            unproject(x, y, this.cam, out);
            const d = r.d0 * (r.d1 / r.d0) ** s;
            out[0] *= d; out[1] *= d; out[2] *= d;
            return out;
        }
        return bez(r.from, r.ctrl, r.to, s, out);
    }

    /** Locks that have landed since the last call: [{ record }] (the world fills their pools). */
    landed(time, out = this.landings) {
        out.length = 0;
        for (const f of this.forced) {
            if (!f.used) continue;
            f.used = false;
            out.push(f);
        }
        for (const r of this.locks.items) {
            if (r.landed) continue;
            const land = r.at + (r.hard ? LOCK.jet : LOCK.melt + r.flight);
            if (time >= land) {
                r.landed = true;
                out.push(r);
            }
        }
        return out;
    }
}
