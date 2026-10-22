/**
 * Nebula Flow — the nursery: one full-screen triangle draws the whole picture, back to front.
 *
 *   the deep     a dark gradient and a powder of far stars, hidden where gas or lanes stand
 *   the cavity   glowing gas, brightest under the cluster, carried outward along its light by a
 *                flow map (two cross-faded reads), wound by the chain's vortex and a T-spin
 *   the veils    thin filaments of brighter gas in the same current
 *   the pillars  dust: a tapered-capsule distance per pillar, roughened by a baked relief whose
 *                gradient is exact (smooth normals), lit by the cluster from above and behind
 *                (faces dark, what turns toward the light catches it), self-shadowed by a few
 *                taps toward the light, a burning ionization front on every lit edge and the
 *                gas boiling off it
 *   the board's  every star a lock kindled glows inside the dust in the piece's colour (a lantern
 *   light        in fog); a released star boils a hole in the dust with a burning rim; fronts
 *                from the cluster flare every rim they cross and light the gas they pass
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
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log2,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    FRONT_ROWS, LANTERN_ROWS, NOISE_SIZE, PILLAR_ROWS, PILLAR_SLOTS, TAU,
} from './nebula-flow-core.js';
import {
    nfGauss, nfHash23, nfHue, nfSmin, nfTaper,
} from './nebula-flow-tsl.js';

/** Taps toward the cluster for the dust's self-shadow (nursery units). */
const LIGHT_STEPS = [0.02, 0.045, 0.085, 0.15, 0.26, 0.42, 0.65];

/** The share of the vortex's turn that winds the gas's coordinates (the arms show the rest). */
const VORTEX_TURN = 0.55;

/** 1 where the condition holds, else 0. */
const on = (cond) => cond.select(1, 0);

/**
 * @param {object} u          the world's uniforms (createNebulaUniforms)
 * @param {THREE.Texture} noiseTex
 * @param {THREE.Texture} reliefTex
 * @param {object} look       build-time switches from the tier:
 *   lightTaps (2..7)   shadow taps toward the cluster
 *   detail (1..3)      octaves of relief
 *   veils (bool)       the second veil octave and the near wisps
 *   litGas (bool)      the cavity's gas lit as a volume (one more pair of reads)
 *   stars (1..2)       far-star layers
 *   debug              'diffuse' | 'lit' | 'th' | 'n' (playground only)
 */
