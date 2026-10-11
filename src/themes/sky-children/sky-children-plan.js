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
import { DEG, clamp, lerp } from './sky-children-core.js';
import { project, unproject } from './sky-children-frame.js';

/** Authored sizes and distances (metres). */
export const PLAN = Object.freeze({
    spring: {
        dist: 470,
        /** The summit, the rim (where the moss crown meets the root), the root's tip (local metres). */
        top: 22,
        lip: -2,
        root: -330,
        radius: 58,
        /** Terraces fanning down the front. */
        terraces: 8,
        /** How far the isle leans its crown toward the eye (radians). */
        pitch: 0.36,
        /** Its centre's height above the eye. */
        y: 18,
        shapeSeed: 5,
    },
    twin: {
        dist: 640, top: 14, lip: -2, root: -230, radius: 30, terraces: 5, pitch: 0.24, y: 6, shapeSeed: 9,
    },
    gate: {
        dist: 12000, height: 1150, width: 760, sink: 30,
    },
    archipelago: {
        dist: [7000, 16000],
    },
    /** The foreground crags: distance, size [width, height, depth], the local height of their sunlit top edge. */
    corner: {
        dist: 46, size: [9, 5, 6], sunLine: 1.4,
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
        // It stands far behind the bow's foot: the leg plunges through it.
        unproject(smile ? 0.35 : frame.foot.x + 0.012, horizon, cam, dir);
        const bearing = bearingOf(dir);
        e.bearing = bearing;
        e.pos[0] = Math.sin(bearing) * p.dist;
        e.pos[2] = -Math.cos(bearing) * p.dist;
        e.pos[1] = -p.height * 0.32;
        e.yaw = faceYaw(bearing);
        e.scale = 1;
    }

    // ── The corners: pinned to the frame's bottom corners, close by ──
    {
        const e = entry('cornerL');
        unproject(smile ? 0.04 : 0.04, 1.06, cam, dir);
        toWorld(dir, PLAN.corner.dist, e.pos);
        e.bearing = bearingOf(dir);
        e.yaw = faceYaw(e.bearing);
        e.scale = 1;
        const r = entry('cornerR');
        unproject(smile ? 0.96 : 0.96, 1.05, cam, dir);
        toWorld(dir, PLAN.corner.dist * 1.1, r.pos);
        r.bearing = bearingOf(dir);
        r.yaw = faceYaw(r.bearing);
        r.scale = 1;
    }

    // ── The far archipelago: three paling layers along the horizon ──
    if (!out.archipelago) out.archipelago = [];
    {
        const n = 16;
        for (let i = 0; i < n; i++) {
            const e = out.archipelago[i] || (out.archipelago[i] = {
                pos: [0, 0, 0], yaw: 0, scale: 1, bearing: 0,
            });
            const layer = i % 3;
            const x = smile ? lerp(-0.1, 1.1, ((i * 0.618) % 1)) : lerp(0.3, 1.08, ((i * 0.618 + layer * 0.21) % 1));
            unproject(clamp(x, -0.2, 1.2), horizon, cam, dir);
            const bearing = bearingOf(dir);
            const dist = lerp(PLAN.archipelago.dist[0], PLAN.archipelago.dist[1], layer / 2) * (1 + ((i * 0.37) % 0.3));
            e.bearing = bearing;
            e.pos[0] = Math.sin(bearing) * dist;
            e.pos[2] = -Math.cos(bearing) * dist;
            e.pos[1] = -dist * (0.012 + ((i * 0.23) % 0.02));
            e.yaw = faceYaw(bearing) + ((i * 1.7) % 1);
            e.scale = (dist / 9000) * (0.4 + ((i * 0.41) % 0.35));
        }
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
