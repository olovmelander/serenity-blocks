import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import MoonlitForestTheme, {
    mapMoonlitOriginToWorld,
    mapMoonlitViewportPointToWorld,
} from '../../src/themes/moonlit-forest/moonlit-forest-theme.js';
import {
    MoonlitForestFXController,
    resolveMoonlitPieceLockOrigin,
} from '../../src/themes/moonlit-forest/moonlit-forest-fx-controller.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

function createRuntimeStub() {
    return {
        triggerEvent: vi.fn(),
        triggerBursts: vi.fn(),
        setReactive: vi.fn(),
    };
}

function createTheme() {
    const theme = new MoonlitForestTheme();
    theme.runtime = createRuntimeStub();
    theme.isActive = true;
    return theme;
}

function burstSummary(theme) {
    const [bursts] = theme.runtime.triggerBursts.mock.lastCall || [[]];
    return bursts.map(({ name, amount }) => ({ name, amount }));
}

describe('Moonlit Forest gameplay FX routing', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('maps the occupied lock-piece centroid and retains canonical spatial context', () => {
        const origin = resolveMoonlitPieceLockOrigin({
            piece: {
                x: 3,
                y: 17,
                shape: [
                    [1, 1, 1],
                    [0, 1, 0],
                ],
            },
            player: 2,
            position: { x: 640, y: 360, z: 12 },
        });

        expect(origin.board.x).toBeCloseTo(4.5);
        expect(origin.board.y).toBeCloseTo(17.75);
        expect(origin.normalized.x).toBeCloseTo(0.45);
        expect(origin.normalized.y).toBeCloseTo(0.6875);
        expect(origin.centered.x).toBeCloseTo(-0.1);
        expect(origin.centered.y).toBeCloseTo(-0.375);
        expect(origin.position).toEqual({ x: 640, y: 360, z: 12 });
        expect(origin.player).toBe(2);
        expect(mapMoonlitOriginToWorld(origin)).toEqual({ x: 180, z: 12 });
    });

    it('maps Serenity viewport clicks into the bounded water clearing', () => {
        expect(mapMoonlitViewportPointToWorld({ x: 500, y: 250 }, 1000, 500))
            .toEqual({ x: 0, z: -62 });
        expect(mapMoonlitViewportPointToWorld({ x: -40, y: 900 }, 1000, 500))
            .toEqual({ x: -18, z: -38 });

        vi.stubGlobal('window', {
            innerWidth: 1000,
            innerHeight: 500,
            settings: { backgroundComboEffects: true },
        });
        const theme = createTheme();
        theme.onLineClear({
            lineCount: 2,
            source: 'serenity-interaction',
            position: { x: 750, y: 125 },
        });

        expect(theme.runtime.triggerEvent).toHaveBeenCalledWith(
            'lineClear',
            expect.objectContaining({
                worldOrigin: { x: 9, z: -74 },
                intensity: 1,
            }),
        );
    });

    it('preserves the authored idle atmosphere in production reactive state', () => {
        const theme = createTheme();

        theme.applyReactiveState();

        expect(theme.runtime.setReactive).toHaveBeenCalledWith(expect.objectContaining({
            energy: 0.16,
            lockPulse: 0,
            comboPulse: 0,
        }));
    });

    it('snapshots a deterministic lock origin until the bounded queue is drained', () => {
        const controller = new MoonlitForestFXController();
        const payload = {
            piece: { x: 1, y: 18, shape: [[1, 1]] },
            player: 1,
        };

        const directives = controller.onPieceLock(payload);
        payload.piece.x = 8;

        expect(directives).toMatchObject({
            sparkleCount: 1,
            mistCount: 1,
            origin: {
                board: { x: 2, y: 18.5 },
                player: 1,
            },
        });
        expect(controller.drainParticleBursts()).toEqual([
            {
                name: 'sparkles',
                amount: 1,
                origin: directives.origin,
            },
            {
                name: 'mist',
                amount: 1,
                origin: directives.origin,
            },
        ]);
        expect(controller.drainParticleBursts()).toEqual([]);
    });

    it('drains one quality-scaled line-clear batch into the runtime', () => {
        const theme = createTheme();

        theme.onLineClear(2);

        expect(theme.runtime.triggerEvent).toHaveBeenCalledOnce();
        expect(theme.runtime.triggerEvent).toHaveBeenCalledWith(
            'lineClear',
            expect.objectContaining({ lineCount: 2 }),
        );
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
        expect(burstSummary(theme)).toEqual([
            { name: 'fireflies', amount: 6 },
            { name: 'spores', amount: 7 },
        ]);

        expect(theme.flushQueuedBursts()).toEqual([]);
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
    });

    it('drains each combo channel once instead of immediate-plus-queued duplicates', () => {
        const theme = createTheme();

        theme.onCombo(5);

        expect(theme.runtime.triggerEvent).toHaveBeenCalledOnce();
        expect(theme.runtime.triggerEvent).toHaveBeenCalledWith(
            'combo',
            expect.objectContaining({ comboCount: 5 }),
        );
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
        expect(burstSummary(theme)).toEqual([
            { name: 'wisps', amount: 9 },
            { name: 'sparkles', amount: 10 },
            { name: 'runes', amount: 8 },
            { name: 'mist', amount: 3 },
            { name: 'shootingStars', amount: 5 },
            { name: 'auroraStrength', amount: 5 },
        ]);

        expect(theme.flushQueuedBursts()).toEqual([]);
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
    });

    it('passes the event-bus lock payload and world origin through one runtime batch', () => {
        const theme = createTheme();
        const payload = {
            piece: { x: 6, y: 19, shape: [[1, 1], [1, 1]] },
            player: 3,
            position: { x: 900, y: 620 },
        };
        const boardOrigin = resolveMoonlitPieceLockOrigin(payload);
        const worldOrigin = mapMoonlitOriginToWorld(boardOrigin);

        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: true },
        });
        theme.setupEventListeners();
        eventBus.emit(EVENTS.PIECE_LOCK, payload);
        theme.clearEventUnsubscribers();

        expect(theme.runtime.triggerEvent).toHaveBeenCalledOnce();
        expect(theme.runtime.triggerEvent).toHaveBeenCalledWith('pieceLock', {
            ...payload,
            origin: worldOrigin,
            boardOrigin,
            intensity: 1,
            directives: expect.objectContaining({
                sparkleCount: 1,
                mistCount: 1,
                origin: boardOrigin,
            }),
        });
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
        expect(theme.runtime.triggerBursts).toHaveBeenCalledWith([
            expect.objectContaining({
                name: 'sparkles',
                amount: 1,
                origin: worldOrigin,
            }),
            expect.objectContaining({
                name: 'mist',
                amount: 1,
                origin: worldOrigin,
            }),
        ]);

        expect(theme.flushQueuedBursts()).toEqual([]);
        expect(theme.runtime.triggerBursts).toHaveBeenCalledOnce();
    });

    it('disposes the shared runtime before scene and renderer ownership, idempotently', () => {
        const theme = createTheme();
        const disposalOrder = [];
        const { runtime } = theme;
        runtime.dispose = vi.fn(() => disposalOrder.push('runtime'));
        theme.scene = { clear: vi.fn() };
        theme.renderer = { domElement: {} };
        vi.spyOn(theme, 'disposeThreeJSGroup').mockImplementation(() => {
            disposalOrder.push('scene');
        });
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {
            disposalOrder.push('renderer');
        });

        theme.disposeRuntime();
        theme.disposeRuntime();

        expect(disposalOrder).toEqual(['runtime', 'scene', 'renderer']);
        expect(runtime.dispose).toHaveBeenCalledOnce();
        expect(theme.runtime).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.renderer).toBeNull();
    });
});
