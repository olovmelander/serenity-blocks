import { describe, expect, it } from 'vitest';
import {
    MATURE_LEAF_RGB,
    PIECE_CODES,
    PIECE_SWATCH_RGB,
    SUNFALL_CLEAR,
    SUNFALL_PARTS,
    SUNFALL_SEED,
    SUNFALL_STATIONS,
    SUNFALL_WEATHERS,
    boardCellToDolineWorld,
    cellsFromMatrix,
    dlBowCpu,
    greeningTau,
    leafTintAtAge,
    mulberry32,
    packCodes,
    planDoline,
    sampleStation,
    sampleWeather,
    solveBowSun,
    stationIndexForLevel,
    sunlitAt,
    unpackCodes,
} from '../../src/themes/sunfall/sunfall-core.js';
import { resolveSunfallQuality } from '../../src/themes/sunfall/sunfall-quality.js';

describe('sunfall-core', () => {
    it('exports canonical seed, chamber haze clear color, and 9 named parts', () => {
        expect(SUNFALL_SEED).toBe(0x53554e46);
        expect(SUNFALL_CLEAR).toBe(0x5d8087);
        expect(SUNFALL_PARTS).toEqual([
            'sky',
            'cave',
            'jungle',
            'beam',
            'mist',
            'water',
            'roots',
            'birds',
            'gours',
        ]);
    });

    it('defines 5 normalized solar-shaft stations and 4 subterranean micro-weathers', () => {
        expect(SUNFALL_STATIONS).toHaveLength(5);
        for (const st of SUNFALL_STATIONS) {
            const len = Math.hypot(st.sunDir[0], st.sunDir[1], st.sunDir[2]);
            expect(len).toBeCloseTo(1.0, 5);
            expect(st.sunDir[1]).toBeGreaterThan(0.9);
        }
        expect(SUNFALL_WEATHERS).toHaveLength(4);
    });

    it('interpolates stations smoothly across level progression and fractional station coordinates', () => {
        expect(stationIndexForLevel(1)).toBe(0);
        expect(stationIndexForLevel(6)).toBe(0);

        const s0 = sampleStation(0);
        const sMid = sampleStation(1.5);
        const sTop = sampleStation(4.2);
        expect(Math.hypot(...s0.sunDir)).toBeCloseTo(1.0, 5);
        expect(Math.hypot(...sMid.sunDir)).toBeCloseTo(1.0, 5);
        expect(Math.hypot(...sTop.sunDir)).toBeCloseTo(1.0, 5);
        expect(s0.beamWarmth).not.toBe(sTop.beamWarmth);
    });

    it('samples and crossfades micro-weather states deterministically', () => {
        const wShower = sampleWeather('shower');
        expect(wShower.id).toBe('shower');
        expect(wShower.dripScale).toBeCloseTo(1.45, 4);

        const wBlend = sampleWeather('clear', 'cloud', 0.5);
        expect(wBlend.dripScale).toBeGreaterThan(0);
        expect(wBlend.cloudOpacity).toBeGreaterThan(0.5);
    });

    it('evaluates sunlitAt inside and outside the oculus projection footprint', () => {
        const sunDir = SUNFALL_STATIONS[1].sunDir;
        const inPool = sunlitAt(14, -22, -96, sunDir, 0.9);
        const farWall = sunlitAt(-80, 10, -40, sunDir, 0.9);

        expect(inPool).toBeGreaterThan(0.75);
        expect(farWall).toBeCloseTo(0, 5);
    });

    it('solves solveBowSun so dlBowCpu peaks near the 41.3-degree primary rainbow angle', () => {
        const camToSheet = [18, -8, -108];
        const bowSun = solveBowSun(camToSheet);
        expect(Math.hypot(...bowSun)).toBeCloseTo(1.0, 5);

        const len = Math.hypot(...camToSheet);
        const viewRay = camToSheet.map((v) => v / len);
        const cosTheta = -(
            viewRay[0] * bowSun[0]
            + viewRay[1] * bowSun[1]
            + viewRay[2] * bowSun[2]
        );
        expect(cosTheta).toBeCloseTo(Math.cos((41.3 * Math.PI) / 180), 3);

        const primaryRgb = dlBowCpu(0.751);
        const offAngleRgb = dlBowCpu(0.2);
        expect(primaryRgb[1]).toBeGreaterThan(0.85);
        expect(offAngleRgb[0] + offAngleRgb[1] + offAngleRgb[2]).toBeLessThan(0.01);
    });

    it('computes botanical delayed greening from young piece swatch to mature emerald', () => {
        expect(greeningTau(0)).toBeCloseTo(14, 5);
        expect(greeningTau(1)).toBeCloseTo(24, 5);

        const fresh = leafTintAtAge('I', 0, 19);
        const aged = leafTintAtAge('I', 250, 19);
        expect(fresh[0]).toBeCloseTo(PIECE_SWATCH_RGB.I[0], 3);
        expect(aged[0]).toBeCloseTo(MATURE_LEAF_RGB[0], 2);
        expect(aged[1]).toBeCloseTo(MATURE_LEAF_RGB[1], 2);
    });

    it('packs and unpacks piece codes losslessly and maps board cells to doline coordinates', () => {
        const codes = ['I', 'O', 'T', 'S', 'Z', 'J'];
        const packed = packCodes(codes);
        const unpackedIndices = unpackCodes(packed, codes.length);
        expect(unpackedIndices.map((i) => PIECE_CODES[i])).toEqual(codes);

        const cells = cellsFromMatrix([[1, 1], [0, 1]], 'T', 3, 10);
        expect(cells).toHaveLength(3);
        expect(cells[0]).toMatchObject({ col: 3, row: 10, code: 'T' });

        const worldPt = boardCellToDolineWorld(5, 10);
        expect(worldPt).toHaveLength(3);
        expect(worldPt[2]).toBeLessThan(-50);
    });

    it('plans deterministic doline geometry and reproducible mulberry32 sequences', () => {
        const rngA = mulberry32(SUNFALL_SEED);
        const rngB = mulberry32(SUNFALL_SEED);
        expect(rngA()).toBe(rngB());
        expect(rngA()).toBe(rngB());

        const preset = resolveSunfallQuality('High');
        const plan1 = planDoline(SUNFALL_SEED, preset);
        const plan2 = planDoline(SUNFALL_SEED, preset);
        expect(plan1.curtains.length).toBe(preset.fringeCurtains);
        expect(plan1.swifts.length).toBe(preset.swiftCount);
        expect(plan1.gours.length).toBe(preset.gourPools);
        expect(plan1.gours[0]).toEqual(plan2.gours[0]);
    });
});
