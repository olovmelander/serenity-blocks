/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Thin playground adapter for the production-owned Stillwater composition.
 *
 *   ?effect=stillwater-masterpiece&quality=High&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&event=tetris&fxAge=.42&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=Low&reducedMotion=1&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&forceWebGL=1&orbit=0&t=8
 */
import {
    createStillwaterRuntime,
    meta,
} from '../../themes/stillwater/rendering/stillwater-runtime.js';

export {
    acceptsLocalStillwaterPayload,
    createStillwaterMasterpieceRuntime,
    createStillwaterRuntime,
    STILLWATER_MASTERPIECE_RUNTIME_ID,
    writeStillwaterWaterReaction,
} from '../../themes/stillwater/rendering/stillwater-runtime.js';

export { meta };

export function create(context) {
    const runtime = createStillwaterRuntime(context);
    const disposeRuntime = runtime.dispose;
    runtime.dispose = () => {
        if (
            typeof window !== 'undefined'
            && window.__STILLWATER_MASTERPIECE__ === runtime
        ) {
            delete window.__STILLWATER_MASTERPIECE__;
        }
        disposeRuntime();
    };

    if (typeof window !== 'undefined') {
        window.__STILLWATER_MASTERPIECE__ = runtime;
    }
    return runtime;
}
