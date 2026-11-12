/**
 * Cosmic Noir — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * "The last lighthouse." A black-and-white film of deep space: a lighthouse stands on a shard of
 * rock in a sea of interstellar smoke, at the edge of the dark, with the home galaxy rising over
 * the sea's horizon. A captive pulsar turns in its lantern room behind a ring of shutter slats:
 * two beams sweep round, one raking the sea of smoke (every swell throws a long shadow), one
 * searching the sky, and the lamp's own light leaves between the slats as a fan of shafts whose
 * shadows wheel over the sea like spokes. The picture is graded as a print on one film stock at a
 * time — silver, selenium, sepia, platinum, cyanotype — that drifts by itself and changes reel on a
 * level-up.
 *
 * Units: scene units, y up. The camera stands near the origin; the lighthouse's axis is the
 * vertical through (0, ·, −PULSAR.depth), its lamp PULSAR.height above the eye, and the sea of
 * smoke lies SEA.level below it. The camera is turned so the lamp hangs in the free zone beside
 * the board (pulsarAnchor).
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The pulsar (the lamp): this far ahead of the eye and this far above it, on the lighthouse's axis. */
export const PULSAR = Object.freeze({
    depth: 24,
    height: 8.4,
    /** Spin axis (unnormalised): the lighthouse stands upright. */
    axis: Object.freeze([0, 1, 0]),
    /**
     * Angle between the spin axis and the beams (degrees): one beam looks 36° down and rakes the
     * sea of smoke about 15 units out from the rock, its opposite 36° up into the sky. The eye
     * stands ~19° below the lamp, so the lower beam's cone passes ~17° from the lens at its nearest:
     * a blaze that skims past (the world closes the iris for it), never a white-out.
     */
    inclination: 54,
    /** The beams' core half-width and their soft skirt (degrees). */
    beamWidth: 7.5,
    beamSkirt: 22,
    /** How bright the skirt is beside the core (dim: noir keeps the air between shafts dark). */
    skirtShare: 0.06,
    /** Seconds per turn at rest. */
    period: 14,
    /** How bright the beam is near the lantern (it falls as 1 / (1 + (r/beamReach)²)). */
    beamGain: 7,
    beamReach: 22,
    /** The lamp's own light (all directions the lantern room lets it leave, between the slats). */
    coreGain: 2.0,
    coreReach: 4.6,
    /**
     * Forward scatter of the beams in the smoke (Henyey–Greenstein g) at rest: a beam that looks
     * toward us is a blaze. Hot play lowers it (the world's `u.forward`): the blades seen side-on
     * gain, the blaze toward the lens gives way.
     */
    forward: 0.32,
});

/**
 * The lantern room round the pulsar: a cylinder of vertical shutter slats on the spin axis, closed
 * by the roof above and the gallery below (light leaves only between the slats).
 */
export const CAGE = Object.freeze({
    radius: 1.25,
    halfHeight: 1.15,
    slats: 20,
    /** Share of each pitch a slat covers: closed at rest, opened by a chain. */
    fillClosed: 0.45,
    fillOpen: 0.25,
    /** Seconds per turn of the cage itself (it turns slowly, the other way). */
    period: 150,
    /** The frame rings at the top and bottom (share of the half-height). */
    ring: 0.06,
    /** The share of the light the lids let past (round their rims): their shadow is soft, not a void. */
    lidLeak: 0.22,
});

/**
 * The lighthouse, as heights from the lamp (down is negative) and radii. Drawn by a distance field
 * (cosmic-noir-lighthouse.js); the same numbers bound it for the light in the air.
 */
