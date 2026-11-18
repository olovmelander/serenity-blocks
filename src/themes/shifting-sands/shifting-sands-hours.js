// @ts-check

/**
 * Shifting Sands — the hours of the evening (CPU only, three-free).
 *
 * The dusk is one walk (0 golden hour → 1 night, world.dusk) with four stations along it, each a
 * picture of its own:
 *
 *   gold   golden hour: both suns up, the ember low over the erg, long warm light (the opening look)
 *   ember  the first sunset: the ember sun sinks onto the Rampart, only the crests still catch its
 *          red; the white sun, higher, is now the key and the shadows it leaves are violet
 *   blue   the second sunset: the ember is gone and has left a crimson afterglow, the white sun
 *          hangs gold on the horizon and lights the crest lines alone; first stars, the moons brighten
 *   night  both suns down: the two moons light the erg in silver from over the Sentinel (their own
 *          long shadows), the star river stands over the last violet of the afterglow
 *
 * Between stations every value melts in a straight line (scene-linear colours, degrees of
 * elevation), so the walk has no seams; world.duskAt() rests on each station for a while.
 *
 * Two lights are told apart on purpose: what a sun does to the LAND (sunLight*: zero once it has
 * set) and what it does to the AIR (glow*: the aureole, the rays, the undersides of the clouds
 * and the dust in the distance keep burning after it has gone below the horizon).
 */

/** sRGB hex × strength → scene-linear rgb. */
function lin(hex, k = 1) {
    const ch = (v) => {
        const c = v / 255;
        return (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * k;
    };
    return Object.freeze([ch((hex >> 16) & 255), ch((hex >> 8) & 255), ch(hex & 255)]);
}

/** The colours of a station (each scene-linear rgb, strength folded in). */
export const HOUR_COLOURS = Object.freeze([
    'sunLightA', 'sunLightB', 'glowA', 'glowB', 'zenith', 'upper', 'horizonWarm', 'horizonCool', 'moonLight',
]);
/**
 * The numbers of a station: each sun's elevation (degrees), how far the stars and the star river
 * have come out (0..1), how bright the moons' own discs are, the post's exposure, and how much of
 * a red ember the primary has become (0..1).
 */
export const HOUR_SCALARS = Object.freeze(['elA', 'elB', 'stars', 'moonGain', 'exposure', 'ember']);

export const HOURS = Object.freeze([
    Object.freeze({
        name: 'gold',
        sunLightA: lin(0xffa65a, 2.7),
        sunLightB: lin(0xffe4c8, 1.2),
        glowA: lin(0xffa65a, 2.7),
        glowB: lin(0xffe4c8, 1.2),
        zenith: lin(0x26407e, 0.3),
        upper: lin(0x6a6ea8, 0.4),
        horizonWarm: lin(0xffa865, 0.78),
        horizonCool: lin(0xc48d8c, 0.5),
        moonLight: lin(0x9db4ff, 0),
        elA: 4.6,
        elB: 11.2,
        stars: 0.12,
        moonGain: 0.78,
        exposure: 1,
        ember: 0,
    }),
    Object.freeze({
        name: 'ember',
        sunLightA: lin(0xff6c30, 2.1),
        sunLightB: lin(0xffcba2, 1.15),
        glowA: lin(0xff7436, 2.3),
        glowB: lin(0xffcba2, 1.1),
        zenith: lin(0x141d44, 0.22),
        upper: lin(0x4e3f78, 0.32),
        horizonWarm: lin(0xff8a4a, 0.95),
        horizonCool: lin(0x9a6276, 0.42),
        moonLight: lin(0x9db4ff, 0.02),
        elA: 1.7,
        elB: 7.2,
        stars: 0.3,
        moonGain: 1.1,
        exposure: 1,
        ember: 1,
    }),
    Object.freeze({
        name: 'blue',
        sunLightA: lin(0xff5a28, 0),
        sunLightB: lin(0xff9c58, 1.45),
        glowA: lin(0xff4c34, 1.25),
        glowB: lin(0xffa86a, 1.3),
        zenith: lin(0x0c1438, 0.2),
        upper: lin(0x2b2d6c, 0.3),
        horizonWarm: lin(0xe85c40, 0.72),
        horizonCool: lin(0x5c4c88, 0.36),
        moonLight: lin(0x93a8f4, 0.085),
        elA: -3.0,
        elB: 1.9,
        stars: 0.72,
        moonGain: 1.7,
        exposure: 1.06,
        ember: 1,
    }),
    Object.freeze({
        name: 'night',
        sunLightA: lin(0xff5a28, 0),
        sunLightB: lin(0xff9c58, 0),
        glowA: lin(0x8a3c9c, 0.5),
        glowB: lin(0x4c3c8c, 0.3),
        zenith: lin(0x060a22, 0.22),
        upper: lin(0x10183e, 0.26),
        horizonWarm: lin(0x4c2f70, 0.36),
        horizonCool: lin(0x1c2a58, 0.3),
        moonLight: lin(0x8fa6f2, 0.36),
        elA: -8,
        elB: -5,
        stars: 1,
        moonGain: 2.6,
        exposure: 1.1,
        ember: 1,
    }),
]);

/** The stops a leg of the walk has (golden hour → night): one fewer than the stations. */
export const HOUR_STOPS = HOURS.length - 1;

/**
 * A fresh look to write into: every colour an rgb triple, every scalar a number, and where the
 * walk stands (`from`, `to`: station indices; `melt`: 0..1 between them).
 */
export function makeHourLook() {
    /** @type {Record<string, any>} */
    const out = { from: 0, to: 0, melt: 0 };
    for (const key of HOUR_COLOURS) out[key] = [0, 0, 0];
    for (const key of HOUR_SCALARS) out[key] = 0;
    return out;
}

/**
 * The look at `dusk` (0 golden hour → 1 night), written into `out` (makeHourLook()).
 * On a station it is that station exactly.
 * @param {number} dusk
 * @param {Record<string, any>} [out]
 */
export function hourLook(dusk, out = makeHourLook()) {
    const x = Math.min(1, Math.max(0, Number.isFinite(dusk) ? dusk : 0)) * HOUR_STOPS;
    const from = Math.min(HOUR_STOPS - 1, Math.floor(x));
    const melt = x - from;
    const a = HOURS[from];
    const b = HOURS[from + 1];
    out.from = from;
    out.to = from + 1;
    out.melt = melt;
    for (let i = 0; i < HOUR_COLOURS.length; i++) {
        const key = HOUR_COLOURS[i];
        const ca = a[key];
        const cb = b[key];
        const rgb = out[key];
        rgb[0] = ca[0] + (cb[0] - ca[0]) * melt;
        rgb[1] = ca[1] + (cb[1] - ca[1]) * melt;
        rgb[2] = ca[2] + (cb[2] - ca[2]) * melt;
    }
    for (let i = 0; i < HOUR_SCALARS.length; i++) {
        const key = HOUR_SCALARS[i];
        out[key] = a[key] + (b[key] - a[key]) * melt;
    }
    return out;
}
