import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { resolveChapterBlendState } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { resolveChapterArrivalProgress } from '../../src/rendering/odyssey/odyssey-chapter-arrival.js';
import { seamHalfWidth } from '../../src/rendering/odyssey/transitions/odyssey-seam-schedule.js';
import {
    OdysseyBoardController,
    normalizeOdysseyWheelDelta,
    shouldRouteOdysseyWheel,
} from '../../src/rendering/odyssey/OdysseyBoardController.js';

function createTarget(options = {}) {
    const attrs = { ...(options.attrs || {}) };
    if (options.wheelLock) {
        attrs['data-odyssey-wheel-lock'] = 'true';
    }

    const target = {
        parentElement: options.parent || null,
        parentNode: options.parent || null,
        dataset: options.dataset || {},
        clientHeight: options.clientHeight ?? 0,
        scrollHeight: options.scrollHeight ?? 0,
        __style: {
            overflowY: options.overflowY ?? 'visible',
            overflow: options.overflow ?? 'visible',
        },
        getAttribute(name) {
            return attrs[name] ?? null;
        },
    };

    target.closest = (selector) => {
        if (selector !== '[data-odyssey-wheel-lock="true"]') {
            return null;
        }

        let current = target;
        while (current) {
            if (typeof current.getAttribute === 'function'
                && current.getAttribute('data-odyssey-wheel-lock') === 'true') {
                return current;
            }
            current = current.parentElement || current.parentNode || null;
        }
        return null;
    };

    return target;
}

function createCanvas(rect = {
    left: 0,
    top: 0,
    right: 1280,
    bottom: 720,
    width: 1280,
    height: 720,
}) {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => rect),
        style: {},
        parentNode: {
            removeChild: vi.fn(),
        },
    };
}

function createNavigationController() {
    const controller = Object.create(OdysseyBoardController.prototype);
    const nodePosition = new THREE.Vector3(4, 10, -20);
    Object.assign(controller, {
        selectedLevelId: 5,
        selectionSequence: 0,
        nodeManager: {
            nodes: new Map([[6, { config: { chapter: 2 }, pathPosition: 0.2 }]]),
            getNodePosition: vi.fn(() => nodePosition),
            setNodeSelected: vi.fn(),
        },
        cameraController: {
            getCurrentPosition: vi.fn(() => 0.1),
            travelToPosition: vi.fn().mockResolvedValue(),
            setCurrentPosition: vi.fn(),
            setFollowMode: vi.fn(),
            focusOnNode: vi.fn().mockResolvedValue(),
        },
        environmentManager: {
            getBlendState: vi.fn(() => ({ activeChapter: 1 })),
            environments: new Map(Array.from({ length: 8 }, (_, index) => [index + 1, {
                prewarmed: true, _renderWarmed: true,
            }])),
            suppressedChapters: new Set(),
        },
        _markInteraction: vi.fn(),
        _requestChapterEnvironment: vi.fn().mockResolvedValue(),
        computeTravelDuration: vi.fn(() => 2400),
        onLevelSelect: vi.fn(),
    });
    return { controller, nodePosition };
}

