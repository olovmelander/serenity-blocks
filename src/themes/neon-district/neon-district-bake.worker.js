/**
 * Web Worker entry for Neon District's first-visit bakes (neon-district-bakes.js): the noise's
 * levels, the glyph atlas and the tube logos. Pure math only: neither module imports three.
 */
import { serveBakes } from '../shared/bake-worker-host.js';
import { bakeNoiseLevels } from './neon-district-bake.js';
import { bakeGlyphAtlas } from './neon-district-glyphs.js';
import { bakeLogoAtlas } from './neon-district-logos.js';

serveBakes({ noise: bakeNoiseLevels, glyphs: bakeGlyphAtlas, logos: bakeLogoAtlas });
