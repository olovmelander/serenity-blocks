import { PuzzleBotController } from './puzzle-bot-controller.js';
import { canPlaceCandidate } from './reachability-pathfinder.js';
import { evaluateCandidate } from './board-evaluator.js';
import { COLS } from '../constants.js';
import { isCellBlind } from '../blind.js';
import {
    gravityBoardKey, gravityLandings, gravityReward, GRAVITY_WEIGHTS, nearRoof, readGravityBoard, searchGravity,
} from './gravity-search.js';

const PREVIEWS = [0, 1, 1, 1, 1, 2, 2, 2, 3, 3];
const WIDTH = [1, 1, 2, 3, 3, 4, 5, 8, 10, 16];
const REACTION = [[520, 850], [460, 730], [360, 620], [310, 530], [270, 450],
    [240, 380], [215, 330], [200, 335], [185, 319], [170, 250]];
const ACTION_RATE = [95, 120, 133, 210, 265, 300, 325, 550, 680, 1050];
const FIRE_WAVES = [2, 2, 2, 2, 3, 3, 3, 4, 4, 4];
const SURVIVAL_MARGIN = [0, 0, 0, 11, 8, 0, 8, 0, 0, 0];
// Blind attacks: nobody remembers a hidden stack for long. With every column's top hidden, this
// share of a tier's pieces lands a column or a turn off, like its ordinary mistakes.
const BLIND_SLIP = [0.55, 0.5, 0.45, 0.4, 0.36, 0.32, 0.28, 0.24, 0.2, 0.16];

export function gravityPlanningRate(count = 1, tier = 0, fairShare = false) {
    if (count === 2 && tier >= 9) return 1.25;
    // A versus room of three or four shares what two bots get (the standard well).
    if (fairShare && count >= 3) return (tier >= 9 ? 2.5 : 1.4) / count;
    return (count >= 3 ? 0.65 : 1.4) / Math.max(1, count);
}

/** How much of the stack's surface a blind attack hides, 0 to 1. */
function hiddenSurface(grid) {
    let hidden = 0;
    for (let x = 0; x < COLS; x++) {
        let y = 0;
        while (y < grid.length && !grid[y][x]) y++;
        if (y < grid.length && isCellBlind(grid[y][x])) hidden++;
    }
    return hidden / COLS;
}

function candidate(move) {
    return {
        ...move,
        cascadeCount: move.waves.length,
        totalLines: move.lines,
        projectedAttack: move.attack,
        evaluation: { score: move.score, metrics: { projectedScore: move.score } },
    };
}

function asPlan(moves, actions, tactics) {
    let futurePlan = null;
    for (let i = moves.length - 1; i >= 1; i--) futurePlan = { candidate: candidate(moves[i]), child: futurePlan };
    return {
        actions: [...actions, { type: 'hardDrop' }],
        tactics,
        score: moves[0].score,
        candidate: { ...candidate(moves[0]), futurePlan },
    };
}

function actionsTo(state, target) {
    return gravityLandings(state.boardGrid || state.board, state.currentPiece)
        .find((p) => p.x === target.x && p.y === target.y && p.rotation === target.rotation)?.actions;
}

function sliceRate(rate, board, tier, infinity, versus = false) {
    const high = nearRoof(board, versus);
    if (versus) return high ? Math.min(rate, 0.35) : rate;
    if (infinity) return Math.min(rate, 0.3);
    if (tier === 3 && high && !board.garbage) return Math.min(rate, 1.05);
    if ((tier >= 8 && high) || (tier <= 3 && (high || board.garbage))) return Math.min(rate, 0.35);
    return rate;
}

function rewardContextKey(state) {
    return [state.level ?? 1, state.linesUntilNextLevel ?? 15, Boolean(state.disableLevelProgression),
        Boolean(state.comboMultiplierEnabled), state.comboMultiplierEnabled ? state.comboCount || 0 : 0,
        state.comboMultiplierEnabled ? state.comboMultiplier || 1 : 1].join('/');
}

function* searchWithinBudget(state, config, pending, weights, root, allowance) {
    let ready = null;
    const search = searchGravity(state, config, pending, weights, (result) => { ready = result; }, root);
    for (let unit = 1; ; unit++) {
        const step = search.next();
        if (step.done) { ready = step.value; break; }
        if (unit >= allowance && ready) { search.return(); break; }
        yield;
    }
    if (!ready) return null;
    const moves = ready.route.map((node) => node.move);
    const proof = !pending && moves.length > 1 && moves.at(-1).waves.length >= 2 ? ready.route.slice(1).map((node) => ({
        move: node.move,
        before: gravityBoardKey(node.parent.board.cells),
        roomAfter: node.roomAfter,
        rewardContext: rewardContextKey(node.parent.context),
    })) : [];
    return { moves, proof, alternatives: ready.alternatives.map((node) => node.move) };
}

