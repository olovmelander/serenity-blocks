/**
 * Forest — the animals the fireflies gather into.
 *
 * The creatures of an old northern wood, each described as plain geometry in profile (the
 * owl and the lynx face you):
 * tapered capsules for body, neck, head and legs, closed outlines for what a capsule cannot
 * say (a wing, an ear, a fanned tail), holes for an eye, and thin strokes for antlers,
 * whiskers and spines. `createForestFigurePoints` scatters points over a figure, crowding
 * them along its outline so a few hundred lights are enough to read as an animal.
 * Coordinates are metres before the figure's `scale`: x toward the nose, y up from the
 * ground, z a little depth so the figure is not a flat card. Pure data, no three.js.
 */

/** How far inside the outline a point still counts as being on it. */
const EDGE = 0.045;
/** The grid a figure's body is searched on, in its own metres. */
const CELL = 0.05;
/** How many places are found on an outline for every light that will stand on it. */
const CHOICE = 4;
/** Strokes stand a little off the body's plane; a twin stroke has a depth of its own. */
const STROKE_DEPTH = 0.12;
const DEG = Math.PI / 180;

/**
 * Signed distance to one tapered capsule (negative inside). Plain indexing and a square
 * root: this runs some hundred thousand times while a wood's animals are laid out.
 */
function capsule(x, y, part) {
    const ax = part[0];
    const ay = part[1];
    const ra = part[2];
    const dx = part[3] - ax;
    const dy = part[4] - ay;
    const length = dx * dx + dy * dy;
    const t = length > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    const px = x - ax - dx * t;
    const py = y - ay - dy * t;
    return Math.sqrt(px * px + py * py) - (ra + (part[5] - ra) * t);
}

/** Signed distance to a closed outline (negative inside). */
function outline(x, y, points) {
    let nearest = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const xi = points[i][0];
        const yi = points[i][1];
        const xj = points[j][0];
        const yj = points[j][1];
        const ex = xj - xi;
        const ey = yj - yi;
        const length = ex * ex + ey * ey;
        const t = length > 1e-9 ? Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / length)) : 0;
        const px = x - xi - ex * t;
        const py = y - yi - ey * t;
        nearest = Math.min(nearest, px * px + py * py);
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? -Math.sqrt(nearest) : Math.sqrt(nearest);
}

function distanceTo(body, shapes, holes, x, y) {
    let distance = Infinity;
    for (let i = 0; i < body.length; i += 1) distance = Math.min(distance, capsule(x, y, body[i]));
    for (let i = 0; i < shapes.length; i += 1) distance = Math.min(distance, outline(x, y, shapes[i]));
    for (let i = 0; i < holes.length; i += 1) distance = Math.max(distance, -capsule(x, y, holes[i]));
    return distance;
}

/** The box round each part, four numbers a part: least x, least y, greatest x, greatest y. */
function boxesOf(body, shapes) {
    const boxes = new Float64Array((body.length + shapes.length) * 4);
    body.forEach(([ax, ay, ra, bx, by, rb], i) => {
        boxes.set([Math.min(ax - ra, bx - rb), Math.min(ay - ra, by - rb),
            Math.max(ax + ra, bx + rb), Math.max(ay + ra, by + rb)], i * 4);
    });
    shapes.forEach((points, i) => {
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        boxes.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (body.length + i) * 4);
    });
    return boxes;
}

/**
 * Signed distance to a figure's body in its own plane (negative inside; strokes excluded).
 * A part whose box lies further off than the nearest part found so far cannot be nearer,
 * and a part whose box the point is outside cannot hold it: those are not measured.
 */
export function forestFigureDistance(figure, x, y) {
    const {
        body, shapes, holes, boxes,
    } = figure;
    let distance = Infinity;
    for (let i = 0; i < body.length + shapes.length; i += 1) {
        const dx = Math.max(boxes[i * 4] - x, 0, x - boxes[i * 4 + 2]);
        const dy = Math.max(boxes[i * 4 + 1] - y, 0, y - boxes[i * 4 + 3]);
        const away = dx * dx + dy * dy;
        if (!(away > 0 && (distance < 0 || away >= distance * distance))) {
            const part = i < body.length ? capsule(x, y, body[i]) : outline(x, y, shapes[i - body.length]);
            distance = Math.min(distance, part);
        }
    }
    for (let i = 0; i < holes.length; i += 1) distance = Math.max(distance, -capsule(x, y, holes[i]));
    return distance;
}

/** `count` straight strokes fanned round a centre, from `inner` to `outer` (degrees from the nose's side). */
function fan(cx, cy, inner, outer, from, to, count) {
    return Array.from({ length: count }, (_, i) => {
        const angle = (from + ((to - from) * i) / Math.max(1, count - 1)) * DEG;
        return [
            [cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner],
            [cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer],
        ];
    });
}

