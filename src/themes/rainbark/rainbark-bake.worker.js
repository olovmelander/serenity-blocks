/**
 * Web Worker entry for Rainbark's first-visit bakes (rainbark-world.js, rainbarkBakes). Pure math
 * only: the bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeAtlasSet, bakeCanopySet } from './rainbark-bake.js';

serveBakes({ canopy: bakeCanopySet, atlas: bakeAtlasSet });
