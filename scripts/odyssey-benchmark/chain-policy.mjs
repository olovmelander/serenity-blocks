/** Experimental benchmark policy only; never used by production opponents. */
export const CHAIN_PROFILE = Object.freeze({
    id: 'chain',
    label: 'Experimental chain builder',
    experimental: true,
    difficulty: 9,
    lookaheadDepth: 3,
    description: 'Prioritizes new cascade-depth records using three previews; exploratory, not a human skill rating.',
    reactionMs: Object.freeze([35, 65]),
    actionIntervalMs: 65,
    mistakeChance: 0,
});

/**
 * Frozen development candidate: progress, four roots and two branches per future
 * ply. The caller uses the existing bounded search with three visible previews.
 * Exact utility ties retain the existing specialist score as a secondary rank,
 * matching the prototype's stable sort rather than placement enumeration order.
 * Reward a deeper realized wave sequence more than repeatedly firing a shallow
 * chain. Board preparation is only a heuristic; it never inserts a trigger or
 * counts as a demonstrated outcome. Candidate waves come from resolveCascade.
 *
 * Seeds 9101–9103 are development evidence. This policy sacrifices survival on
 * some boards and does not establish that authored mastery goals are fair.
 */
export function chainUtility(candidate) {
    const depth = candidate.cascadeCount;
    const previousDepth = candidate.metricsBefore.maxCascadeDepth || 0;
    const rewardScale = depth > previousDepth ? 300 : 15;
    const metrics = candidate.boardMetrics;
    return (depth >= 2 ? depth ** 3 * rewardScale : 0)
        + candidate.preparationAfter.preparationScore * 10
        - metrics.holes * 7
        - metrics.maxHeight * 3
        - metrics.bumpiness * 2
        - metrics.topOutRisk * 200
        - candidate.pathCost * 0.3;
}