/** A fanned tail as one outline: `feathers` rounded tips round a centre, notched between. */
function fanned(cx, cy, radius, from, to, feathers, notch = 0.9) {
    const points = [[cx, cy]];
    for (let i = 0; i <= feathers * 2; i += 1) {
        const angle = (from + ((to - from) * i) / (feathers * 2)) * DEG;
        const reach = radius * (i % 2 === 0 ? notch : 1);
        points.push([cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach]);
    }
    return points;
}

/**
 * Strokes that stand on a body's surface, as fur or spines do: from a point inside, one
 * stroke for each direction between `from` and `to` degrees, `length` long, leaning `lean`
 * degrees toward the tail.
 */
function bristles(body, [cx, cy], from, to, count, length, lean = 0) {
    return Array.from({ length: count }, (_, i) => {
        const angle = (from + ((to - from) * i) / Math.max(1, count - 1)) * DEG;
        let reach = 0;
        while (reach < 6 && distanceTo(body, [], [], cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach) < 0) {
            reach += 0.01;
        }
        const x = cx + Math.cos(angle) * (reach - 0.03);
        const y = cy + Math.sin(angle) * (reach - 0.03);
        const out = angle + lean * DEG;
        return [[x, y], [x + Math.cos(out) * length, y + Math.sin(out) * length]];
    });
}

const mirrored = (points) => points.map(([x, y]) => [-x, y]);

function measure(body, shapes, strokes, twin) {
    const box = {
        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    };
    const take = (x, y, margin = 0) => {
        box.minX = Math.min(box.minX, x - margin);
        box.maxX = Math.max(box.maxX, x + margin);
        box.minY = Math.min(box.minY, y - margin);
        box.maxY = Math.max(box.maxY, y + margin);
    };
    body.forEach(([ax, ay, ra, bx, by, rb]) => {
        take(ax, ay, ra);
        take(bx, by, rb);
    });
    shapes.forEach((points) => points.forEach(([x, y]) => take(x, y)));
    strokes.forEach((points) => points.forEach(([x, y]) => {
        take(x, y);
        if (twin) take(x + twin.shiftX, y + twin.shiftY);
    }));
    return box;
}

/**
 * The room a figure has where it stands, in metres in the forest: behind it (an old pine
 * stands close on that side), toward its nose, and overhead. It is the room the stag takes.
 */
export const FOREST_FIGURE_ROOM = Object.freeze({ back: 1.3 * 1.28, front: 1.8 * 1.28, height: 4.05 * 1.28 });

/**
 * One animal. `body` is tapered capsules (ax, ay, radius at a, bx, by, radius at b),
 * `shapes` closed outlines, `holes` capsules cut out of both, `strokes` polylines drawn in
 * light. `twin` draws every stroke a second time, set back (the far antler). `strokeShare`
 * is the share of the lights that go on the strokes, `fill` the share of the rest that
 * stand inside the body instead of on its outline, `scale` its size in the forest. A figure
 * is set in the middle of the room it has unless it says where it stands.
 */
function animal(id, {
    body, shapes = [], holes = [], strokes = [], twin = null, strokeShare = 0, fill = 0.08, scale = 1.28,
    bounds = null, sample = null,
}) {
    const tight = measure(body, shapes, strokes, twin);
    const middle = (FOREST_FIGURE_ROOM.front - FOREST_FIGURE_ROOM.back) / 2 / scale;
    const shift = bounds ? 0 : middle - (tight.minX + tight.maxX) / 2;
    const moved = (points) => points.map(([x, y]) => [x + shift, y]);
    const placed = body.map(([ax, ay, ra, bx, by, rb]) => [ax + shift, ay, ra, bx + shift, by, rb]);
    const placedShapes = shapes.map(moved);
    const filled = measure(placed, placedShapes, [], null);
    return Object.freeze({
        id,
        scale,
        strokeShare,
        fill,
        twin,
        body: placed,
        shapes: placedShapes,
        boxes: boxesOf(placed, placedShapes),
        holes: holes.map(([ax, ay, ra, bx, by, rb]) => [ax + shift, ay, ra, bx + shift, by, rb]),
        strokes: strokes.map(moved),
        // Everything the figure reaches, strokes included; and the box its body is found in.
        bounds: Object.freeze(bounds || {
            minX: tight.minX + shift, maxX: tight.maxX + shift, minY: Math.max(0, tight.minY), maxY: tight.maxY,
        }),
        sample: Object.freeze(sample || { ...filled, minY: Math.max(0, filled.minY) }),
    });
}

// --- The stag: a red stag in profile, head up. The first of them. -------------------------

