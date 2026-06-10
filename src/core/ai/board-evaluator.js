import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { calculateQuadraLineScore } from '../scoring.js';
import { applyHeuristicNoise } from './bot-difficulty.js';
import { analyzeSideCascade, classifySideCascadePlacement } from './side-cascade-analyzer.js';
import { estimateLatentDischarge } from './latent-chain.js';
import { computeProjectedAttack } from './cascade-simulator.js';

export const DELLACHERIE_WEIGHTS = Object.freeze({
    landingHeight: -4.500158825082766,
    erodedPieceCells: 3.4181268101392694,
    rowTransitions: -3.2178882868487753,
    columnTransitions: -9.348695305445199,
    holes: -7.899265427351652,
    wellSums: -3.3855972247263626,
});

export const CASCADE_ADAPTATION_WEIGHTS = Object.freeze({
    aggregateHeight: -0.32,
    bumpiness: -0.22,
    // Covered holes outside the protected cascade lane are damage (they block clears
    // and force the stack up). All covered holes get a strong base penalty; enclosed
    // cavities (no lateral access, can't be dug without clearing above) get an extra
    // surcharge. The intentional capped well is exempted separately (protected lane),
    // so this does not punish the cascade machine — only genuine buried holes.
    coveredHole: -8.5,
    cavityCells: -7,
    maxHeight: -0.65,
    lineClear: 5.5,
    cascadeDepth: 16,
    perfectClear: 70,
    topOutRisk: -42,
    pathCost: -0.08,
    deepWells: -2.4,
    heightSpread: -0.45,
    holeDepth: -0.7,
    maxHoleDepth: -1.8,
    rowsWithHoles: -5.4,
    weightedHoles: -0.18,
});

export const COMBO_CASCADE_WEIGHTS = Object.freeze({
    accidentalTriggerPenalty: -6.5,
    cascadeChainDepthMultiplier: 38,
    cascadeLateWaveBonus: 16,
    cascadeLineScore: 1.1,
    cascadeWeightedLines: 8,
    edgePlatformBonus: 7,
    emptySideLanePenalty: -13,
    extremeCliffPenalty: -4,
    intentionalStepScore: 4.5,
    isolatedSingleClearPenalty: -16,
    noClearSetupBonus: 6,
    overdeepEmptyColumnPenalty: -18,
    sideLaneBridgePlacementBonus: 20,
    sideLaneIPayloadBonus: 14,
    sideLaneIPlacementBonus: 24,
    sideLanePlatformBonus: 7,
    sideLanePlatformPlacementBonus: 16,
    sideLanePotentialBonus: 4,
    sideLaneStopperBonus: 13,
    sideLaneStopperPlacementBonus: 14,
    sideLaneTriggerBonus: 9,
    sideLaneTriggerPlacementBonus: 40,
    staircaseMatchBonus: 5,
    staircaseAlternationPenalty: -5,
    setupGrowth: 3,
    triggerPayloadBonus: 0.55,
    triggerRowBonus: 7,
    verticalStepMatchScore: 12,
});

// Value/Reward split (Cold-Clear style): REWARD terms credit the realized outcome
// of a placement, computed from the SHIPPED Quadra formulas (garbage.js / scoring.js)
// rather than hand-guessed cascade weights, so the bot optimizes the true objective —
// total lines (depth) and outgoing garbage — instead of raw cascade count. The latent
// terms credit an UNFIRED in-progress machine by its simulated discharge.
export const REWARD_WEIGHTS = Object.freeze({
    projectedAttack: 9,
    projectedScore: 0.018,
    cleanRoute: 24,
    latentDepth: 6,
    latentAttack: 8,
    latentNoTriggerScale: 0.4,
});

export const SURVIVAL_WEIGHTS = Object.freeze({
    cascadeUnderPressureBonus: 32,
    ceilingPressure: -8.5,
    clearUnderPressureBonus: 20,
    dangerZoneCells: -4.2,
    landingHeightPressure: -2.2,
    lowSafeMargin: -12,
    noClearUnderPressurePenalty: -22,
    setupUnderPressurePenalty: -34,
    tallColumnCount: -2.8,
    triggerDangerPenalty: -14,
});

const shapeProfileCache = new Map();

function isFilled(cell) {
    return cell !== null && cell !== undefined;
}

function cellAt(boardGrid, y, x) {
    return boardGrid?.[y]?.[x] ?? null;
}

function rotateShapeRight(shape) {
    return shape[0].map((_, x) => shape.map((row) => row[x]).reverse());
}

