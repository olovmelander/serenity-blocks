/**
 * Luminous Tides — the frame (CPU only, three-free): where the horizon stands for a screen shape,
 * and where on screen a locked piece's drop falls into the surf beside the card.
 *
 * The card stands in the middle of the picture like a pane of dark glass, so the picture is built
 * round it: the open sea and its diagonal lines of surf on the left, with the far coast's warm
 * glow low over them; the beach curving away to the palms on the right; the near swash at the
 * foot of the frame. The layout reader (luminous-tides-composition.js) gives the card and HUD
 * rects; this module turns them into the frame and the aim.
 */
import { clamp, clamp01 } from './luminous-tides-core.js';
import { BOARD_GRID } from './luminous-tides-composition.js';

/**
 * The frame for an aspect and a layout (`layout` as readLayoutRects gives it, or null):
 *   horizon   where the horizon stands on screen (fraction of the height, from the top)
 *   yaw       how far the eye turns from the view line (degrees, + right): a tall screen turns
 *             it a little toward the sea so the surf stays in the strip it shows
 * The pitch that puts the horizon there depends on the lens: the world works it out.
 */
export function frameFor(aspect, layout, out = {}) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const tall = clamp01((1.15 - a) / 0.6);
    out.horizon = 0.4 + (0.3 - 0.4) * tall;
    out.yaw = -7 * tall;
    out.cards = layout?.cards?.length || 0;
    return out;
}

/**
 * Where on screen a locked piece's drop falls (screen fractions, y down).
 *
 * The card hides what is behind it, so the drop falls BESIDE it: on the side its column is nearer,
 * further out the further its column is from the middle, and nearer the eye the lower the piece
 * came to rest (a piece on the floor falls into the near swash at the foot of the frame; one high
 * on a tall stack falls out in the surf toward the horizon). On the right the stats bar is kept
 * clear. With no room beside the card it falls under it. `jitter` (two numbers in −1..1) keeps two
 * pieces off the same spot.
 */
export function aimLanding(layout, card, piece, u, row, horizon, jitter = null, out = { x: 0.5, y: 0.9 }) {
    const depth = clamp01(row / (BOARD_GRID.rows - 1));
    const jx = jitter ? jitter[0] : 0;
    const jy = jitter ? jitter[1] : 0;
    const top = horizon + 0.1;
    const leftRoom = card.x0;
    const hud = layout?.hud && layout.hud.x0 >= card.x1 - 0.02 ? layout.hud : null;
    const rightFrom = hud ? hud.x1 : card.x1;
    const rightRoom = 1 - rightFrom;
    const side = u < 0.5 ? -1 : 1;
    if (side < 0 && leftRoom > 0.12) {
        // The sea side: the whole depth of the surf, from far out to the near swash.
        const y = top + (0.95 - top) * depth ** 0.8 + jy * 0.025;
        const reach = (1 - 2 * u) * (leftRoom - 0.075) * 0.86;
        out.x = clamp(card.x0 - 0.04 - reach + jx * 0.018, 0.02, card.x0 - 0.02);
        out.y = clamp(y, top, 0.975);
    } else if (side > 0 && rightRoom > 0.1) {
        // The beach side: the swash band curving away (the world keeps the drop on wet sand).
        const y = top + (0.9 - top) * depth ** 0.9 + jy * 0.02;
        const reach = (2 * u - 1) * (rightRoom - 0.06) * 0.86;
        out.x = clamp(rightFrom + 0.035 + reach + jx * 0.018, rightFrom + 0.015, 0.98);
        out.y = clamp(y, top, 0.975);
    } else if (side > 0 && leftRoom > 0.12) {
        // No room on the right: it crosses to the sea side, close in by the card.
        out.x = clamp(card.x0 - 0.035 - (1 - u) * 0.08 + jx * 0.018, 0.02, card.x0 - 0.015);
        out.y = clamp(top + (0.95 - top) * depth ** 0.8, top, 0.975);
    } else if (card.y1 < 0.93) {
        out.x = clamp(piece.x + jx * 0.03, 0.03, 0.97);
        out.y = clamp(card.y1 + 0.025 + (1 - depth) * 0.02 + Math.abs(jy) * 0.015, top, 0.985);
    } else {
        out.x = side < 0 ? Math.max(0.015, leftRoom * 0.5) : Math.min(0.985, 1 - rightRoom * 0.5);
        out.y = clamp(top + (0.95 - top) * depth ** 0.8, top, 0.975);
    }
    return out;
}

/**
 * Where a clear's wave of light starts along the screen: the margin beside the card at the cleared
 * rows' height, on the sea side (fractions). The world casts it onto the break line.
 */
export function aimClear(layout, card, rowY, out = { x: 0.2, y: 0.6 }) {
    const leftRoom = card ? card.x0 : 0.4;
    out.x = clamp(leftRoom * 0.55, 0.04, 0.4);
    out.y = rowY;
    return out;
}
