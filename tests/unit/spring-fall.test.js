/**
 * Spring — the fall's plan (spring-fall-plan.js): the lip, the rock face, the water's paths down
 * it, where it lands and bursts; and the woods' impostor atlas's layout (spring-impostors.js).
 */
import { describe, expect, it } from 'vitest';
import {
    BURSTS, LANDINGS, LIP_Y, POOL_Y, POUR, POUR_TIME, RIBS, TONGUES, faceAlong, fallToWorld, lipAlong, lipCrest,
    lipDepth, pourPath, poolBoil, worldToFall,
} from '../../src/themes/spring/spring-fall-plan.js';
import { IMPOSTOR, impostorCells } from '../../src/themes/spring/spring-impostors.js';

/** Every wet column's path, every half metre across the lip. */
const PATHS = (() => {
    const out = [];
    for (let across = -19; across <= 19; across += 0.5) {
        const path = pourPath(across);
        if (path) out.push({ across, path });
    }
    return out;
})();
const pathOf = (across) => PATHS.reduce((a, b) => (Math.abs(b.across - across) < Math.abs(a.across - across) ? b : a));

describe('spring fall: the lip and the rock', () => {
    it('maps its frame to the world and back', () => {
        const p = fallToWorld(7.5, -12.25);
        const back = worldToFall(p.x, p.z);
        expect(back.along).toBeCloseTo(7.5, 9);
        expect(back.across).toBeCloseTo(-12.25, 9);
    });

    it('pours over the lip in tongues, the rock standing dry over the water between them', () => {
        for (const tongue of TONGUES) expect(lipDepth(tongue.at)).toBeGreaterThan(tongue.depth * 0.8);
        // A rib's flanks, beside the threads that spill over its middle, stand over the water.
        for (const rib of RIBS) {
            const flank = rib.at + rib.half * 0.7;
            if (lipDepth(flank) <= 0.02) expect(lipCrest(flank)).toBeGreaterThan(LIP_Y);
        }
        const dry = PATHS.length;
        expect(dry).toBeLessThan(77); // not every column is wet: the ribs part the tongues
    });

    it('keeps the rock behind the water at the brink, and its recess under the main tongue', () => {
        // Where the water comes over (its surface drawn down a quarter of its depth), the rock
        // stands behind the water's face, a film's thickness and a little in from it.
        for (let across = -18; across <= 18; across += 0.5) {
            const depth = lipDepth(across);
            if (depth <= 0.02) continue;
            expect(faceAlong(across, LIP_Y - 0.25 * depth), `across ${across}`)
                .toBeLessThanOrEqual(lipAlong(across) + 0.32);
        }
        const main = TONGUES[0].at;
        expect(faceAlong(main, POOL_Y + 2)).toBeLessThan(faceAlong(main, LIP_Y - 2) - 2);
    });
});

describe('spring fall: the water', () => {
    it('brings every wet column down under the pool within its time', () => {
        expect(PATHS.length).toBeGreaterThan(40);
        for (const { across, path } of PATHS) {
            const end = path[path.length - 1];
            expect(end.y, `across ${across}`).toBeLessThan(POOL_Y);
            expect(end.t, `across ${across}`).toBeLessThan(POUR_TIME);
        }
    });

    it('never runs through the rock, in the air, down a slab or off a ledge', () => {
        for (const { across, path } of PATHS) {
            for (const p of path) {
                if (p.y < POOL_Y - 0.5) continue;
                const clear = p.along - faceAlong(across, p.y);
                expect(clear, `across ${across} at ${p.y.toFixed(2)} m`).toBeGreaterThan(0.05);
            }
        }
    });

    it('leaps free from the main notch, slides down the left stair, lands on the right side\'s ledge', () => {
        const main = pathOf(TONGUES[0].at).path;
        expect(main.every((p) => p.mode === POUR.free)).toBe(true);
        const left = pathOf(TONGUES[1].at).path;
        expect(left.some((p) => p.mode === POUR.slide)).toBe(true);
        expect(Math.max(...left.map((p) => p.white))).toBeGreaterThan(0.5);
        const right = pathOf(TONGUES[2].at).path;
        expect(right.some((p) => p.mode === POUR.run)).toBe(true);
        // It speeds up as it falls.
        expect(main[main.length - 1].speed).toBeGreaterThan(main[0].speed * 4);
    });

    it('lands out from the face and boils there, calming downstream', () => {
        const strongest = LANDINGS.reduce((a, b) => (b.power > a.power ? b : a));
        expect(strongest.along).toBeGreaterThan(4);
        expect(strongest.along).toBeLessThan(11);
        expect(poolBoil(strongest.along, strongest.across)).toBeGreaterThan(0.85);
        expect(poolBoil(strongest.along + 40, strongest.across)).toBeLessThan(0.45);
        expect(poolBoil(strongest.along, 60)).toBe(0);
        expect(BURSTS.length).toBeGreaterThan(4);
        for (const burst of BURSTS) expect(burst.y).toBeGreaterThan(POOL_Y);
    });
});

describe('spring woods: the impostor atlas', () => {
    /** A stand-in for the asset pack: trees with a height, sites and bark bounds. */
    const tree = (height, reach) => ({
        height,
        bark: { boundingBox: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: height * 0.9, z: 0.3 } } },
        sites: {
            count: 2,
            position: new Float32Array([reach, height * 0.6, 0, -reach * 0.5, height * 0.95, 0]),
            scale: new Float32Array([0.8, 0.6]),
        },
    });
    const assets = {
        trees: {
            'birch-grove-a': tree(14, 3), 'birch-hero': tree(18, 5), 'spruce-grove-a': tree(22, 2.5),
        },
    };

    it('lays out a cell per model and turn, birches first, each framed to fit its cell', () => {
        const { cells, columns, rows } = impostorCells(assets);
        expect(columns).toBe(3);
        expect(rows).toBe(IMPOSTOR.turns.length);
        expect(cells).toHaveLength(columns * rows);
        expect(cells.map((c) => c.model).slice(0, 2)).toEqual(['birch-grove-a', 'birch-grove-a']);
        expect(cells.filter((c) => c.species === 1).every((c) => c.model.startsWith('spruce'))).toBe(true);
        for (const cell of cells) {
            // Its height fits the cell's (aspect widths tall), its crown the cell's width.
            expect(cell.top * cell.scale).toBeLessThanOrEqual(IMPOSTOR.aspect + 1e-9);
            expect(cell.scale).toBeGreaterThan(0);
        }
    });

    it('has nothing to lay out without the models', () => {
        expect(impostorCells(null).cells).toHaveLength(0);
        expect(impostorCells({ trees: {} }).columns).toBe(0);
    });
});
