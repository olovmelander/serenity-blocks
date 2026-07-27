import { describe, expect, it } from 'vitest';

import {
    KoiPondGameplayRouting,
    KOI_POND_COMBO_MILESTONES,
    KOI_POND_FX_COMMAND,
    comboMilestoneForCount,
    resolveKoiPondLockGlyph,
    resolveKoiPondLockOrigin,
} from '../../src/themes/koi-pond/koi-pond-gameplay-routing.js';
import { KOI_POND_TETROMINOS } from '../../src/themes/koi-pond/koi-pond-tetrominos.js';

function makeClock(initial = 1000) {
    let now = initial;
    const clock = () => now;
    clock.advance = (milliseconds) => {
        now += milliseconds;
    };
    clock.set = (milliseconds) => {
        now = milliseconds;
    };
    return clock;
}

function tPiece(overrides = {}) {
    return {
        shapeKey: 'T',
        x: 3,
        y: 16,
        rotation: 1,
        pieceId: 42,
        color: '#not-the-theme-color',
        shape: [
            [0, 0, 0],
            [1, 1, 1],
            [0, 1, 0],
        ],
        ...overrides,
    };
}

function comboCommands(commands) {
    return commands.filter((command) => command.type === KOI_POND_FX_COMMAND.COMBO);
}

describe('Koi Pond lock geometry', () => {
    it('extracts the exact four occupied cells and maps their visible-board centroid', () => {
        const payload = {
            piece: tPiece(),
            player: 2,
            position: { x: 640, y: 360, z: 4 },
        };
        const glyph = resolveKoiPondLockGlyph(payload);
        const origin = resolveKoiPondLockOrigin(payload);

        expect(glyph).toEqual({
            type: 'T',
            color: KOI_POND_TETROMINOS.colors.T,
            rotation: 1,
            pieceId: 42,
            width: 3,
            height: 2,
            shape: [
                [1, 1, 1],
                [0, 1, 0],
            ],
            cells: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
            ],
            boardCells: [
                { x: 3, y: 17 },
                { x: 4, y: 17 },
                { x: 5, y: 17 },
                { x: 4, y: 18 },
            ],
        });
        expect(origin.board).toEqual({ x: 4.5, y: 17.75 });
        expect(origin.normalized.x).toBeCloseTo(0.45);
        expect(origin.normalized.y).toBeCloseTo(0.6875);
        expect(origin.centered).toEqual({ x: -0.09999999999999998, y: -0.375 });
        expect(origin.sideLane.side).toBe('left');
        expect(origin.position).toEqual({ x: 640, y: 360, z: 4 });
        expect(origin.player).toBe(2);
    });

    it('falls back to one canonical four-cell glyph and Koi color for every piece type', () => {
        const expectedBounds = {
            I: [4, 1],
            O: [2, 2],
            T: [3, 2],
            S: [3, 2],
            Z: [3, 2],
            J: [3, 2],
            L: [3, 2],
        };

        Object.entries(expectedBounds).forEach(([type, [width, height]]) => {
            const glyph = resolveKoiPondLockGlyph({
                piece: {
                    type: type.toLowerCase(),
                    shape: [[1, 1]],
                    color: '#ffffff',
                },
            });
            expect(glyph.type).toBe(type);
            expect(glyph.color).toBe(KOI_POND_TETROMINOS.colors[type]);
            expect(glyph.cells).toHaveLength(4);
            expect(glyph.boardCells).toHaveLength(4);
            expect([glyph.width, glyph.height]).toEqual([width, height]);
        });
    });

    it('uses the O fallback for unknown types and clamps hidden-row origins', () => {
        const glyph = resolveKoiPondLockGlyph({
            piece: {
                type: 'unknown',
                x: 4,
                y: 0,
                shape: Array.from({ length: 10 }, () => Array(10).fill(1)),
            },
        });
        const origin = resolveKoiPondLockOrigin({
            piece: {
                type: 'O',
                x: 4,
                y: 0,
                shape: [[1, 1], [1, 1]],
            },
        });

        expect(glyph.type).toBe('O');
        expect(glyph.cells).toHaveLength(4);
        expect(glyph.color).toBe(KOI_POND_TETROMINOS.colors.O);
        expect(origin.board).toEqual({ x: 5, y: 1 });
        expect(origin.normalized.y).toBe(0);
        expect(origin.centered.y).toBe(1);
    });

    it('chooses the safe side lane from the occupied board half', () => {
        const left = resolveKoiPondLockOrigin({
            piece: {
                type: 'I',
                x: 0,
                y: 10,
                shape: [[1, 1, 1, 1]],
            },
        });
        const right = resolveKoiPondLockOrigin({
            piece: {
                type: 'I',
                x: 6,
                y: 10,
                shape: [[1, 1, 1, 1]],
            },
        });

        expect(left.sideLane.side).toBe('left');
        expect(right.sideLane.side).toBe('right');
        expect(left.sideLane.normalized.y).toBeCloseTo(right.sideLane.normalized.y);
    });

    it('uses a canonical viewport origin for scrolling-board placement', () => {
        const origin = resolveKoiPondLockOrigin({
            piece: tPiece({ x: 8, y: 140 }),
            viewportOrigin: { x: 0.2, y: 0.1 },
        });

        expect(origin.board).toEqual({ x: 9.5, y: 141.75 });
        expect(origin.normalized).toEqual({ x: 0.2, y: 0.1 });
        expect(origin.centered).toEqual({ x: -0.6, y: 0.8 });
        expect(origin.sideLane.side).toBe('left');
        expect(origin.sideLane.normalized.y).toBeCloseTo(0.244);
    });

    it('ignores malformed viewport origins and keeps fixed-board normalization', () => {
        const origin = resolveKoiPondLockOrigin({
            piece: tPiece(),
            viewportOrigin: { x: 0.2, y: Number.NaN },
        });

        expect(origin.normalized.x).toBeCloseTo(0.45);
        expect(origin.normalized.y).toBeCloseTo(0.6875);
    });
});

