/**
 * Supernova — the star.
 *
 * One billboard, shaded per view ray. Where the ray meets the star's sphere it shades the
 * photosphere: giant convection cells, granules with dark lanes between them, spots, a limb that
 * darkens and reddens, and the thin electric edge of the chromosphere. Where it misses, it shades
 * the corona from how close the ray came and in which direction: an inner glow, and streamers
 * that keep their place round the star as it turns and flow outward along their own length.
 *
 * The surface is three reads of the 3D noise at a point of the star's own frame, so the pattern
 * turns with the star. It boils because the sphere those reads lie on is slid through the noise:
 * every point of the surface then sees a different slice, and the pattern changes shape instead
 * of sliding.
 *
 * The board writes on it: a lock's stream lands at a point of the surface, which flashes in the
 * piece's colour, sends a ripple round the photosphere and keeps a patch of that colour for a
 * while; a chain climbs the temperature ramp and opens white cracks along the lanes.
 */

import {
    Fn,
    If,
    abs,
    acos,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cameraWorldMatrix,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    smoothstep,
    sqrt,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BLUEWHITE,
    IMPACT_HOLD,
    IMPACT_SLOTS,
    STAR,
    snBell,
    snFxMaterial,
    snLuma,
    snPart,
    snQuadGeometry,
    snRidge,
    snTurnY,
} from './supernova-tsl.js';

/** How fast a lock's ripple runs round the photosphere (radians per second). */
export const RIPPLE_SPEED = 1.9;

/**
 * @param {object} u shared uniforms
 * @param {{ detail?: number, spikes?: boolean }} [options]  detail 3 = the finest surface read
 */
