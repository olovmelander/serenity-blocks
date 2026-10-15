/**
 * Web Worker entry for Serenity Warp's noise bakes (serenity-warp-bakes.js). Pure math only: the
 * bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeFbm, bakeGasNoise } from './serenity-warp-bake.js';

serveBakes({ gas: bakeGasNoise, fbm: bakeFbm });
