/** World id → builder. Ids are the persisted `breathingTechnique` setting values. */
import { createAuroraWorld } from './aurora.js';
import { createCrystalWorld } from './crystal.js';
import { createForestWorld } from './forest.js';
import { createLotusWorld } from './lotus.js';
import { createMoonlitWorld } from './moonlit.js';
import { createNebulaWorld } from './nebula.js';
import { createOceanWorld } from './ocean.js';
import { createSacredWorld } from './sacred.js';
import { createSolarWorld } from './solar.js';
import { createStormWorld } from './storm.js';
import { createVolcanicWorld } from './volcanic.js';
import { createZenWorld } from './zen.js';

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
