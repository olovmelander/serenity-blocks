/**
 * Compatibility exports for the Stillwater Wave 3 playground proof.
 *
 * The allocation-stable response state is production-owned so the playground
 * and the theme runtime exercise the same fixed-slot implementation.
 */
export {
    createStillwaterWaterResponseState,
    STILLWATER_RESPONSE_CAPACITY,
    STILLWATER_RESPONSE_KIND,
} from '../../themes/stillwater/sim/stillwater-water-response.js';
