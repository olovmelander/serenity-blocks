/**
 * Pyrestorm — the CPU bakes: the lava network (the authored rivers meandered and braided, the flank
 * streams let loose on the crater's rim, the breakouts off the rivers' banks, the fissure's line),
 * its two rasterised fields, the noise, the lattice and the billow atlas.
 *
 * The courses and the encodings are being tuned, so the tests hold what the shaders rely on: every
 * channel is there, hot at its vent and cooling downstream, lava runs downhill, the fields report a
 * centreline where one is, the glow sits on the lava, and every bake is the same twice.
 */
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import {
    BILLOW, LATTICE_SIZE, LATTICE_SLICE, LAVA_FIELDS, NOISE_SIZE, bakeBillows, bakeLattice, bakeLavaFields, bakeNoise,
    buildBreakouts, buildChannels, buildFissure, buildFlankStreams, buildRivers,
} from '../../src/themes/pyrestorm/pyrestorm-bake.js';
import {
    BRAIDS, CRATER, FISSURE, FLANK, RIVERS, VOLCANO, landHeight,
} from '../../src/themes/pyrestorm/pyrestorm-core.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const KIND = Object.freeze({
    river: 0, braid: 1, flank: 2, fissure: 3, breakout: 4,
});

let channels;
let fields;

beforeAll(() => {
    channels = buildChannels();
    fields = bakeLavaFields(channels);
});

/** Decode one texel of a field at a world point (null outside it). */
function texel(field, x, z) {
    const cell = field.span / field.size;
    const i = Math.floor((x - field.x0) / cell);
    const j = Math.floor((z - field.z0) / cell);
    if (i < 0 || j < 0 || i >= field.size || j >= field.size) return null;
    const o = (j * field.size + i) * 4;
    return {
        dc: (field.a[o] / 255) * field.range,
        hw: (field.a[o + 1] / 255) * field.widthRange,
        heat: field.a[o + 2] / 255,
        glow: field.a[o + 3] / 255,
        dir: [(field.b[o] / 255) * 2 - 1, (field.b[o + 1] / 255) * 2 - 1],
        kind: field.b[o + 2] / 60,
    };
}

const byId = (id) => channels.find((channel) => channel.id === id);

