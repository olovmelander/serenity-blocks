/**
 * Supernova — the aura: what an event throws round the star that is neither a shell of the
 * nebula nor a spark.
 *
 * Every big answer used to be one more ring round the star, told from the last by its size and
 * colour. The rings stay a clear's own (one front a line); everything else has a SHAPE here, on
 * one star-centred sheet that has no size while nothing on it is alive (so it costs nothing at
 * rest) and is drawn under the star (whose disc hides what lies behind it):
 *
 *   jets     two straight beams along the remnant's axis, knots of light running out along them
 *            behind a bright head (three lines, an aftershock, the flash itself);
 *   helix    a corkscrew wound round the same axis, both ways out: two strands, the near turns
 *            bright and the far ones dim, unwinding as it runs (a twist);
 *   plumes   tongues of plasma thrown straight up off the limb where something hit it hard (a
 *            hard drop, the star's own eruptions);
 *   disc     a wave that runs outward IN THE RING'S PLANE: an oval, leaning with the ring, where
 *            a front is a circle (a back-to-back);
 *   wisps    ripples that leave a newborn pulsar in that same plane, one after another;
 *   crown    long rays in bundles of unequal reach, in the element's own colours (a perfect clear).
 *
 * The plane of the sheet is the plane of the picture through the star, so the shapes that belong
 * to the axis are drawn along its shadow on that plane (u.auraAxis); the two that lie in the
 * ring's plane are found by meeting the view ray with it.
 */

import {
    Fn,
    If,
    Loop,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cameraWorldMatrix,
    cos,
    dot,
    exp,
    float,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    AURA_PLUMES,
    BLUEWHITE,
    RING,
    snFxMaterial,
    snPart,
    snQuadGeometry,
    snRidge,
} from './supernova-tsl.js';

/** Half the side of the sheet while something on it is alive, in star radii. */
export const AURA_QUAD = 18;
/** Plumes that can stand at once (rows are two vec4 each, live ones packed at the front). */
export const PLUME_SLOTS = AURA_PLUMES;
export const PLUME_STRIDE = 2;

