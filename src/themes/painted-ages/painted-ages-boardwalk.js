/** Terrain-supported timber stairs, baked once into the shared scale-detail mesh. */
const WALK_WIDTH = 2.8;
const MIN_RUN = 0.29;
const MAX_RISE = 0.19;
const TOP_CLEARANCE = 0.48;
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Exact triangle heights of the rendered fan, rather than its finer analytical source. */
export function createBoardwalkSurface(bake) {
    const { positions } = bake;
    const columns = (bake.indices?.[2] || 0) - 1;
    if (!positions || columns < 3) return bake.heightAt;
    const rows = positions.length / 3 / (columns + 1) - 1;
    const at = (index) => {
        const i = index * 3;
        return [positions[i], positions[i + 1], positions[i + 2]];
    };
    const triangle = (x, z, ai, bi, ci) => {
        const a = at(ai); const b = at(bi); const c = at(ci);
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 1e-9) return null;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        if (Math.min(wa, wb, 1 - wa - wb) < -1e-5) return null;
        return wa * a[1] + wb * b[1] + (1 - wa - wb) * c[1];
    };
    return (x, z) => {
        const distance = Math.hypot(x, 200 - z);
        const angle = Math.atan2(x, 200 - z);
        const col = clamp(Math.floor((angle / 2.6 + 0.5) * columns), 0, columns - 1);
        const row = clamp(
            Math.floor((Math.log(Math.max(distance, 22) / 22) / Math.log(15000 / 22)) * rows),
            0,
            rows - 1,
        );
        for (let dr = -1; dr <= 1; dr++) {
            const r = row + dr;
            if (r < 0 || r >= rows) continue;
            const a = r * (columns + 1) + col;
            const b = a + 1; const c = a + columns + 1; const d = c + 1;
            const first = triangle(x, z, a, b, c);
            if (first !== null) return first;
            const second = triangle(x, z, b, d, c);
            if (second !== null) return second;
        }
        return bake.heightAt(x, z);
    };
}

/** Pure bounded planner. heightAt may be the rendered fan's barycentric sampler. */
function findRoute(heightAt, {
    start = [-65, 50], direction = [-145, -420], length = 156,
    halfCorridor = 46, cell = 6, maxGrade = 0.55, width = 1.8,
} = {}) {
    const magnitude = Math.hypot(...direction);
    const tx = direction[0] / magnitude; const
        tz = direction[1] / magnitude;
    const nx = -tz; const
        nz = tx;
    const middle = Math.floor(halfCorridor / cell);
    const cols = middle * 2 + 1; const
        rows = Math.ceil(length / cell) + 1;
    const count = cols * rows;
    const position = (station, lateral) => [
        start[0] + tx * station + nx * lateral,
        start[1] + tz * station + nz * lateral,
    ];
    const heights = new Float64Array(count); const
        cost = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1); const
        visited = new Uint8Array(count);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            heights[row * cols + col] = heightAt(...position(row * cell, (col - middle) * cell));
        }
    }
    const queue = [];
    const push = (item) => {
        let at = queue.length; queue.push(item);
        while (at) {
            const parent = (at - 1) >> 1;
            if (queue[parent][0] <= item[0]) break;
            queue[at] = queue[parent];
            at = parent;
        }
        queue[at] = item;
    };
    const pop = () => {
        const result = queue[0]; const
            tail = queue.pop();
        if (queue.length) {
            let at = 0; while (at * 2 + 1 < queue.length) {
                let child = at * 2 + 1; if (child + 1 < queue.length && queue[child + 1][0] < queue[child][0]) child++;
                if (queue[child][0] >= tail[0]) break; queue[at] = queue[child]; at = child;
            } queue[at] = tail;
        }
        return result;
    };
    const source = middle; const
        requestedTarget = (rows - 1) * cols + middle;
    cost[source] = 0; push([0, source]);
    while (queue.length) {
        const [knownCost, current] = pop();
        if (visited[current]) continue;
        visited[current] = 1;
        const row = Math.floor(current / cols); const
            col = current % cols;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const r = row + dr; const
                    c = col + dc;
                if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
                const next = r * cols + c;
                if (visited[next]) continue;
                const run = Math.hypot(dr * cell, dc * cell); const
                    rise = heights[next] - heights[current];
                const grade = Math.abs(rise / run);
                if (!Number.isFinite(grade) || grade > maxGrade) continue;
                const a = position(row * cell, (col - middle) * cell); const
                    b = position(r * cell, (c - middle) * cell);
                const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2; const
                    mh = heightAt(mx, mz);
                // A short ridge hidden between graph nodes must not be mistaken for a flat span.
                if (Math.max(Math.abs(mh - heights[current]), Math.abs(heights[next] - mh))
                    / (run * 0.5) > maxGrade + 0.08) continue;
                const sx = -(b[1] - a[1]) / run; const
                    sz = (b[0] - a[0]) / run;
                const left = heightAt(mx + (sx * width) / 2, mz + (sz * width) / 2);
                const right = heightAt(mx - (sx * width) / 2, mz - (sz * width) / 2);
                const crossRise = Math.abs(left - right);
                const candidate = knownCost + run * (1 + grade * grade * 2 + crossRise * 0.025
                    + (Math.abs(c - middle) / middle) * 0.025);
                if (candidate < cost[next]) {
                    cost[next] = candidate;
                    previous[next] = current;
                    push([candidate, next]);
                }
            }
        }
    }
    let target = requestedTarget;
    if (!visited[target]) {
        // The concept allows the path to finish at a nearby overlook. Prefer the closest
        // reachable point to the requested crest; never force a last steep connecting segment.
        target = -1; let best = Infinity;
        for (let row = Math.ceil((length - 30) / cell); row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const id = row * cols + col;
                if (!visited[id]) continue;
                const score = Math.hypot(length - row * cell, (col - middle) * cell) + cost[id] * 0.0001;
                if (score < best) { best = score; target = id; }
            }
        }
    }
    if (target < 0) return { found: false, points: [], reason: 'No human-scale route reaches the crest corridor.' };
    const points = [];
    for (let id = target; id >= 0; id = previous[id]) {
        const row = Math.floor(id / cols); const
            col = id % cols;
        const station = row * cell; const offset = (col - middle) * cell; const
            [x, z] = position(station, offset);
        points.push({
            x, y: heights[id], z, station, offset,
        });
        if (id === source) break;
    }
    points.reverse();
    return {
        found: true, points, reachesRequestedTarget: target === requestedTarget, maxGrade, cell, width,
    };
}

