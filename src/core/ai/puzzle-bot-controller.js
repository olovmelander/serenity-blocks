import { getBotDifficultyConfig, rollReactionDelay } from './bot-difficulty.js';
import { analyzeCascadePreparation, measureBoard, rankCandidates } from './board-evaluator.js';
import { simulatePlacement } from './cascade-simulator.js';
import { estimateLatentDischarge } from './latent-chain.js';
import { findReachablePlacements } from './reachability-pathfinder.js';
import { BotInputScheduler } from './bot-input-scheduler.js';
import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';

function defaultRng() {
    return Math.random();
}

/**
 * Flatten the lookahead's best multi-piece line into an ordered list of expected
 * placements. This is the machine plan the controller commits to across spawns,
 * so the bot follows through on a build->cap->load->fire sequence instead of
 * re-deciding from scratch every piece (and discarding the line it just computed).
 */
function extractPlanSteps(futurePlan) {
    const steps = [];
    let node = futurePlan;
    while (node && node.candidate) {
        steps.push({
            shapeKey: node.candidate.shapeKey,
            x: node.candidate.x,
            rotation: node.candidate.rotation ?? 0,
        });
        node = node.child;
    }
    return steps;
}

function pieceTouchesEdges(metrics) {
    const action = metrics?.sideLaneAction;
    if (!action) return false;
    return (action.sideLanePlatformPlacementScore || 0) > 0
        || (action.sideLaneBridgePlacementScore || 0) > 0
        || (action.sideLaneIPlacementScore || 0) > 0
        || (action.sideLaneStopperPlacementScore || 0) > 0
        || (action.sideLaneTriggerPlacementScore || 0) > 0;
}

function chooseCandidate(ranked, config, rng) {
    if (ranked.length <= 1) return ranked[0] || null;

    if (rng() < (config.mistakeChance || 0)) {
        const poolSize = Math.min(ranked.length, Math.max(2, 2 + Math.floor((11 - config.tier) / 2)));
        const index = Math.floor(rng() * poolSize);
        return ranked[index] || ranked[0];
    }

    return ranked[0];
}

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function makeSpawnPiece(shapeKey, sourceState) {
    const shape = SHAPES[shapeKey];
    if (!shape) return null;

    const piece = {
        color: shapeKey,
        rotation: 0,
        shape: cloneShape(shape),
        shapeKey,
        type: shapeKey,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: HIDDEN_ROWS - 2,
    };

    if (sourceState?.isInfinityMode) {
        const cameraTopRow = sourceState.cameraRow || 0;
        piece.y = Math.max(0, Math.floor(cameraTopRow) - 2);
    }

    return piece;
}

function makeSearchState(boardGrid, shapeKey, sourceState, nextPieces = []) {
    const currentPiece = makeSpawnPiece(shapeKey, sourceState);
    if (!currentPiece) return null;

    return {
        board: boardGrid,
        boardGrid,
        cameraRow: sourceState?.cameraRow || 0,
        currentPiece,
        isInfinityMode: Boolean(sourceState?.isInfinityMode),
        nextPieces,
    };
}

function withDeterministicEvaluation(config) {
    return {
        ...config,
        heuristicNoise: 0,
        mistakeChance: 0,
        // Skip the (expensive) hypothetical-trigger probe inside lookahead — it runs
        // at the top-level decision where it matters; running it at every future ply
        // is the dominant per-plan cost with little ranking benefit.
        latentChainEval: false,
    };
}

function getSpawnToken(state, piece) {
    if (!piece) return null;

    if (Number.isFinite(state?.piecesPlaced)) {
        return `count:${state.piecesPlaced}`;
    }

    if (Number.isFinite(state?.pieceSpawnTime)) {
        return `time:${state.pieceSpawnTime}`;
    }

    return piece;
}

function normalizeShapeKey(piece) {
    if (typeof piece === 'string') return piece;
    return piece?.shapeKey || piece?.type || null;
}

function getNextShapeKeys(state) {
    return (state?.nextPieces || [])
        .map(normalizeShapeKey)
        .filter(Boolean);
}

function boardCacheKey(boardGrid) {
    return (boardGrid || [])
        .map((row) => row.map((cell) => (cell ? '1' : '0')).join(''))
        .join('|');
}

