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
 * world drew broken or not at all for chapters 2-5 with no banner and no fallback. It now
 * falls back the way a failed build does.
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
        controller.environmentManager = {
            suppressedChapters: new Set([2, 3, 4, 5]),
            getBlendState: vi.fn(() => ({ activeChapter: 3 })),
        };
        controller.cameraController = { getCurrentPosition: vi.fn(() => 0.2) };
        controller._requestChapterEnvironment = vi.fn(async () => true);
        controller._prewarmGroup = vi.fn(async (_group, _label, options) => {
            if (compileError && options?.rethrow) throw compileError;
        });
        controller._deferredCompileGroups = [{ label: 'one-world', group: () => controller.oneWorld?.group }];
        return { controller, world, group };
    }

    it('hands chapters 2-5 back to their dioramas when the world cannot compile', async () => {
        const { controller, world, group } = createBoard(new Error('node build failed'));
        await controller._drainDeferredCompiles();
        expect(controller._prewarmGroup).toHaveBeenCalledWith(group, 'one-world (post-reveal)', { rethrow: true });
        expect(controller.oneWorld).toBeNull();
        expect(controller.oneWorldEnabled).toBe(false);
        expect(controller.scene.remove).toHaveBeenCalledWith(group);
        expect(world.dispose).toHaveBeenCalledOnce();
        expect([...controller.environmentManager.suppressedChapters]).toEqual([]);
        expect(controller._requestChapterEnvironment).toHaveBeenCalledWith(3);
    });

    it('keeps a world that compiled', async () => {
        const { controller, world } = createBoard(null);
        await controller._drainDeferredCompiles();
        expect(controller.oneWorld).toBe(world);
        expect(world.dispose).not.toHaveBeenCalled();
        expect([...controller.environmentManager.suppressedChapters]).toEqual([2, 3, 4, 5]);
    });
});
