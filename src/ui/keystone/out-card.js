/**
 * @fileoverview The knock-out card for online boards — your own and each opponent's —
 * in the anatomy local versus uses (local-versus-hud.js `.lv-ko`): "Out", a coral
 * stroke, who did it, a note. The board under it goes dark on its own (your board:
 * shared-effects.js playKnockout). Styles: keystone-multiplayer.css (`.sb-out`).
 *
 * The card keeps the `death-overlay` class: it is the marker the online mode and the
 * watch manager look for to know a board is out.
 */

/**
 * @param {Document} doc
 * @param {{cause?: string|null, note?: string|null, compact?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function createOutCard(doc, { cause = null, note = null, compact = false } = {}) {
    const card = doc.createElement('div');
    card.className = `death-overlay sb-out${compact ? ' sb-out--compact' : ''}`;
    card.setAttribute('role', 'status');
    const line = (className, text) => {
        if (!text) return;
        const span = doc.createElement('span');
        span.className = className;
        span.textContent = text;
        card.appendChild(span);
    };
    line('sb-out__title', 'Out');
    line('sb-out__cause', cause);
    line('sb-out__note', note);
    return card;
}

/**
 * Puts the card over a board and lets it rise.
 * @param {HTMLElement} container
 * @param {HTMLElement} card
 */
export function showOutCard(container, card) {
    const view = container.ownerDocument?.defaultView;
    if (view?.getComputedStyle?.(container).position === 'static') container.style.position = 'relative';
    container.appendChild(card);
    const raise = () => card.classList.add('is-shown');
    if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(raise);
    else raise();
}
