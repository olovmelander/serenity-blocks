/**
 * The Stillfall certifier for tiers 7 and 8 (Aftershock, Cross fault): three pieces, the
 * seal, and two goals at once. The standard is the one every tier meets
 * (tests/unit/helpers/stillfall-certify.js); this file only gives these tiers a worker of
 * their own in CI.
 */
import { describe } from 'vitest';
import { CERTIFIED_TIER_GROUPS, certifyTiers } from './helpers/stillfall-certify.js';

describe('Stillfall puzzle bank', () => {
    certifyTiers(CERTIFIED_TIER_GROUPS[1]);
});