const STAG = animal('stag', {
    body: [
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
    ],
    // Antler beams and tines; the second antler is the first, set back a little.
    strokes: [
        [[1.3, 2.44], [1.17, 2.84], [0.98, 3.18], [0.9, 3.52], [1.02, 3.84]],
        [[1.27, 2.56], [1.4, 2.66], [1.56, 2.84]],
        [[1.2, 2.76], [1.33, 2.9], [1.46, 3.08]],
        [[1.02, 3.12], [1.15, 3.24], [1.26, 3.4]],
        [[0.91, 3.5], [0.8, 3.68], [0.7, 3.88]],
        [[0.94, 3.62], [0.96, 3.8], [1.0, 3.98]],
    ],
    twin: { shiftX: -0.13, shiftY: -0.03, depth: -0.22 },
    strokeShare: 0.24,
    // The stag keeps more of its lights inside than the others: it was always a body of
    // sparks under its antlers, not a line.
    fill: 0.2,
    bounds: {
        minX: -1.3, maxX: 1.8, minY: 0, maxY: 4.05,
    },
    sample: {
        minX: -1.3, maxX: 1.8, minY: 0, maxY: 2.8,
    },
});

// --- The moose: a bull, long in the leg, humped at the shoulder, with palmate antlers. -----

const MOOSE = animal('moose', {
    body: [
        // barrel, rump, the hump over the shoulders, the deep chest
        [-0.7, 2.0, 0.42, 0.35, 2.0, 0.5],
        [-0.86, 2.04, 0.4, -0.8, 2.02, 0.4],
        [0.28, 2.32, 0.36, 0.5, 2.28, 0.34],
        [0.5, 1.86, 0.46, 0.52, 1.9, 0.46],
        // neck, the long head, the overhanging muzzle
        [0.7, 2.2, 0.34, 1.12, 2.42, 0.24],
        [1.1, 2.5, 0.22, 1.62, 2.16, 0.17],
        [1.62, 2.14, 0.18, 1.7, 2.04, 0.17],
        // bell, ear, tail
        [1.0, 2.2, 0.1, 1.04, 1.86, 0.045],
        [0.98, 2.66, 0.07, 0.76, 2.78, 0.035],
        [-1.22, 2.12, 0.06, -1.26, 1.98, 0.04],
        // forelegs
        [0.48, 1.6, 0.16, 0.52, 0.85, 0.085],
        [0.52, 0.85, 0.085, 0.5, 0.04, 0.075],
        [0.7, 1.6, 0.14, 0.86, 0.86, 0.08],
        [0.86, 0.86, 0.08, 0.92, 0.04, 0.07],
        // hind legs
        [-0.78, 1.85, 0.24, -0.98, 0.95, 0.1],
        [-0.98, 0.95, 0.1, -0.86, 0.04, 0.075],
        [-0.58, 1.8, 0.2, -0.66, 0.92, 0.09],
        [-0.66, 0.92, 0.09, -0.5, 0.04, 0.07],
    ],
    shapes: [
        // The antler: a beam, then the broad palm held over the head like an open hand, its
        // points standing along the top.
        [[0.96, 2.68], [0.84, 2.92], [0.58, 3.08], [0.4, 3.44], [0.58, 3.4], [0.54, 3.86], [0.74, 3.56],
            [0.8, 4.02], [0.96, 3.62], [1.1, 4.04], [1.2, 3.6], [1.42, 3.92], [1.4, 3.5], [1.64, 3.62],
            [1.46, 3.26], [1.24, 3.08], [1.1, 2.76]],
    ],
    strokes: [
        // brow tine
        [[1.14, 2.94], [1.4, 2.98], [1.58, 3.14]],
    ],
    strokeShare: 0.03,
    scale: 1.25,
});

// --- The bear: a brown bear risen on its hind legs, forepaws hanging, nose to the wind. ----

const BEAR = animal('bear', {
    body: [
        // hips and belly, chest, the hump of the shoulders
        [0.0, 1.5, 0.62, 0.1, 2.1, 0.62],
        [0.1, 2.1, 0.62, 0.3, 2.9, 0.56],
        [0.2, 3.0, 0.5, 0.3, 3.1, 0.46],
        // neck, head, muzzle
        [0.4, 3.2, 0.4, 0.6, 3.5, 0.34],
        [0.62, 3.55, 0.33, 0.9, 3.5, 0.27],
        [0.95, 3.46, 0.19, 1.2, 3.4, 0.14],
        // ears, tail
        [0.5, 3.86, 0.11, 0.48, 3.9, 0.1],
        [0.74, 3.84, 0.1, 0.74, 3.87, 0.09],
        [-0.6, 1.5, 0.1, -0.66, 1.42, 0.08],
        // forelegs, held out and down, and their paws
        [0.5, 2.85, 0.26, 0.95, 2.4, 0.2],
        [0.95, 2.4, 0.2, 1.2, 2.05, 0.16],
        [1.2, 2.05, 0.15, 1.34, 1.9, 0.12],
        [0.55, 2.6, 0.24, 1.0, 2.1, 0.18],
        [1.0, 2.1, 0.18, 1.2, 1.72, 0.15],
        [1.2, 1.72, 0.14, 1.32, 1.58, 0.11],
        // hind legs and feet
        [-0.2, 1.3, 0.42, -0.1, 0.6, 0.3],
        [-0.1, 0.6, 0.3, 0.0, 0.2, 0.22],
        [0.0, 0.14, 0.16, 0.42, 0.12, 0.12],
        [0.25, 1.3, 0.38, 0.4, 0.62, 0.27],
        [0.4, 0.62, 0.27, 0.5, 0.2, 0.2],
        [0.5, 0.14, 0.15, 0.88, 0.12, 0.11],
    ],
    strokes: [
        // claws
        [[1.38, 1.86], [1.5, 1.72]],
        [[1.34, 1.8], [1.42, 1.64]],
        [[1.36, 1.54], [1.48, 1.4]],
        [[1.32, 1.48], [1.4, 1.32]],
    ],
    strokeShare: 0.03,
    scale: 1.28,
});

