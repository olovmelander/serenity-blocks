import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    commitLayoutHistory,
    createLayoutHistory,
    getCurrentLayoutHistoryEntry,
    getLayoutHistorySnapshot,
    restoreLayoutHistoryIndex,
} from '../../src/rendering/odyssey/odyssey-layout-history.js';

function createSnapshot(seed) {
    return {
        controlPoints: [
            {
                x: seed,
                y: seed * 10,
                z: seed * -5,
            },
            {
                x: seed + 1,
                y: (seed + 1) * 10,
                z: (seed + 1) * -5,
            },
        ],
        levelPositionsById: {
            1: 0.1 + (seed * 0.01),
            2: 0.2 + (seed * 0.01),
        },
    };
}

describe('odyssey layout history', () => {
    it('creates an initial timeline entry from the current layout', () => {
        const historyState = createLayoutHistory(createSnapshot(0), {
            label: 'Initial Layout',
            detail: 'Baseline editor state.',
        });

        expect(historyState.currentIndex).toBe(0);
        expect(historyState.entries).toHaveLength(1);
        expect(historyState.entries[0]).toMatchObject({
            id: 1,
            label: 'Initial Layout',
            detail: 'Baseline editor state.',
        });
    });

    it('commits labeled entries and restores earlier states without mutating snapshots', () => {
        let historyState = createLayoutHistory(createSnapshot(0));
        historyState = commitLayoutHistory(historyState, createSnapshot(1), {
            label: 'Moved Path Point 1',
            detail: 'Dragged the first spline point.',
        });
        historyState = commitLayoutHistory(historyState, createSnapshot(2), {
            label: 'Spread All Chapters',
            detail: 'Redistributed chapter spacing.',
        });

        const restoredState = restoreLayoutHistoryIndex(historyState, 1);
        const restoredSnapshot = getLayoutHistorySnapshot(restoredState, restoredState.currentIndex);

        expect(restoredState.currentIndex).toBe(1);
        expect(getCurrentLayoutHistoryEntry(restoredState)).toMatchObject({
            label: 'Moved Path Point 1',
        });
        expect(restoredSnapshot).toEqual(createSnapshot(1));
        expect(restoredSnapshot).not.toBe(historyState.entries[1].snapshot);
    });

    it('drops redo branch entries when a new change is committed after restoring', () => {
        let historyState = createLayoutHistory(createSnapshot(0));
        historyState = commitLayoutHistory(historyState, createSnapshot(1), {
            label: 'Change A',
        });
        historyState = commitLayoutHistory(historyState, createSnapshot(2), {
            label: 'Change B',
        });

        historyState = restoreLayoutHistoryIndex(historyState, 1);
        historyState = commitLayoutHistory(historyState, createSnapshot(3), {
            label: 'Branch C',
        });

        expect(historyState.currentIndex).toBe(2);
        expect(historyState.entries).toHaveLength(3);
        expect(historyState.entries.map((entry) => entry.label)).toEqual([
            'Initial Layout',
            'Change A',
            'Branch C',
        ]);
    });
});
