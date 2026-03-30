function normalizeControlPoints(layout) {
    return Array.isArray(layout?.controlPoints) ? layout.controlPoints : [];
}

function normalizeLevelPositions(layout) {
    return layout?.levelPositionsById || {};
}

export function cloneLayoutSnapshot(layout) {
    return {
        controlPoints: normalizeControlPoints(layout).map((point) => ({ ...point })),
        levelPositionsById: { ...normalizeLevelPositions(layout) },
    };
}

export function areLayoutSnapshotsEqual(left, right) {
    const leftControlPoints = normalizeControlPoints(left);
    const rightControlPoints = normalizeControlPoints(right);
    if (leftControlPoints.length !== rightControlPoints.length) {
        return false;
    }

    for (let index = 0; index < leftControlPoints.length; index += 1) {
        const leftPoint = leftControlPoints[index];
        const rightPoint = rightControlPoints[index];
        if (
            leftPoint?.x !== rightPoint?.x
            || leftPoint?.y !== rightPoint?.y
            || leftPoint?.z !== rightPoint?.z
        ) {
            return false;
        }
    }

    const leftEntries = Object.entries(normalizeLevelPositions(left));
    const rightEntries = Object.entries(normalizeLevelPositions(right));
    if (leftEntries.length !== rightEntries.length) {
        return false;
    }

    return leftEntries.every(([levelId, position]) => normalizeLevelPositions(right)[levelId] === position);
}

function createHistoryEntry(snapshot, id, metadata = {}) {
    return {
        id,
        label: metadata.label || `Change ${id}`,
        detail: metadata.detail || '',
        timestamp: metadata.timestamp ?? Date.now(),
        snapshot: cloneLayoutSnapshot(snapshot),
    };
}

export function createLayoutHistory(snapshot, metadata = {}) {
    return {
        entries: [
            createHistoryEntry(snapshot, 1, {
                label: metadata.label || 'Initial Layout',
                detail: metadata.detail || '',
                timestamp: metadata.timestamp,
            }),
        ],
        currentIndex: 0,
        nextId: 2,
    };
}

export function getCurrentLayoutHistoryEntry(historyState) {
    if (!Array.isArray(historyState?.entries) || historyState.entries.length === 0) {
        return null;
    }

    const currentIndex = Number.isInteger(historyState.currentIndex)
        ? historyState.currentIndex
        : (historyState.entries.length - 1);
    return historyState.entries[currentIndex] || null;
}

export function getLayoutHistorySnapshot(historyState, index = historyState?.currentIndex ?? 0) {
    const entry = historyState?.entries?.[index] || null;
    return entry ? cloneLayoutSnapshot(entry.snapshot) : null;
}

export function commitLayoutHistory(historyState, snapshot, metadata = {}) {
    const entries = Array.isArray(historyState?.entries) ? historyState.entries : [];
    if (entries.length === 0) {
        return createLayoutHistory(snapshot, metadata);
    }

    const currentEntry = getCurrentLayoutHistoryEntry(historyState);
    if (currentEntry && areLayoutSnapshotsEqual(currentEntry.snapshot, snapshot)) {
        return historyState;
    }

    const currentIndex = Number.isInteger(historyState.currentIndex)
        ? historyState.currentIndex
        : (entries.length - 1);
    const nextEntries = entries.slice(0, currentIndex + 1);
    const entryId = Number.isFinite(historyState.nextId) ? historyState.nextId : (nextEntries.length + 1);
    nextEntries.push(createHistoryEntry(snapshot, entryId, metadata));

    return {
        entries: nextEntries,
        currentIndex: nextEntries.length - 1,
        nextId: entryId + 1,
    };
}

export function restoreLayoutHistoryIndex(historyState, index) {
    const entryCount = historyState?.entries?.length ?? 0;
    if (entryCount === 0) {
        return historyState;
    }

    const clampedIndex = Math.min(Math.max(Number(index) || 0, 0), entryCount - 1);
    if (clampedIndex === historyState.currentIndex) {
        return historyState;
    }

    return {
        ...historyState,
        currentIndex: clampedIndex,
    };
}
