/**
 * Solar Eclipse — the black sun and everything it wears, drawn in the sun's own plane.
 *
 * drawSun() is called inside the dome's fragment function with a point of the sun's plane
 * (x, y in solar radii, solar-eclipse-tsl.js sunPlane()) and returns four things the dome
 * composites: the light BEHIND the moon (corona, a coronal mass ejection, the prominences the
 * board raised, the chromosphere and the photosphere), how far the moon COVERS this point, the
 * moon's own FACE (earthshine), and the light in FRONT of it (the bead necklace a clear sends
 * round the limb, the diamond's glare).
 *
 *   corona       a dipole field (solar-eclipse-core.js CORONA): helmet arches along the streamer
 *                belt, the stalk above the cusp, polar plumes splaying out of the holes, then the
 *                extra streamers of the cycle; fine rays and slow puffs drift along field lines
 *   prominences  a table of arches, hedgerows and jets (one per lock), each in its piece's
 *                colour; an eruption lifts it off the limb and flings it out
 *   moon         a disc a little larger than the sun, its limb notched by lunar valleys: where a
 *                valley meets the photosphere, a bead shows
 *
 * Every texture read here sits inside a branch, so every one names its level.
 */
import {
    Loop,
    If,
    abs,
    acos,
    asin,
    atan,
    ceil,
    clamp,
    cos,
    dot,
    exp,
    float,
    int,
    length,
    log,
    max,
    min,
    mix,
    pow,
    round,
    select,
    sin,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import {
    CORONA, ERUPTION_SECONDS, KIND, MOON, PROMINENCES, PROMINENCE_FADE, PROMINENCE_RISE, STREAMERS, TAU,
} from './solar-eclipse-core.js';
import { noiseAt, seGauss } from './solar-eclipse-tsl.js';

/** Where the corona is no longer worth drawing (solar radii); it fades out before it. */
export const CORONA_REACH = 18;

const PHOTOSPHERE = vec3(1.0, 0.9, 0.74);
const WHITE_HOT = vec3(1.0, 0.96, 0.92);

/** An angle folded into (−π, π]. */
const wrap = (a) => a.sub(round(a.div(TAU)).mul(TAU));

/**
 * @param {{ u: object, noise: THREE.Texture, tier: object }} env
 * @param {Node} p  vec2, the point in the sun's plane (solar radii), screen-aligned
 * @param {Node} behind, cover, face, front  vars the results are written into; `spikes` takes
 *   the diamond's starburst, which belongs to the lens and is never seen in the mirror
 */
export function drawSun(env, p, {
    behind, cover, face, front, spikes,
}) {
    const { u, noise, tier } = env;
    const r = max(length(p), 1e-4).toVar();
    const ang = atan(p.y, p.x).toVar();
    const px = u.pxR;
    const t = u.time;

    // ── The moon: where it covers, and its limb notched by valleys ──
    const q = p.sub(u.moon.xy).toVar();
    const md = length(q).toVar();
    const ma = atan(q.y, q.x);
    const limbRead = noiseAt(noise, vec2(cos(ma), sin(ma)).mul(0.9).add(vec2(0.31, 0.77)), 0).a;
    const notch = pow(smoothstep(0.52, 0.92, limbRead), 2.0);
    const lumps = noiseAt(noise, vec2(cos(ma), sin(ma)).mul(2.3).add(vec2(0.62, 0.13)), 0).b.sub(0.5);
    const moonR = u.moon.z.sub(notch.mul(MOON.valley)).add(lumps.mul(0.0024)).toVar();
    const aa = max(px.mul(0.8), 0.0007);
    cover.assign(float(1.0).sub(smoothstep(moonR.sub(aa), moonR.add(aa), md)));

    // Its face: earthshine, the maria darker, the limb a little dimmer.
    If(cover.greaterThan(0.001), () => {
        const mare = noiseAt(noise, q.mul(0.42).add(vec2(0.27, 0.41)), 1.0).r;
        const seas = smoothstep(0.38, 0.66, mare);
        const rim = sqrt(clamp(float(1.0).sub(md.mul(md).div(moonR.mul(moonR))), 0.0, 1.0));
        const shine = u.earth.mul(u.moon.w.mul(0.0042).add(0.00035))
            .mul(float(1.0).sub(seas.mul(0.42))).mul(rim.mul(0.55).add(0.45));
        face.assign(shine.add(vec3(0.0005, 0.0006, 0.001)));
    });

    // ── The photosphere: only where the moon has slid off it (beads, the diamond) ──
    If(r.lessThan(1.002).and(cover.lessThan(0.999)), () => {
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), r));
        const darken = pow(clamp(float(1.0).sub(r.mul(r)), 0.0, 1.0), 0.25).mul(0.55).add(0.45);
        behind.addAssign(PHOTOSPHERE.mul(disc).mul(darken).mul(70.0));
    });

    // ── The corona ──
    If(r.greaterThan(0.995).and(r.lessThan(CORONA_REACH)), () => {
        // A T-spin twists it: most at the limb, unwinding outward.
        const tw = u.twist.mul(exp(r.sub(1.0).mul(-0.45)));
        const ct = cos(tw);
        const st = sin(tw);
        const pt = vec2(p.x.mul(ct).sub(p.y.mul(st)), p.x.mul(st).add(p.y.mul(ct)));
        // The solar frame: north along the axis, east across it.
        const north = vec2(sin(u.axis).negate(), cos(u.axis));
        const east = vec2(north.y, north.x.negate());
        const sy = dot(pt, north).div(r).toVar();
        const sx = dot(pt, east).div(r).toVar();
        // The real field is never a clean dipole: a broad warp round the limb tilts the belt up
        // and down, so the two helmets are uneven. It depends on the position angle alone, so
        // beyond the source surface a ray stays straight.
        const psi = atan(sy, sx);
        const warp = noiseAt(noise, vec2(cos(psi), sin(psi)).mul(0.27).add(vec2(t.mul(0.0006), 0.58)), 2.0).r
            .sub(0.5).mul(0.42);
        const lat = asin(clamp(sy, -1.0, 1.0)).sub(warp).toVar();
        const cosLat = cos(lat);
        // The field line's foot (dipole inside the source surface, radial beyond it).
        const rEff = min(r, CORONA.sourceSurface);
        const foot = acos(clamp(cosLat.div(sqrt(rEff)), 0.0, 1.0)).toVar();
        const cusp = CORONA.cuspLatitude;
        const closed = float(1.0).sub(smoothstep(cusp - 0.24, cusp + 0.035, foot)).toVar();
        const hole = smoothstep(cusp + 0.06, cusp + 0.38, foot);
        const plumeZone = smoothstep(cusp + 0.2, cusp + 0.5, foot);

        // Fine rays along the field lines. Each quadrant reads its own row of the noise (north
        // and south of the current sheet, east and west of the axis), moving smoothly from one
        // row to the next across the seams, so no limb mirrors another.
        const sideNS = smoothstep(-0.11, 0.11, lat.mul(min(r, 1.7)));
        const sideEW = smoothstep(-0.06, 0.06, sx.mul(r));
        const row = sideNS.mul(0.44).add(sideEW.mul(0.23)).add(0.17);
        const footprint = px.div(r).mul(2.4 * 256.0);
        const lod = clamp(log(max(footprint, 1.0)).div(Math.LN2), 0.0, 6.0);
        const drift = t.mul(0.0014);
        // The rays follow the field, but more gently than the dipole bends it: away from the
        // closed arches they lean toward the radial.
        const radial = acos(clamp(cosLat.div(Math.sqrt(CORONA.sourceSurface)), 0.0, 1.0));
        const label = mix(radial, foot, closed.mul(0.45).add(0.45));
        const coarse = noiseAt(noise, vec2(label.mul(2.4), drift.add(row)), lod).b;
        const rays = smoothstep(0.2, 0.84, coarse).toVar();
        if (tier.rays >= 2) {
            const lod2 = clamp(lod.add(1.15), 0.0, 6.0);
            const fineAt = vec2(label.mul(5.3).add(0.21), drift.mul(1.7).add(row.mul(1.9)).add(0.43));
            const fine = noiseAt(noise, fineAt, lod2).a;
            rays.assign(rays.mul(smoothstep(0.14, 0.9, fine).mul(0.75).add(0.4)));
        }
        // Inside the closed arches the light is smooth, the loops only a whisper; outside them
        // the rays are full; in the polar holes they are the plumes' fine brushes.
        const open = rays.mul(0.62).add(0.62);
        const loops = rays.mul(0.14).add(0.9);
        const plumes = pow(rays, 1.7).mul(1.5).add(0.12);
        const rayMod = mix(mix(open, loops, closed), plumes, plumeZone).toVar();

        // The belt: the helmets, brightest along the equator and at the cusp where their loops
        // meet, then the stalk beyond it, narrowing into a long pointed wing.
        const quiet = float(1.0).sub(u.cycle.mul(0.55));
        const helmet = closed.mul(seGauss(lat.div(0.42)).mul(0.5).add(0.62));
        const cuspGlow = seGauss(foot.sub(cusp).div(0.05)).mul(smoothstep(1.35, 2.35, r));
        const stalkWidth = float(0.2).div(r).add(0.075);
        const stalk = seGauss(lat.div(stalkWidth)).mul(smoothstep(1.7, 2.6, r)).toVar();
        // Along the stalk the rays calm: it is one long smooth wing, not a bundle of beams.
        rayMod.assign(mix(rayMod, rays.mul(0.3).add(0.85), stalk.mul(0.7)));
        const dipole = helmet.mul(1.15).add(cuspGlow.mul(0.55)).add(stalk.mul(1.5))
            .add(closed.oneMinus().mul(float(1.0).sub(hole.mul(0.55))).mul(0.4));

        // The cycle's extra streamers: a bulb at the base narrowing to a stalk.
        const narrow = mix(float(1.0), float(0.28), smoothstep(1.15, 2.8, r));
        const extra = float(0.0).toVar();
        const wing = float(0.0).toVar();
        Loop({
            start: int(0), end: int(STREAMERS), type: 'int', condition: '<', name: 'st',
        }, ({ st: i }) => {
            const strand = u.streamers.element(i);
            If(strand.z.greaterThan(0.002), () => {
                const off = wrap(psi.sub(strand.x));
                extra.addAssign(seGauss(off.div(strand.y.mul(narrow))).mul(strand.z));
                // Its wing: a narrow tapering streamer, never a beam.
                wing.addAssign(seGauss(off.div(strand.y.mul(0.32))).mul(strand.z).mul(smoothstep(1.4, 2.5, r))
                    .mul(0.5));
            });
        });
        const structure = dipole.mul(quiet).add(extra).add(u.cycle.mul(0.3)).toVar();

        // Slow puffs drifting outward along the field lines: a breath, never smoke.
        if (tier.flow) {
            const puffAt = vec2(foot.mul(0.55).add(row.mul(0.37)), log(r).mul(1.15).sub(t.mul(0.03)));
            const puff = noiseAt(noise, puffAt, clamp(lod.sub(1.0), 0.0, 6.0)).g;
            structure.mulAssign(puff.mul(0.3).add(0.85));
        }

        const exposure = u.exposure.mul(CORONA.exposureGain).add(1.0);
        const inner = pow(r, -CORONA.innerPower).mul(CORONA.inner);
        const outer = pow(r, -CORONA.outerPower).mul(CORONA.outer).mul(exposure);
        // The streamers' stalks fall off far more slowly than the corona round them: the long
        // wings of a quiet sun.
        const stalks = stalk.mul(quiet).add(wing.mul(0.75));
        const reachOut = pow(r, -1.85).mul(CORONA.outer * 1.1).mul(exposure).mul(stalks);
        const light = inner.mul(structure.mul(0.45).add(0.55)).add(outer.mul(structure)).add(reachOut)
            .mul(rayMod)
            .mul(u.surge.mul(0.6).add(1.0))
            .toVar();
        // A faint aureole round it all, then the reach's soft end.
        light.addAssign(pow(r, -1.6).mul(0.012).mul(exposure));
        light.mulAssign(float(1.0).sub(smoothstep(CORONA_REACH * 0.6, CORONA_REACH, r)));
        light.mulAssign(smoothstep(0.995, 1.004, r));

        // ── Coronal mass ejections: a bright front, a dark cavity, a twisted core. Two may be in
        // the air at once (a back-to-back's twins, a deep cascade's), so one never cuts another.
        const ejection = (cme) => {
            const cAge = t.sub(cme.y);
            If(cme.z.greaterThan(0.001).and(cAge.greaterThan(0.0)).and(cAge.lessThan(8.0)), () => {
                const dir = vec2(cos(cme.x), sin(cme.x));
                const travel = float(1.0).sub(exp(cAge.div(-2.3)));
                const reach = travel.mul(6.0).add(0.15);
                const rb = reach.mul(0.4).mul(cme.w).add(0.05);
                const centre = dir.mul(reach.add(1.0).sub(rb));
                const v = p.sub(centre);
                const dv = max(length(v), 1e-4);
                const facing = dot(v.div(dv), dir);
                const fan = atan(v.y, v.x);
                const fibre = noiseAt(noise, vec2(cos(fan), sin(fan)).mul(1.4).add(vec2(cAge.mul(0.05), 0.33)), 1.0).b;
                const width = rb.mul(0.16).add(0.05);
                const legs = smoothstep(-0.55, 0.2, facing);
                const rim = seGauss(dv.sub(rb).div(width)).mul(legs).mul(fibre.mul(0.9).add(0.55));
                const inside = float(1.0).sub(smoothstep(rb.mul(0.7), rb.add(width), dv)).mul(legs);
                const fade = smoothstep(0.0, 0.3, cAge).mul(exp(cAge.div(-2.8))).mul(cme.z);
                light.mulAssign(rim.mul(3.2).add(inside.mul(1.4)).mul(fade).add(1.0));
                behind.addAssign(u.coronaIn.mul(rim).mul(fade).mul(0.16).div(reach.mul(0.3).add(1.0)));
            });
        };
        ejection(u.cme);
        ejection(u.cme2);

        const tint = mix(u.coronaIn, u.coronaOut, smoothstep(1.05, 2.8, r));
        behind.addAssign(tint.mul(light));

        // ── The chromosphere: a thin pink skin with spicules, lifted by a flash ──
        If(r.lessThan(1.12), () => {
            const spic = noiseAt(noise, vec2(cos(ang), sin(ang)).mul(1.9).add(vec2(t.mul(0.01), 0.5)), 0).a;
            const top = spic.mul(0.6).add(0.55).mul(MOON.chromosphere).add(u.flash.mul(MOON.flashLift))
                .add(1.0);
            const edge = max(px, 0.003);
            const band = smoothstep(float(0.996), float(1.001), r)
                .mul(float(1.0).sub(smoothstep(top.sub(edge), top.add(edge), r)));
            behind.addAssign(u.chromo.mul(band).mul(u.flash.mul(2.5).add(3.2)));
        });
    });

    // ── The prominences the board raised ──
    If(r.lessThan(9.0), () => {
        Loop({
            start: int(0), end: int(PROMINENCES), type: 'int', condition: '<', name: 'pr',
        }, ({ pr: i }) => {
            const base = i.mul(3);
            const A = u.prominences.element(base); // (angle, half-width, height, seed)
            const B = u.prominences.element(base.add(1)); // (born, erupts, fades, kind)
            const C = u.prominences.element(base.add(2)); // (rgb, power)
            const age = t.sub(B.x);
            If(C.w.greaterThan(0.001).and(age.greaterThan(0.0)), () => {
                const erupt = max(t.sub(B.y), 0.0).toVar();
                const lift = erupt.mul(0.7).add(erupt.mul(erupt).mul(0.62));
                const grow = erupt.mul(0.75).add(1.0);
                const s = wrap(ang.add(u.twist.mul(exp(r.sub(1.0).mul(-0.45)))).sub(A.x)).mul(r).toVar();
                const z = r.sub(1.0).sub(lift).toVar();
                const rise = smoothstep(0.0, PROMINENCE_RISE, age);
                // An erupting loop widens as it climbs: a bubble of field carried out.
                const hw = A.y.mul(erupt.mul(0.85).add(1.0)).toVar();
                const isJet = B.w.greaterThan(KIND.jet - 0.5);
                const tall = select(isJet, float(7.0), A.z.mul(grow).mul(rise.mul(0.82).add(0.18))).max(0.02).toVar();
                // The box it is drawn in grows as it erupts (an eruption sways and spreads beyond
                // its held shape), and its light fades out before the box's edge, never cut by it.
                const goes = clamp(erupt.mul(0.8), 0.0, 1.0);
                const boxS = hw.mul(goes.mul(1.4).add(1.6)).add(goes.mul(0.3).add(0.08)).toVar();
                const boxZ = tall.mul(1.45).add(goes.mul(0.6).add(0.1)).toVar();
                const near = abs(s).lessThan(boxS).and(z.lessThan(boxZ)).and(z.greaterThan(goes.mul(-0.6).sub(0.08)));
                If(near, () => {
                    const life = float(1.0).sub(smoothstep(B.z.sub(PROMINENCE_FADE), B.z, t));
                    const spent = smoothstep(ERUPTION_SECONDS * 0.55, ERUPTION_SECONDS * 0.2, erupt);
                    const gone = select(isJet, exp(erupt.div(-0.9)), exp(erupt.div(-0.75)).mul(spent));
                    const fade = life.mul(gone).mul(smoothstep(0.0, 0.12, age));
                    // Read by every kind's branch, so pinned before them. An erupting loop's legs
                    // trail away below it rather than end on a line.
                    const up = smoothstep(goes.mul(-0.55).sub(0.03), goes.mul(0.12).add(0.02), z).toVar();
                    const glow = float(0.0).toVar();

                    // How far an eruption has gone: 0 held, 1 well on its way out.
                    const going = goes.toVar();
                    const inBox = float(1.0).sub(smoothstep(boxS.mul(0.72), boxS, abs(s)))
                        .mul(float(1.0).sub(smoothstep(boxZ.mul(0.78), boxZ, z))).toVar();

                    // As it erupts the frame it is drawn in bends in long, slow sways (a rope
                    // twisting free, never a scribble).
                    const wobAt = vec2(s.mul(0.9).add(A.w.mul(9.0)), z.mul(0.7).sub(t.mul(0.18)));
                    const wob = noiseAt(noise, wobAt, 1.5).r.sub(0.5)
                        .mul(going.mul(0.24).add(0.03));
                    const sw = s.add(wob).toVar();
                    const zw = z.add(wob.mul(0.5)).toVar();
                    // A thread is a pixel or so while it is held, and spreads as the plasma thins.
                    const thin = max(px.mul(1.1), 0.011).mul(going.mul(1.6).add(1.0)).toVar();
                    // A hedgerow that erupts lifts off as a loop, as an arch does.
                    const erupting = B.w.lessThan(KIND.hedge + 0.5).and(going.greaterThan(0.0));
                    const loop = B.w.lessThan(KIND.arch + 0.5).or(erupting);
                    If(loop, () => {
                        // An arch: a flux rope along one loop with fainter loops nested under it,
                        // hottest where its feet stand in the chromosphere, its threads wound round
                        // it, knots of plasma draining down its legs.
                        const e = length(vec2(sw.div(hw), zw.div(tall))).toVar();
                        const along = atan(zw.div(tall), sw.div(hw)).toVar();
                        const span = min(hw, tall).toVar();
                        // Across the rope, in thread widths from its middle.
                        const across = e.sub(0.9).mul(span).div(thin).toVar();
                        const rope = seGauss(across.div(3.4));
                        // The arcade under it: lower loops of the same system, fainter and softer.
                        const arcade = seGauss(e.sub(0.68).mul(span).div(thin.mul(1.8))).mul(0.24)
                            .add(seGauss(e.sub(0.48).mul(span).div(thin.mul(1.8))).mul(0.11));
                        let threads = seGauss(across.div(1.6)).mul(0.9).add(0.35);
                        let wound = float(1.0);
                        if (tier.fibres) {
                            const fibreAt = vec2(across.mul(0.035).add(A.w.mul(5.0)), along.mul(0.25)
                                .add(A.w.mul(3.0)));
                            const fibre = pow(noiseAt(noise, fibreAt, 0.5).b, 1.6).mul(2.0).add(0.2);
                            const flow = along.mul(0.8).add(A.w.mul(13.0)).sub(t.mul(0.06));
                            const knot = pow(noiseAt(noise, vec2(flow, A.w.mul(2.0).add(0.4)), 0).g, 1.4)
                                .mul(1.3).add(0.5);
                            threads = fibre.mul(knot);
                            // Strands wound round the rope: diagonal across it, turning slowly.
                            const turns = sin(across.mul(0.95).add(along.mul(16.0)).add(A.w.mul(40.0)).sub(t.mul(0.5)));
                            wound = turns.mul(0.42).add(0.78);
                        }
                        const feet = float(1.0).sub(sin(along)).mul(0.7).add(0.65);
                        const haze = seGauss(e.sub(0.8).div(0.4)).mul(0.1);
                        glow.assign(rope.mul(threads).mul(wound).add(arcade.mul(threads.mul(0.4).add(0.6)))
                            .mul(feet)
                            .add(haze)
                            .mul(up));
                    }).ElseIf(B.w.lessThan(KIND.hedge + 0.5), () => {
                        // A hedgerow: a ragged sheet of threads standing on the limb, its sides
                        // fraying rather than cut.
                        const across = sw.div(hw);
                        const crown = noiseAt(noise, vec2(s.mul(1.6).add(A.w.mul(7.0)), t.mul(0.004).add(0.3)), 0).r;
                        const dome = max(float(1.0).sub(across.mul(across)), 0.0);
                        const top = tall.mul(crown.mul(0.6).add(0.45)).mul(dome);
                        const inside = smoothstep(top, top.sub(going.mul(0.25).add(0.03)), zw).mul(up);
                        let threads = float(0.75);
                        if (tier.fibres) {
                            const threadAt = vec2(sw.mul(7.5).add(A.w.mul(5.0)), zw.mul(0.9).sub(t.mul(0.025)));
                            threads = pow(noiseAt(noise, threadAt, 0).b, 2.0)
                                .mul(2.4).add(0.12);
                        }
                        glow.assign(inside.mul(threads).mul(float(1.0).sub(zw.div(tall.add(0.001)).mul(0.5))));
                    }).Else(() => {
                        // A jet: a spray of fine rays running out from the limb.
                        const head = erupt.mul(3.4).add(0.05);
                        const cone = z.max(0.0).mul(0.03).add(0.014);
                        const ray = seGauss(s.div(cone));
                        let strands = float(1.0);
                        if (tier.fibres) {
                            const strandAt = vec2(s.div(cone).mul(0.11).add(A.w.mul(7.0)), z.mul(0.12)
                                .sub(erupt.mul(0.3)));
                            strands = pow(noiseAt(noise, strandAt, 0.5).b, 2.0).mul(2.2).add(0.25);
                        }
                        const run = smoothstep(head, head.sub(0.3), z).mul(exp(head.sub(z).div(-1.1)));
                        glow.assign(ray.mul(strands).mul(run).mul(up).mul(1.5));
                    });

                    // It is born in a flare at its feet: a bright knot on the limb that fades as the
                    // prominence climbs.
                    const flareAge = age.sub(0.02);
                    const flare = seGauss(length(vec2(sw, zw)).div(hw.mul(0.22).add(0.025)))
                        .mul(exp(flareAge.div(-0.42).max(-30.0)))
                        .mul(smoothstep(0.0, 0.04, flareAge))
                        .mul(C.w.mul(C.w).mul(3.2));
                    glow.addAssign(flare);

                    // As it erupts it thins into strands and cools: soft gaps open, never cut.
                    const tear = noiseAt(noise, vec2(sw.mul(0.7).add(A.w), zw.mul(0.5).sub(erupt.mul(0.2))), 2.5).r;
                    glow.mulAssign(mix(float(1.0), smoothstep(0.25, 0.75, tear).mul(1.3), going).mul(inBox));
                    const hot = clamp(glow.mul(0.5), 0.0, 1.0);
                    // Rooted in the chromosphere: its feet take the limb's own pink, the body the
                    // piece's colour.
                    const rooted = float(1.0).sub(smoothstep(0.0, 0.4, zw.div(tall)));
                    const body = mix(C.xyz, u.chromo, rooted.mul(0.42).add(0.14));
                    const shade = mix(body, WHITE_HOT, hot.mul(hot).mul(0.5));
                    behind.addAssign(shade.mul(glow).mul(C.w).mul(fade).mul(1.8));
                });
            });
        });
    });

    // ── In front: the bead necklace the clears send round the limb ──
    // The world turns it and lights it (u.beads: turn, −, count, light); the count may be
    // fractional while a new bead splits off the first and slides into its place, so clears that
    // come quickly ADD pearls to the necklace still turning instead of restarting it.
    If(u.beads.w.greaterThan(0.001).and(r.lessThan(1.4)), () => {
        const count = max(u.beads.z, 1.0);
        const ring = seGauss(r.sub(1.03).div(max(px.mul(1.2), 0.012)));
        Loop({
            start: int(0), end: int(ceil(u.beads.z)), type: 'int', condition: '<', name: 'bd',
        }, ({ bd: i }) => {
            const a = u.beads.x.add(float(i).mul(TAU).div(count));
            const pos = vec2(cos(a), sin(a)).mul(1.03);
            const d = length(p.sub(pos));
            const pearl = seGauss(d.div(max(px.mul(1.6), 0.022))).mul(8.0).add(exp(d.div(-0.08)).mul(1.1));
            const behindIt = wrap(a.sub(ang));
            const tail = exp(behindIt.div(-0.42)).mul(smoothstep(-0.02, 0.02, behindIt)).mul(ring).mul(1.4);
            const share = clamp(u.beads.z.sub(float(i)), 0.0, 1.0);
            front.addAssign(PHOTOSPHERE.mul(pearl.add(tail)).mul(u.beads.w.mul(share)));
        });
    });

    // ── In front: the diamond's glare, a lens's starburst ──
    If(u.diamond.z.greaterThan(0.001), () => {
        const g = p.sub(u.diamond.xy);
        const d = length(g);
        const core = seGauss(d.div(0.026)).mul(30.0).add(exp(d.div(-0.09)).mul(3.2))
            .add(float(0.45).div(d.mul(d).div(0.06).add(1.0)));
        const spin = u.diamond.w;
        const spike = (angle, reach, width) => {
            const e = vec2(cos(angle), sin(angle));
            const along = abs(dot(g, e));
            const across = abs(dot(g, vec2(e.y, e.x.negate())));
            return exp(across.div(along.mul(width).add(0.003)).negate()).mul(exp(along.div(-reach)));
        };
        const star = spike(spin, 0.95, 0.014).add(spike(spin.add(Math.PI / 2), 0.95, 0.014)).mul(0.75)
            .add(spike(spin.add(Math.PI / 4), 0.5, 0.01).add(spike(spin.add((3 * Math.PI) / 4), 0.5, 0.01)).mul(0.3));
        front.addAssign(vec3(1.0, 0.95, 0.86).mul(core).mul(u.diamond.z));
        spikes.addAssign(vec3(1.0, 0.95, 0.86).mul(star).mul(u.diamond.z));
    });

    return { r, ang };
}
