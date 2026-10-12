/**
 * Sky Children — Irisfall: the authored world, placed per layout (three-free).
 *
 * The realm is authored relative to the solved frame, never object by object: each set piece is
 * given a SCREEN anchor and a distance, and the plan unprojects the anchor through the solved
 * camera. The left group (the Spring Isle and the Mother Fall) hangs off the bow's leg so the fall's
 * spray skirt always holds the leg below the horizon; the right group (the Twin Isle and its broken
 * aqueduct) hangs off the HUD; the Far Gate and the corners are pinned to the frame's edges.
 *
 * Each isle is yawed to face the eye (its local +z toward the origin), so its front is the lit face
 * in every layout (the sun stands behind the eye).
 */
import { DEG, clamp } from './sky-children-core.js';
import { project, unproject } from './sky-children-frame.js';

/** Authored sizes and distances (metres). */
export const PLAN = Object.freeze({
    spring: {
        dist: 470,
        /** The summit, the rim (where the moss crown meets the root), the root's tip (local metres). */
        top: 22,
        lip: -2,
        root: -235,
        radius: 66,
        /** Terraces fanning down the front. */
        terraces: 6,
        /** How far the isle leans its crown toward the eye (radians). */
        pitch: 0.3,
        /** Its centre's height above the eye: high, so its root crosses the horizon and the Mother
         * Fall is the tallest line in the frame. */
        y: 58,
        shapeSeed: 5,
    },
    twin: {
        dist: 820, top: 14, lip: -2, root: -135, radius: 36, terraces: 5, pitch: 0.3, y: -45, shapeSeed: 9,
    },
    gate: {
        dist: 13000, height: 2200, width: 1400, sink: 60,
    },
    archipelago: {
        dist: [7000, 16000],
    },
    /** The foreground crags: distance, size [width, height, depth], the local height of their sunlit top edge. */
    corner: {
        dist: 13, size: [9, 5, 6], sunLine: 1.4,
    },
});

const toWorld = (dir, dist, out) => {
    out[0] = dir[0] * dist;
    out[1] = dir[1] * dist;
    out[2] = dir[2] * dist;
    return out;
};

/** The bearing (radians, 0 ahead, + right) of a direction. */
export const bearingOf = (d) => Math.atan2(d[0], -d[2]);

/** Yaw that turns an object at bearing b so that its local +z faces the eye. */
export const faceYaw = (b) => -b;

/**
 * The bearing that lands a point `dist` metres out and `y` metres up at frame x `targetX`: a pitched
 * camera pulls low points toward the middle, so the horizon's bearing is only the first guess
 * (a few secant steps settle it).
 */
function bearingForScreenX(targetX, dist, y, cam, horizon) {
    const d = [0, 0, -1];
    const xAt = (b) => {
        const len = Math.hypot(dist, y);
        d[0] = (Math.sin(b) * dist) / len;
        d[1] = y / len;
        d[2] = (-Math.cos(b) * dist) / len;
        return project(d, cam).x;
    };
    unproject(targetX, horizon, cam, d);
    let b0 = bearingOf(d);
    let b1 = b0 + 0.02;
    let x0 = xAt(b0) - targetX;
    for (let i = 0; i < 6; i++) {
        const x1 = xAt(b1) - targetX;
        if (Math.abs(x1) < 1e-5 || Math.abs(x1 - x0) < 1e-9) break;
        const b2 = b1 - (x1 * (b1 - b0)) / (x1 - x0);
        b0 = b1;
        x0 = x1;
        b1 = b2;
    }
    return b1;
}

/**
 * Place the plan for a solved frame. `out` is reused. Each entry: { pos [x,y,z], yaw, scale }.
 *   spring, twin, gate, cornerL, cornerR, archipelago[k], thermals[k] (each with a pitch toward the eye)
 */
