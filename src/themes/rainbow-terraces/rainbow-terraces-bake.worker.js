/**
 * Web Worker entry for Rainbow Terraces' CPU bakes (rainbow-terraces-theme.js). Pure math only: the core
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import {
    bakeOpticsLut, bakePuff, bakeSeaField, bakeSkyNoise, bakeStoneNoise,
} from './rainbow-terraces-core.js';

serveBakes({
    sky: bakeSkyNoise,
    stone: bakeStoneNoise,
    optics: bakeOpticsLut,
    puff: bakePuff,
    sea: bakeSeaField,
});