function trimShape(shape) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] <= 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (!Number.isFinite(minX)) return [[]];

    const trimmed = [];
    for (let y = minY; y <= maxY; y++) {
        trimmed.push(shape[y].slice(minX, maxX + 1));
    }
    return trimmed;
}

function getShapeProfiles(shapeKey) {
    if (shapeProfileCache.has(shapeKey)) {
        return shapeProfileCache.get(shapeKey);
    }

    const baseShape = SHAPES[shapeKey];
    if (!baseShape) return [];

    const profiles = [];
    const seen = new Set();
    let shape = baseShape.map((row) => row.slice());

    for (let rotation = 0; rotation < 4; rotation++) {
        const trimmed = trimShape(shape);
        const width = trimmed[0]?.length || 0;
        const bottom = Array(width).fill(-Infinity);

        for (let y = 0; y < trimmed.length; y++) {
            for (let x = 0; x < width; x++) {
                if (trimmed[y][x] > 0) {
                    bottom[x] = Math.max(bottom[x], y);
                }
            }
        }

        if (width > 0 && bottom.every(Number.isFinite)) {
            const maxBottom = Math.max(...bottom);
            const profile = bottom.map((value) => maxBottom - value);
            const key = profile.join(',');
            if (!seen.has(key)) {
                seen.add(key);
                profiles.push({
                    profile,
                    rotation,
                    width,
                });
            }
        }

        shape = rotateShapeRight(shape);
    }

    shapeProfileCache.set(shapeKey, profiles);
    return profiles;
}

function countPayloadAbove(boardGrid, rowY, lookRows = 8) {
    const startY = Math.max(HIDDEN_ROWS, rowY - lookRows);
    let count = 0;
    for (let y = startY; y < rowY; y++) {
        for (let x = 0; x < COLS; x++) {
            if (isFilled(cellAt(boardGrid, y, x))) count++;
        }
    }
    return count;
}

function getVisibleHeight(boardHeight, hiddenRows = HIDDEN_ROWS) {
    return Math.max(1, boardHeight - hiddenRows);
}

function getDangerHeightBands(boardHeight, hiddenRows = HIDDEN_ROWS) {
    const visibleHeight = getVisibleHeight(boardHeight, hiddenRows);
    const dangerHeight = Math.max(6, Math.floor(visibleHeight * 0.7));
    const criticalHeight = Math.max(dangerHeight + 1, Math.floor(visibleHeight * 0.85));

    return {
        criticalHeight,
        dangerHeight,
        visibleHeight,
    };
}

function getPressureRatio(maxHeight, topOutRisk, bands) {
    if (topOutRisk > 0) return 1;

    const pressureSpan = Math.max(1, bands.visibleHeight - bands.dangerHeight);
    const rawPressure = Math.max(0, maxHeight - bands.dangerHeight) / pressureSpan;
    return Math.min(1, rawPressure ** 1.2);
}

function measureTriggerRows(boardGrid) {
    const boardHeight = boardGrid?.length || 0;
    const bands = getDangerHeightBands(boardHeight);
    let triggerRows = 0;
    let triggerPayloadCells = 0;
    let triggerDangerScore = 0;
    let triggerRowScore = 0;

    for (let y = HIDDEN_ROWS; y < boardHeight; y++) {
        let filled = 0;
        const missingColumns = [];

        for (let x = 0; x < COLS; x++) {
            if (isFilled(cellAt(boardGrid, y, x))) {
                filled++;
            } else {
                missingColumns.push(x);
            }
        }

        if (missingColumns.length < 1 || missingColumns.length > 2) continue;

        const payload = countPayloadAbove(boardGrid, y);
        const rowHeight = boardHeight - y;
        const isolation = missingColumns.length === 1 ? 1 : 0.45;
        const edgeFuse = missingColumns.some((column) => column === 0 || column === COLS - 1) ? 0.8 : 0;
        const rowDepth = Math.min(rowHeight, bands.dangerHeight) / Math.max(1, bands.dangerHeight);
        const highRowOverflow = Math.max(0, rowHeight - bands.dangerHeight);
        const criticalOverflow = Math.max(0, rowHeight - bands.criticalHeight);
        const safeBandScale = rowHeight <= bands.dangerHeight
            ? 1
            : Math.max(0.1, 1 - (highRowOverflow / Math.max(1, bands.visibleHeight - bands.dangerHeight)));
        const payloadFactor = Math.min(payload, 42) / 8;

        triggerRows++;
        triggerPayloadCells += payload;
        triggerDangerScore += isolation
            * (highRowOverflow + (criticalOverflow * 2))
            * (1 + Math.min(1.5, payloadFactor * 0.2));
        triggerRowScore += isolation * (
            1
            + edgeFuse
            + (rowDepth * safeBandScale)
            + payloadFactor
            + (filled / COLS)
        );
    }

    return {
        triggerDangerScore,
        triggerPayloadCells,
        triggerRows,
        triggerRowScore,
    };
}

