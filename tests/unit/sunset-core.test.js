/**
 * Sunset — the numbers everything agrees on: the piece's light, the swell, the paths of the sun
 * and the moon, the noise fields.
 */
import { describe, expect, it } from 'vitest';
import {
    EYE_HEIGHT, SEA_FAN, SWELL, SWELL_ROWS, SWELL_VARIANCE, bakeSeaNoise, bakeSkyNoise, bodyDirection, discSquash,
    pieceLight, ringRadius, seaHeight, seaSlope, smooth, turnHeight,
} from '../../src/themes/sunset/sunset-core.js';

describe('sunset core', () => {
    it('lights every piece equally hard in its own hue, and anything else in candle gold', () => {
        const red = pieceLight('#dc2626');
        expect(Math.max(...red)).toBeCloseTo(1, 6);
        expect(red[0]).toBe(1);
        expect(red[1]).toBeLessThan(0.1);
        expect(pieceLight('#000000')).toEqual([1, 0.72, 0.36]);
        expect(pieceLight('not a colour')).toEqual([1, 0.72, 0.36]);
        expect(pieceLight(undefined)).toEqual([1, 0.72, 0.36]);
    });

    it('keeps the swell calm: no train is steep enough to break, the sum stays well under the eye', () => {
        SWELL_ROWS.forEach((row, i) => {
            const steep = row[4] * row[2];
            expect(steep, SWELL[i].length).toBeLessThan(0.04);
            // Deep water: omega² = g k.
            expect(row[3] ** 2).toBeCloseTo(9.81 * row[2], 6);
        });
        const total = SWELL_ROWS.reduce((sum, row) => sum + row[4], 0);
        expect(total).toBeLessThan(EYE_HEIGHT * 0.3);
        expect(SWELL_VARIANCE).toBeGreaterThan(0);
    });

    it('gives the slope of the height it gives', () => {
        const h = 0.01;
        [[3, -20, 4], [-12, -60, 17.5], [40, -150, 91]].forEach(([x, z, t]) => {
            const slope = seaSlope(x, z, t);
            const dx = (seaHeight(x + h, z, t) - seaHeight(x - h, z, t)) / (2 * h);
            const dz = (seaHeight(x, z + h, t) - seaHeight(x, z - h, t)) / (2 * h);
            expect(slope.x).toBeCloseTo(dx, 4);
            expect(slope.z).toBeCloseTo(dz, 4);
        });
    });

    it('lays the sea\'s fan out from the eye\'s foot to the horizon', () => {
        expect(ringRadius(0, 200)).toBeCloseTo(SEA_FAN.near, 6);
        expect(ringRadius(199, 200)).toBeCloseTo(SEA_FAN.far, 3);
        expect(ringRadius(100, 200)).toBeGreaterThan(ringRadius(99, 200));
    });

    it('sets a body in the west, carries it under the world and brings it over the eye from behind', () => {
        const west = bodyDirection(-20, 0);
        expect(west.y).toBeCloseTo(0, 6);
        expect(west.z).toBeLessThan(0);
        expect(west.x).toBeLessThan(0); // left of the line, as the azimuth says
        const high = bodyDirection(0, 90);
        expect(high.y).toBeCloseTo(1, 6);
        const behind = bodyDirection(0, 150);
        expect(behind.z).toBeGreaterThan(0);
        expect(bodyDirection(0, -30).y).toBeLessThan(0);
        const d = bodyDirection(17, 23, 0.34);
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
        expect(turnHeight(-350)).toBeCloseTo(10, 6);
        expect(turnHeight(190)).toBeCloseTo(-170, 6);
        expect(discSquash(0)).toBeLessThan(1);
        expect(discSquash(20)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    });

    it('bakes tileable noise fields of the asked size, using the whole byte range', () => {
        const sky = bakeSkyNoise(64, 3);
        expect(sky).toHaveLength(64 * 64 * 4);
        for (let channel = 0; channel < 4; channel += 1) {
            let lo = 255;
            let hi = 0;
            for (let i = channel; i < sky.length; i += 4) {
                lo = Math.min(lo, sky[i]);
                hi = Math.max(hi, sky[i]);
            }
            expect(hi - lo, `sky channel ${channel}`).toBeGreaterThan(120);
        }
        const sea = bakeSeaNoise(64, 3);
        expect(sea.data).toHaveLength(64 * 64 * 4);
        expect(sea.variance).toBeGreaterThan(0.01);
        expect(sea.variance).toBeLessThan(1);
        // The slope bytes are centred on 0.5.
        let sum = 0;
        for (let i = 0; i < sea.data.length; i += 4) sum += sea.data[i];
        expect(sum / (64 * 64)).toBeGreaterThan(110);
        expect(sum / (64 * 64)).toBeLessThan(145);
        // Deterministic.
        expect(bakeSkyNoise(32, 9)).toEqual(bakeSkyNoise(32, 9));
    });
});
