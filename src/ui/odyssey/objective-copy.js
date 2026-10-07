/** Player-facing explanations of Odyssey's existing objective and finish rules. */
export function getOdysseyChainTarget(condition = {}) {
    // Both metrics receive the same wave ordinal from a single piece's cascade.
    // Keep the authored conditions intact; present their strongest requirement.
    return Math.max(condition.combo || 0, condition.maxCascadeDepth || 0);
}

export function formatOdysseyChainGoal(target) {
    return `Trigger a chain of at least ${target} waves`;
}

export function formatOdysseyMapObjective(primary) {
    if (!primary) return 'Complete the level';
    switch (primary.type) {
    case 'lines': return `Clear ${primary.target} lines`;
    case 'score': return `Score ${primary.target.toLocaleString()} points`;
    case 'cascade': return `Trigger ${primary.target} cascades`;
    case 'time': return `Survive ${primary.target} seconds`;
    case 'combo': return formatOdysseyChainGoal(primary.target);
    case 'frags': return primary.description || `Beat the bot · First to ${primary.target} frags`;
    default: return `Complete: ${primary.type} (${primary.target})`;
    }
}

export function formatOdysseyBonusObjective(bonus) {
    if (bonus.type === 'combo' || bonus.type === 'max-cascade-depth') {
        return formatOdysseyChainGoal(bonus.target);
    }
    return bonus.description;
}

export function getOdysseyLevelGuide(level) {
    const parts = [level.metadata?.tip || ''];
    if (level.mechanics?.versus) return parts[0];

    const hasChainGoal = level.victory?.primary?.type === 'combo'
        || Object.values(level.stars || {}).some((condition) => getOdysseyChainTarget(condition) > 0)
        || (level.victory?.bonuses || []).some((bonus) => (
            bonus.type === 'combo' || bonus.type === 'max-cascade-depth'
        ));
    if (hasChainGoal) {
        parts.push('A chain counts all clear waves from one locked piece, including the first clear.');
        if (level.modifiers?.active?.includes('combo-multiplier')) {
            parts.push('Clears on consecutive pieces raise the score multiplier separately; '
                + 'they do not extend the chain.');
        }
    }

    if (level.victoryLapPolicy === 'none') {
        parts.push('The level ends automatically at the goal, after the full cascade settles. '
            + 'Every wave of that final cascade counts toward your stars.');
    } else if (level.victoryLapPolicy === 'showcase') {
        if (level.victory?.failure?.type === 'time') {
            parts.push('Reach the goal within the time limit.');
        }
        parts.push('After the goal, keep playing for stars until you choose Finish level or top out.');
    }
    return parts.filter(Boolean).join(' ');
}
