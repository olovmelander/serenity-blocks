/**
 * Galaxy — the disc: gas, dust and the bulge, as one volume.
 *
 * One box round the disc, shaded per view ray in the galaxy's own frame. The ray is walked
 * through the slab in layers that crowd toward the midplane (where the dust lies), front to
 * back, each layer adding its light through what the dust before it lets pass:
 *
 *   old disc    the warm light of the old stars: an exponential, a little brighter in the arms;
 *   arms        the young blue light: a two-armed logarithmic spiral whose phase is torn by
 *               noise read in the spiral's own coordinates, so its clumps run along the arms;
 *   nurseries   knots of glowing gas on the trailing, outer edge of each arm;
 *   dust        feathered lanes on the inner edge of each arm. They take the blue first, so
 *               light seen through thin dust reddens before it goes out;
 *   bar         the short bar the arms leave from.
 *
 * The bulge is not marched: its light along the ray is a closed form, split at the midplane —
 * the half in front of the dust arrives whole, the half behind it through the lanes. That split
 * is what draws the dark lanes across the near side of the bulge and hides them on the far side.
 *
 * What gameplay writes into the disc is read once per pixel, where the ray meets the midplane:
 * the rings a lock's seed sends out round its nursery, the fronts of a clear running out from
 * the nucleus, and the rings a chain of clears stands round it.
 *
 * `march: 1` is the thin-disc solution: one sample on the midplane and the layers' thicknesses
 * as closed-form path lengths.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    cos,
    exp,
    float,
    floor,
    length,
    log,
    log2,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    screenCoordinate,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    GALAXY, MAX_RINGS, NOISE_SIZE, TAU, gxArmAngle, gxBell, gxFxMaterial, gxHash21, gxLuma, gxPart, gxRippleLight,
    gxWaveLight,
} from './galaxy-tsl.js';

/** Layer thicknesses (1/e half-heights): the young gas, the old stars, the dust. */
const H_GAS = 2.3;
const H_OLD = 4.3;
const H_DUST = 1.25;
/** How many times the feather noise repeats round the disc (an integer: the seam must close). */
const FEATHER_REPEAT = 5;
/** The fine grain: tiles per light-unit. */
const FINE_SCALE = 1 / 17;
/** Emission per light-unit of path. */
const OLD_GAIN = 0.05;
const YOUNG_GAIN = 0.15;
const KNOT_GAIN = 0.42;
const BAR_GAIN = 0.06;
/** Extinction per light-unit at the heart of a lane; blue goes first. */
const DUST_GAIN = 0.6;
const DUST_RGB = [0.72, 1.0, 1.34];
/** The bulge and the cluster at its heart: face-on central brightness. */
const BULGE_PEAK = 1.5;
const CLUSTER_PEAK = 2.6;
const CLUSTER_RADIUS = 1.35;
const SQRT_PI = Math.sqrt(Math.PI);

/**
 * @param {object} u  shared galaxy uniforms
 * @param {object} opts
 * @param {number} opts.march   layers walked through the slab (1 = thin disc)
 * @param {number} opts.detail  noise reads per pixel (1 or 2)
 */
