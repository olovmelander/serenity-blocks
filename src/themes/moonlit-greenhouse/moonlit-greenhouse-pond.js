/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the lily canal: the still water down the middle of the nave, the lily pads
 * on it and the reeds at its edges.
 *
 * The water is black-green and still, and at night still water is a mirror: what the eye sees in
 * it is the house turned upside down. It is not rendered twice. The house is a closed shape, so
 * the reflected view ray is traced in closed form to where it leaves it (mgHouseExit) and the
 * glass there is shaded as the glass itself shades it: the glazing's iron dark (mgGlazing, with
 * its lath blinds), the night beyond (mgSky, the disc drawn about the moon's direction), the film
 * on the panes lit into a halo round the moon. So the moon, the lattice and the blinds stand
 * upside down in the water exactly where they should. What stands IN the house is added in closed
 * form along the same ray:
 *   the palms' crowns (the analytic canopy of mgCanopy, read along the mirrored ray instead of
 *   toward the moon), the beds' foliage (two ragged walls of leaves at the beds' fronts and
 *   middles, from the broad noise), the bed kerbs, the coping and the canal wall, and the reed
 *   clumps in the water (their dark fans, ruled by blades) — all dark, as their reflections are;
 *   the lanterns and the open blooms as soft warm and jewel-coloured images, each where the
 *   mirrored ray passes closest to it, stretched down the water by the ripples the way a lamp's
 *   image on a pond is a broken column.
 * The surface is never quite flat: a slow swell of four long waves and a fine ripple from the
 * noise, both with physical slopes (a few hundredths), so the lattice wavers; and the rings a
 * lock leaves when its lily lands on the canal (U.rings): a crisp leading crest and a soft train
 * of wavelets behind it, which bend the mirror, carry a band of the ring's colour, and wake the
 * plankton — points of the night's bioluminescent glow that sparkle where a ring has passed and
 * fade over seconds. A faint glitter of them rests on the water always, and now and then a fish
 * rises and leaves a ring of its own. Fresnel: steeply below the eye the water is mostly its own
 * dark body (the moon's lattice faintly lit in its murk), toward the far end nearly all mirror.
 *
 * The pads lie on it: a few giant Victoria amazonica pads, round and ribbed, their turned-up
 * rims showing the red-purple underside on the outside (with its spines) and glowing ruby where
 * the moon stands behind them, each rim cleft by its notch; and many small notched water-lily
 * pads, waxy, catching the lanterns. All bob on the swell and rock as a ring runs under them, and
 * all are lit by mgSurface, so the moon's lattice lies across them; dew beads glint on some. A
 * handful of resident white water lilies stand on the lily pads: closed buds and half-open
 * flowers, their petals faintly luminous, their hearts gold.
 *
 * The reeds stand in clumps at the canal's edges: long strap leaves arching over, cattail stalks
 * with their dark velvet heads and the thin spike above, swaying in the greenhouse air, with the
 * T-spin's turn and with the gusts; dark against the bright mirror, their edges luminous where
 * the moon is behind them (mgSurface's light through thin leaves). The nearest clumps frame the
 * foot of the picture.
 *
 * Parts: water (one draw), pads (Victoria, lily pads, lilies: three draws), reeds (one draw).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, atan, attribute, cameraPosition, clamp, cos, dot, exp, float, floor, fract, frontFacing, fwidth,
    int, length, log2, max, min, mix, normalGeometry, normalize, positionGeometry, positionWorld, reflect, select,
    sin, smoothstep, sqrt, texture, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import {
    FLOOR, HOUSE, TIMING, clamp as clampJs, lerp, mulberry32,
} from './moonlit-greenhouse-core.js';
import {
    mgCanopy, mgGlazing, mgHash21, mgHash33, mgHouseExit, mgLanterns, mgLine, mgMax3, mgMoonVis, mgSky, mgSurface,
} from './moonlit-greenhouse-tsl.js';

// TEMP-DEBUG (remove before shipping)
const DBG = (() => {
    try { return new URLSearchParams(globalThis.location?.search || '').get('pondDebug') || ''; } catch (e) { return ''; }
})();
const dbg = (k) => DBG.split(',').includes(k);

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/** The look's numbers for the canal (the theme ships these). */
export const POND_LOOK = {
    // The mirror: its least reflectance (looking steeply down); Schlick's term rises from it to 1.
    mirrorFloor: 0.26,
    // The fine ripple: its slope gain on the noise's gradient, and noise tiles per metre.
    ripple: 0.0025,
    rippleScale: 0.3,
    // The water's own colour (black-green) and the moonlight its murk scatters under the beams.
    body: Object.freeze([0.0018, 0.0052, 0.0046]),
    murk: 0.014,
    // The lanterns' and the blooms' images in the water.
    lanternImage: 1.5,
    bloomImage: 0.5,
    // The rings: their slope, the band of their colour, the plankton they wake.
    ringSlope: 0.11,
    ringBand: 0.34,
    plankton: 2.6,
    // The plankton's resting glitter, and the fish that rise now and then at rest.
    glitter: 0.45,
    rising: 0.42,
    // The pads' lift and tilt as a ring runs under them (multiples of the water's own).
    padLift: 4.5,
    padTilt: 0.75,
};

/**
 * The swell: four long, slow waves (direction as an angle from straight down the house, metres
 * of wavelength, metres a second, peak slope). The water's normal and the pads' bob read the same
 * sum, so a pad rides the wave the mirror shows.
 */
export const SWELL = Object.freeze([
    Object.freeze({
        angle: 0.35, length: 2.9, speed: 0.21, slope: 0.0065, phase: 0.0,
    }),
    Object.freeze({
        angle: -0.9, length: 1.85, speed: 0.17, slope: 0.0055, phase: 1.7,
    }),
    Object.freeze({
        angle: 2.05, length: 1.25, speed: 0.13, slope: 0.0045, phase: 4.1,
    }),
    Object.freeze({
        angle: 2.75, length: 0.8, speed: 0.1, slope: 0.0035, phase: 2.6,
    }),
]);

/** The swell at (x, z) and time t: { h, sx, sz } (metres; slopes). CPU twin of mgPondSwell. */
export function swellAt(x, z, t) {
    let h = 0;
    let sx = 0;
    let sz = 0;
    SWELL.forEach((w) => {
        const k = (Math.PI * 2) / w.length;
        const dx = Math.sin(w.angle);
        const dz = -Math.cos(w.angle);
        const ph = (x * dx + z * dz) * k - t * w.speed * k + w.phase;
        h += Math.sin(ph) * (w.slope / k);
        sx += Math.cos(ph) * w.slope * dx;
        sz += Math.cos(ph) * w.slope * dz;
    });
    return { h, sx, sz };
}

/**
 * A ring on the canal: it is born `start` metres across and runs out at `speed`; its wavelets are
 * `wavelength` apart (a little longer as it ages), its leading crest `spread` wide, and the train
 * behind the front dies over 1 / `wake` metres. It lives TIMING.ringLife seconds.
 */
export const RING = Object.freeze({
    start: 0.1,
    speed: 0.55,
    wavelength: 0.13,
    spread: 0.026,
    wake: 2.4,
    life: TIMING.ringLife,
});

/** How far a ring's front has run at `age` seconds. */
export function ringRadius(age) {
    return RING.start + RING.speed * Math.max(0, age);
}

/**
 * The Victoria pad's section (metres): its floor stands `floor` over the water; the rim rises
 * from a fillet of `fillet` to `rim` (least..most), leaning out by `flare`, rolls over a lip
 * `lip` thick and drops as the outer skirt to `skirt` under the floor. The notch is a cleft in
 * the rim `notch` radians either side of its middle.
 */
export const VICTORIA = Object.freeze({
    floor: 0.016,
    fillet: 0.03,
    rim: Object.freeze([0.06, 0.1]),
    flare: 0.014,
    lip: 0.009,
    skirt: 0.012,
    notch: 0.12,
});

/** A small water-lily pad: floor over the water, the sinus's half-width at the rim (radians). */
export const LILY_PAD = Object.freeze({
    floor: 0.014,
    sinus: 0.2,
});

/** What a resident lily is made of (aPetal.z). */
export const PETAL = Object.freeze({ sepal: 0, petal: 1, stamen: 2 });

/** What a reed vertex is (aBlade.y). */
export const REED = Object.freeze({
    leaf: 0, stalk: 1, head: 2, spike: 3,
});

/** Per tier: Victoria segments round, lily pad segments, reed segments along a blade, clumps mirrored. */
function detailFor(tier) {
    const rich = tier.frond >= 16;
    return {
        victoria: tier.frond >= 20 ? 112 : (rich ? 96 : (tier.frond >= 12 ? 80 : 64)),
        lily: rich ? 28 : 20,
        reed: clampJs(Math.round(tier.frond / 2), 4, 10),
        clumps: clampJs(Math.round(tier.reeds / 16), 10, 24),
        lilies: clampJs(Math.round(tier.pads / 9), 3, 8),
    };
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

/** A merged sheet: positions, normals and named vec4 attributes, indexed. */
class Sheet {
    constructor(names) {
        this.position = [];
        this.normal = [];
        this.names = names;
        this.attr = Object.fromEntries(names.map((n) => [n, []]));
        this.index = [];
        this.count = 0;
    }

    vertex(p, n, values) {
        this.position.push(p[0], p[1], p[2]);
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        this.normal.push(n[0] / l, n[1] / l, n[2] / l);
        this.names.forEach((name) => {
            const v = values[name];
            this.attr[name].push(v[0], v[1], v[2], v[3]);
        });
        this.count += 1;
        return this.count - 1;
    }

    tri(a, b, c) {
        this.index.push(a, b, c);
    }

    /**
     * Quads between rows of vertex ids: rows[j][i], with j the slow direction. Wound so that the
     * face normal is cross(∂/∂i, ∂/∂j) for `flip` false (see each caller for which way that is).
     */
    grid(rows, flip = false) {
        for (let j = 0; j + 1 < rows.length; j += 1) {
            const r0 = rows[j];
            const r1 = rows[j + 1];
            for (let i = 0; i + 1 < r0.length; i += 1) {
                if (flip) {
                    this.tri(r0[i], r1[i], r0[i + 1]);
                    this.tri(r0[i + 1], r1[i], r1[i + 1]);
                } else {
                    this.tri(r0[i], r0[i + 1], r1[i]);
                    this.tri(r0[i + 1], r1[i + 1], r1[i]);
                }
            }
        }
    }

    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
        this.names.forEach((name) => g.setAttribute(name, new THREE.Float32BufferAttribute(this.attr[name], 4)));
        g.setIndex(this.index);
        g.computeBoundingSphere();
        return g;
    }
}

/** The canal's water: one sheet over the canal at the water's level, facing up. */
export function buildWaterGeometry() {
    const { half, water, head, end } = FLOOR.canal;
    const length = head - end;
    const g = new THREE.PlaneGeometry(half * 2, length, 1, Math.ceil(length / 3));
    g.rotateX(-Math.PI / 2);
    g.translate(0, water, (head + end) / 2);
    g.deleteAttribute('uv');
    g.computeBoundingSphere();
    return g;
}

/** A pad's local frame: (lx, lz) in metres from its centre, the notch along +lx. */
function padFrame(pad) {
    const c = Math.cos(pad.yaw);
    const s = Math.sin(pad.yaw);
    return {
        point: (lx, y, lz) => [pad.x + lx * c - lz * s, y, pad.z + lx * s + lz * c],
        dir: (lx, ny, lz) => [lx * c - lz * s, ny, lx * s + lz * c],
    };
}

/** A pad's integer seed (0..999), so that the shaders hash an exact value. */
const seedOf = (pad) => Math.floor(pad.seed * 1000);

/**
 * The Victoria pad's section at one bearing, walked from the centre out: floor, fillet, the rim's
 * inner face up to `top`, over the lip and down the outer skirt. Each point: { rho, y, part, h }
 * (part 0 floor, 1 inner rim, 2 lip, 3 outer skirt; h 0..1 up the rim).
 */
export function victoriaSection(radius, top) {
    const V = VICTORIA;
    const f = V.floor;
    const fil = Math.min(V.fillet, Math.max(0.004, top - f));
    const pts = [];
    [0, 0.1, 0.24, 0.4, 0.56, 0.7, 0.82, 0.92].forEach((k) => {
        pts.push({
            rho: k * (radius - fil), y: f, part: 0, h: 0,
        });
    });
    for (let i = 1; i <= 4; i += 1) {
        const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
        pts.push({
            rho: radius - fil + fil * Math.cos(a), y: f + fil + fil * Math.sin(a), part: 1, h: 0,
        });
    }
    const wallFrom = f + fil;
    const span = Math.max(0.002, top - wallFrom);
    for (let i = 1; i <= 3; i += 1) {
        const k = i / 3;
        pts.push({
            rho: radius + V.flare * k * k, y: wallFrom + span * k, part: 1, h: k,
        });
    }
    const out = radius + V.flare;
    pts.push({
        rho: out + V.lip * 0.5, y: top + 0.003, part: 2, h: 1,
    });
    pts.push({
        rho: out + V.lip, y: top - 0.006, part: 3, h: 1,
    });
    const drop = top - 0.006 - (f - V.skirt);
    for (let i = 1; i <= 3; i += 1) {
        const k = i / 3;
        pts.push({
            rho: out + V.lip - V.flare * 0.7 * k, y: top - 0.006 - drop * k, part: 3, h: 1 - k,
        });
    }
    return pts;
}

/** The rim's height at bearing `phi` (the notch at 0): a cleft down nearly to the floor. */
function victoriaTop(rimTop, phi) {
    const d = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
    const k = d < VICTORIA.notch * 0.3 ? 0 : Math.min(1, (d - VICTORIA.notch * 0.3) / (VICTORIA.notch * 0.7));
    const s = k * k * (3 - 2 * k);
    return lerp(VICTORIA.floor + 0.006, rimTop, s);
}

/** Every Victoria pad of the plan, merged: a surface of revolution of its section. */
export function buildVictoriaGeometry(pads, segments = 96) {
    const sheet = new Sheet(['aPad', 'aLeaf']);
    const { water } = FLOOR.canal;
    pads.filter((p) => p.kind === 'victoria').forEach((pad) => {
        const frame = padFrame(pad);
        const rimTop = VICTORIA.floor + lerp(VICTORIA.rim[0], VICTORIA.rim[1], (pad.seed * 7.31) % 1);
        const aPad = [pad.x, pad.z, seedOf(pad), pad.radius];
        const columns = [];
        for (let j = 0; j <= segments; j += 1) {
            const phi = (j / segments) * Math.PI * 2;
            const c = Math.cos(phi);
            const s = Math.sin(phi);
            const section = victoriaSection(pad.radius, victoriaTop(rimTop, phi));
            const ids = section.map((q, i) => {
                // The section's left normal (−dy, dρ), from its neighbours.
                const a = section[Math.max(0, i - 1)];
                const b = section[Math.min(section.length - 1, i + 1)];
                const dr = b.rho - a.rho;
                const dy = b.y - a.y;
                const nr = -dy;
                const ny = dr;
                const lx = q.rho * c;
                const lz = q.rho * s;
                return sheet.vertex(frame.point(lx, water + q.y, lz), frame.dir(nr * c, ny, nr * s), {
                    aPad,
                    aLeaf: [lx, lz, q.part, q.h],
                });
            });
            columns.push(ids);
        }
        // rows[j] = bearing j, i along the section: cross(∂/∂i, ∂/∂j) = cross(radial, φ̂) points
        // down on the floor, so the faces are wound the other way (flip) to face up and in.
        sheet.grid(columns, true);
    });
    return sheet.geometry();
}

/** A lily pad's surface height over its floor at (rho, phi): a flat leaf whose margin waves a little. */
function lilyHeight(pad, rho, phi) {
    const k = rho / pad.radius;
    return LILY_PAD.floor + 0.004 * k * k + 0.0035 * Math.sin(phi * 5 + pad.seed * 40) * k * k * k;
}

/** Every small lily pad, merged: a disc with its sinus cut from the margin to the middle. */
export function buildLilyPadGeometry(pads, segments = 24) {
    const sheet = new Sheet(['aPad', 'aLeaf']);
    const { water } = FLOOR.canal;
    const rings = [0, 0.18, 0.4, 0.62, 0.82, 0.94, 1.0];
    pads.filter((p) => p.kind === 'lily').forEach((pad) => {
        const frame = padFrame(pad);
        const aPad = [pad.x, pad.z, seedOf(pad), pad.radius];
        const rows = rings.map((k) => {
            const rho = k * pad.radius;
            // The sinus narrows to a slit at the middle.
            const w = LILY_PAD.sinus * k + 0.03;
            const ids = [];
            for (let j = 0; j <= segments; j += 1) {
                const phi = w + (j / segments) * (Math.PI * 2 - 2 * w);
                const lx = rho * Math.cos(phi);
                const lz = rho * Math.sin(phi);
                const e = 0.004;
                const hx = (lilyHeight(pad, Math.hypot(lx + e, lz), Math.atan2(lz, lx + e))
                    - lilyHeight(pad, Math.hypot(lx - e, lz), Math.atan2(lz, lx - e))) / (2 * e);
                const hz = (lilyHeight(pad, Math.hypot(lx, lz + e), Math.atan2(lz + e, lx))
                    - lilyHeight(pad, Math.hypot(lx, lz - e), Math.atan2(lz - e, lx))) / (2 * e);
                ids.push(sheet.vertex(frame.point(lx, water + lilyHeight(pad, rho, phi), lz), frame.dir(-hx, 1, -hz), {
                    aPad,
                    aLeaf: [lx, lz, 0, k],
                }));
            }
            return ids;
        });
        // rows[i] = ring i, j along the bearing: cross(∂/∂j, ∂/∂i) = cross(φ̂, radial) is up.
        sheet.grid(rows, false);
    });
    return sheet.geometry();
}

/**
 * The resident white water lilies: a few of the larger lily pads near the eye each hold one, a
 * closed bud, a half-open or an open flower. Returns [{ pad, state, x, z, size, seed }].
 */
export function residentLilies(pads, count) {
    const states = ['half', 'bud', 'open', 'bud', 'half', 'open', 'bud', 'half'];
    const candidates = pads
        .filter((p) => p.kind === 'lily' && p.radius >= 0.19 && p.z < 0.2 && p.z > -18)
        .map((p) => ({ p, score: Math.abs(p.z + 5) + (Math.abs(p.x) < 0.5 ? 3 : 0) }))
        .sort((a, b) => a.score - b.score);
    const out = [];
    for (let i = 0; i < candidates.length && out.length < count; i += 1) {
        const { p } = candidates[i];
        // The flower stands off the pad's middle, away from its sinus.
        const off = p.radius * 0.18;
        out.push({
            pad: p,
            state: states[out.length % states.length],
            x: p.x - Math.cos(p.yaw) * off,
            z: p.z - Math.sin(p.yaw) * off,
            size: lerp(0.1, 0.135, (p.seed * 5.17) % 1),
            seed: (p.seed * 13.7) % 1,
        });
    }
    return out;
}

/**
 * A petal (or sepal, or stamen) as a cupped strip rising from `base` along bearing `phi`: it
 * leaves at `elev` radians over the horizontal and curls by `bend` toward its tip; `length`,
 * `width` at its widest, `cup` the lift of its margins toward the flower's axis.
 */
function addPetal(sheet, base, phi, {
    elev, bend, length, width, cup, kind, steps = 6, across = 4,
}, aPad, seed) {
    const radial = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    const rows = [];
    let p = [...base];
    for (let j = 0; j <= steps; j += 1) {
        const s = j / steps;
        const th = elev + bend * s;
        const tangent = [radial[0] * Math.cos(th), Math.sin(th), radial[2] * Math.cos(th)];
        // The petal's inner normal: cross(side, tangent).
        const inner = [
            side[1] * tangent[2] - side[2] * tangent[1],
            side[2] * tangent[0] - side[0] * tangent[2],
            side[0] * tangent[1] - side[1] * tangent[0],
        ];
        const w = width * Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.04)) ** 0.75 * (1 - 0.25 * s);
        const row = [];
        for (let i = 0; i <= across; i += 1) {
            const c = (i / across) * 2 - 1;
            const lift = cup * c * c * w;
            const q = [
                p[0] + side[0] * c * w + inner[0] * lift,
                p[1] + side[1] * c * w + inner[1] * lift,
                p[2] + side[2] * c * w + inner[2] * lift,
            ];
            // The margins turn toward the axis: tilt the normal with the cup's slope.
            const n = [
                inner[0] - side[0] * 2 * cup * c,
                inner[1] - side[1] * 2 * cup * c,
                inner[2] - side[2] * 2 * cup * c,
            ];
            row.push(sheet.vertex(q, n, { aPad, aPetal: [s, c, kind, seed] }));
        }
        rows.push(row);
        const step = length / steps;
        p = [p[0] + tangent[0] * step, p[1] + tangent[1] * step, p[2] + tangent[2] * step];
    }
    // rows[j] along the petal, i across: cross(∂/∂i, ∂/∂j) = cross(side, tangent) = the inner side.
    sheet.grid(rows, false);
}

