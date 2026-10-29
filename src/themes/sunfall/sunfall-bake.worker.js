/**
 * Web Worker entry for Sunfall's bakes (sunfall-bakes.js). Pure math only: the bake-data module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeFbm, bakeLattice, bakeOculus } from './sunfall-bake-data.js';

serveBakes({ lattice: bakeLattice, fbm: bakeFbm, oculus: bakeOculus });
