/**
 * Fall — where the squirrel can go: the bark of the two great trees, and the forest floor.
 *
 * The hero maple (left of the board) and the hero oak (right of it) are the squirrel's trees. Their
 * trunks are measured from the bark meshes themselves (the Blender-grown GLBs): at every height a
 * ring of rays is cast out from the trunk's axis and the bark they meet is kept, so a squirrel on the
 * trunk sits on the bark the eye sees, flare, lobes and lean included. Above the first limbs a trunk
 * goes on into the crown, where the squirrel is out of sight.
 *
 * A place on a trunk is (height, angle): the angle is measured round the trunk in the world's xz
 * plane (atan2(z, x) from the axis). A place on the ground is (x, z). Both give a frame: the point
 * the paws stand on, the outward normal (the squirrel's up) and the way up the trunk (or north).
 *
 * Three-free: plain arrays in and out, so the planner and the tests use it as the renderer does.
 */

/** The squirrel's two trees (the hero maple and oak of fall-composition.js). */
export const SQUIRREL_TREE_NAMES = Object.freeze(['maple', 'oak']);

/** How high each trunk is climbable before it is the crown's (metres over its base), and its foot. */
export const SQUIRREL_TRUNK_SPAN = Object.freeze({
    maple: Object.freeze({ low: 0.45, high: 4.15, step: 0.15 }),
    oak: Object.freeze({ low: 0.45, high: 3.05, step: 0.15 }),
});

/** Rays round a trunk. */
export const TRUNK_RAYS = 48;
const TAU = Math.PI * 2;

const wrapAngle = (a) => {
    let x = a % TAU;
    if (x < 0) x += TAU;
    return x;
};

/**
 * Measure a trunk from its bark mesh.
 * @param {object} o
 * @param {ArrayLike<number>} o.positions  bark positions in the tree's own metres (x, y up, z)
 * @param {ArrayLike<number>} o.index      triangles
 * @param {ArrayLike<number>} [o.sway]     per vertex, how far the wind moves it (0 on the trunk)
 * @param {{x:number,y:number,z:number,yaw:number,scale:number}} o.place  the tree in the world
 * @param {{low:number,high:number,step:number}} o.span
 * @returns {{ heights: Float64Array, centres: Float64Array, radii: Float64Array, rays: number, base: number[], low: number, high: number }}
 */