function measureSurfaceProfileMatch(heights, nextShapeKeys = []) {
    const shapeKeys = nextShapeKeys.length > 0
        ? nextShapeKeys.slice(0, 3)
        : [];
    let bestScore = 0;

    for (const shapeKey of shapeKeys) {
        for (const { profile, width } of getShapeProfiles(shapeKey)) {
            if (width <= 0 || width > heights.length) continue;

            for (let start = 0; start <= heights.length - width; start++) {
                const segment = heights.slice(start, start + width);
                const minHeight = Math.min(...segment);
                const normalized = segment.map((height) => Math.min(4, height - minHeight));
                const diff = normalized.reduce(
                    (sum, value, index) => sum + Math.abs(value - profile[index]),
                    0,
                );
                const fit = Math.max(0, 1 - (diff / Math.max(1, width * 3)));
                const occupiedScale = Math.max(...segment) > 0 ? 1 : 0.55;
                bestScore = Math.max(bestScore, fit * width * occupiedScale);
            }
        }
    }

    return bestScore;
}

function measureStepIntent(heights) {
    let intentionalStepScore = 0;
    let extremeCliffs = 0;

    for (let x = 0; x < heights.length - 1; x++) {
        const delta = Math.abs(heights[x] - heights[x + 1]);
        if (delta >= 1 && delta <= 3) {
            intentionalStepScore += 1 + (delta * 0.35);
        } else if (delta > 6) {
            extremeCliffs += delta - 6;
        }
    }

    return {
        extremeCliffs,
        intentionalStepScore,
    };
}

function measureEdgePlatforms(heights) {
    const leftGap = heights[1] - heights[0];
    const rightGap = heights[COLS - 2] - heights[COLS - 1];
    let edgePlatformScore = 0;
    let overdeepEmptyColumns = 0;

    for (const gap of [leftGap, rightGap]) {
        if (gap >= 3 && gap <= 9) {
            edgePlatformScore += gap - 2;
        } else if (gap > 10) {
            overdeepEmptyColumns += gap - 10;
        }
    }

    for (let x = 1; x < COLS - 1; x++) {
        const supportedDepth = Math.min(heights[x - 1], heights[x + 1]) - heights[x];
        if (supportedDepth > 10) {
            overdeepEmptyColumns += supportedDepth - 10;
        }
    }

    return {
        edgePlatformScore,
        overdeepEmptyColumns,
    };
}

/**
 * Detects a homogeneous unit-step staircase surface (the S/Z cascade machine, T2).
 * A long run of consecutive +1 (or -1) column-height steps is a clean diagonal that
 * fires stage-by-stage under recursive gravity. A sign flip mid-run is the S<->Z
 * alternation that MERGES cascade stages into one wave (T3) and is penalized.
 */
function measureStaircase(heights) {
    let bestRun = 0;
    let run = 1;
    let prevSign = 0;
    let alternations = 0;

    for (let x = 0; x < heights.length - 1; x++) {
        const delta = heights[x + 1] - heights[x];
        if (Math.abs(delta) === 1) {
            const sign = Math.sign(delta);
            if (prevSign === 0 || sign === prevSign) {
                run++;
            } else {
                alternations++;
                run = 2;
            }
            prevSign = sign;
            bestRun = Math.max(bestRun, run);
        } else {
            run = 1;
            prevSign = 0;
        }
    }

    return {
        staircaseMatch: Math.max(0, bestRun - 2),
        staircaseAlternation: alternations,
    };
}

