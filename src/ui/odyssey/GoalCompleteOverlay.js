/**
 * @fileoverview Odyssey "goal complete" banner.
 *
 * Extracted from OdysseyMode._showGoalCompleteOverlay (masterplan E1). Pure static view
 * with no dependencies — it just builds and returns the banner element. OdysseyMode still
 * owns the lifecycle (stores the element for later removal in _hideGoalCompleteOverlay).
 * Styles: `#goal-complete-overlay` in public/styles/keystone-overlays.css: one line in the
 * play rail's band above the well's mouth, clear of the next-piece queue and the well.
 *
 * The Finish hint carries both keycaps: Enter, and the controller button the showcase lap
 * finishes on (odyssey-showcase-input.js relabels or hides the `[data-pad]` cap once it knows
 * which spare button the player's bindings leave free).
 */

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M5 12.5l4.4 4.4L19 7.4"/></svg>';

/**
 * Build the banner shown when the level goal is met but play can continue.
 * @returns {HTMLElement} the overlay element (caller mounts + later removes it)
 */
export function createGoalCompleteOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'goal-complete-overlay';
    overlay.className = 'sb-goal-banner';
    overlay.role = 'status';
    overlay.innerHTML = `
        <span class="sb-goal-banner__mark" aria-hidden="true">${CHECK_SVG}</span>
        <div class="sb-goal-banner__text">
            <p class="goal-complete-title">Goal complete</p>
            <p class="goal-complete-subtitle">Keep playing for more stars</p>
        </div>
        <p class="goal-complete-hint"><kbd class="sb-kbd" data-key>Enter</kbd><kbd
            class="sb-kbd" data-pad>View / Back</kbd> Finish</p>
    `;

    return overlay;
}

export default createGoalCompleteOverlay;
