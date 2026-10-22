/**
 * The eclipse as geometry, with no renderer: where Earth's shadow lies on the moon at a given
 * time, what light that leaves on its face, and how the night is exposed for it.
 *
 * Lengths are lunar radii in the moon's own image plane (x right, y up, as the viewer sees it).
 * At the moon's distance Earth's umbra is about 2.7 lunar radii across its radius and the
 * penumbra about 4.65. The shadow's centre crosses below the moon's centre, so the lower limb
 * lies deepest and the upper limb glows copper.
 *
 * The cycle: totality first (the theme opens on a blood moon), then the shadow slides aside
 * until a white sliver of uneclipsed moon burns on one limb, back into totality, and out the
 * other way. Totality holds about two thirds of the time. The night is exposed for the moon
 * the way an eye or a camera would be: wide open in totality, so the red moon, the Milky Way
 * and the faint stars all read, and stopped down when the sliver appears, so the sliver blows
 * out white, the red face sinks and the stars fade. Every value is a pure function of time,
 * so a seek or a fixed-time capture lands on the same state.
 *
 * lunarLight() is written twice: here, and as TSL in blood-moon-world.js. Keep them equal
 * (tests/unit/blood-moon-eclipse.test.js checks the shape of this one).
 */

export const ECLIPSE = Object.freeze({
    umbra: 2.7,
    penumbra: 4.65,
    impact: -0.62,
    sweep: 2.2,
    period: 240,
});

/** Linear light per unit of full-moon sunlight (shared with the shader). */
export const LUNAR_COLOURS = Object.freeze({
    deep: [1, 0.07, 0.03],
    copper: [1, 0.3, 0.08],
    sunLow: [1, 0.55, 0.32],
    sun: [1, 0.97, 0.93],
    turquoise: [0.05, 0.62, 0.72],
});
const {
    deep: DEEP, copper: COPPER, sunLow: SUN_LOW, sun: SUN, turquoise: TURQUOISE,
} = LUNAR_COLOURS;

/** Exposure: wide open through totality, never stopped down further than this. */
export const EXPOSURE_FLOOR = 0.15;
/**
 * The luminance of the moon's mean light up to which the night stays wide open: the copper
 * rim of late totality still reads at full exposure; only the sliver stops it down.
 */
const EXPOSURE_KEY = 0.0024;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (low, high, value) => {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
};

/** Where the umbra's centre lies, relative to the moon's centre, at `time` seconds. */
export function eclipseOffset(time, out = { x: 0, y: 0 }) {
    const t = Number.isFinite(time) ? time : 0;
    const s = Math.sin((t * Math.PI * 2) / ECLIPSE.period);
    // s·|s| lingers near zero: totality holds while the shadow crosses slowest.
    out.x = s * Math.abs(s) * ECLIPSE.sweep;
    out.y = ECLIPSE.impact;
    return out;
}

/**
 * The light reaching a point of the moon's face that lies `s` lunar radii from the shadow's
 * axis: red light bent through Earth's atmosphere inside the umbra (deep at its heart, copper
 * at its rim), a thin turquoise fringe just outside it where ozone took the red, and the sun
 * itself returning across the penumbra, reddened where only its limb shows.
 */
export function lunarLight(s, out = [0, 0, 0]) {
    const { umbra, penumbra } = ECLIPSE;
    const u = clamp(s / umbra, 0, 1);
    const umbral = 0.0007 + 0.0125 * u * u;
    const hue = u * u;
    const f0 = clamp((s - umbra) / (penumbra - umbra), 0, 1);
    // The sun's visible share climbs at once from the umbra's edge: a defined, soft boundary.
    const f = Math.max(f0, 1e-6) ** 1.25;
    const sunMix = smooth(0, 0.3, f);
    const band = Math.exp(-(((s - umbra - 0.07) / 0.11) ** 2)) * 0.006;
    for (let i = 0; i < 3; i++) {
        const red = DEEP[i] + (COPPER[i] - DEEP[i]) * hue;
        const sun = SUN_LOW[i] + (SUN[i] - SUN_LOW[i]) * sunMix;
        out[i] = red * umbral + sun * f + TURQUOISE[i] * band;
    }
    return out;
}

// Sample points over the unit disc (a fixed grid, the same every frame).
const DISC = (() => {
    const points = [];
    const n = 9;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = ((i + 0.5) / n) * 2 - 1;
            const y = ((j + 0.5) / n) * 2 - 1;
            if (x * x + y * y <= 1) points.push(x, y);
        }
    }
    return Float32Array.from(points);
})();
const sample = [0, 0, 0];

/**
 * How far aside a perfect clear's diamond ring steps the shadow at most (lunar radii): a sliver
 * of sun burns on the limb and the night stops down to about half, then the moon slides back.
 */
export const DIAMOND_REACH = 1.88;

/**
 * The whole eclipse at `time`: the shadow's offset, the moon's mean light (rgb and luminance),
 * how much of the face lies in the umbra, and the exposure the night takes for it. `nudge`
 * (lunar radii, ≥ 0) steps the shadow further aside for a moment — the diamond ring — but never
 * past DIAMOND_REACH, nor back from where the cycle already has it.
 */
export function sampleEclipse(time, out = {}, nudge = 0) {
    const offset = eclipseOffset(time, out.offset || (out.offset = { x: 0, y: 0 }));
    if (nudge > 0 && Number.isFinite(nudge)) {
        const side = offset.x < 0 ? -1 : 1;
        const along = Math.abs(offset.x);
        offset.x = side * Math.max(along, Math.min(DIAMOND_REACH, along + nudge));
    }
    const light = out.light || (out.light = [0, 0, 0]);
    light[0] = 0; light[1] = 0; light[2] = 0;
    let inUmbra = 0;
    const count = DISC.length / 2;
    for (let k = 0; k < DISC.length; k += 2) {
        const s = Math.hypot(DISC[k] - offset.x, DISC[k + 1] - offset.y);
        lunarLight(s, sample);
        light[0] += sample[0]; light[1] += sample[1]; light[2] += sample[2];
        if (s < ECLIPSE.umbra) inUmbra += 1;
    }
    light[0] /= count; light[1] /= count; light[2] /= count;
    out.luminance = light[0] * 0.2126 + light[1] * 0.7152 + light[2] * 0.0722;
    out.totality = inUmbra / count;
    // A partial stop-down: the sliver still blows out, the red face still reads.
    out.exposure = clamp((EXPOSURE_KEY / Math.max(out.luminance, 1e-6)) ** 0.85, EXPOSURE_FLOOR, 1);
    return out;
}