/** The whorls of a lily in each state: [count, elev, bend, length share, width share, cup, kind]. */
const WHORLS = Object.freeze({
    bud: [
        [4, 1.32, -0.62, 1.0, 0.42, 0.55, PETAL.sepal],
        [4, 1.4, -0.7, 0.92, 0.36, 0.5, PETAL.petal],
    ],
    half: [
        [4, 0.42, 0.18, 1.0, 0.36, 0.35, PETAL.sepal],
        [8, 0.72, 0.28, 0.98, 0.3, 0.42, PETAL.petal],
        [8, 1.08, -0.05, 0.84, 0.27, 0.48, PETAL.petal],
        [12, 1.25, 0.15, 0.22, 0.05, 0.0, PETAL.stamen],
    ],
    open: [
        [4, 0.1, 0.1, 1.0, 0.36, 0.3, PETAL.sepal],
        [8, 0.32, 0.2, 1.0, 0.3, 0.38, PETAL.petal],
        [8, 0.62, 0.2, 0.92, 0.28, 0.42, PETAL.petal],
        [8, 0.98, 0.05, 0.78, 0.25, 0.46, PETAL.petal],
        [14, 1.0, 0.35, 0.24, 0.05, 0.0, PETAL.stamen],
    ],
});

/** The resident lilies, merged (each carries its pad's centre so it rides the pad). */
export function buildLilyGeometry(lilies) {
    const sheet = new Sheet(['aPad', 'aPetal']);
    const { water } = FLOOR.canal;
    lilies.forEach((lily) => {
        const aPad = [lily.pad.x, lily.pad.z, seedOf(lily.pad), lily.pad.radius];
        const base = [lily.x, water + LILY_PAD.floor + 0.004, lily.z];
        const turn = lily.seed * Math.PI * 2;
        const seed = Math.floor(lily.seed * 1000);
        WHORLS[lily.state].forEach(([count, elev, bend, len, wid, cup, kind], w) => {
            for (let k = 0; k < count; k += 1) {
                const phi = turn + ((k + (w % 2) * 0.5) / count) * Math.PI * 2;
                const at = kind === PETAL.stamen
                    ? [base[0] + Math.cos(phi) * lily.size * 0.12, base[1], base[2] + Math.sin(phi) * lily.size * 0.12]
                    : base;
                addPetal(sheet, at, phi, {
                    elev,
                    bend,
                    length: lily.size * len,
                    width: lily.size * wid,
                    cup,
                    kind,
                    steps: kind === PETAL.stamen ? 2 : 6,
                    across: kind === PETAL.stamen ? 1 : 4,
                }, aPad, seed);
            }
        });
    });
    return sheet.geometry();
}