describe('OdysseyBoardController chapter framing', () => {
    const registry = new LevelRegistry();
    const layout = registry.getPresentationLayout();

    it.each([2, 3, 4, 5, 6, 7, 8])('frames chapter %i beyond its seam and selects its first orb', async (chapterId) => {
        const { controller } = createNavigationController();
        const level = registry.resolveLevelPresentation(registry.getChapterStartLevel(chapterId));
        controller.presentationLayout = layout;
        controller.selectedLevelId = level.id - 1;
        controller.nodeManager.nodes = new Map([[level.id, { config: level, pathPosition: level.pathPosition }]]);
        controller.environmentManager.getBlendState.mockReturnValue({ activeChapter: chapterId - 1 });

        const before = resolveChapterBlendState(level.pathPosition, CHAPTER_CONFIGS, layout.chapterPositions);
        expect(before.inSeam).toBe(true);
        expect(before.weights[chapterId]).toBeCloseTo(0.5);
        await expect(controller.travelToLevel(level.id, {
            chapterArrival: true, focus: false, travelDuration: 2200,
        })).resolves.toBe(true);

        const [destination] = controller.cameraController.setCurrentPosition.mock.calls[0];
        const arrival = resolveChapterBlendState(destination, CHAPTER_CONFIGS, layout.chapterPositions);
        expect(destination).toBeGreaterThan(layout.chapterPositions[chapterId - 1] + seamHalfWidth(chapterId - 1));
        expect(destination).toBeLessThan(layout.chapterPositions[chapterId]);
        expect(arrival.inSeam).toBe(false);
        expect(arrival.activeChapter).toBe(chapterId);
        expect(arrival.weights[chapterId]).toBe(1);
        expect(controller.cameraController.travelToPosition).toHaveBeenCalledWith(destination, 2200);
        expect(controller.cameraController.focusOnNode).not.toHaveBeenCalled();
        expect(controller.selectedLevelId).toBe(level.id);
        expect(controller.nodeManager.nodes.get(level.id).pathPosition).toBe(level.pathPosition);
        expect(controller.nodeManager.setNodeSelected).toHaveBeenLastCalledWith(level.id, true);
        expect(controller.onLevelSelect).toHaveBeenCalledWith(level.id, {
            chapterId, settled: true, traveled: true,
        });
    });

    it('keeps ordinary first-orb navigation at its authored position', async () => {
        const { controller } = createNavigationController();
        const level = registry.resolveLevelPresentation(6);
        controller.presentationLayout = layout;
        controller.nodeManager.nodes.get(6).pathPosition = level.pathPosition;
        await controller.travelToLevel(6);
        expect(controller.cameraController.setCurrentPosition).toHaveBeenCalledWith(level.pathPosition);
        expect(controller.cameraController.focusOnNode).toHaveBeenCalled();
    });

    it('moves beyond the seam even when its incoming chapter is already active', async () => {
        const { controller } = createNavigationController();
        const level = registry.resolveLevelPresentation(6);
        controller.presentationLayout = layout;
        controller.nodeManager.nodes.get(6).pathPosition = level.pathPosition;
        controller.cameraController.getCurrentPosition.mockReturnValue(level.pathPosition);
        controller.environmentManager.getBlendState.mockReturnValue({ activeChapter: 2 });
        await controller.travelToLevel(6, { chapterArrival: true, focus: false, travelDuration: 0 });
        const [destination] = controller.cameraController.setCurrentPosition.mock.calls[0];
        expect(destination).toBeGreaterThan(level.pathPosition + seamHalfWidth(1));
        expect(controller.cameraController.travelToPosition).toHaveBeenCalledWith(destination, 0);
        expect(controller.onLevelSelect).toHaveBeenCalledWith(6, {
            chapterId: 2, settled: true, traveled: false,
        });
    });

    it('clamps a chapter vista before its outgoing seam using the live layout', () => {
        const customPositions = [...layout.chapterPositions];
        customPositions[2] = 0.11;
        const destination = resolveChapterArrivalProgress(2, 0.109, customPositions);
        expect(destination).toBeLessThan(customPositions[2] - seamHalfWidth(2));
        expect(destination).toBeGreaterThan(customPositions[1] + seamHalfWidth(1));
        const arrival = resolveChapterBlendState(destination, CHAPTER_CONFIGS, customPositions);
        expect(arrival.inSeam).toBe(false);
        expect(arrival.weights[2]).toBe(1);
    });

    it('keeps overlapping custom seam destinations inside their chapter and tolerates missing layouts', () => {
        const overlappingPositions = [...layout.chapterPositions];
        overlappingPositions[2] = 0.07;
        expect(resolveChapterArrivalProgress(2, 0.09, overlappingPositions)).toBe(0.07);
        expect(resolveChapterArrivalProgress(2, 0.0649)).toBe(0.0649);
    });

    it('retains panoramic follow framing on chapter travel without skipping selection or arrival', async () => {
        const { controller } = createNavigationController();
        await expect(controller.travelToLevel(6, { focus: false, travelDuration: 2200 })).resolves.toBe(true);
        expect(controller._requestChapterEnvironment).toHaveBeenCalledWith(2);
        expect(controller.cameraController.travelToPosition).toHaveBeenCalledWith(0.2, 2200);
        expect(controller.cameraController.setCurrentPosition).toHaveBeenCalledWith(0.2);
        expect(controller.cameraController.focusOnNode).not.toHaveBeenCalled();
        expect(controller.nodeManager.setNodeSelected).toHaveBeenNthCalledWith(1, 5, false);
        expect(controller.nodeManager.setNodeSelected).toHaveBeenNthCalledWith(2, 6, true);
        expect(controller.onLevelSelect).toHaveBeenCalledWith(6, {
            chapterId: 2, settled: true, traveled: true,
        });
    });

    it('continues to focus the orb on ordinary map selection', async () => {
        const { controller, nodePosition } = createNavigationController();
        await expect(controller.travelToLevel(6)).resolves.toBe(true);
        expect(controller.cameraController.focusOnNode).toHaveBeenCalledWith(nodePosition, 520);
    });

    it('does not publish a panoramic arrival superseded during travel', async () => {
        const { controller } = createNavigationController();
        controller.cameraController.travelToPosition.mockImplementation(async () => {
            controller.selectionSequence += 1;
        });
        await expect(controller.travelToLevel(6, { focus: false })).resolves.toBe(false);
        expect(controller.cameraController.setCurrentPosition).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('follows the actual path within one chapter only when explicitly requested', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.getBlendState.mockReturnValue({ activeChapter: 2 });
        const isPaused = vi.fn(() => false);
        await expect(controller.travelToLevel(6, {
            pathTravel: true, focus: false, travelDuration: 1500, isPaused,
        })).resolves.toBe(true);
        expect(controller.cameraController.travelToPosition).toHaveBeenCalledWith(0.2, 1500, {
            isCurrent: expect.any(Function), isPaused,
        });
        expect(controller.cameraController.focusOnNode).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).toHaveBeenCalledWith(6, {
            chapterId: 2, settled: true, traveled: false,
        });
    });

    it('keeps ordinary same-chapter map selection unchanged', async () => {
        const { controller, nodePosition } = createNavigationController();
        controller.environmentManager.getBlendState.mockReturnValue({ activeChapter: 2 });
        await expect(controller.travelToLevel(6)).resolves.toBe(true);
        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.focusOnNode).toHaveBeenCalledWith(nodePosition, 800);
    });

    it('passes a zero-duration authored seek for reduced-motion source framing', async () => {
        const { controller } = createNavigationController();
        await expect(controller.travelToLevel(6, {
            pathTravel: true, focus: false, travelDuration: 0,
        })).resolves.toBe(true);
        expect(controller.cameraController.travelToPosition).toHaveBeenCalledWith(0.2, 0, {
            isCurrent: expect.any(Function), isPaused: undefined,
        });
    });

    it('does not start travel when cancelled while its environment is preparing', async () => {
        const { controller } = createNavigationController();
        controller._requestChapterEnvironment.mockImplementation(async () => controller.cancelTravel());
        await expect(controller.travelToLevel(6, { pathTravel: true })).resolves.toBe(false);
        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.setFollowMode).toHaveBeenCalledOnce();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it.each([
        'failed', 'already pending', 'completed without an environment',
    ])('does not move into a destination whose request %s', async (state) => {
        const { controller } = createNavigationController();
        controller.environmentManager.environments.delete(2);
        controller.pendingChapterLoads = new Set(state === 'already pending' ? [2] : []);
        controller.environmentManager.createChapterEnvironment = state === 'failed'
            ? vi.fn().mockRejectedValue(new Error('chapter unavailable'))
            : vi.fn().mockResolvedValue(null);
        controller.environmentManager.updateVisibility = vi.fn();
        controller._queueChapterPrewarm = vi.fn();
        controller._requestChapterEnvironment = OdysseyBoardController.prototype._requestChapterEnvironment;

        await expect(controller.travelToLevel(6, { chapterArrival: true, focus: false })).resolves.toBe(false);

        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.setCurrentPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.focusOnNode).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
        expect(controller.environmentManager.createChapterEnvironment)
            .toHaveBeenCalledTimes(state === 'already pending' ? 0 : 1);
    });

    it('also guards same-chapter path travel when its environment is absent', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.getBlendState.mockReturnValue({ activeChapter: 2 });
        controller.environmentManager.environments.delete(2);
        controller._requestChapterEnvironment.mockResolvedValue(false);

        await expect(controller.travelToLevel(6, { pathTravel: true, focus: false })).resolves.toBe(false);

        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.setCurrentPosition).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('accepts a destination created while the request was awaited', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.environments.delete(2);
        controller._requestChapterEnvironment.mockImplementation(async () => {
            controller.environmentManager.environments.set(2, { prewarmed: false, _renderWarmed: false });
            return true;
        });

        await expect(controller.travelToLevel(6, { pathTravel: true, focus: false })).resolves.toBe(true);

        expect(controller.cameraController.travelToPosition).toHaveBeenCalledOnce();
    });

    it('keeps existing destinations usable without requiring a completed background render-warm', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.environments.set(2, { prewarmed: true, _renderWarmed: false });

        await expect(controller.travelToLevel(6, { pathTravel: true, focus: false })).resolves.toBe(true);

        expect(controller.cameraController.travelToPosition).toHaveBeenCalledOnce();
    });

    it('accepts a suppressed destination supplied by the active continuous world', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.environments.delete(2);
        controller.environmentManager.suppressedChapters.add(2);
        controller.oneWorld = { group: new THREE.Group() };
        controller._requestChapterEnvironment.mockResolvedValue(true);

        await expect(controller.travelToLevel(6, { pathTravel: true, focus: false })).resolves.toBe(true);

        expect(controller.cameraController.travelToPosition).toHaveBeenCalledOnce();
    });

    it('does not treat a suppressed destination as ready without a built continuous world', async () => {
        const { controller } = createNavigationController();
        controller.environmentManager.environments.delete(2);
        controller.environmentManager.suppressedChapters.add(2);
        controller.oneWorld = null;
        controller._requestChapterEnvironment.mockResolvedValue(true);

        await expect(controller.travelToLevel(6, { pathTravel: true, focus: false })).resolves.toBe(false);

        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.setCurrentPosition).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('does not publish an arrival when the camera reports cancellation', async () => {
        const { controller } = createNavigationController();
        controller.cameraController.travelToPosition.mockResolvedValue(false);
        await expect(controller.travelToLevel(6, { pathTravel: true })).resolves.toBe(false);
        expect(controller.cameraController.setCurrentPosition).not.toHaveBeenCalled();
        expect(controller.cameraController.focusOnNode).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('checks flow ownership again after environment preparation and after camera focus', async () => {
        const { controller } = createNavigationController();
        let current = true;
        controller._requestChapterEnvironment.mockImplementation(async () => { current = false; });
        await expect(controller.travelToLevel(6, { isCurrent: () => current })).resolves.toBe(false);
        expect(controller.cameraController.travelToPosition).not.toHaveBeenCalled();
        current = true;
        controller._requestChapterEnvironment.mockResolvedValue(true);
        controller.cameraController.focusOnNode.mockImplementation(async () => { current = false; });
        await expect(controller.travelToLevel(6, { isCurrent: () => current })).resolves.toBe(false);
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('does not change selection for an already-stale or disposed owner', async () => {
        const { controller } = createNavigationController();
        await expect(controller.travelToLevel(6, { isCurrent: () => false })).resolves.toBe(false);
        controller._disposed = true;
        await expect(controller.travelToLevel(6)).resolves.toBe(false);
        expect(controller.selectedLevelId).toBe(5);
        expect(controller.nodeManager.setNodeSelected).not.toHaveBeenCalled();
        expect(controller.onLevelSelect).not.toHaveBeenCalled();
    });

    it('cancels camera motion and momentum when navigation ownership is released', () => {
        const { controller } = createNavigationController();
        controller.cameraController.travelModel = { velocity: 1, inputVelocity: 2 };
        controller.cancelTravel();
        expect(controller.selectionSequence).toBe(1);
        expect(controller.cameraController.setFollowMode).toHaveBeenCalledOnce();
        expect(controller.cameraController.travelModel).toEqual({ velocity: 0, inputVelocity: 0 });
    });
});

describe('OdysseyBoardController wheel routing', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            innerHeight: 720,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            body: {},
            documentElement: {},
            elementFromPoint: vi.fn(() => null),
        });
        vi.stubGlobal('getComputedStyle', vi.fn((element) => element?.__style || {
            overflowY: 'visible',
            overflow: 'visible',
        }));
    });

    it('retains a live settings reader for the resident world camera', () => {
        let reducedMotion = false;
        const getReducedMotion = () => reducedMotion;
        const controller = new OdysseyBoardController({}, { getReducedMotion });
        expect(controller.getReducedMotion).toBe(getReducedMotion);
        expect(controller.getReducedMotion()).toBe(false);
        reducedMotion = true;
        expect(controller.getReducedMotion()).toBe(true);
    });

    it('reads the current global game setting when no explicit settings reader is supplied', () => {
        window.settings = { reducedMotion: false };
        const controller = new OdysseyBoardController({});
        expect(controller.getReducedMotion()).toBe(false);
        window.settings = { reducedMotion: true };
        expect(controller.getReducedMotion()).toBe(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('routes wheel input from canvas, header, and level panel targets', () => {
        const container = {
            clientHeight: 720,
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            }),
        };
        const controller = new OdysseyBoardController(container);
        controller.isActive = true;
        controller.isRenderingPaused = false;
        controller.cameraController = {
            scroll: vi.fn(),
        };

        const targets = [
            createTarget(),
            createTarget(),
            createTarget(),
        ];

        targets.forEach((target, index) => {
            const preventDefault = vi.fn();
            controller.onWheel({
                target,
                clientX: 100 + (index * 40),
                clientY: 120 + (index * 20),
                deltaY: 120,
                deltaMode: 0,
                ctrlKey: false,
                preventDefault,
            });
            expect(preventDefault).toHaveBeenCalledTimes(1);
        });

        expect(controller.cameraController.scroll).toHaveBeenCalledTimes(3);
        expect(controller.cameraController.scroll).toHaveBeenNthCalledWith(1, 0.12);
        expect(controller.cameraController.scroll).toHaveBeenNthCalledWith(2, 0.12);
        expect(controller.cameraController.scroll).toHaveBeenNthCalledWith(3, 0.12);
    });

    it('does not route wheel input into locked or scrollable overlays', () => {
        const containerRect = {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 720,
        };
        const lockedOverlay = createTarget({ wheelLock: true });
        const lockedChild = createTarget({ parent: lockedOverlay });
        const scrollablePanel = createTarget({
            overflowY: 'auto',
            clientHeight: 200,
            scrollHeight: 640,
        });
        const scrollableChild = createTarget({ parent: scrollablePanel });

        expect(shouldRouteOdysseyWheel({
            isActive: true,
            isRenderingPaused: false,
            containerRect,
            target: lockedChild,
            clientX: 320,
            clientY: 180,
        })).toBe(false);

        expect(shouldRouteOdysseyWheel({
            isActive: true,
            isRenderingPaused: false,
            containerRect,
            target: scrollableChild,
            clientX: 320,
            clientY: 180,
        })).toBe(false);
    });

    it('normalizes wheel delta modes and clamps extreme input', () => {
        expect(normalizeOdysseyWheelDelta({
            deltaY: 120,
            deltaMode: 0,
            ctrlKey: false,
        }, 720)).toBeCloseTo(0.12, 5);

        expect(normalizeOdysseyWheelDelta({
            deltaY: 3,
            deltaMode: 1,
            ctrlKey: false,
        }, 720)).toBeCloseTo(0.048, 5);

        expect(normalizeOdysseyWheelDelta({
            deltaY: 1,
            deltaMode: 2,
            ctrlKey: false,
        }, 720)).toBeCloseTo(0.24, 5);

        expect(normalizeOdysseyWheelDelta({
            deltaY: 9999,
            deltaMode: 0,
            ctrlKey: false,
        }, 720)).toBeCloseTo(0.24, 5);

        expect(normalizeOdysseyWheelDelta({
            deltaY: 120,
            deltaMode: 0,
            ctrlKey: true,
        }, 720)).toBe(0);
    });

    it('registers and removes stable interaction listeners deterministically', () => {
        const canvas = createCanvas();
        const controller = new OdysseyBoardController({
            clientWidth: 1280,
            clientHeight: 720,
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            }),
        });
        controller.renderer = {
            domElement: canvas,
            dispose: vi.fn(),
        };
        controller.scene = {
            traverse: vi.fn(),
        };
        controller.composer = {
            dispose: vi.fn(),
        };
        controller.postProcessingStack = {
            dispose: vi.fn(),
        };
        controller.environmentManager = {
            dispose: vi.fn(),
        };
        controller.pathRenderer = {
            dispose: vi.fn(),
        };
        controller.nodeManager = {
            dispose: vi.fn(),
        };

        controller.setupInteraction();
        controller.setupInteraction();

        expect(canvas.addEventListener).toHaveBeenCalledTimes(5);
        expect(document.addEventListener).toHaveBeenCalledTimes(1);
        expect(document.addEventListener).toHaveBeenCalledWith(
            'wheel',
            controller.boundHandlers.wheel,
            { capture: true, passive: false },
        );
        expect(window.addEventListener).toHaveBeenCalledTimes(1);
        expect(window.addEventListener).toHaveBeenCalledWith(
            'resize',
            controller.boundHandlers.resize,
        );

        controller.dispose();

        expect(canvas.removeEventListener).toHaveBeenCalledWith(
            'mousemove',
            controller.boundHandlers.mousemove,
        );
        expect(canvas.removeEventListener).toHaveBeenCalledWith(
            'click',
            controller.boundHandlers.click,
        );
        expect(canvas.removeEventListener).toHaveBeenCalledWith(
            'touchstart',
            controller.boundHandlers.touchstart,
        );
        expect(canvas.removeEventListener).toHaveBeenCalledWith(
            'touchmove',
            controller.boundHandlers.touchmove,
        );
        expect(canvas.removeEventListener).toHaveBeenCalledWith(
            'touchend',
            controller.boundHandlers.touchend,
        );
        expect(document.removeEventListener).toHaveBeenCalledWith(
            'wheel',
            controller.boundHandlers.wheel,
            { capture: true, passive: false },
        );
        expect(window.removeEventListener).toHaveBeenCalledWith(
            'resize',
            controller.boundHandlers.resize,
        );
    });
});

