/**
 * Web Worker entry for Ocean's seabed sheet (ocean-theme.js). Pure math only: the core imports no
 * three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSeabed } from './ocean-core.js';

serveBakes({ seabed: bakeSeabed });
