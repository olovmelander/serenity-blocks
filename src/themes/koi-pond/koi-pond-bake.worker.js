/**
 * Web Worker entry for Koi Pond's first-visit bakes (koi-pond-theme.js): the pebble field, the
 * noise and the water mask. Pure math only: no three import.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoise, bakeWaterMaskOnce } from './koi-pond-core.js';
import { bakePebbles } from './koi-pond-pebbles.js';

serveBakes({ pebbles: bakePebbles, noise: bakeNoise, mask: bakeWaterMaskOnce });
