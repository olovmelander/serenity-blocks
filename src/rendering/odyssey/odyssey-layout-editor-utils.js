import * as THREE from 'three';
import { getOdysseyLayoutPositionEpsilon } from '../../core/odyssey/data/odyssey-layout.js';

function clonePositions(levelPositionsById = {}) {
    return Object.fromEntries(
        Object.entries(levelPositionsById)
            .filter(([levelId, position]) => Number.isFinite(Number(levelId)) && Number.isFinite(position))
            .map(([levelId, position]) => [Number(levelId), Number(position)]),
    );
}

function cloneControlPoints(controlPoints = []) {
    return controlPoints.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z),
    }));
}

export function getKeyboardNudgeStep(
    {
        altKey = false,
        shiftKey = false,
    } = {},
    options = {},
) {
    const fineStep = Number.isFinite(options?.fineStep) ? Number(options.fineStep) : 0.0005;
    const defaultStep = Number.isFinite(options?.defaultStep) ? Number(options.defaultStep) : 0.002;
    const coarseStep = Number.isFinite(options?.coarseStep) ? Number(options.coarseStep) : 0.01;

    if (shiftKey) {
        return coarseStep;
    }

    if (altKey) {
        return fineStep;
    }

    return defaultStep;
}

export function insertControlPointAfterIndex(controlPoints, index) {
    const result = cloneControlPoints(controlPoints);
    if (!Array.isArray(controlPoints) || index < 0 || index >= (controlPoints.length - 1)) {
        return result;
    }

    const startPoint = controlPoints[index];
    const endPoint = controlPoints[index + 1];
    const insertedPoint = {
        x: THREE.MathUtils.lerp(Number(startPoint.x), Number(endPoint.x), 0.5),
        y: THREE.MathUtils.lerp(Number(startPoint.y), Number(endPoint.y), 0.5),
        z: THREE.MathUtils.lerp(Number(startPoint.z), Number(endPoint.z), 0.5),
    };
    result.splice(index + 1, 0, insertedPoint);
    return result;
}

export function densifyControlPointSegments(controlPoints, insertedPointsPerSegment = 1) {
    const sourcePoints = cloneControlPoints(controlPoints);
    const stepCount = Math.max(1, Math.floor(Number(insertedPointsPerSegment)) + 1);
    if (sourcePoints.length < 2) {
        return sourcePoints;
    }

    const densified = [];
    for (let index = 0; index < (sourcePoints.length - 1); index += 1) {
        const startPoint = sourcePoints[index];
        const endPoint = sourcePoints[index + 1];
        densified.push({ ...startPoint });
        for (let stepIndex = 1; stepIndex < stepCount; stepIndex += 1) {
            const alpha = stepIndex / stepCount;
            densified.push({
                x: THREE.MathUtils.lerp(Number(startPoint.x), Number(endPoint.x), alpha),
                y: THREE.MathUtils.lerp(Number(startPoint.y), Number(endPoint.y), alpha),
                z: THREE.MathUtils.lerp(Number(startPoint.z), Number(endPoint.z), alpha),
            });
        }
    }
    densified.push({ ...sourcePoints[sourcePoints.length - 1] });

    return densified;
}

export function subdivideControlPointSegments(controlPoints) {
    return densifyControlPointSegments(controlPoints, 1);
}

export function clampLevelPositionBetweenNeighbors(
    requestedPosition,
    previousPosition,
    nextPosition,
    epsilon = getOdysseyLayoutPositionEpsilon(),
) {
    const min = Number.isFinite(previousPosition)
        ? previousPosition + epsilon
        : 0;
    const max = Number.isFinite(nextPosition)
        ? nextPosition - epsilon
        : 1;

    return THREE.MathUtils.clamp(requestedPosition, min, max);
}

