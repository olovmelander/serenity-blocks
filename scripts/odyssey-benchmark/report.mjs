import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUTCOMES = ['win', 'loss', 'censored', 'error'];
const Z95 = 1.959963984540054;
const METRICS = {
    cascade: 'cascades',
    combo: 'maxCombo',
    'max-cascade-depth': 'maxCascadeDepth',
    'tetris-count': 'tetrises',
    pieces: 'piecesPlaced',
    maxDeaths: 'deaths',
};
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const median = (values) => quantile(values, 0.5);

function normalizeAttempt(attempt) {
    const scenarioId = String(attempt.scenarioId || 'baseline');
    const cadenceId = String(attempt.cadenceId || 'native');
    return {
        ...attempt,
        scenarioId,
        cadenceId,
        lapCensored: Boolean(attempt.lapCensored || attempt.qualityCensored),
        attemptId: attempt.attemptId || JSON.stringify([attempt.levelId, attempt.profileId, scenarioId, cadenceId, attempt.seed]),
    };
}

function experimentConditions(attempts, config) {
    const definitions = (value) => (Array.isArray(value) ? value : []).map((entry) => (
        typeof entry === 'string' ? { id: entry, label: entry } : entry
    ));
    const scenarios = definitions(config.scenarios);
    const cadences = definitions(config.cadences);
    const selectedScenarios = config.scenarioIds || scenarios.map((entry) => entry.id);
    const selectedCadences = config.cadenceIds || cadences.map((entry) => entry.id);
    const observedScenarios = [...new Set(attempts.map((attempt) => attempt.scenarioId))];
    const observedCadences = [...new Set(attempts.map((attempt) => attempt.cadenceId))];
    const ids = new Map(attempts.map((attempt) => [JSON.stringify([attempt.scenarioId, attempt.cadenceId]), {
        scenarioId: attempt.scenarioId, cadenceId: attempt.cadenceId,
    }]));
    if (selectedScenarios.length || selectedCadences.length || !ids.size) {
        const fallbackScenarios = observedScenarios.length ? observedScenarios : ['baseline'];
        const fallbackCadences = observedCadences.length ? observedCadences : ['native'];
        const scenarioIds = selectedScenarios.length ? selectedScenarios : fallbackScenarios;
        const cadenceIds = selectedCadences.length ? selectedCadences : fallbackCadences;
        scenarioIds.forEach((scenarioId) => cadenceIds.forEach((cadenceId) => {
            ids.set(JSON.stringify([scenarioId, cadenceId]), { scenarioId, cadenceId });
        }));
    }
    return [...ids.values()].map((condition) => ({
        ...condition,
        scenarioLabel: scenarios.find((entry) => entry.id === condition.scenarioId)?.label || condition.scenarioId,
        cadenceLabel: cadences.find((entry) => entry.id === condition.cadenceId)?.label || condition.cadenceId,
        levelIds: scenarios.find((entry) => entry.id === condition.scenarioId)?.levelIds ?? null,
    })).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.cadenceId.localeCompare(b.cadenceId));
}

function sameCondition(attempt, condition) {
    return attempt.scenarioId === condition.scenarioId && attempt.cadenceId === condition.cadenceId;
}

function effectiveLevel(level, attempts) {
    const config = attempts.find((attempt) => attempt.effectiveConfig)?.effectiveConfig;
    if (!level || !config) return level;
    return {
        ...level,
        victory: config.victory || level.victory,
        stars: config.stars || level.stars,
        mechanics: { ...level.mechanics, baseMode: config.baseMode || level.mechanics?.baseMode },
    };
}

function revisionLabel(revision) {
    if (!revision || typeof revision !== 'object') return String(revision || 'unrecorded');
    return [
        revision.head ? String(revision.head).slice(0, 12) : 'unrecorded head',
        revision.benchmarkHash ? `benchmark ${String(revision.benchmarkHash).slice(0, 12)}` : null,
        revision.workingTreeImplementation ? 'working tree implementation' : null,
    ].filter(Boolean).join(' · ');
}

function opponentKnowledgePolicy(attempt, level = null) {
    if (!attempt.duel && !level?.mechanics?.versus
        && !['production-full-real-bag', 'restricted-three-previews'].includes(attempt.opponentKnowledgePolicy)) {
        return null;
    }
    if (attempt.opponentKnowledgePolicy === 'production-full-real-bag'
        && attempt.opponentPlanningPreviewLimit === null
        && (attempt.opponentPreviewCount === undefined || attempt.opponentPreviewCount === null)) {
        return 'productionFullQueue';
    }
    if ((!attempt.opponentKnowledgePolicy || attempt.opponentKnowledgePolicy === 'restricted-three-previews')
        && (attempt.opponentPreviewCount === 3 || attempt.opponentPlanningPreviewLimit === 3)) {
        return 'restrictedThreePreviews';
    }
    return 'unrecorded';
}

function summarizeOpponentKnowledge(attempts, levels = []) {
    const counts = { productionFullQueue: 0, restrictedThreePreviews: 0, unrecorded: 0 };
    for (const attempt of attempts) {
        const policy = opponentKnowledgePolicy(attempt, levels.find((level) => Number(level.id) === Number(attempt.levelId)));
        if (policy) counts[policy]++;
    }
    const policies = Object.keys(counts).filter((policy) => counts[policy]);
    return { status: policies.length > 1 ? 'mixed' : (policies[0] || 'not-applicable'), counts };
}

/** Authored construction is a separate untimed diagnostic, never a primary-win gate. */
function authoredConstructionDiagnostics(capabilities, levelId = null, profileId = null) {
    const demonstrations = capabilities?.authoredConstruction?.demonstrations;
    if (!Array.isArray(demonstrations)) return [];
    return demonstrations.filter((demo) => (levelId === null || Number(demo.levelId) === Number(levelId))
        && (profileId === null || demo.profileId === profileId)).map((demo) => {
        const requirements = demo.requirements || {};
        const finishPolicy = requirements.finishPolicy || {};
        const initialBoard = demo.initialBoard || null;
        const legalConstruction = demo.traceValid === true && demo.traceComplete === true
            && demo.allTetrominoes === true && demo.addedCellsAfterStart === 0;
        let finishLabel = 'Unrecorded finish policy';
        if (finishPolicy.stopAfterPrimaryResolution === true) finishLabel = 'Normal auto-finish after primary cascade';
        else if (finishPolicy.showcaseCanContinueAfterPrimary === true) finishLabel = 'Showcase continues after primary';
        const timeConstraints = [
            ...(requirements.primary?.timeConstraints || []).map((entry) => ({ scope: 'primary', ...entry })),
            ...Object.entries(requirements.stars || {}).flatMap(([tier, star]) => (star.timeConstraints || [])
                .map((entry) => ({ scope: `${tier}-star`, ...entry }))),
            ...(requirements.bonuses || []).flatMap((bonus) => (bonus.timeConstraints || [])
                .map((entry) => ({ scope: `bonus-${bonus.index}`, ...entry }))),
        ];
        return {
            id: demo.id,
            levelId: demo.levelId,
            profileId: demo.profileId,
            seed: demo.seed,
            status: demo.status,
            timed: demo.timed === false ? false : null,
            timingPolicy: demo.timingPolicy,
            timeConstraintsStatus: demo.timed === false ? 'unverified' : 'unrecorded',
            timeConstraints,
            targetDepth: finite(requirements.maximumEffectiveChainDepth),
            maximumDepth: finite(demo.maximumDepth),
            qualifiedMaximumDepth: legalConstruction ? finite(demo.maximumDepth) : null,
            legalConstruction,
            traceValid: demo.traceValid === true,
            traceComplete: demo.traceComplete === true,
            allTetrominoes: demo.allTetrominoes,
            addedCellsAfterStart: demo.addedCellsAfterStart,
            initialBoard,
            startLabel: initialBoard
                ? `${initialBoard.authoredStartingRows ?? '?'} starting rows; ${initialBoard.occupiedCells ?? '?'} occupied cells; ${initialBoard.columns ?? '?'}×${initialBoard.rows ?? '?'} board`
                : 'Unrecorded starting board',
            finishPolicy,
            finishLabel,
            requirements,
            quality: demo.quality,
            authoredState: demo.authoredState,
            piecesPlaced: demo.piecesPlaced,
            primaryReachedUntimed: demo.primaryReachedUntimed,
            termination: demo.termination,
            interpretation: demo.interpretation,
        };
    });
}

function jsonSafe(value, ancestors = new Set()) {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const entries = value instanceof Map ? Object.fromEntries(value) : value;
    const result = Array.isArray(entries)
        ? entries.map((entry) => jsonSafe(entry, ancestors))
        : Object.fromEntries(Object.entries(entries).filter(([, entry]) => typeof entry !== 'function')
            .map(([key, entry]) => [key, jsonSafe(entry, ancestors)]));
    ancestors.delete(value);
    return result;
}

function quantile(values, probability) {
    const sorted = values.filter((value) => finite(value) !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * probability;
    const low = Math.floor(position);
    return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

function distribution(values) {
    const valid = values.filter((value) => finite(value) !== null);
    return {
        n: valid.length,
        median: median(valid),
        p90: quantile(valid, 0.9),
        p95: quantile(valid, 0.95),
        max: valid.length ? Math.max(...valid) : null,
    };
}

function wilson(wins, total) {
    if (!total) return null;
    const rate = wins / total;
    const denominator = 1 + Z95 ** 2 / total;
    const center = (rate + Z95 ** 2 / (2 * total)) / denominator;
    const margin = (Z95 * Math.sqrt(((rate * (1 - rate)) / total) + ((Z95 ** 2) / (4 * (total ** 2))))) / denominator;
    return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), confidence: 0.95 };
}

