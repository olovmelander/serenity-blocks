/**
 * Cosmic Noir — the smoke, the lantern and the sky behind them.
 *
 * The smoke is painted once per frame into a reduced-resolution target: it is soft, so it does not
 * need the screen's pixels. It is walked along the view ray, front to back, with steps that grow
 * with distance, and lit by:
 *   - the pulsar's two beams, sweeping like a lighthouse's. They leave through the shutter cage,
 *     so where a beam crosses the slats it is cut into a fan of shafts (light through blinds).
 *     Smoke scatters a beam forward: a beam that looks toward us is a blaze, one that looks away a
 *     pale shaft;
 *   - the core's own glow round the lantern, through the slats too: radial bars in the near smoke;
 *   - light echoes (clears): shells of light expanding from the pulsar, which light the smoke they
 *     pass through and so draw its shape in rings;
 *   - puffs (locks): smoke billowing out of the card's edge, lit from inside by a dying ember;
 *   - a faint ambient (starlight), so the darkest smoke is a shape, never a hole.
 * A ray that meets a slat of the cage stops there: the backdrop draws the cage at full resolution.
 *
 * The backdrop then lays the target over the deep sky at the screen's own resolution: the far stars,
 * the pulsar's core and the lens's halo and star-filter spikes round it, the cage (dark slats in
 * front, lit inner faces behind, a rim of light round each slat's edge), and the glare when a beam
 * looks straight at us. It reads the target through a small tent, which is what hides the march's
 * steps: each pixel of the target starts its walk at a different place, and neighbours average out.
 */

import * as THREE from 'three/webgpu';
import {
    Break,
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    screenCoordinate,
    screenUV,
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CAGE,
    DEG,
    ECHO_REACH,
    PULSAR,
    SMOKE,
    SMOKE_CODE_PEAK,
    cnBeam,
    cnBeamSkirt,
    cnCage,
    cnCageSurface,
    cnCylinder,
    cnHash23,
    cnLid,
    cnPart,
    cnPassMaterial,
    cnPhase,
    cnTarget,
    cnViewRay,
} from './cosmic-noir-tsl.js';

/** How much a unit of full smoke over a unit of length puts out (thin smoke: noir is mostly dark). */
const EXTINCTION = 0.36;
/** The longest run of a beam's core a ray is lit over (where it looks along the beam). */
const BEAM_RUN_MAX = 7.0;
/** The clear corridor to the lantern: how fast it widens with distance, and the veil left in it. */
const CORRIDOR_SPREAD = 0.13;
const CORRIDOR_VEIL = 0.22;
/** Without the shading tap, the light's average share past the smoke toward the pulsar. */
const UNSHADED = 0.6;
/** The smoke held inside the lantern (it glows round the core and shows the beams leaving). */
const INNER_SMOKE = 0.24;
/** The longest run of an echo's shell a ray is lit over (at its limb, where the ray grazes it). */
const ECHO_RUN_MAX = 5.0;
/** How far toward the pulsar the shading tap reads (scene units). */
const SHADE_REACH = 1.6;
/** How far (in tiles) the slow field bends the place the smoke is read at: the curls. */
const WARP = 0.34;
/** The share of a lattice cell a far star spans on a desktop frame. */
const STAR_SPREAD = 0.22;

const v3 = (a) => vec3(a[0], a[1], a[2]);

/**
 * @param {object} u  shared uniforms
 * @param {object} options
 * @param {number} options.march      steps along a ray
 * @param {number} options.taps       reads of the smoke toward the pulsar per lit step (0..1)
 * @param {boolean} options.detail    the finer read that frays the filaments
 * @param {number} options.skyLayers  lattices of far stars
 */