export function moveLevelAlongPath(
    levelPositionsById,
    orderedLevelIds,
    levelId,
    requestedPosition,
    epsilon = getOdysseyLayoutPositionEpsilon(),
) {
    const result = clonePositions(levelPositionsById);
    const levelIndex = orderedLevelIds.indexOf(levelId);
    if (levelIndex === -1) {
        return result;
    }

    const previousLevelId = orderedLevelIds[levelIndex - 1];
    const nextLevelId = orderedLevelIds[levelIndex + 1];
    const previousPosition = Number(previousLevelId ? result[previousLevelId] : Number.NaN);
    const nextPosition = Number(nextLevelId ? result[nextLevelId] : Number.NaN);

    result[levelId] = clampLevelPositionBetweenNeighbors(
        requestedPosition,
        previousPosition,
        nextPosition,
        epsilon,
    );

    return result;
}

function getOrderedChapterLevelIds(chapterRange, orderedLevelIds, levelIndexById) {
    if (!chapterRange) {
        return [];
    }

    const startIndex = levelIndexById.get(chapterRange.startLevelId);
    const endIndex = levelIndexById.get(chapterRange.endLevelId);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
        return [];
    }

    return orderedLevelIds.slice(startIndex, endIndex + 1);
}

function getControlPointProgressData(controlPoints = []) {
    if (!Array.isArray(controlPoints) || controlPoints.length === 0) {
        return {
            totalLength: 0,
            cumulativeLengths: [],
            normalizedPositions: [],
        };
    }

    const cumulativeLengths = [0];
    let totalLength = 0;
    for (let index = 1; index < controlPoints.length; index += 1) {
        const previousPoint = controlPoints[index - 1];
        const point = controlPoints[index];
        const dx = Number(point.x) - Number(previousPoint.x);
        const dy = Number(point.y) - Number(previousPoint.y);
        const dz = Number(point.z) - Number(previousPoint.z);
        totalLength += Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
        cumulativeLengths.push(totalLength);
    }

    const normalizedPositions = totalLength > Number.EPSILON
        ? cumulativeLengths.map((length) => length / totalLength)
        : controlPoints.map((point, index) => (
            controlPoints.length === 1 ? 0 : index / (controlPoints.length - 1)
        ));

    return {
        totalLength,
        cumulativeLengths,
        normalizedPositions,
    };
}

function samplePointOnControlPolyline(controlPoints, progress) {
    if (!Array.isArray(controlPoints) || controlPoints.length === 0) {
        return { x: 0, y: 0, z: 0 };
    }

    if (controlPoints.length === 1) {
        return { ...controlPoints[0] };
    }

    const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1);
    const { normalizedPositions } = getControlPointProgressData(controlPoints);
    for (let index = 1; index < controlPoints.length; index += 1) {
        const leftProgress = normalizedPositions[index - 1];
        const rightProgress = normalizedPositions[index];
        if (clampedProgress > rightProgress && index < (controlPoints.length - 1)) {
            continue;
        }

        const segmentSpan = Math.max(rightProgress - leftProgress, Number.EPSILON);
        const alpha = THREE.MathUtils.clamp(
            (clampedProgress - leftProgress) / segmentSpan,
            0,
            1,
        );
        const leftPoint = controlPoints[index - 1];
        const rightPoint = controlPoints[index];

        return {
            x: THREE.MathUtils.lerp(Number(leftPoint.x), Number(rightPoint.x), alpha),
            y: THREE.MathUtils.lerp(Number(leftPoint.y), Number(rightPoint.y), alpha),
            z: THREE.MathUtils.lerp(Number(leftPoint.z), Number(rightPoint.z), alpha),
        };
    }

    return { ...controlPoints[controlPoints.length - 1] };
}

function getChapterMinimumSpan(
    chapterRange,
    chapterLevelIds,
    epsilon,
    minCompressionRatio,
    isTerminalChapter,
) {
    const originalSpan = Math.max(0, Number(chapterRange?.endPosition) - Number(chapterRange?.startPosition));
    const minimumGapSpan = epsilon * Math.max(
        chapterLevelIds.length - (isTerminalChapter ? 1 : 0),
        0,
    );

    return Math.max(originalSpan * minCompressionRatio, minimumGapSpan);
}

