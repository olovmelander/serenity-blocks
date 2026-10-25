import { statSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    SUNFALL_ASSET_MANIFEST, decodeSunfallLight, disposeSunfallAssets,
} from '../../src/themes/sunfall/sunfall-assets.js';
import { SUNFALL_LAYOUT } from '../../src/themes/sunfall/sunfall-core.js';
import { SUNFALL_ASSET_DIR, loadSunfallAssetsFromDisk } from './helpers/sunfall-assets-disk.js';

const KB = 1000;
// What the pack may weigh (the 2026-10-20 bake wrote 2.08 MB, 0.72 MB and 0.23 MB), so it
// cannot balloon without someone raising a number on purpose.
const BUDGET = {
    'sunfall-shell.glb': 2600 * KB,
    'sunfall-ledge.glb': 950 * KB,
    'sunfall-crowns.glb': 320 * KB,
    'asset-manifest.json': 90 * KB,
};

const close = (a, b) => {
    if (Array.isArray(a) || (a && typeof a === 'object')) {
        return Object.keys(b).every((k) => close(a[k], b[k]));
    }
    return Math.abs(Number(a) - Number(b)) < 1e-6;
};

describe('sunfall assets', () => {
    let assets;
    beforeAll(async () => {
        assets = await loadSunfallAssetsFromDisk();
    });

    it('stays inside its size budget', () => {
        for (const [name, budget] of Object.entries(BUDGET)) {
            const bytes = statSync(new URL(name, SUNFALL_ASSET_DIR)).size;
            expect(bytes, name).toBeLessThanOrEqual(budget);
        }
    });

    it('was baked from the layout the theme believes in', () => {
        const baked = SUNFALL_ASSET_MANIFEST.layout;
        for (const key of Object.keys(SUNFALL_LAYOUT)) {
            expect(close(baked[key], SUNFALL_LAYOUT[key]), key).toBe(true);
        }
        expect(SUNFALL_ASSET_MANIFEST.schema).toBe(1);
    });

    it('splits the shell into chunks that fit 16-bit indices, each with its bakes', () => {
        expect(assets.shell.length).toBeGreaterThan(1);
        for (const g of [...assets.shell, ...assets.ledge]) {
            expect(g.attributes.position.count).toBeLessThan(65536);
            expect(g.attributes.normal.itemSize).toBe(3);
            expect(g.attributes.color.itemSize).toBe(4);
            expect(g.attributes._bake.itemSize).toBe(4);
            expect(g.index.array.BYTES_PER_ELEMENT).toBe(2);
        }
        expect(assets.crowns).toHaveLength(6);
        expect(assets.plan.count).toBe(SUNFALL_ASSET_MANIFEST.files['sunfall-crowns.glb'].sites);
    });

    it('joins the shell chunks without a slit (each chunk quantises on its own grid)', () => {
        // Every vertex near another chunk's vertex sits exactly on it: a seam a few millimetres
        // open let the sky through as white pixels flickering down the far wall.
        const cell = 0.05;
        const grid = new Map();
        const keyOf = (x, y, z) => [x, y, z].map((v) => Math.floor(v / cell)).join();
        assets.shell.forEach((g, gi) => {
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i += 1) {
                const key = keyOf(p.getX(i), p.getY(i), p.getZ(i));
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push([gi, p.getX(i), p.getY(i), p.getZ(i)]);
            }
        });
        let shared = 0;
        let worst = 0;
        for (const [key, list] of grid) {
            const [cx, cy, cz] = key.split(',').map(Number);
            for (const [gi, x, y, z] of list) {
                for (let n = 0; n < 27; n += 1) {
                    const at = [cx + (n % 3) - 1, cy + (Math.floor(n / 3) % 3) - 1, cz + Math.floor(n / 9) - 1];
                    for (const [gj, X, Y, Z] of grid.get(at.join()) || []) {
                        const d = Math.hypot(X - x, Y - y, Z - z);
                        if (gj === gi || d > cell) continue;
                        shared += 1;
                        worst = Math.max(worst, d);
                    }
                }
            }
        }
        expect(shared).toBeGreaterThan(500);
        expect(worst).toBe(0);
    });

    it('decodes the baked light the way the shaders do', () => {
        const { ceilings, stops } = SUNFALL_ASSET_MANIFEST.light;
        expect(decodeSunfallLight(0, ceilings.sun)).toBe(0);
        expect(decodeSunfallLight(1, ceilings.sun)).toBeCloseTo(ceilings.sun, 6);
        expect(decodeSunfallLight(0.5, ceilings.sun)).toBeCloseTo(ceilings.sun * 2 ** (-stops / 2), 6);
    });

    it('lets the sun in through the two skylights and nowhere else', () => {
        const { ceilings } = SUNFALL_ASSET_MANIFEST.light;
        const [fx, fz] = SUNFALL_LAYOUT.farDoline.center;
        const outside = [];
        const farFloor = [];
        const chamberWall = [];
        for (const g of assets.shell) {
            const p = g.attributes.position;
            const n = g.attributes.normal;
            const c = g.attributes.color;
            for (let i = 0; i < p.count; i += 1) {
                const sun = decodeSunfallLight(c.getW(i), ceilings.sun); // station 1
                const y = p.getY(i);
                if (y > SUNFALL_LAYOUT.oculus.surface && n.getY(i) > 0.6) outside.push(sun);
                if (Math.hypot(p.getX(i) - fx, p.getZ(i) - fz) < 120 && y < -120 && n.getY(i) > 0.5) farFloor.push(sun);
                if (p.getZ(i) < -740 && p.getX(i) < 150 && Math.abs(n.getY(i)) < 0.4 && y > -60 && y < 80) chamberWall.push(sun);
            }
        }
        const mean = (list) => list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
        expect(outside.length).toBeGreaterThan(200);
        expect(farFloor.length).toBeGreaterThan(20);
        // The ground outside is in full sun; the passage under the far doline is lit through it;
        // the chamber's far wall only by light bounced round the cave.
        expect(mean(outside)).toBeGreaterThan(mean(farFloor) * 2);
        expect(mean(farFloor)).toBeGreaterThan(mean(chamberWall) * 5);
    });

    it('plans a canopy of clumped crowns of many sizes with a few emergents', () => {
        const { crown, count } = assets.plan;
        const radii = [];
        let emergents = 0;
        for (let i = 0; i < count; i += 1) {
            radii.push(crown[i * 4]);
            if (crown[i * 4 + 3] > 0.5) emergents += 1;
        }
        radii.sort((a, b) => a - b);
        expect(radii[0]).toBeGreaterThan(3);
        expect(radii[radii.length - 1]).toBeLessThan(16);
        // A power law: the median crown is much nearer the smallest than the largest.
        expect(radii[Math.floor(count / 2)]).toBeLessThan((radii[0] + radii[radii.length - 1]) / 2);
        expect(emergents / count).toBeGreaterThan(0.004);
        expect(emergents / count).toBeLessThan(0.08);
        disposeSunfallAssets(null);
    });
});
