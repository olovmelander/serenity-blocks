/**
 * Summer — where the board stands over the meadow and the lake.
 *
 * The board is a DOM card in front of the canvas. SummerStage maps positions on that
 * card to the world: points on a plane a few metres in front of the camera (so petals can
 * burst out from behind the card exactly beside the action), points on the water behind it
 * (so a locking piece can drop its ring where it landed) and points on the meadow at its
 * foot (so a gust can spread through the grass from there).
 */
import * as THREE from 'three/webgpu';

/** Screen fractions (y down) of the board card when the layout cannot be measured. */
export const SUMMER_DEFAULT_BOARD = Object.freeze({
    x0: 0.385, x1: 0.615, y0: 0.09, y1: 0.93,
});
export const SUMMER_STAGE_DEPTH = 8.5;
const BOARD_SELECTOR = '.player-card[data-player]';
const WATER_NEAR = 4;
const WATER_FAR = 64;
const GROUND_NEAR = 1.5;
const GROUND_FAR = 70;
const GROUND_STEP = 0.75;
/** How far along a bearing to look for the lake, and how deep the bed must lie to count as water. */
const LAKE_SEARCH = 90;
const LAKE_DEPTH = -0.05;

/**
 * The union of the visible board cards in screen fractions (y down), or null when no
 * board is on screen (menus, boot) so the stage keeps its default.
 */
export function readSummerBoardRect(doc = globalThis.document, win = globalThis.window) {
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

export class SummerStage {
    constructor(camera) {
        this.camera = camera;
        this.board = { ...SUMMER_DEFAULT_BOARD };
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
        const next = valid ? rect : SUMMER_DEFAULT_BOARD;
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
    point(sx, sy, depth = SUMMER_STAGE_DEPTH, target = new THREE.Vector3()) {
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
    edge(side, row, depth = SUMMER_STAGE_DEPTH, target = new THREE.Vector3(), inset = 0) {
        const { board } = this;
        const sx = side < 0 ? board.x0 + inset : board.x1 - inset;
        const sy = board.y1 + (board.y0 - board.y1) * clamp01(row);
        return this.point(sx, sy, depth, target);
    }

    centre(depth = SUMMER_STAGE_DEPTH, target = new THREE.Vector3()) {
        const { board } = this;
        return this.point((board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2, depth, target);
    }

    /**
     * The point on the lake (y = 0) seen through a screen position. Rows above the horizon
     * have no such point, so the ray is taken at the far end of the reach instead.
     */
    water(sx, sy, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ny = 1 - sy * 2;
        const ray = this.ray.copy(this.forward)
            .addScaledVector(this.right, nx * this.tanH)
            .addScaledVector(this.up, ny * this.tanV);
        const flat = Math.hypot(ray.x, ray.z) || 1;
        let reach = WATER_FAR;
        if (ray.y < -1e-4) reach = Math.min(WATER_FAR, (this.origin.y / -ray.y) * flat);
        reach = Math.max(WATER_NEAR, reach);
        return target.set(this.origin.x + (ray.x / flat) * reach, 0, this.origin.z + (ray.z / flat) * reach);
    }

    /**
     * The point on the land seen through a screen position: the first place along the ray
     * that lies under `height(x, z)` (or under the lake). A ray that meets nothing ends at
     * the far reach.
     */
    ground(sx, sy, height, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ny = 1 - sy * 2;
        const ray = this.ray.copy(this.forward)
            .addScaledVector(this.right, nx * this.tanH)
            .addScaledVector(this.up, ny * this.tanV)
            .normalize();
        const { origin } = this;
        const under = (reach) => origin.y + ray.y * reach
            <= Math.max(0, height(origin.x + ray.x * reach, origin.z + ray.z * reach));
        let found = GROUND_FAR;
        let previous = GROUND_NEAR;
        for (let reach = GROUND_NEAR; reach <= GROUND_FAR; reach += GROUND_STEP) {
            if (under(reach)) {
                let low = previous;
                let high = reach;
                for (let refine = 0; refine < 5; refine += 1) {
                    const middle = (low + high) / 2;
                    if (under(middle)) high = middle;
                    else low = middle;
                }
                found = high;
                break;
            }
            previous = reach;
        }
        const x = origin.x + ray.x * found;
        const z = origin.z + ray.z * found;
        return target.set(x, Math.max(0, height(x, z)), z);
    }

    /**
     * A point on open water in the direction of a screen column: the first water past the
     * near shore, then `out` metres further along the same bearing (drawn back if that
     * would run aground on a far shore). The meadow lies between this camera and the lake,
     * so the lower rows of the board look at grass; a ring meant for the lake is placed by
     * bearing and reach, not by where the ray through the card happens to land.
     */
    lake(sx, out, height, target = new THREE.Vector3()) {
        const nx = sx * 2 - 1;
        const ray = this.ray.copy(this.forward).addScaledVector(this.right, nx * this.tanH);
        const flat = Math.hypot(ray.x, ray.z) || 1;
        const dx = ray.x / flat;
        const dz = ray.z / flat;
        const { origin } = this;
        const wet = (reach) => height(origin.x + dx * reach, origin.z + dz * reach) < LAKE_DEPTH;
        let shore = -1;
        for (let reach = WATER_NEAR; reach <= LAKE_SEARCH; reach += 1) {
            if (wet(reach)) {
                shore = reach;
                break;
            }
        }
        // No water on this bearing: the old answer (lake level under the ray) is the best left.
        if (shore < 0) return this.water(sx, 0.6, target);
        let reach = shore + Math.max(0, Number.isFinite(out) ? out : 0);
        // Draw back a metre at a time, but never past the first water: `shore` itself is wet.
        while (reach > shore && !wet(reach)) reach = Math.max(shore, reach - 1);
        return target.set(origin.x + dx * reach, 0, origin.z + dz * reach);
    }

    /** Half the width of the view at a depth, in metres. */
    halfWidth(depth = SUMMER_STAGE_DEPTH) {
        return depth * this.tanH;
    }
}
