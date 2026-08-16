/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE AURORAL CROWN — chapter 6's gas giant grows polar ovals (Wave 5).
 *
 * docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 5: "aurora oval crown on the
 * gas giant: 2-3 ribbon strips, winter-verified emerald palette ported, sway at clump
 * level; the aurora->filament bridge recolours from the same nodes (shared contract)."
 *
 * TWO HALVES, ONE LOOK. An aurora that only exists as a shader term on the sphere can
 * never break the silhouette, and a crown that only exists as floating ribbons never
 * looks attached. So:
 *   - `auroraSurfaceTerm()` is an additive colour term folded into the gas giant's own
 *     surface graph (ZERO extra draws) — the oval seated on the disc.
 *   - `createPlanetAuroraCrown()` is the curtain wall standing off that oval, and it is
 *     the half that arcs past the limb into empty sky. FOUR ribbon strips (two rings per
 *     pole) are merged into ONE BufferGeometry sharing ONE material: +1 draw total, not
 *     +4. ~1k triangles.
 *
 * BOTH POLES, ALWAYS — AND THAT IS A ROBUSTNESS DECISION, NOT A FLOURISH. The world sun
 * is ODYSSEY_WORLD_SUN = (-0.46, 0.36, 0.61); its +y puts the giant's NORTH pole on the
 * lit side and the south toward the terminator, so today only the south oval would show.
 * But the hero flies its own APPROACH march (planetA -> planetB sweeps it from upper
 * right to centre-low and grows it 34 -> 60 units), and the exit axis was re-solved once
 * already when the black-hole dive landed. Hard-coding "the visible pole" would be a
 * re-framing bug lying in wait. Instead both ovals are authored and each is masked by
 * its own N.L, so whichever pole is dark is the one that glows. That is also just true:
 * aurorae are a property of the magnetosphere, and you cannot see one over a sunlit cap.
 *
 * THE NORMALS ARE A DELIBERATE LIE. Every crown vertex carries the RADIAL direction from
 * the planet centre as its normal, not the geometric normal of the ribbon it sits on.
 * That makes dot(normalWorld, sunDir) inside this material numerically identical to the
 * dTerm the gas giant's own surface computes, so the crown's night mask and the surface's
 * terminator can never disagree — and it costs nothing, because an unlit additive curtain
 * has no use for a real normal. It is also spin-invariant for free: the hero group
 * rotates about local +y, which maps radial directions to radial directions.
 *
 * STAGING (integration law 1, learnt in Wave 3). The crown hangs off the hero-planet
 * group, which sits in the `earth` entryContinuity bucket, so `setOpacityScale` traverses
 * it. That helper writes `material.opacity` — and `material.opacity` is a DEAD WRITE
 * wherever an `opacityNode` exists (trap register). The crown therefore multiplies its
 * alpha by the `materialOpacity` NODE, which reads that same uniform back: the dead write
 * becomes live again and the aurora fades up with the earth ignite instead of popping in
 * at full brightness across the Ch5 summit. Pinned by test.
 */

import * as THREE from 'three/webgpu';
import {
    atan, attribute, clamp, cos, dot, float, materialOpacity, mix, normalWorld, normalize,
    oneMinus, pow, sin, smoothstep, step, uniform, uv, vec3,
} from 'three/tsl';
import { ODYSSEY_WORLD_SUN } from './shared/chapter-profile.js';

/**
 * Ported verbatim from `src/themes/winter/lighting/winter-light-rig.js`, which is the
 * one aurora palette in this project that has been verified against real photographs
 * (2026-08-15: green measured at 133.9 deg / 145.3 deg hue against the owner's three
 * reference shots, teal-end yellow contamination 1.1%, no tuning needed). Re-deriving a
 * second emerald by eye would throw that verification away, so these are copied as
 * literals rather than imported — chapter 6 must not take a dependency on a theme.
 */