// --- The wolf: standing square, head thrown back, howling at the moon it faces. ------------

const WOLF = animal('wolf', {
    body: [
        // the deep chest, the barrel tucked up to the waist, haunch
        [0.4, 1.52, 0.44, 0.48, 1.62, 0.44],
        [-0.45, 1.6, 0.3, 0.38, 1.55, 0.4],
        [-0.62, 1.58, 0.36, -0.58, 1.5, 0.36],
        // the thick neck, the head thrown back, the muzzle to the sky, the open jaw under it
        [0.48, 1.85, 0.46, 0.72, 2.45, 0.34],
        [0.74, 2.5, 0.28, 0.9, 2.9, 0.2],
        [0.92, 2.92, 0.15, 1.05, 3.46, 0.07],
        [0.98, 2.84, 0.1, 1.32, 3.18, 0.04],
        // the brush, hanging to the hocks
        [-0.92, 1.6, 0.13, -1.16, 1.16, 0.19],
        [-1.16, 1.16, 0.19, -1.2, 0.8, 0.15],
        [-1.2, 0.8, 0.15, -1.17, 0.6, 0.05],
        // forelegs and paws
        [0.44, 1.25, 0.17, 0.5, 0.62, 0.1],
        [0.5, 0.62, 0.1, 0.52, 0.1, 0.095],
        [0.52, 0.09, 0.1, 0.7, 0.08, 0.085],
        [0.68, 1.25, 0.15, 0.86, 0.64, 0.095],
        [0.86, 0.64, 0.095, 0.92, 0.1, 0.09],
        [0.92, 0.09, 0.09, 1.08, 0.08, 0.08],
        // hind legs, bent at the hock
        [-0.6, 1.4, 0.26, -0.74, 0.86, 0.12],
        [-0.74, 0.86, 0.12, -0.9, 0.5, 0.09],
        [-0.9, 0.5, 0.09, -0.84, 0.1, 0.09],
        [-0.84, 0.09, 0.1, -0.66, 0.08, 0.085],
        [-0.36, 1.36, 0.22, -0.4, 0.84, 0.11],
        [-0.4, 0.84, 0.11, -0.54, 0.5, 0.085],
        [-0.54, 0.5, 0.085, -0.46, 0.1, 0.085],
        [-0.46, 0.09, 0.09, -0.3, 0.08, 0.08],
    ],
    shapes: [
        // ears, laid back
        [[0.6, 2.78], [0.1, 2.98], [0.5, 2.5]],
        [[0.72, 2.9], [0.3, 3.26], [0.52, 2.7]],
    ],
    scale: 1.45,
});

// --- The owl: an eagle owl seen from the front, wings spread, coming in to land. -----------

const OWL_WING = [
    // (its root lies well inside the body, so no chink of night is left where they meet)
    [0.24, 3.04], [0.7, 3.5], [1.15, 3.76], [1.5, 3.72],
    // the fingered tip
    [1.82, 3.78], [1.62, 3.52], [1.9, 3.48], [1.64, 3.28], [1.84, 3.14], [1.56, 3.04], [1.66, 2.82],
    // the scalloped trailing edge
    [1.36, 2.82], [1.3, 2.52], [1.06, 2.68], [0.94, 2.38], [0.72, 2.56], [0.56, 2.28], [0.24, 2.46],
];

const OWL = animal('owl', {
    body: [
        // breast and belly, and the great round head
        [0, 2.7, 0.46, 0, 2.2, 0.36],
        [0, 3.3, 0.6, 0, 3.34, 0.6],
    ],
    shapes: [
        OWL_WING,
        mirrored(OWL_WING),
        // ear tufts
        [[-0.52, 3.6], [-0.7, 4.16], [-0.2, 3.86]],
        [[0.52, 3.6], [0.7, 4.16], [0.2, 3.86]],
        // tail, spread under it
        [[-0.32, 2.0], [0.32, 2.0], [0.5, 1.5], [0.26, 1.38], [0, 1.48], [-0.26, 1.38], [-0.5, 1.5]],
    ],
    // its eyes
    holes: [
        [-0.27, 3.36, 0.21, -0.27, 3.36, 0.21],
        [0.27, 3.36, 0.21, 0.27, 3.36, 0.21],
    ],
    strokes: [
        // beak
        [[-0.07, 3.1], [0, 2.92], [0.07, 3.1]],
    ],
    strokeShare: 0.02,
    scale: 1.04,
});

// --- The fox: sitting, ears up, brush laid out behind it. ---------------------------------

