import { describe, expect, it } from 'vitest';
import { buildPlan, pointedArc } from '../../src/themes/ice-temple/ice-temple-plan.js';
import {
    AURORA_PALETTES, CLEAR_DEPTH, CLEAR_TRAVEL, FLAKE_GROW, LOCK_REACH, MOON, NAVE, REST_RIG, SHADOW_ROWS,
    clearFrontDepth, clearPassTime, flakeGrowth, fovForAspect, linRGB, lockShellRadius, moonShadowAt, pieceColor,
    resonanceForCombo,
} from '../../src/themes/ice-temple/ice-temple-core.js';
import {
    BOARD_GRID, boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer,
} from '../../src/themes/ice-temple/ice-temple-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/ice-temple/ice-temple-quality.js';

const finite = (list) => list.every((v) => Number.isFinite(v));

describe('ice temple plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const a = buildPlan(7);
        const b = buildPlan(7);
        const c = buildPlan(8);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    });

    it('stands a nave of column pairs, an aisle either side and an apse round the Great Crystal', () => {
        const plan = buildPlan();
        const nave = plan.columns.filter((c) => c.kind === 'nave');
        const aisle = plan.columns.filter((c) => c.kind === 'aisle');
        const apse = plan.columns.filter((c) => c.kind === 'apse');
        expect(nave).toHaveLength(NAVE.pairs * 2);
        expect(aisle).toHaveLength(NAVE.aislePairs * 2);
        expect(apse).toHaveLength(NAVE.apseColumns);
        // Every nave column has its twin across the centre line.
        for (let k = 0; k < NAVE.pairs; k++) {
            const pair = nave.filter((c) => c.z === NAVE.firstZ - k * NAVE.bay);
            expect(pair.map((c) => c.x).sort((x, y) => x - y)).toEqual([-NAVE.halfWidth, NAVE.halfWidth]);
        }
        // The aisles stand outside the nave, half a bay on, so they show between its columns.
        aisle.forEach((c) => {
            expect(Math.abs(c.x)).toBeGreaterThan(NAVE.halfWidth + 8);
            expect(((NAVE.firstZ - c.z) / NAVE.bay) % 1).toBeCloseTo(0.5, 5);
        });
        // The apse closes the far end, beyond the last pair, with the heart inside it.
        const lastPair = NAVE.firstZ - (NAVE.pairs - 1) * NAVE.bay;
        apse.forEach((c) => {
            expect(c.z).toBeLessThan(lastPair);
            expect(Math.hypot(c.x, c.z - NAVE.apseZ)).toBeCloseTo(NAVE.apseRadius, 5);
        });
        expect(NAVE.heartZ).toBeLessThan(NAVE.apseZ);
        expect(Math.abs(NAVE.heartZ - NAVE.apseZ)).toBeLessThan(NAVE.apseRadius);
    });

    it('keeps the board\'s lane clear: nothing stands on the centre line before the apse', () => {
        const plan = buildPlan();
        plan.columns.filter((c) => c.kind !== 'apse').forEach((c) => {
            expect(Math.abs(c.x) - c.radius * 1.6).toBeGreaterThan(8);
        });
        plan.crystals.filter((c) => c.kind === 'shard' && c.base[2] > NAVE.apseZ + 20).forEach((c) => {
            expect(Math.abs(c.base[0])).toBeGreaterThan(7);
        });
    });

    it('springs every transverse arch from its pair and brings it to a point overhead', () => {
        const plan = buildPlan();
        const arches = plan.ribs.filter((r) => r.kind === 'transverse');
        expect(arches).toHaveLength(NAVE.pairs);
        arches.forEach((arch) => {
            const first = arch.points[0];
            const last = arch.points[arch.points.length - 1];
            expect(first[0]).toBeCloseTo(-NAVE.halfWidth, 5);
            expect(last[0]).toBeCloseTo(NAVE.halfWidth, 5);
            expect(first[1]).toBeCloseTo(NAVE.springHeight, 5);
            expect(last[1]).toBeCloseTo(NAVE.springHeight, 5);
            const crown = arch.points.reduce((best, p) => (p[1] > best[1] ? p : best));
            expect(crown[0]).toBeCloseTo(0, 5);
            expect(crown[1]).toBeCloseTo(NAVE.apexHeight, 5);
        });
    });

    it('draws a pointed arc: it leaves the springing upright and meets its twin at an angle', () => {
        const arc = pointedArc(11, 13, 24);
        expect(arc[0][0]).toBeCloseTo(0, 6);
        expect(arc[0][1]).toBeCloseTo(0, 6);
        expect(arc[24][0]).toBeCloseTo(11, 6);
        expect(arc[24][1]).toBeCloseTo(13, 6);
        // Upright at the foot...
        expect(Math.abs(arc[1][0] - arc[0][0])).toBeLessThan((arc[1][1] - arc[0][1]) * 0.2);
        // ...and still climbing where it meets the other half (a round arch would be level there).
        expect(arc[24][1] - arc[23][1]).toBeGreaterThan((arc[24][0] - arc[23][0]) * 0.15);
    });

    it('hangs icicles below ribs and capitals, and never through the floor', () => {
        const plan = buildPlan();
        expect(plan.icicles.length).toBeGreaterThan(400);
        plan.icicles.forEach((i) => {
            expect(finite([i.x, i.y, i.z, i.length, i.radius])).toBe(true);
            expect(i.length).toBeGreaterThan(0.25);
            expect(i.y - i.length).toBeGreaterThan(4);
            expect(i.radius).toBeLessThan(i.length);
        });
    });

    it('grows the Great Crystal tallest in the middle, and every crystal from finite numbers', () => {
        const plan = buildPlan();
        const heart = plan.crystals.filter((c) => c.kind === 'heart');
        expect(heart.length).toBeGreaterThan(8);
        const tallest = heart.reduce((best, c) => (c.length > best.length ? c : best));
        expect(Math.hypot(tallest.base[0], tallest.base[2] - NAVE.heartZ)).toBeLessThan(0.5);
        expect(tallest.length).toBeGreaterThan(NAVE.springHeight);
        plan.crystals.forEach((c) => {
            expect(finite([...c.base, ...c.dir, c.length, c.radius, c.seed])).toBe(true);
            expect(c.length).toBeGreaterThan(0);
            expect(c.radius).toBeGreaterThan(0);
            expect(Math.hypot(...c.dir)).toBeGreaterThan(0.9);
        });
    });

    it('breaks some aisle columns and leaves what fell beside them, with no flying rib to a stump', () => {
        const plan = buildPlan();
        const broken = plan.columns.filter((c) => c.broken);
        expect(broken).toHaveLength(4);
        expect(broken.filter((c) => c.x < 0)).toHaveLength(2);
        broken.forEach((c) => {
            expect(c.kind).toBe('aisle');
            expect(c.height).toBeLessThan(NAVE.aisleHeight * 0.7);
        });
        const flying = plan.ribs.filter((r) => r.kind === 'flying');
        expect(flying).toHaveLength(NAVE.aislePairs * 2 - broken.length);
    });
});

