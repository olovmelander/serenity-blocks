// @ts-check
/**
 * THE FREE FRAME (2026-11-25): the part of the Odyssey map its own UI leaves open. The orb's card
 * stands over the right of the screen (or lies across the bottom of a narrow one) and the header
 * over the top; the camera centres its picture in what is left (FRAME_SHIFT in
 * OdysseyCameraController.js). This module only measures; the mode hands the board the reader.
 */

/**
 * Whether an element is on the screen for the player: laid out, visible, and not faded out
 * (its own opacity and its ancestors' up to `root`).
 * @param {Element|null|undefined} element
 * @param {Element|null} root
 * @param {Window} win
 */
function shows(element, root, win) {
    for (let node = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.5) return false;
        if (node === root) break;
    }
    return !!element;
}

/**
 * The middle of the free part of the frame, in half-screens from the screen's middle: x to the
 * right, y up. (0, 0) when the map's UI is not showing.
 * @param {Document} [doc]
 * @param {Window} [win]
 * @returns {{ x: number, y: number }}
 */
export function measureOdysseyFreeFrame(doc = globalThis.document, win = globalThis.window) {
    const width = win?.innerWidth || 0;
    const height = win?.innerHeight || 0;
    const overlay = doc?.getElementById?.('odyssey-board-overlay');
    if (!overlay || !(width > 0 && height > 0)) return { x: 0, y: 0 };
    let left = 0;
    let right = width;
    let top = 0;
    let bottom = height;
    const header = doc.getElementById('odyssey-map-header');
    if (header && shows(header, overlay, win)) {
        const rect = header.getBoundingClientRect();
        // A bar across the top: the picture begins under it.
        if (rect.width > width * 0.5 && rect.bottom < height * 0.3) top = Math.max(top, rect.bottom);
    }
    const panel = doc.getElementById('odyssey-level-panel');
    if (panel && !panel.classList.contains('hidden') && shows(panel, overlay, win)) {
        const rect = panel.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            if (rect.width > width * 0.6) {
                // A sheet across the bottom of a narrow screen.
                bottom = Math.min(bottom, Math.max(top, rect.top));
            } else if (rect.left + (rect.width / 2) > width / 2) {
                right = Math.min(right, rect.left);
            } else {
                left = Math.max(left, rect.right);
            }
        }
    }
    return {
        x: (((left + right) / 2) - (width / 2)) / (width / 2),
        y: -((((top + bottom) / 2) - (height / 2)) / (height / 2)),
    };
}
