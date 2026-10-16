/**
 * The countdown's light, shared by local versus' cover (cinematic-loading-overlay.js) and the
 * online match countdown (ffa-p2p-game-state.js showCountdown): the logo's spectrum walks down
 * the count (lavender for 5 to 3, aqua for 2, mint for 1 and 0) and lands on coral for GO, the
 * colour of every primary action; a line before the count (ROUND OVER) is gold. Each count is a
 * ring of light in its colour over the void, drawn by the CSS from --cd-rgb.
 */

export const COUNTDOWN_HUES = Object.freeze({
    high: { color: '#b8a4ff', rgb: '184, 164, 255' },
    two: { color: '#9ee8ed', rgb: '158, 232, 237' },
    one: { color: '#c5f1cf', rgb: '197, 241, 207' },
    go: { color: '#ffac88', rgb: '255, 172, 136' },
    gold: { color: '#f3d28d', rgb: '243, 210, 141' },
});

/**
 * @param {number|string} value a count, 'GO', or any other text (a line before the count)
 * @returns {keyof typeof COUNTDOWN_HUES}
 */
export function countdownHueKey(value) {
    if (value === 'GO') return 'go';
    if (typeof value !== 'number') return 'gold';
    if (value >= 3) return 'high';
    return value === 2 ? 'two' : 'one';
}

/** The numeral's glow in a hue. */
export function countdownGlow(rgb) {
    return `0 0 26px rgba(${rgb}, 0.5), 0 0 64px rgba(${rgb}, 0.26)`;
}

const ONLINE_SIZES = Object.freeze({
    go: 'clamp(88px, 11vw, 128px)',
    gold: 'clamp(44px, 6.4vw, 80px)',
});

/**
 * Paint the online countdown element for one count: its colour, glow, ring and size.
 * @param {HTMLElement} element
 * @param {number|string} value
 * @returns {keyof typeof COUNTDOWN_HUES}
 */
export function paintCountdown(element, value) {
    const key = countdownHueKey(value);
    const { color, rgb } = COUNTDOWN_HUES[key];
    element.style.color = color;
    element.style.textShadow = countdownGlow(rgb);
    element.style.setProperty?.('--cd-rgb', rgb);
    element.style.fontSize = ONLINE_SIZES[key] || 'clamp(108px, 14vw, 156px)';
    return key;
}
