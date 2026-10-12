/**
 * Painted Ages — the renderer-free core: maths, the view rig, the strata column, the piece codes
 * and the mineral record of cleared rows.
 *
 * The look is still being tuned, so nothing here pins a colour, a thickness range or a fold: the
 * tests hold the properties the land and the record are built on.
 */
import { describe, expect, it } from 'vitest';
import {
    COLUMN, EYE, FIELDS, FIELD_BLEND, FIELD_ORDER, MINERALS, PIECE_CODE, PIECE_COLORS, PIECE_ORDER, RECORD_BED,
    RECORD_ROWS, RECORD_WIDTH, RIG, SHAPES, SHAPE_KEYS, StrataRecord, TIMING, approach, bakeColumn, bedAt, buildBeds,
    cellsFromMatrix, clamp, clampInt, hexToLinear, lerp, mineralise, mulberry32, pieceCode, recordAddress, rigFor,
    smooth, smoother, strataG,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { PAINTED_AGES_TETROMINOS } from '../../src/themes/painted-ages/painted-ages-tetrominos.js';

const BYTE = 1 / 255;
const quantised = (rgb) => rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255);
const row = (code) => new Array(10).fill(code);
const chroma = (rgb) => {
    const hi = Math.max(...rgb);
    return hi > 0 ? (hi - Math.min(...rgb)) / hi : 0;
};
const expectClose = (a, b, tolerance, label) => {
    a.forEach((v, i) => expect(Math.abs(v - b[i]), `${label} [${i}]`).toBeLessThanOrEqual(tolerance));
};

describe('Painted Ages maths', () => {
    it('clamps, steps and eases as the shaders do', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(Number.NaN, 2, 3)).toBe(2);
        expect(clampInt(2.6, 0, 10)).toBe(3);
        expect(lerp(2, 4, 0.25)).toBe(2.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // Reversed edges fall instead of rising (the strata's range mask uses them).
        expect(smooth(1, 0, 0.9)).toBeLessThan(0.1);
        // Equal edges are a step.
        expect(smooth(3, 3, 2.9)).toBe(0);
        expect(smooth(3, 3, 3)).toBe(1);
        expect(smoother(0)).toBe(0);
        expect(smoother(1)).toBe(1);
        expect(smoother(0.5)).toBeCloseTo(0.5, 12);
    });

    it('approaches a target at a rate independent of how the time is sliced', () => {
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 1e6)).toBeCloseTo(1, 12);
        const once = approach(1.5, 0.2);
        const twice = 1 - (1 - approach(1.5, 0.1)) ** 2;
        expect(twice).toBeCloseTo(once, 12);
    });

    it('draws the same deterministic sequence for a seed, in [0, 1)', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const c = mulberry32(43);
        const seqA = Array.from({ length: 200 }, a);
        expect(Array.from({ length: 200 }, b)).toEqual(seqA);
        expect(Array.from({ length: 200 }, c)).not.toEqual(seqA);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
    });

    it('reads sRGB hex as linear light and anything else as black', () => {
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('808080')[0]).toBeCloseTo(0.2158605, 6);
        expect(hexToLinear('nonsense')).toEqual([0, 0, 0]);
        expect(hexToLinear(null)).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#ff0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
    });
});

