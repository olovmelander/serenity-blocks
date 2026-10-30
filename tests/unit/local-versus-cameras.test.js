import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { expandGridIfNeeded } from '../../src/core/infinity-grid.js';
import { LocalVersusCameras } from '../../src/ui/infinity/local-versus-cameras.js';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';

vi.mock('phaser', () => ({ default: { Game: vi.fn() } }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));

const VISIBLE = 20;

/** A Last Standing player whose well is `rows` tall, built up to `towerTop` in columns 1-9
 * (column 0 is a shaft to the floor). */
function player(rows = 84, towerTop = 40) {
    const match = new MultiPlayerState(2);
    match.setMatchConfig({ isInfinityLMS: true, infinityMaxRows: 200 });
    match.reset();
    const state = match.players[0];
    while (state.boardGrid.length < rows) expandGridIfNeeded(state, rows);
    for (let y = towerTop; y < state.boardGrid.length; y += 1) {
        for (let x = 1; x < 10; x += 1) state.boardGrid[y][x] = { type: 'T', color: '#fff' };
    }
    state.currentPiece = null;
    return state;
}

/** A board scene's camera surface: where the view is, and the call that moves it. */
function scene(top) {
    const s = {
        cameraSettings: { currentTopRow: top, visibleRows: VISIBLE, manualControl: false },
        updateCameraPosition: vi.fn((row) => { s.cameraSettings.currentTopRow = row; }),
    };
    return s;
}

/** Step one board for `ms` at `hz`, from `start` ms. Returns the time reached. */
function run(cameras, s, state, { start = 0, ms, hz = 60 }) {
    const frame = 1000 / hz;
    let now = start;
    for (; now <= start + ms; now += frame) cameras.step(0, s, state, now);
    return now;
}

const top = (s) => s.cameraSettings.currentTopRow;

describe('Last Standing play cameras', () => {
    it('rests on the floor of a young well and holds a tower\'s top a fifth of the way down', () => {
        expect(LocalVersusCameras.home(player(44, 44), VISIBLE)).toBe(24);
        expect(LocalVersusCameras.home(player(84, 40), VISIBLE)).toBe(36);
    });

    it('comes down to the tower after a clear lowered it, as well as up to it', () => {
        // The old camera only climbed: a view left above the tower stayed there.
        for (const from of [6, 60]) {
            const cameras = new LocalVersusCameras();
            const s = scene(from);
            run(cameras, s, player(), { ms: 2000 });
            expect(top(s)).toBeCloseTo(36, 1);
        }
    });

    it('moves the same at 60 and 165 Hz', () => {
        const at = (hz) => {
            const cameras = new LocalVersusCameras();
            const s = scene(6);
            run(cameras, s, player(), { ms: 300, hz });
            return top(s);
        };
        expect(Math.abs(at(60) - at(165))).toBeLessThan(0.25);
        expect(at(60)).toBeGreaterThan(6);
        expect(at(60)).toBeLessThan(36);
    });

    it('does not move again when the board is synced twice in one moment', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(6);
        const state = player();
        cameras.step(0, s, state, 0);
        cameras.step(0, s, state, 16);
        const moved = top(s);
        cameras.step(0, s, state, 16);
        cameras.step(0, s, state, 16);
        expect(s.updateCameraPosition).toHaveBeenCalledTimes(1);
        expect(top(s)).toBe(moved);
    });

    it('goes to a piece that landed out of sight, holds on it, then comes home', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(36);
        const state = player();
        cameras.step(0, s, state, 0);
        // Hard-dropped down the shaft to the floor (rows 82-83), far below rows 36-55.
        cameras.handle('lock', 0, s, state, { y: 82, shape: [[1], [1]] });
        const now = run(cameras, s, state, { start: 16, ms: 450 }); // arrived, holding
        expect(top(s)).toBeGreaterThan(62);
        run(cameras, s, state, { start: now, ms: 2000 });
        expect(top(s)).toBeCloseTo(36, 1);
    });

    it('watches a clear out of sight until its cascade settles', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(36);
        const state = player();
        cameras.step(0, s, state, 0);
        cameras.handle('clear', 0, s, state, [80, 81]);
        const now = run(cameras, s, state, { start: 16, ms: 3000 });
        expect(top(s)).toBeGreaterThan(62);
        cameras.handle('settled', 0, s, state);
        run(cameras, s, state, { start: now, ms: 2000 });
        expect(top(s)).toBeCloseTo(36, 1);
    });

    it('lets the player end a beat by moving the next piece', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(36);
        const state = player();
        state.currentPiece = {
            x: 4, y: 30, rotation: 0, shape: [[1, 1], [1, 1]],
        };
        cameras.step(0, s, state, 0);
        cameras.handle('lock', 0, s, state, { y: 82, shape: [[1], [1]] });
        run(cameras, s, state, { start: 16, ms: 100 });
        expect(cameras.boards[0].camera.beat?.kind).toBe('landing');
        state.currentPiece.x += 1;
        cameras.step(0, s, state, 133);
        expect(cameras.boards[0].camera.beat).toBe(null);
        // A hard drop counts as input too.
        cameras.handle('lock', 0, s, state, { y: 82, shape: [[1], [1]] });
        cameras.handle('input', 0, s, state);
        expect(cameras.boards[0].camera.beat).toBe(null);
    });

    it('does not take the next spawn for input, even when the pool hands back the same piece', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(36);
        const state = player();
        const piece = {
            x: 0, y: 30, rotation: 1, shape: [[1], [1], [1], [1]],
        };
        state.currentPiece = piece;
        state.piecesPlaced = 7;
        cameras.step(0, s, state, 0);
        // It locks out of sight; the next spawn reuses the object at the spawn column.
        cameras.handle('lock', 0, s, state, { y: 80, shape: piece.shape });
        Object.assign(piece, { x: 4, y: 34, rotation: 0 });
        state.piecesPlaced = 8;
        cameras.step(0, s, state, 16);
        expect(cameras.boards[0].camera.beat?.kind).toBe('landing');
        run(cameras, s, state, { start: 32, ms: 450 }); // arrived, holding: the respawn did not end the beat
        expect(top(s)).toBeGreaterThan(62);
    });

    it('moves a held beat down with rows added above the board', () => {
        const cameras = new LocalVersusCameras();
        const s = scene(36);
        const state = player();
        cameras.handle('lock', 0, s, state, { y: 82, shape: [[1], [1]] });
        const before = cameras.boards[0].camera.beat.top;
        cameras.shift(0, 10);
        expect(cameras.boards[0].camera.beat.top).toBe(before + 10);
        cameras.shift(3, 10); // a board with no camera yet: nothing to move
    });

    it('cuts a long trip with reduced motion', () => {
        const cameras = new LocalVersusCameras({ reducedMotion: () => true });
        const s = scene(0);
        const state = player();
        cameras.step(0, s, state, 0);
        cameras.step(0, s, state, 16);
        expect(top(s)).toBe(36);
    });

    it('leaves a view held by hand alone, and ignores boards outside Infinity', () => {
        const cameras = new LocalVersusCameras();
        const held = scene(6);
        held.cameraSettings.manualControl = true;
        run(cameras, held, player(), { ms: 500 });
        expect(held.updateCameraPosition).not.toHaveBeenCalled();
        const standard = scene(6);
        run(cameras, standard, { ...player(), isInfinityMode: false }, { ms: 500 });
        expect(standard.updateCameraPosition).not.toHaveBeenCalled();
    });
});