function scalePositionsBetweenAnchors(
    result,
    sourcePositions,
    levelIds,
    sourceStart,
    sourceEnd,
    targetStart,
    targetEnd,
) {
    if (!Array.isArray(levelIds) || levelIds.length === 0) {
        return;
    }

    const sourceSpan = sourceEnd - sourceStart;
    const targetSpan = targetEnd - targetStart;

    if (Math.abs(sourceSpan) <= Number.EPSILON) {
        levelIds.forEach((levelId) => {
            result[levelId] = targetStart;
        });
        return;
    }

    levelIds.forEach((levelId) => {
        const sourcePosition = Number(sourcePositions[levelId]);
        const alpha = (sourcePosition - sourceStart) / sourceSpan;
        result[levelId] = targetStart + (alpha * targetSpan);
    });
}

function createBoundaryDiagnostics({
    chapterId,
    requestedStartPosition,
    resolvedBoundaryPosition,
    compressionUsed = false,
    compressedChapterId = null,
    compressionRatio = 1,
    tailRetimeUsed = false,
    tailDirection = null,
    boundaryFixed = false,
}) {
    return {
        chapterId,
        requestedStartPosition,
        resolvedBoundaryPosition,
        exactRequested: Math.abs(requestedStartPosition - resolvedBoundaryPosition) <= 1e-9,
        compressionUsed,
        compressedChapterId,
        compressionRatio,
        tailRetimeUsed,
        tailDirection,
        boundaryFixed,
    };
}

