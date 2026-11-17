/**
 * Web Worker entry for Supernova's noise and cell bakes (supernova-bakes.js). Pure math only: the bake module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeCells3D, bakeNoise3D } from './supernova-bake.js';

serveBakes({ noise3: bakeNoise3D, cells3: bakeCells3D });
