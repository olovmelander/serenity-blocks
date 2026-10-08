/**
 * Forest — the stag the fireflies gather into.
 *
 * A red stag in profile, head up, described as plain geometry: tapered capsules for body,
 * neck, head and legs, and thin beams for the antlers. `createForestStagPoints` scatters
 * points over that figure, crowding them along its outline so a few hundred lights are
 * enough to read as an animal. Coordinates are metres: x toward the stag's nose, y up from
 * its hooves, z a little depth so the figure is not a flat card. Pure data, no three.js.
 */

// Tapered capsules: ax, ay, radius at a, bx, by, radius at b.
const BODY = [
    // barrel, haunch and chest
    [-0.72, 1.3, 0.36, 0.42, 1.27, 0.42],
    [-0.8, 1.36, 0.4, -0.78, 1.34, 0.4],
    [0.5, 1.2, 0.44, 0.52, 1.22, 0.44],
    // neck and head
    [0.62, 1.5, 0.3, 1.2, 2.2, 0.17],
    [1.18, 2.28, 0.17, 1.66, 2.14, 0.085],
    // ear, tail
    [1.16, 2.42, 0.05, 0.98, 2.64, 0.03],
    [-1.08, 1.5, 0.07, -1.16, 1.36, 0.04],
    // forelegs
    [0.5, 1.0, 0.13, 0.56, 0.5, 0.07],
    [0.56, 0.5, 0.07, 0.58, 0.03, 0.06],
    [0.66, 1.0, 0.12, 0.8, 0.52, 0.065],
    [0.8, 0.52, 0.065, 0.86, 0.03, 0.055],
    // hind legs
    [-0.78, 1.18, 0.2, -0.98, 0.58, 0.08],
    [-0.98, 0.58, 0.08, -0.86, 0.03, 0.06],
    [-0.6, 1.12, 0.18, -0.7, 0.56, 0.075],
    [-0.7, 0.56, 0.075, -0.52, 0.03, 0.055],
];

// Antler beams and tines as polylines; the second antler is the first, set back a little.
const ANTLER = [
    [[1.3, 2.44], [1.17, 2.84], [0.98, 3.18], [0.9, 3.52], [1.02, 3.84]],
    [[1.27, 2.56], [1.4, 2.66], [1.56, 2.84]],
    [[1.2, 2.76], [1.33, 2.9], [1.46, 3.08]],
    [[1.02, 3.12], [1.15, 3.24], [1.26, 3.4]],
    [[0.91, 3.5], [0.8, 3.68], [0.7, 3.88]],
    [[0.94, 3.62], [0.96, 3.8], [1.0, 3.98]],
];
const SECOND_ANTLER = { shiftX: -0.13, shiftY: -0.03, depth: -0.22 };

export const FOREST_STAG_BOUNDS = Object.freeze({
    minX: -1.3, maxX: 1.8, minY: 0, maxY: 4.05,
});

/** Signed distance to one tapered capsule (negative inside). */
function capsule(x, y, [ax, ay, ra, bx, by, rb]) {
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    return Math.hypot(x - ax - dx * t, y - ay - dy * t) - (ra + (rb - ra) * t);
}

/** Signed distance to the stag's body in its own plane (negative inside; antlers excluded). */
export function forestStagDistance(x, y) {
    let distance = Infinity;
    for (let i = 0; i < BODY.length; i += 1) distance = Math.min(distance, capsule(x, y, BODY[i]));
    return distance;
}

function polylineLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

function alongPolyline(points, distance) {
    let left = distance;
    for (let i = 1; i < points.length; i += 1) {
        const segment = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (left <= segment || i === points.length - 1) {
            const t = segment > 0 ? Math.min(1, left / segment) : 0;
            return [
                points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
                points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
            ];
        }
        left -= segment;
    }
    return points[points.length - 1];
}

/**
 * `count` points on the stag as a Float32Array of x, y, z, weight. `weight` is 1 on the
 * outline and the antlers and lower inside the body, so the outline can be drawn brighter.
 */
export function createForestStagPoints(count, rng = Math.random) {
    const total = Number.isFinite(count) ? Math.max(8, Math.floor(count)) : 8;
    const points = new Float32Array(total * 4);
    const antlers = Math.round(total * 0.24);
    const lengths = ANTLER.map(polylineLength);
    const antlerLength = lengths.reduce((sum, value) => sum + value, 0);
    let written = 0;
    // Antlers: evenly along every beam and tine, on both antlers.
    for (let i = 0; i < antlers; i += 1) {
        const second = i % 2 === 1;
        let distance = ((Math.floor(i / 2) + 0.5) / Math.ceil(antlers / 2)) * antlerLength;
        let line = 0;
        while (line < ANTLER.length - 1 && distance > lengths[line]) {
            distance -= lengths[line];
            line += 1;
        }
        const [x, y] = alongPolyline(ANTLER[line], distance);
        points.set([
            x + (second ? SECOND_ANTLER.shiftX : 0) + (rng() - 0.5) * 0.02,
            y + (second ? SECOND_ANTLER.shiftY : 0) + (rng() - 0.5) * 0.02,
            (second ? SECOND_ANTLER.depth : 0.12) + (rng() - 0.5) * 0.04,
            1,
        ], written * 4);
        written += 1;
    }
    // Body: rejection-sample the figure, keeping every point near its edge and a share of
    // those deep inside, so the outline carries the drawing.
    const { minX, maxX, minY } = FOREST_STAG_BOUNDS;
    let guard = 0;
    while (written < total && guard < total * 400) {
        guard += 1;
        const x = minX + (maxX - minX) * rng();
        const y = minY + (2.8 - minY) * rng();
        const distance = forestStagDistance(x, y);
        if (distance > 0) continue;
        const edge = distance > -0.045;
        if (!edge && rng() > 0.2) continue;
        // The figure is thickest through the barrel and thin at the legs.
        const girth = Math.min(0.2, -distance * 0.9 + 0.03);
        points.set([x, y, (rng() - 0.5) * 2 * girth, edge ? 1 : 0.55], written * 4);
        written += 1;
    }
    // A figure too small to fill (never in practice) repeats what it has.
    for (let i = written; i < total; i += 1) {
        const from = (i % Math.max(1, written)) * 4;
        points.copyWithin(i * 4, from, from + 4);
    }
    return points;
}
