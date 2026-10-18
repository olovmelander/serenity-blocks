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
 * Audit 2026-10-18: a resize, fullscreen switch or quality change made during an orb came back
 * as a stretched or blank world. The resize listener left with the interaction on every lock,
 * and a resize that did arrive while the board was parked read a 0x0 container: NaN aspect,
 * a 0 px canvas.
 */
function createBoard(container) {
    const controller = new OdysseyBoardController(container);
    let size = { x: 1280, y: 720 };
    controller.renderer = {
        domElement: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            style: {},
        },
        dispose: vi.fn(),
        getSize: vi.fn((target) => Object.assign(target, size)),
        setPixelRatio: vi.fn(),
        setSize: vi.fn((width, height) => { size = { x: width, y: height }; }),
    };
    controller.camera = { aspect: 16 / 9, updateProjectionMatrix: vi.fn() };
    controller.scene = { traverse: vi.fn() };
    controller.postProcessingStack = { dispose: vi.fn(), resize: vi.fn() };
    controller._applyChapterMusic = vi.fn();
    controller.animate = vi.fn();
    return controller;
}

describe('Odyssey board resize while parked', () => {
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
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('holds a resize the hidden board cannot take, and applies it when the board shows again', () => {
        const container = { clientWidth: 0, clientHeight: 0 };
        const controller = createBoard(container);

        controller.onResize(); // a quality change mid-orb: the container is display:none
        expect(controller.renderer.setSize).not.toHaveBeenCalled();
        expect(controller.camera.aspect).toBeCloseTo(16 / 9, 6);

        container.clientWidth = 1600;
        container.clientHeight = 900;
        controller.isRenderingPaused = true;
        controller.resumeRendering();

        expect(controller.renderer.setSize).toHaveBeenCalledWith(1600, 900);
        expect(controller.camera.aspect).toBeCloseTo(1600 / 900, 6);
        expect(controller.postProcessingStack.resize).toHaveBeenCalledWith(1600, 900);
    });

    it('catches up on resume when the canvas no longer matches its container', () => {
        const container = { clientWidth: 1920, clientHeight: 1080 }; // fullscreen, set mid-orb
        const controller = createBoard(container);
        controller.isRenderingPaused = true;
        controller.resumeRendering();
        expect(controller.renderer.setSize).toHaveBeenCalledWith(1920, 1080);

        controller.renderer.setSize.mockClear();
        controller.isRenderingPaused = true;
        controller.resumeRendering(); // same size: no needless resize
        expect(controller.renderer.setSize).not.toHaveBeenCalled();
    });

    it('routes out of a lost WebGL2 context instead of sitting frozen', async () => {
        // Audit 2026-10-18: loss handling was wired for WebGPU only; on the WebGL2 fallback
        // three drops every frame after a context loss, with no restore and no way out.
        const { eventBus, EVENTS } = await import('../../src/events/event-bus.js');
        const controller = createBoard({ clientWidth: 1280, clientHeight: 720 });
        const canvas = new EventTarget();
        controller.renderer.domElement = canvas;
        controller.isWebGPU = false;
        controller.pauseRendering = vi.fn();
        const exits = [];
        const off = eventBus.on(EVENTS.EXIT_TO_MAIN_MENU, (payload) => exits.push(payload));
        try {
            controller._watchGpuLoss();
            const lost = new Event('webglcontextlost', { cancelable: true });
            canvas.dispatchEvent(lost);
            expect(lost.defaultPrevented).toBe(true);
            expect(controller.pauseRendering).toHaveBeenCalledOnce();
            expect(exits).toEqual([{ reason: 'gpu-loss-unrecoverable' }]);
        } finally {
            off?.();
            controller._gpuMonitorUnsub?.();
        }
    });

    it('keeps listening for window resizes through an interaction lock, until dispose', () => {
        const controller = createBoard({ clientWidth: 1280, clientHeight: 720 });
        controller.setupInteraction();
        controller.teardownInteraction(); // an orb entry locks the board
        controller.setupInteraction();

        const resizeAdds = window.addEventListener.mock.calls.filter(([type]) => type === 'resize');
        expect(resizeAdds).toHaveLength(1);
        expect(window.removeEventListener.mock.calls.some(([type]) => type === 'resize')).toBe(false);

        controller.dispose();
        expect(window.removeEventListener.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    });
});
