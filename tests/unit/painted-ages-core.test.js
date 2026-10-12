import { describe, expect, it } from 'vitest';
import {
    StrataRecord, RECORD_ROWS, recordAddress, hexToLinear, mineralise, sunAt,
    PIECE_COLORS, FORMATIONS, PALETTE,
} from '../../src/themes/painted-ages/painted-ages-core.js';

describe('Painted Ages mineral record', () => {
    it('stores real cells left to right, including obsidian unknown cells', () => {
        const record = new StrataRecord();
        record.deposit([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
        for (let col = 0; col < 8; col++) {
            const rgb = hexToLinear(PIECE_COLORS[col]);
            record.read(0, col).forEach((c, i) => expect(Math.abs(c - rgb[i])).toBeLessThanOrEqual(1 / 255));
        }
        expect(recordAddress(0, 1).row).toBe(RECORD_ROWS - 1);
        expect(recordAddress(0, 0).v).toBe(0.5 / RECORD_ROWS);
    });
    it('replays the ring and checkpoint identically after wrapping', () => {
        const record = new StrataRecord(17);
        for (let i = 0; i < RECORD_ROWS + 37; i++) record.deposit(new Array(10).fill(i % 8), { time: i });
        const bytes = record.data.slice();
        const { head } = record;
        const { total } = record;
        record.seek(RECORD_ROWS + 50);
        expect(record.data).toEqual(bytes);
        expect(record.head).toBe(head);
        expect(record.total).toBe(total);
        record.seek(RECORD_ROWS + 50);
        expect(record.data).toEqual(bytes);
    });
    it('rewinds a record and keeps future rows available for another seek', () => {
        const record = new StrataRecord(19);
        record.deposit(new Array(10).fill(0), { time: 3 });
        const first = record.data.slice();
        record.deposit(new Array(10).fill(2), { time: 6 });
        const second = record.data.slice();
        record.seek(4);
        expect(record.total).toBe(1);
        expect(record.data).toEqual(first);
        record.seek(7);
        expect(record.data).toEqual(second);
    });
    it('keeps a pale tuff seal distinct from synthetic formation beds through backward and forward seeks', () => {
        const record = new StrataRecord(23);
        record.deposit(new Array(10).fill(0), { time: 2 });
        record.deposit(null, {
            time: 4, formation: 4, thickness: 0.65, tuff: true,
        });
        const sealed = record.data.slice();
        const cream = hexToLinear(PALETTE.cream).map((value) => Math.round(value * 255) / 255);
        for (let column = 0; column < 11; column++) {
            expect(record.read(0, column)).toEqual(cream);
        }
        record.deposit(new Array(10).fill(6), { time: 6 });
        const buried = record.data.slice();
        record.seek(3);
        expect(record.total).toBe(1);
        record.seek(5);
        expect(record.total).toBe(2);
        expect(record.data).toEqual(sealed);
        record.seek(7);
        expect(record.total).toBe(3);
        expect(record.data).toEqual(buried);
        expect(record.read(1, 0)).toEqual(cream);
    });
    it('synthetic rows use the formation and wetness restores the original hue', () => {
        const record = new StrataRecord();
        record.deposit(null, { formation: 4 });
        const a = hexToLinear(PIECE_COLORS[0]);
        const b = hexToLinear(FORMATIONS[4].cast);
        mineralise(a, b, 1).forEach((v, i) => expect(v).toBeCloseTo(a[i], 12));
        expect(mineralise(a, b, 0)).not.toEqual(a);
        expect(record.read(0, 0).every(Number.isFinite)).toBe(true);
    });
    it('keeps the daylight source behind-left with bounded morning elevation', () => {
        for (let t = 0; t < 1000; t += 7) {
            const sun = sunAt(t);
            expect(sun.elevation).toBeGreaterThanOrEqual(12);
            expect(sun.elevation).toBeLessThanOrEqual(22);
            expect(sun.x).toBeLessThan(0);
            expect(sun.z).toBeGreaterThan(0);
            expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1);
        }
    });
});
