/**
 * Web Worker entry for Sky Children's CPU bakes (sky-children-theme.js). Pure math only: the core
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import {
    bakeOpticsLut, bakePuff, bakeSeaField, bakeSkyNoise, bakeStoneNoise,
} from './sky-children-core.js';

serveBakes({
    sky: bakeSkyNoise,
    stone: bakeStoneNoise,
    optics: bakeOpticsLut,
    puff: bakePuff,
    sea: bakeSeaField,
});
