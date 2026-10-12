/**
 * Moonlit Greenhouse — the night garden under glass: numbers, the house's shape, the moon, the
 * glazing the moonlight falls through, and the wheel of nights (CPU only, three-free).
 *
 * Everything that has to agree between the renderer, the event aiming and the tests lives here.
 *
 * World: metres, y up, the floor at y = 0. The eye stands at the head of a lily canal that runs
 * down the middle of a Victorian palm house and looks along it, toward −z; +x is to its right.
 * The house is a pointed vault of iron and glass: two circular arcs that spring from the side
 * walls at x = ±HOUSE.halfSpan, y = HOUSE.spring and meet at the ridge, y = spring + rise.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two DISTINCT edges (either order). */
export function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent easing factor: `value += (target - value) * approach(rate, dt)`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A small arithmetic hash of two integers into 0..1: the same formula as the shader's
 * `mgPaneHash` (moonlit-greenhouse-tsl.js). The GPU evaluates it in 32-bit floats, so an
 * individual pane's pick (a vent, a fogged pane, a blind) can differ from this one; the shares
 * agree, which is what the tests check.
 */
export function hash2(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour (a CSS hex string) as scene-linear light, its brightest channel at 1 so that
 * every bloom glows equally bright. Anything else (and a colour with no light in it) gives the
 * pale gold of a moonflower's heart.
 */
export function pieceLight(color, out = [1, 0.84, 0.52]) {
    const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
    const r = hex ? srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255) : 0;
    const g = hex ? srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255) : 0;
    const b = hex ? srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255) : 0;
    const peak = Math.max(r, g, b);
    if (peak < 0.01) {
        out[0] = 1;
        out[1] = 0.84;
        out[2] = 0.52;
        return out;
    }
    out[0] = r / peak;
    out[1] = g / peak;
    out[2] = b / peak;
    return out;
}

// ── The house ───────────────────────────────────────────────────────────────────────────────

/**
 * The palm house's shell.
 *   halfSpan     the side walls stand at x = ±halfSpan
 *   spring       height of the side walls, where the vault springs
 *   rise         the vault's rise over the spring (the ridge is at spring + rise)
 *   near, far    the house runs along z from `near` (behind the eye) to `far`
 *   plinth       the low brick wall the glass of the side walls stands on
 */
export const HOUSE = Object.freeze({
    halfSpan: 7,
    spring: 5,
    rise: 8,
    near: 6,
    far: -66,
    plinth: 0.75,
});

/**
 * Each arc of the pointed vault: the LEFT arc (x ≤ 0) is centred on the spring line at
 * x = +ARC.offset, the right arc at −ARC.offset, both of radius ARC.radius, so each passes
 * through its own side wall's head and through the ridge.
 */
export const ARC = (() => {
    const a = HOUSE.halfSpan;
    const h = HOUSE.rise;
    const offset = (h * h - a * a) / (2 * a);
    const radius = a + offset;
    // The angle (about the left arc's centre) of the ridge, and the arc length spring → ridge.
    const ridgeAngle = Math.atan2(h, -offset);
    return Object.freeze({
        offset, radius, ridgeAngle, length: radius * (Math.PI - ridgeAngle),
    });
})();

/** The vault's inner height over a point across the nave (the side wall's head beyond ±halfSpan). */
export function vaultHeightAt(x) {
    const ax = Math.min(Math.abs(x), HOUSE.halfSpan);
    // On the arc on x's own side: centre at the opposite offset.
    const dx = ax + ARC.offset;
    return HOUSE.spring + Math.sqrt(Math.max(0, ARC.radius * ARC.radius - dx * dx));
}