function outcome(attempt) {
    if (attempt.outcome === 'win' && attempt.goalReached && attempt.lapCensored) return 'win';
    if (/budget|(?:^|[-_ ])(?:piece|wall|simulation)[-_ ](?:cap|limit)/i.test(attempt.reason || '')) {
        return 'censored';
    }
    return OUTCOMES.includes(attempt.outcome) ? attempt.outcome : 'error';
}

function reasons(attempts, kind) {
    const counts = {};
    attempts.filter((attempt) => outcome(attempt) === kind).forEach((attempt) => {
        const reason = String(attempt.reason || 'unspecified');
        counts[reason] = (counts[reason] || 0) + 1;
    });
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function profileList(profiles, attempts) {
    const provided = Array.isArray(profiles) ? profiles
        : Object.entries(profiles || {}).map(([id, profile]) => ({ id, ...profile }));
    const result = provided.map((profile) => (typeof profile === 'string'
        ? { id: profile, label: profile } : { ...profile, id: profile.id || profile.profileId }));
    const seen = new Set(result.map((profile) => profile.id));
    attempts.forEach((attempt) => {
        if (!seen.has(attempt.profileId)) {
            result.push({ id: attempt.profileId, label: attempt.profileId });
            seen.add(attempt.profileId);
        }
    });
    return result.map((profile) => ({ ...profile, label: profile.label || profile.id, synthetic: true }));
}

function applies(issue, level, profileId) {
    const scope = issue.scope || issue;
    if (issue.profileId && issue.profileId !== profileId) return false;
    if (issue.profileIds && !issue.profileIds.includes(profileId)) return false;
    if (scope.levelIds && !scope.levelIds.map(Number).includes(Number(level.id))) return false;
    if (scope.levelId !== undefined && Number(scope.levelId) !== Number(level.id)) return false;
    if (scope.baseModes && !scope.baseModes.includes(level.mechanics?.baseMode)) return false;
    if (scope.objectiveTypes && !scope.objectiveTypes.includes(level.victory?.primary?.type)) return false;
    return true;
}

function capabilityEvidence(capabilities, level, profileId) {
    const failed = (entry) => entry && (entry.passed === false || entry.supported === false
        || ['fail', 'failed', 'error', 'unsupported', 'inconclusive'].includes(entry.status));
    const issues = [];
    const add = (entry) => {
        if (failed(entry) && applies(entry, level, profileId)) {
            issues.push(String(entry.reason || entry.message || entry.id || 'Capability validation failed'));
        }
    };
    const fixtures = capabilities?.mechanics?.fixtures || capabilities?.checks || [];
    fixtures.forEach(add);
    fixtures.forEach((fixture) => {
        if (failed(fixture.aiSimulator)) {
            add({
                ...fixture, status: 'fail', reason: `${fixture.id || 'Mechanics fixture'} AI simulator validation failed`,
            });
        }
    });
    add(capabilities?.mechanics?.connectivityCacheCollision);
    if (failed(capabilities?.mechanics) && !fixtures.some(failed)) add(capabilities.mechanics);
    const profile = capabilities?.profiles?.find((entry) => entry.profileId === profileId);
    add(profile);
    (capabilities?.levels || []).forEach(add);
    (capabilities?.issues || []).forEach(add);
    const scopedChildrenFailed = fixtures.some(failed) || (capabilities?.profiles || []).some(failed)
        || failed(capabilities?.mechanics);
    if (failed(capabilities) && !scopedChildrenFailed && !issues.length) add(capabilities);
    const limitations = [
        ...(capabilities?.limitations || []), ...(profile?.limitations || []),
    ].map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(jsonSafe(entry))));
    const requestedDepth = Math.max(
        ['combo', 'max-cascade-depth'].includes(level.victory?.primary?.type) ? Number(level.victory.primary.target) || 0 : 0,
        ...Object.values(level.stars || {}).map((star) => Math.max(star.maxCascadeDepth || 0, star.combo || 0)),
        ...(level.victory?.bonuses || []).filter((bonus) => ['max-cascade-depth', 'combo'].includes(bonus.type))
            .map((bonus) => Number(bonus.target) || 0),
    );
    const preparedDepth = finite(profile?.validatedMaxCascadeDepth);
    const constructedDepth = finite(profile?.construction?.validatedMaxCascadeDepth);
    const passedTargets = (profile?.construction?.targets || []).filter((target) => target.status === 'pass'
        && target.totalDemonstrations > 0 && target.passedDemonstrations === target.totalDemonstrations);
    const constructionValidatedDepth = profile?.construction ? Math.max(0, ...passedTargets.map((target) => target.targetDepth)) : null;
    const validatedDepth = profile?.construction ? constructionValidatedDepth : preparedDepth;
    const strategyUnvalidated = requestedDepth > 0 && (validatedDepth === null || requestedDepth > validatedDepth);
    if (strategyUnvalidated) {
        limitations.push(
            `Authored chain goal ${requestedDepth}; ${profile?.construction ? 'all-seed empty-board construction target' : 'prepared strategy'} validated depth ${validatedDepth ?? 'unknown'}. Deep-goal strategy remains unvalidated.`,
        );
    }
    return {
        inconclusive: issues.length > 0,
        issues: [...new Set(issues)],
        limitations: [...new Set(limitations)],
        strategyUnvalidated,
        requestedDepth,
        preparedDepth,
        constructedDepth,
        constructionValidatedDepth,
    };
}

function metricValue(attempt, metric) {
    const key = METRICS[metric] || metric;
    const value = finite(attempt.metrics?.[key]);
    if (value !== null) return value;
    if (key === 'time') return finite(attempt.elapsedSeconds);
    if (key === 'piecesPlaced') return finite(attempt.pieces);
    if (key === 'frags') return finite(attempt.duel?.playerFrags);
    if (key === 'deaths') return finite(attempt.duel?.deaths);
    return null;
}

function gap(attempts, type, target, direction = 'at-least') {
    if (finite(target) === null) return null;
    const values = attempts.filter((attempt) => outcome(attempt) !== 'error')
        .map((attempt) => metricValue(attempt, type)).filter((value) => value !== null);
    const remaining = values.map((value) => Math.max(0, direction === 'at-most' ? value - target : target - value));
    return {
        metric: METRICS[type] || type,
        target,
        direction,
        observations: values.length,
        achieved: distribution(values),
        remaining: distribution(remaining),
        medianProgress: values.length && target > 0 && direction === 'at-least'
            ? median(values.map((value) => Math.max(0, Math.min(1, value / target)))) : null,
    };
}

const DUEL_COUNTERS = ['attacksSent', 'attackLinesSent', 'cleanLinesSent', 'attacksReceived',
    'attackLinesReceived', 'cleanLinesReceived', 'frags', 'deaths', 'creditedDeaths', 'uncreditedDeaths'];

function duelTelemetryOf(attempt) {
    return attempt.duel?.telemetry || (Array.isArray(attempt.telemetry?.players) ? attempt.telemetry : null);
}

function attackRate(attempt, playerIndex, activeOnly = true) {
    const telemetry = duelTelemetryOf(attempt);
    const seconds = finite(activeOnly ? telemetry?.activeSeconds : attempt.elapsedSeconds);
    const lines = finite(telemetry?.players?.[playerIndex]?.attackLinesSent);
    return seconds !== null && seconds > 0 && lines !== null ? (lines * 60) / seconds : null;
}

function playerCounterSummary(items, getPlayer) {
    return Object.fromEntries(DUEL_COUNTERS.map((key) => [key, distribution(items.map((item) => getPlayer(item)?.[key]))]));
}

function summarizeDuelTelemetry(attempts) {
    const observed = attempts.filter((attempt) => duelTelemetryOf(attempt) && outcome(attempt) !== 'error');
    if (!observed.length) return null;
    const rounds = observed.flatMap((attempt) => (duelTelemetryOf(attempt).rounds || []));
    const roundIds = [...new Set(rounds.map((round) => round.round))].sort((a, b) => a - b);
    return {
        n: observed.length,
        activeSeconds: distribution(observed.map((attempt) => duelTelemetryOf(attempt).activeSeconds)),
        resolutionSeconds: distribution(observed.map((attempt) => duelTelemetryOf(attempt).resolutionSeconds)),
        intermissionSeconds: distribution(observed.map((attempt) => duelTelemetryOf(attempt).intermissionSeconds)),
        players: [0, 1].map((index) => ({
            index,
            role: index === 0 ? 'human-policy' : 'opponent',
            ...playerCounterSummary(observed, (attempt) => duelTelemetryOf(attempt).players?.[index]),
            attackLinesPerActiveMinute: distribution(observed.map((attempt) => attackRate(attempt, index))),
            attackLinesPerMatchMinute: distribution(observed.map((attempt) => attackRate(attempt, index, false))),
        })),
        rounds: roundIds.map((id) => {
            const observations = rounds.filter((round) => round.round === id);
            const events = observations.flatMap((round) => round.deathEvents || []);
            return {
                round: id,
                observations: observations.length,
                completed: observations.filter((round) => round.completed).length,
                durationSeconds: distribution(observations.map((round) => round.durationSeconds)),
                activeSeconds: distribution(observations.map((round) => round.activeSeconds)),
                resolutionSeconds: distribution(observations.map((round) => round.resolutionSeconds)),
                intermissionSeconds: distribution(observations.map((round) => round.intermissionSeconds)),
                players: [0, 1].map((index) => ({ index, ...playerCounterSummary(observations, (round) => round.players?.[index]) })),
                deathEvents: {
                    credited: events.filter((event) => event.credited).length,
                    uncredited: events.filter((event) => !event.credited).length,
                },
            };
        }),
        interpretation: 'Observed MPS counters; clean lines are perfect-clear attack rows. Active-minute rates exclude resolution/intermission; match-minute rates include the full virtual attempt. No cancellation counter is available. Incomplete rounds remain explicitly identified.',
    };
}

