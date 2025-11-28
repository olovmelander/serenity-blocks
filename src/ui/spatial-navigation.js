/**
 * @fileoverview Spatial Navigation Utility
 * Handles 2D navigation for gamepad/keyboard interfaces
 */

export class SpatialNavigation {
    /**
     * Find the best candidate element to focus in a given direction
     * @param {HTMLElement} currentElement - The currently focused element
     * @param {'up'|'down'|'left'|'right'} direction - Navigation direction
     * @param {HTMLElement} container - The container to restrict search to (optional)
     * @returns {HTMLElement|null} The best candidate or null if none found
     */
    static findNextElement(currentElement, direction, container = document.body) {
        if (!currentElement) return null;

        const focusables = this.getFocusableElements(container);
        const currentRect = currentElement.getBoundingClientRect();
        const candidates = focusables.filter((el) => el !== currentElement);

        let bestCandidate = null;
        let bestScore = Infinity;

        for (const candidate of candidates) {
            const candidateRect = candidate.getBoundingClientRect();

            if (!this.isValidCandidate(currentRect, candidateRect, direction)) {
                continue;
            }

            const score = this.calculateScore(currentRect, candidateRect, direction);
            if (score < bestScore) {
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        return bestCandidate;
    }

    /**
     * Get all focusable elements within a container
     * @param {HTMLElement} container
     * @returns {HTMLElement[]}
     */
    static getFocusableElements(container) {
        const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const elements = Array.from(container.querySelectorAll(selector));

        return elements.filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && el.offsetParent !== null
                && !el.classList.contains('readonly'); // Skip readonly displays
        });
    }

    /**
     * Check if a candidate is in the valid direction relative to current element
     */
    static isValidCandidate(current, candidate, direction) {
        // Tolerance to allow for slight misalignments
        const tolerance = 10;

        switch (direction) {
        case 'up':
            return candidate.bottom <= current.top + tolerance;
        case 'down':
            return candidate.top >= current.bottom - tolerance;
        case 'left':
            return candidate.right <= current.left + tolerance;
        case 'right':
            return candidate.left >= current.right - tolerance;
        default:
            return false;
        }
    }

    /**
     * Calculate a score for a candidate (lower is better)
     * Prioritizes elements that are closer and better aligned
     */
    static calculateScore(current, candidate, direction) {
        const currentCenter = {
            x: current.left + current.width / 2,
            y: current.top + current.height / 2,
        };
        const candidateCenter = {
            x: candidate.left + candidate.width / 2,
            y: candidate.top + candidate.height / 2,
        };

        let distance = 0;
        let alignment = 0;

        switch (direction) {
        case 'up':
        case 'down':
            // Main axis: Y, Cross axis: X
            distance = Math.abs(currentCenter.y - candidateCenter.y);
            alignment = Math.abs(currentCenter.x - candidateCenter.x);
            break;
        case 'left':
        case 'right':
            // Main axis: X, Cross axis: Y
            distance = Math.abs(currentCenter.x - candidateCenter.x);
            alignment = Math.abs(currentCenter.y - candidateCenter.y);
            break;
        }

        // Weight alignment heavily to prefer items directly in line
        // But not so heavily that we skip close items that are slightly offset
        return distance + (alignment * 2.5);
    }
}
