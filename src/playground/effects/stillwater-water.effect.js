/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater Wave 3 — "The Pool Remembers" integrated water-response proof.
 *
 * Phase-locked comparison URLs:
 *   ?effect=stillwater-water&quality=High&reflection=auto&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=High&reflection=off&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=Low&reflection=auto&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=High&reflection=auto&forceWebGL=1&t=8
 *   ?effect=stillwater-water&quality=High&reflection=auto&grade=aces&t=8
 *   ?effect=stillwater-water&quality=High&event=lock&fxAge=.20&t=8
 *   ?effect=stillwater-water&quality=High&event=tetris&fxAge=.42&t=8
 *   ?effect=stillwater-water&quality=High&event=tspin&fxAge=.34&t=8
 *   ?effect=stillwater-water&quality=High&responses=off&t=8
 *
 * The visual graph is production-owned. This adapter only publishes playground
 * metadata and the capture/debug hook used by the evidence runner.
 */
import { createStillwaterWater } from '../../themes/stillwater/rendering/stillwater-water.js';

export const meta = {
    id: 'stillwater-water',
    title: 'Stillwater — The Pool Remembers',
    description: 'Black-water optics with fixed-budget lock, Quad, and T-spin displacement responses.',
};

export function create(context) {
    const runtime = createStillwaterWater(context);
    const debugApi = Object.freeze({
        getDiagnostics: runtime.getDiagnostics,
        getRendererCounters: runtime.getRendererCounters,
        getResourceState: runtime.getResourceState,
        getCaptureMeta: runtime.getCaptureMeta,
        getResponseState: runtime.getResponseState,
        triggerReaction: runtime.triggerReaction,
        clearReactions: runtime.clearReactions,
    });

    if (typeof window !== 'undefined') window.__STILLWATER_WATER__ = debugApi;

    return {
        ...runtime,
        dispose() {
            if (
                typeof window !== 'undefined'
                && window.__STILLWATER_WATER__ === debugApi
            ) {
                delete window.__STILLWATER_WATER__;
            }
            runtime.dispose();
        },
    };
}
