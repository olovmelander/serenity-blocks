/**
 * Supernova — the star.
 *
 * One billboard, shaded per view ray. Where the ray meets the star's sphere it shades the
 * photosphere: giant convection cells, granules with dark lanes between them, spots, a limb that
 * darkens and reddens, and the thin electric edge of the chromosphere. Where it misses, it shades
 * the corona from how close the ray came and in which direction: an inner glow, and streamers
 * that keep their place round the star as it turns and flow outward along their own length.
 *
 * The surface is read at a point of the star's own frame, so the pattern turns with the star: a
 * broad smooth field (the giant cells, and where the spots are) and a volume of convection cells
 * (the granules: a hot dome in each, a dark lane along every wall between two). It boils because
 * the sphere those reads lie on is slid through both volumes: every point of the surface then
 * sees a different slice, and granules are born, change shape and close instead of sliding.
 *
 * The star is restless on a cycle of its own (u.activity): quiet, it is an even field of
 * granules; stormy, spots open in it (a dark heart inside a dimmer fringe), a bright network
 * gathers round them, and its rays reach further.
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
    sin,
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
/** The finer read of the granules: this many times the coarse one's cells. */
const MICRO = 2.6;

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
        // (Only as far out as it has light to give: beyond five radii off the limb the sheet
        // carries the lens's glare alone, and pays for none of the corona's reads.)
        If(cover.lessThan(0.999).and(d.lessThan(R.mul(6.0))), () => {
            const x = max(d.div(R).sub(1.0), 0.0).toVar();
            // A twist winds the streamers round the axis, more the further out they are.
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
            const body = smoothstep(0.34, 0.7, s1.g).toVar();
            // Hairlines inside the fans: a read of the direction alone, so each runs dead straight
            // out (a read that changes with the radius turns rays to smoke).
            const hair = float(0.0).toVar();
            if (detail >= 3) {
                const fineRays = u.noise(
                    qc.mul(2.9).add(s1.xyz.sub(0.5).mul(0.16)).add(vec3(0.27, 0.71, 0.49)),
                ).toVar();
                const line = snRidge(fineRays.r);
                const line2 = line.mul(line);
                hair.assign(line2.mul(line2).mul(fineRays.g.mul(1.2).add(0.3)));
            }
            const inner = exp(x.mul(-4.2)).mul(float(1.0).sub(u.hole.mul(0.9)));
            // Every fan has a reach of its own: the wide ones run far out, the gaps die near the limb.
            const far = mix(float(2.5), float(0.85), body);
            const outer = exp(x.mul(far).negate()).div(float(1.0).add(x.mul(0.55)));
            const reach = float(1.0).sub(smoothstep(STAR.quad * 0.55, STAR.quad * 0.98, d));
            const corona = u.corona.mul(
                inner.mul(1.3).add(
                    outer.mul(float(0.06).add(body.mul(0.3))
                        .add(streak.mul(body.mul(0.9).add(0.25)).mul(1.4))
                        .add(hair.mul(body.mul(0.9).add(0.12)).mul(1.5)))
                        .mul(u.coronaGain),
                ),
            );
            // The chromosphere: a hairline of the rim's colour hugging the limb, and its soft skirt.
            // The chromosphere: a fringe of spicules standing on the limb, taller and shorter round
            // it (a band of even height read as an outline drawn round the disc), and its skirt.
            // The fringe is read only just off the limb, where it shows.
            const chromo = u.rim.mul(exp(x.mul(-9.0)).mul(0.2)).toVar();
            if (detail >= 2) {
                If(x.lessThan(0.14), () => {
                    const fringe = u.noise(qc.mul(1.8).add(vec3(0.0, u.boil.mul(0.02), 0.31))).toVar();
                    const tall = fringe.r.mul(1.4).add(0.3);
                    const spicule = snRidge(fringe.g).mul(0.6).add(0.4);
                    chromo.addAssign(u.rim.mul(exp(x.mul(-60.0).div(tall)).mul(2.6).mul(spicule)));
                });
            } else {
                chromo.addAssign(u.rim.mul(exp(x.mul(-50.0)).mul(2.2)));
            }
            out.assign(corona.add(chromo).mul(reach).mul(float(1.0).sub(smoothstep(3.8, 5.0, x))).mul(u.starGain));
            // A dark star: the light of what lies behind it, bent round it into a thin ring (and
            // a fainter second one), brighter on the side the gas is turning toward the eye.
            If(u.hole.greaterThan(0.002), () => {
                const toward = dot(dc, vec3(0.74, 0.21, 0.64)).mul(0.5).add(0.5);
                const second = x.sub(0.3).div(0.035);
                const bent = exp(x.mul(-30.0)).mul(2.6).add(exp(second.mul(second).negate()).mul(0.3));
                out.addAssign(mix(vec3(1.0, 0.9, 0.76), u.rim, 0.3).mul(bent).mul(toward.mul(0.75).add(0.25))
                    .mul(u.hole));
            });
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
            // Plasma on the move between the two: it drags the granules out of true (even cells
            // read as a net over a ball) and swings their heat in wide swirls.
            // (The lean tiers take them from the broad read instead: one fetch fewer on every
            // pixel of the disc, for swirls a little wider.)
            const swirl = detail >= 3
                ? u.noise(q.mul(0.62).add(warp.mul(0.24)).add(slide)).toVar()
                : cells.yzxw.toVar();
            // The granules: convection cells. Each is a hot dome with a dark lane along every
            // wall it shares, some lanes deep and some barely there.
            // (The lean tiers have no swirls at the granules' own scale to drag them by: a cheap
            // wave of the surface point does it instead, or the cells are a honeycomb.)
            const drag = detail >= 3 ? swirl.xyz.sub(0.5).mul(0.2) : sin(q.yzx.mul(6.3).add(q.zxy.mul(3.1))).mul(0.045);
            const grain = u.cells(q.mul(u.granules).add(drag).add(slide.mul(0.55))
                .add(vec3(0.43, 0.11, 0.67))).toVar();
            const wall = grain.g.toVar();
            const lane = float(1.0).sub(smoothstep(0.0, swirl.a.mul(0.22).add(0.1), wall))
                .mul(swirl.b.mul(1.1).add(0.3)).toVar();
            const dome = smoothstep(0.04, 0.62, wall).toVar();
            // Where the star is restless: spots (a dark heart in a dimmer fringe) open where the
            // broad field runs high, the more of them the stormier it is; a hot star burns them away.
            const cool = float(1.0).sub(clamp(u.heat, 0.0, 1.0)).toVar();
            const edge0 = mix(float(0.95), float(0.77), u.activity).toVar();
            // The broad field is a coarse volume read large: thresholded alone its outline is
            // straight-sided, so the swirls and the granules themselves ravel it.
            const spots = cells.g.add(swirl.r.sub(0.5).mul(0.14)).add(grain.b.sub(0.5).mul(0.07)).toVar();
            const fringe = smoothstep(edge0.sub(0.05), edge0.add(0.03), spots).mul(cool).toVar();
            const heart = smoothstep(edge0.add(0.03), edge0.add(0.12), spots).mul(cool).toVar();
            // Hot plasma with darker lanes between its cells: the giant cells swing the
            // temperature a little, each granule is a little hotter or cooler than the next, the
            // lanes cut in (a wider swing drew the surface as blotches of dark red and yellow).
            const T = float(0.6)
                .add(cells.r.sub(0.5).mul(0.4))
                .add(swirl.g.sub(0.5).mul(0.42))
                .add(dome.mul(grain.b.mul(0.3).add(0.06)))
                .sub(lane.mul(0.3))
                .toVar();
            if (detail >= 3) {
                // Up close (the icon, a 4K screen) there is room for the granules' own grain. Its
                // read would shimmer at the size the star usually has (the volume has no mips), so
                // it fades out as one of its cells shrinks toward a few pixels.
                const room = smoothstep(2.6, 6.0, R.div(pixel).div(u.granules.mul(MICRO * 6))).toVar();
                If(room.greaterThan(0.01), () => {
                    const micro = u.cells(q.mul(u.granules.mul(MICRO)).add(warp.zxy.mul(0.06))
                        .add(vec3(0.0, u.boil.mul(0.012), 0.37))).toVar();
                    T.addAssign(smoothstep(0.04, 0.5, micro.g).sub(0.55).mul(0.2).mul(room));
                });
            }
            // The bright network the granules sit in gathers round the spots, and shows most
            // toward the limb, where the eye looks along it.
            const limb = float(1.0).sub(mu).toVar();
            const plage = smoothstep(edge0.sub(0.2), edge0.sub(0.05), spots).mul(float(1.0).sub(fringe)).mul(cool);
            const network = float(1.0).sub(smoothstep(0.0, 0.3, grain.a));
            T.addAssign(plage.mul(network.mul(0.5).add(0.25)).mul(limb.mul(0.5).add(0.18)));
            // In a spot the granules give way: dimmer in the fringe, gone in the heart.
            T.assign(mix(T, float(0.5).add(dome.mul(0.12)), fringe.mul(0.6)));
            T.subAssign(heart.mul(0.22));
            // The limb is cooler, and a chain heats everything.
            T.addAssign(u.heat.mul(0.55).sub(limb.mul(limb).mul(0.5)).sub(limb.mul(0.12)));
            const temp = max(T, 0.0).toVar();
            // Brightness rises with temperature, less steeply than the colour: the lanes stay a darker
            // orange instead of going brown.
            const surface = ramp(temp).mul(float(0.62).add(temp.mul(temp).mul(1.9))).toVar();
            // A spot is dark as well as cool: its heart most, its fringe less.
            surface.mulAssign(float(1.0).sub(heart.mul(0.42)).sub(fringe.mul(0.2)));
            // White cracks along the lanes when the star is close to going: some walls first, and
            // near the end every one of them.
            const crack = float(1.0).sub(smoothstep(0.0, 0.09, wall));
            const open = smoothstep(0.42, 0.6, cells.b).add(u.fissure.mul(0.5));
            surface.addAssign(vec3(1.0, 0.95, 0.85).mul(crack.mul(open)).mul(u.fissure).mul(3.6));
            // Limb darkening: the disc falls off toward its edge as a real photosphere does.
            surface.mulAssign(mix(float(1.0), mu.pow(0.75), 0.88));

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
                    // (A mark, not a coat of paint: under a fast run of drops the star must stay
                    // its own colour, wearing the pieces as patches.)
                    surface.assign(mix(surface, dyed, clamp(patch.mul(live).mul(0.5), 0.0, 0.6)));
                    surface.addAssign(C.rgb.mul(flash.add(ripple.mul(1.7))).mul(live));
                }
            });

            // The electric edge: a hairline on the limb itself (the rest of it is outside the disc).
            const edge = float(1.0).sub(mu);
            const edge3 = edge.mul(edge).mul(edge);
            const rim = u.rim.mul(edge3.mul(edge3).mul(edge3)).mul(2.0);
            // (A dark star has no surface: its disc is black.)
            const lit = float(1.0).sub(u.hole).toVar();
            out.assign(mix(out, surface.add(rim).mul(u.starGain).mul(lit.mul(lit)), cover));
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
