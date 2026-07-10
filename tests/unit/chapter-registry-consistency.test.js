/**
 * Chapter-registry consistency (plan §4.5) — the drift-proofing for the ONE
 * chapter↔scene registry. Six hand-synced chapter lists existed at last count;
 * one (the GPU-gate SCENES) had already silently dropped chapter 3. These pins
 * make every remaining list provably equal to the registry:
 *  - core CHAPTER_CONFIGS (id/name/levelRange truth)
 *  - rendering CHAPTER_SCENES (this registry)
 *  - ODYSSEY_CHAPTER_PROFILES (visual profiles)
 * and verify the derived export names against the REAL module sources (static
 * text — the env modules import three and cannot execute in node).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { ODYSSEY_CHAPTER_PROFILES } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import {
    CHAPTER_SCENES, getChapterScene, exportNamesForScene,
} from '../../src/rendering/odyssey/chapter-environments/registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envDir = path.join(repoRoot, 'src', 'rendering', 'odyssey', 'chapter-environments');

const ids = (list) => [...list].map((e) => e.id).sort((a, b) => a - b);

describe('chapter registry — id-set equality (the anti-drift pin)', () => {
    it('registry ids == core CHAPTER_CONFIGS ids', () => {
        expect(ids(CHAPTER_SCENES)).toEqual(ids(CHAPTER_CONFIGS));
    });

    it('registry ids == ODYSSEY_CHAPTER_PROFILES ids', () => {
        expect(ids(CHAPTER_SCENES)).toEqual(ids(ODYSSEY_CHAPTER_PROFILES));
    });

    it('sceneIds are unique kebab-case', () => {
        const sceneIds = CHAPTER_SCENES.map((e) => e.sceneId);
        expect(new Set(sceneIds).size).toBe(sceneIds.length);
        for (const s of sceneIds) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
});

describe('chapter registry — module wiring is real', () => {
    const rows = CHAPTER_SCENES.map((e) => [e.sceneId, e]);
    it.each(rows)('%s: module exists, loader path matches, exports follow convention', (sceneId, entry) => {
        // 1. The module file exists.
        const file = path.join(envDir, `${sceneId}.js`);
        expect(existsSync(file), `${sceneId}.js missing`).toBe(true);

        // 2. The loader thunk's import path targets exactly that file (source pin —
        //    thunks can't be introspected, but the registry source can).
        const registrySrc = readFileSync(path.join(envDir, 'registry.js'), 'utf8');
        const row = registrySrc.split('\n').find((l) => l.includes(`sceneId: '${sceneId}'`));
        expect(row, `registry row for ${sceneId}`).toBeTruthy();
        expect(row).toContain(`import('./${sceneId}.js')`);

        // 3. The module really exports the three derived names.
        const names = exportNamesForScene(sceneId);
        const src = readFileSync(file, 'utf8');
        for (const name of Object.values(names)) {
            const re = new RegExp(`export\\s+(?:const|function|async function)\\s+${name}\\b`);
            expect(re.test(src), `${sceneId}.js must export ${name}`).toBe(true);
        }
        expect(entry.id).toBeGreaterThanOrEqual(1);
    });

    it('getChapterScene resolves every core chapter and rejects unknowns', () => {
        for (const chapter of CHAPTER_CONFIGS) {
            expect(getChapterScene(chapter.id)?.sceneId).toBeTruthy();
        }
        expect(getChapterScene(999)).toBe(null);
    });

    it('the derivation convention itself (spot pins)', () => {
        expect(exportNamesForScene('earth-core')).toEqual({
            config: 'EARTH_CORE_CONFIG',
            create: 'createEarthCoreEnvironment',
            update: 'updateEarthCoreEnvironment',
        });
        expect(exportNamesForScene('black-hole-transcendence').create)
            .toBe('createBlackHoleTranscendenceEnvironment');
    });
});

describe('no parallel chapter lists regrow', () => {
    it('ChapterEnvironmentManager no longer carries its own loader/export tables', () => {
        const src = readFileSync(
            path.join(repoRoot, 'src', 'rendering', 'odyssey', 'ChapterEnvironmentManager.js'),
            'utf8',
        );
        expect(src).not.toMatch(/CHAPTER_MODULE_LOADERS\s*=/);
        expect(src).not.toMatch(/CHAPTER_EXPORT_NAMES\s*=/);
        expect(src).toMatch(/getChapterScene/);
    });
});
