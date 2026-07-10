/**
 * GPU-gate coverage tripwire (plan Phase 3c.1).
 *
 * The validation script's SCENES list was hand-synced and silently omitted
 * chapter 3 (surface-world) — exempting it from the WGSL/TSL gate for months.
 * This pins: every chapter wired in ChapterEnvironmentManager's
 * CHAPTER_MODULE_LOADERS is covered by the validation script AND loadable by
 * the pilot page. Static source scan (the modules import three, so importing
 * them in node is not an option here).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

function chapterBasenames() {
    const src = read('src/rendering/odyssey/ChapterEnvironmentManager.js');
    const block = src.match(/CHAPTER_MODULE_LOADERS\s*=\s*{([\s\S]*?)^};/m)?.[1]
        ?? src.match(/CHAPTER_MODULE_LOADERS\s*=\s*{([\s\S]*?)};/)?.[1];
    expect(block, 'CHAPTER_MODULE_LOADERS not found').toBeTruthy();
    const names = [...block.matchAll(/chapter-environments\/([a-z0-9-]+)\.js/g)].map((m) => m[1]);
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
