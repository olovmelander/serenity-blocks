/**
 * Web Worker entry for Verdant Hills' cumulus volume (verdant-hills-bakes.js). Pure math only: the
 * volume module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { computeVerdantHillsCloudVolume } from './verdant-hills-cloud-volume.js';

serveBakes({ cloudVolume: computeVerdantHillsCloudVolume });
