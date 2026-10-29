/**
 * Web Worker entry for Starlight's sky bakes (starlight-bakes.js). Pure math only: the core module
 * imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeSkyData } from './starlight-core.js';

serveBakes({ sky: bakeSkyData });