export const AURORA_PALETTE = Object.freeze({
    greenWarm: Object.freeze([0.04, 1.00, 0.26]), // AURORA_GREEN_WARM
    greenCool: Object.freeze([0.03, 1.00, 0.52]), // AURORA_GREEN_COOL
    crimson: Object.freeze([0.86, 0.055, 0.15]), // AURORA_CRIMSON
    pink: Object.freeze([1.00, 0.32, 0.62]), // AURORA_PINK
});

/**
 * The oval geometry, frozen. Colatitudes are the angle DOWN FROM THE POLE, in radians:
 * 0.30 rad = 17.2 deg and 0.42 rad = 24.1 deg, which is where Earth's auroral oval
 * actually sits (roughly 20-25 deg magnetic colatitude) — the physical number happens to
 * frame well, so there was no reason to invent one. `height` is the curtain's radial
 * extent as a fraction of the planet radius.
 */
export const AURORA_OVAL = Object.freeze({
    // RIB COUNTS ARE SET BY THE SHIPPED APPARENT SIZE, NOT BY THE PROBE. In the
    // playground the hero fills the frame and 34 ribs looked right; in the graded capture
    // the giant is ~90 px across, which put those ribs at ~3 px each — a dotted LED strip
    // that would shimmer in motion. Halved to 18/13 so a rib is ~6-7 px where it actually
    // ships. Judge any future change from a chapter capture, not from the probe.
    rings: Object.freeze([
        Object.freeze({
            colatitude: 0.30, height: 0.30, weight: 1.00, rays: 18, lean: 0.16, sway: 0.55,
        }),
        Object.freeze({
            colatitude: 0.44, height: 0.20, weight: 0.55, rays: 13, lean: 0.26, sway: 0.85,
        }),
    ]),
    segments: 128,
    // The curtain foot is lifted off the sphere: coincident with an opaque surface it
    // would z-fight, and this material is depth-TESTED (so the far-side curtain is
    // correctly hidden behind the planet) even though it does not depth-write.
    footLift: 1.012,
    // The surface oval band, in the same colatitude units — deliberately a touch wider
    // than the ring pair so the painted oval reads as the curtains' footprint.
    surfaceInner: 0.24,
    surfaceOuter: 0.46,
    // The disc half runs FAR fewer ribs than the curtains. At the curtains' 34, sheared
    // across a narrow band, they aliased into a moire fingerprint (probe shot 6). Nine
    // broad lobes read as a ribbed band and leave the ray statement to the standing half.
    surfaceRibs: 7,
    surfaceShear: 0.25,
});

const TWO_PI = Math.PI * 2;

/**
 * The per-strip phase seed. Exported as a function because the DISC half has to be able
 * to reproduce the standing half's phase exactly — if the two disagree, the painted oval
 * breaks in different places from the curtains standing on it and they stop reading as
 * one object.
 */
export function auroraStripPhase(stripIndex, poleSign) {
    return stripIndex * 1.7 + (poleSign < 0 ? 0.9 : 0.0);
}

/**
 * THE ARC FUNCTION, shared by both halves.
 *
 * An auroral oval is not a closed ring of even brightness; it is an arc with gaps, and
 * the gaps are what make the bright stretch read. Two slow incommensurate waves in
 * azimuth, so the bright stretch wanders around the oval and never visibly loops.
 *
 * `azimuth` must be the SAME angle in both callers: the crown reads it off uv.x (the
 * generator angle `a`), the disc reads it as atan2(n.z, n.x) — which is the same `a`.
 * Note the branch cut is harmless here: every term is sin/cos of an INTEGER multiple of
 * the angle, and those are continuous across the +pi/-pi jump. (An earlier revision of
 * this file avoided atan on seam grounds and paid for it with a structureless blob.)
 */
export function auroraArc(azimuth, time, phase) {
    const a = sin(azimuth.mul(3.0).sub(time.mul(0.22)).add(phase)).mul(0.5).add(0.5);
    const b = cos(azimuth.mul(5.0).add(time.mul(0.13))).mul(0.5).add(0.5);
    return { a, arc: pow(a.mul(b), 0.7).mul(0.94).add(0.06) };
}

