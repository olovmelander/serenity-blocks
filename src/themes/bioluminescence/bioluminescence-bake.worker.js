/**
 * Web Worker entry for Bioluminescence's first-visit bakes (bioluminescence-bakes.js). Pure math
 * only: the layout and the core import no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakePlan } from './bioluminescence-layout.js';

serveBakes({ plan: bakePlan });
