// @ts-check
/**
 * @fileoverview THE PATH FLOWS INTO THE HOLE (2026-10-23).
 *
 * Olov: "now it feels like the orb path just quits before we go into the black hole, i want this
 * to be a seamless experience, almost like as the black hole is a huge black hole orb on the path
 * that we gets sucked in to."
 *
 * Through chapter 6 the rail ends at chapter 7's first orb, the mouth (odyssey-path-horizon.js),
 * and the hole hangs ~900 u ahead of the eye (camera-locked from the 6->7 hand-over). The two only
 * met on screen from chapter 6's last orbs: on the glide on into the plunge
 * (odyssey-black-hole-fall.js) the mouth orb slid to the bottom of the frame while the hole held
 * the centre and grew, and the rail stopped in empty space below it.
 *
 * The INFLOW is the rail's last reach. From the mouth orb a stream of the rail's light winds into
 * the hole's centre, rebuilt every frame from where the orb and the hole really are, so it stays
 * attached whatever the camera, the hole or a free look does. It leaves the orb along the rail,
 * then spirals in the way the disk turns (counter-clockwise on screen), closing on the centre as
 * it recedes. Every point of it is nearer the eye than the shadow's near surface, so it draws over
 * the shadow into the middle of the disc while the disk band, the orbs and the rail still occlude
 * it by depth. It hands over to the real rail inside the hole, as the way on is laid out.
 *
 * Pure: no three.js (vectors are anything with x, y, z).
 */
import { getChapterTransitionForChapter } from './chapter-environments/shared/chapter-profile.js';
import { resolveOdysseyPathReveal } from './odyssey-path-horizon.js';

export const ODYSSEY_PATH_INFLOW = Object.freeze({
    /** Centre-line points (a strip of two vertices each). */
    segments: 128,
    /** A LOGARITHMIC spiral on screen, counter-clockwise (the disk's sense): it turns `pitch`
     * radians for every e-fold it closes, so it bends gently on the way to the hole and swirls
     * into the centre, and anything moving along it at an even pace slows as it nears the
     * centre (the frozen-at-the-horizon look). */
    pitch: 0.42,
    /** It ends this share of the shadow's radius from the centre. */
    endRadius: 0.02,
    /** The first `leave` of the stream follows the rail out of the orb... */
    leave: 0.05,
    /** ...for this share of the orb's depth ahead of the eye. */
    railReach: 0.2,
    /** Depth runs geometrically from the orb to the far end, on s^depthBias. */
    depthBias: 0.75,
    /** The far end sits at this share of the shadow's near-surface distance (in front of it). */
    nearMargin: 0.94,
    /** Core radius at the orb (world u): a little over the rail's own (outerRadius 0.4)... */
    coreRadius: 0.55,
    /** ...thinning to this share of it at the far end... */
    coreTail: 0.4,
    /** ...never under this share of the frame height (~1.1 px of radius at 720p). */
    coreFloor: 0.0015,
    /** Strip half-width over core radius: the glow around the core. */
    glow: 4.0,
    /** Fades in over this much progress once the rail ends at the mouth. */
    fadeIn: 0.006,
    /** Fades out as the orb comes this near the eye's plane (u, along the view axis). */
    nearFrom: 16,
    nearTo: 6,
    /** Fades out as the orb nears the hole's own surface (the rail runs into it by itself). */
    farFrom: 0.55,
    farTo: 0.85,
});

function smooth01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
}

/**
 * How much of the inflow is drawn for the eye at `progress`: from just after the rail comes to
 * end at the mouth (the 5->6 seam) until the way on is laid out inside the hole, where it hands
 * over to the real rail.
 * @param {number} progress camera path progress
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @param {number[]|null} [levelPositions] the layout's node positions
 * @returns {number} 0..1
 */
