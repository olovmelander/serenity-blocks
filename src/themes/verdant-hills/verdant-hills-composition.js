/**
 * Verdant Hills — where the lens stands and what it can see.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds. The lens stands in deep grass on the crown of the home hill and looks out
 * and a little down: sky over the top third, the valley and its ridges across the middle,
 * the brow of the hill along the bottom. On the left the old oak leans a bough over the
 * frame and the kites fly in the open sky beyond it; on the right the spur runs down past
 * the drystone wall and the gate to the windmill on the next hill (in single player the
 * score card stands on this side, over the sky the sun is in).
 */
import * as THREE from 'three/webgpu';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';

const { degToRad } = THREE.MathUtils;

/**
 * `position[1]` is eye height above the ground under the lens; `yaw` turns the view from
 * -Z (positive to the right) and `pitch` tips it (negative looks down), in degrees.
 */
export const VERDANT_HILLS_VIEWS = Object.freeze({
    landscape: Object.freeze({
        fov: 46, position: [0, 1.45, 0], yaw: 0, pitch: -5,
    }),
    portrait: Object.freeze({
        fov: 66, position: [0, 1.45, 0], yaw: -8, pitch: -4,
    }),
});

export function verdantHillsViewFor(aspect) {
    return aspect < 1.15 ? VERDANT_HILLS_VIEWS.portrait : VERDANT_HILLS_VIEWS.landscape;
}

/** World position of the lens for a framing. */
export function verdantHillsEye(view) {
    const [x, eye, z] = view.position;
    return [x, verdantHillsGroundHeight(x, z) + eye, z];
}

/** Unit direction a framing looks along. */
export function verdantHillsGaze(view) {
    const yaw = degToRad(view.yaw);
    const pitch = degToRad(view.pitch);
    return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** A point `reach` metres along a framing's line of sight. */
export function verdantHillsTarget(view, reach = 200) {
    const eye = verdantHillsEye(view);
    const gaze = verdantHillsGaze(view);
    return [eye[0] + gaze[0] * reach, eye[1] + gaze[1] * reach, eye[2] + gaze[2] * reach];
}

/**
 * A conservative test for "could this sphere ever be inside the frame". It is the union of
 * the landscape and portrait framings at their widest aspect, padded for pointer parallax,
 * and lets the world skip what no pixel will ever need.
 */
export function createVerdantHillsVisibilityTest() {
    const views = [
        { view: VERDANT_HILLS_VIEWS.landscape, tanV: Math.tan(degToRad(23)) * 1.14, aspect: 2.45 },
        { view: VERDANT_HILLS_VIEWS.portrait, tanV: Math.tan(degToRad(33)) * 1.14, aspect: 1.15 },
    ].map(({ view, tanV, aspect }) => {
        const eye = new THREE.Vector3(...verdantHillsEye(view));
        const forward = new THREE.Vector3(...verdantHillsGaze(view));
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward);
        return {
            eye, forward, right, up, tanV, tanH: tanV * aspect,
        };
    });
    const offset = new THREE.Vector3();
    return (x, y, z, radius) => views.some((frame) => {
        offset.set(x, y, z).sub(frame.eye);
        const depth = offset.dot(frame.forward);
        if (depth < -radius) return false;
        const reach = Math.max(depth, 0);
        return Math.abs(offset.dot(frame.right)) <= reach * frame.tanH + radius * 1.6
            && Math.abs(offset.dot(frame.up)) <= reach * frame.tanV + radius * 1.6;
    });
}

/**
 * The ground the lens can see, bearing by bearing: the home hill's own brow hides most of
 * the slope below it, and nothing needs to grow where no one can look. Each bearing is
 * walked once, outward, keeping the highest sight line so far; what rises above it (by
 * `clearance`, the height of what grows there) is in sight. `spot()` then draws places
 * from the visible stretches only, spread evenly in the logarithm of their distance, so
 * the screen is planted evenly from the lens to the far spurs.
 */
