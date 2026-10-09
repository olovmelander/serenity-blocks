/**
 * Supernova — the ring of beads round the star: the chain's tally.
 *
 * A thin ring of old gas circles the star, leaning back from the line of sight, faint at rest.
 * Every clear in a chain lights the next bead on it, the way the ring round SN 1987A lit up knot
 * by knot as the blast reached it; when the chain breaks the beads go out one after another. A
 * front that crosses the ring makes the whole of it flare.
 *
 * It is a flat annulus in its own frame (the world sets its matrix). Its far half passes behind
 * the star: nothing here writes depth, so the fragment tests the star's sphere itself.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    cos,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    mix,
    positionLocal,
    positionWorld,
    sin,
    vec3,
    vec4,
} from 'three/tsl';
import {
    RING, TAU, snFxMaterial, snPart, snPastStar,
} from './supernova-tsl.js';

/** @param {object} u shared uniforms */
export function createRing(u) {
    const reach = RING.width * 5;
    const geometry = new THREE.RingGeometry(RING.radius - reach, RING.radius + reach, 144, 1);
    const material = snFxMaterial('SupernovaRing');

    material.colorNode = Fn(() => {
        const p = positionLocal.xy;
        const rr = length(p);
        const off = rr.sub(RING.radius).div(RING.width).toVar();
        const band = exp(off.mul(off).negate());
        const angle = atan(p.y, p.x).add(u.ring.z).toVar();
        const turn = fract(angle.div(TAU)).mul(RING.beads).toVar();
        const index = floor(turn);
        const f = fract(turn).sub(0.5).toVar();
        const bead = u.beads.element(int(index)).toVar();
        // A bead: a soft knot of gas with a hard point of light in it.
        const knot = exp(f.mul(f).mul(-26.0)).mul(exp(off.mul(off).mul(-1.3)));
        const point = exp(f.mul(f).mul(-260.0)).mul(exp(off.mul(off).mul(-12.0)));
        const beadLight = bead.rgb.mul(bead.w).mul(knot.mul(1.7).add(point.mul(14.0)));
        // The ring itself: uneven old gas, lit a little by the star.
        const grain = u.noise(vec3(cos(angle), sin(angle), 0.0).mul(0.7).add(vec3(0.31, 0.62, 0.11))).toVar();
        // A fine bright line with a faint skirt of gas either side of it.
        const line = exp(off.mul(off).mul(-9.0));
        const dusty = float(0.25).add(grain.r.mul(1.2)).mul(band.mul(0.3).add(line));
        const gas = mix(u.gasC, u.rim, grain.g).mul(dusty).mul(u.ring.x).mul(0.16);
        const flare = mix(u.rim, vec3(1.0), 0.35).mul(band).mul(u.ring.y).mul(float(0.6).add(grain.b));
        const seen = snPastStar(u, positionWorld);
        return vec4(beadLight.add(gas).add(flare).mul(seen).mul(u.breath), 0.0);
    })();

    return snPart('SupernovaRing', geometry, material, 25);
}
