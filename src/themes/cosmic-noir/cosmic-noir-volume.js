/**
 * Cosmic Noir — the light in the air, and the picture it is laid over.
 *
 * Two passes a frame.
 *
 * THE AIR is painted into a reduced-resolution target: light in thin smoke is soft, and nearly all
 * of it is worked out in closed form, so it needs neither the screen's pixels nor a march's noise.
 *   - The lamp's own light: seen from the lamp, the points of a view ray sweep one arc of
 *     directions, and the light scattered per unit of that arc is the lamp's over the ray's nearest
 *     distance. The arc is cut into a few spans; across each the slats' share of the lantern's wall
 *     is taken exactly (cnSlatShare), so the fan of shafts between the slats is drawn without a
 *     grain. The roof's and the gallery's shadows are the dark cones above and below.
 *   - The beams' cores are thinner than any span: each is integrated where the ray passes nearest
 *     the beam's line (a gaussian in angle integrates to its width times that crossing's length).
 *   - A light echo is a thin shell round the lamp, lit over the length the ray runs inside it
 *     (long at the limb: a ring).
 *   - The mist that lies on the sea is an exponential layer: its depth along the ray is closed
 *     form, lit by the lamp where the ray comes down.
 *   - A lock's puff is a ball of smoke lit from inside by its ember (a gaussian along the ray),
 *     ragged by one read of the baked smoke.
 *   - Smoke drifting past the lens is walked in a few long steps (it is large and soft).
 *
 * THE BACKDROP is one full-screen triangle at the screen's own resolution: the sky
 * (cosmic-noir-sky.js), the sea of smoke (cosmic-noir-sea.js), the lighthouse on its rock
 * (cosmic-noir-lighthouse.js), the glow inside the lantern, then the air's target over them
 * through a small tent, and the lens: the lamp's halo, the star filter's spikes, and the glare when
 * a beam looks at us.
 */

import * as THREE from 'three/webgpu';
import {
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
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    screenUV,
    smoothstep,
    sqrt,
    tan,
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
    SEA,
    SMOKE,
    SMOKE_CODE_PEAK,
    TAU,
    TOWER,
    cnBall,
    cnBeam,
    cnBeamSkirt,
    cnCage,
    cnPart,
    cnPassMaterial,
    cnPhase,
    cnSlatShare,
    cnTarget,
    cnUpright,
    cnViewRay,
} from './cosmic-noir-tsl.js';
import { cnSky } from './cosmic-noir-sky.js';
import { cnSeaFringe, cnSeaLight, cnSeaMarch } from './cosmic-noir-sea.js';
import { TOWER_BOUNDS, cnLighthouse } from './cosmic-noir-lighthouse.js';
import { cnSplash } from './cosmic-noir-splash.js';

/** How much a unit of full smoke over a unit of length puts out (thin smoke: noir is mostly dark). */
const EXTINCTION = 0.36;
/** The longest run of a beam's core a ray is lit over (where it looks along the beam). */
const BEAM_RUN_MAX = 3.6;
/** How bright an echo's ring is in the air. */
const ECHO_AIR = 15;
/** The share of a lock's ember that lights its puff (most of it glows under the sea). */
const PUFF_EMBER = 0.14;
/**
 * The lamp's own glow in the air falls off within this (its light on the sea reaches further:
 * PULSAR.coreReach). Compact, so the air away from the lantern stays black.
 */
const AIR_REACH = 2.6;
/** The air right at the lens is clear: a beam that looks at us must not veil the whole frame. */
const AIR_CLEAR = 0.6;
/** The share of the beams' wide skirt the air shows (the rest would grey the whole room). */
const SKIRT_AIR = 0.3;
const AIR_FAR = 150;
/** The smoke held inside the lantern (it glows round the lens). */
const INNER_SMOKE = 0.2;
/** The thin haze is densest over the sea and thins with height (its scale height). */
const HAZE_HEIGHT = 12;
/** How much of the sea's mist shows the lamp's light, and how much of the sea it hides. */
const MIST_LIGHT = 0.55;
/** The share of the lamp's light the roof and the gallery let past into the air. */
const LID_AIR = 0.1;
/** Smoke drifting past the lens: where its walk starts and ends, and how thick it is. */
const WISP_NEAR = 1.6;
const WISP_FAR = 16;
const WISP_SMOKE = 0.3;