/**
 * The reed clumps (for their reflections): the plan's reeds gathered by proximity on each side of
 * the canal, nearest the eye first. Each { x, z, radius, height, count }.
 */
export function reedClumps(reeds, cap = 24) {
    const clumps = [];
    reeds.forEach((r) => {
        const side = Math.sign(r.x) || 1;
        let best = null;
        let bestD = Infinity;
        clumps.forEach((c) => {
            if (c.side !== side) return;
            const d = Math.hypot((c.sx / c.count) - r.x, ((c.sz / c.count) - r.z) * 0.6);
            if (d < 0.7 && d < bestD) {
                best = c;
                bestD = d;
            }
        });
        if (!best) {
            best = {
                side, sx: 0, sz: 0, count: 0, members: [],
            };
            clumps.push(best);
        }
        best.sx += r.x;
        best.sz += r.z;
        best.count += 1;
        best.members.push(r);
    });
    return clumps.map((c) => {
        const x = c.sx / c.count;
        const z = c.sz / c.count;
        const radius = c.members.reduce((m, r) => Math.max(m, Math.hypot(r.x - x, r.z - z)), 0) + 0.14;
        const heights = c.members.map((r) => r.height).sort((a, b) => a - b);
        const height = heights[Math.floor((heights.length - 1) * 0.8)] * 0.92;
        return {
            x, z, radius, height, count: c.count,
        };
    }).sort((a, b) => b.z - a.z).slice(0, cap);
}

/**
 * A strap leaf (or a stalk's flat face): a strip rising from `base`, leaning `lean` radians from
 * the vertical toward `heading` and curling over by `curl` more toward its tip, `width` at its
 * foot tapering to a point, twisting by `twist` radians along its length.
 */
function addBlade(sheet, base, {
    length, heading, lean, curl, width, twist, steps, kind, dry,
}, aReed) {
    const hd = [Math.cos(heading), Math.sin(heading)];
    const perp = [-hd[1], 0, hd[0]];
    const rows = [];
    let p = [...base];
    for (let j = 0; j <= steps; j += 1) {
        const s = j / steps;
        const th = lean + curl * s * s;
        const T = [Math.sin(th) * hd[0], Math.cos(th), Math.sin(th) * hd[1]];
        // The binormal cross(T, perp), and the face's across direction turned by the twist.
        const B = [
            T[1] * perp[2] - T[2] * perp[1],
            T[2] * perp[0] - T[0] * perp[2],
            T[0] * perp[1] - T[1] * perp[0],
        ];
        const tw = twist * s;
        const A = [
            perp[0] * Math.cos(tw) + B[0] * Math.sin(tw),
            perp[1] * Math.cos(tw) + B[1] * Math.sin(tw),
            perp[2] * Math.cos(tw) + B[2] * Math.sin(tw),
        ];
        // The face normal cross(A, T); a shallow keel down the middle folds the leaf a little.
        const N = [A[1] * T[2] - A[2] * T[1], A[2] * T[0] - A[0] * T[2], A[0] * T[1] - A[1] * T[0]];
        const foot = Math.min(1, 0.55 + s * 6);
        const w = width * foot * (1 - s) ** 0.75 * 0.5;
        const row = [-1, 0, 1].map((c) => {
            const keel = c === 0 ? w * 0.22 : 0;
            const q = [p[0] + A[0] * c * w - N[0] * keel, p[1] + A[1] * c * w - N[1] * keel, p[2] + A[2] * c * w - N[2] * keel];
            const n = [N[0] - A[0] * c * 0.35, N[1] - A[1] * c * 0.35, N[2] - A[2] * c * 0.35];
            return sheet.vertex(q, n, { aReed, aBlade: [c, kind, s, dry] });
        });
        rows.push(row);
        const step = length / steps;
        p = [p[0] + T[0] * step, p[1] + T[1] * step, p[2] + T[2] * step];
    }
    // rows[j] along, i across: cross(∂/∂i, ∂/∂j) = cross(A, T) = N.
    sheet.grid(rows, false);
}

/** A closed tube along y from y0 to y1 of radius r(k) (k 0..1), `sides` round. */
function addTube(sheet, x, z, y0, y1, radiusAt, sides, rings, kind, aReed) {
    const rows = [];
    for (let j = 0; j <= rings; j += 1) {
        const k = j / rings;
        const r = radiusAt(k);
        const y = y0 + (y1 - y0) * k;
        // The slope of the radius along the tube tilts the normal (the rounded ends).
        const dr = (radiusAt(Math.min(1, k + 0.02)) - radiusAt(Math.max(0, k - 0.02))) / (0.04 * (y1 - y0) || 1);
        const row = [];
        for (let i = 0; i <= sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const c = Math.cos(a);
            const s = Math.sin(a);
            row.push(sheet.vertex([x + c * r, y, z + s * r], [c, -dr, s], { aReed, aBlade: [0, kind, k, 0] }));
        }
        rows.push(row);
    }
    // rows[j] up, i round: cross(∂/∂i, ∂/∂j) = cross(φ̂, up) points in, so flip.
    sheet.grid(rows, true);
}

