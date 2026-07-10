/**
 * @fileoverview Chapter Environments Index
 *
 * Exports all chapter environment modules for the Odyssey Mode game board.
 */

export {
    EARTH_CORE_CONFIG,
    createEarthCoreEnvironment,
    updateEarthCoreEnvironment,
} from './earth-core.js';

export {
    DEEP_OCEAN_CONFIG,
    createDeepOceanEnvironment,
    updateDeepOceanEnvironment,
} from './deep-ocean.js';

export {
    SURFACE_WORLD_CONFIG,
    createSurfaceWorldEnvironment,
    updateSurfaceWorldEnvironment,
} from './surface-world.js';

export {
    MOUNTAIN_PEAKS_CONFIG,
    createMountainPeaksEnvironment,
    updateMountainPeaksEnvironment,
} from './mountain-peaks.js';

export {
    SKY_DRIFT_CONFIG,
    createSkyDriftEnvironment,
    updateSkyDriftEnvironment,
} from './sky-drift.js';

export {
    COSMIC_EXPANSE_CONFIG,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';

// NOTE (remediation Phase 2): the orphaned `CHAPTER_ENVIRONMENTS` map was
// removed here. It was a dynamic-loading registry that listed only 6 of the 8
// chapters (missing black-hole-transcendence and urban-dreams), was imported by
// nothing, and had already drifted two chapters behind the live loader.
// Phase 4.5 consolidated the wiring: the ONE authoritative chapter↔scene
// registry is ./registry.js (CHAPTER_SCENES + derived export names), consumed
// by ChapterEnvironmentManager and pinned by
// tests/unit/chapter-registry-consistency.test.js. Do not re-add a parallel
// chapter list here or anywhere else.
