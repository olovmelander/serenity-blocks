/**
 * Web Worker entry for Cosmic Noir's bakes (cosmic-noir-bakes.js). Pure math only: the bake module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeFoamLace, bakeSeaField, bakeSmokeNoise } from './cosmic-noir-bake.js';
import { bakeRockField } from './cosmic-noir-rock.js';

serveBakes({
    smoke: bakeSmokeNoise, sea: bakeSeaField, lace: bakeFoamLace, rock: bakeRockField,
});
