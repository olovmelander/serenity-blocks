/**
 * Web Worker entry for Cinder Drift's baked fields (cinder-drift-bakes.js). Pure math only: the
 * bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoise, bakePlates } from './cinder-drift-bake.js';
import { bakePlanData } from './cinder-drift-layout.js';

serveBakes({ noise: bakeNoise, plates: bakePlates, plan: bakePlanData });