function aggregate(attempts, sourceLevel, profile, capabilities, condition = null) {
    const level = effectiveLevel(sourceLevel, attempts);
    const opponentKnowledge = summarizeOpponentKnowledge(attempts, level ? [level] : []);
    if (level && opponentKnowledge.counts.productionFullQueue && opponentKnowledge.counts.restrictedThreePreviews) {
        throw new Error(`Mixed opponent knowledge in orb ${level.id}, ${profile.id}, ${condition?.scenarioId}/${condition?.cadenceId}; use separate reports`);
    }
    const counts = {
        win: 0, loss: 0, censored: 0, error: 0,
    };
    attempts.forEach((attempt) => { counts[outcome(attempt)]++; });
    const terminal = counts.win + counts.loss;
    const attempted = attempts.length;
    const evidence = level ? capabilityEvidence(capabilities, level, profile.id) : {
        inconclusive: false, issues: [], limitations: [], strategyUnvalidated: false,
    };
    if (opponentKnowledge.counts.unrecorded) {
        evidence.inconclusive = true;
        evidence.issues.push('Duel opponent planning knowledge is unrecorded; production fidelity is unknown');
    }
    if (opponentKnowledge.counts.restrictedThreePreviews) {
        evidence.limitations.push('Historical duel opponent planning was restricted to three previews; it differs from production');
    }
    const errorCapability = attempts.some((attempt) => outcome(attempt) === 'error'
        && /capabilit|unsupported|unvalidated-mechanic/i.test(attempt.reason || ''));
    if (errorCapability) {
        evidence.inconclusive = true;
        evidence.issues.push('Attempt failed capability validation');
    }
    const completionCoverage = attempted ? terminal / attempted : null;
    let status = attempted ? 'observed' : 'not-run';
    if (evidence.inconclusive) status = 'inconclusive';
    else if (attempted && !terminal) status = 'no-terminal-outcomes';
    else if (terminal < 20 && attempted) status = 'pilot';
    else if (attempted && completionCoverage < 0.8) status = 'limited-coverage';
    const stars = {
        0: 0, 1: 0, 2: 0, 3: 0, missing: 0,
    };
    attempts.filter((attempt) => outcome(attempt) === 'win').forEach((attempt) => {
        if (Number.isInteger(attempt.stars) && attempt.stars >= 0 && attempt.stars <= 3) stars[attempt.stars]++;
        else stars.missing++;
    });
    const terminalAttempts = attempts.filter((attempt) => ['win', 'loss'].includes(outcome(attempt)));
    const durations = {};
    [['terminal', terminalAttempts], ...OUTCOMES.map((kind) => [kind, attempts.filter((attempt) => outcome(attempt) === kind)])]
        .forEach(([kind, items]) => { durations[kind] = distribution(items.map((attempt) => attempt.elapsedSeconds)); });
    const primary = level?.victory?.primary;
    const goals = {
        primary: primary ? gap(attempts, primary.type, primary.target) : null,
        stars: Object.entries(level?.stars || {}).map(([tier, conditions]) => ({
            tier,
            conditions: Object.entries(conditions).map(([type, target]) => gap(
                attempts,
                type,
                target,
                ['time', 'pieces', 'maxDeaths'].includes(type) ? 'at-most' : 'at-least',
            )).filter(Boolean),
        })),
        bonuses: (level?.victory?.bonuses || []).map((bonus) => gap(
            attempts,
            bonus.type,
            bonus.target,
            ['time', 'pieces'].includes(bonus.type) ? 'at-most' : 'at-least',
        )).filter(Boolean),
    };
    const duelAttempts = attempts.filter((attempt) => attempt.duel && outcome(attempt) !== 'error');
    const duel = duelAttempts.length ? {
        n: duelAttempts.length,
        botNames: [...new Set(duelAttempts.map((attempt) => attempt.duel.botName).filter(Boolean))],
        playerFrags: distribution(duelAttempts.map((attempt) => attempt.duel.playerFrags)),
        botFrags: distribution(duelAttempts.map((attempt) => attempt.duel.botFrags)),
        deaths: distribution(duelAttempts.map((attempt) => attempt.duel.deaths)),
        rounds: distribution(duelAttempts.map((attempt) => attempt.duel.round)),
        duration: distribution(duelAttempts.map((attempt) => attempt.elapsedSeconds)),
        telemetry: summarizeDuelTelemetry(duelAttempts),
    } : null;
    return {
        levelId: level?.id ?? null,
        levelName: level?.name || 'All orbs',
        chapter: level?.chapter ?? null,
        groupId: level ? JSON.stringify([level.id, profile.id, condition?.scenarioId, condition?.cadenceId]) : null,
        profileId: profile.id,
        profileLabel: profile.label || profile.id,
        scenarioId: condition?.scenarioId ?? null,
        cadenceId: condition?.cadenceId ?? null,
        scenarioLabel: condition?.scenarioLabel ?? 'All scenarios',
        cadenceLabel: condition?.cadenceLabel ?? 'All cadences',
        regime: level?.mechanics?.versus ? 'duel' : (level?.mechanics?.baseMode || 'mixed'),
        objectiveType: primary?.type || null,
        target: primary?.target ?? null,
        counts,
        attempted,
        terminal,
        status,
        evidence,
        opponentKnowledge,
        authoredConstruction: level ? authoredConstructionDiagnostics(capabilities, level.id, profile.id) : [],
        successRate: evidence.inconclusive || !terminal ? null : counts.win / terminal,
        observedTerminalWinRate: terminal ? counts.win / terminal : null,
        interval95: !level || evidence.inconclusive ? null : wilson(counts.win, terminal),
        inferenceScope: level ? 'orb-policy-scenario-cadence' : 'descriptive-pooled',
        completionCoverage,
        overallWinBounds: attempted ? {
            low: counts.win / attempted,
            high: (counts.win + counts.censored + counts.error) / attempted,
            denominator: attempted,
        } : null,
        durations,
        pieces: distribution(attempts.filter((attempt) => outcome(attempt) !== 'error').map((attempt) => attempt.pieces)),
        wallMs: distribution(attempts.map((attempt) => attempt.wallMs)),
        stars,
        failureCauses: reasons(attempts, 'loss'),
        censorCauses: reasons(attempts, 'censored'),
        errorCauses: reasons(attempts, 'error'),
        goals,
        duel,
        metrics: Object.fromEntries(['lines', 'score', 'cascades', 'maxCascadeDepth', 'maxCombo', 'tetrises', 'height']
            .map((metric) => [metric, distribution(attempts.filter((attempt) => outcome(attempt) !== 'error')
                .map((attempt) => metricValue(attempt, metric)))])),
        showcase: {
            goalReached: attempts.filter((attempt) => attempt.goalReached).length,
            lapCensored: attempts.filter((attempt) => attempt.lapCensored).length,
            qualityCensored: attempts.filter((attempt) => attempt.lapCensored).length,
            primaryCensored: attempts.filter((attempt) => attempt.primaryCensored
                || (outcome(attempt) === 'censored' && !attempt.goalReached)).length,
            primarySeconds: distribution(attempts.map((attempt) => attempt.goalReachedAtSeconds)),
            lapSeconds: distribution(attempts.map((attempt) => (finite(attempt.goalReachedAtSeconds) !== null
                && finite(attempt.elapsedSeconds) !== null ? Math.max(0, attempt.elapsedSeconds - attempt.goalReachedAtSeconds) : null))),
            completeQualityWins: attempts.filter((attempt) => outcome(attempt) === 'win' && !attempt.lapCensored).length,
            completeQualityStars: distribution(attempts.filter((attempt) => outcome(attempt) === 'win' && !attempt.lapCensored)
                .map((attempt) => attempt.stars)),
            lapWindows: [...new Set(attempts.map((attempt) => attempt.showcaseFinishPolicy?.maxLapSeconds ?? null))],
        },
        inputTelemetry: {
            n: attempts.filter((attempt) => attempt.telemetry && outcome(attempt) !== 'error').length,
            locks: Object.fromEntries(['input', 'automatic', 'hardDrop', 'softDrop'].map((key) => [key,
                distribution(attempts.filter((attempt) => outcome(attempt) !== 'error').map((attempt) => attempt.telemetry?.locks?.[key]))])),
            failedActions: distribution(attempts.filter((attempt) => outcome(attempt) !== 'error').map((attempt) => attempt.telemetry?.failedActions)),
            legalSoftDropStops: distribution(attempts.filter((attempt) => outcome(attempt) !== 'error').map((attempt) => attempt.telemetry?.legalSoftDropStops)),
            policy: Object.fromEntries(['replans', 'fallbackDrops', 'pieceRetries', 'maxPieceRetries'].map((key) => [
                key,
                distribution(attempts.filter((attempt) => outcome(attempt) !== 'error')
                    .map((attempt) => attempt.telemetry?.policy?.[key])),
            ])),
        },
    };
}