/** Every reed and cattail of the plan, merged. */
export function buildReedGeometry(reeds, segments = 6) {
    const sheet = new Sheet(['aReed', 'aBlade']);
    const { water } = FLOOR.canal;
    reeds.forEach((r, n) => {
        const rand = mulberry32(Math.floor(r.seed * 1e6) + n * 7919);
        const side = Math.sign(r.x) || 1;
        const aReed = [r.x, r.z, Math.floor(r.seed * 1000), r.height];
        const base = [r.x, water - 0.02, r.z];
        // Leaves lean out over the water a little more than toward the wall.
        const outward = side < 0 ? 0 : Math.PI;
        // The clumps nearest the eye frame the foot of the picture: they are fuller.
        const near = r.z > -5 ? 2 : 0;
        const leaves = (r.cattail ? 3 : 2 + (rand() < 0.5 ? 1 : 0)) + near;
        for (let k = 0; k < leaves; k += 1) {
            // The first leaf stands up; the others fan out and arch over the water.
            const heading = k === 0 ? r.yaw : lerp(outward - 1.3, outward + 1.3, rand());
            const length = r.height * (r.cattail ? lerp(0.75, 1.0, rand()) : lerp(0.85, 1.15, rand()));
            addBlade(sheet, base, {
                length,
                heading,
                lean: Math.abs(r.lean) * 0.6 + rand() * (k === 0 ? 0.05 : 0.18),
                curl: (k === 0 ? lerp(0.15, 0.6, rand()) : lerp(0.4, 1.7, rand())) * clampJs(length / 1.4, 0.5, 1.4),
                width: lerp(0.022, 0.04, rand()),
                twist: (rand() - 0.5) * 1.6,
                steps: segments,
                kind: REED.leaf,
                dry: rand() < 0.35 ? lerp(0.4, 1, rand()) : 0,
            }, aReed);
        }
        if (!r.cattail) return;
        // The cattail: a straight stalk, the velvet head high on it and the thin spike above.
        const tipX = r.x + Math.sin(r.lean) * Math.cos(r.yaw) * r.height * 0.5;
        const tipZ = r.z + Math.sin(r.lean) * Math.sin(r.yaw) * r.height * 0.5;
        const headFrom = water + r.height * 0.74;
        const headTo = headFrom + clampJs(r.height * 0.13, 0.12, 0.22);
        const stalkTop = headTo + 0.12;
        // The stalk as two crossed flat faces (it never vanishes edge on).
        [0, Math.PI / 2].forEach((turn) => {
            addBlade(sheet, base, {
                length: headFrom - base[1],
                heading: r.yaw + turn,
                lean: 0,
                curl: 0,
                width: 0.011,
                twist: 0,
                steps: Math.max(3, segments - 2),
                kind: REED.stalk,
                dry: 0,
            }, aReed);
        });
        const lean = (y) => (y - base[1]) / (stalkTop - base[1]);
        const hx = lerp(r.x, tipX, lean((headFrom + headTo) / 2));
        const hz = lerp(r.z, tipZ, lean((headFrom + headTo) / 2));
        addTube(sheet, hx, hz, headFrom, headTo, (k) => 0.016 * Math.sqrt(Math.max(0, Math.sin(Math.PI * clampJs(k * 0.9 + 0.05, 0, 1)))) + 0.004, 8, 6, REED.head, aReed);
        addTube(sheet, hx, hz, headTo, stalkTop, (k) => 0.0035 * (1 - k * 0.8), 4, 2, REED.spike, aReed);
    });
    return sheet.geometry();
}

// ── Shared TSL ──────────────────────────────────────────────────────────────────────────────

/** The swell at xz, time t: vec3(height, slope x, slope z). Pure; twin of swellAt(). */
const mgPondSwell = Fn(([xz, t]) => {
    const out = vec3(0.0).toVar();
    SWELL.forEach((w) => {
        const k = (Math.PI * 2) / w.length;
        const dx = Math.sin(w.angle);
        const dz = -Math.cos(w.angle);
        const ph = xz.x.mul(dx * k).add(xz.y.mul(dz * k)).sub(t.mul(w.speed * k)).add(w.phase);
        out.addAssign(vec3(sin(ph).mul(w.slope / k), cos(ph).mul(w.slope * dx), cos(ph).mul(w.slope * dz)));
    });
    return out;
}).setLayout({
    name: 'mg_pond_swell', type: 'vec3', inputs: [{ name: 'xz', type: 'vec2' }, { name: 't', type: 'float' }],
});

/**
 * One ring at `dist` metres from its centre, `age` seconds old (nothing before it is born or
 * after it dies), `strength` its push: vec4(radial slope (unit: multiply by POND_LOOK.ringSlope),
 * the band of light its crests carry, the plankton its wake has woken, height (same unit)).
 * The leading crest is crisp; the train behind it is a few wavelets that lengthen as the ring
 * ages; the light flashes at the centre as it is born. Pure.
 */
const mgPondRing = Fn(([dist, age, strength]) => {
    const R = age.mul(RING.speed).add(RING.start);
    const d = R.sub(dist);
    const on = smoothstep(-0.03, 0.004, d);
    const env = on.mul(exp(max(d, 0.0).mul(-RING.wake)));
    const lambda = age.mul(0.025).add(RING.wavelength);
    const ph = d.sub(0.022).div(lambda).mul(Math.PI * 2);
    const life = float(1.0).sub(smoothstep(RING.life - 1.6, RING.life, age)).mul(smoothstep(0.0, 0.06, age));
    const amp = strength.mul(exp(age.mul(-0.3))).div(sqrt(dist.mul(2.5).add(1.0))).mul(life);
    const slope = amp.mul(env).mul(sin(ph));
    const height = amp.mul(env).mul(cos(ph)).mul(lambda).mul(1 / (Math.PI * 2));
    const fd = d.sub(0.018).div(RING.spread);
    const front = exp(fd.mul(fd).negate());
    const splash = exp(dist.mul(dist).mul(-90.0)).mul(exp(age.mul(-3.5))).mul(1.6);
    const band = front.add(env.mul(max(cos(ph), 0.0)).mul(0.3)).mul(exp(age.mul(-0.42))).add(splash)
        .mul(life).mul(strength);
    const passed = max(d, 0.0).div(RING.speed);
    const wake = smoothstep(0.0, 0.12, d).mul(exp(passed.mul(-0.5))).div(dist.mul(0.6).add(1.0)).mul(life)
        .mul(strength);
    return vec4(slope, band, wake, height);
}).setLayout({
    name: 'mg_pond_ring',
    type: 'vec4',
    inputs: [{ name: 'dist', type: 'float' }, { name: 'age', type: 'float' }, { name: 'strength', type: 'float' }],
});

/**
 * Where a pad's vertex stands this frame: the pad (centre aPad.xy) rides the swell and the rings
 * as one rigid leaf, lifting with the water's height at its centre and tilting with its slope
 * (a big pad less: it spans the wavelets), turning a hair about its centre and drifting a few
 * centimetres on the slow current. The resident lilies carry their pad's centre and ride with it.
 */
function padPosition(U) {
    return Fn(() => {
        const P = attribute('aPad', 'vec4');
        const g = positionGeometry;
        const c = P.xy;
        const seed = floor(P.z.add(0.5)).mul(0.001);
        const t = U.time;
        const sw = mgPondSwell(c, t);
        const rock = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.ringCount), type: 'int', condition: '<', name: 'ring',
        }, ({ ring }) => {
            const a = U.rings.element(ring.mul(2));
            const rel = c.sub(a.xy);
            const r = length(rel);
            const w = mgPondRing(r, t.sub(a.z), a.w);
            const dir = rel.div(max(r, 1e-3));
            rock.addAssign(vec3(w.w.mul(POND_LOOK.padLift), dir.mul(w.x.mul(POND_LOOK.padTilt))).mul(POND_LOOK.ringSlope));
        });
        const big = float(1.0).div(P.w.mul(3.0).add(1.0));
        const slope = clamp(sw.yz.add(rock.yz.mul(big)), vec2(-0.12), vec2(0.12));
        const bob = sin(t.mul(0.7).add(seed.mul(40.0))).mul(0.0025);
        const lift = max(sw.x.add(rock.x.mul(big.mul(0.5).add(0.5))).add(bob), -0.008);
        const a = sin(t.mul(0.13).add(seed.mul(6.283))).mul(0.05);
        const ca = cos(a);
        const sa = sin(a);
        const rel = g.xz.sub(c);
        const turned = vec2(rel.x.mul(ca).sub(rel.y.mul(sa)), rel.x.mul(sa).add(rel.y.mul(ca)));
        const drift = vec2(sin(t.mul(0.051).add(seed.mul(10.0))), cos(t.mul(0.043).add(seed.mul(7.0)))).mul(0.022);
        const y = g.y.add(lift).add(turned.x.mul(slope.x)).add(turned.y.mul(slope.y));
        return vec3(c.x.add(turned.x).add(drift.x), y, c.y.add(turned.y).add(drift.y));
    })();
}

/** The lanterns' glints on a glossy surface at p along the mirrored ray r (tight, warm). */
function lanternGlints(p, r, U, tightness) {
    const sum = float(0.0).toVar();
    Loop({
        start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'glint',
    }, ({ glint }) => {
        const row = U.lanternRows.element(glint);
        const d = row.xyz.sub(p);
        const reach = max(dot(d, r), 0.0);
        const miss = length(d.sub(r.mul(reach)));
        const q = miss.div(reach.mul(tightness).add(0.05));
        sum.addAssign(row.w.mul(exp(q.mul(q).negate())).div(reach.mul(0.1).add(1.0)));
    });
    return U.night.lantern.mul(U.lanternGain).mul(sum);
}

// ── The water ───────────────────────────────────────────────────────────────────────────────

/**
 * The water part. ctx = { tier, U, noise, plan }.
 */
