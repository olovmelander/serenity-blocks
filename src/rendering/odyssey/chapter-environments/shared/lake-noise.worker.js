/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * Web Worker entry for the Earth Core lake noise bake (docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md
 * §2.5 step 5). Pure math only — no three import. Posts the half-float texel buffer (transferred),
 * the fitted quantile knots, the statistics and the CRC so the main thread can pin them.
 */
import { bakeLakeNoise } from './odyssey-lake-noise-math.js';

self.onmessage = (event) => {
    const options = event?.data || {};
    try {
        const result = bakeLakeNoise(options);
        self.postMessage({
            ok: true,
            data: result.data,
            res: result.res,
            k: result.k,
            periodP: result.periodP,
            knots: Array.from(result.knots),
            stats: result.stats,
            crc32: result.crc32,
        }, [result.data.buffer]);
    } catch (error) {
        self.postMessage({ ok: false, error: String(error?.message || error) });
    }
};