const FOX = animal('fox', {
    body: [
        // haunch, the sloping back, chest
        [-0.35, 0.55, 0.5, -0.3, 0.6, 0.5],
        [-0.25, 0.8, 0.44, 0.15, 1.6, 0.3],
        [0.2, 1.4, 0.3, 0.22, 1.5, 0.3],
        // neck, head, the pointed muzzle
        [0.2, 1.75, 0.24, 0.3, 2.1, 0.2],
        [0.32, 2.2, 0.24, 0.52, 2.16, 0.18],
        [0.55, 2.14, 0.13, 0.95, 2.02, 0.04],
        // foreleg and paw, hind foot
        [0.3, 1.3, 0.14, 0.38, 0.6, 0.085],
        [0.38, 0.6, 0.085, 0.4, 0.06, 0.075],
        [0.4, 0.06, 0.07, 0.54, 0.05, 0.055],
        [-0.2, 0.12, 0.12, 0.22, 0.08, 0.08],
        // brush, lifted clear of the grass
        [-0.7, 0.5, 0.2, -1.2, 0.6, 0.3],
        [-1.2, 0.6, 0.3, -1.55, 1.0, 0.26],
        [-1.55, 1.0, 0.26, -1.6, 1.45, 0.1],
    ],
    shapes: [
        // ears
        [[0.1, 2.36], [0.14, 2.86], [0.36, 2.42]],
        [[0.3, 2.4], [0.42, 2.84], [0.52, 2.36]],
    ],
    scale: 1.4,
});

// --- The hare: sat up on its haunches, ears high, listening. -------------------------------

const HARE = animal('hare', {
    body: [
        // haunch, the upright body, neck
        [-0.3, 0.55, 0.52, -0.2, 0.62, 0.5],
        [-0.15, 0.8, 0.46, 0.2, 1.7, 0.32],
        [0.25, 1.8, 0.28, 0.32, 2.05, 0.24],
        // head and nose
        [0.36, 2.2, 0.26, 0.6, 2.14, 0.2],
        [0.6, 2.12, 0.18, 0.78, 2.06, 0.12],
        // ears
        [0.26, 2.4, 0.09, 0.12, 3.3, 0.075],
        [0.12, 3.3, 0.075, 0.1, 3.5, 0.03],
        [0.4, 2.42, 0.085, 0.44, 3.24, 0.07],
        [0.44, 3.24, 0.07, 0.46, 3.44, 0.03],
        // foreleg, the long hind foot, scut
        [0.32, 1.5, 0.12, 0.5, 0.9, 0.08],
        [0.5, 0.9, 0.08, 0.5, 0.06, 0.07],
        [-0.3, 0.14, 0.14, 0.55, 0.1, 0.09],
        [-0.82, 0.5, 0.17, -0.84, 0.52, 0.17],
    ],
    strokes: [
        // whiskers
        [[0.72, 2.06], [1.0, 2.12]],
        [[0.72, 2.02], [1.0, 1.96]],
        [[0.7, 2.0], [0.94, 1.84]],
    ],
    strokeShare: 0.04,
    scale: 1.45,
});

// --- The lynx: sat facing you, tufts on its ears, a ruff at either cheek. -------------------

const LYNX_EAR = [[0.4, 2.86], [0.56, 3.44], [0.12, 3.04]];
const LYNX_RUFF = [[0.4, 2.46], [0.76, 2.32], [0.6, 2.2], [0.68, 1.88], [0.42, 2.02], [0.3, 2.14]];

const LYNX = animal('lynx', {
    body: [
        // body, chest, head
        [0, 0.9, 0.56, 0, 1.6, 0.46],
        [0, 1.9, 0.4, 0, 2.2, 0.38],
        [0, 2.56, 0.5, 0, 2.6, 0.5],
        // haunches, tucked in at either side
        [-0.5, 0.52, 0.32, -0.46, 0.7, 0.3],
        [0.5, 0.52, 0.32, 0.46, 0.7, 0.3],
        // forelegs, standing a little apart, and their broad paws
        [-0.24, 1.5, 0.17, -0.26, 0.3, 0.14],
        [-0.26, 0.17, 0.17, -0.34, 0.15, 0.17],
        [0.24, 1.5, 0.17, 0.26, 0.3, 0.14],
        [0.26, 0.17, 0.17, 0.34, 0.15, 0.17],
    ],
    shapes: [LYNX_EAR, mirrored(LYNX_EAR), LYNX_RUFF, mirrored(LYNX_RUFF)],
    // its eyes, and the dark between its forelegs
    holes: [
        [-0.2, 2.66, 0.13, -0.2, 2.66, 0.13],
        [0.2, 2.66, 0.13, 0.2, 2.66, 0.13],
        [0, 1.1, 0.07, 0, 0, 0.09],
    ],
    strokes: [
        // ear tufts, nose, whiskers
        [[0.56, 3.44], [0.66, 3.72]],
        [[-0.56, 3.44], [-0.66, 3.72]],
        [[-0.07, 2.44], [0, 2.36], [0.07, 2.44]],
        [[0.14, 2.4], [0.5, 2.5]],
        [[-0.14, 2.4], [-0.5, 2.5]],
    ],
    strokeShare: 0.05,
    scale: 1.38,
});

