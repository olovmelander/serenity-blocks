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

/** Explain a failed solo attempt from its final metrics, without awarding a goal or stars. */
export function getOdysseyRetryDebrief(level, metrics, reason) {
    const primary = level?.victory?.primary;
    if (!primary || !metrics || level.mechanics?.versus) return null;
    const { type, target } = primary;
    const metricKey = {
        lines: 'lines', score: 'score', cascade: 'cascades', combo: 'maxCombo', time: 'time',
    }[type];
    if (!metricKey) return null;
    const value = metrics[metricKey];
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(value) || value < 0) return null;

    const count = (amount, singular, plural = `${singular}s`) => (
        `${amount.toLocaleString()} ${amount === 1 ? singular : plural}`
    );
    const units = {
        lines: 'line', score: 'point', cascade: 'cascade sequence', combo: 'wave', time: 'second',
    };
    const remaining = Math.ceil(Math.max(0, target - value));
    let remainingText = `${count(remaining, units[type])} short of the goal.`;
    if (type === 'combo') remainingText = `Aim for ${count(target, 'wave')} in one chain.`;
    if (value >= target) remainingText = 'The final total met the target, but the level was not completed.';

    const cues = {
        lines: 'Take safe line clears and leave space to place the next piece.',
        score: level.modifiers?.active?.includes('combo-multiplier')
            ? 'Clear lines with consecutive pieces to build the score multiplier.'
            : 'Look for multi-line clears and cascades to earn more points from each piece.',
        cascade: 'Aim for a clear that makes falling blocks clear again. '
            + 'Each locked piece can add one cascade sequence.',
        combo: 'Build a chain from one locked piece. The first clear counts as wave one; '
            + 'clears on later pieces start a new chain.',
        time: 'Keep the stack low and take safe clears while the timer runs.',
    };
    let tip = cues[type];
    if (reason === 'top-out') {
        tip = value >= target
            ? 'Keep room at the top of the board until the goal is secured.'
            : `Make room at the top before building for bigger clears. ${cues[type]}`;
    } else if (reason === 'time') {
        tip = value >= target
            ? 'Secure the goal within the time limit, including the time for the final cascade to settle.'
            : `${cues[type]} Focus on the main goal within the time limit; extra stars can wait for a replay.`;
    }

    return {
        objective: formatOdysseyMapObjective(primary),
        progressLabel: `${type === 'combo' ? 'Best chain: ' : ''}${Math.floor(value).toLocaleString()}`
            + ` / ${count(target, units[type])}`,
        value,
        target,
        remainingText,
        tip,
    };
}
