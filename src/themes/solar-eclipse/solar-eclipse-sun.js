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
    atan,
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
 * @param {Node} behind, cover, face, front  vars the results are written into
 */
export function drawSun(env, p, {
    behind, cover, face, front,
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
        const sx = dot(pt, east).div(r);
        const cosLat = sqrt(max(float(1.0).sub(sy.mul(sy)), 0.0));
        // The field line's foot (dipole inside the source surface, radial beyond it).
        const rEff = min(r, CORONA.sourceSurface);
        const pure = acos(clamp(cosLat.div(sqrt(rEff)), 0.0, 1.0));
        // The real field is never a clean dipole: a slow, broad warp bends every line a little,
        // so the arches are uneven and the belt rides up and down round the limb.
        const sideAngle = atan(sy, sx);
        const warp = noiseAt(noise, vec2(cos(sideAngle), sin(sideAngle)).mul(0.3)
            .add(vec2(log(rEff).mul(0.24).add(t.mul(0.0007)), 0.58)), 2.0).r.sub(0.5);
        const foot = pure.add(warp.mul(0.11)).toVar();
        const cusp = CORONA.cuspLatitude;
        const closed = float(1.0).sub(smoothstep(cusp - 0.3, cusp + 0.08, foot)).toVar();
        const stalk = seGauss(foot.sub(cusp).div(0.075)).mul(smoothstep(1.15, 2.1, r)).toVar();
        const hole = smoothstep(cusp + 0.04, cusp + 0.32, foot);
        const plumeZone = smoothstep(1.0, 1.25, foot);

        // Fine rays along the field lines: north and south of the current sheet each read their
        // own row, blended across it so the sheet is a soft seam, never a cut.
        const side = smoothstep(-0.09, 0.09, sy.mul(r));
        const footprint = px.div(r).mul(1.3 * 256.0);
        const lod = clamp(log(max(footprint, 1.0)).div(Math.LN2), 0.0, 6.0);
        const drift = t.mul(0.0016);
        const rayN = noiseAt(noise, vec2(foot.mul(1.3), drift.add(0.17)), lod).b;
        const rayS = noiseAt(noise, vec2(foot.mul(1.3).add(0.5), drift.add(0.61)), lod).b;
        const rays = smoothstep(0.22, 0.86, mix(rayS, rayN, side)).toVar();
        if (tier.rays >= 2) {
            const lod2 = clamp(lod.add(1.25), 0.0, 6.0);
            const fineN = noiseAt(noise, vec2(foot.mul(3.1).add(0.21), drift.mul(1.7).add(0.43)), lod2).a;
            const fineS = noiseAt(noise, vec2(foot.mul(3.1).add(0.71), drift.mul(1.7).add(0.88)), lod2).a;
            rays.assign(rays.mul(smoothstep(0.18, 0.9, mix(fineS, fineN, side)).mul(0.7).add(0.45)));
        }
        const plumes = pow(rays, 1.9).mul(1.35);
        // Inside the closed arches the rays are faint (the loops are smooth), outside them full.
        const open = rays.mul(0.95).add(0.45);
        const rayMod = mix(mix(open, rays.mul(0.18).add(0.92), closed.mul(0.85)), plumes.add(0.18), plumeZone);

        // The belt's helmets (brighter toward their outer loops), the stalk above the cusp, the
        // holes darker save for their plumes.
        const belt = seGauss(sy.div(0.45));
        const helmet = closed.mul(belt.mul(0.95).add(0.35));
        const dipole = helmet.mul(1.15).add(stalk.mul(1.6))
            .add(closed.oneMinus().mul(float(1.0).sub(hole.mul(0.5))).mul(0.4));

        // The cycle's extra streamers: a bulb at the base, a stalk outward.
        const psi = atan(sy, sx);
        const narrow = mix(float(1.0), float(0.3), smoothstep(1.15, 3.0, r));
        const extra = float(0.0).toVar();
        const wing = float(0.0).toVar();
        Loop({
            start: int(0), end: int(STREAMERS), type: 'int', condition: '<', name: 'st',
        }, ({ st: i }) => {
            const row = u.streamers.element(i);
            If(row.z.greaterThan(0.002), () => {
                const off = wrap(psi.sub(row.x));
                extra.addAssign(seGauss(off.div(row.y.mul(narrow))).mul(row.z));
                // Its wing: a broad tapering streamer, never a beam.
                wing.addAssign(seGauss(off.div(row.y.mul(0.5))).mul(row.z).mul(smoothstep(1.3, 2.4, r)).mul(0.55));
            });
        });
        const structure = dipole.mul(float(1.0).sub(u.cycle.mul(0.5))).add(extra).add(u.cycle.mul(0.3)).toVar();

        // Slow puffs drifting outward along the field lines.
        if (tier.flow) {
            const puffAt = vec2(foot.mul(0.55).add(side.mul(0.37)), log(r).mul(1.15).sub(t.mul(0.03)));
            const puff = noiseAt(noise, puffAt, clamp(lod.sub(1.0), 0.0, 6.0)).g;
            structure.mulAssign(puff.mul(0.55).add(0.73));
        }

        const exposure = u.exposure.mul(CORONA.exposureGain).add(1.0);
        const inner = pow(r, -CORONA.innerPower).mul(CORONA.inner);
        const outer = pow(r, -CORONA.outerPower).mul(CORONA.outer).mul(exposure);
        // The streamers' stalks fall off far more slowly than the corona round them: the long
        // wings of a quiet sun.
        const stalks = stalk.mul(float(1.0).sub(u.cycle.mul(0.6))).add(wing.mul(0.75));
        const reachOut = pow(r, -1.55).mul(CORONA.outer * 0.95).mul(exposure).mul(stalks);
        const light = inner.mul(structure.mul(0.45).add(0.55)).add(outer.mul(structure)).add(reachOut)
            .mul(rayMod)
            .mul(u.surge.mul(0.6).add(1.0))
            .toVar();
        // A faint aureole round it all, then the reach's soft end.
        light.addAssign(pow(r, -1.6).mul(0.012).mul(exposure));
        light.mulAssign(float(1.0).sub(smoothstep(CORONA_REACH * 0.6, CORONA_REACH, r)));
        light.mulAssign(smoothstep(0.995, 1.004, r));

        // ── A coronal mass ejection: a bright front, a dark cavity, a twisted core ──
        const cAge = t.sub(u.cme.y);
        If(u.cme.z.greaterThan(0.001).and(cAge.greaterThan(0.0)).and(cAge.lessThan(8.0)), () => {
            const dir = vec2(cos(u.cme.x), sin(u.cme.x));
            const travel = float(1.0).sub(exp(cAge.div(-2.3)));
            const reach = travel.mul(6.0).add(0.15);
            const rb = reach.mul(0.4).mul(u.cme.w).add(0.05);
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
            const fade = smoothstep(0.0, 0.3, cAge).mul(exp(cAge.div(-2.8))).mul(u.cme.z);
            light.mulAssign(rim.mul(3.2).add(inside.mul(1.4)).mul(fade).add(1.0));
            behind.addAssign(u.coronaIn.mul(rim).mul(fade).mul(0.075).div(reach.mul(0.3).add(1.0)));
        });

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
                const hw = A.y.mul(erupt.mul(0.3).add(1.0)).div(lift.mul(0.5).add(1.0)).toVar();
                const isJet = B.w.greaterThan(KIND.jet - 0.5);
                const tall = select(isJet, float(7.0), A.z.mul(grow).mul(rise.mul(0.82).add(0.18))).max(0.02).toVar();
                const near = abs(s).lessThan(hw.mul(1.6).add(0.08)).and(z.lessThan(tall.mul(1.45).add(0.1)))
                    .and(z.greaterThan(-0.08));
                If(near, () => {
                    const life = float(1.0).sub(smoothstep(B.z.sub(PROMINENCE_FADE), B.z, t));
                    const spent = smoothstep(ERUPTION_SECONDS * 0.55, ERUPTION_SECONDS * 0.2, erupt);
                    const gone = select(isJet, exp(erupt.div(-0.9)), exp(erupt.div(-0.75)).mul(spent));
                    const fade = life.mul(gone).mul(smoothstep(0.0, 0.12, age));
                    const up = smoothstep(-0.03, 0.02, z);
                    const glow = float(0.0).toVar();

                    // As it erupts it twists and tears: the frame it is drawn in wobbles.
                    const wobAt = vec2(s.mul(1.7).add(A.w.mul(9.0)), z.mul(1.3).sub(t.mul(0.22)));
                    const wob = noiseAt(noise, wobAt, 1.0).r.sub(0.5)
                        .mul(erupt.mul(0.32).add(0.035));
                    const sw = s.add(wob).toVar();
                    const zw = z.add(wob.mul(0.6)).toVar();
                    const thin = max(px.mul(1.1), 0.011);
                    If(B.w.lessThan(KIND.arch + 0.5), () => {
                        // An arch: three strands of one loop, knots flowing along them.
                        const e = length(vec2(sw.div(hw), zw.div(tall)));
                        const along = atan(zw.div(tall), sw.div(hw));
                        const span = min(hw, tall);
                        const strand = (k, w) => seGauss(e.sub(1.0 - k * 0.11).mul(span).div(thin.mul(w)));
                        const tube = strand(0, 1.5).add(strand(1, 1.1).mul(0.75)).add(strand(2, 0.9).mul(0.5));
                        let knots = float(0.85);
                        if (tier.fibres) {
                            const flow = along.mul(0.8).add(A.w.mul(13.0)).sub(t.mul(0.06));
                            const knotAt = vec2(flow, e.mul(0.6).add(A.w));
                            knots = pow(noiseAt(noise, knotAt, 0).g, 1.6)
                                .mul(2.2).add(0.2);
                        }
                        const haze = seGauss(e.div(1.1)).mul(0.07);
                        glow.assign(tube.mul(knots).add(haze).mul(up));
                    }).ElseIf(B.w.lessThan(KIND.hedge + 0.5), () => {
                        // A hedgerow: a ragged sheet of threads standing on the limb.
                        const across = s.div(hw);
                        const crown = noiseAt(noise, vec2(s.mul(1.6).add(A.w.mul(7.0)), t.mul(0.004).add(0.3)), 0).r;
                        const dome = sqrt(max(float(1.0).sub(across.mul(across)), 0.0));
                        const top = tall.mul(crown.mul(0.6).add(0.45)).mul(dome);
                        const inside = smoothstep(top, top.sub(0.03), zw).mul(up);
                        let threads = float(0.75);
                        if (tier.fibres) {
                            const threadAt = vec2(sw.mul(7.5).add(A.w.mul(5.0)), zw.mul(0.9).sub(t.mul(0.025)));
                            threads = pow(noiseAt(noise, threadAt, 0).b, 2.0)
                                .mul(2.4).add(0.12);
                        }
                        glow.assign(inside.mul(threads).mul(float(1.0).sub(zw.div(tall.add(0.001)).mul(0.5))));
                    }).Else(() => {
                        // A jet: a narrow ray running out from the limb.
                        const head = erupt.mul(3.4).add(0.05);
                        const ray = seGauss(s.div(z.max(0.0).mul(0.035).add(0.02)));
                        const run = smoothstep(head, head.sub(0.12), z).mul(exp(head.sub(z).div(-1.1)));
                        glow.assign(ray.mul(run).mul(up).mul(1.6));
                    });

                    // As it erupts it breaks into blobs and cools.
                    const tear = noiseAt(noise, vec2(sw.mul(0.9).add(A.w), zw.mul(0.7)), 2.0).r;
                    const torn = mix(float(1.0), smoothstep(0.32, 0.68, tear), clamp(erupt.mul(0.8), 0.0, 1.0));
                    glow.mulAssign(torn);
                    const hot = clamp(glow.mul(0.5), 0.0, 1.0);
                    const shade = mix(mix(C.xyz, u.chromo, 0.18), WHITE_HOT, hot.mul(hot).mul(0.5));
                    behind.addAssign(shade.mul(glow).mul(C.w).mul(fade).mul(1.8));
                });
            });
        });
    });

    // ── In front: the bead necklace a clear sends round the limb ──
    const bAge = t.sub(u.beads.y);
    If(u.beads.w.greaterThan(0.001).and(bAge.greaterThan(0.0)).and(bAge.lessThan(3.4)).and(r.lessThan(1.4)), () => {
        const count = max(u.beads.z, 1.0);
        const ring = seGauss(r.sub(1.03).div(max(px.mul(1.2), 0.012)));
        const fade = smoothstep(0.0, 0.08, bAge).mul(float(1.0).sub(smoothstep(2.1, 3.4, bAge))).mul(u.beads.w);
        Loop({
            start: int(0), end: int(u.beads.z), type: 'int', condition: '<', name: 'bd',
        }, ({ bd: i }) => {
            const a = u.beads.x.add(float(i).mul(TAU).div(count)).add(bAge.mul(2.7));
            const pos = vec2(cos(a), sin(a)).mul(1.03);
            const d = length(p.sub(pos));
            const pearl = seGauss(d.div(max(px.mul(1.6), 0.022))).mul(8.0).add(exp(d.div(-0.08)).mul(1.1));
            const behindIt = wrap(a.sub(ang));
            const tail = exp(behindIt.div(-0.42)).mul(smoothstep(-0.02, 0.02, behindIt)).mul(ring).mul(1.4);
            front.addAssign(PHOTOSPHERE.mul(pearl.add(tail)).mul(fade));
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
        front.addAssign(vec3(1.0, 0.95, 0.86).mul(core.add(star)).mul(u.diamond.z));
    });

    return { r, ang };
}