export function createWater({
    tier, U, noise, plan,
}) {
    const detail = detailFor(tier);
    const geometry = buildWaterGeometry();
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'moonlit-greenhouse-water';
    // The pads float a centimetre or two over the water: keep the water a hair behind in depth.
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    const { night } = U;
    const L = POND_LOOK;
    // The reed clumps' reflections: a private table, written once.
    const clumps = reedClumps(plan.reeds, detail.clumps);
    const clumpRows = clumps.map((c) => new THREE.Vector4(c.x, c.z, c.radius, c.height));
    if (!clumpRows.length) clumpRows.push(new THREE.Vector4(0, 100, 0.01, 0));
    const clumpTable = uniformArray(clumpRows, 'vec4');
    const clumpCount = clumps.length;
    // The resident lilies' pale images, just under each flower.
    const lilies = residentLilies(plan.pads, detail.lilies);
    const lilyRows = lilies.map((l) => new THREE.Vector4(l.x, FLOOR.canal.water + 0.05, l.z, l.size));
    if (!lilyRows.length) lilyRows.push(new THREE.Vector4(0, -100, 0, 0.01));
    const lilyTable = uniformArray(lilyRows, 'vec4');
    const lilyCount = lilies.length;
    const noiseSize = tier.noise;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const t = U.time;
        const toP = p.sub(cameraPosition);
        const v = normalize(toP).toVar();
        // ── The surface's slope: the swell, the fine ripple, the rings.
        const sw = mgPondSwell(p.xz, t);
        const foot = max(fwidth(p.x), fwidth(p.z)).toVar();
        // The ripple's noise is read at the level its own footprint asks, but never sharper than
        // texels of a 32nd of the tile: its finer octaves would be a gravel of facets in a mirror.
        const lod = clamp(log2(foot.mul(L.rippleScale * noiseSize).add(1e-4)), Math.log2(noiseSize / 32), 8.0);
        const ripple = (scale, offset, drift) => {
            const uv = p.xz.mul(scale).add(offset).add(drift);
            const e = 0.035;
            const h0 = texture(noise, uv).level(lod).z;
            const hx = texture(noise, uv.add(vec2(e * scale, 0.0))).level(lod).z;
            const hz = texture(noise, uv.add(vec2(0.0, e * scale))).level(lod).z;
            return vec2(hx.sub(h0), hz.sub(h0)).mul(1 / e);
        };
        const fine = ripple(L.rippleScale, vec2(0.0), vec2(t.mul(0.011), t.mul(-0.007)))
            .add(ripple(L.rippleScale * 2.3, vec2(0.37, 0.61), vec2(t.mul(-0.009), t.mul(0.013))))
            .mul(L.ripple);
        const ringSlope = vec2(0.0).toVar();
        const band = vec3(0.0).toVar();
        const wake = float(0.0).toVar();
        const stir = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.ringCount), type: 'int', condition: '<', name: 'ring',
        }, ({ ring }) => {
            const a = U.rings.element(ring.mul(2));
            const b = U.rings.element(ring.mul(2).add(1));
            const rel = p.xz.sub(a.xy);
            const r = length(rel);
            const w = mgPondRing(r, t.sub(a.z), a.w).toVar();
            ringSlope.addAssign(rel.div(max(r, 1e-3)).mul(w.x.mul(L.ringSlope)));
            band.addAssign(b.xyz.mul(b.w).mul(w.y));
            wake.addAssign(w.z.mul(b.w));
            stir.addAssign(abs(w.x));
        });
        // Now and then a fish rises: a faint ring at a hashed place on the near water, no colour.
        [[7.3, 0.0], [9.7, 0.45]].forEach(([period, offset], k) => {
            const cycle = t.div(period).add(offset);
            const n = floor(cycle);
            const age = fract(cycle).mul(period);
            const h = mgHash21(vec2(n.add(k * 37), float(11.0 + k)));
            const h2 = mgHash21(vec2(n.mul(1.7).add(3.0), float(5.0 + k * 3)));
            const side = select(h.lessThan(0.5), float(-1.0), float(1.0));
            const at = vec2(side.mul(fract(h.mul(9.1)).mul(0.9).add(1.0)), h2.mul(-13.0).sub(1.5));
            const rel = p.xz.sub(at);
            const r = length(rel);
            const live = select(fract(h2.mul(5.3)).lessThan(0.7), float(L.rising), float(0.0));
            const w = mgPondRing(r, age, live).toVar();
            ringSlope.addAssign(rel.div(max(r, 1e-3)).mul(w.x.mul(L.ringSlope)));
            wake.addAssign(w.z.mul(0.6));
            stir.addAssign(abs(w.x));
        });
        // The T-spin's turn of the air stirs the canal: a spiral of cat's-paw ripples wheels about
        // the turn's axis while it lasts, and the plankton wake along its arms.
        const toAxis = p.xz.sub(U.turn.zw);
        const axisR = length(toAxis);
        const spin = select(U.turn.x.lessThan(0.0), float(-1.0), float(1.0));
        const arms = atan(toAxis.y, toAxis.x).mul(5.0).add(axisR.mul(spin).mul(1.6)).sub(t.mul(2.4).mul(spin));
        const swirlReach = exp(axisR.mul(-0.09)).mul(U.turn.y);
        const swirl = vec2(toAxis.y.negate(), toAxis.x).div(max(axisR, 0.5)).mul(sin(arms).mul(swirlReach).mul(0.018));
        wake.addAssign(smoothstep(0.5, 0.95, sin(arms)).mul(swirlReach).mul(1.7));
        const s = clamp(sw.yz.add(fine).add(ringSlope).add(swirl), vec2(-0.25), vec2(0.25));
        const n = normalize(vec3(s.x.negate(), 1.0, s.y.negate())).toVar();
        // ── The mirrored ray, traced to where it leaves the house.
        const rr = reflect(v, n);
        const r = normalize(vec3(rr.x, max(rr.y, 0.006), rr.z)).toVar();
        const ex = mgHouseExit(p, r).toVar();
        // The glass's edges soften by the pixel's footprint there and by what the ripples smear
        // inside one pixel (their slope turns the ray by twice as much): the thin bars melt into
        // the panes, the ribs and the blinds stay as wavering bands.
        const smear = ex.x.mul(length(sw.yz).add(length(fine)).add(stir.mul(L.ringSlope * 0.3)).mul(1.4));
        const soft = clamp(max(fwidth(ex.y), fwidth(ex.z)).mul(1.2).add(smear), 0.006, 1.2);
        // The far end's screen: a grid of mullions and transoms where the ray runs out of vault.
        const toEnd = float(HOUSE.far).sub(p.z).div(min(r.z, -1e-4));
        const endHit = p.add(r.mul(toEnd));
        const endIron = max(mgLine(endHit.x, float(1.2), float(0.06), soft), mgLine(endHit.y, float(1.5), float(0.06), soft));
        const atEnd = ex.y.lessThan(HOUSE.far);
        const pass = select(atEnd, float(0.85).mul(float(1.0).sub(endIron)), mgGlazing(ex.y, ex.z, ex.w, soft, U.moonBay));
        const disc = vec2(dot(r, U.moonRight), dot(r, U.moonUp)).div(U.moonSize);
        const sky = mgSky(r, disc, U, noise, { stars: 1, clouds: tier.clouds, trees: true });
        const toMoon = clamp(dot(r, U.moon), 0.0, 1.0);
        const away = float(1.0).sub(toMoon);
        const halo = exp(away.mul(-1.0 / 0.06)).mul(0.9).add(exp(away.mul(-1.0 / 0.3)).mul(0.35)).add(0.04);
        const veil = night.glassFog.mul(halo).mul(0.16).mul(U.moonLight);
        const glassTint = vec3(0.82, 0.92, 0.88);
        const flood = night.moonlight.mul(U.flood).mul(0.18);
        const ironDark = night.zenith.mul(0.25);
        const house = sky.mul(glassTint).add(veil).add(flood).mul(pass).add(ironDark.mul(float(1.0).sub(pass))).toVar();
        // ── What stands in the house, along the same ray, all dark as reflections are.
        // The palms' crowns: the canopy read along the mirrored ray.
        const crowns = mgCanopy(p, r, U);
        const frond = night.zenith.mul(0.3).add(night.leafLit.mul(night.moonlight).mul(0.012).mul(U.moonLight));
        house.assign(mix(frond, house, crowns));
        // The beds: the ray crosses the bed front and the bed's middle on its own side.
        const side = select(r.x.lessThan(0.0), float(-1.0), float(1.0));
        const rx = select(abs(r.x).lessThan(1e-4), side.mul(1e-4), r.x);
        const cross = (x) => {
            const tc = side.mul(x).sub(p.x).div(rx);
            return vec3(tc, p.y.add(r.y.mul(tc)), p.z.add(r.z.mul(tc)));
        };
        const row = select(side.lessThan(0.0), float(0.23), float(0.71));
        const front = cross(4.0);
        const middle = cross(4.9);
        const ragged = (z, scale) => texture(noise, vec2(z.mul(scale), row.add(0.13))).level(0.0).w.sub(0.5);
        const h1 = texture(noise, vec2(front.z.mul(0.09), row)).level(1.0).x.mul(0.9).add(0.75)
            .add(ragged(front.z, 1.3).mul(0.5));
        const h2 = texture(noise, vec2(middle.z.mul(0.06), row.add(0.31))).level(1.0).x.mul(2.4).add(1.5)
            .add(ragged(middle.z, 0.8).mul(0.9));
        const plant1 = smoothstep(h1.add(0.08), h1.sub(0.08), front.y).mul(select(front.x.greaterThan(0.0), float(1.0), float(0.0)));
        const plant2 = smoothstep(h2.add(0.12), h2.sub(0.12), middle.y).mul(select(middle.x.greaterThan(0.0), float(1.0), float(0.0)));
        const plants = max(plant1, plant2);
        const leafAt = select(plant1.greaterThan(0.5), front, middle);
        const leafP = vec3(side.mul(select(plant1.greaterThan(0.5), float(4.0), float(4.9))), leafAt.y, leafAt.z);
        const spots = smoothstep(0.45, 0.8, texture(noise, vec2(leafAt.z.mul(0.7), leafAt.y.mul(0.7).add(row))).level(0.0).x);
        const leafLight = mgLanterns(leafP, normalize(vec3(side.negate(), 0.35, 0.0)), U).mul(0.5)
            .add(night.horizon.mul(1.4));
        const foliage = vec3(0.03, 0.05, 0.022).mul(leafLight)
            .add(night.leafLit.mul(night.moonlight).mul(U.moonLight).mul(spots.mul(0.03).add(0.004)));
        house.assign(mix(house, foliage, plants));
        // The bed kerb (0.5 high at |x| 3.7) and the canal wall with its coping (0.1 over the path).
        const kerb = cross(3.7);
        const kerbHit = smoothstep(FLOOR.bed.kerb + 0.02, FLOOR.bed.kerb - 0.02, kerb.y).mul(select(kerb.x.greaterThan(0.0), float(1.0), float(0.0)));
        const wall = cross(FLOOR.canal.half);
        const wallHit = smoothstep(FLOOR.copingHeight + 0.01, FLOOR.copingHeight - 0.01, wall.y).mul(select(wall.x.greaterThan(0.0), float(1.0), float(0.0)));
        const stone = night.horizon.mul(0.35).add(night.moonlight.mul(0.004));
        house.assign(mix(house, stone, max(kerbHit, wallHit)));
        // The reed clumps: each a fan of blades round its centre, darkest low and in the middle.
        const reeds = float(0.0).toVar();
        Loop({
            start: int(0), end: int(clumpCount), type: 'int', condition: '<', name: 'clump',
        }, ({ clump }) => {
            const c = clumpTable.element(clump);
            const toC = c.xy.sub(p.xz);
            const reach = max(dot(toC, r.xz).div(max(dot(r.xz, r.xz), 1e-5)), 0.0);
            const m = p.xz.add(r.xz.mul(reach)).sub(c.xy);
            const q = length(m).div(c.z);
            const yAt = r.y.mul(reach);
            const bearing = atan(m.y, m.x);
            const blades = sin(bearing.mul(13.0).add(c.x.mul(17.0))).mul(0.5).add(0.5)
                .mul(sin(bearing.mul(7.0).add(c.y.mul(5.0))).mul(0.5).add(0.5));
            const top = c.w.mul(float(1.0).sub(q.mul(q).mul(0.45))).mul(blades.mul(0.45).add(0.55));
            const inside = float(1.0).sub(smoothstep(0.6, 1.0, q)).mul(smoothstep(top.add(0.05), top.sub(0.1), yAt));
            reeds.assign(max(reeds, inside.mul(0.94)));
        });
        house.assign(mix(house, night.zenith.mul(0.15), reeds));
        // ── The lanterns and the open blooms: soft images where the mirrored ray passes them,
        // stretched down the water by the ripples (the vertical tolerance grows with the slope).
        const across = normalize(vec3(r.z.negate(), 0.0, r.x));
        const upish = vec3(
            across.y.mul(r.z).sub(across.z.mul(r.y)),
            across.z.mul(r.x).sub(across.x.mul(r.z)),
            across.x.mul(r.y).sub(across.y.mul(r.x)),
        );
        const rough = length(sw.yz).add(length(fine)).add(stir.mul(L.ringSlope * 0.5)).mul(2.2).add(0.02);
        const images = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'lamp',
        }, ({ lamp }) => {
            const row4 = U.lanternRows.element(lamp);
            const d = row4.xyz.sub(p);
            const reach = max(dot(d, r), 0.0);
            const off = d.sub(r.mul(reach));
            const mh = dot(off, across);
            const mv = dot(off, upish);
            const bh = reach.mul(0.006).add(0.07);
            const bv = bh.add(reach.mul(rough));
            const e = mh.mul(mh).div(bh.mul(bh)).add(mv.mul(mv).div(bv.mul(bv)));
            images.addAssign(row4.w.mul(exp(e.negate())).mul(sqrt(bh.div(bv))));
        });
        const lampImages = night.lantern.mul(U.lanternGain).mul(images).mul(L.lanternImage);
        const blooms = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.bloomLightCount), type: 'int', condition: '<', name: 'bloomImage',
        }, ({ bloomImage }) => {
            const a = U.bloomLights.element(bloomImage.mul(2));
            const b = U.bloomLights.element(bloomImage.mul(2).add(1));
            const d = a.xyz.sub(p);
            const reach = max(dot(d, r), 0.0);
            const off = d.sub(r.mul(reach));
            const mh = dot(off, across);
            const mv = dot(off, upish);
            const bh = reach.mul(0.012).add(0.18);
            const bv = bh.add(reach.mul(rough));
            const e = mh.mul(mh).div(bh.mul(bh)).add(mv.mul(mv).div(bv.mul(bv)));
            blooms.addAssign(b.xyz.mul(a.w.mul(exp(e.negate())).mul(sqrt(bh.div(bv)))));
        });
        const bloomImages = blooms.div(mgMax3(blooms).add(1.0)).mul(L.bloomImage);
        const pale = float(0.0).toVar();
        Loop({
            start: int(0), end: int(lilyCount), type: 'int', condition: '<', name: 'lilyImage',
        }, ({ lilyImage }) => {
            const f = lilyTable.element(lilyImage);
            const d = f.xyz.sub(p);
            const reach = max(dot(d, r), 0.0);
            const off = d.sub(r.mul(reach));
            const mh = dot(off, across);
            const mv = dot(off, upish);
            const bh = f.w.mul(0.9).add(reach.mul(0.004));
            const bv = bh.add(reach.mul(rough));
            const e = mh.mul(mh).div(bh.mul(bh)).add(mv.mul(mv).div(bv.mul(bv)));
            pale.addAssign(exp(e.negate()).mul(sqrt(bh.div(bv))));
        });
        const lilyImages = mix(night.moonDisc, vec3(0.9, 0.95, 1.0), 0.5).mul(pale).mul(0.05);
        // ── Fresnel: steeply down mostly the water's own body, toward the far end all mirror.
        const cosI = clamp(dot(n, v.negate()), 0.0, 1.0);
        const g1 = float(1.0).sub(cosI);
        const g2 = g1.mul(g1);
        const schlick = g2.mul(g2).mul(g1).mul(0.98).add(0.02);
        const mirror = mix(float(L.mirrorFloor), float(1.0), schlick);
        // The body: black-green, the moon's lattice faintly lit in its murk.
        const vis = mgMoonVis(p, U, foot.mul(2.0));
        const body = vec3(...L.body).add(night.moonlight.mul(vec3(0.55, 0.9, 0.75)).mul(vis).mul(U.moonLight).mul(L.murk));
        // ── The plankton: points of glow on a grid laid out from the resting eye (a cell is a few
        // pixels at any range, and stays put on the water while the lens breathes). Each point has
        // its own threshold: the more a wake has woken, the more points are lit, so as it fades
        // the water does not dim evenly but goes out point by point, the brightest last.
        const rel = p.xz.sub(U.eye.xz);
        const dh = max(length(rel), 0.5);
        const density = 1 / 0.0085;
        const grid = vec2(atan(rel.x, rel.y.negate()), U.eye.y.sub(p.y).div(dh)).mul(density);
        const cell = floor(grid);
        const hc = mgHash33(vec3(cell, 7.0));
        const centre = cell.add(hc.xy.mul(0.64).add(0.18));
        const dp = length(grid.sub(centre));
        const pixel = U.pixelAngle.mul(density);
        const design = hc.z.mul(0.08).add(0.12);
        const radius = max(design, pixel.mul(0.55));
        const spot = exp(dp.mul(dp).div(radius.mul(radius)).negate()).mul(design.mul(design).div(radius.mul(radius)));
        const pick = fract(hc.z.mul(7.31).add(hc.x.mul(3.7)));
        const tw = sin(t.mul(hc.x.mul(3.0).add(1.1)).add(hc.y.mul(40.0))).mul(0.5).add(0.5);
        const flick = tw.mul(tw).mul(tw).mul(0.8).add(0.2);
        // At rest a faint glitter; a chain wakes more of it, pulsing with the fireflies' light (in
        // step, the canal flashes with the swarm), and in the hush before the Queen of the Night
        // the dark house lets it show.
        const restShare = U.sync.mul(0.11).add(U.hush.mul(0.1)).add(0.075);
        const answer = U.fireflyGlow.mul(1.6).add(U.hush.mul(1.5)).add(1.0);
        const rest = smoothstep(restShare, restShare.sub(0.015), pick).mul(flick).mul(hc.y.mul(0.7).add(0.3)).mul(answer);
        const energy = min(wake, 2.0);
        const woken = smoothstep(energy.mul(0.38), energy.mul(0.38).sub(0.04), pick).mul(flick.mul(0.7).add(0.3))
            .mul(hc.y.mul(hc.y).mul(0.8).add(0.2));
        const plankton = night.glow.mul(spot).mul(rest.mul(L.glitter).add(woken.mul(L.plankton)));
        let colour = body.mul(float(1.0).sub(mirror))
            .add(house.add(lampImages).add(bloomImages).add(lilyImages).mul(mirror))
            .add(band.mul(L.ringBand));
        if (!dbg('noplankton')) colour = colour.add(plankton);
        if (dbg('house')) colour = house;
        if (dbg('sky')) colour = sky;
        if (dbg('pass')) colour = vec3(pass);
        if (dbg('slope')) colour = vec3(s.x.mul(10.0).add(0.5), s.y.mul(10.0).add(0.5), 0.0);
        return vec4(colour, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'moonlit-greenhouse-water';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    return {
        mesh,
        clumps,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

// ── The pads ────────────────────────────────────────────────────────────────────────────────

/**
 * The pads part: the Victoria pads, the small lily pads and the resident water lilies.
 * ctx = { tier, U, noise, plan }.
 */
export function createPads({
    tier, U, noise, plan,
}) {
    const detail = detailFor(tier);
    const { night } = U;
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-pads';
    const position = padPosition(U);
    const meshes = [];
    const add = (geometry, material, name, order) => {
        material.positionNode = position;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        group.add(mesh);
        meshes.push(mesh);
        return mesh;
    };

    // Dew: a few beads on a pad glint where the moon (or a lantern) catches their crowns.
    const dew = (local, seed, vis, foot, p) => {
        const has = select(fract(seed.mul(3.7)).lessThan(0.55), float(1.0), float(0.0));
        const bead = texture(noise, local.mul(2.3).add(vec2(seed.mul(7.0), seed.mul(3.0)))).level(0.0).y;
        const crown = smoothstep(0.86, 0.98, bead);
        const near = float(1.0).sub(smoothstep(0.006, 0.016, foot));
        const sparkle = sin(U.time.mul(1.7).add(bead.mul(60.0)).add(seed.mul(9.0))).mul(0.35).add(0.65);
        const toEye = normalize(cameraPosition.sub(p));
        const lamps = lanternGlints(p, vec3(toEye.x.negate(), toEye.y, toEye.z.negate()), U, 0.05);
        return night.moonlight.mul(vis).mul(U.moonLight).mul(0.9).add(lamps.mul(0.5))
            .mul(crown).mul(sparkle).mul(near).mul(has);
    };

    // ── Victoria amazonica.
    const victoria = new THREE.MeshBasicNodeMaterial({ fog: false });
    victoria.name = 'moonlit-greenhouse-victoria';
    victoria.colorNode = Fn(() => {
        const P = attribute('aPad', 'vec4');
        const A = attribute('aLeaf', 'vec4');
        const p = positionWorld;
        const v = normalize(p.sub(cameraPosition)).toVar();
        const seed = floor(P.z.add(0.5)).mul(0.001);
        const R = P.w;
        const local = A.xy;
        const part = A.z;
        const hRim = clamp(A.w, 0.0, 1.0);
        const rho = length(local);
        const k = clamp(rho.div(R), 0.0, 1.0);
        const phi = atan(local.y, local.x);
        const foot = max(fwidth(p.x), fwidth(p.z)).add(0.001).toVar();
        const nG = normalize(normalGeometry).toVar();
        // The pad's own frame in the world (its yaw from the geometry: the normal's lean is no
        // help, so the radial direction is rebuilt from the world point and the centre).
        const radial = normalize(vec3(p.x.sub(P.x), 0.0, p.z.sub(P.y)).add(vec3(1e-5, 0.0, 0.0)));
        const tangent = vec3(radial.z.negate(), 0.0, radial.x);
        // The floor's veins: spokes from the middle that fork twice on the way out, crossed by
        // rings; between them the leaf is quilted into small domed cells.
        const N0 = floor(R.mul(30.0).add(0.5));
        // Each set of lines fades into its mean as its spacing nears the pixel's footprint (a pad
        // seen at a grazing angle would otherwise draw moiré bands across itself).
        const spokes = (count, shift, from, width) => {
            const a = phi.div(Math.PI * 2).mul(count).add(shift);
            const spacing = rho.mul(Math.PI * 2).div(count).add(1e-4);
            const off = abs(fract(a.add(0.5)).sub(0.5)).mul(spacing);
            const line = float(1.0).sub(smoothstep(width.mul(0.5), width.add(foot.mul(0.25)), off));
            const keep = float(1.0).sub(smoothstep(0.2, 0.55, foot.div(spacing)));
            return mix(width.div(spacing).min(1.0), line, keep).mul(smoothstep(from, from.add(0.06), k));
        };
        const v1 = spokes(N0, float(0.0), float(-0.1), float(0.016).sub(k.mul(0.006)));
        const v2 = spokes(N0, float(0.5), float(0.36), float(0.009));
        const v3 = spokes(N0.mul(2.0), float(0.25), float(0.68), float(0.006));
        const ringStep = float(0.046);
        const ringOff = abs(fract(rho.div(ringStep).add(0.5)).sub(0.5)).mul(ringStep);
        const ringKeep = float(1.0).sub(smoothstep(0.2, 0.55, foot.div(ringStep)));
        const rings = mix(float(0.06), float(1.0).sub(smoothstep(0.0012, foot.mul(0.25).add(0.0024), ringOff)), ringKeep);
        const veins = max(max(v1, v2), max(v3, rings.mul(0.7))).mul(select(part.lessThan(0.5), float(1.0), float(0.0)));
        // The quilted cells: a dome between the veins (tangential and radial offsets in −1..1).
        const cellsAround = select(k.lessThan(0.38), N0, select(k.lessThan(0.7), N0.mul(2.0), N0.mul(4.0)));
        const ou = fract(phi.div(Math.PI * 2).mul(cellsAround)).mul(2.0).sub(1.0);
        const ow = fract(rho.div(ringStep)).mul(2.0).sub(1.0);
        const cellSize = min(rho.mul(Math.PI * 2).div(cellsAround), ringStep);
        const fade = float(1.0).sub(smoothstep(0.15, 0.45, foot.div(cellSize.add(1e-4))));
        const bump = tangent.mul(ou.mul(float(1.0).sub(ow.mul(ow)))).add(radial.mul(ow.mul(float(1.0).sub(ou.mul(ou)))))
            .mul(0.32).mul(fade).mul(select(part.lessThan(0.5), float(1.0), float(0.0)));
        const n = normalize(nG.add(bump)).toVar();
        // The cells' sunken edges hold a little shadow and water: darker, a touch wine-red.
        const dome = float(1.0).sub(ou.mul(ou)).mul(float(1.0).sub(ow.mul(ow)));
        const cellShade = mix(float(0.86), dome.mul(0.3).add(0.75), fade);
        // Colours: the floor deep green, its veins paler, a wine-red margin; the rim green inside
        // turning crimson toward the lip; the outer skirt the underside's red-purple, ribbed and
        // set with spines.
        const mottle = texture(noise, local.mul(0.9).add(seed.mul(5.0))).level(1.0).x;
        const green = mix(vec3(0.045, 0.11, 0.03), vec3(0.07, 0.14, 0.04), mottle).mul(seed.mul(0.3).add(0.85));
        const floorCol = mix(green.mul(cellShade), vec3(0.13, 0.18, 0.06), veins.mul(0.85))
            .add(vec3(0.05, -0.02, 0.0).mul(smoothstep(0.85, 1.0, k)));
        const crimson = vec3(0.17, 0.028, 0.05);
        const h2 = hRim.mul(hRim);
        const innerCol = mix(green.mul(0.9), crimson, h2.mul(h2).mul(0.85).add(smoothstep(0.92, 1.0, hRim).mul(0.15)));
        const ribs = mgLine(phi.mul(R), float(0.035), float(0.008), foot);
        const spineCell = vec2(phi.mul(R).div(0.022), A.w.mul(5.0));
        const spine = smoothstep(0.32, 0.12, length(fract(spineCell).sub(0.5)))
            .mul(select(mgHash21(floor(spineCell)).lessThan(0.6), float(1.0), float(0.0)));
        const outerCol = mix(vec3(0.13, 0.022, 0.055), vec3(0.2, 0.05, 0.07), ribs.mul(0.6)).mul(float(1.0).sub(spine.mul(0.35)));
        const albedo = select(part.lessThan(0.5), floorCol, select(part.lessThan(1.5), innerCol,
            select(part.lessThan(2.5), crimson.mul(1.2), outerCol))).toVar();
        const vis = mgMoonVis(p, U, foot).toVar();
        const lit = mgSurface(p, n, albedo, U, { soft: foot, vis, view: v }).toVar();
        // Light through the thin rim with the moon behind it: ruby.
        const through = clamp(dot(v, U.moon), 0.0, 1.0);
        const backlit = clamp(dot(nG, U.moon).negate().mul(0.7).add(0.3), 0.0, 1.0);
        // The tissue thins toward the lip: the glow gathers there.
        const thin = select(part.greaterThan(1.5), float(1.0), hRim.mul(hRim));
        const ruby = vec3(1.0, 0.16, 0.26).mul(night.moonlight.mul(U.moonLight).mul(vis))
            .mul(through.mul(through).mul(backlit)).mul(thin).mul(0.05)
            .mul(select(part.greaterThan(0.5), float(1.0), float(0.0)));
        // A wet sheen on the floor at grazing angles: the vault's glow.
        const cosV = clamp(dot(n, v.negate()), 0.0, 1.0);
        const g1 = float(1.0).sub(cosV);
        const sheen = mix(night.horizon, night.glassFog.mul(0.08), 0.5).mul(g1.mul(g1).mul(g1).mul(0.8));
        const beads = dew(local, seed, vis, foot, p).mul(select(part.lessThan(0.5), float(1.0), float(0.0)));
        return vec4(lit.add(ruby).add(sheen).add(beads), 1.0);
    })();
    add(buildVictoriaGeometry(plan.pads, detail.victoria), victoria, 'moonlit-greenhouse-pads-victoria', 4);

    // ── The small water-lily pads.
    const lily = new THREE.MeshBasicNodeMaterial({ fog: false });
    lily.name = 'moonlit-greenhouse-lily-pads';
    lily.colorNode = Fn(() => {
        const P = attribute('aPad', 'vec4');
        const A = attribute('aLeaf', 'vec4');
        const p = positionWorld;
        const v = normalize(p.sub(cameraPosition)).toVar();
        const seed = floor(P.z.add(0.5)).mul(0.001);
        const R = P.w;
        const local = A.xy;
        const k = clamp(A.w, 0.0, 1.0);
        const phi = atan(local.y, local.x);
        const foot = max(fwidth(p.x), fwidth(p.z)).add(0.001).toVar();
        // The leaf is never quite flat: a gentle waviness from the noise turns its glints.
        const wav = texture(noise, local.mul(4.0).add(seed.mul(13.0))).level(1.0);
        const n = normalize(normalGeometry.add(vec3(wav.x.sub(0.5), 0.0, wav.z.sub(0.5)).mul(0.22))).toVar();
        // Palmate veins from the middle, faint; a few pads mottled maroon, some yellowing, the
        // margin edged with red.
        const count = float(15.0);
        const a = phi.div(Math.PI * 2).mul(count);
        const off = abs(fract(a.add(0.5)).sub(0.5)).mul(Math.PI * 2).mul(k.mul(R)).div(count);
        const vein = float(1.0).sub(smoothstep(0.0015, foot.mul(0.5).add(0.003), off)).mul(smoothstep(0.08, 0.2, k));
        const mott = texture(noise, local.mul(3.0).add(seed.mul(11.0))).level(0.0).x;
        const mottled = select(fract(seed.mul(5.3)).lessThan(0.3), smoothstep(0.55, 0.75, mott), float(0.0));
        const base = mix(vec3(0.05, 0.115, 0.04), vec3(0.1, 0.135, 0.04), fract(seed.mul(9.1)).mul(0.6));
        const albedo = mix(base, vec3(0.08, 0.03, 0.03), mottled.mul(0.6))
            .add(vec3(0.03, 0.04, 0.012).mul(vein))
            .add(vec3(0.06, -0.03, -0.01).mul(smoothstep(0.9, 1.0, k).mul(fract(seed.mul(2.9)))))
            .toVar();
        const vis = mgMoonVis(p, U, foot).toVar();
        const lit = mgSurface(p, n, albedo, U, { soft: foot, vis, view: v });
        // The waxy face: Fresnel sheen of the vault's glow, the moon's glint, the lanterns'.
        const r = reflect(v, n).toVar();
        const cosV = clamp(dot(n, v.negate()), 0.0, 1.0);
        const g1 = float(1.0).sub(cosV);
        const g2 = g1.mul(g1);
        const fres = g2.mul(g2).mul(g1).mul(0.96).add(0.04);
        const skyish = mix(night.horizon, night.zenith, clamp(r.y, 0.0, 1.0)).mul(0.9)
            .add(night.glassFog.mul(exp(float(1.0).sub(clamp(dot(r, U.moon), 0.0, 1.0)).mul(-6.0))).mul(0.04));
        const moonGlint = night.moonlight.mul(vis).mul(U.moonLight)
            .mul(exp(float(1.0).sub(clamp(dot(r, U.moon), 0.0, 1.0)).mul(-900.0))).mul(0.6);
        const glints = lanternGlints(p, r, U, 0.035).mul(0.35);
        const sheen = skyish.mul(fres).add(moonGlint.add(glints).mul(fres.mul(2.0).add(0.1)));
        const beads = dew(local, seed, vis, foot, p);
        if (dbg('lilyLit')) return vec4(lit, 1.0);
        if (dbg('lilySheen')) return vec4(sheen, 1.0);
        if (dbg('lilyDew')) return vec4(beads, 1.0);
        if (dbg('lilyN')) return vec4(n.mul(0.5).add(0.5), 1.0);
        return vec4(lit.add(sheen).add(beads), 1.0);
    })();
    add(buildLilyPadGeometry(plan.pads, detail.lily), lily, 'moonlit-greenhouse-pads-lily', 4);

    // ── The resident water lilies.
    const lilies = residentLilies(plan.pads, detail.lilies);
    const flowers = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    flowers.name = 'moonlit-greenhouse-lilies';
    flowers.colorNode = Fn(() => {
        const A = attribute('aPetal', 'vec4');
        const p = positionWorld;
        const v = normalize(p.sub(cameraPosition)).toVar();
        const s = clamp(A.x, 0.0, 1.0);
        const c = clamp(A.y, -1.0, 1.0);
        const kind = A.z;
        const seed = floor(A.w.add(0.5)).mul(0.001);
        const foot = max(fwidth(p.x), fwidth(p.z)).add(0.001).toVar();
        const nG = normalize(normalGeometry);
        const inside = frontFacing;
        const n = select(inside, nG, nG.negate()).toVar();
        const isSepal = kind.lessThan(0.5);
        const isStamen = kind.greaterThan(1.5);
        // White petals flushed pink at the foot on some; the sepals green outside, pale inside;
        // the stamens gold.
        const pink = fract(seed.mul(3.3)).mul(0.6);
        const white = mix(vec3(0.6, 0.6, 0.57), vec3(0.62, 0.42, 0.5), float(1.0).sub(s).mul(float(1.0).sub(s)).mul(pink));
        const sepal = select(inside, vec3(0.42, 0.46, 0.38), vec3(0.06, 0.11, 0.045));
        const gold = vec3(0.85, 0.58, 0.14);
        const albedo = select(isStamen, gold, select(isSepal, sepal, white)).toVar();
        const vis = mgMoonVis(p, U, foot).toVar();
        const lit = mgSurface(p, n, albedo, U, { soft: foot, vis, view: v });
        // Faintly luminous: the petals hold a cool light, more toward the heart and breathing
        // slowly; the heart's gold glows; the moon behind a petal lights it through.
        const breathe = sin(U.time.mul(0.6).add(seed.mul(30.0))).mul(0.2).add(0.8);
        const coolWhite = mix(night.moonDisc, vec3(0.9, 0.95, 1.0), 0.5);
        const petalGlow = coolWhite.mul(float(1.0).sub(s.mul(0.55))).mul(float(1.0).sub(abs(c).mul(0.3))).mul(0.065);
        const sepalGlow = coolWhite.mul(0.012).mul(select(inside, float(1.0), float(0.0)));
        const heart = gold.mul(0.22);
        const glow = select(isStamen, heart, select(isSepal, sepalGlow, petalGlow)).mul(breathe);
        const through = clamp(dot(v, U.moon), 0.0, 1.0);
        const lightThrough = albedo.mul(night.moonlight).mul(vis).mul(U.moonLight)
            .mul(through.mul(through)).mul(0.22).mul(select(isStamen, float(0.0), float(1.0)));
        return vec4(lit.add(glow).add(lightThrough), 1.0);
    })();
    add(buildLilyGeometry(lilies), flowers, 'moonlit-greenhouse-pads-lilies', 5);

    return {
        mesh: group,
        lilies,
        dispose() {
            group.removeFromParent();
            meshes.forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
            });
        },
    };
}

