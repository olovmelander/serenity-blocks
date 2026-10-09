/**
 * Verdant Hills — where the board stands over the downs.
 *
 * The board is a DOM card in front of the canvas. VerdantHillsStage maps positions on that
 * card to the world: points on a plane a few metres in front of the camera (so a ribbon of
 * wind can curl away from behind the card exactly beside the action), points on the hills
 * seen through it (so a gust can spread through the grass from the foot of the board,
 * whichever way the slope runs) and the direction of the sky through any place on it (so a
 * kite can be flown there).
 */
import * as THREE from 'three/webgpu';

/** Screen fractions (y down) of the board card when the layout cannot be measured. */
export const VERDANT_HILLS_DEFAULT_BOARD = Object.freeze({
    x0: 0.385, x1: 0.615, y0: 0.09, y1: 0.93,
});
export const VERDANT_HILLS_STAGE_DEPTH = 8.5;
const BOARD_SELECTOR = '.player-card[data-player]';
const GROUND_NEAR = 1.5;
/** The view is a long one: the far slopes are a couple of hundred metres off. */
const GROUND_FAR = 260;
/** The march starts in fine steps at the hilltop and lengthens them as the land recedes. */
const GROUND_STEP = 0.75;
const GROUND_GROWTH = 1.06;
const GROUND_REFINEMENTS = 5;

/**
 * The union of the visible board cards in screen fractions (y down), or null when no
 * board is on screen (menus, boot) so the stage keeps its default.
 */
export function readVerdantHillsBoardRect(doc = globalThis.document, win = globalThis.window) {
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

export class VerdantHillsStage {
    constructor(camera) {
        this.camera = camera;
        this.board = { ...VERDANT_HILLS_DEFAULT_BOARD };
        this.origin = new THREE.Vector3();
        this.right = new THREE.Vector3(1, 0, 0);
        this.up = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(0, 0, -1);
        this.scratch = new THREE.Vector3();
        this.tanV = 0.47;
        this.tanH = 0.83;
        /** How far along its ray the last ground() lookup ended, in metres. */
        this.reach = 0;
        this.refresh();
    }

    /** Accept a measured card rectangle in screen fractions; ignore nonsense. */
    setBoard(rect) {
        const valid = rect && [rect.x0, rect.x1, rect.y0, rect.y1].every(Number.isFinite)
            && rect.x1 - rect.x0 > 0.04 && rect.y1 - rect.y0 > 0.1;
        const next = valid ? rect : VERDANT_HILLS_DEFAULT_BOARD;
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
    point(sx, sy, depth = VERDANT_HILLS_STAGE_DEPTH, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ny = 1 - sy * 2;
        return target.copy(this.origin)
            .addScaledVector(this.forward, depth)
            .addScaledVector(this.right, nx * depth * this.tanH)
            .addScaledVector(this.up, ny * depth * this.tanV);
    }

    /** The unit world direction of the ray through a screen position (fractions, y down). */
    ray(sx, sy, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ny = 1 - sy * 2;
        return target.copy(this.forward)
            .addScaledVector(this.right, nx * this.tanH)
            .addScaledVector(this.up, ny * this.tanV)
            .normalize();
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
    edge(side, row, depth = VERDANT_HILLS_STAGE_DEPTH, target = new THREE.Vector3(), inset = 0) {
        const { board } = this;
        const sx = side < 0 ? board.x0 + inset : board.x1 - inset;
        const sy = board.y1 + (board.y0 - board.y1) * clamp01(row);
        return this.point(sx, sy, depth, target);
    }

    centre(depth = VERDANT_HILLS_STAGE_DEPTH, target = new THREE.Vector3()) {
        const { board } = this;
        return this.point((board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2, depth, target);
    }

    /**
     * The point on the hills seen through a screen position: the first place along the ray
     * that lies under `height(x, z)`. The land falls away below the hilltop and climbs again
     * beyond the valley, so heights of either sign count as they are. A ray that meets
     * nothing (the sky, or a slope that drops away faster than the ray) ends at the far
     * reach, on the ground under it. `this.reach` keeps how far along the ray that was.
     */
    ground(sx, sy, height, target = new THREE.Vector3()) {
        const ray = this.ray(sx, sy, this.scratch);
        const { origin } = this;
        const under = (reach) => origin.y + ray.y * reach
            <= height(origin.x + ray.x * reach, origin.z + ray.z * reach);
        let low = GROUND_NEAR;
        let high = GROUND_NEAR;
        let step = GROUND_STEP;
        let met = under(high);
        while (!met && high < GROUND_FAR) {
            low = high;
            high = Math.min(GROUND_FAR, high + step);
            step *= GROUND_GROWTH;
            met = under(high);
        }
        if (met) {
            // The crossing lies between the last clear step and this one: halve it down.
            for (let refine = 0; refine < GROUND_REFINEMENTS; refine += 1) {
                const middle = (low + high) / 2;
                if (under(middle)) high = middle;
                else low = middle;
            }
        }
        this.reach = high;
        const x = origin.x + ray.x * high;
        const z = origin.z + ray.z * high;
        return target.set(x, height(x, z), z);
    }

    /** Half the width of the view at a depth, in metres. */
    halfWidth(depth = VERDANT_HILLS_STAGE_DEPTH) {
        return depth * this.tanH;
    }
}
