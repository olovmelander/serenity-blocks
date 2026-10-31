/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * SEEN THROUGH THE SURFACE (2026-10-31) — the ocean's life stays until the climb has passed it.
 *
 * Olov: "We need to fix the pop away of the manta and fishes also, the fishes pops away right in
 * front of the camera, we need to wait until we have moved past them across the surface of the
 * sea." The manta glides ~7 u under the surface ahead of orb 10, and the fish wheel 11-19 u down.
 * Both were switched off by the eye's depth: the animals at `submerged > 0.5` (the eye still ~5 u
 * under), the fish the instant the eye left the water. And the sea is opaque from above, so even
 * kept on they would vanish behind it at the breach.
 *
 * Now an animal under the surface, seen by an eye above it, shows through the water the way it
 * does in clear sea: the surface reflects a share of the light (the sea's OWN reflectance, the
 * world's `waterFresnel` on a flat surface, so it shows exactly where the sea shows its depths),
 * and the water between the surface and the animal takes more of what is left the longer the
 * path (`absorb` per unit; the tint turns it toward blue, red going first, as the water does
 * under the surface). It is drawn over the sea with that share as its opacity, so the sea's
 * waves and glints still lie over it. As the climb moves on, the path under a grazing view grows
 * long, the water takes it, and it is gone by the time it leaves the frame: no switch is seen.
 *
 * Under the water nothing changes: the share is 1 and the animals draw exactly as before.
 *
 * The CPU twin (`throughSurfaceShare`) is the gate: an animal is drawn while the eye is in the
 * water or while any of it would still show through the surface (`oceanLifeDrawn`).
 */
import {
    exp, float, max, normalize, pow, select, vec3,
} from 'three/tsl';

export const ODYSSEY_THROUGH_SURFACE = Object.freeze({
    /** The water's clarity from above: extinction per unit of path under the surface. */
    absorb: 0.008,
    /** The sea's reflectance (the world's `waterFresnel`): gain x (1 - cos)^4 + floor. */
    fresnel: Object.freeze([0.62, 0.05]),
    /** The shallowest slant counted (|dir.y|): the path under a grazing ray is capped by it. */
    graze: 0.005,
    /** The water's extinction per channel under the surface (the world's underwater haze): the
     * tint is what it leaves RELATIVE to blue, a turn of hue (the opacity carries the loss). */
    tint: Object.freeze([0.016, 0.0082, 0.0046]),
    /** Below this share an animal is not drawn from above (the gate). */
    floor: 0.01,
});
const reflectance = (cos, spec) => (spec.fresnel[0] * ((1 - cos) ** 4)) + spec.fresnel[1];

/**
 * How much of a point under the surface shows to an eye above it (0..1); 1 with the eye under
 * the water (there is no surface between them). CPU twin of `throughSurfaceNode`.
 * @param {{x:number,y:number,z:number}} eye
 * @param {{x:number,y:number,z:number}} point
 * @param {number} seaLevel
 */
export function throughSurfaceShare(eye, point, seaLevel, spec = ODYSSEY_THROUGH_SURFACE) {
    if (!(eye.y > seaLevel)) return 1;
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const down = Math.max(-dy / len, spec.graze);
    const path = Math.max(seaLevel - point.y, 0) / down;
    return (1 - reflectance(down, spec)) * Math.exp(-spec.absorb * path);
}

/**
 * The shader's side: `{ share, tint }` for a fragment at `wp` seen from `eye` (TSL nodes, same
 * frame). `share` is 1 with the eye under the water; `tint` is the colour the water leaves an
 * animal seen from above (white with the eye under it). Multiply the colour by `tint` and use
 * `share` as the opacity of a transparent material drawn after the sea.
 */
export function throughSurfaceNode(wp, eye, seaLevel, spec = ODYSSEY_THROUGH_SURFACE) {
    const tsDir = normalize(wp.sub(eye));
    const tsDown = max(tsDir.y.negate(), float(spec.graze));
    const tsPath = max(float(seaLevel).sub(wp.y), 0).div(tsDown);
    const tsFresnel = pow(float(1).sub(tsDown), 4).mul(spec.fresnel[0]).add(spec.fresnel[1]);
    const tsShare = float(1).sub(tsFresnel).mul(exp(tsPath.mul(-spec.absorb)));
    const tsBlue = spec.tint[2];
    const tsHue = vec3(spec.tint[0] - tsBlue, spec.tint[1] - tsBlue, 0);
    const above = eye.y.greaterThan(seaLevel);
    return {
        share: select(above, tsShare, float(1)),
        tint: select(above, exp(tsHue.mul(tsPath).negate()), vec3(1, 1, 1)),
    };
}

/**
 * Whether an ocean animal is drawn this frame: ready, inside the ocean's span, alive in the 1->2
 * carry, and either the eye is in the water or the animal still shows through the surface
 * (`seen`, its largest `throughSurfaceShare` this frame).
 */
export function oceanLifeDrawn({
    ready, inChapter, life, eyeY, seaLevel, seen = 0, spec = ODYSSEY_THROUGH_SURFACE,
}) {
    if (!ready || !inChapter || !(life > 0.001)) return false;
    return eyeY < seaLevel || seen > spec.floor;
}
