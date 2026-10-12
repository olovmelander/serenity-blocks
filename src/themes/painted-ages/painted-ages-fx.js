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

export class EventTables {
    constructor(u) {
        this.u = u;
        this.ribbonCount = 0;
        this.waveCount = 0;
        this.ribbonLife = new Float64Array(RIBBONS);
        this.waveLife = new Float64Array(WAVES);
    }

    reset() {
        const { tables } = this.u;
        for (const row of tables.ribbons) row.set(0, 0, 0, 0);
        for (const row of tables.waves) row.set(0, 0, 0, 0);
        this.ribbonCount = 0;
        this.waveCount = 0;
        this.u.ribbonCount.value = 0;
        this.u.waveCount.value = 0;
    }

    /** Light a bed: origin (x, z), its geological height g, colour, power, and how it runs. */
    addRibbon({
        x, z, g, time, rgb, power = 1, half = 1.1, speed = 170, reach = 900, kind = 0, life = 3.2,
    }) {
        const rows = this.u.tables.ribbons;
        if (this.ribbonCount >= RIBBONS) this.dropOldest(rows, 3, 'ribbonCount', this.ribbonLife);
        const i = this.ribbonCount++;
        rows[i * 3].set(x, z, g, time);
        rows[i * 3 + 1].set(rgb[0], rgb[1], rgb[2], power);
        rows[i * 3 + 2].set(half, speed, reach, kind);
        this.ribbonLife[i] = time + life;
        this.u.ribbonCount.value = this.ribbonCount;
    }

    /** A band of light climbing the strata from g0 at `climb` m/s. */
    addWave({
        g0, climb = 60, time, power = 1, rgb, half = 2.4, life = 4,
    }) {
        const rows = this.u.tables.waves;
        if (this.waveCount >= WAVES) this.dropOldest(rows, 2, 'waveCount', this.waveLife);
        const i = this.waveCount++;
        rows[i * 2].set(g0, climb, time, power);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], half);
        this.waveLife[i] = time + life;
        this.u.waveCount.value = this.waveCount;
    }

    dropOldest(rows, stride, key, lives) {
        let oldest = 0;
        for (let i = 1; i < this[key]; i++) if (lives[i] < lives[oldest]) oldest = i;
        lives[oldest] = -1;
        this[key] = compactWithLife(rows, stride, this[key], lives, (i) => i !== oldest);
    }

    /** Retire what has run its course. */
    update(time) {
        const rib = this.u.tables.ribbons;
        const before = this.ribbonCount;
        this.ribbonCount = compactWithLife(rib, 3, this.ribbonCount, this.ribbonLife, (i) => this.ribbonLife[i] > time);
        if (before !== this.ribbonCount) this.u.ribbonCount.value = this.ribbonCount;
        const wav = this.u.tables.waves;
        const wb = this.waveCount;
        this.waveCount = compactWithLife(wav, 2, this.waveCount, this.waveLife, (i) => this.waveLife[i] > time);
        if (wb !== this.waveCount) this.u.waveCount.value = this.waveCount;
    }
}

/** compact(), moving each row's life with it. */
function compactWithLife(rows, stride, count, lives, alive) {
    let w = 0;
    for (let r = 0; r < count; r++) {
        if (!alive(r)) continue;
        if (w !== r) {
            for (let k = 0; k < stride; k++) rows[w * stride + k].copy(rows[r * stride + k]);
            lives[w] = lives[r];
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
