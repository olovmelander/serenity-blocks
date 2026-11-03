import { getLevelById } from '../../src/core/odyssey/data/levels.js';

/**
 * The three mastery orbs as they shipped before the level design retune (2026-11), for the benchmark's
 * mastery-search and mastery-geometry tooling tests. Those tools were built against these joint Quad-and-
 * chain tiers; the retune removed them from the campaign (no tier mixes Quads with chains any more), so
 * the tests keep exercising the tools on a frozen copy instead of the live orbs.
 */
const SHIPPED_2026_10 = Object.freeze({
    49: {
        speed: { startLevel: 7, levelProgression: true, fixedDropInterval: null },
        victory: {
            primary: { type: 'score', target: 36000 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'quad-count', target: 10, description: 'Clear 10 Quads' },
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-wave chain' },
            ],
        },
        stars: {
            one: { score: 36000 },
            two: { score: 36000, quads: 8 },
            three: { score: 36000, quads: 10, maxCascadeDepth: 5 },
        },
        modifiers: { active: ['combo-multiplier'] },
    },
    55: {
        speed: { startLevel: 12, levelProgression: false, fixedDropInterval: 500 },
        victory: {
            primary: { type: 'score', target: 250000 },
            failure: { type: 'time', value: 480 },
            bonuses: [
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6-wave chain' },
                { type: 'cascade', target: 25, description: 'Trigger 25 cascades' },
                { type: 'quad-count', target: 12, description: 'Clear 12 Quads' },
            ],
        },
        stars: {
            one: { score: 250000 },
            two: { score: 320000, cascades: 20, maxCascadeDepth: 4 },
            three: { score: 400000, cascades: 28, maxCascadeDepth: 6 },
        },
        modifiers: { active: ['gravity-cascade', 'combo-multiplier'] },
    },
    59: {
        speed: { startLevel: 11, levelProgression: true, fixedDropInterval: null },
        victory: {
            primary: { type: 'score', target: 160000 },
            failure: { type: 'time', value: 210 },
            bonuses: [
                { type: 'cascade', target: 20, description: 'Trigger 20 cascades' },
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6-wave chain' },
            ],
        },
        stars: {
            one: { score: 160000 },
            two: { score: 200000, cascades: 16, maxCascadeDepth: 4 },
            three: { score: 240000, cascades: 20, maxCascadeDepth: 6 },
        },
        modifiers: { active: ['gravity-cascade', 'combo-multiplier', 'time-attack'] },
    },
});

/** A fresh copy of a live orb with its shipped 2026-10 mastery rules (49, 55 or 59); other ids pass through. */
export function shippedMasteryOrb(id) {
    const level = structuredClone(getLevelById(id));
    const shipped = SHIPPED_2026_10[id];
    if (!shipped) return level;
    const copy = structuredClone(shipped);
    level.mechanics.speed = copy.speed;
    level.victory = copy.victory;
    level.stars = copy.stars;
    level.modifiers = copy.modifiers;
    return level;
}
