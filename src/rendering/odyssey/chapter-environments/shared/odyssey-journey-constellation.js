// @ts-check
/**
 * @fileoverview THE JOURNEY IN THE SKY (2026-11-01): the ending of the journey, three-free.
 *
 * At the journey's end (orb 60, the end of the rail) the city's lights die down and the smog parts,
 * and the whole journey is drawn in the sky above it: one star for every orb, in its chapter's
 * colour, joined in the order they were played, the line drawing itself from the first orb to the
 * last as the eye arrives. An orb the player has finished shines (brighter for more stars); one not
 * yet finished is a faint point the line passes on its way. Before the campaign is done the figure
 * is the player's progress written over the finale; once it is done it is the whole journey.
 *
 * The figure is the path's own shape: the orbs' world positions seen from the side that shows the
 * path widest (its horizontal principal axis), height kept as height. The journey climbs ~1,500 u
 * from the Earth's core to the city, so it reads as an ascent, as the campaign finale's sheet
 * draws it (src/ui/odyssey/CampaignFinale.js).
 *
 * This module plans the figure and its drawing; odyssey-journey-constellation.tsl.js draws it and
 * urban-dreams.js seats it in the city's sky.
 */

export const JOURNEY_CONSTELLATION = Object.freeze({
    // Seated in the strip of sky the eye sees from orb 60: it looks ~9 deg up and ~15 deg left of
    // the canyon on a 70 deg lens, and between the towers the sky runs from ~23 deg left of the
    // canyon to ~12 right, up to the frame's top at ~44 deg; the spire's needle stands in it to ~42.
    // With every orb done the eye lifts a little more (OdysseyCameraController JOURNEY_END_LOOK).
    /** The figure's foot (the first orb) and top (the last) above the city's horizon, degrees. */
    elevation: Object.freeze([15, 39]),
    /** Its centre, degrees right of the canyon's axis (negative: left). */
    azimuth: -6,
    /** The widest it may be, degrees: a wider figure is squeezed across, never in height. */
    maxWidth: 24,
    /** Seconds the line takes to draw itself from the first orb to the last. */
    drawSeconds: 8,
    /** journeyEnd at which the drawing starts, and below which it is taken back for next time. */
    arrive: 0.82,
    reset: 0.25,
    /** Light of an orb not yet finished, of a finished one's. */
    unfinished: 0.14,
    /** Light of a finished orb by its stars (0..3). */
    byStars: Object.freeze([0.62, 0.74, 0.87, 1.0]),
});

/**
 * Lay the orbs out as a figure: x in degrees about the figure's centre (+ right), y in [0, 1] from
 * the lowest orb to the highest. The horizontal axis is the path's principal one, signed so the
 * first orb lies on the left; x keeps the scale of y (degrees per unit of height) unless the figure
 * would be wider than `maxWidth`.
 * @param {ReadonlyArray<{ x: number, y: number, z: number }>} points world positions, journey order
 * @param {typeof JOURNEY_CONSTELLATION} [spec]
 * @returns {{ x: Float32Array, y: Float32Array, count: number }}
 */
export function planJourneyConstellation(points, spec = JOURNEY_CONSTELLATION) {
    const count = points.length;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    if (count === 0) return { x, y, count };
    let mx = 0;
    let mz = 0;
    let low = Infinity;
    let high = -Infinity;
    points.forEach((p) => {
        mx += p.x / count;
        mz += p.z / count;
        low = Math.min(low, p.y);
        high = Math.max(high, p.y);
    });
    // The horizontal principal axis: the eigenvector of the xz covariance with the larger eigenvalue.
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    points.forEach((p) => {
        const dx = p.x - mx;
        const dz = p.z - mz;
        sxx += dx * dx;
        sxz += dx * dz;
        szz += dz * dz;
    });
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    let ax = Math.cos(angle);
    let az = Math.sin(angle);
    const along = (p) => ((p.x - mx) * ax) + ((p.z - mz) * az);
    // Signed so the journey starts on the left and climbs to the right.
    if (along(points[0]) > along(points[count - 1])) {
        ax = -ax;
        az = -az;
    }
    const height = Math.max(high - low, 1e-6);
    const span = spec.elevation[1] - spec.elevation[0];
    let left = Infinity;
    let right = -Infinity;
    points.forEach((p) => {
        const a = along(p);
        left = Math.min(left, a);
        right = Math.max(right, a);
    });
    const degPerUnit = span / height;
    const width = (right - left) * degPerUnit;
    const squeeze = width > spec.maxWidth ? spec.maxWidth / width : 1;
    const centre = (left + right) / 2;
    points.forEach((p, i) => {
        x[i] = (along(p) - centre) * degPerUnit * squeeze;
        y[i] = (p.y - low) / height;
    });
    return { x, y, count };
}

/**
 * A star's direction in the city's stage frame (+X right, +Y up, -Z down the canyon) for a point
 * of the figure. Elevation and azimuth on the sky, not a flat projection, so the figure keeps its
 * shape wherever it is seated.
 * @param {number} xDeg degrees about the centre (from planJourneyConstellation)
 * @param {number} y01 0..1 foot to top
 * @param {typeof JOURNEY_CONSTELLATION} [spec]
 * @param {number[]} [out]
 * @returns {number[]} [x, y, z], unit length
 */
export function journeyStarDirection(xDeg, y01, spec = JOURNEY_CONSTELLATION, out = [0, 0, 0]) {
    const toRad = Math.PI / 180;
    const el = (spec.elevation[0] + (y01 * (spec.elevation[1] - spec.elevation[0]))) * toRad;
    const az = (spec.azimuth + xDeg) * toRad;
    out[0] = Math.sin(az) * Math.cos(el);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(az) * Math.cos(el);
    return out;
}

/**
 * How bright an orb's star is, from its progress.
 * @param {{ completed?: boolean, stars?: number } | null | undefined} orb
 * @param {typeof JOURNEY_CONSTELLATION} [spec]
 */
export function journeyStarLight(orb, spec = JOURNEY_CONSTELLATION) {
    if (!orb?.completed) return spec.unfinished;
    const stars = Math.max(0, Math.min(3, Math.round(Number(orb.stars) || 0)));
    return spec.byStars[stars];
}

/**
 * The drawing's progress, 0 (nothing) to 1 (the line has reached the last orb): it runs while the
 * eye is at the journey's end and is taken back once the eye has left, so every arrival draws it
 * again. Reduced motion shows it whole at once.
 * @param {{ drawn: number }} state carried between frames
 * @param {number} journeyEnd 0..1 (ChapterEnvironmentManager's ramp over the final chapter's end)
 * @param {number} dt seconds
 * @param {{ reducedMotion?: boolean }} [options]
 * @param {typeof JOURNEY_CONSTELLATION} [spec]
 * @returns {number}
 */
export function advanceJourneyDrawing(
    state,
    journeyEnd,
    dt,
    { reducedMotion = false } = {},
    spec = JOURNEY_CONSTELLATION,
) {
    const end = Number.isFinite(journeyEnd) ? journeyEnd : 0;
    if (end < spec.reset) state.drawn = 0;
    else if (end >= spec.arrive) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        state.drawn = reducedMotion ? 1 : Math.min(1, state.drawn + (step / spec.drawSeconds));
    }
    return state.drawn;
}