export function measureBoard(boardGrid, options = {}) {
    const cols = options.cols || COLS;
    const hiddenRows = options.hiddenRows ?? HIDDEN_ROWS;
    const boardHeight = boardGrid?.length || 0;
    const heights = Array(cols).fill(0);
    const holesByColumn = Array(cols).fill(0);

    let holes = 0;
    let rowTransitions = 0;
    let columnTransitions = 0;
    let deepWells = 0;
    let holeDepth = 0;
    let wellSums = 0;
    let maxHoleDepth = 0;
    let topOutRisk = 0;
    let weightedHoles = 0;
    const rowsWithHoles = new Set();
    const bands = getDangerHeightBands(boardHeight, hiddenRows);
    const dangerZoneRows = Math.max(1, bands.visibleHeight - bands.criticalHeight + 1);
    const dangerZoneEndY = Math.min(boardHeight, hiddenRows + dangerZoneRows);
    let dangerZoneCells = 0;

    for (let y = 0; y < Math.min(hiddenRows, boardHeight); y++) {
        for (let x = 0; x < cols; x++) {
            if (isFilled(cellAt(boardGrid, y, x))) {
                topOutRisk++;
            }
        }
    }

    for (let y = hiddenRows; y < dangerZoneEndY; y++) {
        for (let x = 0; x < cols; x++) {
            if (isFilled(cellAt(boardGrid, y, x))) {
                dangerZoneCells++;
            }
        }
    }

    for (let x = 0; x < cols; x++) {
        let seenBlock = false;
        for (let y = hiddenRows; y < boardHeight; y++) {
            const filled = isFilled(cellAt(boardGrid, y, x));
            if (filled && !seenBlock) {
                heights[x] = boardHeight - y;
                seenBlock = true;
            } else if (!filled && seenBlock) {
                const currentHoleDepth = boardHeight - y;
                holes++;
                holesByColumn[x]++;
                holeDepth += currentHoleDepth;
                maxHoleDepth = Math.max(maxHoleDepth, currentHoleDepth);
                rowsWithHoles.add(y);
                weightedHoles += y - hiddenRows + 1;
            }
        }
    }

    // Classify covered cells (now that all column heights are known) into enclosed
    // CAVITIES vs accessible OVERHANGS. A covered empty cell is an overhang when a
    // side neighbour is low enough to tuck a piece in (lateral access); otherwise it
    // is a fully-enclosed cavity. Cavities can't be filled without digging and are
    // far more damaging (Cold Clear weights enclosed cavities ~5x an overhang), while
    // overhangs are the accessible suspended cells the cascade machine relies on — so
    // they must be penalised much more gently than buried cavities.
    let cavityCells = 0;
    let overhangCells = 0;
    for (let x = 0; x < cols; x++) {
        const colTop = boardHeight - heights[x]; // row of this column's highest filled cell
        for (let y = colTop + 1; y < boardHeight; y++) {
            if (isFilled(cellAt(boardGrid, y, x))) continue;
            const cellHeight = boardHeight - y;
            const leftOpen = x > 0 && heights[x - 1] < cellHeight;
            const rightOpen = x < cols - 1 && heights[x + 1] < cellHeight;
            if (leftOpen || rightOpen) overhangCells++;
            else cavityCells++;
        }
    }

    for (let y = hiddenRows; y < boardHeight; y++) {
        let previousFilled = true;
        for (let x = 0; x < cols; x++) {
            const filled = isFilled(cellAt(boardGrid, y, x));
            if (filled !== previousFilled) rowTransitions++;
            previousFilled = filled;
        }
        if (!previousFilled) rowTransitions++;
    }

    for (let x = 0; x < cols; x++) {
        let previousFilled = true;
        for (let y = hiddenRows; y < boardHeight; y++) {
            const filled = isFilled(cellAt(boardGrid, y, x));
            if (filled !== previousFilled) columnTransitions++;
            previousFilled = filled;
        }
        if (!previousFilled) columnTransitions++;
    }

    for (let x = 0; x < cols; x++) {
        let wellDepth = 0;
        for (let y = hiddenRows; y < boardHeight; y++) {
            const filled = isFilled(cellAt(boardGrid, y, x));
            const leftFilled = x === 0 || isFilled(cellAt(boardGrid, y, x - 1));
            const rightFilled = x === cols - 1 || isFilled(cellAt(boardGrid, y, x + 1));

            if (!filled && leftFilled && rightFilled) {
                wellDepth++;
                wellSums += wellDepth;
            } else {
                if (wellDepth >= 3) deepWells++;
                wellDepth = 0;
            }
        }
        if (wellDepth >= 3) deepWells++;
    }

    let bumpiness = 0;
    for (let x = 0; x < cols - 1; x++) {
        bumpiness += Math.abs(heights[x] - heights[x + 1]);
    }

    const aggregateHeight = heights.reduce((sum, height) => sum + height, 0);
    const maxHeight = heights.reduce((max, height) => Math.max(max, height), 0);
    const minHeight = heights.reduce((min, height) => Math.min(min, height), boardHeight);
    const heightSpread = maxHeight - minHeight;
    const overDangerHeight = Math.max(0, maxHeight - bands.dangerHeight);
    const overCriticalHeight = Math.max(0, maxHeight - bands.criticalHeight);
    const tallColumnCount = heights.filter((height) => height >= bands.dangerHeight).length;
    const ceilingPressure = (overDangerHeight ** 2)
        + (overCriticalHeight ** 3)
        + (dangerZoneCells * 0.65)
        + (tallColumnCount * overDangerHeight * 0.35);
    const pressureRatio = getPressureRatio(maxHeight, topOutRisk, bands);
    const safeStackMargin = bands.visibleHeight - maxHeight;

    return {
        aggregateHeight,
        bumpiness,
        cavityCells,
        ceilingPressure,
        columnTransitions,
        criticalHeight: bands.criticalHeight,
        dangerHeight: bands.dangerHeight,
        dangerZoneCells,
        deepWells,
        heightSpread,
        heights,
        holeDepth,
        holes,
        holesByColumn,
        overhangCells,
        maxHoleDepth,
        maxHeight,
        rowTransitions,
        rowsWithHoles: rowsWithHoles.size,
        safeStackMargin,
        pressureRatio,
        tallColumnCount,
        topOutRisk,
        visibleHeight: bands.visibleHeight,
        wellSums,
        weightedHoles,
    };
}