// ── The reeds ───────────────────────────────────────────────────────────────────────────────

/**
 * The greenhouse air in the reeds: each plant sways from its foot (the higher a point, the more:
 * stalk, head and leaves of one plant move together), two incommensurate waves on its own phase;
 * a gust leans the clumps down the house beat by beat; the T-spin's turn swirls them about the
 * vertical axis through (turn.z, turn.w); the leaves flutter along their normals toward the tips.
 */
function reedSway(U) {
    return Fn(() => {
        const g = positionGeometry;
        const R = attribute('aReed', 'vec4');
        const B = attribute('aBlade', 'vec4');
        const t = U.time;
        const gust = U.gust;
        const seed = floor(R.z.add(0.5)).mul(0.001);
        const ph = seed.mul(6.283).add(R.y.mul(0.37)).add(R.x.mul(0.2));
        const up = max(g.y.sub(FLOOR.canal.water), 0.0);
        const w = up.mul(up).div(1.8 * 1.8);
        const air = vec2(
            sin(t.mul(0.9).add(ph)).mul(0.6).add(sin(t.mul(1.63).add(ph.mul(1.7))).mul(0.4)),
            sin(t.mul(0.77).add(ph.mul(1.3))).mul(0.6).add(sin(t.mul(1.41).add(ph.mul(0.6))).mul(0.4)),
        );
        const amp = float(0.035).add(gust.mul(0.26));
        const disp = air.mul(amp).mul(w).toVar();
        const beat = sin(t.mul(2.2).add(ph).add(R.y.mul(0.4))).mul(0.35).add(0.65);
        disp.addAssign(vec2(0.3, -0.9).mul(gust.mul(beat).mul(w).mul(0.22)));
        const rel = R.xy.sub(U.turn.zw);
        const rl = max(length(rel), 0.5);
        const spin = U.turn.y.mul(select(U.turn.x.lessThan(0.0), float(-1.0), float(1.0))).mul(w).mul(0.32);
        disp.addAssign(vec2(rel.y.negate(), rel.x).div(rl).mul(spin));
        const leaf = select(B.y.lessThan(0.5), float(1.0), float(0.0));
        const s = clamp(B.z, 0.0, 1.0);
        const flutter = sin(t.mul(4.7).add(seed.mul(9.0)).add(s.mul(5.0))).mul(s.mul(s)).mul(float(0.008).add(gust.mul(0.03)))
            .mul(leaf);
        const drop = dot(disp, disp).mul(0.5).div(max(up, 0.2));
        return g.add(vec3(disp.x, drop.negate(), disp.y)).add(normalGeometry.mul(flutter));
    })();
}