describe('Pyrestorm lava network', () => {
    it('holds the four rivers, their braids, the flank streams and the fissure\'s line', () => {
        const ids = channels.map((channel) => channel.id);
        expect(new Set(ids).size).toBe(ids.length);
        const rivers = channels.filter((channel) => channel.kind === KIND.river);
        expect(rivers.map((channel) => channel.id).sort()).toEqual(RIVERS.map((river) => river.id).sort());
        // Every authored braid is cut (each is long enough on its parent).
        const braids = channels.filter((channel) => channel.kind === KIND.braid);
        expect(braids).toHaveLength(BRAIDS.length);
        braids.forEach((braid) => expect(RIVERS.map((r) => r.id)).toContain(braid.id.split('-braid-')[0]));
        // Every flank stream runs (and the satellite cone's overflow with them).
        const flank = channels.filter((channel) => channel.kind === KIND.flank);
        expect(flank.filter((channel) => /^flank-\d+$/.test(channel.id))).toHaveLength(FLANK.streams);
        expect(ids).toContain('flank-0');
        expect(ids).toContain('satellite-overflow');
        // One fissure line.
        expect(channels.filter((channel) => channel.kind === KIND.fissure)).toHaveLength(1);
        // The pieces are what buildChannels joins.
        const built = buildRivers();
        expect(channels).toHaveLength(built.length + buildFlankStreams().length + buildBreakouts(built).length + buildFissure().length);
    });

    it('gives every channel a course, a width and a heat the shader can read', () => {
        for (const channel of channels) {
            expect(channel.pts.length, channel.id).toBeGreaterThanOrEqual(6);
            expect(channel.total, channel.id).toBeGreaterThan(0);
            for (let i = 0; i < channel.pts.length; i++) {
                expect(Number.isFinite(channel.pts[i][0]) && Number.isFinite(channel.pts[i][1]), channel.id).toBe(true);
                expect(channel.hw[i], `${channel.id} width at ${i}`).toBeGreaterThan(0);
                expect(channel.heat[i], `${channel.id} heat at ${i}`).toBeGreaterThanOrEqual(0);
                expect(channel.heat[i], `${channel.id} heat at ${i}`).toBeLessThanOrEqual(1);
                if (i > 0) expect(channel.s[i], `${channel.id} arc at ${i}`).toBeGreaterThan(channel.s[i - 1]);
            }
        }
    });

    it('cools every river, braid and flank stream downstream', () => {
        for (const channel of channels.filter((c) => c.kind !== KIND.fissure && c.kind !== KIND.breakout)) {
            for (let i = 1; i < channel.heat.length; i++) {
                expect(channel.heat[i], `${channel.id} at ${i}`).toBeLessThanOrEqual(channel.heat[i - 1] + 1e-6);
            }
            expect(channel.heat[channel.heat.length - 1], channel.id).toBeLessThan(channel.heat[0]);
        }
        // The main river leaves the breach as hot as lava gets.
        expect(byId('main').heat[0]).toBeCloseTo(RIVERS.find((r) => r.id === 'main').heat, 6);
    });

    it('dots the flow field with breakouts: short, cooler toes beside the rivers', () => {
        const breakouts = channels.filter((c) => c.kind === KIND.breakout);
        expect(breakouts.length).toBeGreaterThan(10);
        const rivers = channels.filter((c) => c.kind === KIND.river);
        for (const toe of breakouts) {
            expect(toe.total, toe.id).toBeLessThan(600);
            // Beside some river: its first point within a kilometre of a river's course.
            const [x, z] = toe.pts[0];
            const near = rivers.some((r) => r.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1000));
            expect(near, toe.id).toBe(true);
            // Cooler than a fresh river.
            expect(Math.max(...toe.heat), toe.id).toBeLessThan(0.9);
            expect(Math.min(...toe.heat), toe.id).toBeGreaterThan(0);
        }
        // Deterministic.
        const again = buildBreakouts(buildRivers());
        expect(again.map((c) => c.pts.length)).toEqual(breakouts.map((c) => c.pts.length));
    });

    it('starts each river at its authored vent and ends it within its meander of the authored mouth', () => {
        for (const river of RIVERS) {
            const channel = byId(river.id);
            const [x0, z0] = river.points[0];
            expect(channel.pts[0][0], river.id).toBeCloseTo(x0, 6);
            expect(channel.pts[0][1], river.id).toBeCloseTo(z0, 6);
            const end = channel.pts[channel.pts.length - 1];
            const [x1, z1] = river.points[river.points.length - 1];
            expect(Math.hypot(end[0] - x1, end[1] - z1), river.id).toBeLessThanOrEqual(river.meander + 1e-6);
        }
    });

    it('splits each braid from its parent and joins it again, a little cooler', () => {
        for (const braid of channels.filter((c) => c.kind === KIND.braid)) {
            const parent = byId(braid.id.split('-braid-')[0]);
            const near = (p) => Math.min(...parent.pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
            expect(near(braid.pts[0]), `${braid.id} leaves its parent`).toBeLessThan(1e-6);
            expect(near(braid.pts[braid.pts.length - 1]), `${braid.id} rejoins its parent`).toBeLessThan(1e-6);
            // It strays from the parent in between.
            expect(near(braid.pts[Math.floor(braid.pts.length / 2)]), braid.id).toBeGreaterThan(50);
            expect(Math.max(...braid.heat), braid.id).toBeLessThan(Math.max(...parent.heat));
        }
    });

    it('lets the breach\'s stream run down the cone, descending at every step', () => {
        const stream = byId('flank-0');
        const heights = stream.pts.map((p) => landHeight(p[0], p[1]));
        // It leaves the crater on the breach's bearing...
        const [x, z] = stream.pts[0];
        expect(Math.hypot(x - VOLCANO.x, z - VOLCANO.z)).toBeLessThanOrEqual(VOLCANO.crater * 1.05);
        const bearing = Math.atan2(z - VOLCANO.z, x - VOLCANO.x);
        expect(Math.abs(bearing - VOLCANO.breach)).toBeLessThan(0.05);
        // ...and lava never climbs: every step is at or below the one before it.
        const climbs = [];
        for (let i = 1; i < heights.length; i++) {
            if (heights[i] > heights[i - 1]) climbs.push(`step ${i}: +${(heights[i] - heights[i - 1]).toFixed(2)} m`);
        }
        expect(climbs).toEqual([]);
        expect(heights[heights.length - 1]).toBeLessThan(heights[0]);
    });

    it('lets every flank stream leave the summit and end lower down the cone', () => {
        for (const stream of channels.filter((c) => /^flank-\d+$/.test(c.id))) {
            const [x, z] = stream.pts[0];
            expect(Math.hypot(x - VOLCANO.x, z - VOLCANO.z), stream.id).toBeLessThan(VOLCANO.crater * 2);
            const end = stream.pts[stream.pts.length - 1];
            expect(landHeight(...end), stream.id).toBeLessThan(landHeight(x, z) - 300);
        }
    });

    it('draws the fissure\'s line between its two ends, the hottest lava of all', () => {
        const [line] = channels.filter((c) => c.kind === KIND.fissure);
        const first = line.pts[0];
        const last = line.pts[line.pts.length - 1];
        expect(Math.hypot(first[0] - FISSURE.a[0], first[1] - FISSURE.a[1])).toBeLessThan(50);
        expect(Math.hypot(last[0] - FISSURE.b[0], last[1] - FISSURE.b[1])).toBeLessThan(50);
        line.heat.forEach((h) => expect(h).toBe(1));
    });

    it('builds the same network every time', () => {
        const again = buildChannels();
        expect(again.map((c) => c.id)).toEqual(channels.map((c) => c.id));
        again.forEach((channel, k) => {
            expect(channel.pts, channel.id).toEqual(channels[k].pts);
            expect([...channel.heat], channel.id).toEqual([...channels[k].heat]);
            expect([...channel.hw], channel.id).toEqual([...channels[k].hw]);
        });
    });
});

