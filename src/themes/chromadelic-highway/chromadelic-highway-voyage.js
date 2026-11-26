/**
 * Chromadelic Highway — the cosmic voyage: five distinct space sectors on a clock of their own.
 *
 * The spectrum (chromadelic-highway-spectrum.js) turns the rings' colours and forms every ~90 s
 * of travel. The five sky sectors advance every 73 seconds of simulation time. A sector
 * holds its palette for 35% of that interval, then blends into the next. Changes of pace
 * shift where the six road movements meet the five skies.
 *
 * Level-ups gently nudge the voyage offset forward (+0.35 of a sector, eased) so progression feels
 * like breaking into a new region of deep space as well as a new ring palette.
 *
 * Pure JS (three-free): deterministic in (time, offset) so seek() reproduces live play exactly.
 */

/** Seconds spent in each cosmic sector. */
export const SECTOR_PERIOD = 73;
/** Fraction of each sector spent resting pure before melting into the next. */
export const SECTOR_REST = 0.35;

const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * The five cosmic sectors. Each modulates the sky, nebula contrast, dark dust rifts, cosmic
 * aurora ribbons, Milky Way powder, star brilliance, core radiance and wet-glass reflections
 * purely via smooth uniforms (no shader rebuilds, no pops).
 */
export const SECTORS = Object.freeze([
    {
        name: 'velvet-rift',
        nebulaGain: 0.96,
        dustDepth: 0.85,
        aurora: 0.08,
        starBoost: 1.08,
        milkyWay: 0.85,
        coreWarmth: 0.25,
        roadSheen: 1.0,
        auroraHue: 0.52,
        ionBoost: 0.9,
        skyShift: [0.0, 0.0, 0.0],
        warmAccent: [0.95, 0.14, 0.56],
        coolAccent: [0.06, 0.72, 1.0],
    },
    {
        name: 'aurora-slipstream',
        nebulaGain: 0.55,
        dustDepth: 0.62,
        aurora: 1.15,
        starBoost: 1.25,
        milkyWay: 0.72,
        coreWarmth: 0.15,
        roadSheen: 1.38,
        auroraHue: 0.45,
        ionBoost: 0.75,
        skyShift: [-0.008, 0.016, 0.028],
        warmAccent: [0.22, 0.65, 1.0],
        coolAccent: [0.02, 1.0, 0.76],
    },
    {
        name: 'starlight-crossing',
        nebulaGain: 0.22,
        dustDepth: 0.96,
        aurora: 0.12,
        starBoost: 2.05,
        milkyWay: 2.65,
        coreWarmth: 0.08,
        roadSheen: 1.26,
        auroraHue: 0.62,
        ionBoost: 0.5,
        skyShift: [-0.012, -0.006, 0.006],
        warmAccent: [0.32, 0.28, 1.0],
        coolAccent: [0.24, 0.68, 1.0],
    },
    {
        name: 'ion-corridor',
        nebulaGain: 1.12,
        dustDepth: 1.0,
        aurora: 0.68,
        starBoost: 1.05,
        milkyWay: 0.55,
        coreWarmth: 0.45,
        roadSheen: 1.24,
        auroraHue: 0.85,
        ionBoost: 2.35,
        skyShift: [0.016, -0.008, 0.024],
        warmAccent: [1.0, 0.08, 0.54],
        coolAccent: [0.08, 0.92, 1.0],
    },
    {
        name: 'nebula-heart',
        nebulaGain: 1.38,
        dustDepth: 0.64,
        aurora: 0.38,
        starBoost: 1.18,
        milkyWay: 1.05,
        coreWarmth: 1.0,
        roadSheen: 1.14,
        auroraHue: 0.06,
        ionBoost: 1.45,
        skyShift: [0.032, 0.006, 0.008],
        warmAccent: [1.0, 0.34, 0.18],
        coolAccent: [0.95, 0.18, 0.68],
    },
]);

export const SECTOR_NAMES = Object.freeze(SECTORS.map((s) => s.name));

/** Lookup a sector index by name (case-insensitive), or -1 if unknown. */
export function sectorIndexByName(name) {
    if (typeof name !== 'string' || !name.trim()) return -1;
    const key = name.trim().toLowerCase();
    return SECTORS.findIndex((s) => s.name === key);
}

/** Continuous sector phase for clock `time` (seconds) and accumulated `offset` (sectors). */
export function sectorPhase(time, offset = 0) {
    return Math.max(0, (Number.isFinite(time) ? time : 0) / SECTOR_PERIOD + (Number.isFinite(offset) ? offset : 0));
}

function lerp3(a, b, t, out) {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
    return out;
}

/** Shortest-arc hue blend in turns [0, 1). */
function lerpHue(a, b, t) {
    let d = (b - a) % 1;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    const r = (a + d * t) % 1;
    return r < 0 ? r + 1 : r;
}

/**
 * Evaluate the blended cosmic sector parameters at `phase` (in sector units).
 * Rests pure on sector `floor(phase)` for SECTOR_REST, then melts smoothly into the next sector.
 */
export function sectorAt(phase, out = null) {
    const res = out || {
        index: 0,
        nextIndex: 1,
        name: SECTORS[0].name,
        blend: 0,
        nebulaGain: 1,
        dustDepth: 0.78,
        aurora: 0.1,
        starBoost: 1,
        milkyWay: 0.85,
        coreWarmth: 0.32,
        roadSheen: 1,
        auroraHue: 0.52,
        ionBoost: 0.9,
        skyShift: [0, 0, 0],
        warmAccent: [0, 0, 0],
        coolAccent: [0, 0, 0],
    };
    const p = Number.isFinite(phase) ? phase : 0;
    const m = Math.floor(p);
    const f = p - m;
    const i0 = mod(m, SECTORS.length);
    const i1 = mod(m + 1, SECTORS.length);
    const a = SECTORS[i0];
    const b = SECTORS[i1];
    const t = smooth(SECTOR_REST, 1.0, f);

    res.index = i0;
    res.nextIndex = i1;
    res.name = t < 0.5 ? a.name : b.name;
    res.blend = t;
    res.nebulaGain = lerp(a.nebulaGain, b.nebulaGain, t);
    res.dustDepth = lerp(a.dustDepth, b.dustDepth, t);
    res.aurora = lerp(a.aurora, b.aurora, t);
    res.starBoost = lerp(a.starBoost, b.starBoost, t);
    res.milkyWay = lerp(a.milkyWay, b.milkyWay, t);
    res.coreWarmth = lerp(a.coreWarmth, b.coreWarmth, t);
    res.roadSheen = lerp(a.roadSheen, b.roadSheen, t);
    res.auroraHue = lerpHue(a.auroraHue, b.auroraHue, t);
    res.ionBoost = lerp(a.ionBoost ?? 1, b.ionBoost ?? 1, t);
    lerp3(a.skyShift, b.skyShift, t, res.skyShift);
    lerp3(a.warmAccent, b.warmAccent, t, res.warmAccent);
    lerp3(a.coolAccent, b.coolAccent, t, res.coolAccent);
    return res;
}
