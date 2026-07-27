/**
 * Stillwater Wave 4a — isolated forest/canopy language.
 *
 * No mushrooms, particles, characters, water optics, or post-processing:
 * this pilot proves the S-shore terrain and five-draw tree/canopy silhouette.
 */
import { createStillwaterWave4Playground } from './stillwater-wave4-playground.js';

export const meta = {
    id: 'stillwater-forest',
    title: 'Stillwater — Forest Language',
    description: 'Instanced root-flare trees, canopy gaps, shoreline roots, reeds, stones, and lilies.',
};

export function create(context) {
    return createStillwaterWave4Playground(context, {
        mode: 'forest',
        id: meta.id,
        debugKey: '__STILLWATER_FOREST__',
    });
}