describe('Pyrestorm lava fields', () => {
    it('bakes a near and a far field of RGBA8 texels, size² × 4 each, the far one holding every channel', () => {
        for (const name of ['near', 'far']) {
            const field = fields[name];
            const { size } = LAVA_FIELDS[name];
            for (const key of ['a', 'b']) {
                expect(field[key], `${name}.${key}`).toBeInstanceOf(Uint8Array);
                expect(field[key], `${name}.${key}`).toHaveLength(size * size * 4);
            }
            expect(field).toMatchObject(LAVA_FIELDS[name]);
        }
        const { near, far } = LAVA_FIELDS;
        const holds = (f, x, z) => x > f.x0 && x < f.x0 + f.span && z > f.z0 && z < f.z0 + f.span;
        // The far field holds the whole network; the near one the plain below the ridge, where the
        // rivers pass closest to the eye.
        for (const channel of channels) {
            channel.pts.forEach(([x, z]) => expect(holds(far, x, z), channel.id).toBe(true));
        }
        byId('main').pts.filter(([, z]) => z > -5000).forEach(([x, z]) => expect(holds(near, x, z)).toBe(true));
        expect(holds(near, 0, -2000)).toBe(true);
        // The near field is the finer one.
        expect(near.span / near.size).toBeLessThan(far.span / far.size);
        expect(fields.channels).toBe(channels);
    });

    it('reports a centreline, its width and its heat on every river where it runs', () => {
        for (const name of ['near', 'far']) {
            const field = fields[name];
            const cell = field.span / field.size;
            for (const river of channels.filter((c) => c.kind === KIND.river)) {
                let seen = 0;
                let onLine = 0;
                river.pts.forEach((p, i) => {
                    const t = texel(field, p[0], p[1]);
                    if (!t) return;
                    seen++;
                    // On lava, hot, wherever the river runs (another channel may own the texel where
                    // two meet, but it is still lava).
                    expect(t.dc, `${name} ${river.id} at ${i}`).toBeLessThan(t.hw + cell);
                    expect(t.heat, `${name} ${river.id} at ${i}`).toBeGreaterThan(0);
                    if (t.dc < cell && t.kind === KIND.river) onLine++;
                });
                expect(seen, `${name} ${river.id}`).toBeGreaterThan(0);
                // Almost everywhere the texel under the centreline reads the centreline itself.
                expect(onLine / seen, `${name} ${river.id}`).toBeGreaterThan(0.97);
            }
        }
        // Mid-way down the main river, the near field reads that river: its width, its heat, its
        // heading.
        const main = byId('main');
        const k = Math.floor(main.pts.length / 2);
        const t = texel(fields.near, ...main.pts[k]);
        const cell = LAVA_FIELDS.near.span / LAVA_FIELDS.near.size;
        expect(t.dc).toBeLessThan(cell);
        expect(t.hw).toBeCloseTo(main.hw[k], -1);
        expect(Math.abs(t.heat - main.heat[k])).toBeLessThan(2 / 255);
        const tx = main.pts[k + 1][0] - main.pts[k - 1][0];
        const tz = main.pts[k + 1][1] - main.pts[k - 1][1];
        expect((t.dir[0] * tx + t.dir[1] * tz) / Math.hypot(tx, tz)).toBeGreaterThan(0.95);
    });

    it('tells the fissure\'s line and the flank streams apart from the rivers', () => {
        const [line] = channels.filter((c) => c.kind === KIND.fissure);
        const mid = line.pts[Math.floor(line.pts.length / 2)];
        expect(texel(fields.near, ...mid).kind).toBe(KIND.fissure);
        const stream = byId('flank-0');
        const on = stream.pts[Math.floor(stream.pts.length / 2)];
        expect(texel(fields.far, ...on).kind).toBe(KIND.flank);
    });

    it('puts the glow on and around the lava, and leaves the dark country dark', () => {
        for (const name of ['near', 'far']) {
            const field = fields[name];
            let on = 0;
            let onCount = 0;
            let off = 0;
            let offCount = 0;
            for (let o = 0; o < field.size * field.size; o++) {
                const dc = (field.a[o * 4] / 255) * field.range;
                const hw = (field.a[o * 4 + 1] / 255) * field.widthRange;
                const glow = field.a[o * 4 + 3];
                if (dc < hw) {
                    on += glow;
                    onCount++;
                } else if (field.a[o * 4] === 255) {
                    off += glow;
                    offCount++;
                }
            }
            expect(onCount, name).toBeGreaterThan(0);
            expect(offCount, name).toBeGreaterThan(0);
            // On the lava the glow is many times what it is out where no channel reaches.
            expect(on / onCount, name).toBeGreaterThan(10 * Math.max(1, off / offCount));
        }
        // The far field carries the crater's own glow: it is at its brightest over the vent, and
        // gone a few kilometres out on the dark plain.
        expect(texel(fields.far, CRATER.x, CRATER.z).glow).toBe(1);
        expect(texel(fields.far, CRATER.x + 4000, CRATER.z - 4000).glow).toBeLessThan(0.05);
    });

    it('bakes the same fields every time', () => {
        const again = bakeLavaFields(channels);
        for (const name of ['near', 'far']) {
            expect(Buffer.compare(Buffer.from(again[name].a), Buffer.from(fields[name].a)), `${name}.a`).toBe(0);
            expect(Buffer.compare(Buffer.from(again[name].b), Buffer.from(fields[name].b)), `${name}.b`).toBe(0);
        }
    });
});

