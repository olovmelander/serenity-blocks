import { COLS, HIDDEN_ROWS } from '../constants.js';

function isFilled(cell) {
    return cell !== null && cell !== undefined;
}

function cellAt(boardGrid, y, x) {
    return boardGrid?.[y]?.[x] ?? null;
}

function getCellType(cell) {
    return cell?.type || cell?.shapeKey || cell?.color || null;
}

function getCellId(cell, x, y) {
    if (cell?.id !== undefined && cell?.id !== null) return cell.id;
    return `cell:${x}:${y}`;
}

function getSideColumns(side) {
    const edgeColumn = side === 'left' ? 0 : COLS - 1;
    const direction = side === 'left' ? 1 : -1;
    const innerColumns = [];

    for (let index = 1; index <= 3; index++) {
        const column = edgeColumn + direction * index;
        if (column >= 0 && column < COLS) {
            innerColumns.push(column);
        }
    }

    return {
        direction,
        edgeColumn,
        innerColumns,
    };
}

function getPlacementCells(candidate) {
    if (Array.isArray(candidate?.pieceCells) && candidate.pieceCells.length > 0) {
        return candidate.pieceCells.map((pieceCell) => ({
            x: pieceCell.x,
            y: pieceCell.y,
        }));
    }

    const cells = [];
    const shape = candidate?.shape || [];
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] <= 0) continue;
            cells.push({
                x: candidate.x + x,
                y: candidate.y + y,
            });
        }
    }
    return cells;
}

function getOpenDepthAndCap(boardGrid, edgeColumn) {
    let openDepth = 0;
    let capY = null;
    const bottom = (boardGrid?.length || 0) - 1;

    for (let y = bottom; y >= HIDDEN_ROWS; y--) {
        if (isFilled(cellAt(boardGrid, y, edgeColumn))) {
            capY = y;
            break;
        }
        openDepth++;
    }

    return {
        capY,
        openDepth,
    };
}

function countFilledInRow(boardGrid, y) {
    let filled = 0;
    for (let x = 0; x < COLS; x++) {
        if (isFilled(cellAt(boardGrid, y, x))) filled++;
    }
    return filled;
}

function countProtectedWeightedHoles(boardGrid, edgeColumn, capY) {
    if (capY === null) {
        return {
            protectedLaneHoleCells: 0,
            protectedLaneHoleDepth: 0,
            protectedLaneRows: 0,
            protectedLaneWeightedHoles: 0,
            protectedLaneWellSums: 0,
        };
    }

    let protectedLaneHoleCells = 0;
    let protectedLaneHoleDepth = 0;
    let protectedLaneWeightedHoles = 0;
    let protectedLaneWellSums = 0;
    let wellDepth = 0;
    const protectedRows = new Set();

    for (let y = capY + 1; y < (boardGrid?.length || 0); y++) {
        if (isFilled(cellAt(boardGrid, y, edgeColumn))) {
            wellDepth = 0;
            continue;
        }

        const leftFilled = edgeColumn === 0 || isFilled(cellAt(boardGrid, y, edgeColumn - 1));
        const rightFilled = edgeColumn === COLS - 1 || isFilled(cellAt(boardGrid, y, edgeColumn + 1));
        const currentHoleDepth = boardGrid.length - y;

        protectedLaneHoleCells++;
        protectedLaneHoleDepth += currentHoleDepth;
        protectedLaneWeightedHoles += y - HIDDEN_ROWS + 1;
        protectedRows.add(y);

        if (leftFilled && rightFilled) {
            wellDepth++;
            protectedLaneWellSums += wellDepth;
        } else {
            wellDepth = 0;
        }
    }

    return {
        protectedLaneHoleCells,
        protectedLaneHoleDepth,
        protectedLaneRows: protectedRows.size,
        protectedLaneWeightedHoles,
        protectedLaneWellSums,
    };
}

