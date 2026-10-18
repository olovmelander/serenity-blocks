import { formatOdysseyDuelGoal } from '../../core/odyssey/data/duel-rules.js';

/** Player-facing explanations of Odyssey's existing goal and finish rules. */
export function getOdysseyChainTarget(condition = {}) {
    // Both metrics receive the same wave ordinal from a single piece's cascade.
    // Keep the authored conditions intact; present their strongest requirement.
    return Math.max(condition.combo || 0, condition.maxCascadeDepth || 0);
}

export function formatOdysseyChainGoal(target) {
    return `Trigger a chain of at least ${target} waves`;
}

export function formatOdysseyMapObjective(primary) {
    if (!primary) return 'Clear the orb';
    switch (primary.type) {
    case 'lines': return `Clear ${primary.target} lines`;
    case 'score': return `Score ${primary.target.toLocaleString()} points`;
    case 'cascade': return `Trigger ${primary.target} cascades`;
    case 'time': return `Survive ${primary.target} seconds`;
    case 'combo': return formatOdysseyChainGoal(primary.target);
    case 'frags': return primary.description || formatOdysseyDuelGoal('the rival', primary.target);
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
        parts.push('The orb ends automatically at the goal, after the full cascade settles. '
            + 'Every wave of that final cascade counts toward your stars.');
    } else if (level.victoryLapPolicy === 'showcase') {
        if (level.victory?.failure?.type === 'time') {
            parts.push('Reach the goal within the time limit.');
        }
        parts.push('After the goal, keep playing for stars until you choose Finish orb or top out.');
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
    if (value >= target) remainingText = 'The final total met the target, but the orb was not cleared.';

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

/** One star tier's conditions as the HUD, map panel and results all phrase them. */
export function formatOdysseyStarCondition(condition, starIndex = 0) {
    const parts = [];
    let hasChainRequirement = false;
    for (const [key, value] of Object.entries(condition || {})) {
        switch (key) {
        case 'lines':
            parts.push(starIndex === 0 ? 'Clear the orb' : `${value} lines`);
            break;
        case 'score':
            parts.push(starIndex === 0 ? 'Clear the orb' : `${value.toLocaleString()}+ pts`);
            break;
        case 'cascades':
            parts.push(starIndex === 0 ? 'Clear the orb' : `${value}+ cascades`);
            break;
        case 'time':
            parts.push(formatOdysseyUnderTime(value));
            break;
        case 'tetrises':
            parts.push(`${value}+ quads`);
            break;
        case 'maxCascadeDepth':
        case 'combo':
            if (!hasChainRequirement) {
                parts.push(`${getOdysseyChainTarget(condition)}-wave chain`);
                hasChainRequirement = true;
            }
            break;
        case 'bonuses':
            parts.push(value === 1 ? 'Get bonus' : `${value} bonuses`);
            break;
        case 'frags':
            parts.push(starIndex === 0 ? 'Win the match' : `Win ${value} knockouts`);
            break;
        case 'maxDeaths':
            parts.push(value === 0 ? 'No top-outs' : `At most ${value} top-out${value === 1 ? '' : 's'}`);
            break;
        default:
            break;
        }
    }
    if (parts.length === 0 && starIndex === 0) parts.push('Clear the orb');
    return parts.join(' + ') || '...';
}

function formatOdysseyUnderTime(seconds) {
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs === 0 ? `Under ${mins} min` : `Under ${mins}:${String(secs).padStart(2, '0')}`;
    }
    return `Under ${seconds}s`;
}

function formatOdysseyClock(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A number from the results, or null when the attempt never reported that metric. */
function readOdysseyMetric(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** The numbers a finished attempt reports, in the units star conditions use; null when unknown. */
function readOdysseyStarMetrics(results = {}) {
    const chainReadings = [results.maxCascadeDepth, results.combo, results.maxCombo]
        .map(readOdysseyMetric).filter((value) => value !== null);
    const chain = chainReadings.length ? Math.max(...chainReadings) : null;
    const bonuses = Array.isArray(results.bonuses)
        ? results.bonuses.filter((bonus) => bonus === true || bonus?.earned === true).length
        : readOdysseyMetric(results.bonuses);
    return {
        lines: readOdysseyMetric(results.lines),
        score: readOdysseyMetric(results.score),
        cascades: readOdysseyMetric(results.cascades),
        maxCascadeDepth: chain,
        combo: chain,
        tetrises: readOdysseyMetric(results.tetrises),
        time: readOdysseyMetric(results.time),
        bonuses,
        frags: readOdysseyMetric(results.duel?.playerFrags ?? results.frags),
        maxDeaths: readOdysseyMetric(results.duel?.deaths ?? results.deaths),
    };
}

/** true or false against the condition, or null when the attempt did not report the metric. */
function odysseyStarPartMet(key, value, metrics) {
    const actual = metrics[key];
    if (actual === null || actual === undefined) return null;
    if (key === 'time' || key === 'maxDeaths') return actual <= value;
    return actual >= value;
}

/** What the player actually did, phrased in the same unit as the condition it is measured against. */
export function formatOdysseyStarActual(key, metrics) {
    const actual = metrics?.[key];
    if (actual === null || actual === undefined) return '';
    const plural = (amount, singular, pluralForm = `${singular}s`) => (
        `${Number(amount).toLocaleString()} ${amount === 1 ? singular : pluralForm}`
    );
    switch (key) {
    case 'lines': return plural(actual, 'line');
    case 'score': return `${actual.toLocaleString()} pts`;
    case 'cascades': return plural(actual, 'cascade');
    case 'maxCascadeDepth':
    case 'combo': return `${actual}-wave chain`;
    case 'tetrises': return plural(actual, 'quad');
    case 'time': return formatOdysseyClock(actual);
    case 'bonuses': return plural(actual, 'bonus', 'bonuses');
    case 'frags': return plural(actual, 'knockout');
    case 'maxDeaths': return plural(actual, 'top-out');
    default: return '';
    }
}

/**
 * Explain a finished attempt's stars: which tiers were earned (the engine's count is the truth)
 * and, for the ones that were not, which condition fell short and by what the player did.
 */
export function describeOdysseyStarOutcome(level, results = {}) {
    const stars = Math.max(0, Math.min(3, Math.floor(Number(results?.stars) || 0)));
    const metrics = readOdysseyStarMetrics(results || {});
    const tiers = ['one', 'two', 'three'].map((tier, index) => {
        const condition = level?.stars?.[tier];
        if (!condition) return null;
        let chainSeen = false;
        const parts = Object.entries(condition).flatMap(([key, value]) => {
            if (key === 'combo' || key === 'maxCascadeDepth') {
                if (chainSeen) return [];
                chainSeen = true;
                const target = getOdysseyChainTarget(condition);
                return [{
                    key: 'maxCascadeDepth',
                    value: target,
                    label: `${target}-wave chain`,
                    met: odysseyStarPartMet('maxCascadeDepth', target, metrics),
                    actual: formatOdysseyStarActual('maxCascadeDepth', metrics),
                }];
            }
            return [{
                key,
                value,
                label: formatOdysseyStarCondition({ [key]: value }, 1),
                met: odysseyStarPartMet(key, value, metrics),
                actual: formatOdysseyStarActual(key, metrics),
            }];
        });
        return {
            tier, index, earned: index < stars, label: formatOdysseyStarCondition(condition, index), parts,
        };
    }).filter(Boolean);
    const next = tiers.find((entry) => !entry.earned) || null;
    return {
        stars,
        tiers,
        aided: results?.aided === true,
        next: next ? { ...next, missed: next.parts.filter((part) => part.met === false) } : null,
    };
}

/** One line for the ceremony and results: the next star and what it still needs. */
export function formatOdysseyNextStar(outcome) {
    if (!outcome?.tiers?.length) return null;
    if (outcome.aided) return 'Cleared with a gem: the first star. The others ask for an unaided clear.';
    if (!outcome.next) return 'All three stars earned.';
    const { next } = outcome;
    if (!next.missed.length) return `Next star: ${next.label}.`;
    const shortfall = next.missed
        .map((part) => (part.actual ? `${part.label} (you: ${part.actual})` : part.label))
        .join(' · ');
    return `Next star: ${shortfall}`;
}
