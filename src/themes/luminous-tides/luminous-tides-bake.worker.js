/**
 * Web Worker entry for Luminous Tides' noise bakes (luminous-tides-bakes.js). Pure math only: the
 * core imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSeaNoise, bakeSkyNoise } from './luminous-tides-core.js';

serveBakes({ sky: bakeSkyNoise, sea: bakeSeaNoise });