export const TOWER = Object.freeze({
    /** The gallery: its floor below the lamp, its radius, the railing's height. */
    galleryDrop: 1.95,
    galleryRadius: 2.0,
    railHeight: 0.8,
    railPosts: 18,
    /** The tower's neck (under the gallery's corbel) and its foot on the rock. */
    neckDrop: 3.3,
    neckRadius: 0.98,
    footRadius: 1.72,
    /** The foot's height above the sea of smoke. */
    footLift: 1.5,
    /** The roof: its eave's radius, the dome's rise above the slats, the ball and the rod. */
    eaveRadius: 1.45,
    domeRise: 1.2,
    rodTop: 3.5,
    /** Painted bands on the tower (dark and pale, top to bottom). */
    bands: 5,
});

/** The sea of smoke: a field of slow swells and billows, flowing past the rock. */
export const SEA = Object.freeze({
    /** Its mean height (the eye stands at 0). */
    level: -2.6,
    /** The layers: one tile of the baked field in scene units, and its height. */
    swellTile: 56,
    swell: 1.0,
    billowTile: 21,
    billow: 0.52,
    wispTile: 6.1,
    wisp: 0.14,
    /** The wind over the sea (scene units / s, along x and z): the swells drift, the billows run ahead. */
    wind: Object.freeze([0.42, 0.2]),
    /** Past this the swells have sunk into a level sea, and past `far` the sea is the horizon's mist. */
    flat: 150,
    far: 260,
    /** The mist that lies on the sea: its scale height and how thick it is at the surface. */
    mistHeight: 0.8,
    mist: 0.22,
});
/** The highest and the lowest the sea's surface reaches (the march's slab). */
export const SEA_TOP = SEA.level + SEA.swell + SEA.billow + SEA.wisp;
export const SEA_FLOOR = SEA.level - (SEA.swell + SEA.billow + SEA.wisp);

/**
 * The home galaxy, rising over the sea: where it stands (a bearing right of the lighthouse and an
 * altitude over the horizon, degrees), how long it is across (degrees), how far it is tipped toward
 * edge-on and how its long axis leans.
 */
export const GALAXY = Object.freeze({
    bearing: 59,
    altitude: 12.6,
    span: 44,
    tilt: 66,
    lean: 24,
    gain: 0.3,
});

/** The smoke: an envelope of drifting, stratified haze round the pulsar and toward the camera. */
export const SMOKE = Object.freeze({
    /** Centre and half-extents of the envelope (scene units). */
    centre: Object.freeze([4, 2, -18]),
    extent: Object.freeze([40, 14, 30]),
    /** One tile of the baked noise in scene units, and how much wider than tall it is drawn. */
    tile: 11,
    stretch: 2.4,
    /** The wind (scene units / s): the smoke drifts slowly sideways and away. */
    wind: Object.freeze([0.22, 0.015, -0.05]),
    /** A thin haze everywhere in the envelope, so a beam is a shaft even between the masses. */
    haze: 0.05,
    /** Where the march begins and ends along a view ray. */
    near: 2.2,
    far: 62,
});

// ── Events ──────────────────────────────────────────────────────────────────────

/**
 * Light echoes (clears): shells of light expanding from the pulsar through the smoke. Eight live at
 * once, so a quad's four join the rings still crossing the smoke (a new echo takes the slot with
 * the least light left) and a cascade draws concentric rings.
 */
export const ECHO_SLOTS = 8;
export const ECHO_SPEED = 26;
export const ECHO_LIFE = 2.2;
/** An echo's light falls off with its distance from the pulsar (as 1 / (1 + (r/ECHO_REACH)²)). */
export const ECHO_REACH = 9;
/** An echo slows as it spreads and never reaches the camera (~24 away): inside it, it would be a wall. */
export const ECHO_MAX = 19;
/**
 * On the sea an echo is a ring of light that runs out from the rock, under the eye and on toward
 * the horizon: how fast it starts and how far it gets.
 */
export const ECHO_SEA_SPEED = 46;
export const ECHO_SEA_MAX = 120;
/**
 * Puffs (locks): smoke billowing out of the card's edge, lit from within by a dying ember. A new
 * puff takes the slot with the least smoke left; what that one still held thins into the room.
 */