// --- The boar: all shoulder, a long snout, tusks, a crest of bristles down its back. -------

const BOAR_BODY = [
    // shoulder, barrel, rump
    [0.3, 1.2, 0.56, 0.4, 1.25, 0.56],
    [-0.7, 1.05, 0.4, 0.3, 1.18, 0.54],
    [-0.82, 1.05, 0.38, -0.8, 1.0, 0.38],
    // head, snout and its disc
    [0.75, 1.1, 0.42, 1.2, 0.9, 0.26],
    [1.2, 0.88, 0.22, 1.6, 0.74, 0.13],
    [1.6, 0.74, 0.13, 1.66, 0.72, 0.12],
    // forelegs
    [0.36, 0.8, 0.15, 0.4, 0.35, 0.075],
    [0.4, 0.35, 0.075, 0.42, 0.04, 0.065],
    [0.56, 0.8, 0.14, 0.68, 0.36, 0.07],
    [0.68, 0.36, 0.07, 0.72, 0.04, 0.06],
    // hind legs
    [-0.78, 0.85, 0.2, -0.9, 0.4, 0.08],
    [-0.9, 0.4, 0.08, -0.84, 0.04, 0.065],
    [-0.58, 0.8, 0.18, -0.62, 0.4, 0.075],
    [-0.62, 0.4, 0.075, -0.52, 0.04, 0.06],
];

const BOAR = animal('boar', {
    body: BOAR_BODY,
    shapes: [
        // ear
        [[0.62, 1.56], [0.6, 1.98], [0.84, 1.62]],
    ],
    strokes: [
        // tusks, the tail and its tuft, the crest
        [[1.36, 0.78], [1.44, 0.96], [1.4, 1.08]],
        [[1.26, 0.82], [1.32, 0.96]],
        [[-1.18, 1.2], [-1.34, 1.1], [-1.4, 0.86]],
        [[-1.4, 0.86], [-1.48, 0.76]],
        [[-1.4, 0.86], [-1.36, 0.74]],
        ...bristles(BOAR_BODY, [0, 1.0], 38, 142, 15, 0.17, 22),
    ],
    strokeShare: 0.14,
    scale: 1.2,
});

// --- The capercaillie: the cock at his display, tail fanned, beak to the sky. ---------------

const CAPERCAILLIE_FAN = [-0.45, 1.15];

const CAPERCAILLIE = animal('capercaillie', {
    body: [
        // body, breast
        [-0.2, 1.0, 0.5, 0.25, 1.1, 0.46],
        [0.35, 1.2, 0.42, 0.4, 1.3, 0.4],
        // neck, head, beak
        [0.45, 1.5, 0.28, 0.62, 2.2, 0.2],
        [0.64, 2.3, 0.2, 0.7, 2.36, 0.19],
        [0.8, 2.42, 0.09, 1.02, 2.58, 0.03],
        // legs and toes
        [0.05, 0.6, 0.1, 0.1, 0.25, 0.06],
        [0.1, 0.25, 0.06, 0.12, 0.05, 0.05],
        [0.12, 0.05, 0.045, 0.36, 0.04, 0.035],
        [-0.15, 0.6, 0.1, -0.12, 0.25, 0.06],
        [-0.12, 0.25, 0.06, -0.1, 0.05, 0.05],
        [-0.1, 0.05, 0.045, 0.12, 0.04, 0.035],
    ],
    shapes: [
        // the drooped wing
        [[-0.3, 1.25], [0.3, 1.2], [0.42, 0.75], [0.2, 0.5], [-0.2, 0.8]],
    ],
    strokes: [
        // the beard under the beak; the quills of the fan, and the rim that joins their tips
        [[0.72, 2.14], [0.9, 2.06]],
        [[0.7, 2.06], [0.86, 1.96]],
        ...fan(...CAPERCAILLIE_FAN, 0.42, 1.3, 60, 166, 8),
        fanned(...CAPERCAILLIE_FAN, 1.36, 60, 166, 8, 0.93).slice(1),
    ],
    strokeShare: 0.4,
    fill: 0.06,
    scale: 1.42,
});

// --- The squirrel: sat up with a cone, its tail a great curl behind it. --------------------

const SQUIRREL_TAIL = [
    [-0.5, 0.5, 0.2, -0.85, 0.9, 0.3],
    [-0.85, 0.9, 0.3, -0.95, 1.6, 0.36],
    [-0.95, 1.6, 0.36, -0.75, 2.3, 0.36],
    [-0.75, 2.3, 0.36, -0.35, 2.75, 0.3],
    [-0.35, 2.75, 0.3, -0.9, 2.98, 0.18],
];