function advanceSearch(entry) {
    const next = entry.job.next();
    if (next.done) {
        entry.result = next.value;
        entry.job = null;
    } else entry.units++;
}

// A fixed seat consumes one unit at each yield, even when an earlier display
// frame or another seat has already evaluated that part of the search.
function* sharedSearch(owner, state, config, pending, weights, root, allowance) {
    const cache = owner.sharedSearch;
    const {
        x, y, rotation, shapeKey, shape,
    } = state.currentPiece;
    const nextPieces = (state.nextPieces || []).slice(0, config.previews)
        .map((p) => (typeof p === 'string' ? p : p?.shapeKey || p?.type || null));
    const key = cache && gravityBoardKey(root.cells) + JSON.stringify([root.first, x, y, rotation, shapeKey, shape,
        nextPieces, pending, state.lines, rewardContextKey(state), config, weights, allowance]);
    let entry = cache?.get(key);
    if (!entry) {
        // The first step enumerates the live root. Later steps use labelled copies
        // and this reward snapshot, even if the originating seat cancels its plan.
        const snapshot = {
            boardGrid: state.boardGrid || state.board,
            currentPiece: {
                x, y, rotation, shapeKey, shape,
            },
            nextPieces,
            lines: state.lines,
            level: state.level,
            linesUntilNextLevel: state.linesUntilNextLevel,
            disableLevelProgression: state.disableLevelProgression,
            comboMultiplierEnabled: state.comboMultiplierEnabled,
            comboCount: state.comboCount,
            comboMultiplier: state.comboMultiplier,
        };
        entry = {
            job: searchWithinBudget(snapshot, config, pending, weights, root, allowance),
            units: 0,
            result: null,
        };
        if (cache) {
            if (cache.size >= 32) cache.delete(cache.keys().next().value);
            cache.set(key, entry);
        }
    }
    owner.activeSearch = entry;
    for (let cursor = 0; ; cursor++) {
        if (cursor === entry.units && entry.job) advanceSearch(entry);
        if (!entry.job && cursor === entry.units) {
            owner.activeSearch = null;
            return entry.result;
        }
        owner.nextSearchUnit = cursor + 1;
        yield;
    }
}

/** Standard matches use public previews and actual body connectivity. Infinity keeps
 * its camera/roof-aware movement and scoring policy in the shared base controller. */
