/**
 * Web Worker entry for Moonlit Greenhouse's garden noise (moonlit-greenhouse-theme.js). Pure math
 * only: the core imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeGardenNoise } from './moonlit-greenhouse-core.js';

serveBakes({ noise: bakeGardenNoise });