export function measureTrunk({
    positions, index, sway = null, place, span, rays = TRUNK_RAYS,
}) {
    const { low, high, step } = span;
    const count = Math.round((high - low) / step) + 1;
    const heights = new Float64Array(count);
    for (let i = 0; i < count; i++) heights[i] = low + i * step;
    const scale = place.scale || 1;
    // Only the trunk's own triangles: still in the wind, near the axis, below the crown.
    const reach = 3.2;
    const tris = [];
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t] * 3;
        const b = index[t + 1] * 3;
        const c = index[t + 2] * 3;
        if (sway && Math.max(sway[index[t]], sway[index[t + 1]], sway[index[t + 2]]) > 0.08) continue;
        const ys = [positions[a + 1], positions[b + 1], positions[c + 1]];
        if (Math.min(...ys) > (high + 0.6) / scale || Math.max(...ys) < (low - 0.4) / scale) continue;
        if (Math.hypot(positions[a], positions[a + 2]) > reach / scale) continue;
        tris.push(a, b, c);
    }
    // Bin the triangles by height so a ray only meets its own band.
    const bandOf = (y) => Math.floor((y * scale - low) / step + 0.5);
    const bands = Array.from({ length: count }, () => []);
    for (let t = 0; t < tris.length; t += 3) {
        const ys = [positions[tris[t] + 1], positions[tris[t + 1] + 1], positions[tris[t + 2] + 1]];
        const from = Math.max(0, bandOf(Math.min(...ys)) - 1);
        const to = Math.min(count - 1, bandOf(Math.max(...ys)) + 1);
        for (let k = from; k <= to; k++) bands[k].push(t);
    }
    const centres = new Float64Array(count * 2);
    const radii = new Float64Array(count * rays);
    const cosYaw = Math.cos(place.yaw || 0);
    const sinYaw = Math.sin(place.yaw || 0);
    for (let k = 0; k < count; k++) {
        const y = heights[k] / scale;
        // The axis here: the middle of the band's own vertices, nearer the old one (the trunk leans).
        let sx = 0;
        let sz = 0;
        let n = 0;
        for (const t of bands[k]) {
            for (let v = 0; v < 3; v++) {
                const p = tris[t + v];
                if (Math.abs(positions[p + 1] - y) < step / scale) {
                    sx += positions[p];
                    sz += positions[p + 2];
                    n++;
                }
            }
        }
        let cx = n ? sx / n : 0;
        let cz = n ? sz / n : 0;
        if (k > 0) {
            // Keep the axis steady: a flared root or a limb pulls the mean.
            const px = centres[(k - 1) * 2];
            const pz = centres[(k - 1) * 2 + 1];
            const ox = (px - place.x) / scale;
            const oz = (pz - place.z) / scale;
            const lx = ox * cosYaw - oz * sinYaw;
            const lz = ox * sinYaw + oz * cosYaw;
            cx = lx + Math.max(-0.08, Math.min(0.08, cx - lx));
            cz = lz + Math.max(-0.08, Math.min(0.08, cz - lz));
        }
        // To the world: rotate about y by yaw, scale, move.
        centres[k * 2] = place.x + (cx * cosYaw + cz * sinYaw) * scale;
        centres[k * 2 + 1] = place.z + (-cx * sinYaw + cz * cosYaw) * scale;
        for (let r = 0; r < rays; r++) {
            const angle = (r / rays) * TAU;
            // The world direction, in the tree's own frame.
            const wx = Math.cos(angle);
            const wz = Math.sin(angle);
            const dx = wx * cosYaw - wz * sinYaw;
            const dz = wx * sinYaw + wz * cosYaw;
            let best = -1;
            for (const t of bands[k]) {
                const hit = rayTriangle(cx, y, cz, dx, dz, positions, tris[t], tris[t + 1], tris[t + 2]);
                if (hit > best) best = hit;
            }
            radii[k * rays + r] = best > 0 ? best * scale : -1;
        }
        fillGaps(radii, k * rays, rays);
    }
    // Smooth round each ring and up the trunk a little: the mesh is faceted, the bark is not.
    smoothRings(radii, count, rays);
    return {
        heights,
        centres,
        radii,
        rays,
        base: [place.x, place.y, place.z],
        low,
        high,
    };
}

