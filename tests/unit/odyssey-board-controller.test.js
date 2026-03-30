import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';
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
        };
        controller.nodeManager = {
            updateLayout: vi.fn(),
            updateFromProgress: vi.fn(),
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
    });
});