export function analyzeCascadePreparation(boardGrid, nextShapeKeys = []) {
    const boardMetrics = measureBoard(boardGrid);
    const trigger = measureTriggerRows(boardGrid);
    const surface = measureStepIntent(boardMetrics.heights);
    const staircase = measureStaircase(boardMetrics.heights);
    const edgePlatforms = measureEdgePlatforms(boardMetrics.heights);
    const sideLane = analyzeSideCascade(boardGrid, boardMetrics, nextShapeKeys);
    const verticalStepMatch = measureSurfaceProfileMatch(boardMetrics.heights, nextShapeKeys);
    const preparationScore = trigger.triggerRowScore
        + verticalStepMatch
        + surface.intentionalStepScore
        + staircase.staircaseMatch
        + edgePlatforms.edgePlatformScore
        + sideLane.sideLanePotentialScore
        + sideLane.sideLanePlatformScore
        + sideLane.sideLaneStopperScore
        + sideLane.sideLaneTriggerScore
        + sideLane.sideLaneIPayloadScore
        - (trigger.triggerDangerScore * 1.35)
        - sideLane.emptySideLanePenalty
        - edgePlatforms.overdeepEmptyColumns
        - surface.extremeCliffs
        - (staircase.staircaseAlternation * 0.8);

    return {
        ...trigger,
        ...surface,
        ...staircase,
        ...edgePlatforms,
        ...sideLane,
        preparationScore,
        verticalStepMatch,
    };
}