export class GravityBotController extends PuzzleBotController {
    constructor(options) {
        super(options);
        this.pendingRows = options.pendingRows;
        this.opponentRoom = options.opponentRoom;
        this.finishingRoom = options.finishingRoom;
        this.versus = options.versus ?? Boolean(this.opponentRoom || this.finishingRoom);
        // Versus play (versus-evaluation.js): the weights it builds and fires by, and what its
        // match says right now (attackOutlook). Without them the search plays as it always has.
        this.versusWeights = options.versusWeights ?? null;
        this.versusOutlook = options.versusOutlook;
        this.judgment = options.judgment;
        const i = this.config.tier - 1;
        this.sharedSearch = i === 9 ? options.sharedSearch : null;
        this.precomputeBetweenTicks = options.precomputeBetweenTicks === true;
        this.searchConfig = {
            previews: PREVIEWS[i],
            width: WIDTH[i],
            virtual: i >= 2,
            trigger: i >= 3,
            fireWaves: FIRE_WAVES[i],
            safetyMargin: Math.max(6, 12 - i),
            attackStock: i >= 7 ? 36 : 0,
            ...options.searchConfig,
        };
        const weights = options.weights || GRAVITY_WEIGHTS;
        // A short-preview player cannot recover the cavities an expert can prove.
        const risk = Math.max(0, (7 - i) / 7);
        this.weights = {
            ...weights,
            holes: weights.holes + 11 * risk,
            height: weights.height + 3 * risk,
            danger: weights.danger + 10 * risk,
            material: weights.material * (1 - risk),
            virtualWaves: weights.virtualWaves * (1 - 0.7 * risk),
            triggerWaves: weights.triggerWaves * (1 - 0.55 * risk),
        };
        this.planUnitsPerMs = options.planUnitsPerMs ?? gravityPlanningRate();
        if (!options.configOverrides?.reactionMs) this.config.reactionMs = [...REACTION[i]];
        if (!options.configOverrides?.maxApm) {
            this.config.maxApm = ACTION_RATE[i];
            this.config.actionIntervalMs = 60000 / this.config.maxApm;
        }
        if (options.localPace) {
            const { nominalTier, apm, scale } = options.localPace;
            this.config.reactionMs = [...REACTION[nominalTier - 1]];
            this.localPace = {
                scale,
                interval: Math.max(nominalTier === 9 ? 50 : 65, Math.min(950, (60000 / apm) * scale)),
            };
            // Practiced movement gets the piece into place while gravity runs.
            // A slower seat spends the rest of its deliberation lined up to drop.
            this.config.actionIntervalMs = Math.min(this.config.actionIntervalMs, this.localPace.interval);
            this.dropHesitation = 0;
        }
        this.scheduler.canLock = () => {
            const state = this.playerState;
            const p = state.currentPiece;
            const target = this.lastPlan?.candidate;
            if (!p || !target || p.x !== target.x || p.y > target.y) return false;
            if ((p.rotation ?? 0) !== target.rotation) return false;
            const grid = state.boardGrid || state.board;
            // Garbage or gravity may have changed the landing during a tuck.
            for (let y = Math.floor(p.y) + 1; y <= target.y; y++) {
                if (!canPlaceCandidate(grid, { ...p, y })) return false;
            }
            return !canPlaceCandidate(grid, { ...p, y: target.y + 1 });
        };
        if (options.timingRng) this.scheduler.variation = () => options.timingRng() * (0.03 + (9 - i) * 0.018);
        this.proof = [];
        this.queueAtPlan = null;
        this.refusals = { piece: -1, count: 0 };
    }

    setSpawnTiming(now) {
        super.setSpawnTiming(now);
        const pace = this.localPace;
        if (!pace) return;
        const raw = this.readyAtMs - now;
        const scale = Math.min(1, pace.scale);
        const delay = Math.max(this.config.reactionMs[0], Math.min(1150, raw * scale));
        this.readyAtMs = now + delay;
        this.dropHesitation = Math.max(0, Math.min(1150, raw * pace.scale) - delay);
        this.checkedDrop = false;
    }

    getPendingGarbage() {
        return this.pendingRows?.() ?? super.getPendingGarbage();
    }

    nextShapeKeys(state) {
        return super.nextShapeKeys({ nextPieces: state.nextPieces?.slice(0, 3) });
    }

    reachablePlacements(state) {
        const grid = state.boardGrid || state.board;
        const piece = state.currentPiece;
        return gravityLandings(grid, piece).map((p) => ({
            ...p,
            shapeKey: piece.shapeKey,
            type: piece.type || piece.shapeKey,
            color: piece.color || piece.shapeKey,
            simulationId: `bot:${piece.shapeKey}:${p.x}:${p.y}:${p.rotation}`,
        }));
    }

    * applyLookaheadSteps(ranked) {
        if (!this.boundedRanking) return yield* super.applyLookaheadSteps(ranked);
        // Keep the fully evaluated legal roof-aware ranking if the remaining
        // reaction time cannot cover the whole next ply.
        const rate = Math.min(this.planUnitsPerMs || gravityPlanningRate(), 0.3);
        const rootWork = ranked.length + Math.floor(ranked.length / 4);
        const allowance = Math.max(0, Math.floor(this.config.reactionMs[0] * rate) - rootWork);
        const future = super.applyLookaheadSteps(ranked);
        for (let work = 0; work < allowance; work++) {
            const step = future.next();
            if (step.done) return step.value;
            yield;
        }
        future.return();
        return ranked;
    }

    * rankSteps(candidates, config) {
        if (!this.boundedRanking) return yield* super.rankSteps(candidates, config);
        const ranked = [];
        for (const c of candidates) {
            ranked.push({ ...c, evaluation: evaluateCandidate(c, config, this.rng) });
            if (ranked.length % 4 === 0) yield;
        }
        return ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
    }

    * evaluatePlacementsSteps(state, placements, preparation) {
        const candidates = yield* super.evaluatePlacementsSteps(state, placements, preparation);
        for (const c of candidates) {
            c.waveScore = gravityReward(c.waves.map((wave) => wave.lineCount), c.perfectClear, state).score;
        }
        return candidates;
    }

