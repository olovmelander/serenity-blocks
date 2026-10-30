/**
 * Web Worker entry for Waves' bake (waves-bakes.js). Pure math only: waves-core.js imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeWaterNoise } from './waves-core.js';

serveBakes({ water: bakeWaterNoise });
