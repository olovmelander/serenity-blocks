/**
 * Ocean's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the seabed's
 * sheet, about 0.5 s of main thread, bakes in a module Worker while the renderer comes up, and the
 * build finds it in the bake cache.
 */
import { seabedKey } from './ocean-core.js';
import { tierFor } from './ocean-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** Start the bakes a world of this quality builds from; resolves when they are kept (never rejects). */
export function oceanBakes(quality) {
    return bakeInWorker({
        jobs: [{ kind: 'seabed', args: [tierFor(quality).seabed] }],
        keyOf: ({ args }) => seabedKey(...args),
        createWorker: () => new Worker(new URL('./ocean-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}