export function resolveOdysseyPathInflowWeight(progress, chapterPositions, levelPositions = null) {
    const ch6Start = chapterPositions?.[5];
    const mouth = chapterPositions?.[6];
    if (!Number.isFinite(progress) || !Number.isFinite(ch6Start) || !Number.isFinite(mouth)) return 0;
    const wIn = getChapterTransitionForChapter(5)?.seamWidth ?? 0.0222;
    // The rail has retracted to the mouth by the end of the 5->6 seam.
    const from = ch6Start + wIn;
    const reveal = resolveOdysseyPathReveal(chapterPositions, levelPositions);
    if (!reveal || progress <= from || progress >= reveal.end) return 0;
    const fadeIn = smooth01((progress - from) / ODYSSEY_PATH_INFLOW.fadeIn);
    const handOver = 1 - smooth01((progress - reveal.start) / Math.max(1e-6, reveal.end - reveal.start));
    return fadeIn * handOver;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
const cross = (a, b) => ({
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
});
const len = (a) => Math.hypot(a.x, a.y, a.z);
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const norm = (a) => scale(a, 1 / Math.max(1e-9, len(a)));

/**
 * @typedef {{ x: number, y: number, z: number }} Vec
 * @typedef {object} InflowInput
 * @property {Vec} eye camera position
 * @property {Vec} right camera screen-right (world)
 * @property {number} tanHalfFov tan(vertical fov / 2)
 * @property {Vec} centre the hole's centre (world)
 * @property {number} radius the hole's shadow radius (world)
 * @property {Vec} start the mouth orb's rail point (world)
 * @property {Vec} tangent the rail's direction there (unit, the way the journey goes)
 *
 * @typedef {object} InflowStream
 * @property {Float32Array} points centre line, 3 per point (world)
 * @property {Float32Array} halfWidth strip half-width per point (world)
 * @property {Float32Array} t along the stream, 0 at the orb .. 1 at the far end
 * @property {Float32Array} rim 0..1: where the stream crosses the shadow's edge (the photon ring)
 * @property {Float32Array} inner 0..1: how far inside the shadow's disc, toward its centre
 * @property {number} visibility 0..1: the stream's own fade (the orb too near the eye's plane or
 *   already at the hole's surface)
 */

/**
 * Scratch buffers for one stream.
 * @param {number} [segments]
 * @returns {InflowStream}
 */
export function createOdysseyPathInflowStream(segments = ODYSSEY_PATH_INFLOW.segments) {
    return {
        points: new Float32Array(segments * 3),
        halfWidth: new Float32Array(segments),
        t: new Float32Array(segments),
        rim: new Float32Array(segments),
        inner: new Float32Array(segments),
        visibility: 0,
    };
}

/**
 * Lay the stream from the mouth orb into the hole's centre, for this frame's eye and hole.
 * @param {InflowInput} input
 * @param {InflowStream} out
 * @returns {boolean} false when there is nothing to draw (`out.visibility` is 0)
 */
export function buildOdysseyPathInflow(input, out) {
    const F = ODYSSEY_PATH_INFLOW;
    out.visibility = 0;
    const {
        eye, right, tanHalfFov, centre, radius, start, tangent,
    } = input;
    const toCentre = sub(centre, eye);
    const d = len(toCentre);
    if (!(d > radius) || !(radius > 0)) return false;
    const axis = scale(toCentre, 1 / d);
    // The screen basis about the hole's axis: e1 to the right, e2 up.
    let e1 = sub(right, scale(axis, dot(right, axis)));
    if (len(e1) < 1e-6) e1 = cross(axis, { x: 0, y: 1, z: 0 });
    e1 = norm(e1);
    const e2 = cross(e1, axis);
    const q = sub(start, eye);
    const z0 = dot(q, axis);
    const zNear = d - radius;
    const zEnd = F.nearMargin * zNear;
    const visibility = smooth01((z0 - F.nearTo) / (F.nearFrom - F.nearTo))
        * (1 - smooth01(((z0 / zNear) - F.farFrom) / (F.farTo - F.farFrom)));
    if (!(visibility > 1e-3) || !(z0 > 0) || zEnd <= z0) return false;
    // The orb as seen from the eye: angle off the axis (as a tangent) and its bearing.
    const x0 = dot(q, e1) / z0;
    const y0 = dot(q, e2) / z0;
    const rho0 = Math.hypot(x0, y0);
    const phi0 = Math.atan2(y0, x0);
    const alpha = Math.asin(Math.min(1, radius / d));
    const rimWidth = 0.012 + (0.035 * alpha);
    // It follows the rail out of the orb only as far as the rail heads for the hole on screen:
    // where the rail turns away (inside the plunge) it leaves straight into the spiral.
    const tz = dot(tangent, axis);
    const toward = rho0 > 1e-6
        ? -(((dot(tangent, e1) - (x0 * tz)) * x0) + ((dot(tangent, e2) - (y0 * tz)) * y0))
            / (rho0 * Math.max(1e-6, Math.hypot(dot(tangent, e1) - (x0 * tz), dot(tangent, e2) - (y0 * tz))))
        : 0;
    const reach = F.railReach * z0 * Math.max(0, toward);
    // The spiral closes from the orb's bearing to endRadius of the shadow (as tangents).
    const rhoEnd = Math.max(1e-6, Math.min(rho0, Math.tan(alpha)) * F.endRadius);
    const folds = Math.log(Math.max(rho0, rhoEnd * 1.0001) / rhoEnd);
    const n = out.t.length;
    const tail = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i += 1) {
        const s = i / (n - 1);
        // The spiral, in the hole's frame.
        const z = z0 * ((zEnd / z0) ** (s ** F.depthBias));
        const rho = rho0 * Math.exp(-folds * s);
        const phi = phi0 + (F.pitch * folds * s);
        const lateral = rho * z;
        const sx = eye.x + (axis.x * z) + (((e1.x * Math.cos(phi)) + (e2.x * Math.sin(phi))) * lateral);
        const sy = eye.y + (axis.y * z) + (((e1.y * Math.cos(phi)) + (e2.y * Math.sin(phi))) * lateral);
        const sz = eye.z + (axis.z * z) + (((e1.z * Math.cos(phi)) + (e2.z * Math.sin(phi))) * lateral);
        // Out of the orb along the rail, then into the spiral.
        const b = smooth01(s / F.leave);
        const r = s * (reach / F.leave);
        tail.x = start.x + (tangent.x * r);
        tail.y = start.y + (tangent.y * r);
        tail.z = start.z + (tangent.z * r);
        const px = tail.x + ((sx - tail.x) * b);
        const py = tail.y + ((sy - tail.y) * b);
        const pz = tail.z + ((sz - tail.z) * b);
        out.points[(i * 3)] = px;
        out.points[(i * 3) + 1] = py;
        out.points[(i * 3) + 2] = pz;
        const rx = px - eye.x;
        const ry = py - eye.y;
        const rz = pz - eye.z;
        const dist = Math.hypot(rx, ry, rz);
        const core = Math.max(
            F.coreRadius * (1 - ((1 - F.coreTail) * s)),
            F.coreFloor * 2 * tanHalfFov * dist,
        );
        out.halfWidth[i] = core * F.glow;
        out.t[i] = s;
        const theta = Math.acos(Math.min(1, Math.max(-1, ((rx * axis.x) + (ry * axis.y) + (rz * axis.z)) / dist)));
        out.rim[i] = Math.exp(-(((theta - alpha) / rimWidth) ** 2));
        out.inner[i] = Math.min(1, Math.max(0, (alpha - theta) / alpha));
    }
    out.visibility = visibility;
    return true;
}

