import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    PIECE_CODE, PIECE_COLORS, PIECE_ORDER, approach, cellsFromMatrix, clamp, hash2, hexToLinear, mulberry32, pieceCode,
    smooth,
} from '../../src/themes/spring/spring-core.js';
import {
    EYE, EYE_GROUND, FALL, LEDGES, RIG, RIVER, RIVER_POINTS, S_LIP, S_OUTLET, S_POOL, THROW, bearingOf, courseAt,
    levelAt, riverNearest, rigFor, speedAt, turbulenceAt,
} from '../../src/themes/spring/spring-plan.js';
import {
    GRIDS, KNOLL, VALLEY_SCHEMA, decodeValley, encodeValley, forestCover, groundHeight, knollOutside, terrainHeight,
} from '../../src/themes/spring/spring-terrain.js';
import { SPRING_FLOWERS, springFlowerSlotForPiece } from '../../src/themes/spring/spring-flowers.js';
import { LANDINGS, poolBoil } from '../../src/themes/spring/spring-fall-plan.js';
import { SPRING_TETROMINOS } from '../../src/themes/spring/spring-tetrominos.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// CIELAB ΔE76 under Machado 2009 full-severity simulation, applied in linear RGB (PLAYBOOK §2.8).
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function lab(rgbS) {
    const [r, g, b] = rgbS.map(lin);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const CVD = {
    none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (rgbS, m) => {
    const l = rgbS.map(lin);
    return m.map((row) => gam(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
};
/** Half the frame's width at a 16:9 landscape lens (degrees). */
const HALF_WIDE = Math.atan(Math.tan((RIG.landscape.fov * Math.PI) / 360) * (16 / 9)) * (180 / Math.PI);

describe('spring core: the pieces and their flowers', () => {
    it('keeps the piece colours in step with the board palette', () => {
        PIECE_ORDER.forEach((piece, code) => {
            expect(PIECE_COLORS[code].toUpperCase()).toBe(SPRING_TETROMINOS.colors[piece].toUpperCase());
        });
        expect(pieceCode('t')).toBe(PIECE_CODE.T);
        expect(pieceCode('?')).toBe(PIECE_CODE.GARBAGE);
        expect(pieceCode(null)).toBe(PIECE_CODE.GARBAGE);
    });

    it('keeps the pieces apart under every colour-vision simulation (worst ΔE > 14) and light on the card', () => {
        for (const [mode, matrix] of Object.entries(CVD)) {
            const labs = SHAPES.map((key) => lab(simulate(rgbOf(SPRING_TETROMINOS.colors[key]), matrix)));
            let worst = Infinity;
            for (let i = 0; i < labs.length; i++) {
                for (let j = i + 1; j < labs.length; j++) {
                    worst = Math.min(worst, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])));
                }
            }
            expect(worst, mode).toBeGreaterThan(14);
        }
        for (const key of SHAPES) expect(lab(rgbOf(SPRING_TETROMINOS.colors[key]))[0], key).toBeGreaterThanOrEqual(50);
    });

    it('gives every piece its own flower, and every flower a glow slot of its own', () => {
        expect(SPRING_FLOWERS).toHaveLength(7);
        expect(new Set(SPRING_FLOWERS.map((f) => f.piece))).toEqual(new Set(SHAPES));
        expect(SPRING_FLOWERS.map((f) => f.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        for (const flower of SPRING_FLOWERS) expect(springFlowerSlotForPiece(flower.piece)).toBe(flower.slot);
        expect(springFlowerSlotForPiece('t')).toBe(SPRING_FLOWERS.find((f) => f.piece === 'T').slot);
        expect(springFlowerSlotForPiece('GARBAGE')).toBe(-1);
        expect(springFlowerSlotForPiece(null)).toBe(-1);
        // The marsh marigold keeps to the water's edge; the anemone carpets are the commonest.
        expect(SPRING_FLOWERS.find((f) => f.id === 'marigold').wet).toBe(1);
        const anemone = SPRING_FLOWERS.find((f) => f.id === 'anemone');
        expect(Math.max(...SPRING_FLOWERS.map((f) => f.share))).toBe(anemone.share);
    });

    it('reads piece matrices as four centred cells', () => {
        expect(cellsFromMatrix([[1, 1, 1, 1]])).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(cellsFromMatrix([[0, 0], [0, 0]])).toBeNull();
        expect(cellsFromMatrix('x')).toBeNull();
    });

    it('has deterministic small maths', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 5; i++) expect(a()).toBe(b());
        expect(hash2(3, 4)).toBe(hash2(3, 4));
        expect(hash2(3, 4)).not.toBe(hash2(4, 3));
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(1, 1, 0.5)).toBe(0);
        expect(approach(2, 0)).toBe(0);
        expect(clamp(Number.NaN, 0, 1)).toBe(0);
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
    });
});

