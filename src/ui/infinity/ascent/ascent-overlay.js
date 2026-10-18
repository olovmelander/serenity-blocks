// @ts-check

/**
 * What the well shows while the player looks around the tower: the height ruler on its wall,
 * the milestones as floors of light across it (gold once built past, faint while still above),
 * the tower's memory marks with the name of the one the view passes, the way home (an arrow and
 * the distance, with the ring that fills before the view flies back), and the altimeter.
 *
 * DOM over the board (the well's `.player-board-section`, so it rides the board's juice), placed
 * every frame from the camera row. Nothing here reads layout per frame: the board's size comes
 * from a ResizeObserver. Styles: public/styles/keystone-solo.css ("The ascent").
 */

import { ASCENT, milestoneHeights } from './ascent-model.js';

/** Enough ticks for twenty rows at the short well's step. */
const TICKS = 5;
const FLOORS = 5;
const MARKS = 8;
const RING_LENGTH = 2 * Math.PI * 9;

/** @param {string} tag @param {string} className @param {HTMLElement} [parent] */
function el(tag, className, parent) {
    const node = document.createElement(tag);
    node.className = className;
    parent?.appendChild(node);
    return node;
}

/**
 * @typedef {object} OverlayFrame
 * @property {number} presence 0..1 how much of the overlay shows
 * @property {number} top the camera's first row on screen
 * @property {number} visibleRows
 * @property {number} boardLength
 * @property {number} home the camera's first row at play
 * @property {number} summitHeight rows built
 * @property {number} maxRows the ceiling
 * @property {number} ring 0..1 the wait before the flight home
 * @property {import('./tower-memory.js').TowerMark[]} marks
 * @property {string|null} caption the memory near the view, in words
 * @property {number|null} captionHeight where that memory is
 * @property {boolean} [firstLook] show the how-to line
 * @property {number} [tickRows] the ruler's step (ASCENT.TICK_ROWS by default)
 * @property {number[]} [milestones] the floors' heights (the ceiling's shares by default)
 */

export class AscentOverlay {
    /** @param {HTMLElement|null} section the well's `.player-board-section` */
    constructor(section) {
        this.section = section;
        this.root = null;
        this.height = 0;
        this.width = 0;
        /** @type {Record<string, string|number|boolean>} */
        this.last = {};
        this.resizeObserver = null;
        if (section && typeof document !== 'undefined') this._build(section);
    }

    /** @param {HTMLElement} section */
    _build(section) {
        const root = el('div', 'ia-overlay', section);
        root.setAttribute('aria-hidden', 'true');
        this.root = root;
        this.ruler = el('div', 'ia-ruler', root);
        this.ticks = Array.from({ length: TICKS }, () => {
            const tick = el('div', 'ia-tick', this.ruler);
            const label = el('span', 'ia-tick__label', tick);
            return { tick, label, value: NaN };
        });
        this.floors = Array.from({ length: FLOORS }, () => {
            const floor = el('div', 'ia-floor', root);
            const label = el('span', 'ia-floor__label', floor);
            return { floor, label, value: NaN };
        });
        this.marks = Array.from({ length: MARKS }, () => el('div', 'ia-mark', root));
        this.caption = el('div', 'ia-caption', root);
        this.home = el('div', 'ia-home', root);
        this.home.innerHTML = '<svg class="ia-home__ring" viewBox="0 0 22 22" aria-hidden="true">'
            + '<circle class="ia-home__track" cx="11" cy="11" r="9"></circle>'
            + `<circle class="ia-home__fill" cx="11" cy="11" r="9" stroke-dasharray="${RING_LENGTH.toFixed(2)}"`
            + ` stroke-dashoffset="${RING_LENGTH.toFixed(2)}"></circle></svg>`
            + '<span class="ia-home__arrow"></span><span class="ia-home__text"></span>';
        this.ringFill = /** @type {SVGCircleElement|null} */ (this.home.querySelector('.ia-home__fill'));
        this.homeArrow = /** @type {HTMLElement} */ (this.home.querySelector('.ia-home__arrow'));
        this.homeText = /** @type {HTMLElement} */ (this.home.querySelector('.ia-home__text'));
        this.altimeter = el('div', 'ia-altimeter', root);
        // "Altitude": how high the VIEW is (the HUD's "Height" is how high the tower is built).
        this.altimeter.innerHTML = '<span class="ia-altimeter__label">Altitude</span>'
            + '<span class="ia-altimeter__value"></span><span class="ia-altimeter__unit">rows</span>'
            + '<span class="ia-altimeter__sub"></span><span class="ia-altimeter__hint">'
            + 'Scroll or drag the tower to look · any game key returns</span>';
        this.altValue = /** @type {HTMLElement} */ (this.altimeter.querySelector('.ia-altimeter__value'));
        this.altSub = /** @type {HTMLElement} */ (this.altimeter.querySelector('.ia-altimeter__sub'));

        const measure = () => {
            this.height = root.clientHeight || section.clientHeight || 0;
            this.width = root.clientWidth || section.clientWidth || 0;
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(measure);
            this.resizeObserver.observe(section);
        }
    }

