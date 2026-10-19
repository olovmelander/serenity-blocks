/**
 * The Stillfall certifier for tier 9 (Mantle): four pieces, one goal. The standard is the
 * one every tier meets (tests/unit/helpers/stillfall-certify.js); this file only gives this
 * tier a worker of its own in CI.
 */
import { describe } from 'vitest';
import { CERTIFIED_TIER_GROUPS, certifyTiers } from './helpers/stillfall-certify.js';

describe('Stillfall puzzle bank', () => {
    certifyTiers(CERTIFIED_TIER_GROUPS[2]);
});