export function evaluateCandidate(candidate, difficultyConfig = null, rng = Math.random) {
    const metrics = measureBoard(candidate.boardGrid);
    const nextShapeKeys = candidate.nextShapeKeys || [];
    const preparationAfter = candidate.preparationAfter
        || analyzeCascadePreparation(candidate.boardGrid, nextShapeKeys);
    const preparationBefore = candidate.preparationBefore || null;
    const landingHeight = candidate.landingHeight ?? 0;
    const erodedPieceCells = candidate.erodedPieceCells ?? 0;
    const cascadeCount = candidate.cascadeCount ?? 0;
    const totalLines = candidate.totalLines ?? 0;
    const cascadeBonus = cascadeCount > 1 ? (cascadeCount - 1) ** 2 : 0;
    const cascadeChain = Math.max(0, cascadeCount - 1);
    const comboAggression = Math.max(0, Number(difficultyConfig?.comboAggression) || 1);
    const survivalInstinct = Math.max(0, Number(difficultyConfig?.survivalInstinct) || 1);
    const cleanRouteBias = Number.isFinite(Number(difficultyConfig?.cleanRouteBias))
        ? Number(difficultyConfig.cleanRouteBias)
        : 1;
    const cleanupScale = Math.max(0.45, 1 - (comboAggression * 0.35));
    // Surface cleanliness (transitions + bumpiness) should stay near full strength
    // regardless of aggression: a jagged surface manufactures the overhangs that
    // become holes. comboAggression should relax setup tolerance, NOT structural
    // surface quality.
    const surfaceScale = Math.max(0.85, cleanupScale);
    const pressureRatio = Math.min(1, metrics.pressureRatio * survivalInstinct);
    const setupRewardScale = Math.max(0.12, 1 - (pressureRatio * (0.82 + (comboAggression * 0.18))));
    const clearRewardScale = 1 + (pressureRatio * (1.1 + (survivalInstinct * 0.65)));
    const cascadeRewardScale = 1 + (pressureRatio * (0.75 + (comboAggression * 0.5)));
    const accidentalPenaltyScale = Math.max(0.35, 1 - (pressureRatio * 0.65));
    const lowMarginPenalty = Math.max(0, 4 - metrics.safeStackMargin) ** 2;
    const sideLaneAction = classifySideCascadePlacement(candidate, preparationBefore, preparationAfter);
    const setupDelta = preparationBefore
        ? preparationAfter.preparationScore - preparationBefore.preparationScore
        : 0;
    const lostPreparation = preparationBefore
        ? Math.max(0, preparationBefore.preparationScore - preparationAfter.preparationScore)
        : 0;

    // Protected-hole exemption: cells inside a CAPPED, supported side-lane are
    // intentional machine geometry, not damage. Subtract them from the generic
    // hole/well penalties so the bot stops vetoing its own cascade well.
    const protectedHoleCells = preparationAfter.protectedLaneHoleCells || 0;
    const protectedWellSums = preparationAfter.protectedLaneWellSums || 0;
    const protectedRows = preparationAfter.protectedLaneRows || 0;
    const protectedWeighted = preparationAfter.protectedLaneWeightedHoles || 0;
    const protectedDepth = preparationAfter.protectedLaneHoleDepth || 0;
    // The intentional capped well reads as a cavity (walls/support on both sides), so
    // exempt the protected lane from the (heavy) cavity penalty; the remainder are
    // genuine buried holes.
    const effectiveCavities = Math.max(0, (metrics.cavityCells || 0) - protectedHoleCells);
    const effectiveHoles = Math.max(0, metrics.holes - protectedHoleCells);
    const effectiveWellSums = Math.max(0, metrics.wellSums - protectedWellSums);
    const effectiveRowsWithHoles = Math.max(0, metrics.rowsWithHoles - protectedRows);
    const effectiveWeightedHoles = Math.max(0, metrics.weightedHoles - protectedWeighted);
    const effectiveHoleDepth = Math.max(0, metrics.holeDepth - protectedDepth);

    // REWARD (realized outcome), driven by the shipped Quadra formulas so the bot
    // optimizes total lines + outgoing garbage rather than raw cascade count.
    const perfectClear = Boolean(candidate.perfectClear);
    const projectedAttack = candidate.projectedAttack
        ?? computeProjectedAttack(totalLines, perfectClear);
    const projectedScore = totalLines > 0
        ? calculateQuadraLineScore(totalLines, 1, Math.max(1, cascadeCount), perfectClear)
        : 0;

    // LATENT (unrealized) discharge of an in-progress, unfired machine — the
    // hypothetical-trigger technique. Only meaningful when we did NOT just fire,
    // and disabled on low tiers (latentChainEval === false) for believability/cost.
    const latentEnabled = difficultyConfig?.latentChainEval !== false;
    const latent = (latentEnabled && totalLines === 0)
        ? (candidate.latentDischarge
            ?? estimateLatentDischarge(candidate.boardGrid, preparationAfter.sideLanes, nextShapeKeys))
        : null;
    const latentScale = latent && latent.hasTrigger ? 1 : REWARD_WEIGHTS.latentNoTriggerScale;

    // Anti-trap gate: a lane that LOOKS fully loaded (triggerReady) but whose
    // simulated discharge is zero is a SEALED machine — its trigger rows are
    // capped/unreachable, so dropping into the well fires nothing. Heavily discount
    // the loaded-machine rewards so the bot stops building unfireable traps and
    // prefers wells it can actually detonate (the core "score by discharge" thesis).
    const claimsTriggerReady = (preparationAfter.sideLanes || []).some((lane) => lane.triggerReady);
    const sealedMachine = Boolean(claimsTriggerReady && latent && latent.latentDepth === 0);
    const fireScale = sealedMachine ? 0.1 : 1;

    let score = 0;
    score += DELLACHERIE_WEIGHTS.landingHeight * landingHeight * (1 + (pressureRatio * 0.75));
    score += DELLACHERIE_WEIGHTS.erodedPieceCells * erodedPieceCells;
    score += DELLACHERIE_WEIGHTS.rowTransitions * metrics.rowTransitions * surfaceScale;
    score += DELLACHERIE_WEIGHTS.columnTransitions * metrics.columnTransitions * surfaceScale;
    // Strong base penalty on every non-protected covered hole, plus a surcharge on
    // fully-enclosed cavities (worst — can't be dug). The protected cascade lane is
    // already exempted above, so this hits only genuine damage.
    score += CASCADE_ADAPTATION_WEIGHTS.coveredHole * effectiveHoles;
    score += CASCADE_ADAPTATION_WEIGHTS.cavityCells * effectiveCavities;
    score += DELLACHERIE_WEIGHTS.wellSums * effectiveWellSums * Math.max(0.65, cleanupScale);
    score += CASCADE_ADAPTATION_WEIGHTS.aggregateHeight * metrics.aggregateHeight;
    score += CASCADE_ADAPTATION_WEIGHTS.bumpiness * metrics.bumpiness * surfaceScale;
    score += CASCADE_ADAPTATION_WEIGHTS.maxHeight * metrics.maxHeight;
    score += CASCADE_ADAPTATION_WEIGHTS.lineClear * totalLines * clearRewardScale;
    score += CASCADE_ADAPTATION_WEIGHTS.cascadeDepth * cascadeBonus * cascadeRewardScale;
    score += CASCADE_ADAPTATION_WEIGHTS.topOutRisk * metrics.topOutRisk;
    score += CASCADE_ADAPTATION_WEIGHTS.pathCost * (candidate.pathCost ?? 0);
    score += CASCADE_ADAPTATION_WEIGHTS.deepWells * metrics.deepWells;
    score += CASCADE_ADAPTATION_WEIGHTS.heightSpread * metrics.heightSpread;
    score += CASCADE_ADAPTATION_WEIGHTS.holeDepth * effectiveHoleDepth;
    score += CASCADE_ADAPTATION_WEIGHTS.maxHoleDepth * metrics.maxHoleDepth;
    score += CASCADE_ADAPTATION_WEIGHTS.rowsWithHoles * effectiveRowsWithHoles;
    score += CASCADE_ADAPTATION_WEIGHTS.weightedHoles * effectiveWeightedHoles;
    score += SURVIVAL_WEIGHTS.ceilingPressure * metrics.ceilingPressure * survivalInstinct;
    score += SURVIVAL_WEIGHTS.dangerZoneCells * metrics.dangerZoneCells * survivalInstinct;
    score += SURVIVAL_WEIGHTS.lowSafeMargin * lowMarginPenalty * survivalInstinct;
    score += SURVIVAL_WEIGHTS.tallColumnCount * metrics.tallColumnCount * pressureRatio;
    score += SURVIVAL_WEIGHTS.landingHeightPressure * landingHeight * pressureRatio;
    score += SURVIVAL_WEIGHTS.triggerDangerPenalty * preparationAfter.triggerDangerScore * survivalInstinct;
    score += COMBO_CASCADE_WEIGHTS.cascadeLineScore * (candidate.cascadeLineScore ?? 0) * cascadeRewardScale;
    score += COMBO_CASCADE_WEIGHTS.cascadeChainDepthMultiplier * (cascadeChain ** 2) * cascadeRewardScale;
    score += COMBO_CASCADE_WEIGHTS.cascadeWeightedLines * (candidate.cascadeWeightedLines ?? 0) * cascadeRewardScale;
    score += COMBO_CASCADE_WEIGHTS.cascadeLateWaveBonus
        * Math.max(0, (candidate.maxWaveLines ?? 0) - 1)
        * cascadeChain
        * cascadeRewardScale;
    score += COMBO_CASCADE_WEIGHTS.triggerRowBonus
        * preparationAfter.triggerRowScore * setupRewardScale * fireScale;
    score += COMBO_CASCADE_WEIGHTS.triggerPayloadBonus
        * preparationAfter.triggerPayloadCells * setupRewardScale * fireScale;
    score += COMBO_CASCADE_WEIGHTS.verticalStepMatchScore * preparationAfter.verticalStepMatch * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.intentionalStepScore * preparationAfter.intentionalStepScore * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.edgePlatformBonus * preparationAfter.edgePlatformScore * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.sideLanePotentialBonus
        * preparationAfter.sideLanePotentialScore
        * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneStopperBonus
        * preparationAfter.sideLaneStopperScore
        * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneTriggerBonus
        * preparationAfter.sideLaneTriggerScore
        * setupRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneIPayloadBonus
        * preparationAfter.sideLaneIPayloadScore
        * setupRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneIPlacementBonus
        * sideLaneAction.sideLaneIPlacementScore
        * setupRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneBridgePlacementBonus
        * sideLaneAction.sideLaneBridgePlacementScore
        * setupRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.sideLaneStopperPlacementBonus
        * sideLaneAction.sideLaneStopperPlacementScore
        * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.sideLanePlatformBonus
        * (preparationAfter.sideLanePlatformScore || 0)
        * setupRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.sideLanePlatformPlacementBonus
        * (sideLaneAction.sideLanePlatformPlacementScore || 0)
        * setupRewardScale
        * fireScale;
    // The firing move (detonating a loaded machine) is scaled by cascadeRewardScale,
    // not setupRewardScale, so it stays valuable — even grows — under pressure.
    score += COMBO_CASCADE_WEIGHTS.sideLaneTriggerPlacementBonus
        * (sideLaneAction.sideLaneTriggerPlacementScore || 0)
        * cascadeRewardScale
        * fireScale;
    score += COMBO_CASCADE_WEIGHTS.staircaseMatchBonus
        * (preparationAfter.staircaseMatch || 0)
        * setupRewardScale;
    score += COMBO_CASCADE_WEIGHTS.staircaseAlternationPenalty
        * (preparationAfter.staircaseAlternation || 0);
    score += COMBO_CASCADE_WEIGHTS.emptySideLanePenalty
        * preparationAfter.emptySideLanePenalty
        * Math.max(0.45, setupRewardScale);
    score += COMBO_CASCADE_WEIGHTS.extremeCliffPenalty * preparationAfter.extremeCliffs;
    score += COMBO_CASCADE_WEIGHTS.overdeepEmptyColumnPenalty * preparationAfter.overdeepEmptyColumns;
    // Clamp setup growth so a single piece can't earn unbounded shape credit while
    // quietly accumulating holes (diminishing returns on incremental shaping).
    score += COMBO_CASCADE_WEIGHTS.setupGrowth * Math.min(4, Math.max(0, setupDelta)) * setupRewardScale;

    // REWARD: realized garbage + score from the live Quadra formulas (the true objective).
    score += REWARD_WEIGHTS.projectedAttack * projectedAttack * clearRewardScale;
    score += REWARD_WEIGHTS.projectedScore * projectedScore;
    if (perfectClear && totalLines > 0) {
        score += REWARD_WEIGHTS.cleanRoute
            * (1 + Math.min(6, totalLines))
            * clearRewardScale
            * cleanRouteBias;
    }

    // LATENT: value of an unfired, ready-to-discharge machine (gated to no-clear placements).
    if (latent) {
        score += REWARD_WEIGHTS.latentDepth * latent.latentDepth * latentScale * setupRewardScale;
        score += REWARD_WEIGHTS.latentAttack * latent.latentAttack * latentScale * setupRewardScale;
    }

    if (totalLines > 0) {
        score += SURVIVAL_WEIGHTS.clearUnderPressureBonus * pressureRatio * Math.min(4, totalLines);
    }

    if (cascadeChain > 0) {
        score += SURVIVAL_WEIGHTS.cascadeUnderPressureBonus * pressureRatio * cascadeChain;
    }

    if (totalLines === 0 && preparationAfter.triggerRows > 0) {
        score += COMBO_CASCADE_WEIGHTS.noClearSetupBonus
            * preparationAfter.triggerRows * setupRewardScale * fireScale;
        score += SURVIVAL_WEIGHTS.setupUnderPressurePenalty
            * pressureRatio
            * Math.min(4, preparationAfter.triggerRows);
    }

    if (totalLines === 0 && pressureRatio > 0) {
        score += SURVIVAL_WEIGHTS.noClearUnderPressurePenalty
            * pressureRatio
            * (1 + comboAggression);
    }

    if (totalLines > 0 && cascadeCount < 2) {
        score += COMBO_CASCADE_WEIGHTS.accidentalTriggerPenalty
            * Math.min(8, lostPreparation)
            * accidentalPenaltyScale;
        if (totalLines === 1) {
            score += COMBO_CASCADE_WEIGHTS.isolatedSingleClearPenalty * accidentalPenaltyScale;
        }
    }

    if (candidate.perfectClear) {
        score += CASCADE_ADAPTATION_WEIGHTS.perfectClear;
    }

    score = applyHeuristicNoise(score, difficultyConfig, rng);

    return {
        score,
        metrics: {
            ...metrics,
            cascadeCount,
            cascadeLineScore: candidate.cascadeLineScore ?? 0,
            cascadeWeightedLines: candidate.cascadeWeightedLines ?? 0,
            erodedPieceCells,
            landingHeight,
            maxWaveLines: candidate.maxWaveLines ?? 0,
            pathCost: candidate.pathCost ?? 0,
            perfectClear: Boolean(candidate.perfectClear),
            preparationAfter,
            preparationBefore,
            pressureRatio,
            projectedAttack,
            projectedScore,
            latentDischarge: latent,
            sideLaneAction,
            setupRewardScale,
            totalLines,
        },
    };
}

export function rankCandidates(candidates, difficultyConfig = null, rng = Math.random) {
    return candidates
        .map((candidate) => ({
            ...candidate,
            evaluation: evaluateCandidate(candidate, difficultyConfig, rng),
        }))
        .sort((a, b) => b.evaluation.score - a.evaluation.score);
}
