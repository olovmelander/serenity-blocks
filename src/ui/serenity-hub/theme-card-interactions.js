/**
 * @fileoverview Cosmic Serenity — theme-card micro-interactions for the Serenity Hub.
 *
 * Mirrors the main-menu's `menu-card-interactions.js` "feel" layer, adapted for the
 * hub's Themes grid:
 *   1. Cursor-follow spotlight → writes --mx / --my (% within the card)
 *   2. Parallax 3D tilt        → writes --rx / --ry (degrees)
 *
 * Both are composited purely via CSS custom properties (see serenity-hub-aaa.css
 * Phase 5), so they never touch `transform` directly and can't fight the card's
 * hover/entrance transforms. Honors prefers-reduced-motion (spotlight stays, tilt
 * is skipped).
 *
 * The Themes grid re-renders its cards on search / category changes, so we bind a
 * single delegated listener to the grid container rather than per-card — it keeps
 * working across re-renders with no re-binding.
 */

const MAX_TILT_DEG = 6;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

function resetCard(card) {
    card.style.setProperty('--mx', '50%');
    card.style.setProperty('--my', '50%');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
}

/**
 * Attach delegated spotlight + tilt to a Themes grid. Idempotent per grid element.
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
        const { px, py } = pending;
        activeCard.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        activeCard.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        if (!reducedMotion.matches) {
            activeCard.style.setProperty('--ry', `${((px - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
            activeCard.style.setProperty('--rx', `${((0.5 - py) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
        }
    };

    grid.addEventListener('pointermove', (event) => {
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
