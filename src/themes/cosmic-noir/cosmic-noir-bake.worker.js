/**
 * Web Worker entry for Cosmic Noir's noise bake (cosmic-noir-bakes.js). Pure math only: the bake
 * module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSmokeNoise } from './cosmic-noir-bake.js';

serveBakes({ smoke: bakeSmokeNoise });