describe('Painted Ages view', () => {
    it('chooses the lens by aspect: portrait, landscape and wide', () => {
        expect(rigFor(9 / 19.5)).toBe(RIG.portrait);
        expect(rigFor(0.5)).toBe(RIG.portrait);
        expect(rigFor(0.75)).toBe(RIG.landscape);
        expect(rigFor(4 / 3)).toBe(RIG.landscape);
        expect(rigFor(16 / 9)).toBe(RIG.landscape);
        expect(rigFor(2.1)).toBe(RIG.landscape);
        expect(rigFor(21 / 9)).toBe(RIG.wide);
        expect(rigFor(32 / 9)).toBe(RIG.wide);
        for (const nonsense of [Number.NaN, 0, -1, undefined, Infinity]) expect(rigFor(nonsense)).toBe(RIG.landscape);
    });

    it('looks down across the valley, further down in portrait, narrower on a wide screen', () => {
        for (const key of ['portrait', 'landscape', 'wide']) {
            expect(RIG[key].pitch, key).toBeLessThan(0);
            expect(RIG[key].fov, key).toBeGreaterThan(10);
            expect(RIG[key].fov, key).toBeLessThan(90);
        }
        expect(RIG.portrait.pitch).toBeLessThan(RIG.landscape.pitch);
        expect(RIG.portrait.fov).toBeGreaterThan(RIG.landscape.fov);
        expect(RIG.wide.fov).toBeLessThan(RIG.landscape.fov);
        expect(RIG.near).toBeGreaterThan(0);
        expect(RIG.far).toBeGreaterThan(30000); // the snow peaks stand tens of kilometres out
    });

    it('nests the three fields around the eye with room for each blend band', () => {
        expect(FIELD_ORDER).toEqual(['near', 'mid', 'far']);
        const edges = (f) => ({
            x0: f.x0, x1: f.x0 + f.span, z0: f.z0, z1: f.z0 + f.span,
        });
        FIELD_ORDER.forEach((name) => {
            const f = FIELDS[name];
            expect(f.name).toBe(name);
            expect(f.hi).toBeGreaterThan(f.lo);
            expect(Number.isInteger(f.size) && f.size > 64).toBe(true);
            const e = edges(f);
            expect(EYE.x > e.x0 && EYE.x < e.x1 && EYE.z > e.z0 && EYE.z < e.z1, `${name} holds the eye`).toBe(true);
        });
        for (const [inner, outer] of [['near', 'mid'], ['mid', 'far']]) {
            const a = edges(FIELDS[inner]);
            const b = edges(FIELDS[outer]);
            const gap = Math.min(a.x0 - b.x0, b.x1 - a.x1, a.z0 - b.z0, b.z1 - a.z1);
            expect(gap, `${inner} inside ${outer}`).toBeGreaterThan(FIELD_BLEND[inner]);
            expect(FIELD_BLEND[inner]).toBeGreaterThan(0);
            const post = (name) => FIELDS[name].span / (FIELDS[name].size - 1);
            expect(post(inner)).toBeLessThan(post(outer));
        }
        expect(EYE.y).toBeGreaterThan(FIELDS.near.lo);
        expect(EYE.y).toBeLessThan(FIELDS.near.hi);
    });
});