    chooseSelection(ranked, all, tactics) {
        if (this.config.buildVsFire) return super.chooseSelection(ranked, all, tactics);
        const best = ranked[0];
        if (this.urgentSurvival) return best;
        if (!best || this.rng() >= this.config.mistakeChance) return best;
        const nearby = ranked.slice(1, 7).filter((c) => Math.abs(c.x - best.x) <= 1
            && (c.x !== best.x || c.rotation !== best.rotation)).slice(0, 4);
        return nearby.length ? nearby[Math.floor(this.rng() * nearby.length)] : best;
    }

    chooseGravityMove(preferred, alternatives) {
        const state = this.playerState;
        const hidden = this.versusWeights ? hiddenSurface(state.boardGrid || state.board) : 0;
        const chance = Math.max(this.config.mistakeChance || 0, hidden * BLIND_SLIP[this.config.tier - 1]);
        if (!chance || this.rng() >= chance) return preferred;
        const nearby = alternatives.filter((move) => Math.abs(move.x - preferred.x) <= 1
            && (move.x !== preferred.x || move.rotation !== preferred.rotation)).slice(0, 4);
        return nearby.length ? nearby[Math.floor(this.rng() * nearby.length)] : preferred;
    }

    reset() {
        super.reset();
        this.activeSearch = null;
        this.proof = [];
        this.queueAtPlan = null;
        this.recognizedSpawn = null;
        this.waitingToExecute = false;
        this.replanInterrupted = false;
        this.retryAllowance = null;
        this.refusals = { piece: -1, count: 0 };
    }

