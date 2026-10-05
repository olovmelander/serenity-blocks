/**
 * Where the gameplay boards sit in the viewport, so a locked piece leaves for the hole from
 * where it landed. DOM reads force layout: call this on layout changes and a few frames
 * after them, never inside a bus handler. Import-safe in node — nothing touches `document`
 * until read.
 */
const CARD_SELECTOR = '.player-card[data-player]';
const BOARD_SELECTOR = '.phaser-board-container';
/** Rects smaller than this (CSS px) are hidden or collapsed boards, not layout. */
const MIN_WIDTH = 32;
const MIN_HEIGHT = 64;
/** Slot 0 is the lone board; 1–4 are multiplayer players. */
const SLOTS = 5;

function slotFor(card) {
    const player = card.getAttribute?.('data-player') ?? card.dataset?.player;
    if (player === 'solo') return 0;
    const index = Number(player);
    return Number.isInteger(index) && index >= 1 && index < SLOTS ? index : -1;
}

/**
 * @returns {Array<{slot:number,left:number,right:number,top:number,bottom:number}>} visible
 *   boards as fractions of the viewport (top-left origin). Slot 0 is always present when any
 *   board is: the solo board, or else the rectangle covering every multiplayer board.
 */
export function readBoardRects(doc = globalThis.document, win = globalThis.window) {
    if (!doc?.querySelectorAll || !win) return [];
    const width = win.innerWidth || 0;
    const height = win.innerHeight || 0;
    if (!(width > 0) || !(height > 0)) return [];
    const rects = [];
    let solo = null;
    const cover = {
        slot: 0, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity,
    };
    doc.querySelectorAll(CARD_SELECTOR).forEach((card) => {
        const slot = slotFor(card);
        if (slot < 0) return;
        if (typeof card.checkVisibility === 'function'
            && !card.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        const rect = (card.querySelector?.(BOARD_SELECTOR) ?? card).getBoundingClientRect?.();
        if (!rect || rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;
        if (rect.right <= 0 || rect.left >= width || rect.bottom <= 0 || rect.top >= height) return;
        const entry = {
            slot,
            left: rect.left / width,
            right: rect.right / width,
            top: rect.top / height,
            bottom: rect.bottom / height,
        };
        if (slot === 0) solo = entry;
        else rects.push(entry);
        cover.left = Math.min(cover.left, entry.left);
        cover.right = Math.max(cover.right, entry.right);
        cover.top = Math.min(cover.top, entry.top);
        cover.bottom = Math.max(cover.bottom, entry.bottom);
    });
    if (solo) rects.unshift(solo);
    else if (rects.length > 0) rects.unshift(cover);
    return rects;
}
