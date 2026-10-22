/**
 * Painted Ages — the event tables and the motes (what gameplay does to the land and the air).
 *
 * Renderer-light: the tables are plain {x, y, z, w} rows the shared uniforms read (the land's
 * shader lights them); the motes are one instanced billboard mesh whose instances are written once
 * when spawned and then move in closed form on the GPU (no per-frame CPU work).
 *
 *  - Ribbons (locks): a bed lights up where the piece "landed" and the light runs along it across
 *    every hill the bed crosses. Row 0 (origin x, origin z, geological height, start time),
 *    row 1 (rgb, power), row 2 (half-thickness of the bed in metres, speed m/s, reach m, kind).
 *  - Waves (clears, level-ups, four lines): a band of geological height climbs through the whole
 *    land. Row 0 (g at start, climb m/s, start time, power), row 1 (rgb, half-width).
 * The motes (pigment dust, sparks, rain, a dust devil) are in painted-ages-motes.js.
 */
import { RIBBONS, WAVES } from './painted-ages-tsl.js';

/** Keep a table's live rows at the front: rows of `stride` vec4s, `alive(i)` true to keep. */
function compact(rows, stride, count, alive) {
    let w = 0;
    for (let r = 0; r < count; r++) {
        if (!alive(r)) continue;
        if (w !== r) for (let k = 0; k < stride; k++) rows[w * stride + k].copy(rows[r * stride + k]);
        w++;
    }
    for (let r = w; r < count; r++) for (let k = 0; k < stride; k++) rows[r * stride + k].set(0, 0, 0, 0);
    return w;
}

/**
 * What a row still has to give at `now`: its power times the share of its life still ahead (a row
 * scheduled ahead of `now` has all of it). A full table gives up its faintest row rather than
 * simply its oldest, so a chain's earlier bands keep climbing while a quad's tide joins them.
 */
function energyAt(start, end, power, now) {
    if (now <= start) return power;
    const span = end - start;
    if (!(span > 0)) return 0;
    return power * Math.max(0, (end - now) / span);
}

export class EventTables {
    constructor(u) {
        this.u = u;
        this.ribbonCount = 0;
        this.waveCount = 0;
        this.ribbonLife = new Float64Array(RIBBONS);
        this.waveLife = new Float64Array(WAVES);
        this.ribbonStart = new Float64Array(RIBBONS);
        this.waveStart = new Float64Array(WAVES);
        this.ribbonPower = new Float64Array(RIBBONS);
        this.wavePower = new Float64Array(WAVES);
        /** The latest time the tables were told of (update(), or a row added). */
        this.now = -Infinity;
    }

    reset() {
        const { tables } = this.u;
        for (const row of tables.ribbons) row.set(0, 0, 0, 0);
        for (const row of tables.waves) row.set(0, 0, 0, 0);
        this.ribbonCount = 0;
        this.waveCount = 0;
        this.u.ribbonCount.value = 0;
        this.u.waveCount.value = 0;
        this.now = -Infinity;
    }

    /** Light a bed: origin (x, z), its geological height g, colour, power, and how it runs. */
    addRibbon({
        x, z, g, time, rgb, power = 1, half = 1.1, speed = 170, reach = 900, kind = 0, life = 3.2,
    }) {
        const rows = this.u.tables.ribbons;
        if (this.ribbonCount >= RIBBONS) {
            this.dropFaintest(rows, 3, 'ribbonCount', this.ribbonStart, this.ribbonLife, this.ribbonPower, time);
        }
        const i = this.ribbonCount++;
        rows[i * 3].set(x, z, g, time);
        rows[i * 3 + 1].set(rgb[0], rgb[1], rgb[2], power);
        rows[i * 3 + 2].set(half, speed, reach, kind);
        this.ribbonStart[i] = time;
        this.ribbonLife[i] = time + life;
        this.ribbonPower[i] = power;
        this.u.ribbonCount.value = this.ribbonCount;
    }

    /** A band of light climbing the strata from g0 at `climb` m/s. */
    addWave({
        g0, climb = 60, time, power = 1, rgb, half = 2.4, life = 4,
    }) {
        const rows = this.u.tables.waves;
        if (this.waveCount >= WAVES) {
            this.dropFaintest(rows, 2, 'waveCount', this.waveStart, this.waveLife, this.wavePower, time);
        }
        const i = this.waveCount++;
        rows[i * 2].set(g0, climb, time, power);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], half);
        this.waveStart[i] = time;
        this.waveLife[i] = time + life;
        this.wavePower[i] = power;
        this.u.waveCount.value = this.waveCount;
    }

    /**
     * The table is full: the row with the least left to give goes (a row added a little ahead of
     * time is judged at the present, never at its own start).
     */
    dropFaintest(rows, stride, key, starts, lives, powers, time) {
        const now = Number.isFinite(this.now) ? Math.min(this.now, time) : time;
        let faintest = 0;
        let least = Infinity;
        for (let i = 0; i < this[key]; i++) {
            const left = energyAt(starts[i], lives[i], powers[i], now);
            if (left < least) {
                least = left;
                faintest = i;
            }
        }
        lives[faintest] = -1;
        this[key] = compactTable(rows, stride, this[key], starts, lives, powers, (i) => i !== faintest);
    }

    /** Retire what has run its course. */
    update(time) {
        this.now = time;
        const rib = this.u.tables.ribbons;
        const before = this.ribbonCount;
        const ribbonLive = (i) => this.ribbonLife[i] > time;
        const { ribbonStart, ribbonLife, ribbonPower } = this;
        this.ribbonCount = compactTable(rib, 3, before, ribbonStart, ribbonLife, ribbonPower, ribbonLive);
        if (before !== this.ribbonCount) this.u.ribbonCount.value = this.ribbonCount;
        const wav = this.u.tables.waves;
        const wb = this.waveCount;
        const waveLive = (i) => this.waveLife[i] > time;
        this.waveCount = compactTable(wav, 2, wb, this.waveStart, this.waveLife, this.wavePower, waveLive);
        if (wb !== this.waveCount) this.u.waveCount.value = this.waveCount;
    }
}

/** compact(), moving each row's start, end and power with it. */
function compactTable(rows, stride, count, starts, lives, powers, alive) {
    let w = 0;
    for (let r = 0; r < count; r++) {
        if (!alive(r)) continue;
        if (w !== r) {
            for (let k = 0; k < stride; k++) rows[w * stride + k].copy(rows[r * stride + k]);
            starts[w] = starts[r];
            lives[w] = lives[r];
            powers[w] = powers[r];
        }
        w++;
    }
    for (let r = w; r < count; r++) {
        for (let k = 0; k < stride; k++) rows[r * stride + k].set(0, 0, 0, 0);
        lives[r] = -1;
    }
    return w;
}

export { compact };

export { MOTE_KIND, Motes } from './painted-ages-motes.js';
