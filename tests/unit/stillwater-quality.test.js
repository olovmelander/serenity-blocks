/**
 * Stillwater — the content tiers (stillwater-quality.js).
 *
 * The numbers in the tiers are tuned freely; what is pinned here is their shape: every tier is
 * the whole picture, a higher tier never has less of anything than a lower one, and every number
 * a tier declares is one the world reads.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    QUALITY, QUALITY_NAMES, resolveStillwaterQuality, tierFor,
} from '../../src/themes/stillwater/stillwater-quality.js';
import { EYE_PAIRS } from '../../src/themes/stillwater/stillwater-core.js';
import { planBoulders, planTrunks } from '../../src/themes/stillwater/stillwater-plan.js';
import { normalizeQuality } from '../../src/utils/quality.js';

const sourceOf = (file) => readFileSync(new URL(`../../src/themes/stillwater/${file}`, import.meta.url), 'utf8');

/** The game's six tiers, lowest first. */
const LADDER = ['minimal', 'low', 'medium', 'high', 'ultra', 'extreme'].map((name) => normalizeQuality(name));

/** The numbers that get SMALLER as a tier gets richer: a finer ground mesh, a finer sculpt. */
const FINER = ['cell', 'troll'];

describe('stillwater quality: the tiers', () => {
    it('has a tier for each of the game\'s six, lowest first, and nothing else', () => {
        expect(QUALITY_NAMES).toEqual(LADDER);
        expect(Object.keys(QUALITY)).toEqual(LADDER);
        expect(Object.isFrozen(QUALITY)).toBe(true);
        expect(Object.isFrozen(QUALITY_NAMES)).toBe(true);
        for (const name of QUALITY_NAMES) {
            expect(Object.isFrozen(QUALITY[name]), name).toBe(true);
            // The name the settings store is the name the tier goes by.
            expect(normalizeQuality(name)).toBe(name);
        }
    });

    it('gives every tier the same numbers to read, each of the same kind', () => {
        const keys = Object.keys(QUALITY.High).sort();
        expect(keys.length).toBeGreaterThan(8);
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(Object.keys(tier).sort(), name).toEqual(keys);
            for (const key of keys) {
                expect(typeof tier[key], `${name}.${key}`).toBe(typeof QUALITY.High[key]);
                if (typeof tier[key] === 'number') {
                    expect(Number.isFinite(tier[key]), `${name}.${key}`).toBe(true);
                    expect(tier[key], `${name}.${key}`).toBeGreaterThanOrEqual(0);
                } else {
                    expect(typeof tier[key], `${name}.${key}`).toBe('boolean');
                }
            }
        }
    });

    it('never gives a higher tier less of anything than the tier below it', () => {
        const keys = Object.keys(QUALITY.High);
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const lower = QUALITY[QUALITY_NAMES[i - 1]];
            const higher = QUALITY[QUALITY_NAMES[i]];
            const label = `${QUALITY_NAMES[i - 1]} → ${QUALITY_NAMES[i]}`;
            for (const key of keys) {
                if (typeof higher[key] !== 'number') continue;
                if (FINER.includes(key)) expect(higher[key], `${label}: ${key}`).toBeLessThanOrEqual(lower[key]);
                else expect(higher[key], `${label}: ${key}`).toBeGreaterThanOrEqual(lower[key]);
            }
            // What a tier switches on, no higher tier switches off; the cut-down sky is for the low end only.
            for (const key of ['glitter', 'columns']) {
                if (lower[key]) expect(higher[key], `${label}: ${key}`).toBe(true);
            }
            if (!lower.lite) expect(higher.lite, `${label}: lite`).toBe(false);
        }
        // The ladder does climb: the fullest tier has more of what counts than the leanest.
        const least = QUALITY[QUALITY_NAMES[0]];
        const most = QUALITY[QUALITY_NAMES.at(-1)];
        for (const key of ['trunks', 'boughs', 'boulders', 'saplings', 'lilies', 'caps', 'sparks']) {
            expect(most[key], key).toBeGreaterThan(least[key]);
        }
        expect(most.cell).toBeLessThan(least.cell);
        expect(most.mirror).toBeGreaterThan(least.mirror);
        expect(most.lite).toBe(false);
    });

    it('keeps the whole picture and every event at every tier', () => {
        const byHand = { trunks: planTrunks(0).length, boulders: planBoulders(0).length };
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            // The trees and stones placed by hand are always there, and some of the scattered ones.
            expect(tier.trunks, name).toBeGreaterThan(byHand.trunks);
            expect(tier.boulders, name).toBeGreaterThan(byHand.boulders);
            // What a lock, a clear and a chain write on: lilies to open, caps to light, eyes to open, motes to throw.
            for (const key of ['lilies', 'caps', 'eyes', 'sparks', 'boughs', 'saplings']) {
                expect(tier[key], `${name}.${key}`).toBeGreaterThan(0);
            }
            // The mist is the place: no tier is without a sheet of it.
            expect(tier.mist, name).toBeGreaterThanOrEqual(1);
            // No tier asks for more eyes than the far wood has room for.
            expect(tier.eyes, name).toBeLessThanOrEqual(EYE_PAIRS);
            // Whole numbers of things.
            for (const key of ['trunks', 'boughs', 'boulders', 'saplings', 'lilies', 'reeds', 'ferns', 'caps', 'eyes',
                'fireflies', 'sparks', 'mist', 'troll']) {
                expect(Number.isInteger(tier[key]), `${name}.${key}`).toBe(true);
            }
            // The sculpt has four meshes; the mirror pass is a share of the frame; the ground mesh has a cell.
            expect([0, 1, 2, 3], name).toContain(tier.troll);
            expect(tier.mirror, name).toBeLessThanOrEqual(1);
            expect(tier.cell, name).toBeGreaterThan(0.2);
            expect(tier.cell, name).toBeLessThan(3);
        }
        // The tier the game ships as its default mirrors what stands in the scene.
        expect(QUALITY.High.mirror).toBeGreaterThan(0);
        expect(QUALITY.High.lite).toBe(false);
    });

    it('hands out the High tier for a name it does not know', () => {
        for (const name of QUALITY_NAMES) expect(tierFor(name)).toBe(QUALITY[name]);
        for (const unknown of [undefined, null, '', 'high', 'HIGH', 'Custom', 'Highest', 7, {}, []]) {
            expect(tierFor(unknown), String(unknown)).toBe(QUALITY.High);
        }
    });

    // Every object answers to a few names of its own ('constructor', 'toString'): looked up
    // plainly, tierFor would hand out the Object function as a tier, and a world built from it
    // would read `undefined` for every number. (The playground hands ?quality= to the world as it
    // is typed.)
    it('hands out the High tier for a name that every object answers to', () => {
        for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
            expect(tierFor(name), name).toBe(QUALITY.High);
        }
    });

    it('lets the world read every number it declares', () => {
        const world = sourceOf('stillwater-world.js');
        const read = Object.keys(QUALITY.High).filter((key) => new RegExp(`\\btier\\.${key}\\b`).test(world));
        expect(read).toEqual(Object.keys(QUALITY.High));
        // And the world reads no number a tier does not declare.
        const asked = [...world.matchAll(/\btier\.([A-Za-z]+)\b/g)].map((match) => match[1]);
        expect(asked.length).toBeGreaterThan(10);
        for (const key of asked) expect(Object.keys(QUALITY.High), `tier.${key}`).toContain(key);
    });

    // A number that is declared and not read looks like a budget and is none. (Every tier once
    // declared `shafts`, which nothing in the theme read: the post takes its own from POST_LOOK.)
    it('declares no number that nothing reads', () => {
        const sources = ['stillwater-world.js', 'stillwater-theme.js', 'stillwater-post.js', 'stillwater-fx.js',
            'stillwater-water.js', 'stillwater-sky.js', 'stillwater-trees.js'].map(sourceOf).join('\n');
        const unread = Object.keys(QUALITY.High).filter((key) => !new RegExp(`\\btier\\.${key}\\b`).test(sources));
        expect(unread).toEqual([]);
    });
});

