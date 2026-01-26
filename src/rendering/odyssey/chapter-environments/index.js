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

// Environment registry for dynamic loading
export const CHAPTER_ENVIRONMENTS = {
    1: {
        name: 'earth-core',
        config: () => import('./earth-core.js').then((m) => m.EARTH_CORE_CONFIG),
        create: () => import('./earth-core.js').then((m) => m.createEarthCoreEnvironment),
        update: () => import('./earth-core.js').then((m) => m.updateEarthCoreEnvironment),
    },
    2: {
        name: 'deep-ocean',
        config: () => import('./deep-ocean.js').then((m) => m.DEEP_OCEAN_CONFIG),
        create: () => import('./deep-ocean.js').then((m) => m.createDeepOceanEnvironment),
        update: () => import('./deep-ocean.js').then((m) => m.updateDeepOceanEnvironment),
    },
    3: {
        name: 'surface-world',
        config: () => import('./surface-world.js').then((m) => m.SURFACE_WORLD_CONFIG),
        create: () => import('./surface-world.js').then((m) => m.createSurfaceWorldEnvironment),
        update: () => import('./surface-world.js').then((m) => m.updateSurfaceWorldEnvironment),
    },
    4: {
        name: 'mountain-peaks',
        config: () => import('./mountain-peaks.js').then((m) => m.MOUNTAIN_PEAKS_CONFIG),
        create: () => import('./mountain-peaks.js').then((m) => m.createMountainPeaksEnvironment),
        update: () => import('./mountain-peaks.js').then((m) => m.updateMountainPeaksEnvironment),
    },
    5: {
        name: 'sky-drift',
        config: () => import('./sky-drift.js').then((m) => m.SKY_DRIFT_CONFIG),
        create: () => import('./sky-drift.js').then((m) => m.createSkyDriftEnvironment),
        update: () => import('./sky-drift.js').then((m) => m.updateSkyDriftEnvironment),
    },
    6: {
        name: 'cosmic-expanse',
        config: () => import('./cosmic-expanse.js').then((m) => m.COSMIC_EXPANSE_CONFIG),
        create: () => import('./cosmic-expanse.js').then((m) => m.createCosmicExpanseEnvironment),
        update: () => import('./cosmic-expanse.js').then((m) => m.updateCosmicExpanseEnvironment),
    },
};