export function retimeChapterBoundary(
    levelPositionsById,
    orderedLevelIds,
    chapterRanges,
    chapterId,
    requestedStartPosition,
    options = {},
) {
    const epsilon = Number.isFinite(options?.epsilon)
        ? Number(options.epsilon)
        : getOdysseyLayoutPositionEpsilon();
    const minCompressionRatio = Number.isFinite(options?.minCompressionRatio)
        ? Number(options.minCompressionRatio)
        : 0.35;
    const result = clonePositions(levelPositionsById);
    const levelIndexById = new Map(orderedLevelIds.map((levelId, index) => [levelId, index]));
    const chapterRangeIndex = Array.isArray(chapterRanges)
        ? chapterRanges.findIndex((range) => range.chapterId === chapterId)
        : -1;
    const currentRange = chapterRangeIndex >= 0 ? chapterRanges[chapterRangeIndex] : null;

    if (!currentRange) {
        return {
            levelPositionsById: result,
            resolvedBoundaryPosition: Number.NaN,
            diagnostics: createBoundaryDiagnostics({
                chapterId,
                requestedStartPosition,
                resolvedBoundaryPosition: Number.NaN,
            }),
        };
    }

    const currentStart = Number(result[currentRange.startLevelId]);
    if (chapterRangeIndex <= 0) {
        return {
            levelPositionsById: result,
            resolvedBoundaryPosition: currentStart,
            diagnostics: createBoundaryDiagnostics({
                chapterId,
                requestedStartPosition,
                resolvedBoundaryPosition: currentStart,
                boundaryFixed: true,
            }),
        };
    }

    const previousRange = chapterRanges[chapterRangeIndex - 1];
    const previousStartIndex = levelIndexById.get(previousRange.startLevelId);
    const previousEndIndex = levelIndexById.get(previousRange.endLevelId);
    const currentStartIndex = levelIndexById.get(currentRange.startLevelId);
    const currentEndIndex = levelIndexById.get(currentRange.endLevelId);

    if (
        !Number.isInteger(previousStartIndex)
        || !Number.isInteger(previousEndIndex)
        || !Number.isInteger(currentStartIndex)
        || !Number.isInteger(currentEndIndex)
    ) {
        return {
            levelPositionsById: result,
            resolvedBoundaryPosition: currentStart,
            diagnostics: createBoundaryDiagnostics({
                chapterId,
                requestedStartPosition,
                resolvedBoundaryPosition: currentStart,
            }),
        };
    }

    const previousChapterLevelIds = getOrderedChapterLevelIds(previousRange, orderedLevelIds, levelIndexById);
    const currentChapterLevelIds = getOrderedChapterLevelIds(currentRange, orderedLevelIds, levelIndexById);
    const isCurrentTerminalChapter = chapterRangeIndex === (chapterRanges.length - 1);
    const previousMinimumSpan = getChapterMinimumSpan(
        previousRange,
        previousChapterLevelIds,
        epsilon,
        minCompressionRatio,
        false,
    );
    const currentMinimumSpan = getChapterMinimumSpan(
        currentRange,
        currentChapterLevelIds,
        epsilon,
        minCompressionRatio,
        isCurrentTerminalChapter,
    );

    const levelsBeforePreviousChapter = previousStartIndex;
    const downstreamLevelCount = orderedLevelIds.length - currentEndIndex - 1;
    const minimumBoundaryPosition = (levelsBeforePreviousChapter * epsilon) + previousMinimumSpan;
    const maximumBoundaryPosition = 1 - (
        currentMinimumSpan
        + (Math.max(downstreamLevelCount - 1, 0) * epsilon)
    );
    const resolvedBoundaryPosition = THREE.MathUtils.clamp(
        requestedStartPosition,
        minimumBoundaryPosition,
        maximumBoundaryPosition,
    );

    if (Math.abs(resolvedBoundaryPosition - currentStart) <= 1e-9) {
        return {
            levelPositionsById: result,
            resolvedBoundaryPosition: currentStart,
            diagnostics: createBoundaryDiagnostics({
                chapterId,
                requestedStartPosition,
                resolvedBoundaryPosition: currentStart,
            }),
        };
    }

    if (resolvedBoundaryPosition > currentStart) {
        const currentEnd = Number(currentRange.endPosition);
        const nextCurrentEnd = Math.max(currentEnd, resolvedBoundaryPosition + currentMinimumSpan);
        scalePositionsBetweenAnchors(
            result,
            levelPositionsById,
            currentChapterLevelIds,
            currentStart,
            currentEnd,
            resolvedBoundaryPosition,
            nextCurrentEnd,
        );

        const downstreamLevelIds = orderedLevelIds.slice(currentEndIndex + 1);
        scalePositionsBetweenAnchors(
            result,
            levelPositionsById,
            downstreamLevelIds,
            currentEnd,
            1,
            nextCurrentEnd,
            1,
        );

        return {
            levelPositionsById: result,
            resolvedBoundaryPosition,
            diagnostics: createBoundaryDiagnostics({
                chapterId,
                requestedStartPosition,
                resolvedBoundaryPosition,
                compressionUsed: true,
                compressedChapterId: currentRange.chapterId,
                compressionRatio: (nextCurrentEnd - resolvedBoundaryPosition) / (currentEnd - currentStart),
                tailRetimeUsed: nextCurrentEnd > (currentEnd + 1e-9),
                tailDirection: nextCurrentEnd > (currentEnd + 1e-9) ? 'downstream' : null,
            }),
        };
    }

    const previousStart = Number(previousRange.startPosition);
    const nextPreviousStart = Math.min(previousStart, resolvedBoundaryPosition - previousMinimumSpan);
    const upstreamLevelIds = orderedLevelIds.slice(0, previousStartIndex);
    scalePositionsBetweenAnchors(
        result,
        levelPositionsById,
        upstreamLevelIds,
        0,
        previousStart,
        0,
        nextPreviousStart,
    );
    scalePositionsBetweenAnchors(
        result,
        levelPositionsById,
        previousChapterLevelIds,
        previousStart,
        currentStart,
        nextPreviousStart,
        resolvedBoundaryPosition,
    );
    result[currentRange.startLevelId] = resolvedBoundaryPosition;

    return {
        levelPositionsById: result,
        resolvedBoundaryPosition,
        diagnostics: createBoundaryDiagnostics({
            chapterId,
            requestedStartPosition,
            resolvedBoundaryPosition,
            compressionUsed: true,
            compressedChapterId: previousRange.chapterId,
            compressionRatio: (resolvedBoundaryPosition - nextPreviousStart) / (currentStart - previousStart),
            tailRetimeUsed: nextPreviousStart < (previousStart - 1e-9),
            tailDirection: nextPreviousStart < (previousStart - 1e-9) ? 'upstream' : null,
        }),
    };
}