function matchedComparison(attempts, leftMatches, rightMatches, identity, inconclusive) {
    const bySeed = (matches) => {
        const map = new Map();
        attempts.filter(matches).forEach((attempt) => {
            const seed = String(attempt.seed);
            map.set(seed, [...(map.get(seed) || []), attempt]);
        });
        return map;
    };
    const left = bySeed(leftMatches);
    const right = bySeed(rightMatches);
    const shared = [...left.keys()].filter((seed) => right.has(seed));
    const counts = {
        bothWin: 0, bothLoss: 0, aOnlyWin: 0, bOnlyWin: 0, unresolved: 0, duplicateSeeds: 0,
    };
    const timeDifferences = [];
    const primaryDifferences = [];
    const starDifferences = [];
    const attackDifferences = [[], []];
    const roundTimeDifferences = [];
    const quality = { completePairs: 0, lapCensoredPairs: 0, missingStarPairs: 0 };
    for (const seed of shared) {
        if (left.get(seed).length !== 1 || right.get(seed).length !== 1) { counts.duplicateSeeds++; continue; }
        const aa = left.get(seed)[0];
        const bb = right.get(seed)[0];
        const knowledgeA = opponentKnowledgePolicy(aa);
        const knowledgeB = opponentKnowledgePolicy(bb);
        if (knowledgeA !== knowledgeB) { counts.unresolved++; continue; }
        const ao = outcome(aa);
        const bo = outcome(bb);
        if (['win', 'loss'].includes(ao) && ['win', 'loss'].includes(bo)) {
            [0, 1].forEach((index) => {
                const ar = attackRate(aa, index);
                const br = attackRate(bb, index);
                if (ar !== null && br !== null) attackDifferences[index].push(br - ar);
            });
            (duelTelemetryOf(aa)?.rounds || []).filter((round) => round.completed).forEach((round) => {
                const other = duelTelemetryOf(bb)?.rounds?.find((entry) => entry.round === round.round && entry.completed);
                if (finite(round.durationSeconds) !== null && finite(other?.durationSeconds) !== null) {
                    roundTimeDifferences.push(other.durationSeconds - round.durationSeconds);
                }
            });
        }
        if (!['win', 'loss'].includes(ao) || !['win', 'loss'].includes(bo)) counts.unresolved++;
        else if (ao === 'win' && bo === 'win') {
            counts.bothWin++;
            if (finite(aa.elapsedSeconds) !== null && finite(bb.elapsedSeconds) !== null) timeDifferences.push(bb.elapsedSeconds - aa.elapsedSeconds);
            const at = finite(aa.goalReachedAtSeconds) ?? finite(aa.elapsedSeconds);
            const bt = finite(bb.goalReachedAtSeconds) ?? finite(bb.elapsedSeconds);
            if (at !== null && bt !== null) primaryDifferences.push(bt - at);
            if (aa.lapCensored || bb.lapCensored) quality.lapCensoredPairs++;
            else if (finite(aa.stars) === null || finite(bb.stars) === null) quality.missingStarPairs++;
            else { quality.completePairs++; starDifferences.push(bb.stars - aa.stars); }
        } else if (ao === 'loss' && bo === 'loss') counts.bothLoss++;
        else if (ao === 'win') counts.aOnlyWin++;
        else counts.bOnlyWin++;
    }
    const terminalPairs = counts.bothWin + counts.bothLoss + counts.aOnlyWin + counts.bOnlyWin;
    return {
        ...identity,
        matchedSeeds: shared.length,
        terminalPairs,
        counts,
        inconclusive,
        pairedCompletionCoverage: shared.length ? terminalPairs / shared.length : null,
        winRateDifferenceBMinusA: terminalPairs && !inconclusive ? (counts.bOnlyWin - counts.aOnlyWin) / terminalPairs : null,
        bothWinDurationDifferenceBMinusA: distribution(timeDifferences),
        bothWinPrimaryDurationDifferenceBMinusA: distribution(primaryDifferences),
        quality: { ...quality, starDifferenceBMinusA: distribution(starDifferences) },
        duelAttackLinesPerActiveMinuteDifferenceBMinusA: attackDifferences.map((values, index) => ({ index, ...distribution(values) })),
        completedRoundDurationDifferenceBMinusA: distribution(roundTimeDifferences),
        interpretation: 'Descriptive same-seed comparison within an orb and fixed experiment conditions. Censored quality laps do not enter complete star deltas; no human calibration or paired significance claim.',
    };
}

function pairedComparisons(attempts, groups, levels, profiles, conditions) {
    const result = [];
    for (const level of levels) {
        for (const condition of conditions.filter((entry) => !entry.levelIds || entry.levelIds.includes(level.id))) {
            for (let a = 0; a < profiles.length; a++) {
                for (let b = a + 1; b < profiles.length; b++) {
                    const matches = (profileId) => (attempt) => Number(attempt.levelId) === Number(level.id)
                        && attempt.profileId === profileId && sameCondition(attempt, condition);
                    const inconclusive = groups.some((group) => group.levelId === level.id && sameCondition(group, condition)
                        && [profiles[a].id, profiles[b].id].includes(group.profileId) && group.evidence.inconclusive);
                    result.push(matchedComparison(attempts, matches(profiles[a].id), matches(profiles[b].id), {
                        kind: 'policy', levelId: level.id, ...condition, profileA: profiles[a].id, profileB: profiles[b].id,
                    }, inconclusive));
                }
            }
        }
    }
    return result;
}

function scenarioComparisons(attempts, groups, levels, profiles, conditions) {
    const result = [];
    for (const level of levels) {
        for (const profile of profiles) {
            for (const variant of conditions.filter((condition) => condition.scenarioId !== 'baseline'
                && (!condition.levelIds || condition.levelIds.includes(level.id)))) {
                const baseline = { ...variant, scenarioId: 'baseline' };
                const matches = (condition) => (attempt) => Number(attempt.levelId) === Number(level.id)
                    && attempt.profileId === profile.id && sameCondition(attempt, condition);
                const inconclusive = groups.some((group) => group.levelId === level.id && group.profileId === profile.id
                    && group.cadenceId === variant.cadenceId && [variant.scenarioId, 'baseline'].includes(group.scenarioId)
                    && group.evidence.inconclusive);
                result.push(matchedComparison(attempts, matches(baseline), matches(variant), {
                    kind: 'scenario',
                    levelId: level.id,
                    profileId: profile.id,
                    cadenceId: variant.cadenceId,
                    scenarioA: 'baseline',
                    scenarioB: variant.scenarioId,
                }, inconclusive));
            }
        }
    }
    return result;
}

function spikeCandidates(groups, attempts, levels) {
    const result = [];
    for (const current of groups) {
        const previous = groups.find((group) => group.profileId === current.profileId && sameCondition(group, current)
            && group.levelId === current.levelId - 1);
        if (!previous || current.terminal < 20 || previous.terminal < 20
            || current.completionCoverage < 0.8 || previous.completionCoverage < 0.8
            || current.successRate === null || previous.successRate === null
            || current.regime !== previous.regime || current.objectiveType !== previous.objectiveType
            || !(current.target > 0 && previous.target > 0)
            || Math.max(current.target, previous.target) / Math.min(current.target, previous.target) > 1.5) continue;
        const seeds = (id) => new Set(attempts.filter((attempt) => attempt.levelId === id
            && attempt.profileId === current.profileId && sameCondition(attempt, current)
            && ['win', 'loss'].includes(outcome(attempt))).map((attempt) => String(attempt.seed)));
        const before = seeds(previous.levelId);
        const pairedSeeds = [...seeds(current.levelId)].filter((seed) => before.has(seed)).length;
        const drop = previous.successRate - current.successRate;
        if (pairedSeeds < 20 || drop < 0.35 || current.interval95.high >= previous.interval95.low) continue;
        const config = levels.find((level) => level.id === current.levelId);
        result.push({
            profileId: current.profileId,
            scenarioId: current.scenarioId,
            cadenceId: current.cadenceId,
            fromLevelId: previous.levelId,
            toLevelId: current.levelId,
            terminalWinRateDrop: drop,
            pairedSeeds,
            objectiveType: current.objectiveType,
            role: config?.metadata?.role || config?.role || null,
            interpretation: 'Review candidate only: comparable measured goals, sufficient coverage and separated intervals. Authored role or target changes may explain the difference.',
        });
    }
    return result;
}

