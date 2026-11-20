/**
 * Stillwater — the troll's own flesh: what his arms keep out of (numbers only, three-free).
 *
 * He is a stout old troll: his belly stands further forward than his knees do when he sits, his
 * loincloth is wider than his hips, and his arms are as thick as a man's thighs. Posed by where
 * his wrists should be alone, a forearm goes straight through his belly to lay a hand on his heart,
 * and the hand he rests on his knee lies inside his own lap.
 *
 * His file names the masses he is built of (scripts/blender/stillwater/troll_shape.py `masses`, in
 * the file's extras as `flesh`): his pelvis, belly, chest, skull and jaw (ellipsoids), his
 * loincloth (an elliptic band from its belt to its hem) and his thighs, shins, nose and long ears
 * (round cones), each with the bone that carries it, in the model's rest frame; and how thick his
 * forearm, his open right hand and his left fist are down their length. The body
 * (stillwater-troll-body.js) asks here how deep a ball stands in one of them and which way is out,
 * and moves his wrist and swings his elbow until his arm lies on him, not in him.
 */

/**
 * How far (model units: a hundredth is three centimetres of him) an arm may sink into him before
 * it is moved: he is soft, and a hand laid on his knee or his heart lies a little IN it. And how
 * many times a frame an arm is solved again after it is moved, and how soon a move settles (s).
 */
export const FLESH = Object.freeze({
    give: 0.012,
    /** How far short of touching (model units) an arm begins to yield: a touch has no edge. */
    soft: 0.008,
    /** What a forearm gives (it is not laid on him: it only passes). */
    pass: 0.004,
    /** How much wider a thigh is under his cloth when it lies on it (seated, on his haunches). */
    lap: 0.03,
    passes: 5,
    halfLife: 0.035,
    /** How near his body (model units) a hand begins to lie flat on it, and how steeply it must point in to. */
    near: 0.05,
    into: 0.3,
});

/** A ball round the whole of a mass: its middle (the mass's own frame) and its reach. */
export function massBall(mass) {
    if (mass.kind === 'ell') return { mid: [...mass.c], reach: Math.max(...mass.r) };
    if (mass.kind === 'wrap') {
        const half = (mass.top - mass.hem) / 2;
        return { mid: [0, mass.hem + half, mass.z0], reach: Math.hypot(Math.max(...mass.rx, ...mass.rz) + mass.thick, half) };
    }
    const mid = mass.a.map((v, i) => (v + mass.b[i]) / 2);
    return { mid, reach: Math.hypot(mass.a[0] - mid[0], mass.a[1] - mid[1], mass.a[2] - mid[2]) + Math.max(mass.r1, mass.r2) };
}

/** The file's `flesh` as the body takes it (null where a file has none: an older sculpt). */
export function fleshFromSpec(spec) {
    const flesh = spec?.flesh;
    if (!flesh || !Array.isArray(flesh.masses) || !flesh.masses.length) return null;
    return {
        // (`lap`: a thigh, which his cloth lies on when he sits. `mid`, `reach`: a ball round the
        // whole of it, so a point far from it need not be measured against it.)
        masses: flesh.masses.map((m) => ({ ...m, lap: /^thigh/.test(m.name), ...massBall(m) })),
        fore: (flesh.fore || []).map((row) => [row[0], row[1]]),
        hand: (flesh.hand || []).map((row) => [row[0], row[1]]),
        fist: (flesh.fist || flesh.hand || []).map((row) => [row[0], row[1]]),
        /** How round his fist is about the staff, where it runs through it. */
        grip: Number.isFinite(flesh.grip) ? flesh.grip : 0.055,
    };
}

/**
 * How deep the point (x, y, z) stands in `mass`, in the mass's own frame (the model's, at rest):
 * positive inside, negative that far outside. Writes the way out (a unit vector) into `n`.
 * @param {object} mass  one of the file's masses
 * @param {number[]} n   [x, y, z], written
 */
export function massDepth(mass, x, y, z, n) {
    const out = n;
    if (mass.kind === 'ell') {
        const qx = x - mass.c[0];
        const qy = y - mass.c[1];
        const qz = z - mass.c[2];
        const [rx, ry, rz] = mass.r;
        const k0 = Math.hypot(qx / rx, qy / ry, qz / rz);
        const gx = qx / (rx * rx);
        const gy = qy / (ry * ry);
        const gz = qz / (rz * rz);
        const k1 = Math.hypot(gx, gy, gz);
        if (k1 < 1e-9) {
            // (Its very middle: any way out is as far.)
            out[0] = 0;
            out[1] = 0;
            out[2] = 1;
            return Math.min(rx, ry, rz);
        }
        out[0] = gx / k1;
        out[1] = gy / k1;
        out[2] = gz / k1;
        return -(k0 * (k0 - 1)) / k1;
    }
    if (mass.kind === 'wrap') {
        // An elliptic band, wider at its hem: out through its side, or down past its hem (never up:
        // his belly is over it).
        const t = Math.min(1, Math.max(0, (mass.top - y) / (mass.top - mass.hem)));
        const rx = mass.rx[0] + (mass.rx[1] - mass.rx[0]) * t;
        const rz = mass.rz[0] + (mass.rz[1] - mass.rz[0]) * t;
        const qz = z - mass.z0;
        const rho = Math.hypot(x / rx, qz / rz);
        const side = mass.thick - (rho - 1) * Math.min(rx, rz);
        const under = y - mass.hem;
        const over = y - mass.top;
        // The way out through its side.
        const gx = x / (rx * rx);
        const gz = qz / (rz * rz);
        const g = Math.hypot(gx, gz);
        const sx = g < 1e-9 ? 0 : gx / g;
        const sz = g < 1e-9 ? 1 : gz / g;
        if (side > 0 && under > 0) {
            // Within its girth and above its hem: in it (or in his belly over it, whose way out is
            // the same: through the side).
            if (over <= 0 && under < side) {
                out[0] = 0;
                out[1] = -1;
                out[2] = 0;
                return under;
            }
            out[0] = sx;
            out[1] = 0;
            out[2] = sz;
            return over > 0 ? Math.min(side, -over) : side;
        }
        // Clear of it: how far from its nearest edge, and the way that edge lies behind.
        const ox = Math.max(0, -side);
        const oy = over > 0 ? over : Math.max(0, -under);
        const d = Math.hypot(ox, oy) || 1e-9;
        const sy = over > 0 ? 1 : -1;
        out[0] = (sx * ox) / d;
        out[1] = (sy * oy) / d;
        out[2] = (sz * ox) / d;
        return -d;
    }
    // A round cone from a to b.
    const ax = mass.b[0] - mass.a[0];
    const ay = mass.b[1] - mass.a[1];
    const az = mass.b[2] - mass.a[2];
    const l2 = ax * ax + ay * ay + az * az || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - mass.a[0]) * ax + (y - mass.a[1]) * ay + (z - mass.a[2]) * az) / l2));
    const vx = x - mass.a[0] - ax * t;
    const vy = y - mass.a[1] - ay * t;
    const vz = z - mass.a[2] - az * t;
    const d = Math.hypot(vx, vy, vz);
    if (d < 1e-9) {
        out[0] = 1;
        out[1] = 0;
        out[2] = 0;
    } else {
        out[0] = vx / d;
        out[1] = vy / d;
        out[2] = vz / d;
    }
    return mass.r1 + (mass.r2 - mass.r1) * t - d;
}