    * planSteps(observed) {
        // Hidden cells (blind attacks) are still solid, and a bot reads the board it collides
        // with: blind never stops a bot from planning.
        const state = this.playerState;
        const pending = this.getPendingGarbage();
        const { tier } = this.config;
        // Last Standing boards have no hidden rows; without versus play they keep the older planner.
        const root = state.isInfinityMode && !this.versusWeights ? null
            : observed || readGravityBoard(state.boardGrid || state.board, state.isInfinityMode ? 0 : undefined);
        if (this.recognizedSpawn !== state.piecesPlaced) {
            this.recognizedSpawn = state.piecesPlaced;
            if (tier <= 3) {
                this.config.lookaheadDepth = this.rng() < [0.12, 0.67, 0.87][tier - 1] ? 1 : 0;
                this.config.lookaheadWeight = 0.45;
            }
            if (tier === 5 && this.judgment?.previewChance !== undefined) {
                const inGarbage = pending > 0 || root?.garbage > 0;
                const chance = inGarbage ? this.judgment.digPreviewChance ?? this.judgment.previewChance
                    : this.judgment.previewChance;
                this.searchConfig.previews = this.rng() < chance ? 1 : 0;
            }
            if (tier === 6) this.searchConfig.previews = this.rng() < (this.judgment?.twoPreviewChance ?? 0.55) ? 2 : 1;
        }
        this.urgentSurvival = tier === 3 && root && !root.garbage && !pending && root.top - root.first < 9;
        if (tier === 3 && root && root.top - root.first < 12) this.config.lookaheadDepth = this.urgentSurvival ? 2 : 1;
        const survivalMargin = SURVIVAL_MARGIN[tier - 1];
        const useSurvival = root && tier <= 7 && !root.garbage && root.top - root.first < survivalMargin;
        this.boundedRanking = state.isInfinityMode;
        const versusPlay = this.versusWeights && root ? {
            weights: this.versusWeights,
            ...this.versusOutlook?.(),
            ...(state.isInfinityMode && { roofRows: Math.max(0, (state.maxRows || 0) - (state.boardGrid || state.board).length) }),
            // Hands that keep being refused let the piece fall where it is.
            dropHere: this.refusals.piece === state.piecesPlaced && this.refusals.count >= 3,
        } : null;
        if (!versusPlay && (state.isInfinityMode || tier <= 3 || useSurvival)) {
            // With zero or one preview the established survival judgement protects
            // novices from cavities they cannot plan their way out of.
            const plan = yield* super.planSteps();
            if (plan) {
                const c = plan.candidate;
                const paid = gravityReward(c.waves.map((wave) => wave.lineCount), c.perfectClear, state);
                c.score = paid.score;
                c.evaluation.metrics.projectedScore = paid.score;
                plan.tactics.pending = pending;
            }
            return plan;
        }
        const tactics = { pending, danger: root.top - root.first - pending < 6 };
        const pressing = this.judgment?.pressAtRows !== undefined && this.opponentRoom?.() <= this.judgment.pressAtRows;
        const supportPlanning = tier >= 8;
        const room = supportPlanning && !versusPlay ? this.finishingRoom?.() : undefined;
        const finishRows = room < this.searchConfig.safetyMargin ? Math.max(1, room + 1) : Infinity;
        const first = this.proof[0];
        const visible = [state.currentPiece.shapeKey, ...this.nextShapeKeys(state)];
        // A burst enters after this piece locks. A previously proved discharge
        // can still fire on this board. Later steps cross the insertion boundary.
        const fireBeforeGarbage = supportPlanning && first && pending > first.pending && first.move.waves.length >= 2
            && first.roomAfter >= pending;
        const proof = fireBeforeGarbage ? [first] : this.proof;
        if (first && (fireBeforeGarbage || (first.pending === pending && first.pressing === pressing && first.finishRows === finishRows))
            && first.rewardContext === rewardContextKey(state)
            && proof.every((step, i) => step.move.shapeKey === visible[i])
            && first.before === gravityBoardKey(root.cells)) {
            const actions = actionsTo(state, first.move);
            if (actions) {
                tactics.fireBeforeGarbage = Boolean(fireBeforeGarbage);
                const plan = asPlan(proof.map((step) => step.move), actions, tactics);
                this.proof = proof.slice(1);
                this.machinePlan = this.proof.length ? { steps: this.proof.map((step) => step.move) } : null;
                return plan;
            }
        }
        this.proof = [];
        this.machinePlan = null;
        // The simulation clock grants the same number of batches at every display
        // rate. Keep the last completed ply if the next one cannot fit. A pressure
        // change forces a new observation and can invalidate a previously ready move.
        const workRate = this.planUnitsPerMs || gravityPlanningRate();
        const rate = sliceRate(workRate, root, tier, false, Boolean(versusPlay));
        const ideal = this.config.reactionMs[0] * rate;
        const allowance = Math.max(1, Math.floor(Math.min(ideal, this.retryAllowance ?? Infinity)));
        // Shorter previews need two extra rows to clear the centre before a spawn is blocked.
        const retreatRows = this.searchConfig.previews < 3 ? 10 : 8;
        const protectSpawn = !versusPlay && tier >= 8 && workRate >= 0.35 && !root.garbage
            && root.top - root.first <= retreatRows;
        tactics.protectSpawn = protectSpawn;
        const config = {
            ...this.searchConfig,
            ...(pressing && {
                attackStock: 4, sustainedStock: 4, minAttack: 1, sustainedAttack: 1,
            }),
            protectSpawn,
            supportPlanning,
            versusPlay,
            versus: this.versus,
            finishRows,
            virtual: this.searchConfig.virtual && !protectSpawn,
            trigger: this.searchConfig.trigger && !protectSpawn,
            sliceRoofProbes: tier >= 8 && (Boolean(versusPlay) || root.garbage > 0) && workRate >= 0.35,
            width: Math.min(
                this.searchConfig.width,
                Math.max(4, Math.round(allowance / 15)),
            ),
        };
        const args = [state, config, pending, this.weights, root, allowance];
        const fixedSearch = this.precomputeBetweenTicks && state.useFixedCascade;
        const search = this.sharedSearch || fixedSearch ? sharedSearch(this, ...args) : searchWithinBudget(...args);
        const result = yield* search;
        if (!result) return null;
        let { moves, proof: forecast } = result;
        const selected = this.chooseGravityMove(moves[0], result.alternatives);
        if (selected !== moves[0]) {
            moves = [selected];
            forecast = [];
        }
        if (forecast.length) {
            this.proof = forecast.map((step) => ({
                ...step, pending, pressing, finishRows,
            }));
            this.machinePlan = { steps: this.proof.map((step) => step.move) };
        }
        return asPlan(moves, moves[0].actions, tactics);
    }

    update(delta, time) {
        const pending = this.getPendingGarbage();
        if (this.scheduler.rejected) {
            const piece = this.playerState.piecesPlaced;
            this.refusals = { piece, count: this.refusals.piece === piece ? this.refusals.count + 1 : 1 };
        }
        if (this.scheduler.rejected || pending !== this.queueAtPlan) {
            this.replanInterrupted = this.queueAtPlan !== null && this.currentSpawnToken != null;
            const rising = this.config.tier >= 8 && !this.scheduler.rejected
                && this.queueAtPlan !== null && pending > this.queueAtPlan;
            const shot = this.proof[0];
            this.scheduler.rejected = false;
            this.queueAtPlan = pending;
            this.proof = rising && shot?.move.waves?.length >= 2 ? [shot] : [];
            this.machinePlan = null;
            this.planJob = null;
            this.pendingPlan = undefined;
            this.lastPlan = null;
            this.waitingToExecute = false;
            this.scheduler.clear();
        }
        super.update(delta, time);
    }

