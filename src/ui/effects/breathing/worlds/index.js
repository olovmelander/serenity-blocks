/**
 * World id → builder, and world id → its moods (stage/breath-moods.js). Ids are the persisted
 * `breathingTechnique` setting values. Each world module exports `MOODS`: the versions of the
 * scene a visit can show, first the one its poster shows.
 */
import { createAuroraWorld, MOODS as AURORA_MOODS } from './aurora.js';
import { createCrystalWorld, MOODS as CRYSTAL_MOODS } from './crystal.js';
import { createForestWorld, MOODS as FOREST_MOODS } from './forest.js';
import { createLotusWorld, MOODS as LOTUS_MOODS } from './lotus.js';
import { createMoonlitWorld, MOODS as MOONLIT_MOODS } from './moonlit.js';
import { createNebulaWorld, MOODS as NEBULA_MOODS } from './nebula.js';
import { createOceanWorld, MOODS as OCEAN_MOODS } from './ocean.js';
import { createSacredWorld, MOODS as SACRED_MOODS } from './sacred.js';
import { createSolarWorld, MOODS as SOLAR_MOODS } from './solar.js';
import { createStormWorld, MOODS as STORM_MOODS } from './storm.js';
import { createVolcanicWorld, MOODS as VOLCANIC_MOODS } from './volcanic.js';
import { createZenWorld, MOODS as ZEN_MOODS } from './zen.js';

export const BREATH_WORLD_BUILDERS = Object.freeze({
    'deep-relaxation': createAuroraWorld,
    'box-breathing': createSacredWorld,
    'calm-sleep': createMoonlitWorld,
    energizing: createSolarWorld,
    coherence: createLotusWorld,
    triangle: createCrystalWorld,
    'wim-hof': createVolcanicWorld,
    'ocean-breath': createOceanWorld,
    'zen-garden': createZenWorld,
    'cosmic-breath': createNebulaWorld,
    'forest-breath': createForestWorld,
    'electric-storm': createStormWorld,
});

/** @type {Readonly<Record<string, ReadonlyArray<{id: string, name: string}>>>} */
export const BREATH_WORLD_MOODS = Object.freeze({
    'deep-relaxation': AURORA_MOODS,
    'box-breathing': SACRED_MOODS,
    'calm-sleep': MOONLIT_MOODS,
    energizing: SOLAR_MOODS,
    coherence: LOTUS_MOODS,
    triangle: CRYSTAL_MOODS,
    'wim-hof': VOLCANIC_MOODS,
    'ocean-breath': OCEAN_MOODS,
    'zen-garden': ZEN_MOODS,
    'cosmic-breath': NEBULA_MOODS,
    'forest-breath': FOREST_MOODS,
    'electric-storm': STORM_MOODS,
});
