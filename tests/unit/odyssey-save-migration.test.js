/**
 * v1 → v2 Odyssey save migration (the space lengthening, 2026-08-15).
 *
 * Chapter 6 grew 36-44 → 36-48: every level id ≥ 42 shifted +4. A v1 save's ids are
 * ALL still "valid" in the 59-level world, so nothing throws without the version
 * gate — a finished-the-game save would silently re-point mid-ch7 and the cloud
 * merge would alias old ch7 arrivals onto the new ch6 levels. These tests pin the
 * migration itself and the two cloud-sync call sites the audit named as the
 * silent-corruption paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLOUD_SYNC = fs.readFileSync(
    path.resolve(here, '../../src/core/steam/steam-cloud-sync.js'),
    'utf8',
);

describe('odyssey v1 -> v2 save migration (space lengthening)', () => {
    it('shifts every id >= 42 by +4 across all three id-carrying fields', () => {
        const v1 = {
            version: 1,
            currentChapter: 8,
            currentLevel: 55,
            unlockedLevels: [1, 41, 42, 45, 50, 55],
            completedLevels: {
                41: { stars: 3, bestScore: 1000 },
                42: { stars: 2, bestScore: 900 },
                55: { stars: 3, bestScore: 5000 },
            },
        };
        const out = migrateOdysseyProgressData(v1);
        expect(out.version).toBe(2);
        // ids below 42 keep their numbers; 42+ shift.
        expect(out.unlockedLevels).toEqual([1, 41, 46, 49, 54, 59]);
        // completedLevels keys are STRINGS — the type asymmetry the audit flagged.
        expect(Object.keys(out.completedLevels).sort()).toEqual(['41', '46', '59']);
        expect(out.completedLevels['46']).toEqual({ stars: 2, bestScore: 900 });
        expect(out.currentLevel).toBe(59);
    });

    it('treats a missing version as v1', () => {
        const out = migrateOdysseyProgressData({ unlockedLevels: [44], completedLevels: {} });
        expect(out.unlockedLevels).toEqual([48]);
        expect(out.version).toBe(2);
    });

    it('is idempotent: a v2 document is never shifted again', () => {
        const v2 = {
            version: 2, currentLevel: 59, unlockedLevels: [46, 59], completedLevels: { 46: { stars: 1 } },
        };
        const out = migrateOdysseyProgressData(v2);
        expect(out.unlockedLevels).toEqual([46, 59]);
        expect(out.currentLevel).toBe(59);
        expect(Object.keys(out.completedLevels)).toEqual(['46']);
    });

    it('survives junk without throwing', () => {
        expect(migrateOdysseyProgressData(null)).toBeNull();
        expect(migrateOdysseyProgressData({ version: 1 }).version).toBe(2);
    });

    it('cloud sync migrates BOTH sides before merging and before applying', () => {
        // The two silent-corruption sites: _mergeOdyssey (id-keyed union of a v1
        // cloud doc = false unlocks; spread inherits version from the CLOUD side)
        // and _applyOdyssey (writes raw cloud JSON to disk, bypassing load()).
        expect(CLOUD_SYNC).toMatch(
            /_mergeOdyssey\(localData, cloudData\) \{[\s\S]{0,700}migrateOdysseyProgressData\(localData\);\s*migrateOdysseyProgressData\(cloudData\);/,
        );
        expect(CLOUD_SYNC).toMatch(
            /_applyOdyssey\(data\) \{[\s\S]{0,700}migrateOdysseyProgressData\(data\)/,
        );
    });
});
