/**
 * Web Worker entry for Void Ember's plates bake (void-ember-bakes.js). Pure math only: the core
 * module imports no three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakePlates } from './void-ember-core.js';

serveBakes({ plates: bakePlates });
