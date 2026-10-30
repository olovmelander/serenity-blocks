/**
 * Web Worker entry for Halcyon Apex's bake (halcyon-apex-bakes.js). Pure math only: the bake
 * module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoiseData } from './halcyon-apex-bake-data.js';

serveBakes({ noise: bakeNoiseData });