export const PUFF_SLOTS = 8;
export const PUFF_LIFE = 4.5;
/** The flashbulb (four lines): the print flips to its negative for a moment. */
export const NEGATIVE_HOLD = 0.06;
export const NEGATIVE_FADE = 0.2;
/**
 * The flashbulb never fires twice inside this (seconds): a frame-wide flip stays under ~2.2 Hz
 * (photosensitivity, ADR-0021). A quad inside it pours its light into the lantern instead.
 */
export const NEGATIVE_GAP = 0.45;
/** The reel change (level-up): two cue marks, a second apart, each this long. */
export const CUE_GAP = 1.0;
export const CUE_SHOW = 0.2;
/** How long one reel change's marks run (a second reel change inside it waits its turn). */
export const CUE_SPAN = 0.35 + CUE_GAP + CUE_SHOW;

// ── Film stocks ─────────────────────────────────────────────────────────────────

/**
 * Each stock tones a black-and-white print: `shadow` and `high` are multipliers of grey at the
 * dark and light ends (luminance ≈ 1, so the tone never changes how bright the print is), `paper`
 * the base the darkest blacks sit on, `grain` the stock's grain. Walked as a LINE, there and back
 * (cyanotype – silver – selenium – sepia – platinum – sepia – …): neighbours are close tones.
 */
export const FILM_STOCKS = Object.freeze([
    Object.freeze({
        name: 'cyanotype', shadow: [0.57, 1.04, 1.84], high: [0.9, 1.0, 1.12], paper: [0.0008, 0.0018, 0.004], grain: 1.0,
    }),
    Object.freeze({
        name: 'silver', shadow: [0.93, 0.98, 1.1], high: [1.0, 1.0, 1.0], paper: [0.0011, 0.0013, 0.0017], grain: 1.0,
    }),
    Object.freeze({
        name: 'selenium', shadow: [1.18, 0.93, 1.2], high: [1.02, 0.99, 0.98], paper: [0.0017, 0.0009, 0.0017], grain: 0.9,
    }),
    Object.freeze({
        name: 'sepia', shadow: [1.32, 0.95, 0.62], high: [1.08, 1.0, 0.85], paper: [0.0024, 0.0014, 0.0008], grain: 1.15,
    }),
    Object.freeze({
        name: 'platinum', shadow: [1.14, 1.0, 0.84], high: [1.04, 1.02, 0.94], paper: [0.002, 0.0018, 0.0014], grain: 0.85,
    }),
]);
/**
 * The heat of play tones the print too: a split tone (cold cyanotype shadows, gold highlights) the
 * stock leans toward as play burns hot, and blazes in on a perfect clear or a back-to-back. Each
 * multiplier keeps luminance about 1, so the toning colours the print without lifting it.
 */
export const HEAT_TONE = Object.freeze({
    shadow: Object.freeze([0.6, 0.96, 1.7]),
    high: Object.freeze([1.24, 1.0, 0.56]),
    paper: Object.freeze([0.0005, 0.0013, 0.0034]),
});
/**
 * The next light: another lighthouse far out on the horizon, under the galaxy. A bearing right of
 * our own and a sliver of altitude (degrees), and its character: two short flashes every `period`
 * seconds.
 */
export const FAR_LAMP = Object.freeze({
    bearing: 64,
    altitude: 0.5,
    period: 11,
    gap: 1.7,
    flash: 0.28,
});

/** The far light's brightness (0..1) at a moment: flash, flash, dark. */
export function farLampAt(time) {
    const x = ((time % FAR_LAMP.period) + FAR_LAMP.period) % FAR_LAMP.period;
    const pulse = (at) => Math.exp(-(((x - at) / FAR_LAMP.flash) ** 2));
    return Math.min(1, pulse(1) + pulse(1 + FAR_LAMP.gap));
}

