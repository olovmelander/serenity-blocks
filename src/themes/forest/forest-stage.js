/**
 * Forest — where the board stands in the old wood.
 *
 * The board is a DOM card in front of the canvas. ForestStage maps positions on that card
 * to the world: points on a plane a few metres in front of the camera (so fireflies can
 * burst out from behind the card exactly beside the action) and points on the forest floor
 * behind it (so a locking piece can send its wave of light out from where it landed).
 */
import * as THREE from 'three/webgpu';

/** Screen fractions (y down) of the board card when the layout cannot be measured. */
export const FOREST_DEFAULT_BOARD = Object.freeze({
    x0: 0.385, x1: 0.615, y0: 0.09, y1: 0.93,
});
export const FOREST_STAGE_DEPTH = 8.5;
const BOARD_SELECTOR = '.player-card[data-player]';
const FLOOR_NEAR = 4;
const FLOOR_FAR = 46;

/**
 * The union of the visible board cards in screen fractions (y down), or null when no
 * board is on screen (menus, boot) so the stage keeps its default.
 */
export function readForestBoardRect(doc = globalThis.document, win = globalThis.window) {
    if (!doc || !win || typeof doc.querySelectorAll !== 'function') return null;
    const width = Math.max(1, win.innerWidth || 1);
    const height = Math.max(1, win.innerHeight || 1);
    let rect = null;
    doc.querySelectorAll(BOARD_SELECTOR).forEach((element) => {
        if (typeof element?.getBoundingClientRect !== 'function') return;
        const box = element.getBoundingClientRect();
        if (!(box.width > 8 && box.height > 8)) return;
        if (box.right <= 0 || box.bottom <= 0 || box.left >= width || box.top >= height) return;
        const style = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(element) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05)) {
            return;
        }
        const next = {
            x0: box.left / width, x1: box.right / width, y0: box.top / height, y1: box.bottom / height,
        };
        rect = rect ? {
            x0: Math.min(rect.x0, next.x0),
            x1: Math.max(rect.x1, next.x1),
            y0: Math.min(rect.y0, next.y0),
            y1: Math.max(rect.y1, next.y1),
        } : next;
    });
    return rect;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export class ForestStage {
    constructor(camera, groundHeight = () => 0) {
        this.camera = camera;
        this.groundHeight = groundHeight;
        this.board = { ...FOREST_DEFAULT_BOARD };
        this.origin = new THREE.Vector3();
        this.right = new THREE.Vector3(1, 0, 0);
        this.up = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(0, 0, -1);
        this.ray = new THREE.Vector3();
        this.tanV = 0.47;
        this.tanH = 0.83;
        this.refresh();
    }

    /** Accept a measured card rectangle in screen fractions; ignore nonsense. */
    setBoard(rect) {
        const valid = rect && [rect.x0, rect.x1, rect.y0, rect.y1].every(Number.isFinite)
            && rect.x1 - rect.x0 > 0.04 && rect.y1 - rect.y0 > 0.1;
        const next = valid ? rect : FOREST_DEFAULT_BOARD;
        this.board = {
            x0: clamp01(next.x0), x1: clamp01(next.x1), y0: clamp01(next.y0), y1: clamp01(next.y1),
        };
    }

    /** Re-read the camera's rest pose (call after it has been framed). */
    refresh() {
        const { camera } = this;
        camera.updateMatrixWorld(true);
        this.origin.setFromMatrixPosition(camera.matrixWorld);
        this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        this.forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
        this.tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        this.tanH = this.tanV * (camera.aspect || 16 / 9);
    }

    /** World point for a screen position (fractions, y down) at a view depth. */
    point(sx, sy, depth = FOREST_STAGE_DEPTH, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ny = 1 - sy * 2;
        return target.copy(this.origin)
            .addScaledVector(this.forward, depth)
            .addScaledVector(this.right, nx * depth * this.tanH)
            .addScaledVector(this.up, ny * depth * this.tanV);
    }

    /** Screen position of a place on the card: column 0..1 left to right, row 0 its foot, 1 its top. */
    screen(column, row) {
        const { board } = this;
        return {
            x: board.x0 + (board.x1 - board.x0) * clamp01(column),
            y: board.y1 + (board.y0 - board.y1) * clamp01(row),
        };
    }

    /** A point on the card's left (-1) or right (+1) edge; row 0 is its foot, 1 its top. */
    edge(side, row, depth = FOREST_STAGE_DEPTH, target = new THREE.Vector3(), inset = 0) {
        const { board } = this;
        const sx = side < 0 ? board.x0 + inset : board.x1 - inset;
        const sy = board.y1 + (board.y0 - board.y1) * clamp01(row);
        return this.point(sx, sy, depth, target);
    }

    centre(depth = FOREST_STAGE_DEPTH, target = new THREE.Vector3()) {
        const { board } = this;
        return this.point((board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2, depth, target);
    }

    /**
     * The point on the forest floor behind a place on the card. A column picks a bearing;
     * a row picks how far out along it (the foot of the board is near, its top far), so
     * the floor behind the card is addressed the way the card is.
     */
    floor(column, row, target = new THREE.Vector3()) {
        const { board } = this;
        // A column outside 0..1 is a bearing beside the card, out to the edges of the view.
        const sx = Math.max(-0.1, Math.min(1.1, board.x0 + (board.x1 - board.x0) * column));
        const nx = sx * 2 - 1;
        const ray = this.ray.copy(this.forward).addScaledVector(this.right, nx * this.tanH);
        const flat = Math.hypot(ray.x, ray.z) || 1;
        const reach = FLOOR_NEAR + (FLOOR_FAR - FLOOR_NEAR) * clamp01(row) ** 1.35;
        const x = this.origin.x + (ray.x / flat) * reach;
        const z = this.origin.z + (ray.z / flat) * reach;
        return target.set(x, this.groundHeight(x, z), z);
    }

    /** Half the width of the view at a depth, in metres. */
    halfWidth(depth = FOREST_STAGE_DEPTH) {
        return depth * this.tanH;
    }
}