const SQUIRREL = animal('squirrel', {
    body: [
        // haunch, body, head, nose
        [-0.1, 0.6, 0.5, 0.0, 0.66, 0.48],
        [0.0, 0.85, 0.44, 0.3, 1.55, 0.34],
        [0.42, 1.95, 0.3, 0.62, 1.9, 0.24],
        [0.7, 1.86, 0.17, 0.9, 1.78, 0.09],
        // arm, the cone in its paws, hind foot
        [0.4, 1.45, 0.12, 0.72, 1.55, 0.08],
        [0.78, 1.62, 0.1, 0.92, 1.5, 0.07],
        [0.0, 0.14, 0.14, 0.62, 0.1, 0.09],
        ...SQUIRREL_TAIL,
    ],
    shapes: [
        // ears
        [[0.26, 2.16], [0.2, 2.6], [0.42, 2.22]],
        [[0.44, 2.2], [0.5, 2.6], [0.6, 2.14]],
    ],
    strokes: [
        // ear tufts, and the fur standing off the back of the tail
        [[0.2, 2.6], [0.14, 2.82]],
        [[0.5, 2.6], [0.52, 2.84]],
        ...bristles(SQUIRREL_TAIL, [-0.86, 1.75], 108, 262, 13, 0.16, -16),
    ],
    strokeShare: 0.1,
    scale: 1.6,
});

// --- The hedgehog: a dome of spines, a small sharp face. ----------------------------------

const HEDGEHOG_BODY = [
    // the dome, face, nose, ear
    [-0.45, 0.68, 0.64, 0.3, 0.66, 0.58],
    [0.7, 0.5, 0.3, 1.1, 0.36, 0.1],
    [1.1, 0.36, 0.08, 1.16, 0.35, 0.07],
    [0.64, 0.94, 0.1, 0.66, 0.98, 0.09],
    // feet
    [0.4, 0.1, 0.08, 0.6, 0.07, 0.06],
    [-0.5, 0.1, 0.08, -0.3, 0.07, 0.06],
];

const HEDGEHOG = animal('hedgehog', {
    body: HEDGEHOG_BODY,
    strokes: bristles(HEDGEHOG_BODY.slice(0, 1), [-0.1, 0.55], 30, 194, 17, 0.38, 14),
    strokeShare: 0.4,
    fill: 0.06,
    scale: 1.45,
});

/** Every animal of the wood, the stag first. */
export const FOREST_FIGURES = Object.freeze([
    STAG, MOOSE, BEAR, WOLF, OWL, FOX, HARE, LYNX, BOAR, CAPERCAILLIE, SQUIRREL, HEDGEHOG,
]);

export const FOREST_FIGURE_IDS = Object.freeze(FOREST_FIGURES.map((entry) => entry.id));

/** The figure of that name; the stag for a name the wood does not know. */
export function forestFigure(id) {
    return FOREST_FIGURES.find((entry) => entry.id === id) || STAG;
}

function strokeLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