describe('Last Standing boards use the play camera', () => {
    let now;
    beforeEach(() => {
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    function mode(states) {
        const m = Object.create(LocalMultiplayerMode.prototype);
        const scenes = states.map(() => ({ ...scene(6), syncFromGameState: vi.fn() }));
        Object.assign(m, {
            multiplayerState: { players: states, numPlayers: states.length },
            matchConfig: { isInfinityLMS: true },
            boardScenes: scenes,
            deps: {},
        });
        return { m, scenes };
    }

    it('steps every board once a moment, however many times the boards are synced', () => {
        const { m, scenes } = mode([player(), player(84, 60)]);
        m._syncBoardScenes();
        now += 16;
        m._syncBoardScenes();
        m._syncBoardScenes();
        m._syncBoardScenes();
        scenes.forEach((s) => expect(s.updateCameraPosition).toHaveBeenCalledTimes(1));
        for (let i = 0; i < 200; i += 1) {
            now += 16;
            m._syncBoardScenes();
        }
        expect(top(scenes[0])).toBeCloseTo(36, 1);
        expect(top(scenes[1])).toBeCloseTo(56, 1);
    });

    it('routes the physics callbacks\' beats to the right board, and only in Infinity', () => {
        const { m, scenes } = mode([player(), player()]);
        m._infinityCameraEvent(1, 'lock', { y: 82, shape: [[1], [1]] });
        expect(m._versusCameras().boards[1].camera.beat?.kind).toBe('landing');
        expect(m._versusCameras().boards[0]?.camera.beat ?? null).toBe(null);
        m.matchConfig.isInfinityLMS = false;
        m._infinityCameraEvent(0, 'lock', { y: 82, shape: [[1], [1]] });
        expect(m._versusCameras().boards[0]?.camera.beat ?? null).toBe(null);
        expect(scenes[0].updateCameraPosition).not.toHaveBeenCalled();
    });
});