export function createStar(u, { detail = 3, spikes = true } = {}) {
    const geometry = snQuadGeometry(1);
    const material = snFxMaterial('SupernovaStar');

    // The billboard faces the camera and grows with nothing: the corona's reach is in star radii
    // at rest, so a collapsed star keeps its halo's room.
    const right = cameraWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    const up = cameraWorldMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    const plane = positionGeometry.xy.mul(STAR.quad * 2);
    const world = u.centre.add(right.mul(plane.x)).add(up.mul(plane.y));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const vWorld = varying(world, 'snStarWorld');
    const vPlane = varying(plane, 'snStarPlane');

    /** The photosphere's colour for a temperature: deep, mid, hot, white, blue-white. */
    const ramp = (T) => {
        const a = mix(u.starDeep, u.starMid, smoothstep(0.0, 0.44, T));
        const b = mix(a, u.starHot, smoothstep(0.38, 0.8, T));
        const c = mix(b, vec3(1.0, 0.97, 0.92), smoothstep(0.78, 1.2, T));
        return mix(c, vec3(...BLUEWHITE), smoothstep(1.15, 1.7, T));
    };

    material.fragmentNode = Fn(() => {
        const ro = cameraPosition.sub(u.centre).toVar();
        const rd = normalize(vWorld.sub(cameraPosition)).toVar();
        const R = u.starR.toVar();
        const b = dot(ro, rd).toVar();
        const d2 = max(dot(ro, ro).sub(b.mul(b)), 0.0).toVar();
        const d = sqrt(d2).toVar();
        // One pixel at the star, in star radii: the limb is anti-aliased over it.
        const pixel = u.pixelAngle.mul(length(ro)).toVar();
        const cover = clamp(R.sub(d).div(pixel).add(0.5), 0.0, 1.0).toVar();
        // Where the ray came closest, in the star's own frame.
        const dc = u.starInv.mul(ro.sub(rd.mul(b)).div(max(d, 1e-4))).toVar();
        const out = vec3(0.0).toVar();

        // ── The corona and the chromosphere ──
        If(cover.lessThan(0.999), () => {
            const x = max(d.div(R).sub(1.0), 0.0).toVar();
            // A T-spin winds the streamers round the axis, more the further out they are.
            const qc = snTurnY(dc, u.twist.mul(x.add(0.2))).toVar();
            const s1 = u.noise(qc.mul(0.34).add(vec3(0.0, 0.0, u.boil.mul(0.004))).add(vec3(0.41, 0.17, 0.66))).toVar();
            // Sliding the read along the direction itself makes the pattern run outward. The
            // slide cannot go on for ever (the pattern would shrink to a point), so two reads half
            // a turn apart take turns: each fades out as it reaches the end of its run.
            const streamAt = (phase) => snRidge(u.noise(
                qc.mul(float(0.92).add(x.mul(0.07)).sub(phase.mul(0.24)))
                    .add(s1.xyz.sub(0.5).mul(0.12)).add(vec3(0.83, 0.29, 0.05)),
            ).r);
            const rays = float(0.0).toVar();
            if (detail >= 3) {
                const p1 = fract(u.flow.mul(0.045)).toVar();
                const p2 = fract(u.flow.mul(0.045).add(0.5)).toVar();
                const w1 = float(1.0).sub(abs(p1.mul(2.0).sub(1.0)));
                rays.assign(mix(streamAt(p2), streamAt(p1), w1));
            } else {
                rays.assign(streamAt(float(0.0)));
            }
            const streak = rays.mul(rays).mul(rays);
            // Wide fans the streamers gather into, and the gaps between them.
            const body = smoothstep(0.34, 0.7, s1.g);
            const inner = exp(x.mul(-4.2));
            const outer = float(1.0).div(float(1.0).add(x.mul(0.85))).pow(2.4);
            const reach = float(1.0).sub(smoothstep(STAR.quad * 0.55, STAR.quad * 0.98, d));
            const corona = u.corona.mul(
                inner.mul(1.3).add(
                    outer.mul(float(0.05).add(body.mul(0.3)).add(streak.mul(body.mul(0.9).add(0.25)).mul(1.5)))
                        .mul(u.coronaGain),
                ),
            );
            // The chromosphere: a hairline of the rim's colour hugging the limb, and its soft skirt.
            const chromo = u.rim.mul(exp(x.mul(-46.0)).mul(3.2).add(exp(x.mul(-9.0)).mul(0.22)));
            out.assign(corona.add(chromo).mul(reach).mul(u.starGain));
        });

        // ── The photosphere ──
        If(cover.greaterThan(0.001), () => {
            const h = max(R.mul(R).sub(d2), 0.0);
            const sq = sqrt(h);
            const normal = ro.add(rd.mul(b.negate().sub(sq))).div(R);
            const mu = clamp(sq.div(R), 0.0, 1.0).toVar();
            const q = u.starInv.mul(normal).toVar();

            const slide = vec3(0.0, 0.0, u.boil.mul(0.016));
            const cells = u.noise(q.mul(0.23).add(slide.mul(0.35)).add(vec3(0.19, 0.57, 0.31))).toVar();
            const warp = cells.xyz.sub(0.5).toVar();
            // The granules are dragged round by the giant cells under them: plasma, not pebbles.
            const grain = u.noise(q.mul(0.6).add(warp.mul(0.24)).add(slide)).toVar();
            const lanes = snRidge(grain.r).toVar();
            const lane = lanes.mul(lanes).mul(lanes).mul(lanes);
            const T = float(0.66)
                .add(cells.r.sub(0.5).mul(0.75))
                .add(grain.g.sub(0.5).mul(0.85))
                .sub(lane.mul(0.46))
                .toVar();
            if (detail >= 3) {
                const fine = u.noise(q.mul(1.05).add(warp.yzx.mul(0.14))
                    .add(vec3(u.boil.mul(-0.011), u.boil.mul(0.007), 0.0))).toVar();
                const fineLane = snRidge(fine.g);
                T.addAssign(fine.b.sub(0.5).mul(0.42).sub(fineLane.mul(fineLane).mul(fineLane).mul(0.2)));
            }
            // Up close (the icon, a 4K screen) there is room for the finest granules. Their read
            // would shimmer at the size the star usually has, so it fades out as a texel of the
            // noise shrinks toward a pixel.
            const room = float(1.0).sub(smoothstep(0.45, 1.1, pixel.div(R).mul(2.3 * 64)));
            If(room.greaterThan(0.01), () => {
                const micro = u.noise(q.mul(2.3).add(warp.zxy.mul(0.1))
                    .add(vec3(0.0, u.boil.mul(0.009), 0.37))).toVar();
                const microLane = snRidge(micro.r);
                T.addAssign(micro.g.sub(0.5).mul(0.4).sub(microLane.mul(microLane).mul(microLane).mul(0.2)).mul(room));
            });
            // Spots: cool islands that a hot star burns away.
            const spot = smoothstep(0.69, 0.82, cells.g).mul(float(1.0).sub(clamp(u.heat, 0.0, 1.0)));
            T.subAssign(spot.mul(0.6));
            // The limb is cooler, and a chain heats everything.
            T.addAssign(u.heat.mul(0.55).sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.42)));
            const temp = max(T, 0.0).toVar();
            const surface = ramp(temp).mul(float(0.34).add(temp.mul(temp).mul(2.6))).toVar();
            // White cracks along the lanes when the star is close to going.
            const crack = snRidge(grain.b);
            const crack8 = crack.mul(crack).mul(crack).mul(crack);
            surface.addAssign(vec3(1.0, 0.95, 0.85).mul(crack8.mul(crack8)).mul(u.fissure).mul(5.0));
            surface.mulAssign(mix(float(1.0), mu.pow(0.6), 0.8));

            // ── What the board has written on it ──
            If(u.impactsLive.greaterThan(0.5), () => {
                for (let i = 0; i < IMPACT_SLOTS; i++) {
                    const A = u.impactA[i];
                    const C = u.impactC[i];
                    const age = u.time.sub(A.w);
                    const angle = acos(clamp(dot(q, A.xyz), -1.0, 1.0));
                    const live = step(0.0, age).mul(C.w);
                    const flash = exp(angle.mul(angle).mul(-42.0)).mul(exp(max(age, 0.0).mul(-4.5))).mul(4.5);
                    const front = max(age, 0.0).mul(RIPPLE_SPEED);
                    const ripple = snBell(angle.sub(front).div(0.1)).mul(exp(max(age, 0.0).mul(-0.9)))
                        .mul(float(1.0).sub(smoothstep(2.3, 3.1, front)));
                    const spread = float(7.0).div(float(1.0).add(max(age, 0.0).mul(0.45)));
                    const patch = exp(angle.mul(angle).mul(spread).negate())
                        .mul(exp(max(age, 0.0).div(-IMPACT_HOLD)));
                    // The patch dyes the surface (its granules stay); the flash and the ripple add.
                    const dyed = C.rgb.mul(snLuma(surface).mul(1.5).add(0.25));
                    surface.assign(mix(surface, dyed, clamp(patch.mul(live).mul(0.72), 0.0, 0.85)));
                    surface.addAssign(C.rgb.mul(flash.add(ripple.mul(1.7))).mul(live));
                }
            });

            // The electric edge: a hairline on the limb itself (the rest of it is outside the disc).
            const edge = float(1.0).sub(mu);
            const edge3 = edge.mul(edge).mul(edge);
            const rim = u.rim.mul(edge3.mul(edge3)).mul(2.4);
            out.assign(mix(out, surface.add(rim).mul(u.starGain), cover));
        });

        // ── The glare and the six spikes of the lens ──
        const flat = vPlane.toVar();
        const dist = length(flat).toVar();
        const fade = float(1.0).sub(smoothstep(STAR.quad * 0.7, STAR.quad * 0.99, dist)).toVar();
        const glare = float(1.0).div(float(1.0).add(dist.mul(dist).mul(0.55)));
        const lens = vec3(0.0).toVar();
        lens.addAssign(mix(u.starHot, vec3(1.0), 0.4).mul(glare).mul(u.glare.x).mul(0.22));
        if (spikes) {
            const spike = float(0.0).toVar();
            for (let k = 0; k < 3; k++) {
                const a = (k * Math.PI) / 3 + Math.PI / 6;
                const along = abs(flat.x.mul(Math.cos(a)).add(flat.y.mul(Math.sin(a))));
                const across = abs(flat.y.mul(Math.cos(a)).sub(flat.x.mul(Math.sin(a))));
                // Each spike narrows and dies along its length: a flare of the lens, not a ruled line.
                spike.addAssign(exp(across.mul(along.mul(1.6).add(22.0)).negate()).mul(exp(along.mul(-0.95))));
            }
            lens.addAssign(mix(u.starHot, vec3(1.0), 0.65).mul(spike).mul(u.glare.y));
        }
        // The lens flares round the star, not across its face.
        out.addAssign(lens.mul(fade).mul(float(1.0).sub(cover.mul(0.9))));

        // The star keeps its own light through a collapse: it is what the hush is watching.
        return vec4(min(out, vec3(80.0)), cover);
    })();

    return snPart('SupernovaStar', geometry, material, 20);
}