describe('stillwater quality: which tier to build', () => {
    it.each(QUALITY_NAMES)('honors the shipped %s graphics preference without the legacy setting', (quality) => {
        expect(resolveStillwaterQuality(new URLSearchParams(), { effectQuality: quality })).toBe(quality);
    });

    it('prefers the current graphics setting over a stale legacy preference', () => {
        expect(resolveStillwaterQuality(undefined, {
            effectQuality: 'Minimal', graphicsQuality: 'Extreme',
        })).toBe('Minimal');
    });

    it('preserves an explicit playground override over either saved preference', () => {
        expect(resolveStillwaterQuality(new URLSearchParams('quality=Low'), {
            effectQuality: 'Extreme', graphicsQuality: 'High',
        })).toBe('Low');
    });

    it('supports the legacy graphics preference when no current setting exists', () => {
        expect(resolveStillwaterQuality(undefined, { graphicsQuality: 'Medium' })).toBe('Medium');
    });

    it('ignores empty URL overrides and normalizes the selected preference', () => {
        expect(resolveStillwaterQuality(new URLSearchParams('quality='), {
            effectQuality: ' minimal ',
        })).toBe('Minimal');
        expect(resolveStillwaterQuality(new URLSearchParams('quality=eXtReMe'))).toBe('Extreme');
    });

    it('uses the shared High fallback for absent or unsupported preferences', () => {
        expect(resolveStillwaterQuality()).toBe('High');
        expect(resolveStillwaterQuality(null, null)).toBe('High');
        expect(resolveStillwaterQuality({}, {})).toBe('High');
        expect(resolveStillwaterQuality(undefined, { effectQuality: 'Custom' })).toBe('High');
        expect(resolveStillwaterQuality(new URLSearchParams('quality=unsupported'), {
            effectQuality: 'Minimal',
        })).toBe('High');
    });

    it('always names a tier that exists', () => {
        const asked = [undefined, new URLSearchParams('quality=ultra'), new URLSearchParams('quality=nope'),
            new URLSearchParams('other=1')];
        const saved = [undefined, {}, { effectQuality: 'low' }, { graphicsQuality: 'EXTREME' }, { effectQuality: 42 }];
        for (const params of asked) {
            for (const settings of saved) {
                const quality = resolveStillwaterQuality(params, settings);
                expect(QUALITY_NAMES).toContain(quality);
                expect(tierFor(quality)).toBe(QUALITY[quality]);
            }
        }
    });
});