/** Aggregate recorded production attempts without treating caps as gameplay failures. */
export function buildSummary({
    attempts: recordedAttempts = [], levels = [], profiles = [], capabilities = {}, config = {}, revision = null,
} = {}) {
    const attempts = recordedAttempts.map(normalizeAttempt);
    const allLevels = (Array.isArray(levels) ? levels : Object.values(levels)).slice().sort((a, b) => a.id - b.id);
    const allProfiles = profileList(profiles, attempts);
    const opponentKnowledge = summarizeOpponentKnowledge(attempts, allLevels);
    const conditions = experimentConditions(attempts, config);
    const groups = allLevels.flatMap((level) => allProfiles.flatMap((profile) => conditions
        .filter((condition) => !condition.levelIds || condition.levelIds.includes(level.id)).map((condition) => aggregate(
            attempts.filter((attempt) => Number(attempt.levelId) === Number(level.id)
            && attempt.profileId === profile.id && sameCondition(attempt, condition)),
            config.effectiveLevels?.find((entry) => entry.scenarioId === condition.scenarioId && entry.level?.id === level.id)?.level || level,
            profile,
            capabilities,
            condition,
        ))));
    const totals = aggregate(attempts, null, { id: 'all', label: 'All synthetic policies' }, capabilities);
    const profileSummaries = allProfiles.flatMap((profile) => conditions.map((condition) => aggregate(
        attempts.filter((attempt) => attempt.profileId === profile.id && sameCondition(attempt, condition)),
        null,
        profile,
        capabilities,
        condition,
    )));
    const conditionSummaries = conditions.map((condition) => aggregate(
        attempts.filter((attempt) => sameCondition(attempt, condition)),
        null,
        { id: 'all', label: 'All synthetic policies' },
        capabilities,
        condition,
    ));
    const paired = pairedComparisons(attempts, groups, allLevels, allProfiles, conditions);
    const variants = scenarioComparisons(attempts, groups, allLevels, allProfiles, conditions);
    const candidates = spikeCandidates(groups, attempts, allLevels);
    const warnings = [];
    const normalizedCaps = attempts.filter((attempt) => outcome(attempt) === 'censored' && attempt.outcome !== 'censored').length;
    if (normalizedCaps) warnings.push(`${normalizedCaps} budget outcomes normalized to censored; original records remain in raw.jsonl.`);
    const truncatedLaps = attempts.filter((attempt) => attempt.lapCensored).length;
    if (truncatedLaps) warnings.push(`${truncatedLaps} optional showcase laps were truncated by an explicit window or harness budget. Primary-goal wins remain valid; observed stars and quality metrics may be lower bounds on eventual lap quality.`);
    if (attempts.some((attempt) => !allLevels.some((level) => Number(level.id) === Number(attempt.levelId)))) {
        warnings.push('Some attempts reference an orb outside the supplied level manifest; included in totals, excluded from orb comparisons.');
    }
    if (opponentKnowledge.counts.restrictedThreePreviews) {
        warnings.push('Historical duel observations restricted the opponent to three planning previews; they do not measure the shipped full-queue opponent.');
    }
    if (opponentKnowledge.counts.unrecorded) {
        warnings.push('Some duel observations have no explicit opponent planning metadata. Their fidelity is unknown, even if the run configuration declares a policy.');
    }
    return jsonSafe({
        schemaVersion: 2,
        revision,
        revisionLabel: revisionLabel(revision),
        config,
        capabilities,
        opponentKnowledge,
        authoredConstruction: authoredConstructionDiagnostics(capabilities),
        methodology: {
            syntheticPolicies: true,
            humanCalibration: false,
            funAssessment: false,
            opponentKnowledge: `Duel opponent planning: ${opponentKnowledge.counts.productionFullQueue} production full-queue, ${opponentKnowledge.counts.restrictedThreePreviews} historical three-preview, ${opponentKnowledge.counts.unrecorded} unrecorded observations. HUD preview counts do not establish planning limits. Mixed known policies cannot share an orb/policy/scenario/cadence group; mismatched policies are excluded from paired deltas.`,
            conditionalRate: 'Wins divided by actual terminal wins + losses only. Censored attempts and errors are excluded from this conditional rate, never counted as losses.',
            coverage: 'Completed terminal outcomes divided by all attempted runs. Selective censoring, including high CPU cost, can bias conditional rates.',
            overallBounds: 'Deterministic all-attempt win bounds: wins/N to (wins+censored+errors)/N. These are unresolved-outcome bounds, not confidence intervals.',
            intervals: '95% Wilson binomial score intervals are limited to a single orb, synthetic policy, scenario and cadence on terminal outcomes. Pooled totals/profile summaries are descriptive across heterogeneous orbs and reused seeds; their intervals are null.',
            durations: 'Median, p90 and p95 active virtual seconds; terminal, win, loss and censored durations are separated. Quantiles use linear interpolation.',
            stars: 'Counts use stars observed at benchmark stop on completed wins only. Truncated optional showcase laps may understate eventual star quality.',
            showcase: 'Showcases follow the authored deadline by default (lapWindowSeconds null). An explicit window or harness budget censors quality separately: a completed primary goal remains a terminal win. A goalReached field by itself does not turn a censored attempt into a win.',
            pairing: 'Policy comparisons hold orb, scenario and cadence fixed. Baseline-versus-variant comparisons also hold policy fixed. Only the same bag/board seeds are paired; unresolved or duplicate pairs are excluded from terminal deltas.',
            conditions: 'Missing scenario/cadence IDs default to baseline/native. Experiment conditions stay separate in groups, profile summaries, heatmaps, curves and matched comparisons.',
            telemetry: 'Duel throughput uses measured sent attack rows per active minute and per whole virtual match minute. Round summaries distinguish completed and partial rounds. Perfect-clear rows are not cancellation counts.',
            spikes: 'Review candidates require >=20 terminal attempts per group, >=80% completion, >=20 paired seeds, comparable adjacent goals and nonoverlapping intervals. A low-seed pilot cannot establish a smooth or fair difficulty curve.',
            capabilities: 'Failed capability checks make affected orbs/policies inconclusive. Engine wiring probes do not establish proficiency at effective authored combo/depth requirements, which can demand up to 18 cascade waves.',
            authoredConstruction: 'Authored-board construction diagnostics match orb and policy and retain their recorded starting board and finish policy. They are untimed: cadence, gravity, deadlines and timed stars remain unverified. Optional mastery shortfalls do not invalidate a recorded timed primary win; these diagnostics do not establish impossibility or player fairness.',
        },
        levels: allLevels,
        profiles: allProfiles,
        conditions,
        totals,
        profileSummaries,
        conditionSummaries,
        groups,
        pairedComparisons: paired,
        scenarioComparisons: variants,
        reviewCandidates: candidates,
        warnings,
        pilot: groups.some((group) => group.attempted && group.terminal < 20),
        coverage: {
            suppliedOrbs: allLevels.length,
            suppliedProfiles: allProfiles.length,
            experimentConditions: conditions.length,
            testedOrbs: new Set(attempts.map((attempt) => attempt.levelId)).size,
            testedGroups: groups.filter((group) => group.attempted).length,
            inconclusiveGroups: groups.filter((group) => group.evidence.inconclusive).length,
            strategyUnvalidatedGroups: groups.filter((group) => group.evidence.strategyUnvalidated).length,
        },
    });
}