describe('Painted Ages strata', () => {
    const beds = buildBeds();

    it('builds the same column for a seed and a different one for another', () => {
        expect(buildBeds()).toEqual(beds);
        expect(buildBeds(7)).not.toEqual(beds);
    });

    it('stacks its beds without gaps from the column foot past its top', () => {
        expect(beds.length).toBeGreaterThan(100);
        expect(beds[0].g0).toBe(COLUMN.gMin);
        for (let i = 1; i < beds.length; i++) {
            expect(beds[i].g0, `bed ${i}`).toBeCloseTo(beds[i - 1].g0 + beds[i - 1].thickness, 9);
        }
        const top = beds[beds.length - 1];
        expect(top.g0).toBeLessThan(COLUMN.gMax);
        expect(top.g0 + top.thickness).toBeGreaterThanOrEqual(COLUMN.gMax);
    });

    it('gives every bed a family, a colour and a hardness the shader can use', () => {
        const families = new Set(Object.keys(MINERALS));
        const step = (COLUMN.gMax - COLUMN.gMin) / COLUMN.size;
        beds.forEach((bed, i) => {
            expect(families.has(bed.family), `bed ${i} ${bed.family}`).toBe(true);
            // Every bed is thicker than a texel of the column, so each one shows in it.
            expect(bed.thickness, `bed ${i}`).toBeGreaterThan(step);
            expect(bed.thickness, `bed ${i}`).toBeLessThan(12);
            bed.color.forEach((c) => {
                expect(Number.isFinite(c)).toBe(true);
                expect(c).toBeGreaterThanOrEqual(0);
                expect(c).toBeLessThanOrEqual(1);
            });
            expect(bed.hard).toBeGreaterThanOrEqual(0);
            expect(bed.hard).toBeLessThanOrEqual(1);
        });
        // A rainbow, not one colour: many families show.
        expect(new Set(beds.map((b) => b.family)).size).toBeGreaterThan(6);
    });

    it('finds the bed that holds a geological height', () => {
        const random = mulberry32(5);
        for (let i = 0; i < 500; i++) {
            const g = COLUMN.gMin + random() * (COLUMN.gMax - COLUMN.gMin);
            const bed = bedAt(beds, g);
            expect(bed.g0).toBeLessThanOrEqual(g);
            expect(g).toBeLessThan(bed.g0 + bed.thickness + 1e-9);
        }
        expect(bedAt(beds, COLUMN.gMin - 50)).toBe(beds[0]);
        expect(bedAt(beds, COLUMN.gMax + 5000)).toBe(beds[beds.length - 1]);
        expect(bedAt([], 0)).toBeNull();
    });

    it('bakes a column covering [gMin, gMax] in which every bed shows', () => {
        const column = bakeColumn(beds);
        expect(column).toHaveLength(COLUMN.size * 4);
        expect(bakeColumn(beds)).toEqual(column);
        const step = (COLUMN.gMax - COLUMN.gMin) / COLUMN.size;
        const seen = new Set();
        const wrong = [];
        for (let i = 0; i < COLUMN.size; i++) {
            const g = COLUMN.gMin + (i + 0.5) * step;
            const bed = bedAt(beds, g);
            seen.add(bed);
            for (let c = 0; c < 4; c++) {
                const v = column[i * 4 + c];
                if (!(v >= 0 && v <= 1)) wrong.push(`texel ${i}.${c} = ${v}`);
            }
            // Hardness rides in alpha, the bed's own.
            if (column[i * 4 + 3] !== Math.fround(bed.hard)) wrong.push(`texel ${i} hardness`);
        }
        expect(wrong).toEqual([]);
        const inside = beds.filter((b) => b.g0 + b.thickness > COLUMN.gMin && b.g0 < COLUMN.gMax);
        expect(seen.size).toBe(inside.length);
        // A smaller column (a mip of it) is baked the same way.
        expect(bakeColumn(beds, 64)).toHaveLength(256);
    });

    it('lifts a point by its height one for one', () => {
        for (const [x, z] of [[0, 0], [300, -900], [-1500, -4000], [800, -12000]]) {
            expect(strataG(x, 110, z) - strataG(x, 100, z)).toBeCloseTo(10, 9);
        }
    });

    it('dips the beds gently near the eye and steeply under the flatiron range', () => {
        // How fast a bed's height changes per metre across the land (the shader uses the same formula).
        const slope = (x, z) => {
            const gx = (strataG(x + 1, 0, z) - strataG(x - 1, 0, z)) / 2;
            const gz = (strataG(x, 0, z + 1) - strataG(x, 0, z - 1)) / 2;
            return { gx, gz, size: Math.hypot(gx, gz) };
        };
        let gentle = 0;
        for (let x = -900; x <= 900; x += 100) {
            for (let z = -1500; z <= 0; z += 100) gentle = Math.max(gentle, slope(x, z).size);
        }
        expect(gentle).toBeGreaterThan(0.02); // they do dip, and fold
        expect(gentle).toBeLessThan(0.3);
        // Under the range a bed climbs away from the eye at about 45°, so the gullies cut it into Vs.
        for (let x = -2000; x <= 2000; x += 250) {
            for (let z = -5000; z <= -3000; z += 250) {
                expect(slope(x, z).gz, `(${x}, ${z})`).toBeGreaterThan(0.8);
            }
        }
        // Finite everywhere the land reaches.
        for (let x = -20000; x <= 20000; x += 2500) {
            for (let z = -36000; z <= 4000; z += 2500) expect(Number.isFinite(strataG(x, 500, z))).toBe(true);
        }
    });
});