/** The stock level 1 starts on (silver). */
export const STOCK_HOME = 1;
/** Seconds the clock alone takes to carry the print one stock along. A level-up is one step. */
export const STOCK_STEP = 100;
/** The share of a step, at each end, the print rests on a stock before it turns. */
export const STOCK_REST = 0.15;

export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Deterministic PRNG. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where the print stands on the stocks' line for a level's place and the clock: the two simply
 * add. `levelPlace` = the steps the level-ups have taken (eased by the world).
 */
export const stockPlace = (levelPlace, time) => levelPlace + Math.max(0, time) / STOCK_STEP;

/** A place on the line as (index, next, mix), walked there and back from STOCK_HOME. */
export function stockPhase(place) {
    const last = FILM_STOCKS.length - 1;
    const period = last * 2;
    let x = (((place + STOCK_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(STOCK_REST, 1 - STOCK_REST, x - index) };
}

/** The toning at a place: every field mixed between two neighbouring stocks. Fills `out`. */
export function stockAt(place, out = {}) {
    const { index, next, mix } = stockPhase(place);
    const a = FILM_STOCKS[index];
    const b = FILM_STOCKS[next];
    ['shadow', 'high', 'paper'].forEach((key) => {
        const target = out[key] || (out[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) target[c] = lerp(a[key][c], b[key][c], mix);
    });
    out.grain = lerp(a.grain, b.grain, mix);
    return out;
}

/** The name of the stock a place stands nearest to. */
export function stockName(place) {
    const { index, next, mix } = stockPhase(place);
    return FILM_STOCKS[mix < 0.5 ? index : next].name;
}

// ── The lighthouse: beams and cage (CPU twins of the shader maths) ─────────────

const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The spin axis and two unit vectors across it (the basis the beams and the slats turn in). */
export function spinBasis() {
    const a = norm(PULSAR.axis);
    const e1 = norm(cross([0, 0, 1], a));
    const e2 = cross(a, e1);
    return { a, e1, e2 };
}

/** One beam's direction at spin phase φ (the other beam is its opposite). */
export function beamDirection(phase, basis = spinBasis(), out = [0, 0, 0]) {
    const inc = PULSAR.inclination * DEG;
    const ci = Math.cos(inc);
    const si = Math.sin(inc);
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    for (let k = 0; k < 3; k++) out[k] = basis.a[k] * ci + si * (basis.e1[k] * c + basis.e2[k] * s);
    return out;
}

/**
 * How much of a beam reaches direction `d` (unit, from the pulsar): a gaussian core and a soft
 * skirt round either beam. CPU twin of cnBeam().
 */
export function beamLight(d, beam) {
    const c = Math.min(1, Math.abs(dot(d, beam)));
    const angle = Math.acos(c);
    const core = Math.exp(-((angle / (PULSAR.beamWidth * DEG)) ** 2));
    const skirt = Math.exp(-((angle / (PULSAR.beamSkirt * DEG)) ** 2)) * PULSAR.skirtShare;
    return core + skirt;
}

/**
 * How much light leaving the pulsar along `d` passes the cage: none through the lids, else
 * 1 − (a slat's share of the pitch), with soft edges. CPU twin of cnCage().
 */
export function cageTransmit(d, cagePhase, fill, basis = spinBasis(), soft = 0) {
    const h = dot(d, basis.a);
    const qx = dot(d, basis.e1);
    const qy = dot(d, basis.e2);
    const q = Math.hypot(qx, qy);
    if (q < 1e-6) return 0;
    const axial = Math.abs((h * CAGE.radius) / q);
    const theta = Math.atan2(qy, qx) + cagePhase;
    const f = ((((theta * CAGE.slats) / TAU) % 1) + 1) % 1;
    // A slat spans [0, fill) of each pitch; `soft` widens its edges and, far out, blends the
    // stripes into their average.
    const edge = Math.max(soft, 0.03);
    const sharp = smooth(-edge, edge, f) * (1 - smooth(fill - edge, fill + edge, f));
    const inSlat = lerp(sharp, fill * 0.85, smooth(0.12, 0.42, soft));
    // Past the wall's height the light meets a lid: most of it is stopped (a soft-edged shadow, a
    // little light leaking round the rims).
    const wall = 1 - smooth(CAGE.halfHeight - 0.5, CAGE.halfHeight + 1.2, axial) * (1 - CAGE.lidLeak);
    return (1 - inSlat * (1 - smooth(CAGE.halfHeight - 0.05, CAGE.halfHeight + 0.05, axial))) * wall;
}

/** A light echo's radius `age` seconds after it left the pulsar. */
export const echoRadius = (age) => ECHO_MAX * (1 - Math.exp(-(ECHO_SPEED / ECHO_MAX) * Math.max(0, age)));

/** The same echo's ring on the sea of smoke: its distance from the rock. */
export const echoSeaRadius = (age) => ECHO_SEA_MAX * (1 - Math.exp(-(ECHO_SEA_SPEED / ECHO_SEA_MAX) * Math.max(0, age)));

/** The flashbulb's negative (0..1) `age` seconds after it fired. */
export function negativeAt(age) {
    if (age < 0) return 0;
    if (age < NEGATIVE_HOLD) return 1;
    return Math.exp(-(age - NEGATIVE_HOLD) / (NEGATIVE_FADE * 0.45));
}

/** The reel change's cue marks (0..1) `age` seconds after a level-up: two marks a second apart. */
export function cueAt(age) {
    const mark = (t) => (t >= 0 && t < CUE_SHOW ? 1 : 0);
    return Math.max(mark(age - 0.35), mark(age - 0.35 - CUE_GAP));
}

/** Where the composition hangs the lamp for an aspect (screen fractions, y down) and the lens. */
export function pulsarAnchor(aspect) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    if (a < 0.9) {
        // An upright phone: the board fills the width; the lantern stands in the sky above it.
        return { x: 0.5, y: 0.12, vFov: 64 };
    }
    // Landscape: the free zone left of the card. Wider frames lean a little further out.
    const x = a >= 1.3 ? 0.2 + Math.min(0.03, (a - 1.78) * 0.03) : 0.17;
    return { x: Math.max(0.15, x), y: a >= 1.3 ? 0.265 : 0.25, vFov: 50 };
}

/**
 * The turn (yaw, radians, to the right) and the tilt (pitch, radians, upward) of a level camera at
 * the origin that put the lamp at a screen point (fractions, y down) through a lens of vertical
 * field `vFov` (degrees). Also where the sea's horizon then lies on screen.
 */
export function lampPose(anchorX, anchorY, vFov, aspect) {
    const tanV = Math.tan((vFov * DEG) / 2);
    const tanH = tanV * aspect;
    // The lamp's direction in the camera's own frame (right, up, back).
    let cx = (anchorX * 2 - 1) * tanH;
    let cy = (1 - anchorY * 2) * tanV;
    let cz = -1;
    const cl = Math.hypot(cx, cy, cz);
    cx /= cl;
    cy /= cl;
    cz /= cl;
    // Its direction in the world: `height` up over `depth` ahead.
    const rise = PULSAR.height / Math.hypot(PULSAR.height, PULSAR.depth);
    // rise = cy cos(pitch) − cz sin(pitch).
    const r = Math.hypot(cy, cz);
    const pitch = Math.asin(Math.max(-1, Math.min(1, rise / r))) - Math.atan2(cy, -cz);
    // Along the ground the lamp lies straight ahead (−Z): the camera turns the other way by what
    // the lamp stands aside in its frame.
    const ahead = -cy * Math.sin(pitch) - cz * Math.cos(pitch);
    const yaw = -Math.atan2(cx, ahead);
    return { yaw, pitch, horizon: 0.5 + Math.tan(pitch) / (2 * tanV) };
}