    /** @param {OverlayFrame} frame */
    render(frame) {
        const { root } = this;
        if (!root) return;
        const presence = Math.min(1, Math.max(0, frame.presence || 0));
        this._set('presence', presence.toFixed(3), (v) => root.style.setProperty('--ia-presence', String(v)));
        this._set('shown', presence > 0.002, (v) => root.classList.toggle('is-shown', Boolean(v)));
        if (presence <= 0.002) return;
        if (!this.height) {
            this.height = root.clientHeight || 0;
            this.width = root.clientWidth || 0;
        }
        const rows = frame.visibleRows > 0 ? frame.visibleRows : 20;
        const rowPx = this.height / rows;
        if (!(rowPx > 0)) return;
        /** Screen y (px) of a height's line (the top edge of the row at that height). */
        const yOf = (height) => (frame.boardLength - height - frame.top) * rowPx;
        const topHeight = frame.boardLength - frame.top;
        const bottomHeight = topHeight - rows;

        // The ruler: a tick every step of height, the number beside it; every fifth is major.
        const step = frame.tickRows && frame.tickRows > 0 ? frame.tickRows : ASCENT.TICK_ROWS;
        const major = step * 5;
        let h = Math.ceil(Math.max(step, bottomHeight) / step) * step;
        this.ticks.forEach((item) => {
            const show = h <= topHeight + 0.5;
            item.tick.style.display = show ? '' : 'none';
            if (show) {
                item.tick.style.transform = `translate3d(0, ${yOf(h).toFixed(1)}px, 0)`;
                if (item.value !== h) {
                    item.value = h;
                    item.label.textContent = h.toLocaleString();
                    item.tick.classList.toggle('is-major', h % major === 0);
                }
            }
            h += step;
        });

        // Milestones: the floors to come and the ones built past.
        const milestones = (frame.milestones || milestoneHeights(frame.maxRows))
            .filter((m) => m >= bottomHeight - 1 && m <= topHeight + 1);
        this.floors.forEach((item, i) => {
            const m = milestones[i];
            if (m === undefined) {
                item.floor.style.display = 'none';
                return;
            }
            item.floor.style.display = '';
            item.floor.style.transform = `translate3d(0, ${yOf(m).toFixed(1)}px, 0)`;
            const reached = frame.summitHeight >= m;
            if (item.value !== m || item.floor.classList.contains('is-reached') !== reached) {
                item.value = m;
                const words = `${m.toLocaleString()} rows`;
                item.label.textContent = reached ? words : `${words} · still above`;
                item.floor.classList.toggle('is-reached', reached);
            }
        });

        // The tower's memory.
        const visible = (frame.marks || [])
            .filter((mark) => mark.height >= bottomHeight - 1 && mark.height <= topHeight + 1);
        this.marks.forEach((node, i) => {
            const mark = visible[i];
            node.style.display = mark ? '' : 'none';
            if (!mark) return;
            node.style.transform = `translate3d(0, ${yOf(mark.height).toFixed(1)}px, 0)`;
            node.dataset.kind = mark.kind;
        });
        const captionShown = Boolean(frame.caption) && Number.isFinite(frame.captionHeight);
        this._set('captionShown', captionShown, (v) => this.caption.classList.toggle('is-shown', Boolean(v)));
        if (captionShown) {
            const y = yOf(/** @type {number} */ (frame.captionHeight));
            this.caption.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
            this._set('caption', String(frame.caption), (v) => { this.caption.textContent = String(v); });
        }

        // The way home and the wait before the flight back.
        const away = frame.home - frame.top;
        const homeOut = Math.abs(away) > 0.75;
        this._set('homeShown', homeOut || frame.ring > 0, (v) => this.home.classList.toggle('is-shown', Boolean(v)));
        this._set('homeUp', away < 0, (v) => this.home.classList.toggle('is-up', Boolean(v)));
        // The way home is a small badge in the well's corner (the altimeter has the words).
        const distance = Math.round(Math.abs(away));
        this._set('homeText', distance, (v) => { this.homeText.textContent = Number(v).toLocaleString(); });
        this._set('ring', frame.ring.toFixed(3), (v) => {
            this.ringFill?.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - Number(v))).toFixed(2));
            this.home.classList.toggle('is-returning', Number(v) > 0);
        });

        // The altimeter.
        const height = Math.max(0, Math.round(frame.boardLength - (frame.top + rows / 2)));
        this._set('height', height, (v) => { this.altValue.textContent = Number(v).toLocaleString(); });
        // `away` > 0: the player's rows lie below the view, so the view is above them.
        const above = Math.round(away);
        let sub = 'At your piece';
        if (above > 0) sub = `${above.toLocaleString()} above your piece`;
        else if (above < 0) sub = `${(-above).toLocaleString()} below your piece`;
        this._set('sub', sub, (v) => { this.altSub.textContent = String(v); });
        this._set('hint', Boolean(frame.firstLook), (v) => this.altimeter.classList.toggle('is-first', Boolean(v)));
    }

    /**
     * Write only what changed.
     * @param {string} key @param {string|number|boolean} value @param {(v: string|number|boolean) => void} write
     */
    _set(key, value, write) {
        if (this.last[key] === value) return;
        this.last[key] = value;
        write(value);
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.root?.remove();
        this.root = null;
        this.last = {};
    }
}
