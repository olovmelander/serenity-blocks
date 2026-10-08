/**
 * @fileoverview Odyssey "goal complete" banner.
 *
 * Extracted from OdysseyMode._showGoalCompleteOverlay (masterplan E1). Pure static view
 * with no dependencies — it just builds and returns the banner element. OdysseyMode still
 * owns the lifecycle (stores the element for later removal in _hideGoalCompleteOverlay).
 * Styles: `#goal-complete-overlay` in public/styles/keystone-overlays.css.
 */

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
        <span class="sb-goal-banner__key" aria-hidden="true"></span>
        <div class="sb-goal-banner__text">
            <p class="goal-complete-title">Goal complete</p>
            <p class="goal-complete-subtitle">Keep playing for more stars</p>
        </div>
        <p class="goal-complete-hint"><kbd class="sb-kbd" data-key>Enter</kbd>
            <kbd class="sb-kbd" data-pad>View / Back</kbd> Finish</p>
    `;

    return overlay;
}

export default createGoalCompleteOverlay;
