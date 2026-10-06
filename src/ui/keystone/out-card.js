/**
 * @fileoverview Status cards over online boards — your own and each opponent's — in
 * the anatomy local versus uses (local-versus-hud.js `.lv-ko`): a word, a stroke in
 * the card's tone, a line under it, a note. Words, never emoji.
 *
 * - Out (coral): knocked out; the board under it goes dark on its own (your board:
 *   shared-effects.js playKnockout). Keeps the `death-overlay` class, the marker the
 *   online mode and the watch manager look for to know a board is out.
 * - Next round (aqua): joined mid-match, plays from the next round (`waiting-overlay`).
 * - Offline (slate): the player's connection dropped (`disconnect-overlay`).
 *
 * Styles: keystone-multiplayer.css (`.sb-out`).
 */

/**
 * @param {Document} doc
 * @param {{title: string, cause?: string|null, note?: string|null, compact?: boolean,
 *   tone?: 'coral'|'aqua'|'slate', marker?: string|null}} opts marker: the class the
 *   modes look the card up by
 * @returns {HTMLElement}
 */
export function createStatusCard(doc, {
    title, cause = null, note = null, compact = false, tone = 'coral', marker = null,
}) {
    const card = doc.createElement('div');
    card.className = [marker, 'sb-out', compact ? 'sb-out--compact' : null, tone !== 'coral' ? `sb-out--${tone}` : null]
        .filter(Boolean).join(' ');
    card.setAttribute('role', 'status');
    const line = (className, text) => {
        if (!text) return;
        const span = doc.createElement('span');
        span.className = className;
        span.textContent = text;
        card.appendChild(span);
    };
    line('sb-out__title', title);
    line('sb-out__cause', cause);
    line('sb-out__note', note);
    return card;
}

/**
 * The knock-out card: "Out", who did it, a note.
 * @param {Document} doc
 * @param {{cause?: string|null, note?: string|null, compact?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function createOutCard(doc, { cause = null, note = null, compact = false } = {}) {
    return createStatusCard(doc, {
        title: 'Out', cause, note, compact, marker: 'death-overlay',
    });
}

/**
 * Puts a card over a board and lets it rise.
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

/** Any status card shows the same way. */
export const showStatusCard = showOutCard;
