/**
 * Web Worker entry for Thermal Bloom's CPU bakes (thermal-bloom-bake-loader.js). Pure math only:
 * no three import.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import {
    bakeCellular, bakeNoise, bakeVapourNoise, computeStairArrays,
} from './thermal-bloom-bake.js';

serveBakes({
    noise: bakeNoise,
    cellular: bakeCellular,
    vapour: bakeVapourNoise,
    stair: computeStairArrays,
});