/**
 * The glazing: what the moonlight falls through (and what the eye sees against the sky).
 *   ribEvery      the main arched ribs stand this far apart along the house
 *   ribWidth      their width as a shadow (the girder and its lattice)
 *   barEvery      glazing bars, along the house, between the ribs
 *   barWidth
 *   purlinEvery   the purlins (the panes' lap lines) along the arc, in metres of arc
 *   purlinWidth
 *   ridgeWidth    the ridge beam and its vent, as a share of the arc length on each side
 *   mullionEvery  the side walls' mullions, along the house
 *   transoms      heights of the side walls' transoms (metres)
 *   transomWidth
 *   penumbra      the moon's half-width in radians: a bar's shadow softens by this per metre
 */
export const GLAZING = Object.freeze({
    ribEvery: 3.6,
    ribWidth: 0.26,
    barEvery: 0.6,
    barWidth: 0.045,
    purlinEvery: 1.62,
    purlinWidth: 0.07,
    ridgeWidth: 0.34,
    mullionEvery: 0.9,
    transoms: Object.freeze([1.9, 3.4]),
    transomWidth: 0.08,
    penumbra: 0.0046,
});

/**
 * The lath blinds on the outside of the vault: a share of the bays (the glazing between two
 * ribs, on one side of the ridge) have their blind rolled part-way down from the ridge, as a
 * Victorian palm house shaded its glass. A blind is laths along the house with gaps between them,
 * so the moonlight through a blinded bay is ruled into fine bars, and the beams in the air
 * alternate bay by bay.
 *   share     the share of bays with a blind down
 *   reach     how far down from the ridge a blind may come (share of the arc), least..most
 *   slat      the laths' spacing (metres) and the open share between them
 */
export const BLINDS = Object.freeze({
    share: 0.55,
    reach: Object.freeze([0.5, 1.0]),
    slat: 0.11,
    open: 0.3,
});

/**
 * How much light the blind over a point of the vault lets by (1 = no blind there): `bay` the
 * bay's index along the house, `side` −1 left of the ridge / +1 right, `s` metres of arc from
 * that side's spring, `soft` the edge's softness in metres.
 */
export function blindAt(bay, side, s, soft = 0.01) {
    const h = hash2(bay * 3 + 11, side * 7 + 5);
    if (h > BLINDS.share) return 1;
    const extent = lerp(BLINDS.reach[0], BLINDS.reach[1], hash2(bay + 31, side * 3 - 2));
    const from = ARC.length * (1 - extent);
    const cover = smooth(from - soft * 0.5 - 0.02, from + soft * 0.5 + 0.02, s);
    const f = s / BLINDS.slat;
    const d = Math.abs(f - Math.round(f)); // 0 on a gap's middle
    const w = Math.max(soft / BLINDS.slat, 0.04);
    const gap = 1 - smooth(BLINDS.open * 0.5 - w, BLINDS.open * 0.5 + w, d);
    // A wide penumbra averages laths and gaps into the open share.
    const ruled = lerp(gap, BLINDS.open, smooth(0.4, 1.6, soft / BLINDS.slat));
    return lerp(1, 0.04 + 0.96 * ruled, cover);
}

/** Where ribs stand along the house: z of every rib from near to far. */
export function ribPositions() {
    const out = [];
    const first = Math.floor(HOUSE.near / GLAZING.ribEvery) * GLAZING.ribEvery;
    for (let z = first; z >= HOUSE.far; z -= GLAZING.ribEvery) out.push(z);
    return out;
}

/** 1 on a line of `width` centred on every multiple of `every`, 0 off it, soft by `soft` metres. */
export function lineMask(x, every, width, soft) {
    const f = x / every;
    const d = Math.abs(f - Math.round(f)) * every; // metres to the nearest line
    const half = width * 0.5;
    const w = Math.max(soft, 1e-4);
    return 1 - smooth(half - w * 0.5, half + w * 0.5, d);
}

/**
 * Where a ray from inside the house leaves it.
 * `p` the start (inside), `d` a unit direction with d.y > 0 (toward the moon).
 * Returns { t, along, s, wall } in `out`: the distance travelled, the exit's z, its height
 * coordinate on the glass (metres of arc from the spring up the vault; on a side wall a negative
 * height below the spring), and whether it left through a side wall.
 */
