import {
    describe, expect, it, vi,
} from 'vitest';
import { ODYSSEY_HUD_FIT_PROPERTY, OdysseyHudFit } from '../../src/ui/odyssey/odyssey-hud-fit.js';

/** A column: its room is the well's height, its need is its content; the fit must measure at full size. */
function column({ room, need }) {
    const styles = new Map();
    return {
        styles,
        dataset: {},
        style: {
            setProperty: (name, value) => styles.set(name, value),
            removeProperty: (name) => styles.delete(name),
        },
        // With a scale applied the layout box is taller; a fit that forgot to reset would read that.
        get clientHeight() {
            const scale = Number(styles.get(ODYSSEY_HUD_FIT_PROPERTY) || 1);
            return Math.min(this.scrollHeight, Math.round(room / scale));
        },
        scrollHeight: need,
    };
}

function fakeWindow() {
    const listeners = {};
    const frames = [];
    const win = {
        listeners,
        frames,
        addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }),
        removeEventListener: vi.fn((type) => { delete listeners[type]; }),
        requestAnimationFrame: vi.fn((callback) => frames.push(callback)),
        cancelAnimationFrame: vi.fn((handle) => { frames[handle - 1] = null; }),
        document: { fonts: { ready: Promise.resolve() } },
        runFrames() {
            const pending = frames.splice(0);
            pending.forEach((callback) => callback?.(0));
        },
    };
    win.requestAnimationFrame.mockImplementation((callback) => frames.push(callback));
    return win;
}

describe('Odyssey HUD fit: the column is drawn smaller rather than scrolled', () => {
    it('leaves a column that fits alone and scales one that does not, measured at full size', () => {
        const win = fakeWindow();
        const fits = column({ room: 738, need: 560 });
        const fit = new OdysseyHudFit(fits, { window: win });
        expect(fit.fit()).toBe(1);
        expect(fits.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);

        const tall = column({ room: 738, need: 900 });
        const tallFit = new OdysseyHudFit(tall, { window: win });
        expect(tallFit.fit()).toBe(0.82);
        expect(tall.styles.get(ODYSSEY_HUD_FIT_PROPERTY)).toBe('0.82');
        // Refitting starts from full size again: the same answer, not a compounding one.
        expect(tallFit.fit()).toBe(0.82);
        // The content shrinks back (the guide folds): the scale goes.
        tall.scrollHeight = 700;
        expect(tallFit.fit()).toBe(1);
        expect(tall.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        // The smallest legible column.
        tall.scrollHeight = 1118;
        expect(tallFit.fit()).toBe(0.66);
        expect(tall.dataset.fit).toBeUndefined();
        // A window too short even for that scrolls at full size, without a scrollbar.
        tall.scrollHeight = 3000;
        expect(tallFit.fit()).toBe(1);
        expect(tall.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        expect(tall.dataset.fit).toBe('scroll');
        // A pixel or two of rounding is not a scroll.
        tall.scrollHeight = 739;
        expect(tallFit.fit()).toBe(1);
        expect(tall.dataset.fit).toBeUndefined();
    });

    it('measures once per frame however often it is asked, on resize too, and stops on dispose', () => {
        const win = fakeWindow();
        const col = column({ room: 600, need: 750 });
        const fit = new OdysseyHudFit(col, { window: win });
        expect(win.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        fit.schedule();
        fit.schedule();
        win.listeners.resize();
        expect(win.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(col.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        win.runFrames();
        expect(col.styles.get(ODYSSEY_HUD_FIT_PROPERTY)).toBe('0.8');
        expect(fit.scale).toBe(0.8);

        fit.schedule();
        fit.dispose();
        expect(win.cancelAnimationFrame).toHaveBeenCalled();
        expect(win.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(col.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        win.runFrames();
        expect(col.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        expect(fit.fit()).toBe(1);
    });

    it('sees the dock’s columns run off its right edge and shrinks for them, measuring twice', () => {
        const win = fakeWindow();
        const styles = new Map();
        const scaled = () => styles.has(ODYSSEY_HUD_FIT_PROPERTY);
        const dock = {
            styles,
            dataset: {},
            style: {
                setProperty: (name, value) => styles.set(name, value),
                removeProperty: (name) => styles.delete(name),
            },
            clientHeight: 166,
            scrollHeight: 166,
            clientWidth: 796,
            // One extra column at full size; the re-balanced strip still runs a little over.
            get scrollWidth() { return scaled() ? 820 : 900; },
        };
        const fit = new OdysseyHudFit(dock, { window: win });
        expect(fit.fit()).toBe(0.858);
        expect(dock.styles.get(ODYSSEY_HUD_FIT_PROPERTY)).toBe('0.858');
        expect(dock.dataset.fit).toBeUndefined();
        // Fits once scaled: one pass.
        Object.defineProperty(dock, 'scrollWidth', { get: () => (scaled() ? 796 : 1000), configurable: true });
        expect(fit.fit()).toBe(0.796);
        // A phone-width strip needs more than the floor allows: full size, scrolled as one column.
        Object.defineProperty(dock, 'scrollWidth', { get: () => 1300, configurable: true });
        expect(fit.fit()).toBe(1);
        expect(dock.styles.has(ODYSSEY_HUD_FIT_PROPERTY)).toBe(false);
        expect(dock.dataset.fit).toBe('scroll');
    });

    it('fits at once where there is no animation frame, and survives a bare container', () => {
        const col = column({ room: 700, need: 1000 });
        const fit = new OdysseyHudFit(col, { window: {} });
        fit.schedule();
        expect(col.styles.get(ODYSSEY_HUD_FIT_PROPERTY)).toBe('0.7');
        expect(() => new OdysseyHudFit(null, { window: undefined }).fit()).not.toThrow();
        expect(new OdysseyHudFit({ clientHeight: 0, scrollHeight: 0, style: col.style }, { window: {} }).fit()).toBe(1);
    });
});