export function createSmoke(u, {
    march = 30, taps = 1, detail = true, skyLayers = 3,
} = {}) {
    const texel = uniform(new THREE.Vector2(1 / 960, 1 / 540));
    const centre = v3(SMOKE.centre);
    const extent = v3(SMOKE.extent);
    const squash = vec3(1 / SMOKE.stretch, 1.0, 1 / 1.4);

    /** The smoke at a point: (density, its billows) — before the puffs and the light. */
    const densityAt = (p, ds) => {
        const e = p.sub(centre).div(extent);
        const env = float(1.0).sub(smoothstep(0.55, 1.0, length(e))).toVar();
        // A clear corridor from the eye to the lantern (a veil remains): drifting smoke may pass
        // in front of it, but never hides the picture's light for a minute.
        const toLamp = u.pulsar.sub(u.camPos);
        const lampDist = length(toLamp);
        const axis = toLamp.div(lampDist);
        const rel = p.sub(u.camPos);
        const along = dot(rel, axis);
        const across = length(rel.sub(axis.mul(along)));
        const reach = along.mul(CORRIDOR_SPREAD).add(0.6);
        const before = float(1.0).sub(smoothstep(lampDist.sub(CAGE.radius * 2.0), lampDist.sub(CAGE.radius * 0.5), along));
        const open = float(1.0).sub(smoothstep(reach.mul(0.7), reach.mul(1.3), across)).mul(before).mul(step(0.0, along));
        env.mulAssign(float(1.0).sub(open.mul(1.0 - CORRIDOR_VEIL)));
        const n0 = p.add(u.drift).mul(squash).div(SMOKE.tile).toVar();
        const slow = u.smokeFar(n0.mul(0.45).add(u.curl)).toVar();
        const n = n0.add(slow.rgb.sub(0.5).mul(WARP)).toVar();
        // A step longer than the finest threads reads the volume that has none.
        const blur = smoothstep(0.6, 2.2, ds);
        const base = mix(u.smoke(n), u.smokeFar(n), blur).toVar();
        // Threads of smoke ride on the masses; the slow field opens dark gaps between them.
        const need = float(0.5).sub(slow.a.sub(0.5).mul(1.0));
        const field = base.g.mul(0.6).add(base.r.mul(0.4)).sub(need).toVar();
        if (detail) {
            // Fine curling threads fray the masses' edges.
            const fine = u.smoke(n.mul(2.7).add(base.rgb.sub(0.5).mul(0.2)));
            field.addAssign(fine.g.sub(0.45).mul(0.3).mul(float(1.0).sub(blur)));
        }
        // Smoke lies in layers, as in a still room.
        const layers = smoothstep(-0.35, 0.75, sin(base.r.mul(2.6).add(p.y.mul(0.42))));
        // The edge of a mass, softened by the width read (a long step or a thick beam averages
        // across it): a softplus ramp, the hard ramp's average over ±sw.
        const sw = blur.mul(0.09).add(0.012);
        const x = field.div(sw);
        const ramp = max(x, 0.0).add(log(float(1.0).add(exp(abs(x).negate())))).mul(sw);
        const d = min(ramp.mul(4.2), 1.4).mul(layers.mul(0.6).add(0.4)).add(u.haze);
        return vec2(d.mul(env), base.b);
    };

    const paint = Fn(() => {
        const st = uv();
        const ray = cnViewRay(u, st).toVar();
        const o = u.camPos;
        // Interleaved gradient noise: a different start per pixel hides the steps.
        const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).toVar();

        // A ray that meets the cage's wall stops there, slat or gap: the backdrop draws the cage and
        // everything inside it at the screen's own resolution (a slat-by-slat cut here would alias
        // into dots in this smaller target).
        const tEnd = float(SMOKE.far).toVar();
        const cyl = cnCylinder(o, ray, u).toVar();
        If(cyl.z.greaterThan(0.5).and(cyl.x.greaterThan(0.0)), () => {
            const front = cnCageSurface(o, ray, cyl.x, u);
            If(abs(front.y).lessThanEqual(1.0), () => {
                tEnd.assign(cyl.x);
            });
        });
        // The lids close it.
        const lid = cnLid(o, ray, u);
        If(lid.z.greaterThan(0.5), () => {
            tEnd.assign(min(tEnd, lid.x));
        });

        const t0 = float(SMOKE.near);
        const ratio = pow(float(SMOKE.far / SMOKE.near), 1 / march);
        const t = t0.mul(pow(ratio, jitter)).toVar();
        const col = float(0.0).toVar();
        const trans = float(1.0).toVar();
        const toEye = ray.negate();

        // The beams' cores are too thin for the march to find (a step lands in one or misses it):
        // they are integrated in closed form where the ray passes nearest the beam line, below.
        // Here: where that is, and the march keeps the smoke's transmittance up to it.
        const w0 = o.sub(u.pulsar);
        const along = dot(ray, u.beam);
        const sin2 = max(float(1.0).sub(along.mul(along)), 1e-4);
        const dvw = dot(ray, w0);
        const dbw = dot(u.beam, w0);
        const tStar = along.mul(dbw).sub(dvw).div(sin2).toVar();
        const sStar = dbw.sub(along.mul(dvw)).div(sin2).toVar();
        const transAt = select(tStar.lessThan(t), float(1.0), float(0.0)).toVar();
        // The echoes' shells are spheres round the pulsar: where the ray passes nearest it.
        const bE = dvw;
        const dMin2 = max(dot(w0, w0).sub(bE.mul(bE)), 0.0).toVar();

        Loop(march, () => {
            If(t.greaterThan(tEnd), () => {
                Break();
            });
            const ds = t.mul(ratio.sub(1.0)).toVar();
            const p = o.add(ray.mul(t)).toVar();
            If(tStar.greaterThanEqual(t).and(tStar.lessThan(t.add(ds))), () => {
                transAt.assign(trans);
            });
            const smoke = densityAt(p, ds).toVar();
            const dens = smoke.x.toVar();

            // ── Puffs: smoke billowing from the card, with an ember inside ──
            const puff = float(0.0).toVar();
            const ember = float(0.0).toVar();
            Loop({
                start: int(0), end: u.puffCount, type: 'int', condition: '<', name: 'k',
            }, (loop) => {
                const a = u.puffs.element(loop.k.mul(2));
                const b = u.puffs.element(loop.k.mul(2).add(1));
                const off = p.sub(a.xyz);
                const g = exp(dot(off, off).div(a.w.mul(a.w)).negate()).toVar();
                If(g.greaterThan(0.01), () => {
                    // Billowed, not a ball: a finer read of the smoke, its own for each puff,
                    // decides where its ragged edge is.
                    const nz = u.smoke(off.div(a.w).mul(0.3).add(vec3(b.z, b.z.mul(1.7), b.z.mul(2.3))));
                    const edge = g.mul(0.9).add(nz.r.sub(0.5).mul(0.9)).add(nz.g.sub(0.5).mul(0.5));
                    puff.addAssign(b.x.mul(smoothstep(0.2, 0.7, edge)).mul(1.8));
                    ember.addAssign(b.y.mul(g));
                });
            });
            dens.addAssign(puff);

            // ── Light echoes: thin shells round the pulsar, met where this step crosses one ──
            // Like the beams' cores, in closed form: the smoke where the ray crosses the shell, lit
            // over the crossing's length w·√π·R/√(R² − d²) (long at the limb: a ring). Only the
            // masses light, never the thin haze between them: the echo draws the smoke's shape.
            Loop({
                start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
            }, (loop) => {
                const a = u.echoes.element(loop.e);
                const R = a.x;
                const sq = sqrt(max(R.mul(R).sub(dMin2), 0.0));
                const miss = max(sqrt(dMin2).sub(R), 0.0).div(a.y);
                const run = min(a.y.mul(R).mul(Math.sqrt(Math.PI)).div(max(sq, 1e-3)), ECHO_RUN_MAX);
                const re = R.div(ECHO_REACH);
                // The shell's face slices the dense smoke round the lantern into a lit disc: keep it
                // dim and let the limb carry the light, so an echo reads as a ring going out.
                const face = sq.div(max(R, 1e-3));
                const limb = float(1.0).sub(smoothstep(0.25, 0.8, face)).mul(0.7).add(0.3);
                const gain = a.z.mul(exp(miss.mul(miss).negate())).mul(run).mul(limb)
                    .div(float(1.0).add(re.mul(re)));
                const crossAt = (tc, weight) => {
                    If(tc.greaterThanEqual(t).and(tc.lessThan(t.add(ds))).and(tc.lessThan(tEnd)), () => {
                        const at = densityAt(o.add(ray.mul(tc)), ds).x;
                        const mass = max(at.sub(u.haze), 0.0);
                        col.addAssign(gain.mul(mass).mul(EXTINCTION).mul(trans).mul(weight)
                            .mul(u.breath));
                    });
                };
                crossAt(bE.negate().sub(sq), float(1.0));
                crossAt(bE.negate().add(sq), step(1e-3, sq));
            });

            If(dens.greaterThan(0.003), () => {
                const toP = u.pulsar.sub(p).toVar();
                const r = max(length(toP), 0.05).toVar();
                const d = toP.div(r).negate().toVar(); // from the pulsar to here
                // A beam leaves through the slats: cut into bars (light through blinds), their
                // shadows softening with distance (a source of some size) and, far out, blending
                // into the average. The core's all-round glow takes the slats' average: striping it
                // too would lay a bar across every plane through the lantern, one of them edge-on.
                const soft = float(0.05).add(r.mul(0.014));
                const bars = cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, soft);
                const even = cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, float(1.0));
                const rb = r.div(PULSAR.beamReach);
                const beam = cnBeamSkirt(d, u.beam).mul(u.beamGain).div(float(1.0).add(rb.mul(rb)));
                const rc = r.div(PULSAR.coreReach);
                const core = u.coreGain.div(float(1.0).add(rc.mul(rc)));
                const phase = cnPhase(dot(d, toEye), u.forward);
                const direct = beam.mul(phase).mul(bars).add(core.mul(phase.mul(0.35).add(0.65)).mul(even)).toVar();
                if (taps > 0) {
                    // How much smoke stands between here and the pulsar, a step toward it.
                    const tap = densityAt(p.add(toP.div(r).mul(SHADE_REACH)), float(2.0));
                    direct.mulAssign(exp(tap.x.mul(-2.2)));
                } else {
                    direct.mulAssign(UNSHADED);
                }
                // An ember lights only its own puff, not the smoke round it.
                const own = clamp(puff.div(max(dens, 1e-4)), 0.0, 1.0);
                const light = direct.add(ember.mul(own)).add(u.ambient).mul(u.breath);
                const alpha = float(1.0).sub(exp(dens.mul(ds).mul(EXTINCTION).negate()));
                col.addAssign(light.mul(trans).mul(alpha));
                trans.mulAssign(float(1.0).sub(alpha));
            });
            t.mulAssign(ratio);
            If(trans.lessThan(0.012), () => {
                Break();
            });
        });

        // ── The beams' cores, in closed form ──
        // Near its nearest point the ray's angle off the beam grows as √(α₀² + (Δt·sinθ / s)²), so
        // the gaussian core integrates to exp(−(α₀/w)²)·√π·w·|s|/sinθ: the light of the smoke
        // there, times that length (capped where the ray runs along the beam: the glare's place).
        const xs = o.add(ray.mul(tStar)).toVar();
        const q = xs.sub(u.pulsar).toVar();
        const rs = max(length(q), 0.05).toVar();
        const off0 = length(q.sub(u.beam.mul(sStar)));
        const alpha0 = atan(off0, abs(sStar)).div(PULSAR.beamWidth * DEG);
        const crossing = min(abs(sStar).mul(Math.sqrt(Math.PI) * PULSAR.beamWidth * DEG).div(sqrt(sin2)), BEAM_RUN_MAX);
        const inView = step(t0, tStar).mul(step(tStar, tEnd)).mul(exp(alpha0.mul(alpha0).negate()));
        If(inView.mul(transAt).greaterThan(1e-4), () => {
            // The beam averages the smoke across its own thickness: read it that softly.
            const ds = max(tStar.mul(ratio.sub(1.0)), rs.mul(PULSAR.beamWidth * DEG * 1.5));
            const dens = densityAt(xs, ds).x.toVar();
            const ds0 = q.div(rs).toVar(); // from the pulsar to there
            const rb = rs.div(PULSAR.beamReach);
            const soft = float(0.05).add(rs.mul(0.014));
            const bars = cnCage(ds0, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, soft);
            const phase = cnPhase(dot(ds0, toEye), u.forward);
            const core = u.beamGain.div(float(1.0).add(rb.mul(rb))).mul(phase).mul(bars).toVar();
            if (taps > 0) {
                const tap = densityAt(xs.sub(ds0.mul(SHADE_REACH)), float(2.0));
                core.mulAssign(exp(tap.x.mul(-2.2)));
            } else {
                core.mulAssign(UNSHADED);
            }
            col.addAssign(core.mul(u.breath).mul(dens).mul(EXTINCTION).mul(crossing)
                .mul(inView)
                .mul(transAt));
        });
        const light = vec3(col);
        if (!u.floatTarget) return vec4(sqrt(clamp(light.div(SMOKE_CODE_PEAK), 0.0, 1.0)), trans);
        return vec4(light, trans);
    });

    const material = cnPassMaterial('CosmicNoirSmokePass', paint());
    const quad = new THREE.QuadMesh(material);
    quad.name = 'CosmicNoirSmokePass';
    let target = cnTarget(4, 4, 'cosmic-noir-smoke-target', u.floatTarget);
    u.targetTex.value = target.texture;

    // ── The backdrop: the sky, the pulsar, the cage, the smoke laid over them ──

    /** Far stars on one lattice of the sky: light summed over the cell a direction falls in. */
    const starLayer = (dir, scale, seed, spread) => {
        const p = dir.mul(scale).add(seed);
        const cell = floor(p);
        const f = fract(p).sub(0.5);
        const h = cnHash23(cell.xy.add(cell.z.mul(vec2(37.0, 17.0))));
        const g = cnHash23(cell.xy.add(cell.z.mul(vec2(-11.0, 53.0))).add(4.7));
        const at = vec3(h.x, h.y, g.x).sub(0.5).mul(0.7);
        const away = length(f.sub(at));
        // A few bright ones, a great many faint ones.
        const mag = pow(h.z, 10.0).mul(2.2).add(pow(g.y, 3.0).mul(0.12));
        const core = float(1.0).sub(smoothstep(0.0, spread, away));
        return core.mul(core).mul(mag);
    };

    /** The smoke's target through a small tent: neighbours start their walks at different places. */
    const smokeSoft = (st) => {
        const o = texel.mul(0.6);
        return u.smokeAt(st.add(vec2(o.x, o.y)))
            .add(u.smokeAt(st.add(vec2(o.x.negate(), o.y))))
            .add(u.smokeAt(st.add(vec2(o.x, o.y.negate()))))
            .add(u.smokeAt(st.sub(vec2(o.x, o.y))))
            .mul(0.25);
    };

    const backdropFn = Fn(() => {
        const st = screenUV;
        const ray = cnViewRay(u, st).toVar();
        const o = u.camPos;

        // ── The deep sky and its far stars ──
        const sky = float(0.0012).add(smoothstep(-0.4, 0.6, ray.y).mul(0.0006)).toVar();
        for (let i = 0; i < skyLayers; i++) {
            const scale = [160, 104, 66][i];
            const want = u.pixelAngle.mul(scale * 1.25);
            const spread = min(want, 0.4);
            const thin = min(float(STAR_SPREAD).div(want), 1.0);
            sky.addAssign(starLayer(ray, scale, vec3(13.3 * (i + 1), 5.1 * (i + 2), 9.7 * (i + 3)), spread).mul(thin.mul(thin)));
        }

        // ── The pulsar's core (seen through the gaps of the cage) ──
        const toP = normalize(u.pulsar.sub(o));
        const cosOff = clamp(dot(ray, toP), -1.0, 1.0);
        const off = sqrt(max(float(2.0).sub(cosOff.mul(2.0)), 0.0)).toVar(); // radians off it, about
        const point = exp(off.mul(off).mul(-60000.0)).mul(60.0);
        const behind = sky.add(point.mul(u.coreSeen)).toVar();

        // ── The cage, sharp: dark slats in front, lit inner faces behind, rims of light ──
        const cyl = cnCylinder(o, ray, u).toVar();
        const cageCol = float(0.0).toVar();
        const cover = float(0.0).toVar();
        If(cyl.z.greaterThan(0.5).and(cyl.y.greaterThan(0.0)), () => {
            const pitch = float((Math.PI * 2 * CAGE.radius) / CAGE.slats);
            // A pixel's width in shares of a slat's pitch at each wall (the edges are anti-aliased by it).
            const wFront = u.pixelAngle.mul(max(cyl.x, 0.1)).div(pitch).mul(1.4);
            const wBack = u.pixelAngle.mul(cyl.y).div(pitch).mul(1.4);
            const slatCover = (f, w) => smoothstep(w.negate(), w, f).mul(float(1.0).sub(smoothstep(u.cageFill.sub(w), u.cageFill.add(w), f)));
            const ringCover = (h, w) => smoothstep(1.0 - CAGE.ring - 0.02, 1.0 - CAGE.ring + 0.02, abs(h))
                .mul(float(1.0).sub(smoothstep(float(1.0).sub(w), float(1.0).add(w), abs(h))));
            const front = cnCageSurface(o, ray, cyl.x, u).toVar();
            const back = cnCageSurface(o, ray, cyl.y, u).toVar();
            const hw = u.pixelAngle.mul(max(cyl.x, 0.1)).div(CAGE.halfHeight).mul(1.5).toVar();
            const inFront = float(1.0).sub(smoothstep(float(1.0).sub(hw), float(1.0).add(hw), abs(front.y))).mul(step(0.0, cyl.x));
            const inBack = float(1.0).sub(smoothstep(float(1.0), float(1.0).add(hw.mul(2.0)), abs(back.y)));
            const fCover = max(slatCover(front.x, wFront), ringCover(front.y, hw)).mul(inFront).toVar();
            const bCover = max(slatCover(back.x, wBack), ringCover(back.y, hw)).mul(inBack).toVar();
            // The back wall's inner faces take the core's light, and a beam's where one strikes;
            // each slat a little brighter at its middle (it is a curved vane).
            const pb = o.add(ray.mul(cyl.y)).sub(u.pulsar);
            const db = normalize(pb);
            const lit = u.coreGain.mul(0.035).add(cnBeam(db, u.beam).mul(u.beamGain).mul(0.06));
            const across = abs(back.x.div(max(u.cageFill, 1e-3)).sub(0.5)).mul(2.0);
            const backCol = lit.mul(float(1.0).sub(across.mul(across).mul(0.5)));
            // A slat in front stands black against the light, a thin rim where light spills round
            // its edge.
            const edgeDist = min(front.x, abs(front.x.sub(u.cageFill)));
            const rimW = max(wFront.mul(0.9), 0.01);
            const rimX = edgeDist.div(rimW);
            const rim = exp(rimX.mul(rimX).negate()).mul(u.coreGain.mul(0.06)).mul(step(front.x, u.cageFill.add(wFront)));
            const frontCol = float(0.0008).add(rim);
            // ── Inside the lantern, through the gaps: smoke round the core, and the beams leaving ──
            const ta = max(cyl.x, 0.0);
            const tb = cyl.y;
            const w0 = o.sub(u.pulsar);
            const bc = dot(ray, w0);
            const dMin2 = max(dot(w0, w0).sub(bc.mul(bc)), 0.0);
            // The core's light over the chord, exactly: ∫ R² / (R² + d² + (t − tc)²) dt.
            const k = sqrt(dMin2.add(PULSAR.coreReach * PULSAR.coreReach));
            const chord = atan(tb.add(bc), k).sub(atan(ta.add(bc), k)).div(k).mul(PULSAR.coreReach * PULSAR.coreReach);
            const inner = u.coreGain.mul(chord).toVar();
            // The beams, in closed form where the ray passes nearest them inside the lantern.
            const along = dot(ray, u.beam);
            const sin2 = max(float(1.0).sub(along.mul(along)), 1e-4);
            const dbw = dot(u.beam, w0);
            const ts = along.mul(dbw).sub(bc).div(sin2);
            const ss = dbw.sub(along.mul(bc)).div(sin2);
            const qs = w0.add(ray.mul(ts));
            const a0 = atan(length(qs.sub(u.beam.mul(ss))), abs(ss)).div(PULSAR.beamWidth * DEG);
            const run = min(abs(ss).mul(Math.sqrt(Math.PI) * PULSAR.beamWidth * DEG).div(sqrt(sin2)), tb.sub(ta));
            const rq = length(qs).div(PULSAR.beamReach);
            inner.addAssign(u.beamGain.div(float(1.0).add(rq.mul(rq))).mul(exp(a0.mul(a0).negate())).mul(run)
                .mul(step(ta, ts))
                .mul(step(ts, tb)));
            const innerLight = inner.mul(INNER_SMOKE * EXTINCTION).mul(u.breath).mul(inFront);
            // Behind the inside: the lit inner face of a slat across, or the sky through a gap.
            const farSide = mix(behind, backCol, bCover);
            cageCol.assign(mix(farSide.add(innerLight), frontCol, fCover));
            cover.assign(max(inFront, bCover));
        });
        // The lids: dark discs, a thin bright line round their rims.
        const lid = cnLid(o, ray, u).toVar();
        // A ray that reaches a lid before the side wall enters the cage through it: the lid is
        // what it sees.
        If(lid.z.greaterThan(0.5).and(lid.x.lessThan(cyl.x)), () => {
            const rimLid = smoothstep(0.86, 0.97, lid.y).mul(float(1.0).sub(smoothstep(0.97, 1.0, lid.y)));
            cageCol.assign(float(0.0008).add(rimLid.mul(u.coreGain.mul(0.05))));
            cover.assign(float(1.0).sub(smoothstep(0.985, 1.0, lid.y)));
        });
        const scene = mix(behind, cageCol, cover);

        // ── The smoke over it all ──
        const smoke = smokeSoft(st).toVar();
        const out = vec3(scene).mul(smoke.a).add(smoke.rgb).toVar();

        // ── The lens: halo, star-filter spikes and the glare of a beam looking at us ──
        // (attenuated by the smoke between us and the core, read at the core's place).
        const veil = u.smokeAt(u.pulsarUv).a;
        const seen = u.coreSeen.mul(veil);
        const halo = float(1.0).div(float(1.0).add(off.mul(off).mul(9000.0))).mul(0.35)
            .add(float(1.0).div(float(1.0).add(off.mul(off).mul(300.0))).mul(0.03));
        const aspect = u.viewport.x.div(u.viewport.y);
        const dp = st.sub(u.pulsarUv).mul(vec2(aspect, 1.0));
        const spike = (cx, cy) => {
            const along = dp.x.mul(cx).add(dp.y.mul(cy));
            const across = dp.x.mul(cy.negate()).add(dp.y.mul(cx));
            const w = u.pixelAngle.mul(1.1).div(0.0012).mul(0.0009);
            return exp(across.mul(across).div(w.mul(w)).negate()).mul(exp(abs(along).mul(-16.0)));
        };
        const c45 = Math.SQRT1_2;
        const spikes = spike(float(c45), float(c45)).add(spike(float(c45), float(-c45)))
            .add(spike(float(1.0), float(0.0)).mul(0.35)).add(spike(float(0.0), float(1.0)).mul(0.35));
        const glare = float(1.0).div(float(1.0).add(off.mul(off).mul(22.0))).mul(u.glare);
        out.addAssign(vec3(halo.add(spikes.mul(0.9).mul(u.spikes)).mul(seen).add(glare.mul(veil.mul(0.6).add(0.4)))));
        return vec4(max(out, vec3(0.0)), 1.0);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    backdrop.name = 'CosmicNoirBackdrop';
    backdrop.fog = false;
    backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    backdrop.colorNode = backdropFn();
    const part = cnPart('CosmicNoirBackdrop', geometry, backdrop, -100);

    part.pass = { quad, material };
    /** Size the target for a drawing buffer and a tier's scale. Returns true if it was rebuilt. */
    part.resize = (bufferWidth, bufferHeight, scale) => {
        const w = Math.max(2, Math.round(bufferWidth * scale));
        const h = Math.max(2, Math.round(bufferHeight * scale));
        if (target.width === w && target.height === h) return false;
        target.dispose();
        target = cnTarget(w, h, 'cosmic-noir-smoke-target', u.floatTarget);
        u.targetTex.value = target.texture;
        texel.value.set(1 / w, 1 / h);
        return true;
    };
    /** Paint the smoke for this frame (the camera uniforms must be current). */
    part.render = (renderer) => {
        if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
        const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        return true;
    };
    part.target = () => target;
    part.dispose = () => {
        target.dispose();
        material.dispose();
    };
    part.march = march;
    return part;
}
