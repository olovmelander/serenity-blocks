/**
 * Verdant Hills — the rainbow's colours (three-free).
 *
 * A table of what a curtain of rain sends back toward the eye at each angle from the point
 * opposite the sun: the primary bow (red outermost, at about 42°), the paler secondary outside it
 * (51°, its colours the other way round), the sky a little brighter inside the primary and a
 * little darker between the two.
 *
 * Each colour of the spectrum has its own bow angle (water bends blue more than red), and at
 * that angle its light piles up against an edge and falls away toward the inside. The table adds
 * sixteen wavelengths, each weighted by how the eye sees it, so where red and green overlap the
 * bow has its orange and its yellow (three wavelengths give three stripes), and each is smeared
 * by the width of the sun's disc. A white sun gives a white glow inside the bow.
 *
 * Plain numbers: the mesh (verdant-hills-rainbow.js), the tests and a capture share it.
 */

/** The angles the table covers, degrees from the point opposite the sun. */
export const VERDANT_HILLS_BOW_RANGE = Object.freeze([34, 58]);
/** Texels across the table. */
export const VERDANT_HILLS_BOW_WIDTH = 256;
/** How bright the secondary's edge is against the primary's, and the glow inside the primary. */
const SECONDARY = 0.4;
const INSIDE = 0.085;
/** How much darker the sky stands between the two bows (the table's alpha there). */
const BETWEEN = 0.16;
/** The sun's disc and the spread of the drops, as one smear (degrees, a Gaussian's sigma). */
const SMEAR = 0.36;
const WAVELENGTHS = 16;
const DEG = Math.PI / 180;

/** Water's index at a wavelength (nm): Cauchy's fit, 1.3335 at 550 nm. */
const waterIndex = (nm) => 1.3227 + 3501 / (nm * nm);

/** One lobe of Wyman, Sloan and Shirley's fit to the CIE 1931 observer. */
const lobe = (nm, mu, below, above) => {
    const t = (nm - mu) / (nm < mu ? below : above);
    return Math.exp(-0.5 * t * t);
};

/** The wavelengths the bow is added over, each with its weight in linear sRGB (each channel's sum to one). */
function spectrum() {
    const rows = [];
    for (let i = 0; i < WAVELENGTHS; i += 1) {
        const nm = 400 + (300 * (i + 0.5)) / WAVELENGTHS;
        const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7)
            - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
        const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
        const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
        rows.push({
            nm,
            weight: [
                3.2406 * x - 1.5372 * y - 0.4986 * z,
                -0.9689 * x + 1.8758 * y + 0.0415 * z,
                0.0557 * x - 0.204 * y + 1.057 * z,
            ],
        });
    }
    for (let c = 0; c < 3; c += 1) {
        const sum = rows.reduce((total, row) => total + row.weight[c], 0);
        rows.forEach((row) => {
            // eslint-disable-next-line no-param-reassign
            row.weight[c] /= sum;
        });
    }
    return rows;
}

/**
 * The angle of the bow of light that leaves a drop after `reflections` turns inside it (1 the
 * primary, 2 the secondary), in degrees from the point opposite the sun, for water of index `n`.
 * @param {number} n
 * @param {number} reflections
 */
export function verdantHillsBowAngle(n, reflections) {
    const k = reflections;
    const incidence = Math.acos(Math.sqrt((n * n - 1) / (k * (k + 2))));
    const refraction = Math.asin(Math.sin(incidence) / n);
    const deviation = 2 * (incidence - refraction) + k * (Math.PI - 2 * refraction);
    return Math.abs(deviation - Math.PI) / DEG;
}

/**
 * How brightly one colour's bow stands `inside` degrees in from its own edge (negative: outside
 * it, where there is none): the light piles up against the edge and falls away within a degree
 * or two (the faint glow that is left further in is added once, for all colours together, in the
 * bake). Smeared by the sun's disc, so the edge is soft.
 */
function edge(inside) {
    let sum = 0;
    let weights = 0;
    // The pile at the edge is an inverse square root: finite once the sun's disc has smeared it.
    for (let tap = -8; tap <= 8; tap += 1) {
        const offset = (tap / 8) * 2.5 * SMEAR;
        const weight = Math.exp(-0.5 * (offset / SMEAR) ** 2);
        const d = inside + offset;
        sum += weight * (d > 0 ? Math.exp(-d / 0.85) / Math.sqrt(d + 0.12) : 0);
        weights += weight;
    }
    return sum / weights;
}

/**
 * The table: `width` texels of RGBA floats over VERDANT_HILLS_BOW_RANGE. RGB is the light the
 * bow adds (the primary's brightest texel is about 1), alpha how much of the sky behind it the
 * dark band between the bows takes away.
 * @param {number} [width]
 */
export function bakeVerdantHillsBow(width = VERDANT_HILLS_BOW_WIDTH) {
    const [from, to] = VERDANT_HILLS_BOW_RANGE;
    const out = new Float32Array(width * 4);
    const bands = spectrum().map(({ nm, weight }) => ({
        weight,
        primary: verdantHillsBowAngle(waterIndex(nm), 1),
        secondary: verdantHillsBowAngle(waterIndex(nm), 2),
    }));
    // What the pile at an edge reads at its brightest, so the primary's peak can be set to one.
    let top = 0;
    for (let d = -1; d <= 1; d += 0.01) top = Math.max(top, edge(d));
    const inner = Math.min(...bands.map((band) => band.primary));
    const outer = Math.max(...bands.map((band) => band.secondary));
    let peak = 0;
    for (let i = 0; i < width; i += 1) {
        const angle = from + ((to - from) * (i + 0.5)) / width;
        for (const band of bands) {
            // The primary is lit inside its edge, the secondary outside its own.
            const first = edge(band.primary - angle) / top;
            const second = (edge(angle - band.secondary) / top) * SECONDARY;
            for (let c = 0; c < 3; c += 1) out[i * 4 + c] += band.weight[c] * (first + second);
        }
        for (let c = 0; c < 3; c += 1) peak = Math.max(peak, out[i * 4 + c]);
    }
    for (let i = 0; i < width; i += 1) {
        const angle = from + ((to - from) * (i + 0.5)) / width;
        // The glow inside the primary: the pile's long tail, lifted a little and fading inward.
        const within = Math.max(0, Math.min(1, (inner - angle) / 6));
        const glow = angle < inner ? INSIDE * (1 - within) ** 1.5 : 0;
        for (let c = 0; c < 3; c += 1) {
            // Out-of-gamut colours leave small negative lobes: clamped.
            out[i * 4 + c] = Math.max(0, out[i * 4 + c] / peak) + glow;
        }
        // Between the bows no drop sends light back at all: the sky there is darker.
        const band = Math.max(0, Math.min(1, (angle - inner - 2.2) / 1.2))
            * Math.max(0, Math.min(1, (outer - 3.2 - angle) / 1.2));
        out[i * 4 + 3] = BETWEEN * band;
    }
    return out;
}
