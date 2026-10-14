/**
 * @fileoverview The stage's key art: a picture of the current mode, captured from the
 * game itself (public/assets/menu-art/, recipe in docs/MENU_UI_OVERHAUL_2026-10.md §3.1).
 * It lies across the top of the stage panel and fades into it, so the copy below stays
 * on the night glass. A new mode's picture drops in over the old one and locks (opacity
 * and scale, the lock ease); at rest it drifts slowly (CSS) and leans a few pixels away
 * from the pointer. Reduced motion keeps the crossfade only.
 *
 * Only opacity and transforms animate; nothing here blurs the live scene behind the menu.
 */

export const MENU_ART_DIR = './assets/menu-art/';

/** Matches `sb-art-in` in keystone-menu.css: the old picture leaves once the new one is in. */
const SWAP_MS = 760;
const LEAN_PX = { x: 7, y: 4 };

function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class StageArt {
    /**
     * @param {HTMLElement} panel The stage panel; the art layer becomes its first child.
     * @param {{ isActive?: () => boolean }} [options] Whether the menu is showing (the lean
     *   follows the pointer only then).
     */
    constructor(panel, { isActive = () => true } = {}) {
        this.isActive = isActive;
        this.layer = document.createElement('div');
        this.layer.className = 'sb-stage__art';
        this.layer.setAttribute('aria-hidden', 'true');
        this.caption = document.createElement('p');
        this.caption.className = 'sb-stage__caption';
        this.caption.hidden = true;
        panel.prepend(this.layer, this.caption);
        this.currentSrc = null;
        this.token = 0;
        /** src → Promise<boolean>: whether the file decoded. */
        this.ready = new Map();
        this.bindLean();
    }

    load(src) {
        if (!this.ready.has(src)) {
            const img = new Image();
            img.decoding = 'async';
            img.src = src;
            const decoded = typeof img.decode === 'function'
                ? img.decode()
                : new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });
            this.ready.set(src, decoded.then(() => true, () => false));
        }
        return this.ready.get(src);
    }

    /** Warm the cache for pictures the player is likely to look at next. */
    preload(sources) {
        sources.forEach((src) => {
            if (src) this.load(src);
        });
    }

    /**
     * Show a picture: `{ src, focus?, caption? }`, or null for none (the layer keeps the
     * mode's hue glow, so the panel never looks broken while a file loads or is missing).
     */
    show(art) {
        this.setCaption(art?.caption);
        const src = art?.src || null;
        if (src === this.currentSrc) return;
        this.currentSrc = src;
        const token = ++this.token;
        if (!src) {
            this.retire({ all: true });
            return;
        }
        this.load(src).then((ok) => {
            if (token !== this.token) return;
            if (!ok) {
                this.retire({ all: true });
                return;
            }
            const frame = document.createElement('div');
            frame.className = 'sb-stage__frame';
            if (art.focus) frame.style.setProperty('--sb-art-focus', art.focus);
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.src = src;
            frame.appendChild(img);
            this.retire();
            this.layer.appendChild(frame);
        });
    }

    /** The pictures underneath stay until the new one has faded in over them. */
    retire({ all = false } = {}) {
        this.layer.querySelectorAll('.sb-stage__frame:not(.is-leaving)').forEach((frame) => {
            frame.classList.add('is-leaving');
            if (all) frame.classList.add('is-fading');
            setTimeout(() => frame.remove(), SWAP_MS);
        });
    }

    setCaption(text) {
        const value = text || '';
        if (this.caption.textContent !== value) this.caption.textContent = value;
        this.caption.hidden = !value;
    }

    /** The art leans away from the pointer anywhere on the screen, eased by CSS. */
    bindLean() {
        if (typeof window === 'undefined' || prefersReducedMotion()) return;
        let frame = 0;
        let x = 0;
        let y = 0;
        const apply = () => {
            frame = 0;
            this.layer.style.setProperty('--sb-art-x', `${(-x * 2 * LEAN_PX.x).toFixed(1)}px`);
            this.layer.style.setProperty('--sb-art-y', `${(-y * 2 * LEAN_PX.y).toFixed(1)}px`);
        };
        window.addEventListener('pointermove', (event) => {
            if (event.pointerType !== 'mouse' || !this.isActive()) return;
            x = Math.min(Math.max(event.clientX / (window.innerWidth || 1), 0), 1) - 0.5;
            y = Math.min(Math.max(event.clientY / (window.innerHeight || 1), 0), 1) - 0.5;
            if (!frame) frame = requestAnimationFrame(apply);
        }, { passive: true });
    }
}