export function spreadChapterLevelsEvenly(
    levelPositionsById,
    orderedLevelIds,
    chapterRange,
) {
    const result = clonePositions(levelPositionsById);
    const levelIndexById = new Map(orderedLevelIds.map((levelId, index) => [levelId, index]));
    const chapterLevelIds = getOrderedChapterLevelIds(chapterRange, orderedLevelIds, levelIndexById);
    if (chapterLevelIds.length === 0) {
        return result;
    }

    const start = Number(chapterRange?.startPosition);
    const end = Number(chapterRange?.endPosition);
    const chapterSpan = Math.max(0, end - start);
    const step = chapterLevelIds.length > 0
        ? chapterSpan / chapterLevelIds.length
        : 0;

    chapterLevelIds.forEach((levelId, index) => {
        result[levelId] = start + (step * index);
    });

    return result;
}

export function spreadAllChapterLevelsEvenly(
    levelPositionsById,
    orderedLevelIds,
    chapterRanges = [],
) {
    return chapterRanges.reduce(
        (nextPositions, chapterRange) => spreadChapterLevelsEvenly(
            nextPositions,
            orderedLevelIds,
            chapterRange,
        ),
        clonePositions(levelPositionsById),
    );
}

export function stretchPathControlPoints(
    controlPoints,
    anchorProgress,
    extensionRatio = 0.12,
) {
    const result = cloneControlPoints(controlPoints);
    if (result.length < 2) {
        return result;
    }

    const clampedProgress = THREE.MathUtils.clamp(anchorProgress, 0, 0.999);
    const { normalizedPositions } = getControlPointProgressData(result);
    const anchorPoint = samplePointOnControlPolyline(result, clampedProgress);
    const stretchAmount = Math.max(Number(extensionRatio) || 0, 0);

    result.forEach((point, index) => {
        const controlProgress = normalizedPositions[index];
        if (controlProgress <= clampedProgress) {
            return;
        }

        const blend = THREE.MathUtils.clamp(
            (controlProgress - clampedProgress) / Math.max(1 - clampedProgress, Number.EPSILON),
            0,
            1,
        );
        const factor = 1 + (stretchAmount * blend);
        point.x = anchorPoint.x + ((point.x - anchorPoint.x) * factor);
        point.y = anchorPoint.y + ((point.y - anchorPoint.y) * factor);
        point.z = anchorPoint.z + ((point.z - anchorPoint.z) * factor);
    });

    return result;
}

export function appendTailControlPoint(controlPoints, distanceMultiplier = 1) {
    const result = cloneControlPoints(controlPoints);
    if (result.length === 0) {
        return [{ x: 0, y: 40, z: 0 }];
    }

    if (result.length === 1) {
        const point = result[0];
        result.push({
            x: point.x,
            y: point.y + 40,
            z: point.z,
        });
        return result;
    }

    const lastPoint = result[result.length - 1];
    const previousPoint = result[result.length - 2];
    let dx = lastPoint.x - previousPoint.x;
    let dy = lastPoint.y - previousPoint.y;
    let dz = lastPoint.z - previousPoint.z;
    const baseLength = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

    if (baseLength <= Number.EPSILON) {
        dx = 0;
        dy = 40;
        dz = 0;
    } else {
        const scale = Math.max(Number(distanceMultiplier) || 1, 0.1);
        dx *= scale;
        dy *= scale;
        dz *= scale;
    }

    result.push({
        x: lastPoint.x + dx,
        y: lastPoint.y + dy,
        z: lastPoint.z + dz,
    });

    return result;
}