/** The lighthouse and its rock, as the air sees them: an upright cylinder and a ball. */
const PROXY = Object.freeze({
    radius: CAGE.radius + 0.1,
    y0: TOWER_BOUNDS.y0,
    y1: CAGE.halfHeight + TOWER.domeRise,
    rock: Object.freeze([0.3, SEA.level - PULSAR.height - 1.3, 0.6]),
    rockRadius: 3.1,
});

/**
 * @param {object} u  shared uniforms
 * @param {object} options  the tier (cosmic-noir-quality.js)
 */
export function createSmoke(u, {
    march = 52, shadow = 8, fine = true, tower = 64, air = 14, wisps = 6, splash = 16, detail = true, skyLayers = 3,
} = {}) {
    const texel = uniform(new THREE.Vector2(1 / 960, 1 / 540));
    const squash = vec3(1 / (SMOKE.tile * SMOKE.stretch), 1 / SMOKE.tile, 1 / (SMOKE.tile * 1.4));

    /** The smoke in the air at a point: the thin haze, in drifts where the tier reads them. */
    const airAt = (p) => {
        const lift = max(p.y.sub(SEA.level), 0.0);
        const base = u.haze.mul(exp(lift.div(-HAZE_HEIGHT)).mul(0.8).add(0.2));
        if (!detail) return base;
        const n = u.smokeFar(p.add(u.drift).mul(squash).add(u.curl));
        return base.mul(n.r.mul(1.15).add(n.g.mul(0.55)).add(0.2));
    };

    /** The lamp's light at a point outside the lantern: (through the slats and past the roof) × (its own + the beams'). */
    const lampAt = (p, softer) => {
        const dv = p.sub(u.pulsar);
        const r = max(length(dv), 0.05);
        const d = dv.div(r);
        const rb = r.div(PULSAR.beamReach);
        const rc = r.div(PULSAR.coreReach);
        return cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, r.mul(0.01).add(softer))
            .mul(u.coreGain.div(rc.mul(rc).add(1.0)).add(cnBeam(d, u.beam).mul(u.beamGain).div(rb.mul(rb).add(1.0))));
    };

    const paint = Fn(() => {
        const st = uv();
        const ray = cnViewRay(u, st).toVar();
        const o = u.camPos;
        const rel = o.sub(u.pulsar).toVar(); // the eye, from the lamp
        const toEye = ray.negate().toVar();

        // ── Where the air ends: the sea, the lighthouse, its rock ──
        const tEnd = float(AIR_FAR).toVar();
        const tSea = float(-1.0).toVar();
        If(ray.y.lessThan(-0.001), () => {
            tSea.assign(o.y.sub(SEA.level).div(ray.y.negate()));
            tEnd.assign(min(tEnd, tSea));
        });
        const body = cnUpright(rel, ray, float(PROXY.radius), float(PROXY.y0), float(PROXY.y1)).toVar();
        If(body.z.greaterThan(0.5), () => {
            tEnd.assign(min(tEnd, max(body.x, 0.0)));
        });
        const lump = cnBall(rel.sub(vec3(PROXY.rock[0], PROXY.rock[1], PROXY.rock[2])), ray, float(PROXY.rockRadius)).toVar();
        If(lump.z.greaterThan(0.5), () => {
            tEnd.assign(min(tEnd, max(lump.x, 0.0)));
        });
        const reachesSea = tSea.greaterThan(0.0).and(tSea.lessThanEqual(tEnd.add(0.01)));

        const light = float(0.0).toVar();
        // The mist on the sea is kept apart: the lighthouse and its rock stand in front of it.
        const mist = float(0.0).toVar();
        const mistVeil = float(0.0).toVar();
        const trans = float(1.0).toVar();

        // ── The lamp's own light, summed over the arc the ray sweeps as seen from the lamp ──
        const bE = dot(ray, rel).toVar();
        const tc = bE.negate().toVar();
        const d2 = max(dot(rel, rel).sub(bE.mul(bE)), 0.0).toVar();
        const Dh = sqrt(d2.add(AIR_REACH * AIR_REACH)).toVar();
        const b0 = atan(float(AIR_CLEAR).sub(tc).div(Dh)).toVar();
        const b1 = atan(max(tEnd, AIR_CLEAR + 0.01).sub(tc).div(Dh)).toVar();
        const dB = b1.sub(b0).div(air).toVar();
        const sum = float(0.0).toVar();
        // A ray in the upright plane through the lantern's axis looks along ONE slat's shadow for
        // its whole length (every point of it lies on the same bearing from the lamp): a black or a
        // white needle up the frame over the roof. There the slats are taken at their average.
        const offAxis = abs(rel.x.mul(ray.z).sub(rel.z.mul(ray.x))).div(max(length(ray.xz), 1e-4));
        const slatted = smoothstep(0.25, 1.5, offAxis).toVar();
        const azPrev = float(0.0).toVar();
        const gPrev = float(0.0).toVar();
        const wallPrev = float(0.0).toVar();
        Loop({
            start: int(0), end: int(air + 1), type: 'int', condition: '<', name: 'k',
        }, ({ k }) => {
            const beta = b0.add(dB.mul(float(k))).toVar();
            const p = o.add(ray.mul(tc.add(Dh.mul(tan(beta))))).toVar();
            const dv = p.sub(u.pulsar).toVar();
            const r = max(length(dv), 0.05).toVar();
            const d = dv.div(r).toVar();
            const h = dot(d, u.spin);
            const qx = dot(d, u.spinE1);
            const qy = dot(d, u.spinE2);
            const q = max(sqrt(qx.mul(qx).add(qy.mul(qy))), 1e-5);
            const axial = abs(h.mul(CAGE.radius).div(q)).toVar();
            // Where on the lantern's wall this light left, in slat pitches.
            const az = atan(qy, qx).add(u.cageTurn).mul(CAGE.slats / TAU).toVar();
            // (Wider and softer than the sea sees it: in the air the roof's shadow is a dim cone, not a spike.)
            const lids = float(1.0).sub(smoothstep(0.4, 0.92, abs(h)).mul(1 - LID_AIR));
            const onWall = float(1.0).sub(smoothstep(CAGE.halfHeight - 0.05, CAGE.halfHeight + 0.05, axial)).toVar();
            const rb = r.div(PULSAR.beamReach);
            // Per unit of arc: the lamp's own light is constant, the skirts' follows the beams.
            const source = u.coreGain.mul(AIR_REACH * AIR_REACH)
                .add(cnBeamSkirt(d, u.beam).mul(u.beamGain).mul(SKIRT_AIR).mul(r.mul(r).add(AIR_REACH * AIR_REACH))
                    .div(rb.mul(rb).add(1.0)));
            const g = source.mul(lids).mul(airAt(p)).mul(cnPhase(dot(d, toEye), u.forward)).toVar();
            If(k.greaterThan(int(0)), () => {
                // The short way round from the last span's end.
                const dx = az.sub(azPrev).toVar();
                dx.subAssign(floor(dx.div(CAGE.slats).add(0.5)).mul(CAGE.slats));
                const share = mix(u.cageFill, cnSlatShare(azPrev, azPrev.add(dx), u.cageFill, r.mul(0.02).add(0.06)), slatted);
                const bars = float(1.0).sub(share.mul(onWall.add(wallPrev).mul(0.5)));
                sum.addAssign(g.add(gPrev).mul(0.5).mul(bars));
            });
            azPrev.assign(az);
            gPrev.assign(g);
            wallPrev.assign(onWall);
        });
        light.addAssign(sum.mul(dB).div(Dh).mul(EXTINCTION));

        // ── The beams' cores, in closed form ──
        // Near its nearest point the ray's angle off the beam grows as √(α₀² + (Δt·sinθ / s)²), so
        // the gaussian core integrates to exp(−(α₀/w)²)·√π·w·|s|/sinθ: the light of the smoke
        // there, times that length (capped where the ray runs along the beam: the glare's place).
        const along = dot(ray, u.beam).toVar();
        const sin2 = max(float(1.0).sub(along.mul(along)), 1e-4).toVar();
        const dbw = dot(u.beam, rel).toVar();
        const tStar = along.mul(dbw).sub(bE).div(sin2).toVar();
        const sStar = dbw.sub(along.mul(bE)).div(sin2).toVar();
        const xs = o.add(ray.mul(tStar)).toVar();
        const qv = xs.sub(u.pulsar).toVar();
        const rs = max(length(qv), 0.05).toVar();
        const alpha0 = atan(length(qv.sub(u.beam.mul(sStar))), abs(sStar)).div(PULSAR.beamWidth * DEG).toVar();
        const crossing = min(abs(sStar).mul(Math.sqrt(Math.PI) * PULSAR.beamWidth * DEG).div(sqrt(sin2)), BEAM_RUN_MAX);
        const inView = smoothstep(AIR_CLEAR, AIR_CLEAR + 7.0, tStar)
            .mul(float(1.0).sub(smoothstep(tEnd.sub(1.0), tEnd, tStar)))
            .mul(exp(alpha0.mul(alpha0).negate())).toVar();
        If(inView.greaterThan(1e-4), () => {
            const ds0 = qv.div(rs).toVar(); // from the lamp to there
            const rb = rs.div(PULSAR.beamReach);
            const bars = cnCage(ds0, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, rs.mul(0.014).add(0.05));
            const core = u.beamGain.div(rb.mul(rb).add(1.0)).mul(cnPhase(dot(ds0, toEye), u.forward)).mul(bars);
            light.addAssign(core.mul(airAt(xs)).mul(EXTINCTION).mul(crossing).mul(inView));
        });

        // ── Light echoes: thin shells round the lamp, seen as rings going out ──
        // A shell of gaussian thickness w round radius R, along a ray that passes d from the lamp:
        // inside the limb its run is √(2Rw / (R² − d² + 2Rw)), brightest just inside the edge, and
        // past the limb it dies as a gaussian, so no line is ruled at either side. What a ray
        // through the middle of the shell would add (its two faces) is taken off: a ring, not a
        // bubble. The smoke where the ray passes nearest the lamp gives the ring its ragged light.
        const dMin = sqrt(d2).toVar();
        const rings = float(0.0).toVar();
        Loop({
            start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
        }, ({ e }) => {
            const a = u.echoes.element(e);
            const R = a.x;
            const w = a.y.mul(0.3);
            const span = R.mul(w).mul(2.0);
            const inside = sqrt(span.div(max(R.mul(R).sub(d2), 0.0).add(span)));
            const past = dMin.sub(R).div(w.mul(3.0));
            const ring = dMin.lessThan(R).select(inside, exp(past.mul(past).negate()));
            const floorOf = sqrt(span.div(R.mul(R).add(span)));
            const re = R.div(ECHO_REACH);
            rings.addAssign(a.z.mul(max(ring.sub(floorOf), 0.0)).div(re.mul(re).add(1.0)));
        });
        If(rings.greaterThan(1e-4).and(tc.greaterThan(AIR_CLEAR)).and(tc.lessThan(tEnd)), () => {
            light.addAssign(rings.mul(airAt(o.add(ray.mul(tc)))).mul(EXTINCTION * ECHO_AIR));
        });

        // ── The mist on the sea: an exponential layer, lit by the lamp where the ray comes down ──
        If(reachesSea, () => {
            const fall = ray.y.negate();
            const depth = float(SEA.mist * SEA.mistHeight).mul(u.haze.div(SMOKE.haze)).div(fall)
                .mul(float(1.0).sub(exp(o.y.sub(SEA.level).div(-SEA.mistHeight))));
            const veil = float(1.0).sub(exp(depth.negate())).toVar();
            const at = o.add(ray.mul(tSea)).add(vec3(0.0, SEA.mistHeight * 0.6, 0.0)).toVar();
            const dv = at.sub(u.pulsar);
            const phase = cnPhase(dot(normalize(dv), toEye), u.forward);
            // An echo's ring on the sea lights the mist over it as it passes.
            const out = length(at.xz.sub(u.pulsar.xz)).toVar();
            const ringed = float(0.0).toVar();
            Loop({
                start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'm',
            }, ({ m }) => {
                const a = u.echoes.element(m);
                const x = out.sub(a.w).div(a.w.mul(0.03).add(a.y.mul(0.9)));
                ringed.addAssign(a.z.mul(exp(x.mul(x).negate())));
            });
            const ringLight = ringed.mul(0.9).div(out.div(60.0).pow(2.0).add(1.0));
            mist.assign(lampAt(at, float(0.08)).mul(phase).add(ringLight).mul(veil)
                .mul(MIST_LIGHT));
            mistVeil.assign(veil.mul(0.9));
        });

        // ── Smoke drifting past the lens: a few long steps ──
        if (wisps > 0) {
            const ratio = (WISP_FAR / WISP_NEAR) ** (1 / wisps);
            // Fixed shells, no jitter: the smoke is soft and each shell is a sheet of it.
            const tw = float(WISP_NEAR).toVar();
            Loop(wisps, () => {
                const ds = tw.mul(ratio - 1);
                If(tw.lessThan(tEnd), () => {
                    const p = o.add(ray.mul(tw)).toVar();
                    const n0 = p.add(u.drift.mul(1.6)).mul(squash).toVar();
                    const slow = u.smokeFar(n0.mul(0.45).add(u.curl)).toVar();
                    const mass = u.smokeFar(n0.add(slow.rgb.sub(0.5).mul(0.34))).toVar();
                    // Rare: most of the air by the lens is clear.
                    const field = mass.g.mul(0.6).add(mass.r.mul(0.4)).sub(float(1.08).sub(slow.a.mul(0.75)));
                    // (A shell thins out as it nears what the ray ends on, so none is cut off along a line.)
                    const dens = smoothstep(0.0, 0.5, field).mul(WISP_SMOKE)
                        .mul(smoothstep(WISP_NEAR, WISP_NEAR * 2.2, tw))
                        .mul(clamp(tEnd.sub(tw).div(tw.mul(0.45)), 0.0, 1.0))
                        .toVar();
                    If(dens.greaterThan(0.004), () => {
                        const alpha = float(1.0).sub(exp(dens.mul(ds).mul(EXTINCTION).negate()));
                        const phase = cnPhase(dot(normalize(p.sub(u.pulsar)), toEye), u.forward);
                        light.addAssign(lampAt(p, float(0.1)).mul(phase).add(u.ambient).mul(alpha)
                            .mul(trans));
                        trans.mulAssign(float(1.0).sub(alpha));
                    });
                });
                tw.mulAssign(ratio);
            });
        }

        // ── Puffs (locks): a ball of smoke rising off the sea, lit from inside by its ember ──
        Loop({
            start: int(0), end: u.puffCount, type: 'int', condition: '<', name: 'k',
        }, ({ k }) => {
            const a = u.puffs.element(k.mul(2));
            const b = u.puffs.element(k.mul(2).add(1));
            const tp = clamp(dot(a.xyz.sub(o), ray), 0.0, tEnd).toVar();
            const off = o.add(ray.mul(tp)).sub(a.xyz).toVar();
            const m2 = dot(off, off).div(a.w.mul(a.w)).toVar();
            If(m2.lessThan(5.0), () => {
                const g = exp(m2.negate()).toVar();
                // Billowed, not a ball: a read of the smoke, its own for each puff, sets its ragged edge.
                const nz = u.smoke(off.div(a.w).mul(0.3).add(vec3(b.z, b.z.mul(1.7), b.z.mul(2.3))));
                const edge = g.mul(0.9).add(nz.r.sub(0.5).mul(0.9)).add(nz.g.sub(0.5).mul(0.5));
                const puffBody = smoothstep(0.2, 0.7, edge).mul(b.x);
                const alpha = float(1.0).sub(exp(puffBody.mul(a.w).mul(EXTINCTION * 1.5).negate())).toVar();
                const phase = cnPhase(dot(normalize(a.xyz.sub(u.pulsar)), toEye), u.forward);
                const lit = b.y.mul(g).mul(PUFF_EMBER).add(lampAt(a.xyz, float(0.1)).mul(phase)).add(u.ambient.mul(2.0));
                light.addAssign(lit.mul(alpha).mul(trans));
                trans.mulAssign(float(1.0).sub(alpha.mul(0.85)));
            });
        });

        // (the air's light, the mist's light, how much of the sea the mist hides, what the air lets through)
        const result = vec3(light.mul(u.breath), mist.mul(u.breath), mistVeil);
        if (!u.floatTarget) return vec4(sqrt(clamp(result.div(SMOKE_CODE_PEAK), 0.0, 1.0)), trans);
        return vec4(result, trans);
    });

    const material = cnPassMaterial('CosmicNoirSmokePass', paint());
    const quad = new THREE.QuadMesh(material);
    quad.name = 'CosmicNoirSmokePass';
    let target = cnTarget(4, 4, 'cosmic-noir-smoke-target', u.floatTarget);
    u.targetTex.value = target.texture;

    // ── The backdrop: the sky, the sea, the lighthouse, the air laid over them ──

    /** The air's target through a small tent (it hides what little grain the one walk leaves). */
    const smokeSoft = (st) => {
        const o = texel.mul(0.6);
        return u.smokeAt(st.add(vec2(o.x, o.y)))
            .add(u.smokeAt(st.add(vec2(o.x.negate(), o.y))))
            .add(u.smokeAt(st.add(vec2(o.x, o.y.negate()))))
            .add(u.smokeAt(st.sub(vec2(o.x, o.y))))
            .mul(0.25);
    };

    const showSea = uniform(1);
    const showTower = uniform(1);

    const backdropFn = Fn(() => {
        const st = screenUV;
        const ray = cnViewRay(u, st).toVar();
        const o = u.camPos;
        const rel = o.sub(u.pulsar).toVar();

        // ── The lighthouse on its rock ──
        const house = cnLighthouse(u, o, ray, { steps: tower, detail });
        const houseT = house.t;
        const houseCover = house.cover.mul(showTower).toVar();

        // ── The sea of smoke ──
        const seaT = float(-1.0).toVar();
        const scene = float(0.0).toVar();
        // A pixel the lighthouse covers whole needs no sea behind it.
        If(houseCover.lessThan(0.999).or(houseT.lessThan(0.0)).and(showSea.greaterThan(0.5)), () => {
            const walk = cnSeaMarch(u, o, ray, { march });
            seaT.assign(walk.t);
            If(seaT.greaterThan(0.0), () => {
                const bearing = normalize(vec3(ray.x, 0.004, ray.z)).toVar();
                const far = cnSky(u, bearing, { stars: false, detail: false }).toVar();
                scene.assign(cnSeaLight(u, o, ray, seaT, far, { shadow, fine }));
                // The loose smoke the ray passed through on its way.
                If(walk.fringe.greaterThan(0.004), () => {
                    const loose = cnSeaFringe(u, o, ray, walk).toVar();
                    scene.assign(mix(scene, loose.x, loose.y));
                });
            });
        });
        If(seaT.lessThanEqual(0.0), () => {
            scene.assign(cnSky(u, ray, { layers: skyLayers, detail }));
        });

        // The lighthouse over it, unless the sea stands in front (the smoke laps softly round the rock).
        const lap = seaT.greaterThan(0.0).select(smoothstep(0.0, 0.5, seaT.sub(houseT)), 1.0);
        const shown = houseCover.mul(houseT.greaterThan(0.0).select(lap, 0.0)).toVar();
        scene.assign(mix(scene, house.light, shown));

        // ── Waves breaking on the rock: the smoke they throw up, in front of whatever the ray ends on ──
        const tStop = float(1e4).toVar();
        If(shown.greaterThan(0.5), () => {
            tStop.assign(houseT);
        }).ElseIf(seaT.greaterThan(0.0), () => {
            tStop.assign(seaT);
        });
        const spray = cnSplash(u, o, ray, tStop, { steps: splash });
        // (No sea, no breaking: the `parts` switch takes the plume with it.)
        scene.assign(scene.mul(mix(float(1.0), spray.through, showSea)).add(spray.light.mul(showSea)));

        // ── Inside the lantern, through the gaps: the smoke round the lens, glowing ──
        // The lens's light over the ray's chord of the room, exactly: ∫ R² / (R² + d² + (t − tc)²) dt.
        const room = cnUpright(rel, ray, float(CAGE.radius - 0.04), float(-CAGE.halfHeight), float(CAGE.halfHeight)).toVar();
        If(room.z.greaterThan(0.5).and(showTower.greaterThan(0.5)), () => {
            const ta = max(room.x, 0.0);
            const tb = houseT.greaterThan(0.0).select(min(room.y, max(houseT, room.x)), room.y);
            const bc = dot(ray, rel);
            const dMin2 = max(dot(rel, rel).sub(bc.mul(bc)), 0.0);
            const k = sqrt(dMin2.add(AIR_REACH * AIR_REACH * 0.25));
            const chord = atan(tb.add(bc), k).sub(atan(ta.add(bc), k)).div(k).mul(AIR_REACH * AIR_REACH * 0.25);
            scene.addAssign(u.coreGain.mul(max(chord, 0.0)).mul(INNER_SMOKE * EXTINCTION).mul(u.breath));
        });

        // ── The air over it all ──
        const smoke = smokeSoft(st).toVar();
        // The mist lies on the sea: what stands in front of the sea (the lighthouse, its rock) is clear of it.
        const misted = float(1.0).sub(shown);
        const out = scene.mul(float(1.0).sub(smoke.b.mul(misted))).mul(smoke.a).add(smoke.r).add(smoke.g.mul(misted))
            .toVar();

        // ── The lens: halo, star-filter spikes and the glare of a beam looking at us ──
        // (attenuated by the air between us and the lamp, read at the lamp's place).
        const toP = normalize(u.pulsar.sub(o));
        const cosOff = clamp(dot(ray, toP), -1.0, 1.0);
        const off = sqrt(max(float(2.0).sub(cosOff.mul(2.0)), 0.0)).toVar(); // radians off it, about
        const veil = u.smokeAt(u.pulsarUv).a;
        const seen = u.coreSeen.mul(veil);
        const halo = float(1.0).div(float(1.0).add(off.mul(off).mul(9000.0))).mul(0.35)
            .add(float(1.0).div(float(1.0).add(off.mul(off).mul(300.0))).mul(0.03));
        const aspect = u.viewport.x.div(u.viewport.y);
        const dp = st.sub(u.pulsarUv).mul(vec2(aspect, 1.0));
        const spike = (cx, cy) => {
            const lengthwise = dp.x.mul(cx).add(dp.y.mul(cy));
            const across = dp.x.mul(cy.negate()).add(dp.y.mul(cx));
            const w = u.pixelAngle.mul(1.1).div(0.0012).mul(0.0009);
            return exp(across.mul(across).div(w.mul(w)).negate()).mul(exp(abs(lengthwise).mul(-16.0)));
        };
        const c45 = Math.SQRT1_2;
        const spikes = spike(float(c45), float(c45)).add(spike(float(c45), float(-c45)))
            .add(spike(float(1.0), float(0.0)).mul(0.35)).add(spike(float(0.0), float(1.0)).mul(0.35));
        const glare = float(1.0).div(float(1.0).add(off.mul(off).mul(22.0))).mul(u.glare);
        out.addAssign(halo.add(spikes.mul(0.9).mul(u.spikes)).mul(seen).add(glare.mul(veil.mul(0.6).add(0.4))));
        return vec4(vec3(max(out, 0.0)), 1.0);
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
    /** Draw the sea and the lighthouse, or leave them out (captures, bisecting a look). */
    part.show = ({ sea = true, tower: house = true } = {}) => {
        showSea.value = sea ? 1 : 0;
        showTower.value = house ? 1 : 0;
    };
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
    /** Paint the air for this frame (the camera uniforms must be current). */
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