/**
 * The reeds part. ctx = { tier, U, plan }.
 */
export function createReeds({ tier, U, plan }) {
    const detail = detailFor(tier);
    const { night } = U;
    const geometry = buildReedGeometry(plan.reeds, detail.reed);
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'moonlit-greenhouse-reeds';
    material.positionNode = reedSway(U);
    material.colorNode = Fn(() => {
        const R = attribute('aReed', 'vec4');
        const B = attribute('aBlade', 'vec4');
        const p = positionWorld;
        const v = normalize(p.sub(cameraPosition)).toVar();
        const kind = B.y;
        const across = clamp(B.x, -1.0, 1.0);
        const s = clamp(B.z, 0.0, 1.0);
        const dry = clamp(B.w, 0.0, 1.0);
        const seed = floor(R.z.add(0.5)).mul(0.001);
        const foot = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z))).add(0.001).toVar();
        const nG = normalize(normalGeometry);
        const n = select(frontFacing, nG, nG.negate()).toVar();
        const isLeaf = kind.lessThan(0.5);
        const isHead = kind.greaterThan(1.5).and(kind.lessThan(2.5));
        const isSpike = kind.greaterThan(2.5);
        // Olive-green straps drying to straw at the tips on some; a paler midrib; the stalks
        // green; the heads dark velvet brown; the spike dry.
        const green = mix(vec3(0.032, 0.052, 0.018), vec3(0.05, 0.07, 0.024), seed);
        const straw = vec3(0.12, 0.1, 0.05);
        const tips = smoothstep(float(1.0).sub(dry.mul(0.45)), float(1.05).sub(dry.mul(0.4)), s).mul(select(dry.greaterThan(0.01), float(1.0), float(0.0)));
        const midrib = float(1.0).sub(smoothstep(0.08, 0.3, abs(across)));
        const leafCol = mix(green, straw, tips).add(vec3(0.012, 0.016, 0.006).mul(midrib));
        const albedo = select(isHead, vec3(0.05, 0.026, 0.013), select(isSpike, vec3(0.09, 0.075, 0.04),
            select(isLeaf, leafCol, vec3(0.05, 0.078, 0.028)))).toVar();
        const up = max(p.y.sub(FLOOR.canal.water), 0.0);
        const ao = smoothstep(0.0, 0.5, up).mul(0.6).add(0.4);
        // Thin, moving blades take the lattice's shadow softened (the laths' fine ruling would
        // break them into dashes).
        const vis = mgMoonVis(p, U, max(foot, 0.06)).toVar();
        const transl = select(isHead, float(0.0), float(0.22));
        const lit = mgSurface(p, n, albedo, U, {
            translucency: transl, soft: foot, ao, vis, view: v,
        });
        // The edges glow where the moon is behind a leaf (the light runs along its thin margins).
        const through = clamp(dot(v, U.moon), 0.0, 1.0);
        const moon = night.moonlight.mul(U.moonLight).mul(vis);
        const edge = smoothstep(0.55, 1.0, abs(across)).mul(select(isLeaf, float(1.0), float(0.0)));
        const backlit = smoothstep(0.55, 0.95, through);
        const rim = night.leafLit.mul(moon).mul(backlit.mul(backlit)).mul(edge.mul(0.2).add(0.015));
        // The heads' velvet: a soft bright rim where the surface turns from the eye.
        const facing = abs(dot(n, v));
        const velvet = float(1.0).sub(facing);
        const sheen = moon.mul(vec3(0.6, 0.5, 0.4)).mul(velvet.mul(velvet).mul(0.06)).mul(select(isHead, float(1.0), float(0.0)));
        return vec4(lit.add(rim).add(sheen), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'moonlit-greenhouse-reeds';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