describe('spring plan: the river', () => {
    it('falls over the lip, lands in the pool and drains into the rapids, in that order', () => {
        expect(S_LIP).toBeGreaterThan(0);
        expect(S_POOL).toBeCloseTo(S_LIP + THROW, 6);
        expect(S_OUTLET).toBeGreaterThan(S_POOL);
        expect(S_OUTLET + LEDGES[LEDGES.length - 1].at).toBeLessThan(RIVER.length);
        expect(FALL.lip - FALL.pool).toBe(FALL.drop);
    });

    it('frames the fall in the left third of a landscape screen, nearly facing the eye', () => {
        const [lx, lz] = RIVER_POINTS[6];
        const bearing = bearingOf(lx, lz);
        expect(bearing).toBeLessThan(-12);
        expect(bearing).toBeGreaterThan(-HALF_WIDE + 6);
        const lip = courseAt(S_LIP, {});
        const toEye = [EYE.x - lip.x, EYE.z - lip.z];
        const facing = (lip.tx * toEye[0] + lip.tz * toEye[1]) / Math.hypot(...toEye);
        expect(facing).toBeGreaterThan(Math.cos((20 * Math.PI) / 180));
    });

    it('swings round under the knoll and leaves down the valley on the right of the frame', () => {
        // The bend's apex: the course's nearest point to the eye, in front of it.
        const near = riverNearest(EYE.x, EYE.z, {});
        expect(Math.abs(bearingOf(near.px, near.pz))).toBeLessThan(15);
        expect(near.dist).toBeLessThan(40);
        // Half a kilometre down from the bend the river stands in the right of the frame.
        const away = courseAt(near.s + 500, {});
        const bearing = bearingOf(away.x, away.z);
        expect(bearing).toBeGreaterThan(14);
        expect(bearing).toBeLessThan(HALF_WIDE);
    });

    it('never runs uphill: the water level only falls from the lip down the rapids and away', () => {
        let previous = levelAt(S_LIP - 20);
        for (let s = S_LIP - 20; s < RIVER.length - 1; s += 0.5) {
            const level = levelAt(s);
            expect(level).toBeLessThanOrEqual(previous + 1e-9);
            previous = level;
        }
        expect(levelAt(S_POOL + 2)).toBeCloseTo(FALL.pool, 6);
        expect(levelAt(S_LIP - 1)).toBeGreaterThan(FALL.lip);
    });

    it('runs fast and white below the fall and in the rapids, quiet up the valley', () => {
        // The pool boils where the main tongue lands (spring-fall-plan.js), calmer downstream.
        const main = LANDINGS.reduce((a, b) => (b.power > a.power ? b : a));
        expect(poolBoil(main.along, main.across)).toBeGreaterThan(0.85);
        expect(poolBoil(main.along + 40, main.across)).toBeLessThan(poolBoil(main.along, main.across) * 0.5);
        expect(turbulenceAt(S_LIP - 200)).toBeLessThan(0.1);
        expect(speedAt(S_LIP + THROW * 0.9)).toBeGreaterThan(speedAt(S_LIP - 100));
        const jump = S_OUTLET + LEDGES[1].at + 1;
        expect(turbulenceAt(jump)).toBeGreaterThan(turbulenceAt(jump + 25));
    });

    it('finds the nearest point of the river, signed across it', () => {
        const c = courseAt(S_OUTLET + 30, {});
        const on = riverNearest(c.x, c.z, {});
        expect(on.dist).toBeLessThan(0.5);
        expect(Math.abs(on.s - (S_OUTLET + 30))).toBeLessThan(1);
        const off = riverNearest(c.x - c.tz * 6, c.z + c.tx * 6, {});
        expect(off.n).toBeCloseTo(6, 0);
    });

    it('chooses its lens by aspect', () => {
        expect(rigFor(16 / 9)).toBe(RIG.landscape);
        expect(rigFor(21 / 9)).toBe(RIG.wide);
        expect(rigFor(390 / 844)).toBe(RIG.portrait);
        expect(rigFor(Number.NaN)).toBe(RIG.landscape);
    });
});