describe('Koi Pond combo structure', () => {
    it('exposes only the authored 2/4/7/10 structural milestones', () => {
        expect(KOI_POND_COMBO_MILESTONES).toEqual([2, 4, 7, 10]);
        expect([
            comboMilestoneForCount(0),
            comboMilestoneForCount(2),
            comboMilestoneForCount(6),
            comboMilestoneForCount(7),
            comboMilestoneForCount(99),
        ]).toEqual([null, 2, 4, 7, 10]);
    });

    it('emits each milestone once while combo counts rise monotonically', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        for (let comboCount = 1; comboCount <= 12; comboCount += 1) {
            routing.dispatch('COMBO', { comboCount, player: 1 });
            routing.dispatch('COMBO', { comboCount, player: 1 });
        }

        const commands = comboCommands(routing.drain());
        expect(commands.map((command) => command.milestone)).toEqual([2, 4, 7, 10]);
        expect(commands.map((command) => command.tier)).toEqual([1, 2, 3, 4]);
    });

    it('collapses a skipped range to its highest newly crossed structural milestone', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        routing.onCombo({ comboCount: 8 });
        routing.onCombo({ comboCount: 9 });

        expect(comboCommands(routing.drain()).map((command) => command.milestone))
            .toEqual([7]);
    });

    it('starts a fresh sequence when the count drops or a new piece locks', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        routing.onCombo({ comboCount: 7, player: 1 });
        routing.onCombo({ comboCount: 2, player: 1 });
        routing.onPieceLock({ piece: tPiece(), player: 1 });
        routing.onCombo({ comboCount: 2, player: 1 });

        expect(comboCommands(routing.drain()).map((command) => command.milestone))
            .toEqual([7, 2, 2]);
    });

    it('uses each player stream last lock origin for its combo command', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        routing.onPieceLock({
            piece: tPiece({ x: 0, pieceId: 1 }),
            player: 1,
        });
        routing.onPieceLock({
            piece: tPiece({ x: 6, pieceId: 2 }),
            player: 2,
        });
        const firstCombo = routing.onCombo({ comboCount: 2, player: 1 });
        const secondCombo = routing.onCombo({ comboCount: 2, player: 2 });

        expect(firstCombo.origin.board.x).toBe(1.5);
        expect(firstCombo.origin.sideLane.side).toBe('left');
        expect(secondCombo.origin.board.x).toBe(7.5);
        expect(secondCombo.origin.sideLane.side).toBe('right');
    });
});