/**
 * Write the stream as a camera-facing strip: two vertices per point, `side` across the view.
 * @param {InflowStream} stream
 * @param {Vec} eye camera position
 * @param {Float32Array} positions 6 per point (xyz, xyz)
 * @param {Float32Array} attributes 8 per point (t, rim, inner, across) x 2
 */
export function writeOdysseyPathInflowStrip(stream, eye, positions, attributes) {
    const { points, halfWidth } = stream;
    const n = stream.t.length;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let have = false;
    for (let i = 0; i < n; i += 1) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const tx = points[(b * 3)] - points[(a * 3)];
        const ty = points[(b * 3) + 1] - points[(a * 3) + 1];
        const tz = points[(b * 3) + 2] - points[(a * 3) + 2];
        const px = points[(i * 3)];
        const py = points[(i * 3) + 1];
        const pz = points[(i * 3) + 2];
        const vx = px - eye.x;
        const vy = py - eye.y;
        const vz = pz - eye.z;
        // Across the stream as seen: tangent x view. Where the stream heads straight into the
        // screen that is degenerate, so the last good side is kept (and never flips over).
        let cx = (ty * vz) - (tz * vy);
        let cy = (tz * vx) - (tx * vz);
        let cz = (tx * vy) - (ty * vx);
        const cl = Math.hypot(cx, cy, cz);
        if (cl > 1e-6 * Math.hypot(tx, ty, tz) * Math.hypot(vx, vy, vz)) {
            cx /= cl;
            cy /= cl;
            cz /= cl;
            if (have && ((cx * sx) + (cy * sy) + (cz * sz)) < 0) {
                cx = -cx;
                cy = -cy;
                cz = -cz;
            }
            sx = cx;
            sy = cy;
            sz = cz;
            have = true;
        }
        // Written in place: this runs every frame the inflow is drawn.
        const w = halfWidth[i];
        const o = i * 6;
        positions[o] = px - (sx * w);
        positions[o + 1] = py - (sy * w);
        positions[o + 2] = pz - (sz * w);
        positions[o + 3] = px + (sx * w);
        positions[o + 4] = py + (sy * w);
        positions[o + 5] = pz + (sz * w);
        const at = i * 8;
        attributes[at] = stream.t[i];
        attributes[at + 1] = stream.rim[i];
        attributes[at + 2] = stream.inner[i];
        attributes[at + 3] = -1;
        attributes[at + 4] = stream.t[i];
        attributes[at + 5] = stream.rim[i];
        attributes[at + 6] = stream.inner[i];
        attributes[at + 7] = 1;
    }
}
