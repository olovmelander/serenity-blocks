/**
 * Web Worker entry for Sunset's noise bakes (sunset-bakes.js). Pure math only: the core imports no
 * three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSeaNoise, bakeSkyNoise } from './sunset-core.js';

serveBakes({ sky: bakeSkyNoise, sea: bakeSeaNoise });
