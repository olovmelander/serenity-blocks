/**
 * Web Worker entry for Cosmic Noir's bakes (cosmic-noir-bakes.js). Pure math only: the bake module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSeaField, bakeSmokeNoise } from './cosmic-noir-bake.js';

serveBakes({ smoke: bakeSmokeNoise, sea: bakeSeaField });