describe('spring terrain: the valley', () => {
    it('stands the eye on the knoll, some metres above the water swinging round under it', () => {
        expect(terrainHeight(EYE.x, EYE.z)).toBeCloseTo(EYE_GROUND, 0);
        expect(EYE.y - EYE_GROUND).toBeCloseTo(1.6, 6);
        const near = riverNearest(EYE.x, EYE.z, {});
        const drop = EYE_GROUND - levelAt(near.s);
        expect(drop).toBeGreaterThan(3.5);
        expect(drop).toBeLessThan(8);
        expect(knollOutside(EYE.x, EYE.z)).toBeLessThan(-KNOLL.rz * 0.5);
    });

    it('pours the river over a granite step: the upper level holds behind the lip and drops below it', () => {
        const lip = courseAt(S_LIP, {});
        const at = (along, across) => terrainHeight(
            lip.x - lip.tz * across + lip.tx * along,
            lip.z + lip.tx * across + lip.tz * along,
        );
        const side = lip.halfWidth + 8;
        for (const s of [-1, 1]) {
            // Behind the step's own (hidden) drop the ground holds the upper level, and beside the
            // lip it rises into the shoulders of the notch the river has cut.
            expect(at(-12, s * side)).toBeGreaterThan(FALL.lip - 3);
            expect(at(-12, s * (lip.halfWidth + 6))).toBeGreaterThan(FALL.lip + 2);
            // The gorge's floor below the fall.
            expect(at(THROW + 3, 0)).toBeLessThan(FALL.pool);
        }
        // From behind the step to the pool: the whole drop, within a dozen metres.
        expect(at(-12, 0) - at(4, 0)).toBeGreaterThan(FALL.drop * 0.6);
    });

    it('keeps the forest off the water and off the knoll\'s flowering top', () => {
        expect(forestCover(EYE.x, EYE.z - 2, 30, EYE_GROUND)).toBe(0);
        expect(forestCover(200, -600, 1, 0)).toBe(0);
        // Somewhere up the slopes there is closed forest.
        let most = 0;
        for (let k = 0; k < 400; k++) most = Math.max(most, forestCover(-300 + k * 2, -400, 200, 80));
        expect(most).toBeGreaterThan(0.8);
    });

    it('round-trips its bake through the asset encoding within a centimetre or two', () => {
        // A small stand-in bake (the real one takes seconds): the same encoding.
        const grid = (spec, layers) => {
            const n = spec.res * spec.res;
            const out = {
                ...spec,
                step: spec.size / (spec.res - 1),
                h: new Float32Array(n),
                edge: layers ? new Float32Array(n) : null,
                level: layers ? new Float32Array(n) : null,
            };
            for (let k = 0; k < n; k++) {
                out.h[k] = Math.sin(k * 0.01) * 40 + k * 0.001;
                if (layers) {
                    out.edge[k] = (k % 997) - 30;
                    out.level[k] = 5 - k * 0.0001;
                }
            }
            return out;
        };
        const baked = {
            near: grid({ ...GRIDS.near, res: 33 }, true),
            mid: grid({ ...GRIDS.mid, res: 17 }, true),
            far: grid({ ...GRIDS.far, res: 9 }, false),
        };
        const back = decodeValley(encodeValley(baked));
        for (const name of ['near', 'mid', 'far']) {
            expect(back[name].res).toBe(baked[name].res);
            for (const key of ['h', 'edge', 'level']) {
                if (!baked[name][key]) continue;
                baked[name][key].forEach((v, k) => expect(Math.abs(back[name][key][k] - v)).toBeLessThan(0.05));
            }
        }
    });

    // Re-run scripts/spring/bake-valley.mjs after a change to the plan or the height function.
    it('ships a valley asset that matches the height function', () => {
        const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
        const baked = decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file))));
        expect(baked.near.res).toBe(GRIDS.near.res);
        expect(baked.mid.res).toBe(GRIDS.mid.res);
        expect(baked.far.res).toBe(GRIDS.far.res);
        const random = mulberry32(0x5a11);
        for (let k = 0; k < 160; k++) {
            const name = ['near', 'mid', 'far'][k % 3];
            const g = baked[name];
            const i = Math.floor(random() * g.res);
            const j = Math.floor(random() * g.res);
            const x = g.x0 + i * g.step;
            const z = g.z0 + j * g.step;
            expect(Math.abs(g.h[j * g.res + i] - terrainHeight(x, z)), `${name} ${i},${j}`).toBeLessThan(0.05);
        }
        // Read through the sampler, the near grid gives way to the far one without a step.
        const edge = GRIDS.near.x0 + GRIDS.near.size;
        let worst = 0;
        let previous = groundHeight(baked, edge - 60, -300);
        for (let x = edge - 60; x < edge + 20; x += 1) {
            const h = groundHeight(baked, x, -300);
            worst = Math.max(worst, Math.abs(h - previous));
            previous = h;
        }
        expect(worst).toBeLessThan(3);
        expect(VALLEY_SCHEMA).toBe(1);
    });
});
