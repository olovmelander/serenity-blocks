// @ts-check
/**
 * THE chapter↔scene registry (remediation plan §4.5) — the single
 * rendering-side source of truth joining a chapter id to its environment
 * module. Replaces the two hand-synced tables that lived in
 * ChapterEnvironmentManager.js (CHAPTER_MODULE_LOADERS + CHAPTER_EXPORT_NAMES)
 * — and the sixth drifted copy this class of duplication already produced
 * (the GPU-validation SCENES list silently omitted chapter 3 for months).
 *
 * Adding a chapter touches exactly TWO places: one entry in core
 * CHAPTER_CONFIGS (id/name/levelRange truth) and one entry here. Everything
 * else derives:
 *  - module export names derive from sceneId by convention
 *    ('earth-core' → EARTH_CORE_CONFIG / createEarthCoreEnvironment /
 *    updateEarthCoreEnvironment) — enforced against the real module sources by
 *    tests/unit/chapter-registry-consistency.test.js;
 *  - the GPU-gate scene list is pinned ⊇ these sceneIds
 *    (tests/unit/odyssey-gpu-gate-coverage.test.js);
 *  - id-set equality with core CHAPTER_CONFIGS and ODYSSEY_CHAPTER_PROFILES is
 *    test-enforced, so none of the three lists can drift.
 *
 * PURE DATA + thunks: no three.js import, safe to import in node tests. The
 * `load` thunks keep EXPLICIT static-analyzable import paths (no template
 * literals) so Vite's chunking is untouched; the consistency test pins each
 * path to its sceneId.
 */

export const CHAPTER_SCENES = Object.freeze([
    Object.freeze({ id: 1, sceneId: 'earth-core', load: () => import('./earth-core.js') }),
    Object.freeze({ id: 2, sceneId: 'deep-ocean', load: () => import('./deep-ocean.js') }),
    Object.freeze({ id: 3, sceneId: 'surface-world', load: () => import('./surface-world.js') }),
    Object.freeze({ id: 4, sceneId: 'mountain-peaks', load: () => import('./mountain-peaks.js') }),
    Object.freeze({ id: 5, sceneId: 'sky-drift', load: () => import('./sky-drift.js') }),
    Object.freeze({ id: 6, sceneId: 'cosmic-expanse', load: () => import('./cosmic-expanse.js') }),
    Object.freeze({ id: 7, sceneId: 'black-hole-transcendence', load: () => import('./black-hole-transcendence.js') }),
    Object.freeze({ id: 8, sceneId: 'urban-dreams', load: () => import('./urban-dreams.js') }),
]);

/** @type {Map<number, (typeof CHAPTER_SCENES)[number]>} */
const byId = new Map(CHAPTER_SCENES.map((entry) => [entry.id, entry]));

/** @param {number} chapterId */
export function getChapterScene(chapterId) {
    return byId.get(chapterId) || null;
}

/**
 * Derive the module export names from a scene id by the house convention.
 * 'earth-core' → { config: 'EARTH_CORE_CONFIG', create: 'createEarthCoreEnvironment',
 * update: 'updateEarthCoreEnvironment' }.
 * @param {string} sceneId
 */
export function exportNamesForScene(sceneId) {
    const pascal = sceneId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const screaming = sceneId.replace(/-/g, '_').toUpperCase();
    return {
        config: `${screaming}_CONFIG`,
        create: `create${pascal}Environment`,
        update: `update${pascal}Environment`,
    };
}
