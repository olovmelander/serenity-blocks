/**
 * Web Worker entry for Stellar Drift's bakes (stellar-drift-bakes.js). Pure math only: the bake
 * module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import {
    bakeBandMeta, bakeFbm, bakeLattice, bakeRingProfile,
} from './stellar-drift-bake.js';
import { bakeMoon } from './stellar-drift-moon-bake.js';

serveBakes({
    lattice: bakeLattice, fbm: bakeFbm, ring: bakeRingProfile, bands: bakeBandMeta, moon: bakeMoon,
});
