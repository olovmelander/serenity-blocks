/**
 * The palette gate (scripts/palette-guideline-check.mjs): every piece palette is the game's own.
 * Two passes over the hue each shape usually wears, the second with the bands opened by twelve
 * degrees, so a palette cannot pass by sitting just outside a band.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MAX_USUAL, SHAPES, USUAL_BANDS, WIDEN_DEGREES, hexToHue, inBands, screenPalette, screenRepository,
    usualShapes,
} from '../../scripts/palette-guideline-check.mjs';
import { KALEIDOSONIC_TETROMINOS } from '../../src/themes/kaleidosonic/kaleidosonic-tetrominos.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from '../../src/themes/synthwave-sunset/synthwave-sunset-tetrominos.js';
import { VESPER_CHRYSALIS_TETROMINOS } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tetrominos.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pieces = (config) => Object.fromEntries(SHAPES.map((shape) => [shape, config.colors[shape]]));
const sorted = (colours) => colours.map((c) => c.toLowerCase()).sort();

describe('palette gate: the hue screen', () => {
    it('fails above three of seven, and opens the second pass by twelve degrees', () => {
        expect(MAX_USUAL).toBe(3);
        expect(WIDEN_DEGREES).toBe(12);
    });

    it('reads a hue in degrees and never counts a grey', () => {
        expect(hexToHue('#ff0000')).toBe(0);
        expect(hexToHue('#00ffff')).toBe(180);
        expect(hexToHue('#0000ff')).toBe(240);
        expect(hexToHue('#808080')).toBeNull();
        expect(inBands(hexToHue('#f2f2f2'), USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(false);
    });

    it('opens every band on both sides in the widened pass', () => {
        // I: 160 to 210 exact, 148 to 222 widened.
        expect(inBands(210, USUAL_BANDS.I)).toBe(true);
        expect(inBands(211, USUAL_BANDS.I)).toBe(false);
        expect(inBands(222, USUAL_BANDS.I, WIDEN_DEGREES)).toBe(true);
        expect(inBands(223, USUAL_BANDS.I, WIDEN_DEGREES)).toBe(false);
        expect(inBands(148, USUAL_BANDS.I, WIDEN_DEGREES)).toBe(true);
        expect(inBands(147, USUAL_BANDS.I, WIDEN_DEGREES)).toBe(false);
    });

    it('wraps the red band round the top of the hue circle', () => {
        // Z: 320 to 360 and 0 to 20 exact; 308 to 32 through zero when widened.
        expect(inBands(319, USUAL_BANDS.Z)).toBe(false);
        expect(inBands(308, USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(true);
        expect(inBands(307, USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(false);
        expect(inBands(359.5, USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(true);
        expect(inBands(32, USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(true);
        expect(inBands(33, USUAL_BANDS.Z, WIDEN_DEGREES)).toBe(false);
        // A band opened below zero carries on at the top of the circle.
        expect(inBands(355, [[5, 30]], WIDEN_DEGREES)).toBe(true);
        expect(inBands(5, [[330, 358]], WIDEN_DEGREES)).toBe(true);
    });

    it('catches a palette that sits just outside the exact bands', () => {
        // Each colour a few degrees off its shape's band: clean on the exact pass, not the second.
        const nearMiss = {
            I: '#2e9fe6', // 203: in
            O: '#ff9d3f', // 29: under the band by 3
            T: '#e832a4', // 322: over the band by 7
            S: '#2ee6cc', // 172: over the band by 2
            Z: '#ff7b45', // 17: in
            J: '#7b4dff', // 255.5: over the band by 5.5
            L: '#ffd23f', // 46: in
        };
        const result = screenPalette('near miss', nearMiss);
        expect(result.exact).toEqual(['I', 'Z', 'L']);
        expect(result.widened).toEqual(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
        expect(result.failed).toBe(true);
    });

    it('passes a palette at three of seven in both passes, and fails it at four', () => {
        const usual = {
            I: '#00e0e0', O: '#ffd000', T: '#a000ff', S: '#00d040', Z: '#ff0000', J: '#0040ff', L: '#ff8000',
        };
        expect(screenPalette('all usual', usual).exact).toHaveLength(7);
        // Three kept (I, O, T), the other four dealt round among themselves.
        const three = {
            ...usual, S: usual.Z, Z: usual.J, J: usual.L, L: usual.S,
        };
        expect(screenPalette('three', three)).toMatchObject({
            exact: ['I', 'O', 'T'], widened: ['I', 'O', 'T'], failed: false,
        });
        const four = { ...three, S: usual.S, L: usual.Z };
        expect(screenPalette('four', four)).toMatchObject({ exact: ['I', 'O', 'T', 'S'], failed: true });
    });
});

describe('palette gate: the game\'s palettes', () => {
    const { results, warnings } = screenRepository(repoRoot);

    it('screens the default palette and every theme\'s', () => {
        expect(results.length).toBeGreaterThanOrEqual(64);
        expect(results[0].name).toContain('src/core/constants.js');
        expect(results.every((result) => result.complete)).toBe(true);
        expect(warnings).toEqual([]);
    });

    it('finds no palette above three of seven in either pass', () => {
        const over = results
            .filter((result) => result.exact.length > MAX_USUAL || result.widened.length > MAX_USUAL)
            .map((result) => `${result.name}: exact ${result.exact.length}, widened ${result.widened.length}`);
        expect(over).toEqual([]);
    });

    it('exits clean from the command line, the summary last', () => {
        const run = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'palette-guideline-check.mjs')], {
            cwd: repoRoot, encoding: 'utf8',
        });
        expect(run.status).toBe(0);
        expect(run.stdout.trim().split(/\r?\n/).pop()).toMatch(
            /^palette-gate: \d+ palettes screened; over 3\/7: 0 on the exact bands, 0 on the bands widened by 12°/,
        );
    });
});

describe('palette gate: three palettes dealt anew', () => {
    // Each world keeps its seven colours; they moved between the pieces.
    const cases = [
        ['Kaleidosonic', KALEIDOSONIC_TETROMINOS,
            ['#2EE6D0', '#FFD23F', '#E8329E', '#15A05A', '#FF8A45', '#7B4DFF', '#5AB0FF']],
        ['Synthwave Sunset', SYNTHWAVE_SUNSET_TETROMINOS,
            ['#FFD36E', '#FF9440', '#F24FAE', '#6CF5C9', '#D92B4A', '#4FB4FF', '#8A55F5']],
        ['Vesper Chrysalis', VESPER_CHRYSALIS_TETROMINOS,
            ['#9fe8ff', '#ffb347', '#e0629a', '#8a5cff', '#ff7a1a', '#c8f4ff', '#ffd88a']],
    ];

    it.each(cases)('%s keeps its own seven colours', (_name, config, colours) => {
        expect(sorted(Object.values(pieces(config)))).toEqual(sorted(colours));
    });

    it.each(cases)('%s puts no piece in its usual hue, in either pass', (_name, config) => {
        expect(usualShapes(pieces(config), 0)).toEqual([]);
        expect(usualShapes(pieces(config), WIDEN_DEGREES)).toEqual([]);
    });

    it.each(cases)('%s in the order it used to have would fail the widened pass', (_name, _config, colours) => {
        const before = Object.fromEntries(SHAPES.map((shape, i) => [shape, colours[i]]));
        const result = screenPalette('before', before);
        expect(result.exact.length).toBeLessThanOrEqual(MAX_USUAL);
        expect(result.widened.length).toBeGreaterThan(MAX_USUAL);
    });
});