/**
 * Both ovals, both rings, one indexed BufferGeometry.
 *
 * Attributes: `position`, `normal` (the radial lie, see the header), `uv`
 * (x = azimuth 0..1, y = 0 at the curtain foot -> 1 at its tip) and `aRing` =
 * vec4(weight, rayCount, swaySpeed, phaseSeed). Everything the paint varies per ring
 * travels on that one attribute, which is why four strips can share a single material.
 */
export function buildAuroraCrownGeometry(radius, spec = AURORA_OVAL) {
    const { rings, segments, footLift } = spec;
    const columns = segments + 1; // duplicated seam column so uv.x can reach exactly 1
    const strips = rings.length * 2; // two poles
    const vertexCount = strips * columns * 2;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const ringData = new Float32Array(vertexCount * 4);
    const indices = [];

    let v = 0;
    let strip = 0;
    [1, -1].forEach((poleSign) => {
        rings.forEach((ring) => {
            const sinC = Math.sin(ring.colatitude);
            const cosC = Math.cos(ring.colatitude) * poleSign;
            // A distinct phase per strip so the four curtains never ripple in lockstep;
            // derived from the strip index rather than random so the crown is identical
            // on every build (the garland's re-rolling-seats lesson, commit e9ccc0f6).
            const phase = auroraStripPhase(strip, poleSign);
            const base = v;

            for (let i = 0; i < columns; i += 1) {
                const u = i / segments;
                const a = u * TWO_PI;
                const dx = sinC * Math.cos(a);
                const dy = cosC;
                const dz = sinC * Math.sin(a);

                // row 0 = the curtain foot on the shell, row 1 = its tip.
                //
                // THE TIP RISES ALONG THE POLAR AXIS, NOT ALONG THE RADIUS. A purely
                // radial extrusion off a 17-degree colatitude splays every curtain
                // outward by 17 degrees, and the four strips together render as a
                // corrugated lampshade sitting under the planet (measured: first probe
                // shot). Real curtains climb the field lines, which near the cap means
                // essentially parallel to the axis with a slight outward flare — so the
                // tip is base + axis*height with `lean` of that height added radially.
                const leanOut = ring.lean ?? 0;
                for (let row = 0; row < 2; row += 1) {
                    const o = v * 3;
                    if (row === 0) {
                        positions[o] = dx * radius * footLift;
                        positions[o + 1] = dy * radius * footLift;
                        positions[o + 2] = dz * radius * footLift;
                    } else {
                        const rise = ring.height * radius;
                        const flare = leanOut * rise;
                        positions[o] = dx * radius * footLift + Math.cos(a) * flare;
                        positions[o + 1] = dy * radius * footLift + poleSign * rise;
                        positions[o + 2] = dz * radius * footLift + Math.sin(a) * flare;
                    }
                    normals[o] = dx;
                    normals[o + 1] = dy;
                    normals[o + 2] = dz;
                    uvs[v * 2] = u;
                    uvs[v * 2 + 1] = row;
                    const r = v * 4;
                    ringData[r] = ring.weight;
                    ringData[r + 1] = ring.rays;
                    ringData[r + 2] = ring.sway;
                    ringData[r + 3] = phase;
                    v += 1;
                }
            }

            for (let i = 0; i < segments; i += 1) {
                const a0 = base + i * 2;
                const b0 = a0 + 1;
                const a1 = a0 + 2;
                const b1 = a0 + 3;
                indices.push(a0, b0, b1, a0, b1, a1);
            }
            strip += 1;
        });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aRing', new THREE.BufferAttribute(ringData, 4));
    geometry.setIndex(indices);
    return geometry;
}

/**
 * The shared curtain paint. Split out from the mesh builder so the probe effect and the
 * chapter compile the SAME graph, and so the aurora->filament bridge can adopt these
 * exact nodes later (Wave 5's "shared contract").
 */
export function createAuroraCrownMaterial(uTime, uLightDir) {
    const time = uTime ?? uniform(0);
    const light = uLightDir ?? uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize());

    const aRing = attribute('aRing', 'vec4');
    const coords = uv();
    const azimuth = coords.x.mul(TWO_PI);
    const height = coords.y;

    // NIGHT MASK. Identical arithmetic to the gas giant's own terminator (see the header
    // on why the normals make that possible). The window closes slightly PAST the
    // terminator (0.14 -> -0.22 rather than 0 -> negative) so the oval's sunward arc
    // fades out under the day side instead of ending on a hard line.
    const dTerm = dot(normalize(normalWorld), normalize(light));
    const night = smoothstep(0.14, -0.22, dTerm);

    // RAYS — the vertical striations that make a curtain a curtain. TWO incommensurate
    // frequencies: a single high-frequency sine at 74 cycles rendered as corduroy (first
    // probe shot), because an evenly-spaced comb is exactly what a real curtain is not.
    // The beat between 34-ish and its 2.7x partner gives clusters of ribs with gaps
    // between them. The frequency rides on the attribute, so the two rings of a pole
    // never moire against each other, and both are periodic in azimuth by construction
    // so the duplicated seam column joins exactly.
    const rayArg = azimuth.mul(aRing.y).add(time.mul(aRing.z)).add(aRing.w);
    const ribFine = pow(sin(rayArg).mul(0.5).add(0.5), 3.0);
    const ribWide = pow(sin(azimuth.mul(aRing.y.mul(0.37)).sub(aRing.w)).mul(0.5).add(0.5), 1.6);
    const rays = ribFine.mul(0.62).add(0.20).mul(ribWide.mul(0.7).add(0.45));

    // SWAY AT CLUMP LEVEL (plan §3.5 "alive, not boiling"): the individual rays hold
    // still relative to each other and the BRIGHTNESS travels along the oval instead.
    // Moving the rays themselves is what makes a shader aurora look like boiling static.
    // The floor is near zero on purpose — see auroraArc; a 0.35 floor (first probe) kept
    // every azimuth lit and closed the oval into a solid barrel.
    const { a: clumpA, arc: clump } = auroraArc(azimuth, time, aRing.w);

    // THE ALTITUDE LADDER, AS FLAT BANDS. Real aurorae are green low (557.7 nm oxygen)
    // and red high (630 nm), so the vertical colour run is physics — but it is painted
    // the way this chapter paints everything else since Wave 4: flat interiors with ~8%
    // soft thresholds, never a smooth ramp. The green owns most of the curtain; the red
    // is the top fifth only. Splitting it evenly (the first probe, edges at 0.42/0.74)
    // produced a candy stripe — two equal rings of green and blood-red.
    const greenBase = mix(
        vec3(...AURORA_PALETTE.greenWarm),
        vec3(...AURORA_PALETTE.greenCool),
        clumpA,
    );
    const toCrimson = smoothstep(0.56, 0.68, height);
    const toPink = smoothstep(0.84, 0.94, height);
    const crown = mix(vec3(...AURORA_PALETTE.crimson), vec3(...AURORA_PALETTE.pink), toPink);
    const colour = mix(greenBase, crown, toCrimson);

    // Bright at the foot, dissolving upward — the red tips are meant to be faint, and
    // steeply so: exponent 1.5 left them reading as a solid second ring.
    const foot = smoothstep(0.0, 0.06, height);
    const fade = pow(oneMinus(height), 2.6);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
    const shape = foot.mul(fade).mul(rays).mul(clump);
    const alpha = shape.mul(aRing.x).mul(night).mul(float(0.9));
    // The materialOpacity factor re-arms setOpacityScale's otherwise-dead write (header).
    material.opacityNode = clamp(alpha, 0.0, 1.0).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // ONE DRAW, NOT TWO. three splits every transparent DoubleSide object into a
    // back-face pass and a front-face pass (Renderer.js: `material.transparent === true
    // && material.side === DoubleSide && material.forceSinglePass === false`), so the
    // crown measured +2 draws on Lane B when only one mesh had been added. That split
    // exists to get back-to-front ordering right within a mesh, and it buys this
    // material nothing: additive blending is commutative and depthWrite is already off,
    // so the two passes composite to exactly the same pixels as one.
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.fog = false;
    material.userData.emitsBloom = true;
    return material;
}

/**
 * The +1-draw crown mesh, ready to add to the hero-planet group.
 */
export function createPlanetAuroraCrown(radius, uTime, uLightDir, spec = AURORA_OVAL) {
    const geometry = buildAuroraCrownGeometry(radius, spec);
    const material = createAuroraCrownMaterial(uTime, uLightDir);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hero-planet-aurora-crown';
    // The hero is a single group that is culled (or not) as a whole; the crown must never
    // be tested on its own bounds, which are a thin shell around the pole.
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
}

/**
 * The disc half: an additive term for the gas giant's own surface graph.
 *
 * @param {Node} nLocal   normalize(positionLocal) — planet-fixed, so the oval stays on
 *                        the pole no matter how the hero group is spun or tilted.
 * @param {Node} dTerm    the surface's existing world-space N.L, reused rather than
 *                        recomputed so the two halves cannot drift apart.
 */
export function auroraSurfaceTerm(nLocal, dTerm, uTime, spec = AURORA_OVAL) {
    const time = uTime ?? uniform(0);
    const cosInner = Math.cos(spec.surfaceInner);
    const cosOuter = Math.cos(spec.surfaceOuter);
    // |n.y| folds both caps into one band test — the north and south ovals are the same
    // latitudes, and the night mask below decides which of them is actually alight.
    const lat = nLocal.y.abs();
    const band = smoothstep(cosOuter - 0.03, cosOuter + 0.03, lat)
        .mul(smoothstep(cosInner + 0.03, cosInner - 0.03, lat));
    const night = smoothstep(0.14, -0.22, dTerm);

    // The SAME azimuth the crown's uv.x encodes, so the two halves break in the same
    // places (see auroraArc on why the atan branch cut is harmless here).
    const azimuth = atan(nLocal.z, nLocal.x);
    // SPIRAL SHEAR. Perfectly radial ribs converge on the pole and render as a bicycle
    // wheel — a sunburst, not an aurora (probe shot 5). Twisting the rib angle across the
    // band breaks the common centre, and it is also what a real oval does, since the
    // curtains follow field lines that are not meridional. Keep it small: shear and rib
    // count multiply into moire (probe shot 6).
    const across = clamp(lat.sub(cosOuter).div(cosInner - cosOuter), 0.0, 1.0);
    const sheared = azimuth.add(across.mul(spec.surfaceShear));
    // ...and the same phase as whichever pole this fragment is on: strip 0 is the north
    // inner ring, strip 2 the south inner ring (see buildAuroraCrownGeometry's order).
    const phase = mix(
        float(auroraStripPhase(2, -1)),
        float(auroraStripPhase(0, 1)),
        step(0.0, nLocal.y),
    );
    const { arc } = auroraArc(azimuth, time, phase);

    // Radial ribs at the inner ring's rib count, so the painted oval reads as the feet of
    // the curtains standing on it rather than as a separate glowing puddle (which is what
    // the first revision's x/z-stripe pattern produced).
    // Low contrast on purpose: the STANDING half carries the ray statement. Ribs here at
    // full contrast fight it and turn the cap into a spoked wheel.
    const ribs = pow(
        sin(sheared.mul(spec.surfaceRibs).add(time.mul(0.55)).add(phase)).mul(0.5).add(0.5),
        2.0,
    ).mul(0.45).add(0.42);

    const glow = mix(
        vec3(...AURORA_PALETTE.greenWarm),
        vec3(...AURORA_PALETTE.greenCool),
        arc,
    );
    // Deliberately quiet. This term is UNDER the curtains and additive over an already
    // shaded cap; at 0.55 (first revision) it rendered as a solid mint puddle that read
    // as a landing light. The standing half is what the eye is meant to catch.
    return glow.mul(band.mul(night).mul(arc).mul(ribs).mul(0.30));
}
