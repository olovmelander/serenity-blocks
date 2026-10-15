/**
 * Web Worker entry for Koi Pond's pebble field (koi-pond-theme.js). Pure math only: no three import.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakePebbles } from './koi-pond-pebbles.js';

serveBakes({ pebbles: bakePebbles });