/** Distance along a horizontal ray (origin ox, y, oz; direction dx, 0, dz) to a triangle, or -1. */
function rayTriangle(ox, oy, oz, dx, dz, p, a, b, c) {
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    // pvec = dir x e2 (dir.y = 0)
    const px = -dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const tx = ox - p[a];
    const ty = oy - p[a + 1];
    const tz = oz - p[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 0 ? t : -1;
}

function fillGaps(radii, start, rays) {
    let known = 0;
    for (let r = 0; r < rays; r++) if (radii[start + r] > 0) known++;
    if (known === 0) {
        for (let r = 0; r < rays; r++) radii[start + r] = 1;
        return;
    }
    for (let r = 0; r < rays; r++) {
        if (radii[start + r] > 0) continue;
        let left = 1;
        while (radii[start + ((r - left + rays) % rays)] <= 0) left++;
        let right = 1;
        while (radii[start + ((r + right) % rays)] <= 0) right++;
        const a = radii[start + ((r - left + rays) % rays)];
        const b = radii[start + ((r + right) % rays)];
        radii[start + r] = a + (b - a) * (left / (left + right));
    }
}

function smoothRings(radii, count, rays) {
    const copy = Float64Array.from(radii);
    for (let k = 0; k < count; k++) {
        for (let r = 0; r < rays; r++) {
            let sum = 0;
            let weight = 0;
            for (let dk = -1; dk <= 1; dk++) {
                const kk = Math.max(0, Math.min(count - 1, k + dk));
                for (let dr = -2; dr <= 2; dr++) {
                    const w = (dk === 0 ? 2 : 1) * (3 - Math.abs(dr));
                    sum += copy[kk * rays + ((r + dr + rays) % rays)] * w;
                    weight += w;
                }
            }
            radii[k * rays + r] = sum / weight;
        }
    }
}

/**
 * A measured trunk as a surface. `frame(h, angle)` gives the place on the bark at height h over
 * the tree's base (clamped to the climbable span) and world angle `angle`:
 * point, outward normal and the way up the bark, each [x, y, z].
 */
export class TrunkSurface {
    constructor(data, name = '') {
        this.name = name;
        this.data = data;
        this.low = data.low;
        this.high = data.high;
        this.base = data.base;
        this.scratch = {
            point: [0, 0, 0], normal: [0, 0, 0], up: [0, 0, 0], side: [0, 0, 0],
        };
    }

    /** Centre of the trunk (x, z) and bark radius at (h, angle), interpolated. */
    sample(h, angle) {
        const {
            heights, centres, radii, rays,
        } = this.data;
        const n = heights.length;
        const f = Math.max(0, Math.min(n - 1, (h - heights[0]) / (heights[1] - heights[0])));
        const k = Math.min(n - 2, Math.floor(f));
        const t = f - k;
        const a = (wrapAngle(angle) / TAU) * rays;
        const r0 = Math.floor(a) % rays;
        const r1 = (r0 + 1) % rays;
        const s = a - Math.floor(a);
        const ring = (kk) => radii[kk * rays + r0] * (1 - s) + radii[kk * rays + r1] * s;
        return {
            cx: centres[k * 2] * (1 - t) + centres[(k + 1) * 2] * t,
            cz: centres[k * 2 + 1] * (1 - t) + centres[(k + 1) * 2 + 1] * t,
            r: ring(k) * (1 - t) + ring(k + 1) * t,
        };
    }

    point(h, angle, out = [0, 0, 0]) {
        const { cx, cz, r } = this.sample(h, angle);
        out[0] = cx + Math.cos(angle) * r;
        out[1] = this.base[1] + h;
        out[2] = cz + Math.sin(angle) * r;
        return out;
    }

    /** The frame at (h, angle): the surface's tangents by central differences. */
    frame(h, angle, out = this.scratch) {
        const clamped = Math.max(this.low, Math.min(this.high, h));
        this.point(clamped, angle, out.point);
        const dh = 0.08;
        const da = 0.06;
        const up0 = this.point(clamped - dh, angle, [0, 0, 0]);
        const up1 = this.point(clamped + dh, angle, [0, 0, 0]);
        const s0 = this.point(clamped, angle - da, [0, 0, 0]);
        const s1 = this.point(clamped, angle + da, [0, 0, 0]);
        const u = normalize([up1[0] - up0[0], up1[1] - up0[1], up1[2] - up0[2]]);
        const s = normalize([s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]]);
        // Outward: up x side (the angle runs from +x toward +z).
        const n = normalize(cross(u, s));
        out.normal[0] = n[0];
        out.normal[1] = n[1];
        out.normal[2] = n[2];
        // The way up, square to the normal.
        const d = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
        const uu = normalize([u[0] - n[0] * d, u[1] - n[1] * d, u[2] - n[2] * d]);
        out.up[0] = uu[0];
        out.up[1] = uu[1];
        out.up[2] = uu[2];
        const ss = cross(n, uu);
        out.side[0] = ss[0];
        out.side[1] = ss[1];
        out.side[2] = ss[2];
        // Past the climbable span the bark goes straight on (up into the crown, down into the roots).
        out.point[1] += h - clamped;
        return out;
    }

    /** The world angle round this trunk that faces a point (x, z). */
    angleToward(x, z) {
        const { cx, cz } = this.sample(this.low, 0);
        return wrapAngle(Math.atan2(z - cz, x - cx));
    }

    /** The bark radius at height h facing angle (metres). */
    radius(h, angle) {
        return this.sample(h, angle).r;
    }
}

export function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The squirrel's stage: its two trunks and the forest floor.
 * @param {object} o
 * @param {Record<string, TrunkSurface>} o.trunks
 * @param {(x: number, z: number) => number} o.groundHeight
 * @param {number[]} o.eye  where the game's eye stands (x, y, z): which side of a trunk faces it
 */
export function createSquirrelStage({ trunks, groundHeight, eye = [0, 2.6, 15] }) {
    const ground = {
        height: groundHeight,
        frame(x, z, out = {
            point: [0, 0, 0], normal: [0, 1, 0], up: [0, 0, -1], side: [1, 0, 0],
        }) {
            const e = 0.1;
            const y = groundHeight(x, z);
            const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
            const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
            const n = normalize([-gx, 1, -gz]);
            out.point[0] = x;
            out.point[1] = y;
            out.point[2] = z;
            out.normal[0] = n[0];
            out.normal[1] = n[1];
            out.normal[2] = n[2];
            return out;
        },
    };
    const facing = {};
    for (const [name, trunk] of Object.entries(trunks)) facing[name] = trunk.angleToward(eye[0], eye[2]);
    return {
        trunks, ground, eye, facing,
    };
}
