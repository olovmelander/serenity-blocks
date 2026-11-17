/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE CLOSING SKY — what the eye sees between the horizon and the fold (masterpiece pass,
 * 2026-11-17).
 *
 * Past the horizon the hole's window used to show a warp tunnel: radial streaks out of a white
 * light, the one picture of the dive that could have been any game's hyperspace. Inside a black
 * hole the light of everything outside is still falling in after the traveller, bent round until
 * the whole sky is one ring; so that is what is here now. The sky the journey came through (its
 * stars drawn out into arcs along the ring, the Milky Way's violet on one side of it, the disk's
 * amber on the other, a razor of gold on its inner edge) comes in from the frame's edges as ONE
 * RING OF STARLIGHT and closes on the middle of the view, winding faster and bluer as it
 * tightens, over the dark the eye is falling into. Where it closes to a point the fold opens
 * (the crossing's wave runs out from the same point), so the last of the old sky turns inside out
 * into the first room.
 *
 * A function of the view ray in the hole's frame, the ring's radius (`ring`, radians: the fall's
 * schedule) and the clock. No screen derivative: the razor's width comes from the pixel's angle.
 */
import {
    abs, atan, clamp, cos, exp, float, length, log, max, mix, sin, smoothstep, step, vec3,
} from 'three/tsl';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';

export const CH7_CLOSING_SKY = Object.freeze({
    /** The ring's radius (rad) before it closes: past the frame's far corner. */
    open: 1.12,
    /** Its width (rad) wide open, and nearly closed. */
    widthOpen: 0.13,
    widthClosed: 0.03,
    /** How far the sky's image winds round as the ring closes (rad), and its own slow turn (rad/s). */
    wind: 4.2,
    turn: 0.05,
    /** Where round the ring the Milky Way and the disk's light sit (rad), on opposite sides. */
    galaxyAt: 2.5,
    diskAt: -0.5,
});

const N = latticeNoise3;
const sq = (x) => x.mul(x);

/**
 * The closing sky's colour for one view ray (linear; call inside a Fn).
 * @param {object} o
 * @param {*} o.ray the view ray in the hole's frame (+Z toward the eye)
 * @param {*} o.time seconds (times 0 under reduced motion: the caller's)
 * @param {*} o.phase the tunnel's travel (the warp drive's, held once the fold begins)
 * @param {*} o.ring the ring's radius, radians
 * @param {*} o.pix one pixel's angle, radians
 * @returns {*} vec3 node
 */
export function closingSkyColour({
    ray, time, phase, ring, pix,
}) {
    const V = CH7_CLOSING_SKY;
    const sinT = max(length(ray.xy), 1e-4).toVar();
    const theta = atan(sinT, max(ray.z.negate(), 1e-4)).toVar();
    const closed = float(1).sub(clamp(ring.div(V.open), 0.0, 1.0)).toVar();
    const width = mix(float(V.widthOpen), float(V.widthClosed), closed).toVar();
    // Across the ring: 0 on its line, positive outward.
    const x = theta.sub(ring).div(width).toVar();
    // Round the ring: the sky's image winds as the ring tightens (the inner lanes a little ahead).
    const wind = closed.mul(V.wind).add(time.mul(V.turn)).mul(float(1).sub(clamp(x, -2.0, 4.0).mul(0.06))).toVar();
    const cw = cos(wind);
    const sw = sin(wind);
    const cphi = ray.x.div(sinT).mul(cw).sub(ray.y.div(sinT).mul(sw)).toVar();
    const sphi = ray.y.div(sinT).mul(cw).add(ray.x.div(sinT).mul(sw)).toVar();
    // Stars drawn out along the ring: long arcs, and a finer set between them.
    const arcs = smoothstep(0.64, 0.86, N(vec3(cphi.mul(4.6), sphi.mul(4.6), x.mul(9.5).add(11.0)))).toVar();
    const fine = smoothstep(0.68, 0.90, N(vec3(cphi.mul(11.0), sphi.mul(11.0), x.mul(24.0).add(3.0)))).toVar();
    // The band: sharp against the dark inside it, trailing off outward.
    const band = exp(sq(x).mul(mix(float(0.42), float(3.2), step(x, 0.0))).negate()).toVar();
    const galaxy = sq(sq(clamp(cphi.mul(Math.cos(V.galaxyAt)).add(sphi.mul(Math.sin(V.galaxyAt))), 0.0, 1.0))).toVar();
    const disk = sq(sq(clamp(cphi.mul(Math.cos(V.diskAt)).add(sphi.mul(Math.sin(V.diskAt))), 0.0, 1.0))).toVar();
    const cloud = N(vec3(cphi.mul(2.6), sphi.mul(2.6), x.mul(1.4).add(5.0))).toVar();
    // The starlight goes from warm white to blue-white as the ring tightens (it is falling in faster).
    const starCol = mix(vec3(1.0, 0.86, 0.70), vec3(0.72, 0.84, 1.0), closed);
    const gain = closed.mul(0.8).add(0.42);
    const fromRazor = abs(x.add(0.62)).mul(width);
    const razor = float(1).sub(smoothstep(pix.mul(1.2), pix.mul(3.2).add(width.mul(0.05)), fromRazor));
    const sky = starCol.mul(arcs.mul(0.8).add(fine.mul(0.6)))
        .add(vec3(0.30, 0.20, 0.85).mul(galaxy).mul(cloud.mul(0.8).add(0.2)).mul(0.5))
        .add(vec3(1.0, 0.52, 0.16).mul(disk).mul(cloud.mul(0.5).add(0.5)).mul(0.7))
        .mul(band)
        .mul(gain)
        .add(mix(vec3(1.0, 0.80, 0.50), vec3(1.0, 0.95, 0.88), disk).mul(razor).mul(disk.mul(0.9).add(0.5)).mul(gain));
    // Outside it, what has already passed: the same arcs again, fainter and redder, dying away.
    const after = arcs.mul(exp(max(x.sub(1.5), 0.0).mul(-0.32))).mul(smoothstep(1.2, 2.4, x)).mul(0.10);
    // Inside it the dark the eye is falling into: never dead black, a deep violet stirring slowly.
    const deep = N(vec3(cphi.mul(1.4), sphi.mul(1.4), log(theta.add(0.03)).mul(1.3).sub(phase.mul(0.05))));
    const abyss = vec3(0.0035, 0.0018, 0.0090)
        .add(vec3(0.020, 0.006, 0.050).mul(smoothstep(0.45, 0.85, deep)).mul(smoothstep(0.02, 0.25, theta)));
    return sky.add(vec3(0.80, 0.26, 0.20).mul(after)).add(abyss);
}

export default closingSkyColour;
