/**
 * Web Worker entry for Pyrestorm's tier-free bakes (pyrestorm-world.js, pyrestormBakes). Pure math
 * only: the bake module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import {
    bakeBillows, bakeLattice, bakeLavaFields, bakeNoise,
} from './pyrestorm-bake.js';

serveBakes({
    all: () => ({
        lava: bakeLavaFields(),
        noise: bakeNoise(),
        lattice: bakeLattice(),
        billows: bakeBillows(),
    }),
});