export function houseExit(p, d, out = {
    t: 0, along: 0, s: 0, wall: false, side: -1,
}) {
    const { halfSpan, spring } = HOUSE;
    const { offset, radius } = ARC;
    // Each arc's circle: the point is inside both (the vault is their intersection), so the ray
    // leaves the vault where it first leaves either.
    const exitCircle = (cx) => {
        const dx = p.x - cx;
        const dy = p.y - spring;
        const a = d.x * d.x + d.y * d.y;
        const b = 2 * (dx * d.x + dy * d.y);
        const c = dx * dx + dy * dy - radius * radius;
        const disc = Math.max(0, b * b - 4 * a * c);
        return (-b + Math.sqrt(disc)) / (2 * Math.max(a, 1e-9));
    };
    const tLeft = exitCircle(offset); // the left arc (centre on the right)
    const tRight = exitCircle(-offset);
    const tVault = Math.min(tLeft, tRight);
    const hy = p.y + d.y * tVault;
    if (hy >= spring || Math.abs(d.x) < 1e-6) {
        const hx = p.x + d.x * tVault;
        const left = tLeft <= tRight;
        // Arc length from the spring on that side.
        const cx = left ? offset : -offset;
        const ang = Math.atan2(hy - spring, left ? hx - cx : cx - hx);
        out.t = tVault;
        out.along = p.z + d.z * tVault;
        out.s = radius * (Math.PI - ang);
        out.wall = false;
        out.side = left ? -1 : 1;
        return out;
    }
    const wx = d.x < 0 ? -halfSpan : halfSpan;
    const tWall = (wx - p.x) / d.x;
    out.t = tWall;
    out.along = p.z + d.z * tWall;
    out.s = p.y + d.y * tWall - spring; // negative: below the spring
    out.wall = true;
    out.side = d.x < 0 ? -1 : 1;
    return out;
}

/**
 * How much light a pane of the glazing passes at (along, s): the glass itself (each pane a
 * little different: old glass, condensation, a few vents propped open), and nothing where the
 * iron stands. `soft` widens every edge (metres): the moon's penumbra plus the footprint.
 */
export function glazingAt(along, s, wall, soft = 0.01, side = -1, moonBay = null) {
    const g = GLAZING;
    let iron;
    let paneI;
    let paneJ;
    if (wall) {
        const mullion = lineMask(along, g.mullionEvery, g.barWidth * 1.4, soft);
        const h = s + HOUSE.spring;
        let transom = 0;
        for (let i = 0; i < g.transoms.length; i += 1) {
            const away = Math.abs(h - g.transoms[i]);
            transom = Math.max(transom, 1 - smooth(g.transomWidth * 0.5, g.transomWidth * 0.5 + soft, away));
        }
        const plinth = 1 - smooth(HOUSE.plinth - soft * 0.5, HOUSE.plinth + soft * 0.5, h);
        const head = smooth(HOUSE.spring - 0.18 - soft * 0.5, HOUSE.spring - 0.18 + soft * 0.5, h);
        iron = Math.max(mullion, transom, plinth, head);
        paneI = Math.floor(along / g.mullionEvery);
        paneJ = -1;
        if (h < g.transoms[1]) paneJ = -2;
        if (h < g.transoms[0]) paneJ = -3;
    } else {
        const rib = lineMask(along, g.ribEvery, g.ribWidth, soft);
        const bar = lineMask(along, g.barEvery, g.barWidth, soft);
        const purlin = lineMask(s, g.purlinEvery, g.purlinWidth, soft);
        const ridge = smooth(ARC.length - g.ridgeWidth - soft * 0.5, ARC.length - g.ridgeWidth + soft * 0.5, s);
        const springBeam = 1 - smooth(0.16 - soft * 0.5, 0.16 + soft * 0.5, s);
        iron = Math.max(rib, bar, purlin, ridge, springBeam);
        paneI = Math.floor(along / g.barEvery);
        paneJ = Math.floor(s / g.purlinEvery);
    }
    const h = hash2(paneI, paneJ);
    // Most panes pass 0.8..0.95; one in sixteen is fogged, one in forty is a vent propped open.
    let pane = 0.8 + 0.15 * hash2(paneJ + 17, paneI - 5);
    if (h < 0.0875) pane = 0.55;
    if (h < 0.025) pane = 1;
    const bay = Math.floor(along / g.ribEvery);
    const open = wall || (moonBay && Math.abs(bay - moonBay.bay) < 1.5 && side === moonBay.side);
    const blind = open ? 1 : blindAt(bay, side, s, soft);
    return pane * (1 - iron) * blind;
}

