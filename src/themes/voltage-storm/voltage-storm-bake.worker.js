/**
 * Web Worker entry for Voltage Storm's noise bakes (voltage-storm-bakes.js). Pure math only: the
 * bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeCloudNoise, bakeNoise } from './voltage-storm-bake.js';

serveBakes({ noise: bakeNoise, cloud: bakeCloudNoise });
