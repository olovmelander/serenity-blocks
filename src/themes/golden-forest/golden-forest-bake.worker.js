/**
 * Web Worker entry for Golden Forest's lake map (golden-forest-bakes.js). Pure math only: the shape
 * module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeLakeMap } from './golden-forest-shape.js';

serveBakes({ lakeMap: bakeLakeMap });
