/**
 * The rest veil: the layer that dims the screen to night when Serenity's rest timer ends
 * (serenity-rest.js has the clock). It fades in over REST_FADE_MS and clears quickly when you
 * come back. Styles: public/styles/keystone-overlays.css (`#serenity-rest-veil`).
 */
import { REST_FADE_MS } from './serenity-rest.js';

export class SerenityRestVeil {
    constructor(host = document.body) {
        this.host = host;
        this.root = null;
    }

    _ensure() {
        if (this.root) return this.root;
        const root = document.createElement('div');
        root.id = 'serenity-rest-veil';
        root.className = 'serenity-rest-veil serenity-hub';
        root.setAttribute('aria-hidden', 'true');
        root.style.setProperty('--rest-fade', `${REST_FADE_MS}ms`);
        const note = document.createElement('p');
        note.className = 'serenity-rest-veil__note';
        note.textContent = 'Resting · move or press any key to come back';
        root.appendChild(note);
        this.host.appendChild(root);
        this.root = root;
        return root;
    }

    /** Begin dimming; the screen is dark after REST_FADE_MS. */
    dim() {
        const root = this._ensure();
        root.classList.remove('is-waking');
        // Read layout once so the transition starts from clear.
        root.getBoundingClientRect();
        root.classList.add('is-dimming');
    }

    /** Clear again, quickly. */
    wake() {
        if (!this.root) return;
        this.root.classList.remove('is-dimming');
        this.root.classList.add('is-waking');
    }

    destroy() {
        this.root?.remove();
        this.root = null;
    }
}
