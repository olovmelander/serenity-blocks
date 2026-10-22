/**
 * The Stillfall certifier for Pinnacle (tier 12): five pieces, tall towers and two goals at once,
 * shard 1 of CERTIFIED_SHARDS[12]. The standard is the one every tier meets
 * (tests/unit/helpers/stillfall-certify.js); a five-piece puzzle takes seconds to prove, so
 * the tier is shared among files that CI runs side by side.
 */
import { describe } from 'vitest';
import { certifyShard } from './helpers/stillfall-certify.js';

describe('Stillfall puzzle bank', () => {
    certifyShard(12, 0);
});
