/**
 * Web Worker entry for Solar Eclipse's sky bakes (solar-eclipse-bakes.js). Pure math only: the
 * core module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeEclipseData } from './solar-eclipse-core.js';

serveBakes({ sky: bakeEclipseData });