describe('OdysseyBoardController presentation layout', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses injected chapter positions when panning to a chapter', async () => {
        const controller = new OdysseyBoardController({
            clientWidth: 1280,
            clientHeight: 720,
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            }),
        });
        controller.presentationLayout = {
            levelPositions: [0, 0.1, 0.2],
            chapterPositions: [0, 0.12, 0.33, 0.66, 1],
            totalLevels: 3,
            chapterRanges: [],
        };
        controller.environmentManager = {};
        controller._requestChapterEnvironment = vi.fn().mockResolvedValue(true);
        controller.cameraController = {
            panToPosition: vi.fn().mockResolvedValue(true),
        };

        await controller.panToChapter(3, 900);

        expect(controller._requestChapterEnvironment).toHaveBeenCalledWith(3);
        expect(controller.cameraController.panToPosition).toHaveBeenCalledWith(0.33, 900);
    });

    it('applies a live layout override to path, nodes, camera, and chapter seams', async () => {
        const controller = new OdysseyBoardController({
            clientWidth: 1280,
            clientHeight: 720,
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            }),
        });
        const initialCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 10, -10),
            new THREE.Vector3(0, 20, -20),
        ]);
        const nextCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-5, 15, -10),
            new THREE.Vector3(-15, 30, -40),
        ]);

        controller.levelData = [
            {
                id: 1, chapter: 1, pathPosition: 0.0, name: 'One',
            },
            {
                id: 2, chapter: 1, pathPosition: 0.2, name: 'Two',
            },
            {
                id: 3, chapter: 2, pathPosition: 0.4, name: 'Three',
            },
        ];
        controller.presentationLayout = {
            controlPoints: [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 10, z: -10 },
                { x: 0, y: 20, z: -20 },
            ],
            levelPositionsById: { 1: 0, 2: 0.2, 3: 0.4 },
            levelPositions: [0, 0.2, 0.4],
            chapterPositions: [0, 0.4, 1],
            totalLevels: 3,
            chapterRanges: [
                {
                    chapterId: 1,
                    startLevelId: 1,
                    endLevelId: 2,
                    startPosition: 0,
                    endPosition: 0.4,
                },
                {
                    chapterId: 2,
                    startLevelId: 3,
                    endLevelId: 3,
                    startPosition: 0.4,
                    endPosition: 1,
                },
            ],
        };
        controller.progressData = {
            furthestLevel: 3,
            levelProgress: {},
        };
        controller.pathRenderer = {
            pathCurve: initialCurve,
            rebuildPath: vi.fn(async () => {
                controller.pathRenderer.pathCurve = nextCurve;
            }),
            // The re-laid-out nodes move along the path, so the override re-syncs the lit
            // frontier (seamless pass): the renderer takes the furthest node's path position.
            setProgress: vi.fn(),
            setFocus: vi.fn(),
        };
        controller.nodeManager = {
            updateLayout: vi.fn(),
            updateFromProgress: vi.fn(),
            getFrontierPathPosition: vi.fn(() => 0.44),
        };
        controller.cameraController = {
            getCurrentPosition: vi.fn(() => 0.25),
            applyLayout: vi.fn(),
        };
        controller.environmentManager = {
            setChapterPositions: vi.fn(),
            updateVisibility: vi.fn(),
            updateGlobalEnvironment: vi.fn(),
        };

        await controller.applyLayoutOverride({
            controlPoints: [
                { x: 0, y: 0, z: 0 },
                { x: -5, y: 15, z: -10 },
                { x: -15, y: 30, z: -40 },
            ],
            levelPositionsById: { 1: 0.0, 2: 0.24, 3: 0.44 },
        });

        expect(controller.pathRenderer.rebuildPath).toHaveBeenCalledTimes(1);
        expect(controller.presentationLayout.levelPositions).toEqual([0, 0.24, 0.44]);
        expect(controller.presentationLayout.chapterPositions).toEqual([0, 0.44, 1]);
        expect(controller.nodeManager.updateLayout).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: 2, pathPosition: 0.24 }),
            ]),
            nextCurve,
        );
        expect(controller.cameraController.applyLayout).toHaveBeenCalledWith(nextCurve, expect.objectContaining({
            levelPositions: [0, 0.24, 0.44],
            chapterPositions: [0, 0.44, 1],
            preservePosition: 0.25,
        }));
        expect(controller.environmentManager.setChapterPositions).toHaveBeenCalledWith([0, 0.44, 1]);
        // The lit frontier follows the furthest node's NEW path position, not a level fraction.
        expect(controller.pathRenderer.setProgress).toHaveBeenCalledWith(0.44);
    });
});
