import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeCosmicNebulaData, bakeRainbowGiantData } from './chromadelic-highway-bake-data.js';

serveBakes({ giant: bakeRainbowGiantData, nebula: bakeCosmicNebulaData });
