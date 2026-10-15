/**
 * Web Worker entry for Stellar Velocity's noise bakes (stellar-velocity-bakes.js). Pure math only:
 * the bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeCanyonNoise, bakeFbm } from './stellar-velocity-bake.js';

serveBakes({ canyon: bakeCanyonNoise, fbm: bakeFbm });
