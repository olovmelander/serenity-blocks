/**
 * Web Worker entry for Wolfhour's landscape bakes (wolfhour-landscape-bakes.js). Pure math only: the
 * bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeGranite, bakeRange } from './wolfhour-landscape-bake.js';

serveBakes({ range: bakeRange, granite: bakeGranite });
