/**
 * @fileoverview The main menu's light: the current mode's hue around the stage
 * (public/styles/keystone-menu.css, `.sb-menu-light`), the way a chapter tints the Odyssey
 * navigator's sky. Two layers take turns, so a new mode's light fades in while the last one
 * fades out; each layer's colour comes from its `data-light` (the mode id).
 */
export class MenuLight {
    /** @param {HTMLElement} host the start modal; the light goes in first, under the menu. */
    constructor(host, doc = typeof document !== 'undefined' ? document : null) {
        this.layers = [];
        this.index = -1;
        if (!host || !doc?.createElement) return;
        this.element = doc.createElement('div');
        this.element.className = 'sb-menu-light';
        this.element.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 2; i += 1) {
            const layer = doc.createElement('i');
            layer.className = 'sb-menu-light__layer';
            this.element.appendChild(layer);
            this.layers.push(layer);
        }
        host.insertBefore(this.element, host.firstChild || null);
    }

    /** The mode lighting the page now, or null. */
    get mode() {
        return this.layers[this.index]?.dataset.light || null;
    }

    /** Hand the light to `mode`; a no-op when it already has it. */
    to(mode) {
        if (!this.layers.length || !mode || mode === this.mode) return;
        const previous = this.layers[this.index];
        this.index = (this.index + 1) % this.layers.length;
        const next = this.layers[this.index];
        next.dataset.light = mode;
        previous?.classList.remove('is-on');
        next.classList.add('is-on');
    }
}