describe('ice temple core: closed forms', () => {
    it('holds a ninety-degree horizontal view, clamped for very wide and very tall frames', () => {
        expect(fovForAspect(16 / 9)).toBeCloseTo(58.7, 1);
        expect(fovForAspect(3.6)).toBe(REST_RIG.minFov);
        expect(fovForAspect(0.46)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(NaN)).toBeCloseTo(58.7, 1);
    });

    it('runs a lock shell out fast and lets it settle at its reach', () => {
        expect(lockShellRadius(0)).toBe(0);
        expect(lockShellRadius(-1)).toBe(0);
        expect(lockShellRadius(0.2)).toBeGreaterThan(LOCK_REACH * 0.3);
        expect(lockShellRadius(0.2)).toBeLessThan(lockShellRadius(0.6));
        expect(lockShellRadius(10)).toBeCloseTo(LOCK_REACH, 3);
    });

    it('sends a clear from the heart to the camera in CLEAR_TRAVEL seconds', () => {
        expect(clearFrontDepth(0)).toBe(CLEAR_DEPTH);
        expect(clearFrontDepth(CLEAR_TRAVEL)).toBe(0);
        expect(clearFrontDepth(CLEAR_TRAVEL * 0.5)).toBeGreaterThan(0);
        // The two descriptions of the wave agree: the front is at z when it passes z.
        for (const z of [-90, -60, -30, -10]) {
            expect(clearFrontDepth(clearPassTime(z))).toBeCloseTo(-z, 6);
        }
        expect(clearPassTime(-CLEAR_DEPTH)).toBeCloseTo(0, 9);
        expect(clearPassTime(0)).toBeCloseTo(CLEAR_TRAVEL, 9);
    });

    it('builds resonance with the combo and never past one', () => {
        expect(resonanceForCombo(0)).toBe(0);
        let last = 0;
        for (let n = 1; n <= 20; n++) {
            const r = resonanceForCombo(n);
            expect(r).toBeGreaterThan(last);
            expect(r).toBeLessThan(1);
            last = r;
        }
        expect(resonanceForCombo(8)).toBeGreaterThan(0.85);
    });

    it('grows the Great Snowflake fast at first and stops at full size', () => {
        expect(flakeGrowth(0)).toBe(0);
        expect(flakeGrowth(FLAKE_GROW * 0.5)).toBeGreaterThan(0.8);
        expect(flakeGrowth(FLAKE_GROW)).toBe(1);
        expect(flakeGrowth(FLAKE_GROW * 3)).toBe(1);
    });

    it('gives a piece its colour, peak-normalised, with a floor in every channel', () => {
        const cyan = pieceColor('#00ffff');
        expect(Math.max(...cyan)).toBeCloseTo(1, 6);
        expect(Math.min(...cyan)).toBeGreaterThan(0.09);
        expect(pieceColor(0xff0000)[0]).toBeCloseTo(1, 6);
        expect(pieceColor('not a colour', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(null)).toHaveLength(3);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
    });

    it('names five auroras, each with its border, body, fringe and heart', () => {
        expect(AURORA_PALETTES).toHaveLength(5);
        expect(new Set(AURORA_PALETTES.map((p) => p.name)).size).toBe(5);
        AURORA_PALETTES.forEach((p) => {
            [p.a, p.b, p.c, p.heart].forEach((hex) => {
                expect(Number.isInteger(hex)).toBe(true);
                expect(Math.max(...linRGB(hex))).toBeGreaterThan(0.5);
            });
        });
    });

    it('puts the moon low over the left colonnade, ahead of the camera', () => {
        expect(Math.hypot(...MOON.dir)).toBeCloseTo(1, 6);
        expect(MOON.dir[0]).toBeLessThan(-0.3);
        expect(MOON.dir[1]).toBeGreaterThan(0.2);
        expect(MOON.dir[1]).toBeLessThan(0.6);
        expect(MOON.dir[2]).toBeLessThan(0);
        expect(Math.hypot(...MOON.flat)).toBeCloseTo(1, 6);
    });

    it('throws the colonnade\'s shadows across the nave, away from the moon', () => {
        expect(SHADOW_ROWS).toHaveLength(4);
        const [lx, lz] = MOON.flat;
        const column = { x: -NAVE.halfWidth, z: NAVE.firstZ - 2 * NAVE.bay };
        // Six metres down-light of a left column: in its shadow.
        expect(moonShadowAt(column.x - lx * 6, 0, column.z - lz * 6)).toBeLessThan(0.05);
        // Moonward of every row nothing stands in the light's way.
        expect(moonShadowAt(-NAVE.aisleHalf - 12, 0, column.z)).toBe(1);
        // Between two shadows the floor is lit.
        expect(moonShadowAt(column.x - lx * 6, 0, column.z - lz * 6 - NAVE.bay / 2)).toBeGreaterThan(0.95);
        // High above the capitals the moon is unobstructed.
        expect(moonShadowAt(column.x - lx * 6, 60, column.z - lz * 6)).toBeGreaterThan(0.95);
        // A shadow's edge softens with distance from the column that throws it: a point just
        // outside the column's radius is lit close to it and in the penumbra far from it.
        const beside = (s) => {
            const off = NAVE.columnRadius + 0.12;
            // Fifteen metres up: above the aisle row, whose own shadows cross the same ground.
            return moonShadowAt(column.x - lx * s + lz * off, 15, column.z - lz * s - lx * off);
        };
        expect(beside(1.5)).toBeGreaterThan(0.97);
        expect(beside(16)).toBeLessThan(0.9);
        expect(beside(16)).toBeGreaterThan(0.3);
    });
});

describe('ice temple composition', () => {
    it('lays the solo board out from the stylesheet\'s own formulas when no card is on screen', () => {
        const layout = fallbackLayout(1600, 900);
        expect(layout.cardCount).toBe(0);
        const card = layout.cards[0];
        expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 6);
        expect(card.x1 - card.x0).toBeGreaterThan(0.18);
        expect(card.x1 - card.x0).toBeLessThan(0.3);
        const board = boardFor(layout, 0);
        expect(board.x0).toBeGreaterThan(card.x0);
        expect(board.x1).toBeLessThan(card.x1);
        expect(board.y1).toBeLessThan(card.y1);
        expect(layout.hud.x0).toBeGreaterThan(card.x1);
    });

    it('maps a board column and row to the screen, clamped to the playfield', () => {
        const board = {
            x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
        };
        expect(boardPoint(board, 0, 0)).toMatchObject({ x: 0.4 });
        expect(boardPoint(board, 1, 0).x).toBeCloseTo(0.6, 9);
        expect(boardPoint(board, 0.5, BOARD_GRID.rows - 1).y).toBeCloseTo(0.9 - 0.8 / BOARD_GRID.rows / 2, 9);
        expect(boardPoint(board, 5, 99).x).toBeCloseTo(0.6, 9);
        expect(boardPoint(board, -5, -9).y).toBeCloseTo(0.1 + 0.8 / BOARD_GRID.rows / 2, 9);
    });

    it('falls back to the first board on screen for a player that has none of its own', () => {
        const layout = fallbackLayout(1600, 900);
        expect(boardFor(layout, 3)).toBe(layout.boards[0]);
        expect(boardFor(null, 0)).toBeNull();
        expect(cardUnion(null)).toBeNull();
    });

    it('unites several cards and notices when a layout moves', () => {
        const a = fallbackLayout(1600, 900);
        const b = fallbackLayout(1600, 900);
        expect(layoutsDiffer(a, b)).toBe(false);
        b.cards.push({
            x0: 0.7, y0: 0.2, x1: 0.9, y1: 0.8,
        });
        expect(layoutsDiffer(a, b)).toBe(true);
        const union = cardUnion(b);
        expect(union.x1).toBeCloseTo(0.9, 9);
        expect(union.x0).toBeCloseTo(a.cards[0].x0, 9);
        expect(layoutsDiffer(a, null)).toBe(true);
        expect(layoutsDiffer(null, null)).toBe(false);
    });
});

describe('ice temple quality tiers', () => {
    it('names six tiers and falls back to High', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        expect(tierFor('nonsense')).toBe(QUALITY.High);
    });

    it('never asks a higher tier for less than a lower one', () => {
        const keys = ['reflection', 'veils', 'bubbles', 'curtains', 'snow', 'dust', 'mist', 'shards'];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const lower = QUALITY[QUALITY_NAMES[i - 1]];
            const higher = QUALITY[QUALITY_NAMES[i]];
            keys.forEach((key) => {
                expect(higher[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(lower[key]);
            });
        }
    });

    it('mirrors the temple in the ice only from Medium up', () => {
        expect(QUALITY.Minimal.reflection).toBe(0);
        expect(QUALITY.Low.reflection).toBe(0);
        expect(QUALITY.Medium.reflection).toBeGreaterThan(0);
        expect(QUALITY.Extreme.reflection).toBeLessThanOrEqual(1);
    });
});