/**
 * The moonlight that reaches a point inside the house through the glazing (0..1). `moonBay`
 * ({ bay, side }) is the bay whose blind is up because the eye sees the moon through it.
 */
export function moonlightAt(p, moonDir, extraSoft = 0, moonBay = null) {
    if (moonDir.y <= 0.02) return 0;
    const e = houseExit(p, moonDir);
    return glazingAt(e.along, e.s, e.wall, e.t * GLAZING.penumbra + extraSoft + 0.004, e.side, moonBay);
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────

/**
 * The occupied cells of a shape matrix as offsets from their own centre, x right and y UP
 * (matrix rows run down), at most four. Returns a flat [x0, y0, x1, y1, …] of 8 numbers (a
 * missing cell repeats the first, so the union is unchanged), or null if nothing is occupied.
 * Offsets are multiples of 0.5.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    // Centre on the bounding box (offsets stay on the half grid; the box's middle is the turn's pivot).
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

// ── The floor ───────────────────────────────────────────────────────────────────────────────

/**
 * The floor's plan, across the nave (x, metres):
 *   the lily canal down the middle (|x| < canal.half), its water `canal.water` under the path,
 *   its coping a stone kerb `coping` wide standing `copingHeight` proud;
 *   a tiled path each side out to |x| = path.outer;
 *   raised beds beyond, edged in stone, their soil at `bed.soil`.
 * The canal runs from `canal.head` (just in front of the eye's landing) to `canal.end`.
 */
export const FLOOR = Object.freeze({
    canal: Object.freeze({
        half: 2.5, water: -0.16, head: 1.6, end: -54,
    }),
    coping: 0.32,
    copingHeight: 0.1,
    path: Object.freeze({ outer: 3.7 }),
    bed: Object.freeze({ inner: 3.7, soil: 0.42, kerb: 0.5 }),
});

/** The resting surface under a point: water in the canal, the path, or a bed's soil. */
export function groundAt(x, z) {
    const ax = Math.abs(x);
    const inCanal = ax < FLOOR.canal.half && z < FLOOR.canal.head && z > FLOOR.canal.end;
    if (inCanal) return { y: FLOOR.canal.water, kind: 'water' };
    if (ax < FLOOR.path.outer) return { y: 0, kind: 'path' };
    return { y: FLOOR.bed.soil, kind: 'bed' };
}

// ── The eye and the moon ────────────────────────────────────────────────────────────────────

/** The eye at rest: on a little landing at the canal's head. */
export const EYE = Object.freeze({
    x: 0, y: 2.05, z: 4.2, pitch: 4.5,
});

/** The moon's angular radius (degrees): larger than life, as a long lens sees it. */
export const MOON_RADIUS = 1.9;

/** A direction from an azimuth (degrees, 0 = straight down the house, negative = left) and elevation. */
export function skyDirection(azimuthDeg, elevationDeg, out = { x: 0, y: 0, z: -1 }) {
    const az = azimuthDeg * DEG;
    const el = elevationDeg * DEG;
    out.x = Math.sin(az) * Math.cos(el);
    out.y = Math.sin(el);
    out.z = -Math.cos(az) * Math.cos(el);
    return out;
}

/**
 * The moon's slow drift with the clock alone: it climbs and swings a degree or two about the
 * place the frame gives it, over MOON_CYCLE seconds, so the lattice it draws creeps across the
 * floor while nobody is playing (a shadow thrown twenty metres moves a degree's worth of a third
 * of a metre). Small enough that the moon stays inside its bay, clear of the ribs.
 */
export const MOON_CYCLE = 420;
export function moonDrift(clock, out = { az: 0, el: 0 }) {
    const a = (clock / MOON_CYCLE) * TAU;
    out.az = Math.sin(a) * 1.9;
    out.el = Math.sin(a * 0.5 + 0.9) * 0.9;
    return out;
}

// ── The wheel of nights ─────────────────────────────────────────────────────────────────────

/** The colours a night holds (scene-linear), in the order of the shaders' uniform rows. */
export const NIGHT_COLOURS = Object.freeze([
    'moonlight', // the light the moon casts through the glass
    'moonDisc', // the disc itself
    'zenith', // the sky high up, seen through the glass
    'horizon', // the sky low down
    'glassFog', // the condensation on the panes, lit by the moon
    'mist', // the mist over the water and in the beams
    'firefly', // the fireflies' light
    'glow', // bioluminescence: moss, fungi, the canal's ripples
    'lantern', // the hanging lanterns' flames
    'leafLit', // light through a leaf
    'gradeShadow', // the grade's lift in the shadows
    'gradeLight', // the grade's tint in the lights
]);

const night = (name, colours, scalars) => Object.freeze({ name, ...colours, ...scalars });

/**
 * Six nights on a wheel. The level moves the house one night along it and the clock alone drifts
 * it (NIGHT_SECONDS a night). A warm light inside blue glass mixes to grey, so the warm nights
 * warm the moon itself, not the glass alone.
 *   exposure     the grade's exposure
 *   stars        how many stars show through the glass (0..1)
 *   cloud        how much cloud drifts over the sky (0..1)
 *   lanterns     how bright the lanterns burn (multiplier)
 */
export const NIGHTS = Object.freeze([
    night('silver moon', {
        moonlight: [0.6, 0.74, 1.0],
        moonDisc: [1.0, 0.97, 0.9],
        zenith: [0.003, 0.007, 0.02],
        horizon: [0.012, 0.022, 0.044],
        glassFog: [0.3, 0.42, 0.56],
        mist: [0.1, 0.16, 0.23],
        firefly: [0.74, 1.0, 0.26],
        glow: [0.12, 0.92, 0.72],
        lantern: [1.0, 0.56, 0.2],
        leafLit: [0.34, 0.72, 0.2],
        gradeShadow: [0.0, 0.012, 0.022],
        gradeLight: [1.0, 0.985, 0.95],
    }, {
        exposure: 1.0, stars: 1.0, cloud: 0.35, lanterns: 1.0,
    }),
    night('lavender night', {
        moonlight: [0.78, 0.68, 1.0],
        moonDisc: [1.0, 0.95, 1.0],
        zenith: [0.012, 0.006, 0.03],
        horizon: [0.06, 0.032, 0.09],
        glassFog: [0.42, 0.34, 0.6],
        mist: [0.18, 0.12, 0.27],
        firefly: [1.0, 0.86, 0.36],
        glow: [0.56, 0.42, 1.0],
        lantern: [1.0, 0.52, 0.26],
        leafLit: [0.36, 0.66, 0.3],
        gradeShadow: [0.012, 0.004, 0.026],
        gradeLight: [1.0, 0.96, 1.0],
    }, {
        exposure: 1.0, stars: 0.85, cloud: 0.3, lanterns: 1.0,
    }),
    night('jade dream', {
        moonlight: [0.55, 0.95, 0.86],
        moonDisc: [0.92, 1.0, 0.95],
        zenith: [0.002, 0.016, 0.02],
        horizon: [0.012, 0.062, 0.062],
        glassFog: [0.24, 0.5, 0.46],
        mist: [0.06, 0.2, 0.18],
        firefly: [0.42, 1.0, 0.78],
        glow: [0.08, 1.0, 0.66],
        lantern: [1.0, 0.62, 0.3],
        leafLit: [0.24, 0.8, 0.36],
        gradeShadow: [0.0, 0.018, 0.016],
        gradeLight: [0.96, 1.0, 0.97],
    }, {
        exposure: 1.02, stars: 0.75, cloud: 0.4, lanterns: 0.85,
    }),
    night('harvest moon', {
        moonlight: [1.0, 0.78, 0.5],
        moonDisc: [1.0, 0.84, 0.58],
        zenith: [0.012, 0.01, 0.022],
        horizon: [0.08, 0.05, 0.04],
        glassFog: [0.56, 0.42, 0.3],
        mist: [0.22, 0.15, 0.1],
        firefly: [1.0, 0.78, 0.28],
        glow: [1.0, 0.62, 0.22],
        lantern: [1.0, 0.5, 0.16],
        leafLit: [0.5, 0.66, 0.18],
        gradeShadow: [0.02, 0.01, 0.004],
        gradeLight: [1.0, 0.95, 0.88],
    }, {
        exposure: 0.98, stars: 0.6, cloud: 0.45, lanterns: 1.25,
    }),
    night('rose nocturne', {
        moonlight: [1.0, 0.74, 0.86],
        moonDisc: [1.0, 0.92, 0.94],
        zenith: [0.016, 0.006, 0.02],
        horizon: [0.09, 0.034, 0.062],
        glassFog: [0.56, 0.36, 0.48],
        mist: [0.24, 0.12, 0.18],
        firefly: [1.0, 0.8, 0.52],
        glow: [1.0, 0.42, 0.72],
        lantern: [1.0, 0.56, 0.32],
        leafLit: [0.44, 0.66, 0.3],
        gradeShadow: [0.02, 0.004, 0.012],
        gradeLight: [1.0, 0.95, 0.96],
    }, {
        exposure: 1.0, stars: 0.8, cloud: 0.3, lanterns: 1.05,
    }),
    night('blue hour', {
        moonlight: [0.52, 0.66, 1.0],
        moonDisc: [0.95, 0.98, 1.0],
        zenith: [0.006, 0.015, 0.052],
        horizon: [0.05, 0.085, 0.17],
        glassFog: [0.3, 0.44, 0.66],
        mist: [0.12, 0.18, 0.31],
        firefly: [0.66, 0.96, 1.0],
        glow: [0.3, 0.72, 1.0],
        lantern: [1.0, 0.6, 0.3],
        leafLit: [0.28, 0.66, 0.4],
        gradeShadow: [0.0, 0.008, 0.03],
        gradeLight: [0.97, 0.99, 1.0],
    }, {
        exposure: 1.02, stars: 0.5, cloud: 0.4, lanterns: 0.9,
    }),
]);

/** Seconds the clock alone takes to drift one night along the wheel. */
export const NIGHT_SECONDS = 150;
/** Share of each step spent resting at either end: the house holds a night before it moves. */
export const NIGHT_REST = 0.18;

/** A step's progress with rests at its ends: 0 for the first NIGHT_REST, 1 for the last. */
export function restEase(f) {
    return smooth(NIGHT_REST, 1 - NIGHT_REST, f);
}

/**
 * The night at a place on the wheel (any real number; one per night, wrapping): every colour
 * and scalar mixed between the two nights either side, with the rests applied.
 */
export function nightAt(place, out = {}) {
    const n = NIGHTS.length;
    const base = Math.floor(place);
    const i = ((base % n) + n) % n;
    const j = (i + 1) % n;
    const mix = restEase(place - base);
    const a = NIGHTS[i];
    const b = NIGHTS[j];
    for (let k = 0; k < NIGHT_COLOURS.length; k += 1) {
        const key = NIGHT_COLOURS[k];
        const c = out[key] || (out[key] = [0, 0, 0]);
        c[0] = lerp(a[key][0], b[key][0], mix);
        c[1] = lerp(a[key][1], b[key][1], mix);
        c[2] = lerp(a[key][2], b[key][2], mix);
    }
    out.exposure = lerp(a.exposure, b.exposure, mix);
    out.stars = lerp(a.stars, b.stars, mix);
    out.cloud = lerp(a.cloud, b.cloud, mix);
    out.lanterns = lerp(a.lanterns, b.lanterns, mix);
    out.name = a.name;
    out.next = b.name;
    out.mix = mix;
    out.index = i;
    return out;
}

/** Where the level and the clock put the house on the wheel: one night a level, plus the drift. */
export function nightPlace(level, clock) {
    return Math.max(0, (level | 0) - 1) + Math.max(0, clock) / NIGHT_SECONDS;
}

// ── What the board does ─────────────────────────────────────────────────────────────────────

/**
 * Timings (seconds) of the event language:
 *   seedFlight      a lock's seed of light, from the card's edge to the place it lands
 *   bloomOpen       a bloom unfurls this long after it lands
 *   bloomClose      a bloom whose pollen a clear releases closes over this long
 *   pollenRise      the pollen rises to the glass in this long
 *   streamFlight    a cleared row's fireflies fly out into the garden in this long
 *   paneWave        the moonlight's wave across the glazing runs this many metres a second
 *   hush            four lines: the house goes dark for this long before the Queen opens
 *   queenOpen       the Queen of the Night unfurls in this long…
 *   queenHold       …holds open this long…
 *   queenClose      …and closes over this long
 *   dewFall         a hard drop's curtain of dew falls from the glass in this long
 *   ringLife        a ring on the canal runs this long
 *   turn            a T-spin's turn of the air
 */
export const TIMING = Object.freeze({
    seedFlight: 0.85,
    bloomOpen: 1.35,
    bloomClose: 2.4,
    pollenRise: 5.5,
    streamFlight: 1.6,
    paneWave: 26,
    hush: 0.42,
    queenOpen: 1.9,
    queenHold: 5.5,
    queenClose: 4.5,
    dewFall: 1.8,
    ringLife: 6.5,
    turn: 4.2,
});

/**
 * The fireflies fall into step with a chain: 0 at rest (each its own rhythm), rolling waves
 * of flashes down the house from three, the whole swarm as one at eight and beyond.
 */
export function syncForCombo(combo) {
    return combo > 1 ? clamp01(1 - Math.exp(-(combo - 1) * 0.3)) : 0;
}

/**
 * How high (metres) the bioluminescent moss stands on the iron columns for a chain: a step a
 * link, so the colonnade counts it; it reaches the spring at eight.
 */
export function mossForCombo(combo) {
    return combo > 0 ? Math.min(HOUSE.spring + 3, 0.35 + combo * 0.62) : 0;
}

/** How many fireflies are out (a share of the tier's swarm) for a chain. */
export function swarmForCombo(combo) {
    return clamp01(0.42 + combo * 0.075);
}

/**
 * A firefly's light at `t`: each blinks on its own period while out of step; in step, a single
 * beat rolls down the house as a wave (its phase lags by `lag` seconds a metre), and at full sync
 * the whole swarm flashes together. CPU twin of the shader's flash.
 */
export const FLASH = Object.freeze({
    beat: 1.9, // seconds between the swarm's flashes in step
    width: 0.16, // a flash's share of its period
    lag: 0.045, // seconds of delay per metre down the house, half in step
});
/** One flash at f (0..1 through its period): sin² over the first FLASH.width, then dark. */
export function flashPulse(f) {
    const x = f / FLASH.width;
    return x < 1 ? Math.sin(x * Math.PI) ** 2 : 0;
}

/** The swarm's flash in step at time t, where the house is nearest (no lag down the nave). */
export function swarmFlash(t) {
    return flashPulse((((t / FLASH.beat) % 1) + 1) % 1);
}

export function fireflyFlash(t, seed, z, sync) {
    const own = 1.4 + seed * 1.6;
    const fOwn = (((t / own + seed * 7.13) % 1) + 1) % 1;
    const lag = FLASH.lag * (1 - smooth(0.7, 1, sync)) * Math.max(0, -z);
    const fSync = ((((t - lag) / FLASH.beat) % 1) + 1) % 1;
    return lerp(flashPulse(fOwn), flashPulse(fSync), smooth(0.15, 0.85, sync));
}

// ── Noise ───────────────────────────────────────────────────────────────────────────────────

/** A tileable value-noise fBm field, 0..1 (mean 0.5). */
function fbmField(size, rand, baseCells, octaves, gain = 0.55) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
        const cells = baseCells * 2 ** o;
        if (cells > size / 2) break;
        const lattice = new Float32Array(cells * cells);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
        const step = cells / size;
        for (let j = 0; j < size; j += 1) {
            const y = j * step;
            const y0 = Math.floor(y);
            const fy = y - y0;
            const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
            const j0 = (y0 % cells) * cells;
            const j1 = ((y0 + 1) % cells) * cells;
            const rowAt = j * size;
            for (let i = 0; i < size; i += 1) {
                const x = i * step;
                const x0 = Math.floor(x);
                const fx = x - x0;
                const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
                const i0 = x0 % cells;
                const i1 = (i0 + 1) % cells;
                const p = lattice[j0 + i0];
                const q = lattice[j0 + i1];
                const s = lattice[j1 + i0];
                const w = lattice[j1 + i1];
                out[rowAt + i] += (p + (q - p) * sx + (s - p) * sy + (p - q - s + w) * sx * sy) * amp;
            }
        }
        total += amp;
        amp *= gain;
    }
    for (let i = 0; i < out.length; i += 1) out[i] /= total;
    return out;
}