export class PuzzleBotController {
    constructor(options) {
        this.playerIndex = options.playerIndex;
        this.playerState = options.playerState;
        this.actions = options.actions;
        this.rng = options.rng || defaultRng;
        this.config = getBotDifficultyConfig(options.difficulty ?? 10);
        this.scheduler = new BotInputScheduler(this.actions, this.config);
        this.currentSpawnToken = null;
        this.readyAtMs = 0;
        this.lastPlan = null;
        // Persistent multi-piece machine plan — survives spawns (the fix for
        // "builds the lane but never caps/loads/fires it").
        this.machinePlan = null;
    }

    reset() {
        this.scheduler.clear();
        this.currentSpawnToken = null;
        this.readyAtMs = 0;
        this.lastPlan = null;
        this.machinePlan = null;
    }

    update(deltaMs, nowMs) {
        const state = this.playerState;
        if (
            !state
            || !state.isAlive
            || state.isGameOver
            || state.isPaused
            || state.isProcessingPhysics
            || state.hitStopRemaining > 0
        ) {
            return;
        }

        const piece = state.currentPiece;
        if (!piece) {
            this.reset();
            return;
        }

        const spawnToken = getSpawnToken(state, piece);
        if (spawnToken !== this.currentSpawnToken) {
            this.currentSpawnToken = spawnToken;
            this.scheduler.clear();
            this.lastPlan = null;
            this.readyAtMs = nowMs + rollReactionDelay(this.config, this.rng);
        }

        if (!this.lastPlan && nowMs >= this.readyAtMs) {
            this.lastPlan = this.plan();
            if (this.lastPlan?.actions?.length) {
                this.scheduler.setActions(this.lastPlan.actions);
            }
        }

        this.scheduler.update(deltaMs);
    }

    plan() {
        const placements = findReachablePlacements(this.playerState);
        if (placements.length === 0) return null;

        const boardGrid = this.playerState.boardGrid || this.playerState.board;
        const nextShapeKeys = getNextShapeKeys(this.playerState);
        const preparationBefore = analyzeCascadePreparation(boardGrid, nextShapeKeys);

        const candidates = this.evaluatePlacements(this.playerState, placements, preparationBefore);
        const rankedFull = rankCandidates(candidates, this.config, this.rng);
        let ranked = this.applyLookahead(rankedFull);

        // Tactical layer: persistent plan commitment, build-vs-fire, danger gate.
        const tactics = this.assessTactics(boardGrid, preparationBefore);
        ranked = this.applyTacticalBias(ranked, tactics);

        const selected = this.chooseSelection(ranked, rankedFull, tactics);
        if (!selected) return null;

        this.updateMachinePlan(selected, tactics);

        const actions = selected.actions.slice();
        if (this.config.hardDropChance >= 1 || this.rng() <= this.config.hardDropChance || actions.length === 0) {
            actions.push({ type: 'hardDrop' });
        }

        return {
            actions,
            candidate: selected,
            score: selected.evaluation.score,
            tactics,
        };
    }

    /**
     * Final selection with a hard build-vs-fire GO override. Lookahead structurally
     * over-values keeping a standing machine (its setup reward is re-counted at every
     * ply), so a soft bias can't reliably make the bot DETONATE. When a worthwhile
     * discharge exists — a board-clearing cascade, or one that meets the tier's depth
     * target — take the best one outright (searching the full pre-lookahead list so
     * firing placements aren't lost to beam pruning). Otherwise fall back to the
     * normal (lookahead + mistake) choice.
     */
    chooseSelection(ranked, rankedFull, tactics) {
        if (this.config.buildVsFire) {
            // Fire a board-clearing cascade (>=2), a Tetris-or-better (>=4 is always
            // strong and safe in a no-hold game), or anything meeting the tier target.
            // Triples/doubles are intentionally held to build a bigger cascade — but
            // under the danger gate, fire ANY clear to survive (downstack).
            //
            // NOTE: an empirical sweep (scripts/sweep-cascade-policy.mjs) showed that
            // *withholding* Tetrises when "safe" to build deeper backfires on this
            // 24-row board — it floods the stack into the danger zone, yielding MORE
            // survival singles and FEWER Tetrises. Eager fire-at-Tetris is the best
            // policy here, so we keep it.
            const target = this.config.triggerDepthTarget || 4;
            const minLines = tactics.danger ? 1 : 4;
            const discharges = rankedFull.filter((candidate) => {
                const lines = candidate.totalLines || 0;
                return (candidate.perfectClear && lines >= 2) || lines >= minLines || lines >= target;
            });
            if (discharges.length > 0) {
                discharges.sort((a, b) => {
                    const sa = a.evaluation?.immediateScore ?? a.evaluation?.score ?? 0;
                    const sb = b.evaluation?.immediateScore ?? b.evaluation?.score ?? 0;
                    return sb - sa;
                });
                return discharges[0];
            }
        }
        return chooseCandidate(ranked, this.config, this.rng);
    }

