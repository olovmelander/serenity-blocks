/**
 * @fileoverview Theme-card spotlight for the Serenity Hub's Themes grid.
 *
 * A soft light in the card's category hue follows the pointer, like the main menu's
 * list items: this writes --mx / --my (% within the card) and keystone-hub.css paints
 * `.theme-card::before` from them. Nothing tilts or moves — Keystone interactions drop
 * and lock rather than float.
 *
 * The grid's cards are filtered in place, so one delegated listener on the grid
 * container covers every card for the life of the tab. Writes are batched to one per
 * animation frame and touch only the hovered card.
 */

function resetCard(card) {
    card.style.removeProperty('--mx');
    card.style.removeProperty('--my');
}

/**
 * Attach the delegated spotlight to a Themes grid. Idempotent per grid element.
 * @param {ParentNode} [root] Scope to search for `#themes-grid` (defaults to document).
 */
export function initThemeCardInteractions(root) {
    if (typeof document === 'undefined') return;
    const grid = root?.querySelector?.('#themes-grid') || document.getElementById('themes-grid');
    if (!grid || grid.dataset.csInteractive === 'true') return;
    grid.dataset.csInteractive = 'true';

    let activeCard = null;
    let rect = null;
    let frame = 0;
    let pending = null;

    const clearActive = () => {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        if (activeCard) resetCard(activeCard);
        activeCard = null;
        rect = null;
        pending = null;
    };

    const apply = () => {
        frame = 0;
        if (!activeCard || !pending) return;
        activeCard.style.setProperty('--mx', `${(pending.px * 100).toFixed(1)}%`);
        activeCard.style.setProperty('--my', `${(pending.py * 100).toFixed(1)}%`);
    };

    grid.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return;
        const card = event.target.closest?.('.theme-card');
        if (!card || !grid.contains(card)) {
            // Moved into a gap between cards — settle the last one.
            clearActive();
            return;
        }
        if (card !== activeCard) {
            if (activeCard) resetCard(activeCard);
            activeCard = card;
            rect = card.getBoundingClientRect();
        }
        if (!rect) rect = card.getBoundingClientRect();
        const px = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const py = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
        pending = { px, py };
        if (!frame) frame = requestAnimationFrame(apply);
    }, { passive: true });

    // Leaving the grid entirely resets the last hovered card.
    grid.addEventListener('pointerleave', clearActive);
}
