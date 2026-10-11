import { describe, expect, it } from 'vitest';
import {
    CORAL_COLOURS, GROVES, REEF_QUOTA, gardensOf, inView, planGrass, planKelp, planReef, planReefFish,
} from '../../src/themes/ocean/ocean-plan.js';
import {
    SURFACE, channelAxis, rockAt, seabedHeight,
} from '../../src/themes/ocean/ocean-core.js';
import {
    QUALITY, QUALITY_NAMES, resolveOceanQuality, tierFor,
} from '../../src/themes/ocean/ocean-quality.js';
import { POST_LOOK } from '../../src/themes/ocean/ocean-post.js';

const all = (reef) => Object.values(reef).flat();

describe('Ocean plan: the reef', () => {
    const reef = planReef(1);

    it('fills every kind\'s quota on the full reef', () => {
        Object.entries(REEF_QUOTA).forEach(([kind, quota]) => expect(reef[kind].length).toBe(quota));
    });

    it('is the same reef every time, and a lower tier keeps the hero gardens', () => {
        expect(planReef(1)).toEqual(reef);
        const small = planReef(0.3);
        expect(all(small).length).toBeLessThan(all(reef).length);
        // The hero colonies (first in each list) stand where they stand on the full reef.
        expect(small.tables[0]).toEqual(reef.tables[0]);
        expect(small.fans[0]).toEqual(reef.fans[0]);
    });

    it('seats every colony on the reef, never hanging in the water', () => {
        all(reef).forEach((c) => {
            expect(c.y).toBeLessThanOrEqual(seabedHeight(c.x, c.z) + 1e-9);
            expect(seabedHeight(c.x, c.z) - c.y).toBeLessThan(2.5);
        });
    });

    it('keeps the sand channel open and stays in the picture', () => {
        all(reef).forEach((c) => {
            expect(Math.abs(c.x - channelAxis(c.z))).toBeGreaterThan(1.8);
            expect(inView(c.x, c.y + c.scale, c.z, 2)).toBe(true);
        });
    });

    it('colours each colony from its own kind\'s palette', () => {
        Object.entries(reef).forEach(([kind, list]) => {
            list.forEach((c) => expect(CORAL_COLOURS[kind]).toContain(c.tint));
        });
    });

    it('spawns from the gardens and the big tables', () => {
        const points = gardensOf(reef);
        expect(points.length).toBeGreaterThanOrEqual(8);
        points.forEach((p) => expect(p.every(Number.isFinite)).toBe(true));
    });
});

describe('Ocean plan: kelp, grass and the reef fish', () => {
    it('stands kelp on the shoulders, in both groves first, tops under the surface', () => {
        const kelp = planKelp(26);
        expect(kelp).toHaveLength(26);
        expect(kelp.some((k) => k.x < 0)).toBe(true);
        expect(kelp.some((k) => k.x > 0)).toBe(true);
        kelp.forEach((k) => {
            expect(k.y + k.height).toBeLessThan(SURFACE - 0.5);
            expect(Math.abs(k.x - channelAxis(k.z))).toBeGreaterThanOrEqual(6.2);
        });
        expect(planKelp(GROVES.length).length).toBe(GROVES.length);
    });

    it('lays seagrass on the sand along the channel, not on the rock', () => {
        const grass = planGrass(800);
        expect(grass).toHaveLength(800);
        grass.forEach((g) => expect(rockAt(g.x, g.z)).toBeLessThanOrEqual(0.5));
    });

    it('gives every reef fish a home over a colony near the viewer and a colony to hide in', () => {
        const reef = planReef(1);
        const fish = planReefFish(reef, 230);
        expect(fish).toHaveLength(230);
        fish.forEach((f) => {
            expect(f.cover).toHaveLength(3);
            expect(f.y).toBeGreaterThan(f.cover[1]);
            expect(f.z).toBeGreaterThan(-27);
            expect(f.hue).toBeGreaterThanOrEqual(0);
            expect(f.hue).toBeLessThan(4);
        });
        expect(planReefFish({
            tables: [], branching: [], brains: [], sponges: [],
        }, 10)).toEqual([]);
    });
});

describe('Ocean quality tiers', () => {
    it('offers every tier the game names, with the whole cast on each', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        QUALITY_NAMES.forEach((name) => {
            const t = QUALITY[name];
            ['school', 'reefFish', 'kelp', 'grass', 'motes', 'pool'].forEach((k) => expect(t[k]).toBeGreaterThan(0));
            expect(POST_LOOK[name]).toBeTruthy();
            expect(POST_LOOK[name].shafts).toBeGreaterThan(0);
        });
    });

    it('never asks less of a higher tier', () => {
        ['seabed', 'corals', 'kelp', 'blades', 'grass', 'school', 'reefFish', 'jellies', 'motes', 'pool', 'light', 'waves']
            .forEach((k) => {
                for (let i = 1; i < QUALITY_NAMES.length; i++) {
                    expect(QUALITY[QUALITY_NAMES[i]][k]).toBeGreaterThanOrEqual(QUALITY[QUALITY_NAMES[i - 1]][k]);
                }
            });
    });

    it('falls back to High for a name it does not know, and reads the playground and the settings', () => {
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor('constructor')).toBe(QUALITY.High);
        expect(resolveOceanQuality(new URLSearchParams('quality=low'), {})).toBe('Low');
        expect(resolveOceanQuality(null, { effectQuality: 'Ultra' })).toBe('Ultra');
        expect(resolveOceanQuality(null, null)).toBe('High');
    });
});
