/**
 * The Stillfall certifier for Uplift (tier 11): five pieces against towers twice as tall,
 * shard 2 of CERTIFIED_SHARDS[11]. The standard is the one every tier meets
 * (tests/unit/helpers/stillfall-certify.js); a five-piece puzzle takes seconds to prove, so
 * the tier is shared among files that CI runs side by side.
 */
import { describe } from 'vitest';
import { certifyShard } from './helpers/stillfall-certify.js';

describe('Stillfall puzzle bank', () => {
    certifyShard(11, 1);
});
