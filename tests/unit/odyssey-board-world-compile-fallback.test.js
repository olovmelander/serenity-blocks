import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';

/**
 * Audit 2026-10-18: a One World whose post-reveal compile failed only logged a warning, so the
 * world drew broken or not at all for chapters 2-5 with no banner. It is now given up the way
 * a failed build is, and the journey plays on without it (ADR-0022).
 */
describe('Odyssey board world compile fallback', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function createBoard(compileError) {
        const controller = new OdysseyBoardController({ clientWidth: 1280, clientHeight: 720 });
        const group = { name: 'odyssey-act2-world' };
        const world = { group, dispose: vi.fn() };
        controller.isActive = true;
        controller._compileTimings = {};
        controller.oneWorld = world;
        controller.oneWorldEnabled = true;
        controller.scene = { remove: vi.fn() };
        controller.corridorField = { fillSuppressedChapters: vi.fn() };
        controller._prewarmGroup = vi.fn(async (_group, _label, options) => {
            if (compileError && options?.rethrow) throw compileError;
        });
        controller._deferredCompileGroups = [{ label: 'one-world', group: () => controller.oneWorld?.group }];
        return { controller, world, group };
    }

    it('gives the world up, and fills its chapters with the corridor, when it cannot compile', async () => {
        const { controller, world, group } = createBoard(new Error('node build failed'));
        await controller._drainDeferredCompiles();
        expect(controller._prewarmGroup).toHaveBeenCalledWith(group, 'one-world (post-reveal)', { rethrow: true });
        expect(controller.oneWorld).toBeNull();
        expect(controller.oneWorldEnabled).toBe(false);
        expect(controller.scene.remove).toHaveBeenCalledWith(group);
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(controller.corridorField.fillSuppressedChapters).toHaveBeenCalledOnce();
    });

    it('still travels into the world\'s chapters once the world is gone', async () => {
        // The guard that waits for scenery: a chapter with neither an environment nor a world
        // must not refuse the trip, or a machine that lost the world could never reach its orbs.
        const controller = new OdysseyBoardController({ clientWidth: 1280, clientHeight: 720 });
        controller.oneWorld = null;
        controller.oneWorldEnabled = false; // given up, not still coming
        controller.environmentManager = {
            suppressedChapters: new Set([2, 3, 4, 5]),
            environments: new Map(),
            getBlendState: () => ({ activeChapter: 1 }),
        };
        controller.nodeManager = {
            setNodeSelected: vi.fn(),
            nodes: new Map([[13, { config: { chapter: 3 }, pathPosition: 0.2 }]]),
            getNodePosition: () => ({ x: 0, y: 0, z: 0 }),
        };
        const camera = {
            getCurrentPosition: () => 0.02,
            prefersReducedMotion: () => false,
            travelToPosition: vi.fn(async () => true),
            setCurrentPosition: vi.fn(),
            focusOnNode: vi.fn(async () => true),
        };
        controller.cameraController = camera;
        controller._requestGlideChapters = vi.fn(async () => {});
        controller._compileGlideChapters = vi.fn(async () => {});
        await controller.travelToLevel(13, { travelDuration: 0 });
        expect(camera.travelToPosition).toHaveBeenCalledOnce();
    });

    it('keeps a world that compiled', async () => {
        const { controller, world } = createBoard(null);
        await controller._drainDeferredCompiles();
        expect(controller.oneWorld).toBe(world);
        expect(world.dispose).not.toHaveBeenCalled();
        expect(controller.corridorField.fillSuppressedChapters).not.toHaveBeenCalled();
    });
});