function measureSupport(boardGrid, capY, edgeColumn, innerColumns) {
    if (capY === null) {
        return {
            capCell: null,
            capSupported: false,
            platformWidth: 0,
            sameRowInnerCells: 0,
            supportedInnerCells: 0,
        };
    }

    const capCell = cellAt(boardGrid, capY, edgeColumn);
    let platformWidth = isFilled(capCell) ? 1 : 0;
    let sameRowInnerCells = 0;
    let supportedInnerCells = 0;

    for (const column of innerColumns) {
        const sameRowCell = cellAt(boardGrid, capY, column);
        const belowCell = cellAt(boardGrid, capY + 1, column);
        if (isFilled(sameRowCell)) {
            sameRowInnerCells++;
            platformWidth++;
        }
        if (isFilled(belowCell)) {
            supportedInnerCells++;
        }
    }

    return {
        capCell,
        capSupported: sameRowInnerCells > 0 && supportedInnerCells > 0,
        platformWidth,
        sameRowInnerCells,
        supportedInnerCells,
    };
}

function measurePayload(boardGrid, edgeColumn, capY) {
    if (capY === null) {
        return {
            iPayloadCells: 0,
            iPayloadPieces: 0,
            payloadCells: 0,
            payloadPieces: 0,
        };
    }

    const payloadIds = new Set();
    const iPayloadIds = new Set();
    let payloadCells = 0;
    let iPayloadCells = 0;

    for (let y = HIDDEN_ROWS; y <= capY; y++) {
        const cell = cellAt(boardGrid, y, edgeColumn);
        if (!isFilled(cell)) continue;

        payloadCells++;
        payloadIds.add(getCellId(cell, edgeColumn, y));

        if (getCellType(cell) === 'I') {
            iPayloadCells++;
            iPayloadIds.add(getCellId(cell, edgeColumn, y));
        }
    }

    return {
        iPayloadCells,
        iPayloadPieces: iPayloadIds.size,
        payloadCells,
        payloadPieces: payloadIds.size,
    };
}

function measureTriggerRows(boardGrid, edgeColumn, capY, openDepth) {
    const endY = capY === null ? boardGrid?.length || 0 : Math.min(boardGrid.length, capY + openDepth + 1);
    let triggerRows = 0;
    let triggerScore = 0;

    for (let y = capY === null ? HIDDEN_ROWS : capY + 1; y < endY; y++) {
        const filled = countFilledInRow(boardGrid, y);
        const edgeEmpty = !isFilled(cellAt(boardGrid, y, edgeColumn));
        const missing = COLS - filled;

        if (!edgeEmpty || missing < 1 || missing > 3) continue;

        const rowHeight = boardGrid.length - y;
        const rowDepthScale = Math.min(rowHeight, 12) / 12;
        triggerRows++;
        triggerScore += 1 + rowDepthScale + Math.max(0, 3 - missing) * 0.8;
    }

    return {
        triggerRows,
        triggerScore,
    };
}