function alongStroke(points, distance) {
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

const cellsOf = new WeakMap();

/**
 * Where on a grid over a figure its outline may run and where its inside lies: lights are
 * then looked for there and not over the whole box the figure stands in. The distance to a
 * figure changes by little more than the distance moved (a tapered limb bends it by up to
 * an eighth), so a cell's centre tells what the cell can hold.
 */
function cells(figure) {
    let found = cellsOf.get(figure);
    if (!found) {
        const {
            minX, maxX, minY, maxY,
        } = figure.sample;
        const reach = CELL * Math.SQRT1_2 * 1.25;
        const line = [];
        const inside = [];
        for (let y = minY; y < maxY; y += CELL) {
            for (let x = minX; x < maxX; x += CELL) {
                const distance = forestFigureDistance(figure, x + CELL / 2, y + CELL / 2);
                if (distance < reach && distance > -EDGE - reach) line.push(x, y);
                if (distance < -EDGE + reach) inside.push(x, y);
            }
        }
        found = { line: Float32Array.from(line), inside: Float32Array.from(inside) };
        cellsOf.set(figure, found);
    }
    return found;
}

/** A point somewhere in one of `among` (pairs of cell corners), taken at random. */
function somewhere(among, rng, target) {
    const count = among.length / 2;
    const cell = Math.min(count - 1, Math.floor(rng() * count)) * 2;
    // eslint-disable-next-line no-param-reassign
    target[0] = among[cell] + rng() * CELL;
    // eslint-disable-next-line no-param-reassign
    target[1] = among[cell + 1] + rng() * CELL;
    return target;
}

/**
 * The lights of a figure's outline, from light `from` up to `to`. Scattered at random,
 * lights bunch and leave gaps and the line breaks up. So more places than lights are found
 * on the outline, and each light in turn takes the place furthest from every light already
 * set: the outline is covered from end to end first and filled in after, and no two lights
 * crowd each other. Returns how many lights are written.
 */
function drawOutline(figure, points, from, to, line, rng) {
    const wanted = Math.max(0, to - from);
    const places = wanted * CHOICE;
    const placeX = new Float32Array(places);
    const placeY = new Float32Array(places);
    const depth = new Float32Array(places);
    const at = [0, 0];
    let found = 0;
    for (let guard = places * 40; found < places && line.length > 0 && guard > 0; guard -= 1) {
        somewhere(line, rng, at);
        const distance = forestFigureDistance(figure, at[0], at[1]);
        // On the outline, or just inside it (and a number: a broken generator finds no place).
        if (distance <= 0 && distance > -EDGE) {
            placeX[found] = at[0];
            placeY[found] = at[1];
            depth[found] = distance;
            found += 1;
        }
    }
    // How near each place is to the nearest light set so far (squared).
    const near = new Float32Array(found).fill(Infinity);
    const lights = Math.min(wanted, found);
    let pick = 0;
    for (let placed = 0; placed < lights; placed += 1) {
        const x = placeX[pick];
        const y = placeY[pick];
        const girth = Math.min(0.2, -depth[pick] * 0.9 + 0.03);
        points.set([x, y, (rng() - 0.5) * 2 * girth, 1], (from + placed) * 4);
        let furthest = -1;
        for (let i = 0; i < found; i += 1) {
            const apart = (placeX[i] - x) ** 2 + (placeY[i] - y) ** 2;
            if (apart < near[i]) near[i] = apart;
            if (near[i] > furthest) {
                furthest = near[i];
                pick = i;
            }
        }
    }
    return from + lights;
}

/** The lights that stand inside a figure, from light `from` up to `to`: dimmer, and where they fall. */
function scatterInside(figure, points, from, to, inside, rng) {
    const at = [0, 0];
    let written = from;
    for (let guard = Math.max(0, to - from) * 400; written < to && inside.length > 0 && guard > 0; guard -= 1) {
        somewhere(inside, rng, at);
        const [x, y] = at;
        const distance = forestFigureDistance(figure, x, y);
        if (!(distance <= -EDGE)) continue;
        // A figure is thickest through the barrel and thin at the legs.
        points.set([x, y, (rng() - 0.5) * 2 * Math.min(0.2, -distance * 0.9 + 0.03), 0.55], written * 4);
        written += 1;
    }
    return written;
}

/**
 * `count` points on a figure as a Float32Array of x, y, z, weight. `weight` is 1 on the
 * outline and the strokes and lower inside the body, so the outline can be drawn brighter.
 */
export function createForestFigurePoints(figure, count, rng = Math.random) {
    const total = Number.isFinite(count) ? Math.max(8, Math.floor(count)) : 8;
    const points = new Float32Array(total * 4);
    const { strokes, twin } = figure;
    const drawn = strokes.length ? Math.round(total * figure.strokeShare) : 0;
    const lengths = strokes.map(strokeLength);
    const drawnLength = lengths.reduce((sum, value) => sum + value, 0);
    let written = 0;
    // Strokes: evenly along every one of them, and along its twin where there is one.
    for (let i = 0; i < drawn; i += 1) {
        const second = twin !== null && i % 2 === 1;
        let distance = twin
            ? ((Math.floor(i / 2) + 0.5) / Math.ceil(drawn / 2)) * drawnLength
            : ((i + 0.5) / drawn) * drawnLength;
        let line = 0;
        while (line < strokes.length - 1 && distance > lengths[line]) {
            distance -= lengths[line];
            line += 1;
        }
        const [x, y] = alongStroke(strokes[line], distance);
        points.set([
            x + (second ? twin.shiftX : 0) + (rng() - 0.5) * 0.02,
            y + (second ? twin.shiftY : 0) + (rng() - 0.5) * 0.02,
            (second ? twin.depth : STROKE_DEPTH) + (rng() - 0.5) * 0.04,
            1,
        ], written * 4);
        written += 1;
    }
    // Body: the outline carries the drawing, and a share of the lights stand inside it.
    const { line, inside } = cells(figure);
    const within = inside.length ? Math.round((total - written) * figure.fill) : 0;
    written = drawOutline(figure, points, written, total - within, line, rng);
    written = scatterInside(figure, points, written, total, inside, rng);
    // A figure too small to fill (never in practice) repeats what it has.
    for (let i = written; i < total; i += 1) {
        const from = (i % Math.max(1, written)) * 4;
        points.copyWithin(i * 4, from, from + 4);
    }
    return points;
}

const FIGURE_SEED = 20261008;
const laidOut = new WeakMap();

/**
 * A figure's lights as the forest shows them: laid out with a generator of its own, so an
 * animal is the same animal every time it comes, and kept for each number of lights, so it
 * is laid out once however often the forest is built. The array is shared: read it only.
 */
export function forestFigureLights(figure, count) {
    const lights = Number.isFinite(count) ? Math.max(8, Math.floor(count)) : 8;
    let kept = laidOut.get(figure);
    if (!kept) {
        kept = new Map();
        laidOut.set(figure, kept);
    }
    let points = kept.get(lights);
    if (!points) {
        let state = FIGURE_SEED;
        points = createForestFigurePoints(figure, lights, () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        });
        kept.set(lights, points);
    }
    return points;
}
