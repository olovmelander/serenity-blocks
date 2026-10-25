/**
 * Verdant Hills' first-visit CPU bake, off the page's thread (shared/bake-worker-client.js): the
 * cumulus's 3D noise (about 0.25 s of main thread) bakes in a module Worker while the renderer and
 * the asset pack come up, and the light rig finds it in the bake cache.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    VERDANT_HILLS_CLOUD_VOLUME_SEED, VERDANT_HILLS_CLOUD_VOLUME_SIZE, verdantHillsCloudVolumeKey,
} from './verdant-hills-cloud-volume.js';
import { VERDANT_HILLS_TIERS } from './verdant-hills-quality.js';

const CLOUD_VOLUME_JOB = Object.freeze({
    kind: 'cloudVolume', args: Object.freeze([VERDANT_HILLS_CLOUD_VOLUME_SIZE, VERDANT_HILLS_CLOUD_VOLUME_SEED]),
});

/** The bakes a world of this quality builds from, as worker jobs (none for the flat sky). */
export function verdantHillsBakeJobs(quality) {
    const tier = VERDANT_HILLS_TIERS[quality] || VERDANT_HILLS_TIERS.High;
    return tier.cloudSteps > 0 ? [CLOUD_VOLUME_JOB] : [];
}

/** The bake cache key a job's bake keeps its result under. */
export const verdantHillsBakeKey = ({ args }) => verdantHillsCloudVolumeKey(...args);

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function verdantHillsBakes(quality) {
    return bakeInWorker({
        jobs: verdantHillsBakeJobs(quality),
        keyOf: verdantHillsBakeKey,
        createWorker: () => new Worker(
            new URL('./verdant-hills-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
