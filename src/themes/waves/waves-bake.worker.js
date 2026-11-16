/**
 * Web Worker entry for Waves' bakes (waves-bakes.js). Pure math only: waves-core.js imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeFoamLace, bakeWaterNoise } from './waves-core.js';

serveBakes({ water: bakeWaterNoise, foam: bakeFoamLace });
