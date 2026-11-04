import { describe, expect, it } from 'vitest';

import { ODYSSEY_PEAK_SPECS } from '../../src/rendering/odyssey/world/odyssey-peak-specs.js';

/**
 * The world owns the peak geometry: `odyssey-peak-specs.js` is the authority, and
 * `odyssey-world-height.test.js` checks the height field's ODYSSEY_MASSIFS against it.
 */

describe('the peak specs', () => {
    it('are deeply frozen data with no room for runtime mutation', () => {
        expect(Object.isFrozen(ODYSSEY_PEAK_SPECS)).toBe(true);
        ODYSSEY_PEAK_SPECS.forEach((peak) => expect(Object.isFrozen(peak)).toBe(true));
    });
});