export function placePlan(frame, out = {}) {
    const { cam } = frame;
    const dir = [0, 0, -1];
    const smile = frame.plan === 'smile';
    const { horizon } = frame;
    const entry = (name) => {
        if (!out[name]) {
            out[name] = {
                pos: [0, 0, 0], yaw: 0, pitch: 0, scale: 1, bearing: 0,
            };
        }
        return out[name];
    };

    // ── The left group: the Spring Isle hangs off the bow's leg ──
    {
        const e = entry('spring');
        const p = PLAN.spring;
        // The isle's centre stands a little left of the leg's foot; the Mother Fall's lip (on its
        // right shoulder) is 5° of bearing left of the leg.
        // In a smile frame the isle stands in the free margin left of the cards (a row of boards
        // leaves only a sliver: it stands half out of the frame there).
        const free = frame.free || { left: 0.164, right: 0.836 };
        const footX = smile ? Math.min(0.07, free.left * 0.5) : frame.foot.x;
        unproject(footX, horizon, cam, dir);
        const legBearing = bearingOf(dir);
        const halfWidth = Math.atan(p.radius / p.dist);
        const dist = smile ? p.dist * 0.62 : p.dist;
        const bearing = smile
            ? bearingForScreenX(footX, dist, -95, cam, horizon)
            : legBearing - 5 * DEG - halfWidth * 0.8;
        e.bearing = bearing;
        e.pos[0] = Math.sin(bearing) * dist;
        e.pos[2] = -Math.cos(bearing) * dist;
        e.pos[1] = smile ? -95 : p.y;
        e.yaw = faceYaw(bearing);
        e.pitch = p.pitch;
        e.scale = smile ? 0.8 : 1;
    }

    // ── The right group: the Twin Isle right of the HUD ──
    {
        const e = entry('twin');
        const p = PLAN.twin;
        const free = frame.free || { left: 0.164, right: 0.836 };
        const x = smile ? Math.max(0.95, (free.right + 1) / 2) : 0.89;
        unproject(x, horizon, cam, dir);
        const dist = smile ? p.dist * 0.7 : p.dist;
        const bearing = smile ? bearingForScreenX(x, dist, -60, cam, horizon) : bearingOf(dir);
        e.bearing = bearing;
        e.pos[0] = Math.sin(bearing) * dist;
        e.pos[2] = -Math.cos(bearing) * dist;
        e.pos[1] = smile ? -60 : p.y;
        e.yaw = faceYaw(bearing);
        e.pitch = p.pitch;
        e.scale = smile ? 0.75 : 1;
    }
    // ── The Far Gate, on the horizon ──
    {
        const e = entry('gate');
        const p = PLAN.gate;
        // A colossal coulisse on the right, beyond the HUD and left of the Twin Isle: scaled so its
        // head stands about a third of the way down the frame (the far, pale counterweight to the
        // near, dark Spring Isle on the left).
        const x = smile ? 0.8 : 0.85;
        const headY = smile ? 0.2 : 0.3;
        unproject(x, horizon, cam, dir);
        const bearing = bearingOf(dir);
        unproject(x, headY, cam, dir);
        const elev = Math.asin(Math.max(-1, Math.min(1, dir[1])));
        e.bearing = bearing;
        e.pos[0] = Math.sin(bearing) * p.dist;
        e.pos[2] = -Math.cos(bearing) * p.dist;
        e.pos[1] = -p.height * 0.12;
        e.scale = clamp((Math.tan(elev) * p.dist + p.height * 0.12) / (p.height - p.sink), 0.8, 1.6);
        // Turned a little off square, so a pier's reveal and the arch's soffit fall into the key:
        // three planes of value, not a cut-out.
        e.yaw = faceYaw(bearing) + 0.36;
    }

    // ── The corners: pinned to the frame's bottom corners, close by ──
    {
        const e = entry('cornerL');
        unproject(0.02, 1.07, cam, dir);
        toWorld(dir, PLAN.corner.dist, e.pos);
        e.bearing = bearingOf(dir);
        e.yaw = faceYaw(e.bearing);
        // A narrow (phone) frame would let the overlook fill its foot: there it shrinks toward its
        // anchor under the frame's edge, two small dark coulisses in the corners.
        const narrow = cam.aspect < 1;
        e.scale = narrow ? 0.5 : 1;
        const r = entry('cornerR');
        unproject(0.97, 1.07, cam, dir);
        toWorld(dir, PLAN.corner.dist * 1.1, r.pos);
        r.bearing = bearingOf(dir);
        r.yaw = faceYaw(r.bearing);
        r.scale = narrow ? 0.5 : 1;
    }

    // ── The far archipelago: three bands, nearest first (a tier draws a prefix) ──
    // [screen x, elevation (deg), distance (m), radius (m)]: two near isles below the horizon that
    // show their crowns, a mid band and far silhouettes whose roots are all mist, floating at many
    // heights (never a bead-string along the horizon). Sizes are true, so the far ones read small.
    if (!out.archipelago) out.archipelago = [];
    {
        const table = smile
            ? [[0.12, -1.5, 5200, 210], [0.86, -2.0, 6000, 240], [0.3, 0.5, 9000, 220], [0.7, 1.2, 10000, 260],
                [0.5, 0.2, 9500, 180], [0.95, 0.8, 8500, 200], [0.2, 1.5, 16000, 320], [0.62, 2.2, 18000, 300],
                [0.82, 0.6, 15000, 360], [0.4, 1.8, 19000, 280], [0.05, 0.9, 17000, 300], [1.0, 2.6, 20000, 260],
                [0.55, 3.0, 21000, 300], [0.28, 2.8, 22000, 340], [0.75, 3.4, 23000, 280], [0.9, 2.0, 24000, 320]]
            : [[0.42, -1.5, 5200, 200], [0.79, -2.0, 6200, 240], [0.33, 1.8, 8600, 220], [0.53, -1.0, 9400, 180],
                [0.69, 3.6, 10200, 260], [0.93, -1.7, 9000, 200], [0.27, 4.4, 15000, 300], [0.47, 2.6, 17000, 260],
                [0.6, 5.2, 16000, 350], [0.66, 0.5, 18000, 280], [0.99, 3.8, 15500, 320], [1.07, 1.2, 19000, 260],
                [0.2, 0.9, 20000, 300], [0.55, 1.7, 21000, 260], [0.75, 6.0, 22000, 330], [0.12, 3.1, 19500, 300]];
        table.forEach(([x, elevDeg, dist, radius], i) => {
            const e = out.archipelago[i] || (out.archipelago[i] = {
                pos: [0, 0, 0], yaw: 0, pitch: 0, scale: 1, bearing: 0, radius: 200, variant: 0, squash: [1, 1], roll: 0,
            });
            unproject(clamp(x, -0.2, 1.2), horizon, cam, dir);
            const bearing = bearingOf(dir);
            e.bearing = bearing;
            e.pos[0] = Math.sin(bearing) * dist;
            e.pos[2] = -Math.cos(bearing) * dist;
            e.pos[1] = Math.tan(elevDeg * DEG) * dist;
            e.yaw = faceYaw(bearing) + ((i * 1.7) % 1) - 0.5;
            // Each leans its crown a little toward the eye (the nearer, the more), as the near isles do,
            // and has its own build: squat or tall, broad or narrow, tilted a few degrees aside.
            e.pitch = 0.08 + 0.2 * clamp((12000 - dist) / 7000, 0, 1);
            e.squash = [0.8 + ((i * 0.618) % 1) * 0.5, 0.65 + ((i * 0.377 + 0.2) % 1) * 0.75];
            e.roll = (((i * 0.731) % 1) - 0.5) * 0.28;
            e.radius = radius;
            // The scale the hairline falls read (their lip and width), in units of 200 m.
            e.scale = radius / 200;
            e.variant = (i * 3) % 5;
        });
        out.archipelago.length = table.length;
    }

    // ── Thermals the children circle on at rest (screen anchors, metres away) ──
    if (!out.thermals) out.thermals = [];
    const thermals = smile
        ? [[0.12, 0.3, 300], [0.88, 0.25, 320], [0.5, 0.94, 380], [0.2, 0.97, 420]]
        : [[0.27, 0.56, 300], [0.18, 0.33, 340], [0.86, 0.3, 280], [0.95, 0.62, 420], [0.33, 0.78, 380]];
    thermals.forEach(([x, y, d], i) => {
        const e = out.thermals[i] || (out.thermals[i] = { pos: [0, 0, 0], radius: 24 });
        unproject(x, y, cam, dir);
        toWorld(dir, d, e.pos);
        e.radius = 18 + (i % 3) * 6;
    });
    out.thermals.length = thermals.length;
    return out;
}
