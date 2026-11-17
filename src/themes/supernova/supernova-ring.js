/**
 * Supernova — the rings round the star.
 *
 * A thin ring of old gas circles the star, leaning back from the line of sight, faint at rest: the
 * chain's tally. Every clear in a chain lights the next bead on it, the way a ring round a real
 * remnant lit up knot by knot as the blast reached it; when the chain breaks the beads go out one
 * after another. A front that crosses the ring makes the whole of it flare.
 *
 * Two wider, fainter rings stand off it along the remnant's axis, one toward the eye and one
 * away: the rims of the two lobes the star blew before it threw the ring. Seen leaning, the three
 * are an hourglass of ovals with the star at its waist.
 *
 * All three are flat annuli in one frame (the world sets its matrix: z is the axis). The far half
 * of each passes behind the star: nothing here writes depth, so the fragment tests the star's
 * sphere itself.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    attribute,
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
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    RING, TAU, snFxMaterial, snPart, snPastStar,
} from './supernova-tsl.js';

/** The two outer rings: their radius, how far along the axis they stand, their width. */
export const OUTER_RINGS = Object.freeze({ radius: 5.6, offset: 2.9, width: 0.2 });

/** A flat annulus round the z axis at height `z`, appended to the lists. `kind` 0 = the bead ring. */
function annulus(lists, inner, outer, z, segments, kind) {
    const base = lists.position.length / 3;
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * TAU;
        const c = Math.cos(a);
        const s = Math.sin(a);
        lists.position.push(c * inner, s * inner, z, c * outer, s * outer, z);
        lists.kind.push(kind, kind);
        if (i < segments) {
            const k = base + i * 2;
            lists.index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
    }
}

/**
 * @param {object} u shared uniforms
 * @param {{ outer?: boolean }} [options]  outer = the two wider rings
 */
export function createRing(u, { outer = true } = {}) {
    const reach = RING.width * 5;
    const lists = { position: [], kind: [], index: [] };
    annulus(lists, RING.radius - reach, RING.radius + reach, 0, 144, 0);
    if (outer) {
        const spread = OUTER_RINGS.width * 2.8;
        annulus(lists, OUTER_RINGS.radius - spread, OUTER_RINGS.radius + spread, OUTER_RINGS.offset, 96, 1);
        annulus(lists, OUTER_RINGS.radius - spread, OUTER_RINGS.radius + spread, -OUTER_RINGS.offset, 96, 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(lists.index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lists.position, 3));
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(lists.kind, 1));
    const material = snFxMaterial('SupernovaRing');
    const vKind = varying(attribute('aKind', 'float'), 'snRingKind');

    material.colorNode = Fn(() => {
        const p = positionLocal.xy;
        const rr = length(p).toVar();
        const angle = atan(p.y, p.x).add(u.ring.z).toVar();
        const seen = snPastStar(u, positionWorld);
        // Uneven old gas, read round the ring.
        const round = vec3(cos(angle), sin(angle), vKind.mul(0.37));
        const grain = u.noise(round.mul(0.7).add(vec3(0.31, 0.62, 0.11))).toVar();

        // ── The bead ring ──
        const off = rr.sub(RING.radius).div(RING.width).toVar();
        const band = exp(off.mul(off).negate());
        const turn = fract(angle.div(TAU)).mul(RING.beads).toVar();
        const index = floor(turn);
        const f = fract(turn).sub(0.5).toVar();
        const bead = u.beads.element(int(index)).toVar();
        // A bead: a soft knot of gas with a hard point of light in it.
        const knot = exp(f.mul(f).mul(-26.0)).mul(exp(off.mul(off).mul(-1.3)));
        const point = exp(f.mul(f).mul(-260.0)).mul(exp(off.mul(off).mul(-12.0)));
        const beadLight = bead.rgb.mul(bead.w).mul(knot.mul(1.7).add(point.mul(14.0)));
        // The ring itself: a fine bright line with a faint skirt of gas either side of it, and
        // small hot spots strung along it (old knots the star's light still reaches).
        const line = exp(off.mul(off).mul(-9.0));
        const dusty = float(0.25).add(grain.r.mul(1.2)).mul(band.mul(0.3).add(line));
        const pearls = exp(f.mul(f).mul(-90.0)).mul(exp(off.mul(off).mul(-6.0))).mul(grain.a.mul(1.4).add(0.3));
        const gas = mix(u.gasC, u.rim, grain.g).mul(dusty.add(pearls.mul(1.6))).mul(u.ring.x).mul(0.2);
        const flare = mix(u.rim, vec3(1.0), 0.35).mul(band).mul(u.ring.y).mul(float(0.6).add(grain.b));
        const inner = beadLight.add(gas).add(flare);

        // ── The two outer rings: a hairline of old gas each, broken along its length ──
        const far = rr.sub(OUTER_RINGS.radius).div(OUTER_RINGS.width).toVar();
        const thin = exp(far.mul(far).mul(-11.0)).add(exp(far.mul(far).negate()).mul(0.22));
        const broken = float(0.2).add(grain.r.mul(1.3)).mul(grain.b.mul(0.8).add(0.4));
        const outerLight = mix(u.gasA, u.rim, grain.g.mul(0.7)).mul(thin.mul(broken))
            .mul(u.ring.x.mul(0.085).add(u.ring.y.mul(0.3)));

        return vec4(mix(inner, outerLight, vKind).mul(seen).mul(u.breath), 0.0);
    })();

    return snPart('SupernovaRing', geometry, material, 25);
}