describe('Painted Ages pieces', () => {
    it('numbers the pieces in one order and colours them as the board does', () => {
        expect(PIECE_ORDER).toHaveLength(8);
        expect(PIECE_COLORS).toHaveLength(PIECE_ORDER.length);
        PIECE_ORDER.forEach((key, code) => {
            expect(PIECE_CODE[key]).toBe(code);
            expect(PIECE_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(PIECE_COLORS[code].toLowerCase(), key).toBe(PAINTED_AGES_TETROMINOS.colors[key].toLowerCase());
        });
    });

    it('reads a shape key however it is spelt and treats anything else as garbage', () => {
        expect(pieceCode('T')).toBe(PIECE_CODE.T);
        expect(pieceCode(' s ')).toBe(PIECE_CODE.S);
        expect(pieceCode('garbage')).toBe(PIECE_CODE.GARBAGE);
        for (const other of ['X', '', 'toString', '__proto__', null, undefined, 5, {}]) {
            expect(pieceCode(other), String(other)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns every spawn matrix into four cells centred on their box', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        expect(cellsFromMatrix(SHAPES.I)).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(cellsFromMatrix(SHAPES.O)).toEqual([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
        for (const key of SHAPE_KEYS) {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const xs = cells.filter((_, i) => i % 2 === 0);
            const ys = cells.filter((_, i) => i % 2 === 1);
            expect(Math.max(...xs) + Math.min(...xs), key).toBeCloseTo(0, 12);
            expect(Math.max(...ys) + Math.min(...ys), key).toBeCloseTo(0, 12);
            const distinct = new Set(xs.map((x, i) => `${x},${ys[i]}`));
            expect(distinct.size, key).toBe(4);
        }
    });

    it('refuses what is not a matrix, and pads a short one', () => {
        for (const bad of [null, 'I', [], [[0, 0], [0, 0]], [null, 'row']]) expect(cellsFromMatrix(bad)).toBeNull();
        expect(cellsFromMatrix([[1]])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        // Never more than four cells.
        expect(cellsFromMatrix([[1, 1, 1, 1, 1, 1]])).toHaveLength(8);
    });

    it('settles a pigment toward rock when dry and shows the pigment itself when wet', () => {
        const pigment = hexToLinear(PIECE_COLORS[PIECE_CODE.O]);
        const rock = hexToLinear(MINERALS.umber);
        mineralise(pigment, rock, 1).forEach((v, i) => expect(v).toBeCloseTo(pigment[i], 12));
        const dry = mineralise(pigment, rock, 0);
        expect(dry).not.toEqual(pigment);
        expect(chroma(dry)).toBeLessThan(chroma(pigment));
        // The hue is kept: the strongest channel stays the strongest.
        expect(dry.indexOf(Math.max(...dry))).toBe(pigment.indexOf(Math.max(...pigment)));
        const out = [0, 0, 0];
        expect(mineralise(pigment, rock, 0.5, out)).toBe(out);
    });
});

describe('Painted Ages mineral record', () => {
    it('addresses a row by depth below the head, wrapping round the ring', () => {
        expect(recordAddress(0, 0)).toMatchObject({ row: 0, col: 0, offset: 0 });
        expect(recordAddress(0, 1).row).toBe(RECORD_ROWS - 1);
        expect(recordAddress(5, 2).row).toBe(3);
        expect(recordAddress(3, RECORD_ROWS + 1).row).toBe(2);
        expect(recordAddress(0, 0).v).toBe(0.5 / RECORD_ROWS);
        const a = recordAddress(7, 0, 11);
        expect(a.offset).toBe((7 * RECORD_WIDTH + 11) * 4);
        expect(a.u).toBe(11.5 / RECORD_WIDTH);
        expect(recordAddress(0, 0, 99).col).toBe(RECORD_WIDTH - 1);
        expect(recordAddress(0, 0, -3).col).toBe(0);
        expect(RECORD_BED).toBeGreaterThan(0);
    });

    it('starts empty: every row unwritten, so the land shows its own beds', () => {
        const record = new StrataRecord();
        expect(record.total).toBe(0);
        expect(record.head).toBe(RECORD_ROWS - 1);
        expect(record.data).toHaveLength(RECORD_WIDTH * RECORD_ROWS * 4);
        expect(record.data.every((byte) => byte === 0)).toBe(true);
        for (let depth = 0; depth < RECORD_ROWS; depth++) expect(record.written(depth)).toBe(false);
    });

    it('lays a cleared row down as the newest bed: cells, their mean, the pigments, the metadata', () => {
        const record = new StrataRecord();
        const { version } = record;
        const codes = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1];
        const head = record.deposit(codes, { time: 2, thickness: 1 });
        expect(head).toBe(0);
        expect(record.head).toBe(0);
        expect(record.total).toBe(1);
        expect(record.version).toBeGreaterThan(version);
        expect(record.written(0)).toBe(true);
        expect(record.written(1)).toBe(false);
        const cells = Array.from({ length: 10 }, (_, c) => record.read(0, c));
        // The same piece lays the same rock; different pieces lay different rock.
        expect(cells[8]).toEqual(cells[0]);
        expect(cells[9]).toEqual(cells[1]);
        for (let a = 0; a < 8; a++) {
            for (let b = a + 1; b < 8; b++) expect(cells[a], `${a} vs ${b}`).not.toEqual(cells[b]);
        }
        // Rock, not plastic: each cell has settled away from its raw pigment.
        cells.slice(0, 8).forEach((cell, code) => {
            const pigment = hexToLinear(PIECE_COLORS[code]);
            expect(Math.max(...cell.map((v, i) => Math.abs(v - pigment[i]))), `cell ${code}`).toBeGreaterThan(2 * BYTE);
        });
        // Column 10: the cells' mean (what a far bed shows).
        const mean = [0, 1, 2].map((k) => cells.reduce((sum, cell) => sum + cell[k], 0) / 10);
        expectClose(record.read(0, 10), mean, 1.5 * BYTE, 'mean');
        // Column 11: the raw pigments' mean (wet rock and a fresh bed's glow).
        const raw = [0, 1, 2].map((k) => codes.reduce((sum, code) => sum + hexToLinear(PIECE_COLORS[code])[k], 0) / 10);
        expectClose(record.read(0, 11), raw, 1.5 * BYTE, 'raw');
        // Column 12: thickness / 4, tuff, written.
        expectClose(record.read(0, 12), [0.25, 0, 1], BYTE, 'meta');
        expect(record.data[recordAddress(0, 0, 12).offset + 3]).toBe(255);
    });

    it('keeps the raw pigment of a one-piece row and records its thickness', () => {
        const record = new StrataRecord();
        record.deposit(row(PIECE_CODE.O), { thickness: 2 });
        expectClose(record.read(0, 11), hexToLinear(PIECE_COLORS[PIECE_CODE.O]), BYTE, 'raw');
        expect(record.read(0, 12)[0]).toBeCloseTo(Math.round(0.5 * 255) / 255, 9);
        // A thickness past the encodable range saturates.
        record.deposit(row(0), { thickness: 9 });
        expect(record.read(0, 12)[0]).toBe(1);
    });

    it('lays a pale tuff bed across every column when asked', () => {
        const record = new StrataRecord();
        record.deposit(row(PIECE_CODE.T), { time: 1 });
        record.deposit(null, { time: 2, tuff: true });
        const cream = quantised(hexToLinear(MINERALS.cream));
        for (let column = 0; column < 12; column++) {
            expectClose(record.read(0, column), cream, 1.5 * BYTE, `column ${column}`);
        }
        expect(record.read(0, 12)[1]).toBe(1);
        expect(record.read(1, 12)[1]).toBe(0);
        expect(record.written(1)).toBe(true);
    });

    it('fills a row the board never named with the land\'s own colours', () => {
        const record = new StrataRecord();
        record.deposit(null, { time: 1 });
        record.deposit([1, 2, 3], { time: 2 }); // too short to be a row
        for (const depth of [0, 1]) {
            expect(record.written(depth)).toBe(true);
            for (let column = 0; column < 12; column++) {
                record.read(depth, column).forEach((v) => expect(Number.isFinite(v)).toBe(true));
            }
            expect(record.read(depth, 12)[1]).toBe(0); // not a tuff
        }
        expect(record.journal.map((event) => event.codes)).toEqual([null, null]);
    });

    it('rewinds and replays: a seek keeps the rows after it for a later seek', () => {
        const record = new StrataRecord(19);
        record.deposit(row(0), { time: 3 });
        const first = record.data.slice();
        record.deposit(row(2), { time: 6 });
        const second = record.data.slice();
        record.seek(4);
        expect(record.total).toBe(1);
        expect(record.data).toEqual(first);
        expect(record.written(0)).toBe(true);
        record.seek(7);
        expect(record.total).toBe(2);
        expect(record.data).toEqual(second);
        record.seek(0);
        expect(record.total).toBe(0);
        expect(record.written(0)).toBe(false);
        expect(record.data.every((byte) => byte === 0)).toBe(true);
        record.seek(100);
        expect(record.data).toEqual(second);
    });

    it('replays its own copy of a row, whatever the board does with the array afterwards', () => {
        const record = new StrataRecord();
        const codes = row(PIECE_CODE.L);
        record.deposit(codes, { time: 1 });
        const laid = record.data.slice();
        codes.fill(PIECE_CODE.Z);
        record.seek(2);
        expect(record.data).toEqual(laid);
    });

    it('wraps the ring, checkpoints what falls off it, and replays identically', () => {
        const record = new StrataRecord(17);
        const extra = 37;
        for (let i = 0; i < RECORD_ROWS + extra; i++) record.deposit(row(i % 8), { time: i });
        expect(record.total).toBe(RECORD_ROWS + extra);
        expect(record.journal).toHaveLength(RECORD_ROWS);
        expect(record.baselineTotal).toBe(extra);
        // The newest bed on top, the oldest still in the ring at the bottom.
        expectClose(record.read(0, 11), hexToLinear(PIECE_COLORS[(RECORD_ROWS + extra - 1) % 8]), BYTE, 'newest');
        expectClose(record.read(RECORD_ROWS - 1, 11), hexToLinear(PIECE_COLORS[extra % 8]), BYTE, 'oldest');
        const bytes = record.data.slice();
        const { head, total } = record;
        record.seek(RECORD_ROWS + extra + 10);
        expect(record.data).toEqual(bytes);
        expect(record.head).toBe(head);
        expect(record.total).toBe(total);
        record.seek(RECORD_ROWS + extra + 10);
        expect(record.data).toEqual(bytes);
        // Before the journal starts lies deep time: the checkpoint, no further back.
        record.seek(extra - 20);
        expect(record.total).toBe(extra);
        expect(record.data).toEqual(record.baseline);
        record.seek(RECORD_ROWS + extra);
        expect(record.data).toEqual(bytes);
    });

    it('empties again on prefill', () => {
        const record = new StrataRecord();
        for (let i = 0; i < 5; i++) record.deposit(row(i), { time: i });
        const { version } = record;
        record.prefill();
        expect(record.total).toBe(0);
        expect(record.journal).toHaveLength(0);
        expect(record.version).toBeGreaterThan(version);
        expect(record.data.every((byte) => byte === 0)).toBe(true);
        expect(record.written(0)).toBe(false);
    });
});

describe('Painted Ages timings', () => {
    it('keeps every timing positive and the hour wheel on the house rule', () => {
        Object.entries(TIMING).forEach(([key, value]) => {
            expect(Number.isFinite(value) && value > 0, key).toBe(true);
        });
        // The light rests 15 % of each step at each end and is on its way for the rest.
        expect(TIMING.hourRest).toBe(0.15);
        expect(TIMING.hour).toBeGreaterThanOrEqual(80);
        expect(TIMING.hour).toBeLessThanOrEqual(120);
        expect(TIMING.levelTurn).toBeLessThan(TIMING.hour);
    });
});