    stepSlicedPlan(delta, now) {
        const state = this.playerState;
        if (!this.planJob && this.pendingPlan === undefined) {
            this.activeSearch = null;
            const board = readGravityBoard(state.boardGrid || state.board, state.isInfinityMode ? 0 : undefined);
            this.planBoardKey = gravityBoardKey(board.cells);
            this.planGrid = state.boardGrid || state.board;
            this.planBoardVersion = state.boardVersion;
            this.sliceRate = sliceRate(this.planUnitsPerMs, board, this.config.tier, state.isInfinityMode, Boolean(this.versusWeights));
            this.planStartPose = [state.currentPiece.x, state.currentPiece.y, state.currentPiece.rotation];
            this.planUnitCredit = 0;
            this.retryAllowance = this.replanInterrupted && this.planUnitsPerMs <= gravityPlanningRate(3)
                ? Math.max(delta, this.readyAtMs - now) * this.planUnitsPerMs : null;
            this.replanInterrupted = false;
            this.planJob = this.planSteps(board);
        }
        if (this.planJob) {
            this.planUnitCredit += Math.max(0, delta) * this.sliceRate;
            while (this.planUnitCredit >= 1) {
                this.planUnitCredit--;
                const step = this.planJob.next();
                if (step.done) {
                    this.planJob = null;
                    this.pendingPlan = step.value;
                    break;
                }
            }
        }
        if (this.pendingPlan === undefined) return;
        const plan = this.pendingPlan;
        this.pendingPlan = undefined;
        if (!plan || !this.refreshRoute(plan)) { this.proof = []; return; }
        this.waitingToExecute = now < this.readyAtMs;
        this.adoptPlan(plan);
    }

    precomputeSearch(elapsedMs, tickMs) {
        const entry = this.activeSearch;
        if (!this.planJob || !entry?.job || !(elapsedMs > 0)) return 0;
        const dueNextTick = this.nextSearchUnit + Math.ceil(this.sliceRate * tickMs);
        const allowance = Math.max(1, Math.floor(this.sliceRate * elapsedMs));
        let advanced = 0;
        while (entry.job && entry.units < dueNextTick && advanced < allowance) {
            advanceSearch(entry);
            advanced++;
        }
        return advanced;
    }

    refreshRoute(plan) {
        const state = this.playerState;
        const grid = state.boardGrid || state.board;
        // Live boards mark in-place edits and replace the grid on restore. An
        // unversioned fixture or changed grid still gets a full connectivity check.
        const unchanged = state.useFixedCascade && this.planBoardVersion !== undefined
            && grid === this.planGrid && this.planBoardVersion === state.boardVersion;
        if (!unchanged && this.planBoardKey !== gravityBoardKey(readGravityBoard(grid).cells)) return false;
        const piece = state.currentPiece;
        if (this.planStartPose.some((v, i) => v !== [piece.x, piece.y, piece.rotation][i])) {
            const actions = actionsTo(state, plan.candidate);
            if (!actions) return false;
            plan.actions = [...actions, { type: 'hardDrop' }];
        }
        return true;
    }

    advanceInput(delta, now) {
        if (this.waitingToExecute) {
            if (now < this.readyAtMs || !this.lastPlan) return;
            this.waitingToExecute = false;
            if (!this.refreshRoute(this.lastPlan)) {
                this.proof = [];
                this.lastPlan = null;
                this.scheduler.clear();
                return;
            }
            this.scheduler.setActions(this.lastPlan.actions);
        }
        if (this.localPace && !this.checkedDrop
            && this.scheduler.queue.length === 1 && this.scheduler.queue[0].type === 'hardDrop') {
            const moves = Math.max(0, (this.lastPlan?.actions.length || 1) - 1);
            this.scheduler.cooldownMs += Math.min(1800, this.dropHesitation
                + moves * Math.max(0, this.localPace.interval - this.config.actionIntervalMs));
            this.checkedDrop = true;
        }
        super.advanceInput(delta, now);
    }
}
