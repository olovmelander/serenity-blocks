/**
 * @fileoverview Local versus board style — the boards of LocalMultiplayerMode only
 * (local-board-hosts.js turns it on with BaseBoardScene.setVersusStyle). Single player
 * and the themes keep the base scene's look untouched.
 *
 * Pieces and the stack stay the base scene's solid, fused shapes. Versus changes two
 * things, in any theme's palette, so a race reads from the couch at a glance:
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
export function versusGarbageColor(attackerInt) {
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
export function drawVersusGhost(scene, graphics, loops, colorInt, offsetX, offsetY, pulse) {
    const fill = 0.14 + 0.08 * pulse;
    scene.fillContour(graphics, loops, colorInt, fill, offsetX, offsetY);
    const edge = lerp(colorInt, 0xffffff, 0.25);
    const width = Math.max(1.5, scene.blockSize * 0.05);
    scene.strokeLoops(graphics, loops, edge, width, 0.55 + 0.25 * pulse, offsetX, offsetY);
}
