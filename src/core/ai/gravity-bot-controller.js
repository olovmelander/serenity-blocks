import { PuzzleBotController } from './puzzle-bot-controller.js';
import { canPlaceCandidate } from './reachability-pathfinder.js';
import {
    gravityBoardKey, gravityLandings, gravityReward, GRAVITY_WEIGHTS, readGravityBoard, searchGravity,
} from './gravity-search.js';

const PREVIEWS = [0, 1, 1, 1, 1, 2, 2, 2, 3, 3];
const WIDTH = [1, 1, 2, 3, 3, 4, 5, 8, 10, 16];
const REACTION = [[520, 850], [460, 730], [360, 620], [310, 530], [270, 450],
    [240, 380], [215, 330], [200, 305], [185, 275], [170, 250]];
const ACTION_RATE = [95, 120, 133, 210, 265, 300, 325, 480, 570, 850];
const FIRE_WAVES = [2, 2, 2, 2, 3, 3, 3, 4, 4, 4];
const SURVIVAL_MARGIN = [0, 0, 0, 11, 8, 0, 8, 0, 0, 0];

export function gravityPlanningRate(count = 1) {
    return (count >= 3 ? 1 : 1.4) / Math.max(1, count);
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

function rewardContextKey(state) {
    return [state.level ?? 1, state.linesUntilNextLevel ?? 15, Boolean(state.disableLevelProgression),
        Boolean(state.comboMultiplierEnabled), state.comboMultiplierEnabled ? state.comboMultiplier || 1 : 1].join('/');
}

/** Standard matches use public previews and actual body connectivity. Infinity keeps
 * its camera/roof-aware movement and scoring policy in the shared base controller. */
export class GravityBotController extends PuzzleBotController {
    constructor(options) {
        super(options);
        this.pendingRows = options.pendingRows;
        this.judgment = options.judgment;
        const i = this.config.tier - 1;
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
        this.scheduler.canLock = () => {
            const state = this.playerState;
            const p = state.currentPiece;
            const target = this.lastPlan?.candidate;
            if (!p || !target || p.x !== target.x || (p.rotation ?? 0) !== target.rotation || p.y > target.y) return false;
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
    }

    getPendingGarbage() {
        return this.pendingRows?.() ?? super.getPendingGarbage();
    }

    nextShapeKeys(state) {
        return super.nextShapeKeys(state).slice(0, 3);
    }

    reachablePlacements(state) {
        const grid = state.boardGrid || state.board;
        // The compact BFS uses 16-bit stamps on standard boards.
        if (grid.length >= 64 || state.isInfinityMode) return super.reachablePlacements(state);
        const piece = state.currentPiece;
        return gravityLandings(grid, piece).map((p) => ({
            ...p,
            shapeKey: piece.shapeKey,
            type: piece.type || piece.shapeKey,
            color: piece.color || piece.shapeKey,
        }));
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

    reset() {
        super.reset();
        this.proof = [];
        this.queueAtPlan = null;
        this.recognizedSpawn = null;
        this.waitingToExecute = false;
    }

    * planSteps() {
        const state = this.playerState;
        const pending = this.getPendingGarbage();
        const { tier } = this.config;
        if (this.recognizedSpawn !== state.piecesPlaced) {
            this.recognizedSpawn = state.piecesPlaced;
            if (tier <= 3) {
                this.config.lookaheadDepth = this.rng() < [0.12, 0.67, 0.87][tier - 1] ? 1 : 0;
                this.config.lookaheadWeight = 0.45;
            }
            if (tier === 4 && this.judgment?.threeWaveChance) {
                this.searchConfig.fireWaves = this.rng() < this.judgment.threeWaveChance ? 3 : 2;
            }
            if (tier === 5 && this.judgment?.previewChance !== undefined) {
                this.searchConfig.previews = this.rng() < this.judgment.previewChance ? 1 : 0;
            }
            if (tier === 6) this.searchConfig.previews = this.rng() < (this.judgment?.twoPreviewChance ?? 0.55) ? 2 : 1;
        }
        const root = state.isInfinityMode ? null : readGravityBoard(state.boardGrid || state.board);
        this.urgentSurvival = tier === 3 && root && !root.garbage && !pending && root.top - root.first < 9;
        if (tier === 3 && root && root.top - root.first < 12) this.config.lookaheadDepth = this.urgentSurvival ? 2 : 1;
        const survivalMargin = this.judgment?.survivalMargin ?? SURVIVAL_MARGIN[tier - 1];
        const useSurvival = root && tier <= 7 && !root.garbage && root.top - root.first < survivalMargin;
        if (state.isInfinityMode || tier <= 3 || useSurvival) {
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
        const first = this.proof[0];
        const visible = [state.currentPiece.shapeKey, ...this.nextShapeKeys(state)];
        if (first && first.pending === pending && first.rewardContext === rewardContextKey(state)
            && this.proof.every((step, i) => step.move.shapeKey === visible[i])
            && first.before === gravityBoardKey(root.cells)) {
            const actions = actionsTo(state, first.move);
            if (actions) {
                const plan = asPlan(this.proof.map((step) => step.move), actions, tactics);
                this.proof.shift();
                this.machinePlan = this.proof.length ? { steps: this.proof.map((step) => step.move) } : null;
                return plan;
            }
        }
        this.proof = [];
        this.machinePlan = null;
        // The simulation clock grants the same number of batches at every display
        // rate. Keep the last completed ply if the next one cannot fit. A pressure
        // change forces a new observation and can invalidate a previously ready move.
        let ready = null;
        const allowance = Math.max(1, Math.floor(this.config.reactionMs[0] * (this.planUnitsPerMs || gravityPlanningRate())));
        const config = {
            ...this.searchConfig,
            width: Math.min(
                this.searchConfig.width,
                Math.max(4, Math.round(allowance / 15)),
            ),
        };
        const search = searchGravity(state, config, pending, this.weights, (result) => { ready = result; }, root);
        for (let unit = 0; ; unit++) {
            const step = search.next();
            if (step.done) { ready = step.value; break; }
            if (unit + 1 >= allowance && ready) { search.return(); break; }
            yield;
        }
        const result = ready;
        if (!result) return null;
        let nodes = result.route;
        if (this.config.mistakeChance && this.rng() < this.config.mistakeChance) {
            const preferred = nodes[0].move;
            const nearby = result.alternatives.filter(({ move }) => Math.abs(move.x - preferred.x) <= 1
                && (move.x !== preferred.x || move.rotation !== preferred.rotation)).slice(0, 4);
            if (nearby.length) nodes = [nearby[Math.floor(this.rng() * nearby.length)]];
        }
        const moves = nodes.map((node) => node.move);
        if (moves.length > 1 && moves.at(-1).waves.length >= 2) {
            this.proof = nodes.slice(1).map((node) => ({
                move: node.move, before: gravityBoardKey(node.parent.board.cells), pending,
                rewardContext: rewardContextKey(node.parent.context),
            }));
            this.machinePlan = { steps: this.proof.map((step) => step.move) };
        }
        return asPlan(moves, moves[0].actions, tactics);
    }

    update(delta, time) {
        const pending = this.getPendingGarbage();
        if (this.scheduler.rejected || pending !== this.queueAtPlan) {
            this.scheduler.rejected = false;
            this.queueAtPlan = pending;
            this.proof = [];
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
        if (state.isInfinityMode) { super.stepSlicedPlan(delta, now); return; }
        if (!this.planJob && this.pendingPlan === undefined) {
            this.planBoardKey = gravityBoardKey(readGravityBoard(state.boardGrid || state.board).cells);
            this.planStartPose = [state.currentPiece.x, state.currentPiece.y, state.currentPiece.rotation];
            this.planUnitCredit = 0;
            this.planJob = this.planSteps();
        }
        if (this.planJob) {
            this.planUnitCredit += Math.max(0, delta) * this.planUnitsPerMs;
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

    refreshRoute(plan) {
        const state = this.playerState;
        if (this.planBoardKey !== gravityBoardKey(readGravityBoard(state.boardGrid || state.board).cells)) return false;
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
        super.advanceInput(delta, now);
    }
}
