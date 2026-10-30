/**
 * Web Worker entry for Galaxy's bake (galaxy-bakes.js). Pure math only: the bake module imports no
 * three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoiseData } from './galaxy-bake-data.js';

serveBakes({ noise: bakeNoiseData });
