/**
 * GPU-gate coverage tripwire (plan Phase 3c.1 / 4.5).
 *
 * The validation script's SCENES list was hand-synced and silently omitted
 * chapter 3 (surface-world) — exempting it from the WGSL/TSL gate for months.
 * This pins: every chapter in the ONE registry (chapter-environments/
 * registry.js, plan §4.5) is covered by the validation script AND loadable by
 * the pilot page. The registry is pure data (no three import) so it is
 * imported directly; the script/pilot are still source-scanned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTER_SCENES } from '../../src/rendering/odyssey/chapter-environments/registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

function chapterBasenames() {
    const names = CHAPTER_SCENES.map((entry) => entry.sceneId);
    expect(names.length).toBeGreaterThanOrEqual(8);
    return names;
}

function validationScenes() {
    const src = read('scripts/odyssey-webgpu-validation.mjs');
    const block = src.match(/const SCENES = \[([\s\S]*?)\];/)?.[1];
    expect(block, 'SCENES not found').toBeTruthy();
    return [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

function pilotKeys() {
    const src = read('src/rendering/odyssey/pilot/odyssey-webgpu-pilot.js');
    return [...src.matchAll(/key:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

describe('Odyssey GPU-gate coverage', () => {
    it('every chapter in CHAPTER_MODULE_LOADERS is validated', () => {
        const scenes = new Set(validationScenes());
        const missing = chapterBasenames().filter((c) => !scenes.has(c));
        expect(missing, 'chapter silently exempt from the GPU gate').toEqual([]);
    });

    it('every validated scene is loadable by the pilot page', () => {
        const keys = new Set(pilotKeys());
        const missing = validationScenes().filter((s) => !keys.has(s));
        expect(missing, 'SCENES entry with no pilot CHAPTERS entry would fail every run').toEqual([]);
    });
});
