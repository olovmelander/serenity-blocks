/**
 * @fileoverview Odyssey "GOAL COMPLETE!" banner overlay.
 *
 * Extracted verbatim from OdysseyMode._showGoalCompleteOverlay (masterplan E1). Pure static view
 * with no dependencies — it just builds and returns the banner element. OdysseyMode still owns the
 * lifecycle (stores the element for later removal in _hideGoalCompleteOverlay).
 */

/**
 * Build the "GOAL COMPLETE!" banner shown when the level goal is met but play can continue.
 * @returns {HTMLElement} the overlay element (caller mounts + later removes it)
 */
export function createGoalCompleteOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'goal-complete-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(20, 60, 40, 0.95), rgba(10, 40, 30, 0.95));
        border: 2px solid rgba(100, 255, 150, 0.6);
        border-radius: 16px;
        padding: 16px 32px;
        z-index: 1000;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 60px rgba(100, 255, 150, 0.3);
        animation: goalCompleteSlideIn 0.5s ease-out;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes goalCompleteSlideIn {
                from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes goalCompletePulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
            .goal-complete-title {
                font-family: 'Orbitron', sans-serif;
                font-size: 24px;
                font-weight: 700;
                color: #4ade80;
                text-shadow: 0 0 20px rgba(100, 255, 150, 0.8);
                margin-bottom: 8px;
            }
            .goal-complete-subtitle {
                font-family: 'Segoe UI', sans-serif;
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
            }
            .goal-complete-hint {
                font-family: 'Segoe UI', sans-serif;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.6);
                margin-top: 8px;
                animation: goalCompletePulse 2s ease-in-out infinite;
            }
            .goal-complete-hint kbd {
                background: rgba(255, 255, 255, 0.2);
                padding: 2px 8px;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.3);
            }
        </style>
        <div class="goal-complete-title">GOAL COMPLETE!</div>
        <div class="goal-complete-subtitle">Keep playing for more stars</div>
        <div class="goal-complete-hint">Press <kbd>Enter</kbd> to finish</div>
    `;

    return overlay;
}

export default createGoalCompleteOverlay;
