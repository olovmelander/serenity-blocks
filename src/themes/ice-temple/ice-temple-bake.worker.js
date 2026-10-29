/**
 * Web Worker entry for Ice Temple's bakes (ice-temple-bakes.js). Pure math only: the bake module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeArchitectureData, bakeNoiseMips } from './ice-temple-bake-data.js';

serveBakes({ noise: bakeNoiseMips, architecture: bakeArchitectureData });