function measureLane(boardGrid, boardMetrics, nextShapeKeys, side) {
    const { edgeColumn, innerColumns } = getSideColumns(side);
    const hasUpcomingI = nextShapeKeys.includes('I');
    const { capY, openDepth } = getOpenDepthAndCap(boardGrid, edgeColumn);
    const support = measureSupport(boardGrid, capY, edgeColumn, innerColumns);
    const payload = measurePayload(boardGrid, edgeColumn, capY);
    const trigger = measureTriggerRows(boardGrid, edgeColumn, capY, openDepth);
    const protectedHoles = support.capSupported
        ? countProtectedWeightedHoles(boardGrid, edgeColumn, capY)
        : countProtectedWeightedHoles(null, edgeColumn, null);
    const supportHeight = Math.max(...innerColumns.map((column) => boardMetrics.heights[column] || 0), 0);
    const laneHeight = boardMetrics.heights[edgeColumn] || 0;
    const capHeight = capY === null ? 0 : boardGrid.length - capY;
    const nakedDepth = capY === null ? Math.min(16, supportHeight) : 0;
    const safeScale = boardMetrics.maxHeight <= boardMetrics.dangerHeight
        ? 1
        : Math.max(0.2, 1 - (boardMetrics.pressureRatio * 0.75));
    const iQueueScale = hasUpcomingI ? 1.35 : 1;
    const needsPlatform = capY === null && supportHeight >= 4;
    const platformReady = support.capSupported && openDepth >= 2;
    const payloadLoaded = platformReady && (payload.iPayloadCells >= 4 || payload.iPayloadPieces > 0);
    const triggerReady = payloadLoaded && trigger.triggerRows > 0;
    // Effective well depth is measured relative to the surrounding stack, not the
    // raw empty run to the floor: an empty edge column beside a 3-high stack is a
    // 3-deep well, not a 20-deep one. Without this, every board with an open edge
    // column would be flagged unsafe.
    const effectiveWellDepth = capY === null ? supportHeight : openDepth;
    const unsafe = effectiveWellDepth > 10 || capHeight >= boardMetrics.dangerHeight;
    const sideLanePotentialScore = needsPlatform
        ? Math.min(8, supportHeight) * 0.42 * safeScale * iQueueScale
        : 0;
    const sideLanePlatformScore = platformReady
        ? (
            1.8
            + Math.min(10, openDepth) * 0.55
            + support.platformWidth * 0.55
            + (getCellType(support.capCell) === 'I' ? 1.4 : 0)
        ) * safeScale
        : 0;
    const sideLaneIPayloadScore = payloadLoaded
        ? (
            payload.iPayloadCells * 1.9
            + payload.iPayloadPieces * 2.5
            + Math.min(10, openDepth) * 0.45
        ) * safeScale
        : 0;
    const stopperFallback = laneHeight > 0 && laneHeight <= 4 && supportHeight - laneHeight >= 3
        ? (1.4 + Math.min(8, supportHeight - laneHeight) * 0.45) * iQueueScale
        : 0;
    const sideLaneStopperScore = platformReady ? sideLanePlatformScore : stopperFallback;
    const sideLaneTriggerScore = trigger.triggerScore * (payloadLoaded ? 1.7 : 0.65) * safeScale;
    const emptyLanePenalty = needsPlatform
        ? Math.max(0, Math.min(12, nakedDepth - 2)) * (hasUpcomingI ? 0.75 : 1)
        : 0;
    const overdeepPenalty = platformReady && openDepth > 10
        ? (openDepth - 10) * 1.5
        : 0;

    return {
        capHeight,
        capSupported: support.capSupported,
        capY,
        edgeColumn,
        emptyLanePenalty: emptyLanePenalty + overdeepPenalty,
        iPayloadCells: payload.iPayloadCells,
        iPayloadPieces: payload.iPayloadPieces,
        laneHeight,
        needsPlatform,
        openDepth,
        payloadCells: payload.payloadCells,
        payloadLoaded,
        platformReady,
        platformWidth: support.platformWidth,
        protectedLaneHoleCells: protectedHoles.protectedLaneHoleCells,
        protectedLaneHoleDepth: protectedHoles.protectedLaneHoleDepth,
        protectedLaneRows: protectedHoles.protectedLaneRows,
        protectedLaneWeightedHoles: protectedHoles.protectedLaneWeightedHoles,
        protectedLaneWellSums: protectedHoles.protectedLaneWellSums,
        side,
        sideLaneIPayloadScore,
        sideLanePlatformScore,
        sideLanePotentialScore,
        sideLaneStopperScore,
        sideLaneTriggerScore,
        stopperReady: platformReady || (laneHeight > 0 && laneHeight <= 4 && supportHeight - laneHeight >= 3),
        supportHeight,
        triggerReady,
        triggerRows: trigger.triggerRows,
        triggerScore: trigger.triggerScore,
        unsafe,
    };
}

function sumLanes(lanes, key) {
    return lanes.reduce((sum, lane) => sum + (lane[key] || 0), 0);
}

export function analyzeSideCascade(boardGrid, boardMetrics, nextShapeKeys = []) {
    const sideLanes = [
        measureLane(boardGrid, boardMetrics, nextShapeKeys, 'left'),
        measureLane(boardGrid, boardMetrics, nextShapeKeys, 'right'),
    ];
    const emptySideLanePenalty = sumLanes(sideLanes, 'emptyLanePenalty');
    const sideLanePotentialScore = sumLanes(sideLanes, 'sideLanePotentialScore');
    const sideLanePlatformScore = sumLanes(sideLanes, 'sideLanePlatformScore');
    const sideLaneStopperScore = sumLanes(sideLanes, 'sideLaneStopperScore');
    const sideLaneIPayloadScore = sumLanes(sideLanes, 'sideLaneIPayloadScore');
    const sideLaneTriggerScore = sumLanes(sideLanes, 'sideLaneTriggerScore');
    const protectedLaneHoleCells = sumLanes(sideLanes, 'protectedLaneHoleCells');
    const protectedLaneHoleDepth = sumLanes(sideLanes, 'protectedLaneHoleDepth');
    const protectedLaneRows = sumLanes(sideLanes, 'protectedLaneRows');
    const protectedLaneWeightedHoles = sumLanes(sideLanes, 'protectedLaneWeightedHoles');
    const protectedLaneWellSums = sumLanes(sideLanes, 'protectedLaneWellSums');

    return {
        emptySideLanePenalty,
        protectedLaneHoleCells,
        protectedLaneHoleDepth,
        protectedLaneRows,
        protectedLaneWeightedHoles,
        protectedLaneWellSums,
        sideLaneIPayloadScore,
        sideLanePlatformScore,
        sideLanePotentialScore,
        sideLanes,
        sideLaneStopperScore,
        sideLaneTriggerRows: sumLanes(sideLanes, 'triggerRows'),
        sideLaneTriggerScore,
    };
}

