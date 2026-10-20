/**
 * @fileoverview The Odyssey HUD column is read at a glance, never scrolled.
 *
 * The column is laid out to fit beside a full-height well on a 900 px screen. On a shorter
 * window, or with the orb guide unfolded, the whole column is drawn a little smaller instead
 * of growing a scrollbar: `--ody-hud-fit` on the column is the scale, and the stage's rules
 * (keystone-overlays.css) apply it as a transform from the column's top-right corner and
 * give the column the layout height that scale needs. A window too short even for the
 * smallest legible column gets `data-fit="scroll"` instead: full size, scrolled by wheel or
 * touch, with no scrollbar drawn.
 */

/** Below this the type stops being legible; a window that short scrolls instead. */
export const ODYSSEY_HUD_FIT_MIN = 0.66;
export const ODYSSEY_HUD_FIT_PROPERTY = '--ody-hud-fit';

/**
 * How far the content exceeds the box, down (the column) or across (the dock's columns run
 * off its right edge); 1 when it fits. A pixel or two of rounding is not an overflow.
 */
function overflowRatio(container) {
    const ratio = (need, room) => (room && need > room + 1 ? need / room : 1);
    return Math.max(
        ratio(container.scrollHeight || 0, container.clientHeight || 0),
        ratio(container.scrollWidth || 0, container.clientWidth || 0),
    );
}

export class OdysseyHudFit {
    /**
     * @param {HTMLElement} container the HUD column
     * @param {{ window?: any }} [options]
     */
    constructor(container, { window: win = globalThis } = {}) {
        this.container = container;
        this.window = win;
        this.scale = 1;
        this.frame = null;
        this.onResize = () => this.schedule();
        this.window?.addEventListener?.('resize', this.onResize);
        // Web fonts arriving after the first layout change every line's height.
        this.window?.document?.fonts?.ready?.then?.(() => this.schedule()).catch?.(() => {});
    }

    /** Re-measure on the next animation frame; several changes in one frame measure once. */
    schedule() {
        if (this.frame !== null) return;
        const raf = this.window?.requestAnimationFrame;
        if (typeof raf !== 'function') {
            this.fit();
            return;
        }
        this.frame = raf(() => {
            this.frame = null;
            this.fit();
        });
    }

    /**
     * Measure the column at full size and scale it down only as far as its content needs.
     * @returns {number} the scale applied
     */
    fit() {
        const { container } = this;
        if (!container?.style) return 1;
        container.style.removeProperty(ODYSSEY_HUD_FIT_PROPERTY);
        if (container.dataset) delete container.dataset.fit;
        let scale = 1;
        // Two passes: the dock lays its sections out in columns, and the columns re-balance
        // once the strip is given more height, so one measurement under-shoots there.
        for (let pass = 0; pass < 2; pass += 1) {
            const over = overflowRatio(container);
            if (over <= 1) break;
            const wanted = Math.round((scale / over) * 1000) / 1000;
            if (wanted < ODYSSEY_HUD_FIT_MIN) {
                scale = 1;
                container.style.removeProperty(ODYSSEY_HUD_FIT_PROPERTY);
                if (container.dataset) container.dataset.fit = 'scroll';
                break;
            }
            scale = wanted;
            container.style.setProperty(ODYSSEY_HUD_FIT_PROPERTY, String(scale));
        }
        this.scale = scale;
        return scale;
    }

    dispose() {
        this.window?.removeEventListener?.('resize', this.onResize);
        if (this.frame !== null) this.window?.cancelAnimationFrame?.(this.frame);
        this.frame = null;
        this.container?.style?.removeProperty?.(ODYSSEY_HUD_FIT_PROPERTY);
        if (this.container?.dataset) delete this.container.dataset.fit;
        this.container = null;
    }
}
