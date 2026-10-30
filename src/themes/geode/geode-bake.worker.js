/**
 * Web Worker entry for Geode's bakes (geode-bakes.js). Pure math only: the bake module imports no
 * three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeGeodeData } from './geode-bake-data.js';

serveBakes({ geode: bakeGeodeData });