    getPendingGarbage() {
        const state = this.playerState;
        if (typeof state?.garbageQueue?.getTotalLines === 'function') {
            return state.garbageQueue.getTotalLines() || 0;
        }
        if (Number.isFinite(state?.pendingGarbage)) return state.pendingGarbage;
        if (Number.isFinite(state?.garbagePending)) return state.garbagePending;
        return 0;
    }

    /**
     * Survival danger gate + build-vs-fire context. Spare rows to top-out are
     * discounted by pending incoming garbage (which inserts from the bottom and
     * shoves the stack up), so a buried board stops building and downstacks.
     */
    assessTactics(boardGrid, preparationBefore) {
        if (!this.config.buildVsFire) {
            return {
                danger: false, loadedLane: null, machineLoaded: false, spareRows: Infinity,
            };
        }
        const metrics = measureBoard(boardGrid);
        const pending = this.getPendingGarbage();
        const spareRows = (metrics.safeStackMargin ?? 99) - pending;
        const danger = spareRows < (this.config.dangerSpareRows || 6);
        const loadedLane = (preparationBefore.sideLanes || [])
            .find((lane) => lane.payloadLoaded || lane.triggerReady) || null;

        // A high latent discharge means a build-tall/fire-low machine (e.g. an
        // I-payload tower over a near-full field) is loaded even without a capped
        // side-lane — so treat it as "loaded" and don't fritter it on a small clear.
        let machineLoaded = !!loadedLane;
        if (!danger && this.config.latentChainEval !== false) {
            const nextShapeKeys = getNextShapeKeys(this.playerState);
            const latent = estimateLatentDischarge(boardGrid, preparationBefore.sideLanes, nextShapeKeys);
            if (latent.latentDepth >= (this.config.triggerDepthTarget || 4)) machineLoaded = true;
        }
        return {
            danger, loadedLane, machineLoaded, spareRows,
        };
    }

    /**
     * Re-rank candidates with tactical biases on top of the pure board score:
     * follow a committed machine plan, fire a loaded machine only once its
     * projected discharge meets the tier's depth target, and — when in danger —
     * abandon building to downstack and survive.
     */
    applyTacticalBias(ranked, tactics) {
        if (!this.config.cascadePlanning || ranked.length === 0) return ranked;

        const headStep = this.machinePlan?.steps?.[0] || null;
        const triggerTarget = this.config.triggerDepthTarget || 4;
        const commitment = this.config.planCommitment || 0;

        for (const candidate of ranked) {
            let bias = 0;
            const totalLines = candidate.totalLines || 0;

            if (tactics.danger) {
                // Survive: prize any clear and the lowest resulting stack.
                bias += totalLines * 42;
                bias -= (candidate.evaluation?.metrics?.maxHeight || 0) * 1.6;
            } else {
                if (
                    headStep
                    && candidate.shapeKey === headStep.shapeKey
                    && Math.abs((candidate.x ?? 0) - headStep.x) <= 1
                    && (candidate.rotation ?? 0) === headStep.rotation
                ) {
                    bias += commitment * 220;
                }

                // GO threshold (attack economy): fire a big or board-clearing
                // discharge now rather than letting lookahead hoard the machine.
                if (candidate.perfectClear && totalLines >= 2) {
                    bias += 160 + (totalLines * 12);
                } else if (totalLines >= triggerTarget) {
                    bias += 120 + (totalLines * 10);
                } else if ((tactics.loadedLane || tactics.machineLoaded) && totalLines > 0) {
                    // Don't detonate a loaded machine (capped side-lane OR a high-latent
                    // build-tall/fire-low payload) for a small partial clear.
                    bias -= 60;
                }
            }

            if (bias !== 0) {
                candidate.evaluation = {
                    ...candidate.evaluation,
                    score: candidate.evaluation.score + bias,
                    tacticalBias: bias,
                };
            }
        }

        return ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
    }

    /**
     * Commit (or refresh) the persistent machine plan from the lookahead's best
     * multi-piece line, but only when this placement is actually working a side
     * machine and we are not in survival mode.
     */
    updateMachinePlan(selected, tactics) {
        if (!this.config.cascadePlanning || tactics.danger) {
            this.machinePlan = null;
            return;
        }
        const steps = extractPlanSteps(selected.futurePlan);
        const advancingMachine = pieceTouchesEdges(selected.evaluation?.metrics)
            || Boolean(tactics.loadedLane);
        this.machinePlan = steps.length > 0 && advancingMachine
            ? {
                steps,
                lane: tactics.loadedLane?.edgeColumn ?? null,
                committedToken: this.currentSpawnToken,
            }
            : null;
    }

