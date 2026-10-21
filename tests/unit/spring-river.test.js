/**
 * Spring — the river's mirror (spring-river.js): what stands over the water on either side, baked
 * per vertex from the valley's ground, so a glancing reflection meets the banks and their woods.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import { MIRROR, createRiverGeometry } from '../../src/themes/spring/spring-river.js';
import { S_LIP, S_POOL } from '../../src/themes/spring/spring-plan.js';
import { decodeValley } from '../../src/themes/spring/spring-terrain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let baked = null;

beforeAll(() => {
    const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
    baked = decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file))));
});

/** Rows of the built ribbon: [{ s, horizon: [right, left, rightWood, leftWood] per column }]. */
function rowsOf(geometry, cols) {
    const river = geometry.getAttribute('aRiver');
    const bank = geometry.getAttribute('aBank');
    const across = cols + 1;
    const rows = [];
    for (let r = 0; r < river.count / across; r++) {
        const columns = [];
        for (let k = 0; k < across; k++) {
            const o = r * across + k;
            columns.push({
                nm: river.getY(o),
                right: bank.getX(o),
                left: bank.getY(o),
                rightWood: bank.getZ(o),
                leftWood: bank.getW(o),
            });
        }
        rows.push({ s: river.getX(r * across), columns });
    }
    return rows;
}

describe('spring river: the mirror', () => {
    it('bakes each bank\'s horizon for every vertex, steeper the nearer that bank', () => {
        const cols = 16;
        const { geometry } = createRiverGeometry({ cols, detail: 0.5, baked });
        const rows = rowsOf(geometry, cols);
        let checked = 0;
        for (const row of rows) {
            for (const c of row.columns) {
                for (const v of [c.right, c.left, c.rightWood, c.leftWood]) expect(Number.isFinite(v)).toBe(true);
                expect(c.right).toBeGreaterThanOrEqual(0);
                expect(c.left).toBeGreaterThanOrEqual(0);
                expect(c.rightWood).toBeGreaterThanOrEqual(0);
                expect(c.rightWood).toBeLessThanOrEqual(1);
            }
            // Across a row, the right bank's horizon rises toward the right (its edge nears) and the
            // left one's toward the left.
            const first = row.columns[1];
            const last = row.columns[cols - 1];
            expect(last.right, `s ${row.s}`).toBeGreaterThanOrEqual(first.right - 1e-6);
            expect(first.left, `s ${row.s}`).toBeGreaterThanOrEqual(last.left - 1e-6);
            checked += 1;
        }
        expect(checked).toBeGreaterThan(100);
    });

    it('sees the gorge\'s walls stand high over the pool, and wooded banks along the rapids', () => {
        const cols = 16;
        const { geometry } = createRiverGeometry({ cols, detail: 0.5, baked });
        const rows = rowsOf(geometry, cols);
        const mid = cols / 2;
        const pool = rows.find((row) => row.s > S_POOL + 4);
        // From the pool's middle the gorge's walls stand well over the level on both sides.
        expect(pool.columns[mid].right).toBeGreaterThan(0.4);
        expect(pool.columns[mid].left).toBeGreaterThan(0.4);
        // Somewhere down the rapids the banks carry woods.
        const woods = rows.filter((row) => row.s > S_POOL + 20 && row.s < S_POOL + 300)
            .some((row) => row.columns[mid].rightWood > 0.3 || row.columns[mid].leftWood > 0.3);
        expect(woods).toBe(true);
        // The upper river (above the lip) is measured too.
        expect(rows.some((row) => row.s < S_LIP && row.columns[mid].right > 0)).toBe(true);
    });

    it('falls back to a flat bank without the valley\'s ground', () => {
        const { geometry } = createRiverGeometry({ cols: 8, detail: 0.25 });
        const bank = geometry.getAttribute('aBank');
        for (let i = 0; i < bank.count; i += 37) {
            expect(bank.getX(i)).toBeCloseTo(MIRROR.flat, 6);
            expect(bank.getY(i)).toBeCloseTo(MIRROR.flat, 6);
        }
    });
});
