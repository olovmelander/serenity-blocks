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
 * Audit 2026-10-18: fast start leaves the chapter-7 lens post variants to their first visit,
 * so the 6-7 seam compiled them on a live frame. They now warm once the board idles after its
 * background sweep.
 */
describe('Odyssey board deferred lens warm', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function createBoard() {
        const controller = new OdysseyBoardController({ clientWidth: 1280, clientHeight: 720 });
        controller._fastStart = true;
        controller._motionWarm = false;
        controller.isActive = true;
        controller.isRenderingPaused = false;
        controller._canRunBackgroundTask = vi.fn(() => true);
        controller.postProcessingStack = { warmOutputVariants: vi.fn(async () => {}) };
        return controller;
    }

    it('warms the lens pair once, leaving the live variant for last', () => {
        const controller = createBoard();
        controller._warmDeferredLensVariants();
        controller._warmDeferredLensVariants();
        expect(controller.postProcessingStack.warmOutputVariants).toHaveBeenCalledOnce();
        expect(controller.postProcessingStack.warmOutputVariants)
            .toHaveBeenCalledWith(null, { lensStates: [true], skipActive: true });
    });

    it('waits for an idle, active board', () => {
        const controller = createBoard();
        controller.isRenderingPaused = true; // parked under an orb
        controller._warmDeferredLensVariants();
        expect(controller.postProcessingStack.warmOutputVariants).not.toHaveBeenCalled();
        controller.isRenderingPaused = false;
        controller._canRunBackgroundTask.mockReturnValueOnce(false); // a scroll is under way
        vi.advanceTimersByTime(500);
        expect(controller.postProcessingStack.warmOutputVariants).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(controller.postProcessingStack.warmOutputVariants).toHaveBeenCalledOnce();
    });

    it("keeps the travel gate's anti-softlock release until the chapter is ready", () => {
        // Audit 2026-10-18 (opt-in ?odysseyTravelGate=1): the release lasted one frame, then the
        // recomputed frontier clamped the player again for another 2.5 s.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = createBoard();
        const frontiers = [];
        const ready = new Set([1, 2, 3, 4, 5]);
        controller._travelGateEnabled = true;
        controller._frontierHoldReleaseMs = 2500;
        controller.presentationLayout = { chapterPositions: [0, 0.1, 0.2, 0.3, 0.4, 0.75, 0.87, 0.96, 1] };
        controller.environmentManager = {
            suppressedChapters: new Set(),
            environments: { get: (id) => (ready.has(id) ? { _renderWarmed: true } : null) },
        };
        controller.cameraController = {
            currentPosition: 0,
            setTravelFrontier: (frontier) => frontiers.push(frontier),
        };
        let clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        controller._updateTravelFrontier();
        const held = frontiers.at(-1);
        expect(held).toBeLessThan(1);
        controller.cameraController.currentPosition = held;
        controller._updateTravelFrontier(); // the hold starts
        clock += 2600;
        controller._updateTravelFrontier(); // ...and outlasts the grace window: released
        expect(frontiers.at(-1)).toBe(1);
        clock += 16;
        controller._updateTravelFrontier();
        expect(frontiers.at(-1)).toBe(1); // still released, not clamped again
        ready.add(6);
        controller._updateTravelFrontier();
        expect(frontiers.at(-1)).toBeGreaterThan(held); // ready: the gate moves on to the next chapter
    });

    it('leaves a full warm-up alone: it warmed the lens before the reveal', () => {
        const controller = createBoard();
        controller._fastStart = false;
        controller._warmDeferredLensVariants();
        expect(controller.postProcessingStack.warmOutputVariants).not.toHaveBeenCalled();
    });
});
