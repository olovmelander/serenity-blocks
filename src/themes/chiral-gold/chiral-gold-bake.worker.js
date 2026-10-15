/**
 * Web Worker entry for Chiral Gold's first-visit bakes (chiral-gold-bakes.js). Pure math only: the
 * bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoise, bakeStudio } from './chiral-gold-bake.js';

serveBakes({ noise: bakeNoise, studio: bakeStudio });
