/**
 * Stillwater Wave 4b — isolated authored mushroom clusters.
 *
 * Mounts the exact forest builder in flora-detail mode, adding only three
 * fixed instanced draws: stems, emissive caps/gills, and fake ground pools.
 */
import { createStillwaterWave4Playground } from './stillwater-wave4-playground.js';

export const meta = {
    id: 'stillwater-flora',
    title: 'Stillwater — Flora Relay',
    description: 'Four seeded bioluminescent mushroom clusters waking shore-to-shore without real lights.',
};

export function create(context) {
    return createStillwaterWave4Playground(context, {
        mode: 'flora',
        id: meta.id,
        debugKey: '__STILLWATER_FLORA__',
    });
}