export function createNebulaMaterial(u, noiseTex, reliefTex, look = {}) {
    const lightTaps = Math.max(2, Math.min(LIGHT_STEPS.length, look.lightTaps ?? 5));
    const detail = Math.max(1, Math.min(3, look.detail ?? 3));
    const fineVeils = look.veils !== false;
    const litGas = look.litGas !== false;
    const starLayers = look.stars ?? 2;

    const N = (uvNode, level = null) => (level === null ? texture(noiseTex, uvNode) : texture(noiseTex, uvNode).level(level));

    /**
     * Signed distance to the dust (negative inside): the pillars and the ridge they stand on.
     * Returns vec2(distance, depth of the nearest pillar: 0 near … 1 far).
     */
    const shapeAt = Fn(([pIn]) => {
        const p = vec2(pIn).toVar();
        // the ridge: a low, lumpy crest along the bottom
        const crest = float(-0.86)
            .add(sin(p.x.mul(1.3).add(0.6)).mul(0.06))
            .add(sin(p.x.mul(2.9).add(1.7)).mul(0.035))
            .add(sin(p.x.mul(6.1).add(0.2)).mul(0.015));
        const d = p.y.sub(crest).toVar();
        const depth = float(0.25).toVar();
        Loop({
            start: int(0), end: int(PILLAR_SLOTS), type: 'int', condition: '<', name: 'pl',
        }, ({ pl }) => {
            const o = pl.mul(PILLAR_ROWS);
            const b = u.pillars.element(o.add(1));
            // two tapered capsules, foot → knee → head, laid out once per stage (packPillars):
            // (from, up) + (r1, length, b, a)
            const capsule = (row) => {
                const at = u.pillars.element(o.add(row));
                const k = u.pillars.element(o.add(row + 1));
                const rel = p.sub(at.xy);
                const local = vec2(dot(rel, vec2(at.w, at.z.negate())), dot(rel, at.zw));
                return nfTaper(local, k.x, k.x.sub(k.z.mul(k.y)), k.y, k.w, k.z);
            };
            const dp = nfSmin(capsule(2), capsule(4), float(0.05));
            // depth follows whichever surface is nearer (a soft switch across the union)
            const k = clamp(d.sub(dp).mul(6.0).add(0.5), 0, 1);
            depth.assign(mix(depth, b.z, k));
            d.assign(nfSmin(d, dp, float(0.16)));
        });
        return vec2(d, depth);
    });

    /**
     * The dust at p: its signed distance roughened by the relief. With `parts`, also the relief's
     * height (+ = a billow standing out) and its exact gradient (baked, so normals built from it
     * are smooth), the first read's (the billows) apart from the finer reads' (the grain).
     * `oct` octaves of relief; `shape` the pillars' shapeAt(p) when the caller already has it.
     */
    const dustAt = (p, oct, shape = null, parts = false) => {
        const warp = N(p.mul(0.31).add(vec2(0.11, 0.73)), 1).rb.sub(0.5).mul(0.28);
        const q = p.add(warp);
        const octaves = [[0.9, 0.0, 0.26], [2.3, 0.37, 0.1], [5.3, 0.71, 0.035]];
        let rough = null;
        let coarse = null;
        let fine = null;
        for (let i = 0; i < Math.min(oct, 3); i += 1) {
            const [f, off, amp] = octaves[i];
            // an explicit level from the pixel's footprint (texels of this octave per pixel), so
            // the read is legal inside a branch on WebGPU and still filtered at a distance
            const lod = max(log2(u.texel.mul(f * NOISE_SIZE)), 0);
            const r = texture(reliefTex, q.mul(f).add(off)).level(lod);
            const h = r.x.sub(0.5).mul(amp);
            const g = r.yz.mul(amp * f);
            rough = rough ? rough.add(h) : h;
            if (i === 0) coarse = g;
            else fine = fine ? fine.add(g) : g;
        }
        const sd = shape || shapeAt(p);
        const dist = sd.x.sub(rough);
        if (!parts) return dist;
        return {
            dist, rough, coarse, fine: fine || vec2(0), q,
        };
    };
    /**
     * The billows' slope alone: the first relief read again, two and a half levels up its mip
     * chain. A box-filtered chain of a gradient is the gradient of the filtered height, so this is
     * the slope of the relief with its finer octaves gone: lumps a fifth of a pillar wide.
     */
    const billowSlope = (q) => {
        const lod = max(log2(u.texel.mul(0.9 * NOISE_SIZE)), 0).add(2.5);
        return texture(reliefTex, q.mul(0.9)).level(lod).yz.mul(0.26 * 0.9);
    };
    /** Thickness of the dust: 0 outside, 1 deep inside; the edge is a translucent band. */
    const thick = (d) => smoothstep(0.02, -0.22, d);

    /** Two cross-faded reads of a layer carried along the outward flow (a flow map). */
    const flowed = (p, dir, rate, reach, read) => {
        const ph0 = fract(u.flow.mul(rate));
        const ph1 = fract(u.flow.mul(rate).add(0.5));
        const w0 = float(1).sub(abs(ph0.mul(2).sub(1)));
        const a = read(p.sub(dir.mul(ph0.mul(reach))), 0.0);
        const b = read(p.sub(dir.mul(ph1.mul(reach))), 0.5);
        return mix(b, a, w0);
    };

    /**
     * The chain's vortex and a T-spin's twist: turn a point about the board. The vortex turns the
     * gas only part of its way (VORTEX_TURN): wound its whole way, the shear drew every billow out
     * into arcs, a twirl filter over the picture; the spiral arms carry the rest.
     */
    const wind = (p) => {
        const rel = p.sub(u.vortex.xy);
        const r = length(rel);
        const fall = nfGauss(r.div(u.vortex.w));
        const ang = u.vortex.z.mul(fall).mul(VORTEX_TURN).add(u.twist.mul(nfGauss(r.div(1.15))));
        const c = cos(ang);
        const s = sin(ang);
        return vec2(rel.x.mul(c).sub(rel.y.mul(s)), rel.x.mul(s).add(rel.y.mul(c))).add(u.vortex.xy);
    };

    const fragment = Fn(() => {
        const ndc = varying(positionGeometry.xy, 'v_nfNdc');
        const screen = vec2(ndc.x.mul(u.aspect), ndc.y).mul(u.view.z).add(u.view.xy);
        // three depths of parallax: the deep, the gas, the dust
        const pFar = screen.add(u.cam.mul(0.3));
        const pGas = screen.add(u.cam.mul(0.6));
        const p = screen.add(u.cam).toVar();
        const t = u.time;

        // ── the deep ─────────────────────────────────────────────────────────
        const col = mix(u.deepLow, u.deepHigh, smoothstep(-1.0, 1.2, pFar.y)).toVar();

        // far stars: one per cell at most
        const starLayer = (scale, power, seed, rarity) => {
            const g = pFar.mul(scale).add(seed);
            const cell = floor(g);
            const h = nfHash23(cell);
            const at = cell.add(h.xy.mul(0.7).add(0.15));
            const r = length(g.sub(at));
            const present = smoothstep(rarity, 1.0, h.z);
            const tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.7, 0.84, 1.0), h.x);
            const twinkle = sin(t.mul(h.y.mul(2.0).add(0.6)).add(h.x.mul(TAU))).mul(0.25).add(0.85);
            return tint.mul(exp(r.mul(r).mul(-70.0)).mul(present).mul(power).mul(h.y.mul(h.y).add(0.15))
                .mul(twinkle));
        };
        let stars = starLayer(float(52.0), 1.1, vec2(3.1, 7.7), 0.8);
        if (starLayers >= 2) stars = stars.add(starLayer(float(21.0), 2.2, vec2(9.4, 1.3), 0.9));

        // ── the cavity: gas streaming out of the cluster's light ─────────────
        const q = wind(pGas).toVar();
        const rel = q.sub(u.cluster);
        const r = length(rel);
        const outward = rel.div(max(r, 1e-3));
        const warpC = N(q.mul(0.23).add(vec2(0.31, 0.6)), 1).rb.sub(0.5);
        const broad = (qq, off) => N(qq.mul(0.42).add(warpC.mul(0.55)).add(off)).r;
        const gasRead = (qq, off) => {
            const a = broad(qq, off);
            const { b } = N(qq.mul(1.1).add(warpC.mul(0.3)).add(off + 0.27));
            return vec2(a.mul(0.7).add(b.mul(0.45)), a);
        };
        const gasPair = flowed(q, outward, 1.0, 0.55, gasRead).toVar();
        const gas = gasPair.x;
        // The gas as a lit volume, not a pattern (nor, wound by the vortex, a twirl filter): its
        // broad billows read again a step nearer the cluster, in the same carried, wound
        // coordinates. Where the gas thickens away from the light, its face looks at the light.
        // (The lean tiers keep the gas flat: 0.5 is a face side-on to the light.)
        const nearer = litGas ? flowed(q.sub(outward.mul(0.05)), outward, 1.0, 0.55, broad) : null;
        const facing = litGas ? clamp(gasPair.y.sub(nearer).mul(9.0).add(0.5), 0, 1).toVar() : float(0.5);
        // how much of the cluster's light reaches this part of the cavity
        // (in a fever the light holds a share of its place while the gas winds through it: the
        // whirl reads as coloured arms over a deep cavity, not one pale sheet)
        const rLit = mix(r, length(pGas.sub(u.cluster)), u.lightHold);
        const nearLight = float(1).div(pow(rLit.div(1.25), 2.6).add(1.0)).mul(u.shine).toVar();
        const gasDen = pow(smoothstep(0.34, 1.05, gas), 1.8).toVar();
        // the vortex gathers the gas into two spiral arms about the board with dark lanes between,
        // wound the way the gas is and turning with the chain
        const vAt = pGas.sub(u.vortex.xy);
        const vr = max(length(vAt), 0.02);
        const vTurned = vec2(
            vAt.x.mul(u.vortexSpin.x).add(vAt.y.mul(u.vortexSpin.y)),
            vAt.y.mul(u.vortexSpin.x).sub(vAt.x.mul(u.vortexSpin.y)),
        );
        const spiral = cos(atan(vTurned.y, vTurned.x).add(log2(vr).mul(1.6)).mul(2.0));
        const armsOn = clamp(u.vortex.z.div(3.0), 0, 1).mul(nfGauss(vr.div(u.vortex.w.mul(1.25))));
        gasDen.mulAssign(mix(float(1), smoothstep(-0.35, 0.85, spiral).mul(1.5).add(0.12), armsOn));
        // the emission's colour by how close to the cluster: hot pale core, saturated middle, dim rim
        const cavityCol = mix(u.cavityFar, u.cavityNear, smoothstep(0.0, 0.9, nearLight)).toVar();
        cavityCol.assign(mix(cavityCol, u.clusterGlow, smoothstep(0.75, 1.2, nearLight).mul(0.6)));
        // the prismatic palette spreads the gas round the hue wheel
        const prismHue = fract(atan(rel.y, rel.x).div(TAU).mul(3.0).add(gas.mul(0.6))
            .add(r.mul(0.18))
            .add(t.mul(0.004)));
        const prismCol = nfHue(prismHue).mul(mix(0.25, 1.0, smoothstep(0.0, 0.9, nearLight)));
        cavityCol.assign(mix(cavityCol, prismCol, u.prism.mul(0.85)));
        const glow = gasDen.mul(nearLight.mul(1.2).add(0.09)).toVar();
        // the faces turned to the light are brighter and take its colour at their edges; those
        // turned away sink
        const relief = glow.mul(mix(0.55, 1.45, smoothstep(0.15, 0.85, facing)));
        cavityCol.assign(mix(cavityCol, u.clusterGlow, smoothstep(0.6, 1.0, facing).mul(nearLight).mul(0.35)));
        // lanes of cool dust in the cavity: they hide the gas behind them
        const lane = smoothstep(0.5, 0.8, N(q.mul(0.6).add(warpC.mul(0.8)).add(vec2(0.53, 0.19))).b);
        const laneT = exp(lane.mul(-1.4));
        col.addAssign(stars.mul(exp(gasDen.mul(-2.0))).mul(laneT));

        // fronts: the cluster's light sent down through the nursery by a clear
        const frontLit = vec3(0).toVar();
        const frontSum = float(0).toVar();
        Loop({
            start: int(0), end: u.frontCount, type: 'int', condition: '<', name: 'fr',
        }, ({ fr }) => {
            const A = u.fronts.element(fr.mul(FRONT_ROWS));
            const C = u.fronts.element(fr.mul(FRONT_ROWS).add(1));
            const x = length(p.sub(A.xy)).sub(A.z).div(A.w);
            // a sharp leading edge and a short glow behind it
            const wake = exp(min(x, 0).mul(2.2)).mul(on(x.lessThan(0))).mul(0.12);
            const band = exp(x.mul(x).negate()).add(wake).mul(C.w);
            frontLit.addAssign(C.rgb.mul(band));
            frontSum.addAssign(band);
        });
        // the gas a front crosses glows in its own hue, brightened, not as a grey smoke
        const cavityHue = cavityCol.div(max(max(cavityCol.x, max(cavityCol.y, cavityCol.z)), 1e-3));
        const frontGas = frontLit.mul(mix(vec3(1), cavityHue, 0.55)).mul(gasDen.mul(1.1).add(0.012)).mul(u.iris);

        col.addAssign(cavityCol.mul(relief).mul(laneT.mul(0.7).add(0.3)));
        col.addAssign(frontGas);
        // the vortex glows in the colours of the pieces that wound it: one arm per quarter turn
        // about its heart, read in the wound gas so the arms spiral with it. The weights are the
        // squared halves of the arm's cos and sin (they sum to 1: no trig, no seams).
        const windAmt = clamp(length(q.sub(pGas)).mul(2.5), 0, 1);
        const armAt = q.sub(u.vortex.xy);
        const armDir = vec2(
            armAt.x.mul(u.vortexSpin.x).sub(armAt.y.mul(u.vortexSpin.y)),
            armAt.x.mul(u.vortexSpin.y).add(armAt.y.mul(u.vortexSpin.x)),
        ).div(max(length(armAt), 1e-3));
        const armP = max(armDir, vec2(0));
        const armN = max(armDir.negate(), vec2(0));
        const armTint = u.vortexArms[0].mul(armP.x.mul(armP.x)).add(u.vortexArms[1].mul(armP.y.mul(armP.y)))
            .add(u.vortexArms[2].mul(armN.x.mul(armN.x)))
            .add(u.vortexArms[3].mul(armN.y.mul(armN.y)));
        col.addAssign(armTint.mul(u.vortexGlow).mul(gasDen.mul(0.8).add(0.012)).mul(windAmt).mul(u.iris));
        // the cluster's own glow, beyond the frame's top
        col.addAssign(u.clusterGlow.mul(exp(length(pGas.sub(u.cluster)).mul(-1.6))).mul(0.45).mul(u.shine));

        // ── the veils: filaments in the same current ─────────────────────────
        const side = vec2(outward.y, outward.x.negate());
        const veilRead = (qq, off) => {
            const along = dot(qq, outward);
            const across = dot(qq, side);
            const f1 = N(vec2(across.mul(1.5), along.mul(0.8)).add(warpC.mul(0.7)).add(off)).a;
            let v = pow(f1, 4.0).mul(0.8);
            if (fineVeils) {
                const f2 = N(vec2(across.mul(3.4), along.mul(1.8)).add(warpC.mul(0.5)).add(off + 0.41)).a;
                v = v.add(pow(f2, 5.0).mul(0.35));
            }
            return v;
        };
        const veil = flowed(q, outward, 1.35, 0.4, veilRead)
            .mul(smoothstep(0.3, 0.75, gas)).mul(nearLight.mul(0.9).add(0.04));
        const veilCol = mix(u.veil, nfHue(fract(prismHue.add(0.33))), u.prism.mul(0.85));
        col.addAssign(veilCol.mul(veil).mul(0.55).mul(laneT).mul(frontSum.mul(1.5).add(1)));

        // ── the pillars ──────────────────────────────────────────────────────
        // the pillars' shape once: the relief's read and the normal's slope both start from it
        const shape0 = shapeAt(p).toVar();
        const dust = dustAt(p, detail, shape0, true);
        const dDust = dust.dist.toVar();
        const rough = dust.rough.toVar();
        const gCoarse = dust.coarse.toVar();
        const gGrain = dust.fine.toVar();
        const qDust = dust.q.toVar();
        const depth = shape0.y;

        // the stars the board kindled: their glow inside the dust, and the holes the released
        // ones boil open. Their light and holes are worked out once a frame on the CPU and only
        // the lit ones are packed, so a pixel pays for what shows.
        const lantern = vec3(0).toVar();
        const carve = float(-10).toVar();
        const holeRim = vec3(0).toVar();
        Loop({
            start: int(0), end: u.lanternCount, type: 'int', condition: '<', name: 'bi',
        }, ({ bi }) => {
            const A = u.lanterns.element(bi.mul(LANTERN_ROWS));
            const C = u.lanterns.element(bi.mul(LANTERN_ROWS).add(1));
            const dist = length(p.sub(A.xy));
            lantern.addAssign(C.rgb.mul(A.z).mul(nfGauss(dist.div(C.w))));
            const hr = A.w;
            carve.assign(max(carve, hr.sub(dist)));
            holeRim.addAssign(C.rgb.mul(exp(abs(dist.sub(hr)).mul(-70.0))).mul(on(hr.greaterThan(0.004))));
        });
        // the great star's hole, healing
        const greatHole = u.hole.z.mul(float(1).sub(u.hole.w)).sub(length(p.sub(u.hole.xy)));
        carve.assign(max(carve, greatHole));
        const d = max(dDust, carve).toVar();
        const th = thick(d).toVar();

        const toL = normalize(u.cluster.sub(p)).toVar();
        // Only near the dust is it worth working out how the light falls on it: in the open
        // cavity (most of the frame) the dust's light terms have faded to nothing.
        const lit = float(1).toVar();
        // the same column seen through the light the dust scatters inside itself: it reaches
        // deeper than the direct light, so the billows on a pillar's face still read
        const litSoft = float(1).toVar();
        // dust a little way back from the light: where there is, this point lies over a face the
        // light is boiling (a head, a shoulder), in the plume it streams off
        const upwind = float(0).toVar();
        // the plumes' strands: the gas drawn out along the light, running toward it with the flow
        const strand = float(0).toVar();
        const n = vec3(0, 0, 1).toVar();
        If(d.lessThan(0.32), () => {
            upwind.assign(thick(dustAt(p.sub(toL.mul(0.14)), 1)));
            const strandAt = vec2(
                dot(p, vec2(toL.y, toL.x.negate())).mul(5.5),
                dot(p, toL).mul(1.2).sub(u.flow.mul(0.11)),
            );
            strand.assign(N(strandAt.add(vec2(0.19, 0.63)), max(log2(u.texel.mul(5.5 * NOISE_SIZE)), 0)).g);
            // column density toward the light: the shadows the pillars throw on themselves
            const tau = float(0).toVar();
            for (let i = 0; i < lightTaps; i += 1) {
                tau.addAssign(thick(dustAt(p.add(toL.mul(LIGHT_STEPS[i])), i < 2 ? detail : 1)));
            }
            lit.assign(exp(tau.mul(-1.25)));
            litSoft.assign(exp(tau.mul(-0.32)));
            // relief: the dust as a surface whose height rises from its edge (a rounded column)
            // with the billows on it. The shape's own slope fades out toward the middle of a
            // pillar (its medial axis is a crease in any distance field). The billows round the
            // dust everywhere; the full reads' slope crisps only its skin: every octave of an fBm
            // has the same slope, so read whole, the grain outweighed the billows and the dust
            // shaded as crumpled foil. Only the dust itself and its skin read the normal: the
            // shadow taps above reach further out, the slope does not need to.
            If(d.lessThan(0.1), () => {
                const e = 0.004;
                const s0 = shape0.x;
                const gShape = vec2(shapeAt(p.add(vec2(e, 0))).x.sub(s0), shapeAt(p.add(vec2(0, e))).x.sub(s0)).div(e);
                const edgeW = exp(min(d, 0).mul(11.0));
                const gRelief = billowSlope(qDust).mul(1.1)
                    .add(gCoarse.mul(edgeW.mul(0.25).add(0.1)))
                    .add(gGrain.mul(edgeW.mul(0.25).add(0.04)));
                const gradD = gShape.mul(edgeW.mul(1.3)).sub(gRelief);
                n.assign(normalize(vec3(gradD, 1.0)));
            });
        });
        // the cluster stands above and a little behind the pillars: faces stay dark, what turns
        // toward the light catches it
        const L3 = normalize(vec3(toL, -0.15));
        const diffuse = max(dot(n, L3).add(0.25).div(1.25), 0).toVar();
        // how strongly the cluster lights this height of the nursery
        const sun = exp(length(u.cluster.sub(p)).sub(1.2).max(0).mul(-0.55)).mul(u.shine);
        const alpha = float(1).sub(exp(th.mul(-5.5))).mul(float(1).sub(depth.mul(0.25))).toVar();

        // the dust: dark where the light cannot reach, warm where it does; interior lanes
        const inner = N(p.mul(1.7).add(vec2(0.77, 0.21))).r;
        const lanes = N(p.mul(0.75).add(vec2(0.13, 0.57))).b;
        const height = smoothstep(-1.1, 0.6, p.y);
        // the billows stand out and the folds between them sink: an occlusion from the relief's
        // own height
        const fold = smoothstep(-0.07, 0.09, rough).mul(0.55).add(0.45);
        const dustCol = u.dustDark.mul(inner.mul(0.8).add(0.45)).mul(height.mul(0.9).add(0.55)).mul(fold).toVar();
        // the cavity's light falls on the dust from in front: a cool fill in the shadows
        dustCol.addAssign(cavityCol.mul(glow.mul(0.25).add(0.02)).mul(max(n.z, 0).mul(0.6).add(0.2)));
        dustCol.addAssign(u.dustLit.mul(diffuse.mul(lit)).mul(sun).mul(fold).mul(1.25));
        // light the dust scatters on inside itself: the billows that turn toward the cluster keep
        // a warm glow deep into a pillar, so its face is a heap of lit lumps, not a silhouette
        const deepLight = max(dot(n, L3).add(0.3), 0).div(1.3).mul(litSoft).mul(float(1).sub(lit));
        dustCol.addAssign(mix(u.dustLit, u.dustGlow, 0.35).mul(deepLight).mul(sun).mul(fold.mul(fold))
            .mul(0.3));
        dustCol.addAssign(u.dustGlow.mul(smoothstep(0.7, 1.0, inner)).mul(th.mul(th)).mul(0.25));
        // back-lit edges: the cavity's own light through the thin rim on the shadowed side
        const rim = th.mul(float(1).sub(th)).mul(4.0).mul(float(1).sub(lit));
        dustCol.addAssign(cavityCol.mul(glow.mul(0.6).add(0.04)).mul(rim).mul(0.45));
        // the stars the board kindled light the dust round them from within (the dust's own
        // grain shows in their light)
        dustCol.addAssign(lantern.mul(th).mul(inner.mul(0.9).add(0.25)).mul(0.32).mul(u.iris));
        // the far pillars stand behind more of the glowing gas
        dustCol.assign(mix(dustCol, cavityCol.mul(glow.add(0.06)), depth.mul(0.55)));
        // translucent lanes: thinner dust lets the cavity show through
        alpha.mulAssign(float(1).sub(smoothstep(0.45, 0.85, lanes).mul(0.35)));
        // what shows through thin dust is reddened (it takes more blue than red), then the dust's
        // own light on top
        const through = pow(vec3(max(float(1).sub(alpha), 1e-4)), vec3(0.78, 1.0, 1.32));
        col.assign(col.mul(through).add(dustCol.mul(alpha)));
        // thin dust passes the cluster's light on toward the eye (forward scatter): a warm,
        // translucent band just inside every lit edge, under the front's hairline
        // (its depth and strength vary with the billows, so it is not an outline drawn round them)
        const sheerAt = d.add(rough.mul(0.25)).add(0.035);
        const sheer = exp(abs(sheerAt).mul(-26.0)).mul(lit.mul(lit)).mul(sun)
            .mul(diffuse.mul(0.6).add(0.4))
            .mul(inner.mul(0.9).add(0.3));
        col.addAssign(mix(u.dustLit, u.front, 0.3).mul(sheer).mul(0.42));
        // the lantern's haze in the gas just outside the dust
        col.addAssign(lantern.mul(float(1).sub(alpha)).mul(0.05).mul(u.iris));

        // the ionization front: a thin skin on every lit edge, flaring as a front crosses it
        const flare = frontSum.mul(3.0).add(1.0);
        const skin = exp(abs(d.add(0.008)).mul(-90.0)).mul(lit.mul(lit)).mul(sun).mul(diffuse.mul(0.7).add(0.3));
        // the heat of play keeps the rims burning (u.burn − 1 on top of their own light); the
        // fronts flare them as ever
        col.addAssign(u.front.mul(skin).mul(1.6).mul(flare.add(u.burn).sub(1)));
        col.addAssign(frontLit.mul(skin).mul(2.0).mul(u.iris));
        // the burning rims of the holes the released stars boiled open
        col.addAssign(holeRim.mul(th.mul(0.6).add(0.15)).mul(0.6).mul(u.iris));
        // the gas the light boils off a lit face, streaming toward the light
        const outside = max(d, 0);
        const across = dot(p, vec2(toL.y, toL.x.negate()));
        const streak = N(vec2(across.mul(2.0), dot(p, toL).mul(0.6).sub(u.flow.mul(0.05)))).r;
        const evap = exp(outside.mul(-13.0)).mul(lit.mul(lit)).mul(sun).mul(float(1).sub(th))
            .mul(streak.mul(0.7).add(0.45));
        col.addAssign(u.evap.mul(evap).mul(0.3).mul(flare));
        // the plumes: that gas carried on toward the cluster in long, thin streamers off every lit
        // head and shoulder, running outward with the flow (faded out before the band where the
        // light is worked out ends)
        const plume = upwind.mul(exp(outside.mul(-3.6))).mul(smoothstep(0.32, 0.16, d)).mul(lit.mul(lit)).mul(sun)
            .mul(float(1).sub(th))
            .mul(strand.mul(strand).mul(strand).mul(2.4).add(0.1));
        // (a front only stirs the plumes and the halo: flared like the hairline, they washed a
        // whole pillar pale)
        const stir = frontSum.mul(0.8).add(1.0);
        col.addAssign(mix(u.evap, u.front, 0.4).mul(plume).mul(0.5).mul(stir));
        // the gas just off a lit face is the densest the light reaches: a halo in the cavity's own
        // colour over every lit edge, which lifts the dust off the gas behind it
        const halo = exp(outside.mul(-6.5)).mul(smoothstep(0.32, 0.12, d)).mul(lit).mul(sun)
            .mul(float(1).sub(th))
            .mul(strand.mul(0.6).add(0.4));
        col.addAssign(mix(cavityCol, u.clusterGlow, 0.35).mul(halo).mul(0.085).mul(stir));

        // ── the near air ─────────────────────────────────────────────────────
        // the pillars rise out of a haze that lies low over the ridge, and wisps of gas drift in
        // front of the dust (both nearer than the dust: they move further with the parallax)
        // (each only where it can show: the haze below the middle, the wisps beside the board)
        const pNear = screen.add(u.cam.mul(1.4)).toVar();
        const low = smoothstep(0.15, -1.0, pNear.y).toVar();
        If(low.greaterThan(0.0), () => {
            const mist = N(vec2(pNear.x.mul(0.32).add(u.flow.mul(0.01)), pNear.y.mul(0.85)).add(vec2(0.41, 0.17)), 1).r;
            const haze = low.mul(low).mul(smoothstep(0.25, 0.75, mist).mul(0.75).add(0.25)).mul(0.42);
            const hazeCol = mix(u.cavityFar, cavityCol, 0.45).mul(glow.mul(0.5).add(0.06))
                .add(u.dustLit.mul(sun.mul(0.012)));
            col.assign(col.mul(float(1).sub(haze.mul(0.55))).add(hazeCol.mul(haze)));
        });
        if (fineVeils) {
            // wisps: thin threads of lit gas, drawn out across the frame's diagonal and drifting
            // with the flow, strongest beside the board where the pillars stand
            const flank = smoothstep(0.35, 1.1, abs(pNear.x)).mul(smoothstep(1.0, -0.2, pNear.y)).toVar();
            If(flank.greaterThan(0.0), () => {
                const wq = vec2(dot(pNear, vec2(0.87, 0.5)), dot(pNear, vec2(-0.5, 0.87)));
                const thread = N(vec2(wq.x.mul(0.5).add(u.flow.mul(0.015)), wq.y.mul(1.4)).add(vec2(0.07, 0.29)), 1).a;
                const wisp = smoothstep(0.55, 0.95, thread).mul(flank);
                col.addAssign(mix(cavityCol, u.veil, 0.4).mul(wisp).mul(nearLight.mul(0.5).add(0.05)).mul(0.22));
            });
        }

        // the hush before the great star: everything sinks
        col.mulAssign(float(1).sub(u.hush.mul(0.75)));

        if (look.debug === 'diffuse') return vec4(vec3(diffuse.mul(th)), 1);
        if (look.debug === 'lit') return vec4(vec3(lit), 1);
        if (look.debug === 'th') return vec4(vec3(th), 1);
        if (look.debug === 'n') return vec4(n.mul(0.5).add(0.5), 1);
        return vec4(col, 1);
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    material.fragmentNode = fragment();
    material.depthTest = false;
    material.depthWrite = false;
    return material;
}

/** The nursery as a part (drawn first; everything else adds light on top). */
export function createNebula(u, noiseTex, reliefTex, look) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = createNebulaMaterial(u, noiseTex, reliefTex, look);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NebulaFlow.nebula';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 0;
    return { mesh, material, geometry };
}