export class VerdantHillsSight {
    constructor({
        nearest = 1.2, farthest = 150, halfAngle = 54, columns = 144, clearance = 0.45,
        view = VERDANT_HILLS_VIEWS.landscape,
    } = {}) {
        const [ex, ey, ez] = verdantHillsEye(view);
        this.eye = { x: ex, y: ey, z: ez };
        this.halfAngle = degToRad(halfAngle);
        this.columns = [];
        const growth = 1.035;
        for (let column = 0; column < columns; column += 1) {
            const bearing = -this.halfAngle + (2 * this.halfAngle * (column + 0.5)) / columns;
            const sin = Math.sin(bearing);
            const cos = Math.cos(bearing);
            const spans = [];
            let ceiling = -Infinity;
            let open = null;
            for (let range = nearest; range <= farthest; range *= growth) {
                const ground = verdantHillsGroundHeight(ex + sin * range, ez - cos * range);
                const seen = (ground + clearance - ey) / range > ceiling;
                ceiling = Math.max(ceiling, (ground - ey) / range);
                if (seen && !open) open = [range, range];
                if (seen && open) open[1] = range * growth;
                if (!seen && open) {
                    spans.push(open);
                    open = null;
                }
            }
            if (open) spans.push(open);
            // Measure each stretch by the logarithm of its length: that is what `spot` spreads over.
            let measure = 0;
            const stretches = spans.map(([from, to]) => {
                measure += Math.log(Math.min(to, farthest) / from);
                return { from, to: Math.min(to, farthest), until: measure };
            });
            this.columns.push({
                sin, cos, stretches, measure,
            });
        }
    }

    /**
     * A place in sight between two distances, or null if this draw found none.
     * `u` picks the bearing (0..1 across `spread` radians either side of the gaze),
     * `v` the distance.
     */
    spot(u, v, nearest, farthest, spread = this.halfAngle) {
        const bearing = (u * 2 - 1) * Math.min(spread, this.halfAngle);
        const index = Math.min(
            this.columns.length - 1,
            Math.floor(((bearing + this.halfAngle) / (2 * this.halfAngle)) * this.columns.length),
        );
        const column = this.columns[index];
        // The stretches of this bearing that overlap the asked-for band.
        let total = 0;
        for (const stretch of column.stretches) {
            const from = Math.max(stretch.from, nearest);
            const to = Math.min(stretch.to, farthest);
            if (to > from) total += Math.log(to / from);
        }
        if (!(total > 0)) return null;
        // A bearing with little in sight is planted in proportion: the asked-for band is the whole.
        const whole = Math.log(farthest / nearest);
        let pick = v * whole;
        if (pick > total) return null;
        for (const stretch of column.stretches) {
            const from = Math.max(stretch.from, nearest);
            const to = Math.min(stretch.to, farthest);
            if (to > from) {
                const span = Math.log(to / from);
                if (pick <= span) {
                    const range = from * Math.exp(pick);
                    const sin = Math.sin(bearing);
                    const cos = Math.cos(bearing);
                    const x = this.eye.x + sin * range;
                    const z = this.eye.z - cos * range;
                    return {
                        x, y: verdantHillsGroundHeight(x, z), z, depth: range,
                    };
                }
                pick -= span;
            }
        }
        return null;
    }
}

/**
 * Whether the land leaves a single point in sight of the lens (see VerdantHillsSight for
 * planting many).
 */
export function verdantHillsInSight(x, y, z, view = VERDANT_HILLS_VIEWS.landscape) {
    const [ex, ey, ez] = verdantHillsEye(view);
    const range = Math.hypot(x - ex, z - ez);
    const steps = Math.max(4, Math.min(48, Math.ceil(range / 1.6)));
    for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        const px = ex + (x - ex) * t;
        const pz = ez + (z - ez) * t;
        if (ey + (y - ey) * t < verdantHillsGroundHeight(px, pz) - 0.04) return false;
    }
    return true;
}