    evaluatePlacements(searchState, placements, sharedPreparationBefore = null) {
        const candidates = [];
        if (!searchState) return candidates;

        const boardGrid = searchState.boardGrid || searchState.board;
        const nextShapeKeys = getNextShapeKeys(searchState);
        const preparationBefore = sharedPreparationBefore
            || analyzeCascadePreparation(boardGrid, nextShapeKeys);

        for (const placement of placements) {
            const simulation = simulatePlacement(searchState, placement);
            if (!simulation) continue;

            candidates.push({
                ...placement,
                ...simulation,
                actions: placement.actions,
                nextShapeKeys,
                pathCost: placement.pathCost,
                preparationAfter: analyzeCascadePreparation(simulation.boardGrid, nextShapeKeys),
                preparationBefore,
            });
        }
        return candidates;
    }

    applyLookahead(rankedCandidates) {
        const nextShapeKeys = getNextShapeKeys(this.playerState)
            .slice(0, Math.max(0, this.config.lookaheadDepth || 0));
        if (
            this.config.lookaheadDepth <= 0
            || nextShapeKeys.length === 0
            || rankedCandidates.length === 0
        ) {
            return rankedCandidates;
        }

        const breadth = Math.min(
            rankedCandidates.length,
            Math.max(4, Math.ceil((this.config.lookaheadBreadth || 5) * 0.5)),
        );
        const deterministicConfig = withDeterministicEvaluation(this.config);
        const lookaheadCache = new Map();
        const expanded = rankedCandidates.slice(0, breadth).map((candidate) => {
            const futurePlan = this.evaluateFuture(
                candidate.boardGrid,
                nextShapeKeys,
                nextShapeKeys.length,
                deterministicConfig,
                lookaheadCache,
            );
            const futureScore = futurePlan?.score ?? -100000;
            const score = candidate.evaluation.score + futureScore * (this.config.lookaheadWeight || 0.65);

            return {
                ...candidate,
                evaluation: {
                    ...candidate.evaluation,
                    immediateScore: candidate.evaluation.score,
                    lookaheadDepth: futurePlan?.depth ?? 0,
                    lookaheadScore: futureScore,
                    score,
                },
                futurePlan: futurePlan || null,
                nextCandidate: futurePlan?.candidate || null,
            };
        });

        return expanded.sort((a, b) => b.evaluation.score - a.evaluation.score);
    }

    evaluateFuture(boardGrid, shapeKeys, depth, config, cache) {
        if (depth <= 0 || shapeKeys.length === 0) {
            return {
                candidate: null,
                depth: 0,
                score: 0,
            };
        }

        const activeShapeKey = shapeKeys[0];
        const remainingShapeKeys = shapeKeys.slice(1);
        const cacheKey = [
            activeShapeKey,
            depth,
            remainingShapeKeys.join(','),
            boardCacheKey(boardGrid),
        ].join('::');

        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }

        const searchState = makeSearchState(
            boardGrid,
            activeShapeKey,
            this.playerState,
            remainingShapeKeys,
        );
        const placements = searchState ? findReachablePlacements(searchState) : [];
        if (placements.length === 0) {
            const result = {
                candidate: null,
                depth: 0,
                score: -100000,
            };
            cache.set(cacheKey, result);
            return result;
        }

        const ranked = rankCandidates(
            this.evaluatePlacements(searchState, placements),
            config,
            this.rng,
        );
        const futureDivisor = depth >= 3 ? 4 : 6;
        const breadth = Math.min(
            ranked.length,
            Math.max(2, Math.min(4, Math.ceil((this.config.lookaheadBreadth || 5) / futureDivisor))),
        );
        const weight = config.lookaheadWeight || 0.65;
        let best = null;

        for (const candidate of ranked.slice(0, breadth)) {
            const child = this.evaluateFuture(
                candidate.boardGrid,
                remainingShapeKeys,
                depth - 1,
                config,
                cache,
            );
            const childScore = child?.score ?? 0;
            const score = candidate.evaluation.score + childScore * weight;
            if (!best || score > best.score) {
                best = {
                    candidate,
                    child,
                    depth: 1 + (child?.depth || 0),
                    score,
                };
            }
        }

        cache.set(cacheKey, best);
        return best;
    }
}