/** @param {object} u shared uniforms */
export function createAura(u) {
    const geometry = snQuadGeometry(1);
    const material = snFxMaterial('SupernovaAura');

    const right = cameraWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    const up = cameraWorldMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    // No size while nothing is alive: every vertex on the star's centre.
    const plane = positionGeometry.xy.mul(AURA_QUAD * 2).mul(u.auraLive);
    const world = u.centre.add(right.mul(plane.x)).add(up.mul(plane.y));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const vPlane = varying(plane, 'snAuraPlane');
    const vWorld = varying(world, 'snAuraWorld');

    material.fragmentNode = Fn(() => {
        const p = vec2(vPlane).toVar();
        const r = max(length(p), 1e-3).toVar();
        const out = vec3(0.0).toVar();
        const t = u.time;
        // Along the axis's shadow on the sheet and across it. The far side is the near side
        // turned half round (not mirrored): what winds one way on one jet winds the same way on
        // the other.
        const a2 = u.auraAxis.xy;
        const s = dot(p, a2).toVar();
        const side = step(0.0, s).mul(2.0).sub(1.0).toVar();
        const along = abs(s).toVar();
        const across = p.x.mul(a2.y).sub(p.y.mul(a2.x)).mul(side).toVar();
        // The sheet fades out before its own edge.
        const edge = float(1.0).sub(smoothstep(AURA_QUAD * 0.72, AURA_QUAD * 0.98, r)).toVar();

        // ── Jets: two beams along the axis ──
        If(u.jet.y.greaterThan(0.002), () => {
            const age = max(t.sub(u.jet.x), 0.0).toVar();
            const head = float(1.0).add(u.jet.z.mul(float(1.0).sub(exp(age.mul(-1.5))))).toVar();
            const wide = float(0.05).add(along.mul(0.02)).toVar();
            const k = across.div(wide).toVar();
            const core = exp(k.mul(k).negate());
            const sheath = exp(k.mul(k).div(-12.0)).mul(0.1);
            // Knots that run out along the beam (drawn out along it: streaks, not beads), and a
            // beam that is never the same twice.
            const flow = u.noise(
                vec3(along.mul(0.34).sub(t.mul(1.1)), across.mul(0.06), side.mul(0.21).add(0.3)),
            ).toVar();
            const streaks = snRidge(flow.r);
            const knots = streaks.mul(streaks).mul(1.9).add(smoothstep(0.55, 0.8, flow.g).mul(1.4)).add(0.45);
            const body = smoothstep(0.9, 1.5, along).mul(float(1.0).sub(smoothstep(head.sub(0.9), head, along)));
            // The head: where the beam is still ploughing into the gas.
            const cap = along.sub(head.sub(0.25)).div(0.3);
            const bow = exp(cap.mul(cap).negate()).mul(exp(k.mul(k).div(-5.0))).mul(smoothstep(1.2, 2.2, head));
            out.addAssign(mix(u.jetCol, vec3(1.0, 0.97, 0.92), core.mul(0.55))
                .mul(core.mul(knots).add(sheath).mul(body).add(bow.mul(2.6))).mul(u.jet.y).mul(2.3));
        });

        // ── Helix: a corkscrew round the axis ──
        If(u.helix.y.greaterThan(0.002), () => {
            const age = max(t.sub(u.helix.x), 0.0).toVar();
            const head = float(1.0).add(u.helix.z.mul(float(1.0).sub(exp(age.mul(-1.25))))).toVar();
            const reachX = max(along.sub(0.9), 0.0).toVar();
            const amp = float(0.2).add(reachX.mul(0.17)).toVar();
            const wind = float(2.4);
            const phase = reachX.mul(wind).sub(age.mul(5.2)).add(u.helix.w).toVar();
            const strand = (shift) => {
                const at = sin(phase.add(shift)).mul(amp);
                // How steeply the strand crosses here: a line's width is measured across it.
                const slope = cos(phase.add(shift)).mul(amp).mul(wind);
                const off = across.sub(at).div(sqrt(slope.mul(slope).add(1.0)));
                const line = exp(off.mul(off).div(-0.0058));
                const glow = exp(off.mul(off).div(-0.07)).mul(0.16);
                // The near turns bright, the far ones dim: a strand wound round, not a wave.
                const near = cos(phase.add(shift)).mul(0.5).add(0.5);
                return line.add(glow).mul(near.mul(0.75).add(0.25));
            };
            const coil = strand(0.0).add(strand(Math.PI));
            const body = smoothstep(0.92, 1.3, along).mul(float(1.0).sub(smoothstep(head.mul(0.55), head, along)));
            out.addAssign(mix(u.helixCol, vec3(1.0), 0.25).mul(coil).mul(body).mul(u.helix.y)
                .mul(2.3));
        });

        // ── Plumes: tongues of plasma thrown up off the limb ──
        Loop({
            start: int(0), end: int(u.plumeCount), type: 'int', condition: '<', name: 'slot',
        }, ({ slot }) => {
            const base = slot.mul(PLUME_STRIDE);
            const A = u.plumes.element(base).toVar();
            const B = u.plumes.element(base.add(1)).toVar();
            // Up the plume from the limb, and across it.
            const x = dot(p, A.xy).sub(0.94).toVar();
            If(x.greaterThan(0.0), () => {
                const age = max(t.sub(A.z), 0.0).toVar();
                const height = B.w.mul(float(1.0).sub(exp(age.mul(-4.5)))).add(0.05).toVar();
                const f = min(x.div(height), 1.0).toVar();
                const flow = u.noise(vec3(x.mul(0.3).sub(age.mul(0.5)), A.z.mul(0.37), A.x.mul(0.5).add(0.5))).toVar();
                // It leans and flickers more the higher it stands; a flame's outline: narrow at
                // the foot, widest part way up, drawn to a point.
                const bend = flow.g.sub(0.5).mul(x).mul(0.55);
                const girth = float(0.05).add(sin(f.mul(Math.PI)).mul(0.17).mul(sqrt(B.w)));
                const off = p.x.mul(A.y).sub(p.y.mul(A.x)).sub(bend).div(girth)
                    .toVar();
                const flame = exp(off.mul(off).negate());
                const core = exp(off.mul(off).mul(-7.0));
                const strands = snRidge(flow.r);
                const body = smoothstep(0.0, 0.08, x).mul(float(1.0).sub(smoothstep(0.5, 1.0, f)));
                const tint = mix(B.rgb, vec3(1.0, 0.96, 0.9), core.mul(float(1.0).sub(f)).mul(0.8));
                out.addAssign(tint.mul(flame.mul(strands.mul(strands).mul(1.1).add(0.4)).add(core.mul(1.6)))
                    .mul(body).mul(A.w).mul(2.4));
            });
        });

        // ── In the ring's plane: the disc wave and the pulsar's wisps ──
        If(u.disc.y.greaterThan(0.002).or(u.wisps.greaterThan(0.002)), () => {
            const ro = cameraPosition.sub(u.centre).toVar();
            const rd = normalize(vWorld.sub(cameraPosition)).toVar();
            const dn = dot(rd, u.axis).toVar();
            // Where the view ray meets the plane (a ray that runs along it never does).
            const hit = dot(ro, u.axis).negate().div(max(abs(dn), 1e-3).mul(step(0.0, dn).mul(2.0).sub(1.0))).toVar();
            const at = ro.add(rd.mul(hit)).toVar();
            const rho = max(length(at), 1e-3).toVar();
            const round = at.div(rho).toVar();
            const seen = step(0.0, hit).mul(smoothstep(0.02, 0.1, abs(dn)));
            const grain = u.noise(round.mul(1.25).add(vec3(0.17, 0.43, 0.71))).toVar();
            If(u.disc.y.greaterThan(0.002), () => {
                const age = max(t.sub(u.disc.x), 0.0).toVar();
                const front = float(RING.radius).add(u.disc.z.mul(float(1.0).sub(exp(age.mul(-0.9)))));
                const wide = u.disc.w.mul(float(1.0).add(age.mul(0.5)));
                const k = rho.sub(front).div(wide).toVar();
                // A crisp leading edge and a wake that trails inward, torn round the ring.
                const lead = exp(k.mul(k).negate());
                const wake = exp(min(k, 0.0).mul(0.9)).mul(step(k, 0.0)).mul(0.22);
                const torn = smoothstep(0.3, 0.7, grain.r).mul(1.3).add(0.3);
                out.addAssign(mix(u.discCol, vec3(1.0), lead.mul(0.4)).mul(lead.add(wake).mul(torn))
                    .mul(seen).mul(u.disc.y)
                    .mul(1.6));
            });
            If(u.wisps.greaterThan(0.002), () => {
                // Ripples that leave the pulsar one after another, thin as hairs, brightest near it.
                // (Their phase is bent by a smooth turn of the angle only: a read of the coarse
                // noise there draws every ripple as a zigzag.)
                const lop = dot(round, vec3(0.61, 0.32, 0.72));
                const wave = sin(rho.mul(3.7).sub(t.mul(5.0)).add(lop.mul(1.6)));
                const crest = smoothstep(0.9, 1.0, wave);
                const span = smoothstep(1.3, 2.0, rho).mul(exp(rho.sub(1.4).div(-1.7)));
                out.addAssign(mix(vec3(...BLUEWHITE), u.rim, 0.35).mul(crest.mul(grain.b.mul(0.7).add(0.5)))
                    .mul(span).mul(seen)
                    .mul(u.wisps)
                    .mul(1.1));
            });
        });

        // ── Crown: long rays in bundles of unequal reach ──
        If(u.crown.y.greaterThan(0.002), () => {
            const age = max(t.sub(u.crown.x), 0.0).toVar();
            const way = p.div(r).toVar();
            // Read round a circle of the noise: the pattern closes on itself and never combs.
            const broad = u.noise(vec3(way.mul(0.74), u.crown.w)).toVar();
            const fine = u.noise(vec3(way.mul(3.05), u.crown.w.add(0.37))).toVar();
            const bundle = smoothstep(0.36, 0.72, broad.r).toVar();
            const hairs = u.noise(vec3(way.mul(7.3), u.crown.w.add(0.71))).toVar();
            const ray = snRidge(fine.r);
            const hair = snRidge(hairs.r);
            const hair2 = hair.mul(hair);
            const rays = ray.mul(ray).mul(ray).mul(fine.g.mul(1.1).add(0.45)).mul(0.6)
                .add(hair2.mul(hair2).mul(hair2).mul(hairs.g.mul(1.4).add(0.3)).mul(0.9));
            const x = max(r.sub(1.0), 0.0).toVar();
            // Every bundle its own length, growing out from the star as the crown opens.
            const reach = u.crown.z.mul(bundle.mul(0.95).add(0.3)).mul(float(1.0).sub(exp(age.mul(-2.6)))).add(0.05);
            const fall = exp(x.div(reach).mul(-2.3));
            // Toward the hub the rays melt into one even light: no wheel of spokes.
            const out2 = smoothstep(0.25, 2.0, x);
            const pattern = mix(float(0.42), bundle.mul(rays.mul(2.3).add(0.07)), out2);
            // The element's own colours, bundle by bundle, whiter near the star.
            const cool = mix(u.rim, u.gasB, smoothstep(0.38, 0.62, broad.b));
            const hue = mix(cool, u.gasC, smoothstep(0.52, 0.8, broad.a));
            const tint = mix(hue, vec3(1.0, 0.97, 0.93), exp(x.mul(-1.4)).mul(0.6));
            out.addAssign(tint.mul(pattern).mul(fall).mul(u.crown.y).mul(1.15));
        });

        return vec4(min(out.mul(edge), vec3(40.0)), 0.0);
    })();

    return snPart('SupernovaAura', geometry, material, 18);
}