const FACES = [
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
];
const unit = (v) => {
    const length = Math.hypot(...v) || 1;
    return v.map((x) => x / length);
};
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

/**
 * Appends only geometry/attributes. No materials, meshes, textures, or per-frame work.
 * paDetail = [grain metres, cross-grain metres, kind (timber1/rope2/iron3), AO].
 */
export function appendBoardwalk({
    positions, colours, detailData, horizonData,
}, { bake, tier }) {
    const surface = createBoardwalkSurface(bake);
    let route = findRoute(surface, { width: WALK_WIDTH });
    const tightTurn = (p, i, points) => {
        if (!i || i === points.length - 1) return false;
        const a = points[i - 1]; const b = points[i + 1];
        return (p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z) < -1e-6;
    };
    if (route.points.some(tightTurn)) route = findRoute(surface, { width: WALK_WIDTH, length: 132 });
    // Unusual seeds can still force a hairpin. Finish at the preceding safe point
    // rather than build overlapping platforms or compress a flight into negative run.
    const sharpTurn = route.points.findIndex(tightTurn);
    if (sharpTurn >= 0) route.points = route.points.slice(0, sharpTurn + 1);
    const metadata = {
        route: route.points,
        flights: [],
        treads: [],
        landings: [],
        supports: [],
        verticesAdded: 0,
        maxDeckClearance: 0,
        found: route.found,
    };
    if (!route.found) return metadata;
    const startVertex = positions.length / 3;
    const lowDetail = (tier.detailOctaves || 0) < 2;
    const horizonCache = new Map();
    const horizon = (x, y, z) => {
        const key = `${Math.round(x / 2)}:${Math.round(y / 2)}:${Math.round(z / 2)}`;
        if (horizonCache.has(key)) return horizonCache.get(key);
        let slope = 0;
        for (const d of [6, 12, 24, 48, 96, 192, 384, 768]) {
            slope = Math.max(slope, (surface(x - 0.906308 * d, z + 0.422618 * d) - y - 0.15) / d);
        }
        const value = Math.atan(slope);
        horizonCache.set(key, value);
        return value;
    };
    let piece = 0;
    const box = (centre, dimensions, axes, kind = 1, grainAxis = 0, colour = [0.28, 0.205, 0.13]) => {
        const shadow = horizon(...centre);
        const variation = 0.9 + ((piece++ * 37) % 17) * 0.011;
        for (let face = 0; face < FACES.length; face++) {
            if (lowDetail && face === 1) continue;
            for (const corner of [0, 1, 2, 0, 2, 3]) {
                const q = FACES[face][corner].map((v, i) => v * dimensions[i] * 0.5);
                positions.push(...centre.map((v, axis) => v + axes[0][axis] * q[0]
                    + axes[1][axis] * q[1] + axes[2][axis] * q[2]));
                colours.push(...colour.map((v) => v * variation));
                const across = grainAxis === 0 ? q[2] : q[0];
                detailData.push(q[grainAxis] + piece * 0.79, across, kind, face === 1 ? 0.53 : 0.93);
                horizonData.push(shadow);
            }
        }
    };
    const upright = (x, y, z, width, height, depth, tx, tz, kind = 1, grainAxis = 0, colour = undefined) => {
        box([x, y, z], [width, height, depth], [[tz, 0, -tx], [0, 1, 0], [tx, 0, tz]], kind, grainAxis, colour);
    };
    const beam = (a, b, width, height, kind = 1, colour = undefined) => {
        const forward = unit([b.x - a.x, b.y - a.y, b.z - a.z]);
        let side = unit([forward[2], 0, -forward[0]]);
        if (Math.abs(forward[1]) > 0.999) side = [1, 0, 0];
        const up = cross(forward, side);
        const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (length < 0.01) return;
        box(
            [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
            [width, height, length],
            [side, up, forward],
            kind,
            2,
            colour,
        );
    };
    // Six-metre planning cells leave room for a real landing; tiny contour zigzags
    // are unsuitable for a 2.8 m stairway. Long straight stretches get rest platforms.
    const { points } = route;
    const anchors = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const before = unit([points[i].x - points[i - 1].x, 0, points[i].z - points[i - 1].z]);
        const after = unit([points[i + 1].x - points[i].x, 0, points[i + 1].z - points[i].z]);
        const bend = before[0] * after[0] + before[2] * after[2];
        if (bend < 0.999 || dist(anchors[anchors.length - 1], points[i]) >= 11) anchors.push(points[i]);
    }
    anchors.push(points[points.length - 1]);
    const directions = anchors.slice(1).map((p, i) => {
        const length = dist(anchors[i], p);
        return { x: (p.x - anchors[i].x) / length, z: (p.z - anchors[i].z) / length };
    });
    const halfWidth = WALK_WIDTH / 2 + 0.09;
    const convexHull = (input) => {
        const sorted = input.slice().sort((a, b) => a.x - b.x || a.z - b.z);
        const turn = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        const half = (list) => {
            const result = [];
            for (const p of list) {
                while (result.length > 1
                    && turn(result[result.length - 2], result[result.length - 1], p) <= 1e-7) result.pop();
                result.push(p);
            }
            return result.slice(0, -1);
        };
        return half(sorted).concat(half(sorted.slice().reverse()));
    };
    const landingPlans = anchors.map((a, i) => {
        const incoming = directions[Math.max(0, i - 1)];
        const outgoing = directions[Math.min(directions.length - 1, i)];
        const cosine = clamp(incoming.x * outgoing.x + incoming.z * outgoing.z, -1, 1);
        const turn = Math.acos(cosine);
        const terminal = i === 0 || i === anchors.length - 1;
        const reach = terminal ? 1.55 : Math.max(0.70, halfWidth * Math.tan(turn / 2) + 0.20);
        const mouth = (direction, offset) => [-1, 1].map((side) => ({
            x: a.x + direction.x * offset + direction.z * side * halfWidth,
            z: a.z + direction.z * offset - direction.x * side * halfWidth,
        }));
        const entrance = mouth(incoming, -reach);
        const exit = mouth(outgoing, reach);
        return {
            reach, polygon: convexHull([...entrance, ...exit]), entrance, exit, incoming, outgoing,
        };
    });
    const deck = landingPlans.map((landing) => Math.max(...landing.polygon.map((p) => surface(p.x, p.z)))
        + TOP_CLEARANCE);
    // Solve deck clearance on the visible mesh, including the flat landing mouths.
    // Raising a low anchor is bounded by the integer number of safe stair risers.
    for (let pass = 0; pass < 16; pass++) {
        let changed = false;
        for (let i = 0; i < anchors.length - 1; i++) {
            const a = anchors[i]; const b = anchors[i + 1];
            const direction = directions[i];
            const totalRun = dist(a, b);
            const trimA = landingPlans[i].reach; const trimB = landingPlans[i + 1].reach;
            const run = totalRun - trimA - trimB;
            let lift = 0;
            const samples = Math.ceil(run / 0.45);
            for (let j = 0; j <= samples; j++) {
                const t = j / samples;
                const along = trimA + run * t;
                for (const side of [-1, 0, 1]) {
                    const x = a.x + direction.x * along + (direction.z * side * WALK_WIDTH) / 2;
                    const z = a.z + direction.z * along - (direction.x * side * WALK_WIDTH) / 2;
                    const top = deck[i] * (1 - t) + deck[i + 1] * t;
                    lift = Math.max(lift, surface(x, z) + TOP_CLEARANCE - top);
                }
            }
            if (lift > 1e-7) { deck[i] += lift; deck[i + 1] += lift; changed = true; }
            const maxRise = Math.max(1, Math.floor(run / MIN_RUN)) * MAX_RISE;
            if (deck[i + 1] - deck[i] > maxRise + 1e-7) { deck[i] = deck[i + 1] - maxRise; changed = true; }
            if (deck[i] - deck[i + 1] > maxRise + 1e-7) { deck[i + 1] = deck[i] - maxRise; changed = true; }
        }
        if (!changed) break;
    }
    const ropeSegments = lowDetail ? 2 : 3;
    const rope = (a, b) => {
        let previous = a;
        for (let j = 1; j <= ropeSegments; j++) {
            const t = j / ropeSegments;
            const p = {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 0.08,
                z: a.z + (b.z - a.z) * t,
            };
            beam(previous, p, 0.043, 0.043, 2, [0.30, 0.235, 0.15]);
            previous = p;
        }
    };
    const posts = new Map();
    const post = (x, z, top, direction) => {
        const key = `${Math.round(x * 100)}:${Math.round(z * 100)}`;
        if (posts.has(key)) return posts.get(key);
        const ground = surface(x, z); const foot = ground - 0.16;
        upright(
            x,
            (foot + top + 1.05) / 2,
            z,
            0.20,
            top + 1.05 - foot,
            0.20,
            direction.x,
            direction.z,
            1,
            1,
            [0.20, 0.145, 0.09],
        );
        const p = { x, y: top + 1, z };
        metadata.supports.push({
            foot: { x, y: foot, z }, top: p, ground, deck: top,
        });
        posts.set(key, p);
        return p;
    };
    const braceBent = (pair, top) => {
        const a = pair[0]; const b = pair[1];
        const groundA = surface(a.x, a.z); const groundB = surface(b.x, b.z);
        beam({ ...a, y: top - 0.26 }, { ...b, y: top - 0.26 }, 0.18, 0.24, 1, [0.17, 0.12, 0.075]);
        if (top - Math.min(groundA, groundB) < 1.5) return;
        beam({ ...a, y: groundA + 0.25 }, { ...b, y: top - 0.38 }, 0.14, 0.15, 1, [0.17, 0.12, 0.075]);
        beam({ ...b, y: groundB + 0.25 }, { ...a, y: top - 0.38 }, 0.14, 0.15, 1, [0.17, 0.12, 0.075]);
    };
    for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i]; const b = anchors[i + 1];
        const direction = directions[i]; const tx = direction.x; const tz = direction.z;
        const run = dist(a, b) - landingPlans[i].reach - landingPlans[i + 1].reach;
        const rise = deck[i + 1] - deck[i];
        const steps = Math.max(1, Math.floor(run / 0.34), Math.ceil((Math.abs(rise) - 1e-7) / MAX_RISE));
        const treadRun = run / steps; const risePerStep = rise / steps;
        const from = { x: a.x + tx * landingPlans[i].reach, y: deck[i], z: a.z + tz * landingPlans[i].reach };
        const to = { x: b.x - tx * landingPlans[i + 1].reach, y: deck[i + 1], z: b.z - tz * landingPlans[i + 1].reach };
        metadata.flights.push({
            from, to, steps, rise: risePerStep, run: treadRun, totalRun: run,
        });
        for (let j = 0; j < steps; j++) {
            const x = from.x + tx * (j + 0.5) * treadRun;
            const z = from.z + tz * (j + 0.5) * treadRun;
            const top = deck[i] + risePerStep * (rise >= 0 ? j + 1 : j);
            upright(x, top - 0.05, z, WALK_WIDTH, 0.10, treadRun + 0.012, tx, tz);
            metadata.treads.push({
                x, z, top, tx, tz, width: WALK_WIDTH, depth: treadRun + 0.012, thickness: 0.10,
            });
            metadata.maxDeckClearance = Math.max(metadata.maxDeckClearance, top - surface(x, z));
        }
        for (const side of [-1, 1]) {
            beam(
                { x: from.x + tz * side * 1.17, y: from.y - 0.175, z: from.z - tx * side * 1.17 },
                { x: to.x + tz * side * 1.17, y: to.y - 0.175, z: to.z - tx * side * 1.17 },
                0.20,
                0.43,
                1,
                [0.17, 0.12, 0.075],
            );
        }
        const postCount = Math.max(1, Math.ceil(run / 2.7));
        let previousPair;
        for (let j = 0; j <= postCount; j++) {
            const t = j / postCount; const top = from.y * (1 - t) + to.y * t;
            const pair = [-1, 1].map((side) => post(
                from.x + tx * run * t + tz * side * halfWidth,
                from.z + tz * run * t - tx * side * halfWidth,
                top,
                direction,
            ));
            if (previousPair) { rope(previousPair[0], pair[0]); rope(previousPair[1], pair[1]); }
            if (j % 2 === 0 || j === postCount) braceBent(pair, top);
            previousPair = pair;
        }
    }
    // Every bend is one convex, level platform. Its entry and exit edges stay open;
    // rails follow only the outer hull, so no handrail crosses the walking route.
    const polygonDeck = (polygon, top, direction) => {
        const centre = polygon.reduce((sum, p) => ({
            x: sum.x + p.x / polygon.length,
            z: sum.z + p.z / polygon.length,
        }), { x: 0, z: 0 });
        const shadow = horizon(centre.x, top, centre.z);
        const offset = piece++ * 0.79;
        const vertex = (p, y, ao) => {
            positions.push(p.x, y, p.z);
            colours.push(0.273, 0.199, 0.126);
            detailData.push(
                (p.x - centre.x) * direction.z - (p.z - centre.z) * direction.x + offset,
                (p.x - centre.x) * direction.x + (p.z - centre.z) * direction.z,
                1,
                ao,
            );
            horizonData.push(shadow);
        };
        for (let j = 0; j < polygon.length; j++) {
            const a = polygon[j]; const b = polygon[(j + 1) % polygon.length];
            vertex(centre, top, 0.96); vertex(b, top, 0.96); vertex(a, top, 0.96);
            vertex(a, top, 0.80); vertex(b, top, 0.80); vertex(b, top - 0.10, 0.80);
            vertex(a, top, 0.80); vertex(b, top - 0.10, 0.80); vertex(a, top - 0.10, 0.80);
        }
    };
    for (let i = 0; i < landingPlans.length; i++) {
        const plan = landingPlans[i]; const top = deck[i];
        polygonDeck(plan.polygon, top, plan.outgoing);
        metadata.landings.push({
            x: anchors[i].x,
            z: anchors[i].z,
            top,
            width: halfWidth * 2,
            depth: plan.reach * 2,
            tx: plan.outgoing.x,
            tz: plan.outgoing.z,
            polygon: plan.polygon,
            entrance: plan.entrance,
            exit: plan.exit,
            terminal: i === anchors.length - 1,
        });
        const matches = (a, b, mouth) => mouth.some((p) => dist(a, p) < 0.01) && mouth.some((p) => dist(b, p) < 0.01);
        for (let j = 0; j < plan.polygon.length; j++) {
            const a = plan.polygon[j]; const b = plan.polygon[(j + 1) % plan.polygon.length];
            const openEntrance = i > 0 && matches(a, b, plan.entrance);
            const openExit = i < landingPlans.length - 1 && matches(a, b, plan.exit);
            // The foreground entry is open as well; the final overlook has three rails.
            if (openEntrance || openExit || (i === 0 && matches(a, b, plan.entrance))) continue;
            const pa = post(a.x, a.z, top, plan.outgoing); const pb = post(b.x, b.z, top, plan.outgoing);
            rope(pa, pb);
            beam({ ...pa, y: top - 0.22 }, { ...pb, y: top - 0.22 }, 0.18, 0.24, 1, [0.17, 0.12, 0.075]);
        }
        braceBent(plan.entrance.map((p) => ({ ...p, y: top + 1 })), top);
        braceBent(plan.exit.map((p) => ({ ...p, y: top + 1 })), top);
    }
    metadata.verticesAdded = positions.length / 3 - startVertex;
    return metadata;
}