export function createDisc(u, { march = 10, detail = 2 } = {}) {
    const B = GALAXY.bound;
    const H = GALAXY.halfHeight;
    const R = GALAXY.radius;
    const RD = GALAXY.scaleLength;
    const material = gxFxMaterial('GalaxyDisc');
    material.side = THREE.FrontSide;
    const steps = Math.max(1, Math.round(march));

    /**
     * The grain of the disc where the ray meets the midplane: two reads of the noise, shared by
     * every layer of the walk. Read per layer instead, a cloud is a column through the whole slab
     * and a leaning view smears it along the ray; read once, the clouds keep their edges.
     */
    const grainAt = (pm) => {
        const r = length(pm.xz).toVar();
        const theta = atan(pm.z, pm.x);
        const footprint = length(pm.sub(u.camLocal)).mul(u.pixelAngle).toVar();
        // The spiral's own coordinates: across the arms, and along them (so clumps follow them).
        const lodS = clamp(log2(footprint.mul(FEATHER_REPEAT * NOISE_SIZE).div(max(r, 5.0).mul(TAU))), 0.0, 7.0);
        const uvS = vec2(
            theta.sub(gxArmAngle(r, u.winding)).mul(FEATHER_REPEAT / TAU).sub(u.time.mul(0.0014)),
            log(max(r, 1.0)).mul(0.86).sub(u.time.mul(0.0009)),
        );
        const coarse = u.noiseLod(uvS, lodS).toVar();
        // Fine grain, the same everywhere: what breaks the arms into clouds, knots and filaments.
        let fine = coarse.gbar;
        if (detail >= 2) {
            const lodF = clamp(log2(footprint.mul(NOISE_SIZE * FINE_SCALE)).sub(0.5), 0.0, 7.0);
            fine = u.noiseLod(pm.xz.mul(FINE_SCALE).add(vec2(0.37, 0.11)), lodF).toVar();
        }
        // Nothing here is cut with a hard threshold: the light swells and fades, and it is the
        // dust — whose shadow is exponential in what it holds — that draws the edges.
        const swell = smoothstep(0.18, 0.86, coarse.b.mul(0.55).add(fine.r.mul(0.45)));
        const glow = smoothstep(0.5, 0.94, fine.b.mul(0.62).add(coarse.g.mul(0.38)));
        const thread = float(1.0).sub(abs(fine.a.mul(2.0).sub(1.0)));
        return {
            warp: coarse.r.sub(0.5).mul(1.7).add(fine.g.sub(0.5).mul(0.22)).toVar(),
            /** Clouds of young light: 0..1, soft. */
            clump: swell.mul(swell).toVar(),
            /** Glowing knots: soft blobs with a bright heart. */
            knots: glow.mul(glow).toVar(),
            /** Threads of dust: thin lines where the fine grain crosses its own middle. */
            threads: thread.mul(thread).mul(thread).toVar(),
            /** Where the dust gathers, on the scale of an arm. */
            patches: smoothstep(0.28, 0.74, coarse.a).toVar(),
        };
    };

    /**
     * Light and dust at a point of the galaxy's frame. `layered` applies the layers' vertical
     * profiles (the march); without it the values are the midplane's (the thin disc).
     */
    const sampleAt = (p, layered, grain) => {
        const r = length(p.xz).toVar();
        const phase = atan(p.z, p.x).sub(gxArmAngle(r, u.winding)).mul(GALAXY.arms).add(grain.warp)
            .toVar();
        // Two arms, and further out a fainter pair between them: the arms fork toward the rim.
        const fork = smoothstep(R * 0.3, R * 0.62, r).mul(0.3);
        const a = cos(phase).mul(0.5).add(0.5).add(cos(phase.mul(2.0).add(1.4)).mul(0.5).add(0.5).mul(fork))
            .toVar();
        const a2 = a.mul(a).toVar();
        const lane = cos(phase.sub(0.86)).mul(0.5).add(0.5).toVar();
        const knot = cos(phase.add(0.5)).mul(0.5).add(0.5).toVar();
        const armOn = smoothstep(GALAXY.armStart * 0.55, GALAXY.armStart * 1.7, r).toVar();
        const rim = float(1.0).sub(smoothstep(R * 0.8, R * 1.07, r)).toVar();

        const y2 = p.y.mul(p.y);
        const vGas = layered ? exp(y2.div(-H_GAS * H_GAS)) : float(1.0);
        const vOld = layered ? exp(y2.div(-H_OLD * H_OLD)) : float(1.0);
        const vDust = layered ? exp(y2.div(-H_DUST * H_DUST)) : float(1.0);

        // The old disc takes a little of the arms' colour away from the bulge.
        const oldTone = mix(u.core, mix(u.core, u.armInner, 0.6), smoothstep(R * 0.1, R * 0.55, r));
        const old = oldTone.mul(exp(r.div(-RD)).mul(a2.mul(0.5).add(0.42)).mul(grain.clump.mul(0.5).add(0.75)).mul(vOld)
            .mul(OLD_GAIN));
        // The young light keeps to the ridge: narrower than the old stars' swell.
        const young = mix(u.armInner, u.armOuter, smoothstep(R * 0.14, R * 0.8, r))
            .mul(a2.mul(a2).mul(armOn).mul(grain.clump.mul(1.6).add(0.2)).mul(exp(r.div(-RD * 2.4)))
                .mul(vGas)
                .mul(YOUNG_GAIN));
        const knots = u.nursery.mul(grain.knots.mul(knot.mul(knot).mul(knot)).mul(a).mul(armOn)
            .mul(exp(r.div(-RD * 2.8)))
            .mul(vGas)
            .mul(KNOT_GAIN));
        const bar = u.core.mul(exp(p.z.mul(p.z).div(-9.0)).mul(exp(r.mul(r).div(-150.0))).mul(vOld).mul(BAR_GAIN));
        const emission = old.add(young).add(knots).add(bar).mul(rim);

        const window = smoothstep(4.0, 13.0, r).mul(float(1.0).sub(smoothstep(R * 0.7, R, r)));
        // Lanes on the inner edge of each arm, threaded; and spurs of the same thread across the arm.
        const sigma = lane.mul(lane).mul(grain.threads.mul(grain.patches.add(0.35)).mul(1.9).add(0.3))
            .add(grain.threads.mul(grain.patches).mul(a).mul(0.55))
            .mul(window)
            .mul(vDust)
            .mul(DUST_GAIN);
        return { emission, sigma };
    };

    /** The light of a spheroid of core radius `a` along the ray: (in front of the midplane, behind it). */
    const spheroid = (o, d, tMid, a, flat) => {
        const os = vec3(o.x, o.y.div(flat), o.z);
        const ds = vec3(d.x, d.y.div(flat), d.z);
        const m2 = ds.dot(ds);
        const m = sqrt(m2);
        const od = os.dot(ds);
        const c2 = os.dot(os).sub(od.mul(od).div(m2)).add(a * a).toVar();
        const c = sqrt(c2).toVar();
        const s = tMid.add(od.div(m2)).toVar();
        const F = s.div(c2.mul(2.0).mul(c2.add(m2.mul(s).mul(s))))
            .add(atan(m.mul(s).div(c)).div(c2.mul(c).mul(m).mul(2.0)));
        const half = float(Math.PI * 0.25).div(c2.mul(c).mul(m));
        const norm = m.mul((2 * a * a * a) / Math.PI);
        return vec2(F.add(half).mul(norm), half.sub(F).mul(norm));
    };

    material.colorNode = Fn(() => {
        const ro = vec3(positionLocal).toVar();
        const rd = normalize(ro.sub(u.camLocal)).toVar();
        const sgn = step(0.0, rd).mul(2.0).sub(1.0).toVar();
        const rs = sgn.mul(max(abs(rd), 1e-4)).toVar();
        const tx = sgn.mul(vec3(B, H, B)).sub(ro).div(rs).toVar();
        const tExit = max(min(tx.x, min(tx.y, tx.z)), 0.0).toVar();
        const tMid = clamp(ro.y.negate().div(rs.y), 0.0, tExit).toVar();
        const pm = ro.add(rd.mul(tMid)).toVar();
        const rm = length(pm.xz).toVar();
        const slope = max(abs(rd.y), 0.1).toVar();

        const grain = grainAt(pm);
        const acc = vec3(0.0).toVar();
        const T = vec3(1.0).toVar();
        const dustRgb = vec3(DUST_RGB[0], DUST_RGB[1], DUST_RGB[2]);
        if (steps === 1) {
            const s = sampleAt(pm, false, grain);
            const tau = s.sigma.mul((H_DUST * SQRT_PI)).div(slope).toVar();
            // Light born inside the dust layer leaves through half of it, on average.
            const through = exp(tau.mul(-0.5).mul(dustRgb));
            acc.assign(s.emission.mul(float(H_GAS * SQRT_PI).div(slope)).mul(through));
            T.assign(exp(tau.negate().mul(dustRgb)));
        } else {
            const jitter = gxHash21(floor(screenCoordinate).add(vec2(11.0, 47.0)));
            Loop(steps, ({ i }) => {
                // Layers crowd toward the midplane: y = ±H · (¼ξ + ¾ξ³), ξ from −1 to 1.
                const xi = float(i).add(jitter).mul(2 / steps).sub(1.0)
                    .toVar();
                const y = sgn.y.mul(H).mul(xi.mul(0.25).add(xi.mul(xi).mul(xi).mul(0.75)));
                const t = y.sub(ro.y).div(rs.y).toVar();
                const inside = step(0.0, t).mul(step(t, tExit));
                const dt = float((H * 2) / steps).mul(xi.mul(xi).mul(2.25).add(0.25)).div(slope).mul(inside);
                const s = sampleAt(ro.add(rd.mul(t)), true, grain);
                acc.addAssign(T.mul(s.emission).mul(dt));
                T.mulAssign(exp(s.sigma.mul(dt).negate().mul(dustRgb)));
            });
        }

        // ── The bulge and the cluster at its heart: in front of the dust, and behind it ──
        const bulge = spheroid(ro, rd, tMid, GALAXY.bulge, GALAXY.bulgeFlat).toVar();
        const cluster = spheroid(ro, rd, tMid, CLUSTER_RADIUS, 1.0).toVar();
        const heat = u.power.mul(0.5).add(u.surge.mul(0.6)).add(1.0);
        const near = u.core.mul(bulge.x.mul(BULGE_PEAK)).add(u.nucleus.mul(cluster.x.mul(CLUSTER_PEAK)).mul(heat));
        const far = u.core.mul(bulge.y.mul(BULGE_PEAK)).add(u.nucleus.mul(cluster.y.mul(CLUSTER_PEAK)).mul(heat));
        const col = near.add(acc).add(far.mul(T)).toVar();
        const gas = gxLuma(acc).toVar();
        const veil = T.x.add(T.y).add(T.z).div(3.0).toVar();

        // ── A chain of clears stands rings round the nucleus, one per step ──
        If(u.rings.greaterThan(0.01), () => {
            const round = atan(pm.z, pm.x).toVar();
            const halo = vec3(0.0).toVar();
            for (let k = 0; k < MAX_RINGS; k++) {
                const lit = clamp(u.rings.sub(k), 0.0, 1.0);
                const at = 12.5 + k * 6.2;
                const turn = (k % 2 === 0 ? 1 : -1) * (0.5 + k * 0.07);
                const lobes = k % 3 === 0 ? 2.0 : 3.0;
                const arcs = sin(round.mul(lobes).add(u.time.mul(turn)).add(k * 1.7)).mul(0.4).add(0.6);
                const line = gxBell(rm.sub(at).div(0.42)).add(gxBell(rm.sub(at).div(2.1)).mul(0.16));
                const tone = k % 2 === 0 ? u.jet.add(u.nucleus.mul(0.5)) : u.nursery.add(u.nucleus.mul(0.35));
                halo.addAssign(tone.mul(line).mul(arcs).mul(lit).mul(1.0 - k * 0.08));
            }
            col.addAssign(halo.mul(veil.mul(0.6).add(0.4)).mul(1.5));
        });

        // ── The board's light: ripples round the nurseries, the fronts of a clear ──
        If(u.ripplesLive.greaterThan(0.5), () => {
            col.addAssign(gxRippleLight(u, pm.xz).mul(gas.mul(7.0).add(0.008)));
        });
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = gxWaveLight(u, rm).toVar();
            const reach = float(1.0).sub(smoothstep(R * 0.86, R * 1.12, rm));
            col.addAssign(wave.rgb.mul(gas.mul(3.4).add(0.02)).mul(reach));
            col.addAssign(acc.mul(wave.a.mul(0.3)));
        });

        return vec4(col.mul(u.breath), float(1.0).sub(veil));
    })();

    const geometry = new THREE.BoxGeometry(B * 2, H * 2, B * 2);
    return gxPart('GalaxyDisc', geometry, material, -10);
}