describe('KoiPondGameplayRouting bounds and lifecycle', () => {
    it('uses the injected monotonic clock once per event', () => {
        const clock = makeClock(1200);
        const routing = new KoiPondGameplayRouting({ clock });

        const lock = routing.onPieceLock({ piece: tPiece() });
        clock.advance(25);
        const combo = routing.onCombo({ comboCount: 2 });
        clock.set(100);
        const regressed = routing.onPieceLock({ piece: tPiece() });

        expect(lock.issuedAtMs).toBe(1200);
        expect(combo.issuedAtMs).toBe(1225);
        expect(regressed.issuedAtMs).toBe(1225);
    });

    it('bounds the command queue and drops the oldest command', () => {
        const routing = new KoiPondGameplayRouting({
            clock: makeClock(),
            maxCommands: 2,
        });
        routing.onPieceLock({ piece: tPiece({ pieceId: 1 }) });
        routing.onPieceLock({ piece: tPiece({ pieceId: 2 }) });
        routing.onPieceLock({ piece: tPiece({ pieceId: 3 }) });

        expect(routing.getState()).toMatchObject({
            pendingCommandCount: 2,
            droppedCommandCount: 1,
        });
        expect(routing.drainCommands().map((command) => command.glyph.pieceId))
            .toEqual([2, 3]);
        expect(routing.drain()).toEqual([]);
    });

    it('bounds player state to four least-recently-used streams', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        for (let player = 0; player < 6; player += 1) {
            routing.onCombo({ comboCount: 2, player });
        }

        expect(routing.getState().streamCount).toBe(4);
    });

    it('clones payload geometry before enqueueing', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        const payload = { piece: tPiece() };
        const command = routing.onPieceLock(payload);

        payload.piece.shape[1][0] = 0;
        payload.piece.x = 9;

        expect(command.glyph.shape[0]).toEqual([1, 1, 1]);
        expect(command.origin.board.x).toBe(4.5);
    });

    it('carries reduced-motion and intensity fields without suppressing structure', () => {
        const routing = new KoiPondGameplayRouting({
            clock: makeClock(),
            reducedMotion: true,
            intensityMultiplier: 1.5,
        });
        const lock = routing.onPieceLock({ piece: tPiece() });
        const combo = routing.onCombo({ comboCount: 4 });

        expect(lock).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            durationMs: 180,
        });
        expect(lock.intensity).toBeCloseTo(0.34 * 1.5 * 0.45);
        expect(combo).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            milestone: 4,
            tier: 2,
            durationMs: 260,
        });
        expect(combo.intensity).toBeCloseTo(0.58 * 1.5 * 0.45);
    });

    it('suppresses zero-intensity work and ignores unknown dispatch names', () => {
        const routing = new KoiPondGameplayRouting({
            clock: makeClock(),
            intensityMultiplier: 0,
        });

        expect(routing.dispatch('PIECE_LOCK', { piece: tPiece() })).toBeNull();
        expect(routing.dispatch('COMBO', { comboCount: 2 })).toBeNull();
        expect(routing.dispatch('toString', {})).toBeNull();
        expect(routing.dispatch('UNKNOWN', {})).toBeNull();
        expect(routing.drain()).toEqual([]);
    });

    it('resets deterministically and disposes idempotently', () => {
        const routing = new KoiPondGameplayRouting({ clock: makeClock() });
        routing.onPieceLock({ piece: tPiece() });
        routing.onCombo({ comboCount: 4 });
        routing.reset();

        expect(routing.getState()).toEqual({
            pendingCommandCount: 0,
            droppedCommandCount: 0,
            streamCount: 0,
            reducedMotion: false,
            intensityMultiplier: 1,
            disposed: false,
        });

        routing.dispose();
        routing.dispose();
        expect(routing.getState().disposed).toBe(true);
        expect(routing.dispatch('PIECE_LOCK', { piece: tPiece() })).toBeNull();
        expect(routing.drain()).toEqual([]);

        routing.reset();
        expect(routing.onCombo({ comboCount: 2 })).not.toBeNull();
    });
});