const percent = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(0)}%`);
const number = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(1));
const markdownCell = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');

function renderMarkdown(summary) {
    const { totals } = summary;
    const rows = summary.groups.map((group) => [
        `${group.levelId} · ${group.levelName}`, group.profileLabel, group.scenarioId, group.cadenceId, group.status,
        `${group.counts.win}/${group.counts.loss}/${group.counts.censored}/${group.counts.error}`,
        percent(group.successRate), group.interval95 ? `${percent(group.interval95.low)}–${percent(group.interval95.high)}` : '—',
        `${group.terminal}/${group.attempted} (${percent(group.completionCoverage)})`,
        group.overallWinBounds ? `${percent(group.overallWinBounds.low)}–${percent(group.overallWinBounds.high)}` : '—',
        `${number(group.durations.terminal.median)} / ${number(group.durations.terminal.p90)}`,
        `${group.stars[1]}/${group.stars[2]}/${group.stars[3]}`,
        number(group.goals.primary?.remaining.median),
    ].map(markdownCell).join(' | '));
    const constructionRows = summary.authoredConstruction.map((demo) => [
        demo.levelId, demo.profileId, demo.seed, demo.startLabel, demo.targetDepth, demo.maximumDepth,
        demo.legalConstruction ? 'Legal complete trace' : 'Unqualified trace',
        demo.finishLabel, demo.termination, demo.timed === false ? 'Untimed' : 'Unrecorded',
        demo.timeConstraintsStatus,
    ].map(markdownCell).join(' | '));
    return [
        '# Odyssey gameplay benchmark', '',
        `${summary.pilot ? '**Preliminary pilot.** ' : ''}All policies are synthetic; results do not establish human skill rates, calibrated difficulty, fairness or fun.`, '',
        `Revision: ${markdownCell(summary.revisionLabel)}. Orbs: ${summary.coverage.testedOrbs}/${summary.coverage.suppliedOrbs}. Attempts: ${totals.attempted}. W/L/C/E: ${totals.counts.win}/${totals.counts.loss}/${totals.counts.censored}/${totals.counts.error}.`, '',
        '**Terminal win rate is conditional on completion.** Always read completion coverage and unresolved-outcome bounds beside it. Selective time/CPU caps can bias the rate.', '',
        '## Run configuration', '', '```json', JSON.stringify(summary.config, null, 2), '```', '',
        '## Measurements', '',
        '| Orb | Synthetic policy | Scenario | Cadence | Evidence | W/L/C/E | Terminal win % | Wilson 95% | Completion | Overall win bounds | Terminal seconds median/p90 | Stars 1/2/3 | Median goal gap |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows.map((row) => `| ${row} |`), '',
        '## Authored-board construction diagnostics', '',
        'These separate untimed demonstrations do not change timed primary wins or award stars. The target is the maximum recorded combo/depth requirement across primary, stars and bonuses; it is not necessarily needed to finish the orb. Timing constraints remain unverified.', '',
        '| Orb | Policy | Seed | Authored start | Target depth | Observed depth | Trace | Finish policy | Stop | Timing | Time constraints |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...(constructionRows.length ? constructionRows.map((row) => `| ${row} |`) : ['No authored-board demonstrations recorded.']), '',
        'Recorded starting boards, exact requirements and unverified time constraints:', '',
        '```json', JSON.stringify(summary.authoredConstruction, null, 2), '```', '',
        '## Matched baseline versus variant', '',
        ...summary.scenarioComparisons.filter((pair) => pair.matchedSeeds).map((pair) => `- Orb ${pair.levelId}, ${pair.profileId}, ${pair.cadenceId}, ${pair.scenarioB}: ${pair.terminalPairs}/${pair.matchedSeeds} terminal pairs; win delta ${percent(pair.winRateDifferenceBMinusA)}; primary seconds delta ${number(pair.bothWinPrimaryDurationDifferenceBMinusA.median)}; complete star delta ${number(pair.quality.starDifferenceBMinusA.median)} (${pair.quality.completePairs} pairs, ${pair.quality.lapCensoredPairs} quality-censored).`), '',
        '## Review candidates', '',
        summary.reviewCandidates.length ? summary.reviewCandidates.map((candidate) => `- ${JSON.stringify(candidate)}`).join('\n')
            : 'No review candidates flagged. The sample/coverage thresholds may not be met; this does not establish a smooth curve.', '',
        '## Method and limits', '',
        ...Object.values(summary.methodology).filter((value) => typeof value === 'string').map((value) => `- ${value}`),
        ...summary.warnings.map((warning) => `- ${warning}`), '',
        `Affected capability failures: ${summary.coverage.inconclusiveGroups} groups. Deep-goal strategy unvalidated: ${summary.coverage.strategyUnvalidatedGroups} groups.`, '',
        'Capabilities and policy demonstrations:', '', '```json', JSON.stringify(summary.capabilities, null, 2), '```', '',
        'Full aggregate metrics, per-star/bonus gaps and matched-seed comparisons are in summary.json. Individual recorded attempts are in raw.jsonl.', '',
    ].join('\n');
}

function mountReport() {
    const data = JSON.parse(document.getElementById('report-data').textContent);
    const el = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
    const num = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));
    const option = (select, label, value) => {
        const item = el('option', label);
        item.value = value;
        select.append(item);
    };
    const profile = document.getElementById('profile');
    const scenario = document.getElementById('scenario');
    const cadence = document.getElementById('cadence');
    const chapter = document.getElementById('chapter');
    const objective = document.getElementById('objective');
    const search = document.getElementById('search');
    const sort = document.getElementById('sort');
    data.profiles.forEach((p) => option(profile, p.label, p.id));
    [...new Map(data.conditions.map((condition) => [condition.scenarioId, condition.scenarioLabel])).entries()]
        .forEach(([id, label]) => option(scenario, label, id));
    [...new Map(data.conditions.map((condition) => [condition.cadenceId, condition.cadenceLabel])).entries()]
        .forEach(([id, label]) => option(cadence, label, id));
    if (data.conditions.some((condition) => condition.scenarioId === 'baseline')) scenario.value = 'baseline';
    if (data.conditions.some((condition) => condition.cadenceId === 'native')) cadence.value = 'native';
    [...new Set(data.levels.map((l) => l.chapter))].sort((a, b) => a - b).forEach((c) => option(chapter, `Chapter ${c}`, c));
    [...new Set(data.groups.map((g) => g.objectiveType).filter(Boolean))].sort().forEach((type) => option(objective, type, type));
    const { totals } = data;
    const cards = [
        ['Attempts', totals.attempted], ['Wins / losses', `${totals.counts.win} / ${totals.counts.loss}`],
        ['Censored / errors', `${totals.counts.censored} / ${totals.counts.error}`],
        ['Completion coverage', `${totals.terminal}/${totals.attempted} · ${pct(totals.completionCoverage)}`],
    ];
    cards.forEach(([label, value]) => {
        const card = el('div', undefined, 'card');
        card.append(el('span', label), el('strong', value));
        document.getElementById('cards').append(card);
    });
    document.getElementById('run-meta').textContent = `${data.pilot ? 'PRELIMINARY PILOT · ' : ''}Revision ${data.revisionLabel} · ${data.coverage.testedOrbs}/${data.coverage.suppliedOrbs} orbs tested · synthetic policies only`;
    document.getElementById('configuration').textContent = JSON.stringify(data.config, null, 2);
    document.getElementById('capabilities').textContent = JSON.stringify(data.capabilities, null, 2);
    const methods = document.getElementById('methods');
    Object.values(data.methodology).filter((value) => typeof value === 'string').forEach((value) => methods.append(el('li', value)));
    const warnings = document.getElementById('warnings');
    [
        `${data.coverage.inconclusiveGroups} groups are inconclusive because capability validation failed.`,
        `${data.coverage.strategyUnvalidatedGroups} groups contain chain goals above demonstrated policy depth; engine checks do not validate that strategy.`,
        ...data.warnings,
    ].forEach((warning) => warnings.append(el('p', warning)));
    const candidates = document.getElementById('candidates');
    candidates.textContent = data.reviewCandidates.length ? JSON.stringify(data.reviewCandidates, null, 2)
        : 'None flagged. Adequate samples and coverage are required; a pilot cannot establish a smooth difficulty curve.';
    const colors = ['#82dfc3', '#b7a4ff', '#ffc181', '#85c6ff'];
    function filtered() {
        return data.groups.filter((g) => (!profile.value || g.profileId === profile.value)
            && (!scenario.value || g.scenarioId === scenario.value)
            && (!cadence.value || g.cadenceId === cadence.value)
            && (!chapter.value || String(g.chapter) === chapter.value)
            && (!objective.value || g.objectiveType === objective.value)
            && (!search.value || `${g.levelId} ${g.levelName} ${g.profileLabel} ${g.regime} ${g.scenarioLabel} ${g.cadenceLabel}`.toLowerCase().includes(search.value.toLowerCase())));
    }
    function series(groups) {
        return [...new Map(groups.map((group) => [JSON.stringify([group.profileId, group.scenarioId, group.cadenceId]), group])).values()];
    }
    const seriesLabel = (group) => `${group.profileLabel} · ${group.scenarioLabel} / ${group.cadenceLabel}`;
    const sameSeries = (a, b) => a.profileId === b.profileId && a.scenarioId === b.scenarioId && a.cadenceId === b.cadenceId;
    function heatmap(groups) {
        const host = document.getElementById('heatmap');
        host.replaceChildren();
        const ids = [...new Set(groups.map((g) => g.levelId))].sort((a, b) => a - b);
        host.style.gridTemplateColumns = `160px repeat(${Math.max(1, ids.length)}, minmax(24px, 1fr))`;
        host.append(el('div', 'Policy / orb', 'heat-label'));
        ids.forEach((id) => host.append(el('div', id, 'heat-axis')));
        series(groups).forEach((s) => {
            host.append(el('div', seriesLabel(s), 'heat-label'));
            ids.forEach((id) => {
                const g = groups.find((group) => group.levelId === id && sameSeries(group, s));
                const cell = el('div', g ? pct(g.successRate) : '—', 'heat-cell');
                if (g?.successRate !== null && g?.successRate !== undefined) cell.style.background = `hsl(${12 + 140 * g.successRate} 38% 30%)`;
                if (g?.evidence.inconclusive) cell.classList.add('inconclusive');
                cell.title = g ? `${g.levelId} ${g.levelName} · ${seriesLabel(s)}\nTerminal win ${pct(g.successRate)}; completed ${g.terminal}/${g.attempted}\nW/L/C/E ${g.counts.win}/${g.counts.loss}/${g.counts.censored}/${g.counts.error}\n${g.status}` : 'No group';
                cell.setAttribute('aria-label', cell.title);
                host.append(cell);
            });
        });
    }
    function chart(groups) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.getElementById('curve');
        svg.replaceChildren();
        const ids = [...new Set(groups.map((g) => g.levelId))].sort((a, b) => a - b);
        const min = ids[0] || 1;
        const max = ids.at(-1) || min;
        const x = (id) => 50 + (((id - min) / Math.max(1, max - min)) * 900);
        const y = (rate) => 225 - rate * 190;
        const shape = (tag, attrs, text) => {
            const node = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
            if (text !== undefined) node.textContent = text;
            svg.append(node);
            return node;
        };
        [0, 0.25, 0.5, 0.75, 1].forEach((rate) => {
            shape('line', {
                x1: 50, y1: y(rate), x2: 950, y2: y(rate), stroke: '#334054',
            });
            shape('text', {
                x: 42, y: y(rate) + 4, fill: '#aeb9c9', 'text-anchor': 'end', 'font-size': 12,
            }, pct(rate));
        });
        ids.filter((id, i) => i === 0 || i === ids.length - 1 || i % 5 === 0).forEach((id) => shape('text', {
            x: x(id), y: 245, fill: '#aeb9c9', 'text-anchor': 'middle', 'font-size': 12,
        }, id));
        const legend = document.getElementById('legend');
        legend.replaceChildren();
        series(data.groups).forEach((s, index) => {
            if (!groups.some((g) => sameSeries(g, s))) return;
            const color = colors[index % colors.length];
            const label = el('span', seriesLabel(s));
            label.style.color = color;
            legend.append(label);
            let path = '';
            let previous = false;
            ids.forEach((id) => {
                const g = groups.find((group) => group.levelId === id && sameSeries(group, s));
                if (!g || g.successRate === null) { previous = false; return; }
                path += `${previous ? 'L' : 'M'}${x(id)},${y(g.successRate)} `;
                previous = true;
                if (g.interval95) {
                    shape('line', {
                        x1: x(id), x2: x(id), y1: y(g.interval95.low), y2: y(g.interval95.high), stroke: color, opacity: 0.3,
                    });
                }
                const point = shape('circle', {
                    cx: x(id), cy: y(g.successRate), r: 3, fill: color,
                });
                const title = document.createElementNS(ns, 'title');
                title.textContent = `${id} ${g.levelName} · ${seriesLabel(s)}: ${pct(g.successRate)}, completed ${g.terminal}/${g.attempted}`;
                point.append(title);
            });
            shape('path', {
                d: path, fill: 'none', stroke: color, 'stroke-width': 1.5,
            });
        });
    }
    function table(groups) {
        const body = document.getElementById('rows');
        body.replaceChildren();
        const sorted = groups.slice().sort((a, b) => {
            if (sort.value === 'coverage') return (a.completionCoverage ?? -1) - (b.completionCoverage ?? -1);
            if (sort.value === 'win') return (a.successRate ?? -1) - (b.successRate ?? -1);
            if (sort.value === 'gap') return (b.goals.primary?.remaining.median ?? -1) - (a.goals.primary?.remaining.median ?? -1);
            return a.levelId - b.levelId || a.profileId.localeCompare(b.profileId)
                || a.scenarioId.localeCompare(b.scenarioId) || a.cadenceId.localeCompare(b.cadenceId);
        });
        sorted.forEach((g) => {
            const row = el('tr');
            const rate = g.interval95 ? `${pct(g.successRate)} [${pct(g.interval95.low)}–${pct(g.interval95.high)}]` : '—';
            const bounds = g.overallWinBounds ? `${pct(g.overallWinBounds.low)}–${pct(g.overallWinBounds.high)}` : '—';
            const cells = [
                `${g.levelId} · ${g.levelName}`, g.profileLabel, g.scenarioLabel, g.cadenceLabel,
                `${g.status}${g.evidence.strategyUnvalidated ? ' · strategy unvalidated' : ''}`,
                `${g.counts.win}/${g.counts.loss}/${g.counts.censored}/${g.counts.error}`, rate,
                `${g.terminal}/${g.attempted} · ${pct(g.completionCoverage)}`, bounds,
                `${num(g.durations.terminal.median)} / ${num(g.durations.terminal.p90)}`,
                `${g.stars[1]}/${g.stars[2]}/${g.stars[3]}`,
                g.goals.primary ? `${num(g.goals.primary.remaining.median)} ${g.goals.primary.metric} to ${g.target}` : '—',
                `${num(g.metrics.cascades.median)} / depth ${num(g.metrics.maxCascadeDepth.median)}`,
                g.duel ? `${num(g.duel.playerFrags.median)}–${num(g.duel.botFrags.median)} · ${num(g.duel.deaths.median)} deaths` : '—',
                g.duel?.telemetry ? `${num(g.duel.telemetry.players[0].attackLinesPerActiveMinute.median)} / ${num(g.duel.telemetry.players[1].attackLinesPerActiveMinute.median)}` : '—',
                `${num(g.showcase.primarySeconds.median)} · ${g.showcase.lapCensored} laps capped`,
                Object.entries(g.failureCauses).map(([reason, count]) => `${reason}: ${count}`).join('; ') || '—',
            ];
            cells.forEach((value, i) => row.append(el(i === 0 ? 'th' : 'td', value)));
            row.title = [...g.evidence.issues, ...g.evidence.limitations].join('\n');
            body.append(row);
        });
        document.getElementById('row-count').textContent = `${groups.length} orb/policy/scenario/cadence groups shown`;
        const pairs = data.pairedComparisons.filter((pair) => groups.some((g) => g.levelId === pair.levelId)
            && (!scenario.value || pair.scenarioId === scenario.value) && (!cadence.value || pair.cadenceId === cadence.value)
            && (!profile.value || [pair.profileA, pair.profileB].includes(profile.value)));
        const matchedPairs = pairs.filter((pair) => pair.matchedSeeds);
        document.getElementById('paired').textContent = matchedPairs.length
            ? JSON.stringify(matchedPairs, null, 2) : 'No matched seeds recorded.';
        const variants = data.scenarioComparisons.filter((pair) => pair.matchedSeeds
            && groups.some((g) => g.levelId === pair.levelId)
            && (!profile.value || pair.profileId === profile.value)
            && (!cadence.value || pair.cadenceId === cadence.value)
            && (!scenario.value || [pair.scenarioA, pair.scenarioB].includes(scenario.value)));
        const variantRows = document.getElementById('variant-rows');
        variantRows.replaceChildren();
        variants.forEach((pair) => {
            const row = el('tr');
            [pair.levelId, pair.profileId, pair.cadenceId, pair.scenarioB,
                `${pair.terminalPairs}/${pair.matchedSeeds}`, pair.inconclusive ? 'inconclusive' : pct(pair.winRateDifferenceBMinusA),
                num(pair.bothWinPrimaryDurationDifferenceBMinusA.median),
                `${num(pair.quality.starDifferenceBMinusA.median)} · ${pair.quality.completePairs} pairs`,
                pair.quality.lapCensoredPairs,
                `${num(pair.duelAttackLinesPerActiveMinuteDifferenceBMinusA[0].median)} / ${num(pair.duelAttackLinesPerActiveMinuteDifferenceBMinusA[1].median)}`,
                num(pair.completedRoundDurationDifferenceBMinusA.median),
            ].forEach((value) => row.append(el('td', value)));
            variantRows.append(row);
        });
        document.getElementById('variant-count').textContent = variants.length
            ? `${variants.length} matched baseline comparisons; differences are variant minus baseline.` : 'No matched baseline/variant seeds for the selected conditions.';
        document.getElementById('variant-data').textContent = variants.length ? JSON.stringify(variants, null, 2) : 'No matched comparisons.';
        document.getElementById('telemetry').textContent = JSON.stringify(groups.filter((g) => g.duel?.telemetry || g.inputTelemetry.n)
            .map((g) => ({
                levelId: g.levelId,
                profileId: g.profileId,
                scenarioId: g.scenarioId,
                cadenceId: g.cadenceId,
                duel: g.duel?.telemetry,
                input: g.inputTelemetry,
                showcase: g.showcase,
            })), null, 2);
    }
    function construction(groups) {
        const selected = new Set(groups.map((group) => JSON.stringify([group.levelId, group.profileId])));
        const demonstrations = data.authoredConstruction.filter((demo) => selected.has(JSON.stringify([demo.levelId, demo.profileId])));
        const body = document.getElementById('construction-rows');
        body.replaceChildren();
        demonstrations.forEach((demo) => {
            const row = el('tr');
            [demo.levelId, demo.profileId, demo.seed, demo.startLabel, demo.targetDepth ?? '—',
                demo.maximumDepth ?? '—', demo.legalConstruction ? 'Legal complete trace' : 'Unqualified trace',
                demo.finishLabel, demo.termination, demo.timed === false ? 'Untimed' : 'Unrecorded',
                demo.timeConstraintsStatus].forEach((value) => row.append(el('td', value)));
            body.append(row);
        });
        document.getElementById('construction-count').textContent = demonstrations.length
            ? `${demonstrations.length} untimed authored-board demonstrations for the selected orbs and policies.`
            : 'No authored-board demonstrations recorded for the selected orbs and policies.';
        document.getElementById('construction-data').textContent = JSON.stringify(demonstrations, null, 2);
    }
    function render() { const groups = filtered(); heatmap(groups); chart(groups); table(groups); construction(groups); }
    [profile, scenario, cadence, chapter, objective, search, sort].forEach((control) => control.addEventListener('input', render));
    document.getElementById('download').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = 'summary.json'; link.click(); URL.revokeObjectURL(url);
    });
    render();
    window.__ODYSSEY_REPORT_READY__ = true;
}

function renderHtml(summary) {
    const data = JSON.stringify(summary).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odyssey gameplay benchmark</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1020;color:#eaf0f9;font-size:14px}*{box-sizing:border-box}body{margin:0}main{max-width:1600px;margin:auto;padding:32px}header{border-bottom:1px solid #334054;padding-bottom:24px}h1{font-size:clamp(28px,4vw,44px);margin:10px 0}h2{font-size:22px;margin:0 0 8px}p{line-height:1.6;color:#b5c0d1}label{display:grid;gap:6px;font-size:12px;color:#b5c0d1}select,input,button{font:inherit;border:1px solid #3b4760;background:#151e33;color:#edf4ff;border-radius:8px;padding:10px}button{cursor:pointer}button:hover{border-color:#82dfc3}section{margin-top:32px}.note{border-left:3px solid #ffc181;background:#1c2334;padding:16px 20px;border-radius:6px}.note strong{color:#ffc181}.note p{margin:4px 0}#cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:24px}.card{background:#151d30;border:1px solid #2c3952;border-radius:12px;padding:18px}.card span{display:block;color:#aeb9c9;font-size:12px}.card strong{display:block;margin-top:10px;font-size:25px}.toolbar{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin:22px 0}.toolbar label{flex:1;min-width:130px}.toolbar .search{flex:2;min-width:180px}.scroll{overflow:auto;border:1px solid #2c3952;border-radius:12px;background:#101829}#heatmap{display:grid;gap:3px;padding:12px;min-width:max-content}.heat-cell{display:flex;align-items:center;justify-content:center;min-width:24px;min-height:34px;background:#243147;color:#edf4ff;font-size:9px;border-radius:3px}.heat-cell.inconclusive{background:repeating-linear-gradient(45deg,#453f57,#453f57 3px,#292637 3px,#292637 6px)}.heat-label{display:flex;align-items:center;font-size:12px;padding-right:8px;position:sticky;left:0;background:#101829;z-index:1}.heat-axis{text-align:center;font-size:10px;color:#aeb9c9}#curve{width:100%;min-width:620px;height:auto;display:block;background:#101829;border:1px solid #2c3952;border-radius:12px}#legend{display:flex;gap:20px;flex-wrap:wrap;margin:12px 0}table{border-collapse:collapse;width:100%;min-width:1600px;font-size:12px}thead{position:sticky;top:0;z-index:2;background:#1c2840}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #29344b}tbody th{min-width:150px;max-width:240px}tbody tr:nth-child(even){background:#141e32}.table-scroll{max-height:640px}details{border:1px solid #2c3952;border-radius:10px;padding:16px;margin:14px 0;background:#101829}summary{cursor:pointer;color:#d8e5f6;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;color:#b5c0d1;max-height:440px;overflow:auto}li{color:#b5c0d1;line-height:1.6;margin:8px 0}.caption{font-size:12px}footer{color:#9aa8bc;padding:30px 0}.empty{padding:24px}@media(max-width:700px){main{padding:18px}#cards{grid-template-columns:repeat(2,1fr)}.card{padding:14px}.card strong{font-size:20px}.toolbar{gap:10px}}
table{min-width:2200px}.heat-label{overflow-wrap:anywhere;padding-top:5px;padding-bottom:5px}#variant-table{min-width:1250px}
</style></head><body><main>
<header><p id="run-meta"></p><h1>Odyssey gameplay benchmark</h1><p>Measured attempts across authored orbs and synthetic policies.</p><button id="download">Download summary JSON</button></header>
<section class="note"><strong>Read coverage before judging the win rate.</strong><p>Terminal win rate excludes censored runs and runtime errors. Time and CPU caps can be selective. Overall bounds show how unresolved outcomes limit the conclusion.</p><p>These policies have no human calibration; this report makes no claim about player enjoyment or human success rates.</p></section>
<div id="cards"></div>
<div class="toolbar"><label>Policy<select id="profile"><option value="">All synthetic policies</option></select></label><label>Scenario<select id="scenario"><option value="">All scenarios</option></select></label><label>Cadence<select id="cadence"><option value="">All cadences</option></select></label><label>Chapter<select id="chapter"><option value="">All chapters</option></select></label><label>Objective<select id="objective"><option value="">All objectives</option></select></label><label class="search">Search orb or policy<input id="search" type="search" placeholder="Orb ID, name, policy…"></label><label>Sort<select id="sort"><option value="orb">Orb / policy</option><option value="coverage">Lowest completion coverage</option><option value="win">Lowest terminal win rate</option><option value="gap">Largest objective gap</option></select></label></div>
<section><h2>Terminal win-rate heatmap</h2><p class="caption">Green: more terminal wins. Coral: fewer terminal wins. —: no terminal sample. Stripes: inconclusive capability validation. Hover for W/L/C/E and completion counts; never read a low-coverage cell as a calibrated difficulty rating.</p><div class="scroll"><div id="heatmap"></div></div></section>
<section><h2>Observed campaign curves</h2><p class="caption">Terminal win rate by orb, with Wilson 95% intervals for each policy/scenario/cadence. Conditions remain separate; pooled counts are descriptive and have no aggregate interval. Missing or inconclusive samples leave gaps. Wide intervals and low completion prevent confident curve comparisons.</p><div id="legend"></div><div class="scroll"><svg id="curve" viewBox="0 0 1000 260" role="img" aria-label="Synthetic policy terminal win-rate curves by scenario and cadence with confidence intervals"></svg></div></section>
<section><h2>Orb measurements</h2><p id="row-count"></p><p class="caption">W/L/C/E = win / loss / censored / error. Stars = observed 1 / 2 / 3 stars on completed wins; truncated showcase laps may understate final quality. Durations are terminal median / p90 active seconds. Attack throughput is human / opponent rows per active minute. Gaps and telemetry include usable observations at stop, including censored runs.</p><div class="scroll table-scroll"><table><thead><tr><th>Orb</th><th>Synthetic policy</th><th>Scenario</th><th>Cadence</th><th>Evidence</th><th>W/L/C/E</th><th>Terminal win [95%]</th><th>Completion coverage</th><th>Overall win bounds</th><th>Terminal seconds</th><th>Stars 1/2/3</th><th>Median objective gap</th><th>Cascades / depth</th><th>Duel frags / deaths</th><th>Attack rows / active min</th><th>Primary seconds / quality</th><th>Loss causes</th></tr></thead><tbody id="rows"></tbody></table></div><details><summary>Measured rounds, input ownership and showcase quality</summary><pre id="telemetry"></pre></details></section>
<section><h2>Matched baseline versus variant</h2><p id="variant-count"></p><p class="caption">Shared orb, policy, cadence and bag/board seed. Win differences use terminal pairs; primary seconds and star differences require both wins. Quality-censored laps stay outside complete star comparisons. Deltas are descriptive, variant minus baseline.</p><div class="scroll"><table id="variant-table"><thead><tr><th>Orb</th><th>Policy</th><th>Cadence</th><th>Variant</th><th>Terminal / matched</th><th>Win delta</th><th>Primary seconds delta</th><th>Complete star delta</th><th>Capped quality pairs</th><th>Attack rows / active min delta</th><th>Completed round seconds delta</th></tr></thead><tbody id="variant-rows"></tbody></table></div><details><summary>Full matched experiment measurements</summary><pre id="variant-data"></pre></details></section>
<section><h2>Capability and strategy limits</h2><div id="warnings"></div><details><summary>Engine fixtures and policy demonstrations</summary><pre id="capabilities"></pre></details></section>
<section><h2>Authored-board construction diagnostics</h2><p id="construction-count"></p><p class="caption">Separate untimed demonstrations from the recorded authored starting board. Target depth is the maximum combo/depth requirement across primary, stars and bonuses, not necessarily the requirement to finish. Cadence, competing gravity, deadlines and timed stars remain unverified. Optional mastery shortfalls do not invalidate timed primary wins.</p><div class="scroll"><table><thead><tr><th>Orb</th><th>Policy</th><th>Seed</th><th>Authored start</th><th>Target depth</th><th>Observed depth</th><th>Trace</th><th>Finish policy</th><th>Stop</th><th>Timing</th><th>Time constraints</th></tr></thead><tbody id="construction-rows"></tbody></table></div><details><summary>Recorded starting boards, exact requirements and unverified time constraints</summary><pre id="construction-data"></pre></details></section>
<section><h2>Comparable curve review candidates</h2><pre id="candidates"></pre><details><summary>Matched-seed policy comparisons</summary><p>Only actual terminal pairs enter the rate delta. Duration differences use pairs where both policies won. These are descriptive comparisons.</p><pre id="paired"></pre></details></section>
<section><h2>Method and run configuration</h2><ul id="methods"></ul><details><summary>Caps, seeds and configuration</summary><pre id="configuration"></pre></details></section>
<footer>Standalone report: all aggregate data and visualizations are embedded. Raw attempts remain in raw.jsonl beside this file.</footer>
</main><script type="application/json" id="report-data">${data}</script><script>(${mountReport.toString()})();</script></body></html>`;
}

/** Write portable evidence and a standalone interactive report. */
export async function writeReports(options) {
    const outputDir = resolve(options.outputDir);
    const summary = buildSummary(options);
    const paths = {
        raw: resolve(outputDir, 'raw.jsonl'),
        summary: resolve(outputDir, 'summary.json'),
        markdown: resolve(outputDir, 'report.md'),
        html: resolve(outputDir, 'report.html'),
    };
    await mkdir(outputDir, { recursive: true });
    const raw = (options.attempts || []).map((attempt) => JSON.stringify(jsonSafe(normalizeAttempt(attempt)))).join('\n');
    await Promise.all([
        writeFile(paths.raw, raw ? `${raw}\n` : '', 'utf8'),
        writeFile(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
        writeFile(paths.markdown, renderMarkdown(summary), 'utf8'),
        writeFile(paths.html, renderHtml(summary), 'utf8'),
    ]);
    return { paths, summary };
}
