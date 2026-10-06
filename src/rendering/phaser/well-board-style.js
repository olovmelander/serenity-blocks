/**
 * @fileoverview The well's board style — the boards drawn inside an open-top well:
 * local versus (local-board-hosts.js), single player and Infinity (their modes turn it
 * on with BaseBoardScene.setWellStyle). Odyssey and the online boards keep the base
 * scene's look.
 *
 * Pieces and the stack stay the base scene's solid, fused shapes. The well changes two
 * things, in any theme's palette:
 * - garbage is one solid slate fill, faintly tinted by the attacker, so it never
 *   passes for a stack of pieces and its holes stay plain to see (it was a slab in
 *   the attacker's own colour);
 * - the ghost is the piece's own colour, outlined, where the piece will land.
 */

/** Garbage: slate, tinted this much by the attacker's colour. */
const GARBAGE_SLATE = 0x4a5068;
const GARBAGE_TINT = 0.28;

const lerp = (a, b, t) => {
    const r = Math.round(((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t));
    const g = Math.round(((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t));
    const bl = Math.round((a & 0xff) + (((b & 0xff) - (a & 0xff)) * t));
    return (r << 16) | (g << 8) | bl;
};

/**
 * The solid colour of a garbage cell sent by an attacker.
 * @param {number} attackerInt the attacker's colour (the garbage cell's colour)
 * @returns {number}
 */
export function wellGarbageColor(attackerInt) {
    return lerp(GARBAGE_SLATE, attackerInt, GARBAGE_TINT);
}

/**
 * The ghost: the piece's colour, faint inside and outlined, where it will land.
 * @param {object} scene the board scene (fillContour, strokeLoops)
 * @param {object} graphics
 * @param {Array} loops the piece's contour loops (local px)
 * @param {number} colorInt the piece's colour
 * @param {number} offsetX px
 * @param {number} offsetY px
 * @param {number} pulse 0..1
 */
export function drawWellGhost(scene, graphics, loops, colorInt, offsetX, offsetY, pulse) {
    const fill = 0.14 + 0.08 * pulse;
    scene.fillContour(graphics, loops, colorInt, fill, offsetX, offsetY);
    const edge = lerp(colorInt, 0xffffff, 0.25);
    const width = Math.max(1.5, scene.blockSize * 0.05);
    scene.strokeLoops(graphics, loops, edge, width, 0.55 + 0.25 * pulse, offsetX, offsetY);
}
