/**
 * Web Worker entry for Aurora's bakes (aurora-bakes.js). Pure math only: the noise and terrain
 * modules import no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeAuroraNoise } from './aurora-noise.js';
import { bakeShoreIce, rangeGridPositions } from './aurora-terrain.js';

serveBakes({ noise: bakeAuroraNoise, range: rangeGridPositions, ice: bakeShoreIce });