export function classifySideCascadePlacement(candidate, preparationBefore, preparationAfter) {
    const cells = getPlacementCells(candidate);
    if (cells.length === 0) {
        return {
            sideLaneBridgePlacementScore: 0,
            sideLaneIPlacementScore: 0,
            sideLanePlatformPlacementScore: 0,
            sideLaneStopperPlacementScore: 0,
            sideLaneTriggerPlacementScore: 0,
        };
    }

    const isI = candidate?.shapeKey === 'I' || candidate?.type === 'I';
    const uniqueX = new Set(cells.map((cell) => cell.x));
    const uniqueY = new Set(cells.map((cell) => cell.y));
    const isVerticalI = isI && uniqueX.size === 1 && cells.length >= 4;
    const isHorizontalI = isI && uniqueY.size === 1 && cells.length >= 4;
    let sideLaneBridgePlacementScore = 0;
    let sideLaneIPlacementScore = 0;
    let sideLanePlatformPlacementScore = 0;
    let sideLaneStopperPlacementScore = 0;
    let sideLaneTriggerPlacementScore = 0;

    for (const beforeLane of preparationBefore?.sideLanes || []) {
        const afterLane = (preparationAfter?.sideLanes || [])
            .find((lane) => lane.edgeColumn === beforeLane.edgeColumn);
        if (!afterLane) continue;

        const placedInEdge = cells.filter((cell) => cell.x === beforeLane.edgeColumn);
        const placedNearEdge = cells.filter((cell) => Math.abs(cell.x - beforeLane.edgeColumn) <= 3);
        const laneUrgency = Math.max(1, Math.min(10, beforeLane.openDepth || beforeLane.supportHeight || 1));

        if (
            beforeLane.needsPlatform
            && afterLane.platformReady
            && placedNearEdge.length > 0
        ) {
            const platformGain = Math.max(1, afterLane.platformWidth - beforeLane.platformWidth);
            sideLanePlatformPlacementScore += 2 + platformGain + laneUrgency * 0.65;
            sideLaneStopperPlacementScore += 1 + laneUrgency * 0.35;
        }

        if (isI && afterLane.platformReady) {
            const payloadGain = Math.max(0, afterLane.iPayloadCells - beforeLane.iPayloadCells);

            if (payloadGain > 0) {
                sideLaneIPlacementScore += payloadGain * (isVerticalI ? 1.35 : 1)
                    + laneUrgency * 0.45;
            }

            if (isHorizontalI && placedInEdge.length === 1 && afterLane.platformReady) {
                sideLaneBridgePlacementScore += 2
                    + placedNearEdge.length
                    + laneUrgency * 0.65;
            }
        }

        if (
            beforeLane.payloadLoaded
            && candidate?.totalLines > 0
            && (
                afterLane.openDepth < beforeLane.openDepth
                || (candidate?.cascadeCount || 0) > 1
                || (candidate?.cascadeWeightedLines || 0) > candidate?.totalLines
            )
        ) {
            sideLaneTriggerPlacementScore += 2
                + beforeLane.iPayloadCells
                + Math.min(8, candidate.totalLines)
                + Math.max(0, (candidate.cascadeCount || 0) - 1) * 2;
        }
    }

    return {
        sideLaneBridgePlacementScore,
        sideLaneIPlacementScore,
        sideLanePlatformPlacementScore,
        sideLaneStopperPlacementScore,
        sideLaneTriggerPlacementScore,
    };
}