/**
 * A tileable field of round drops, 0..1: the height of a bead of water over its cell (a dome,
 * 0 off the bead), each bead its own size and some cells empty. One octave of Worley distance.
 */
function beadField(size, rand, cells, fill = 0.8) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    const pr = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = 0.2 + rand() * 0.6;
        py[i] = 0.2 + rand() * 0.6;
        pr[i] = rand() < fill ? 0.18 + rand() * 0.3 : 0;
    }
    const out = new Float32Array(size * size);
    const step = cells / size;
    for (let j = 0; j < size; j += 1) {
        const y = j * step;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = i * step;
            const cx = Math.floor(x);
            let best = 0;
            for (let oy = -1; oy <= 1; oy += 1) {
                const gy = cy + oy;
                const wy = ((gy % cells) + cells) % cells;
                for (let ox = -1; ox <= 1; ox += 1) {
                    const gx = cx + ox;
                    const at = wy * cells + (((gx % cells) + cells) % cells);
                    const r = pr[at];
                    if (r <= 0) continue;
                    const dx = (gx + px[at] - x) / r;
                    const dy = (gy + py[at] - y) / r;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < 1) best = Math.max(best, Math.sqrt(1 - d2));
                }
            }
            out[j * size + i] = best;
        }
    }
    return out;
}

const toByte = (v) => Math.round(clamp01(v) * 255);

/**
 * The garden's noise, as bytes (RGBA8), tileable:
 *   R  broad fBm (cloud, mist, the lie of the soil, a leaf's mottling)
 *   G  beads: the domes of condensation drops on the glass, two sizes laid over each other
 *   B  a second, independent fBm (where cloud is at all; the water's slow swell; moss)
 *   A  fine fBm (the grain of everything)
 */
export function bakeGardenNoise(size = 256, seed = 20261011) {
    const rand = mulberry32(seed);
    const broad = fbmField(size, rand, 4, 6);
    const second = fbmField(size, rand, 3, 6);
    const fine = fbmField(size, rand, 16, 4, 0.6);
    const big = beadField(size, rand, 9, 0.62);
    const small = beadField(size, rand, 23, 0.82);
    const data = new Uint8Array(size * size * 4);
    for (let at = 0; at < size * size; at += 1) {
        data[at * 4] = toByte((broad[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 1] = toByte(Math.max(big[at], small[at] * 0.8));
        data[at * 4 + 2] = toByte((second[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 3] = toByte((fine[at] - 0.5) * 2.2 + 0.5);
    }
    return data;
}
