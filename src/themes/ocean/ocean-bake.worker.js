/**
 * Web Worker entry for Ocean's first-visit bakes (ocean-theme.js): the seabed's sheet and the
 * floor the large animals keep over. Pure math only: the core imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeFloor, bakeSeabed } from './ocean-core.js';

serveBakes({ seabed: bakeSeabed, floor: bakeFloor });
