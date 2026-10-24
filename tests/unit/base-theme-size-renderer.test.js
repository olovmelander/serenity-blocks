import {
    describe, expect, it, vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';

/** The parts of three's renderer that size its canvas (Renderer / CanvasTarget, r186). */
function renderer() {
    const state = { width: 300, height: 150, ratio: 1 };
    return {
        getSize: (target) => target.set(state.width, state.height),
        getPixelRatio: () => state.ratio,
        setPixelRatio: vi.fn((ratio) => { state.ratio = ratio; }),
        setSize: vi.fn((width, height) => { state.width = width; state.height = height; }),
    };
}

/** The theme's own size check (BaseTheme is abstract; the check reads nothing of the theme). */
const sizeRenderer = (...args) => BaseTheme.prototype.sizeRenderer.apply(null, args);

describe('BaseTheme.sizeRenderer', () => {
    it('sizes the canvas only when its size or pixel ratio changes', () => {
        // Sizing a canvas again, even to the size it has, leaves it blank until the next frame.
        const gpu = renderer();
        expect(sizeRenderer(gpu, 1280, 720, 1.5)).toBe(true);
        expect(gpu.setPixelRatio).toHaveBeenCalledWith(1.5);
        expect(gpu.setSize).toHaveBeenCalledWith(1280, 720);
        expect(sizeRenderer(gpu, 1280, 720, 1.5)).toBe(false);
        expect(gpu.setSize).toHaveBeenCalledTimes(1);
        expect(sizeRenderer(gpu, 1280, 720, 0.75)).toBe(true); // a new render scale
        expect(sizeRenderer(gpu, 1024, 720, 0.75)).toBe(true); // a new window
        expect(gpu.setSize).toHaveBeenCalledTimes(3);
    });

    it('sizes a renderer that cannot report its size every time, as before', () => {
        const gpu = { setPixelRatio: vi.fn(), setSize: vi.fn() };
        sizeRenderer(gpu, 800, 600, 1);
        sizeRenderer(gpu, 800, 600, 1);
        expect(gpu.setSize).toHaveBeenCalledTimes(2);
    });
});