describe('Pyrestorm noise, lattice and billows', () => {
    it('bakes tileable noise, the same for a seed', () => {
        const noise = bakeNoise();
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        expect(Buffer.compare(Buffer.from(bakeNoise()), Buffer.from(noise))).toBe(0);
        expect(Buffer.compare(Buffer.from(bakeNoise(NOISE_SIZE, 7)), Buffer.from(noise))).not.toBe(0);
        // The seam across the wrap is no harsher than any step inside the tile.
        const N = NOISE_SIZE;
        let seam = 0;
        let inner = 0;
        for (let j = 0; j < N; j++) {
            for (let c = 0; c < 4; c++) {
                seam += Math.abs(noise[(j * N + N - 1) * 4 + c] - noise[j * N * 4 + c]);
                inner += Math.abs(noise[(j * N + N / 2) * 4 + c] - noise[(j * N + N / 2 + 1) * 4 + c]);
            }
        }
        expect(seam).toBeLessThan(inner * 2);
    });

    it('bakes a lattice whose G is R one slice up and whose A is B one slice up', () => {
        const lattice = bakeLattice();
        expect(lattice).toHaveLength(LATTICE_SIZE * LATTICE_SIZE * 4);
        const S = LATTICE_SIZE;
        for (let k = 0; k < 2000; k++) {
            const x = (k * 37) % S;
            const y = (k * 101) % S;
            const i = (y * S + x) * 4;
            const j = (((y + LATTICE_SLICE[1]) % S) * S + ((x + LATTICE_SLICE[0]) % S)) * 4;
            expect(lattice[i + 1]).toBe(lattice[j]);
            expect(lattice[i + 3]).toBe(lattice[j + 2]);
        }
        expect(Buffer.compare(Buffer.from(bakeLattice()), Buffer.from(lattice))).toBe(0);
    });

    it('bakes sixteen heaps of ash, each a solid heap inside a clear border', () => {
        const atlas = bakeBillows();
        const { tile, grid } = BILLOW;
        const size = tile * grid;
        expect(atlas).toHaveLength(size * size * 4);
        const alpha = (x, y) => atlas[(y * size + x) * 4];
        for (let v = 0; v < grid * grid; v++) {
            const ox = (v % grid) * tile;
            const oy = Math.floor(v / grid) * tile;
            let edge = 0;
            let cover = 0;
            for (let i = 0; i < tile; i++) {
                const last = tile - 1;
                const rim = [alpha(ox + i, oy), alpha(ox + i, oy + last), alpha(ox, oy + i), alpha(ox + last, oy + i)];
                edge = Math.max(edge, ...rim);
                for (let j = 0; j < tile; j++) if (alpha(ox + i, oy + j) > 128) cover++;
            }
            // A billboard's edge never shows: the tile's border is clear.
            expect(edge, `heap ${v}`).toBe(0);
            expect(alpha(ox + tile / 2, oy + tile / 2), `heap ${v}`).toBeGreaterThan(200);
            // A heap, not a square and not a speck.
            expect(cover / tile ** 2, `heap ${v}`).toBeGreaterThan(0.1);
            expect(cover / tile ** 2, `heap ${v}`).toBeLessThan(0.6);
        }
    }, 30_000);
});
