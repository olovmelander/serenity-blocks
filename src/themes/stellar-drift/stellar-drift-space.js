/**
 * Stellar Drift — the giant, its rings, the moons and the sky: one full-screen pass.
 *
 * Every pixel's view ray is traced against the giant (a unit sphere at the origin), the ring
 * plane (y = 0), the two moons and the sky behind them, and the picture is composited along the
 * ray: sky and moons, the rings' far side, the giant and its limb haze, the rings' near side.
 * That buys what a mesh cannot give cheaply:
 *
 *   - the rings' shadow on the cloud tops and the giant's shadow on the rings are exact, and
 *     both are read from the same radial profile the rings are drawn from, so every gap in the
 *     rings is a line of light in their shadow;
 *   - the rings are a slab of ice with an optical depth, not a texture: thin parts let the
 *     giant and the stars through, and how bright they are follows the light's and the eye's
 *     slant through them;
 *   - every edge (the limb, the moons, the ring gaps) is anti-aliased from its own distance in
 *     pixels, on any backend, with no multisampling.
 *
 * The cloud is not a picture either. Latitude chooses a band's colour from a table; the fBm
 * texture, read along each band's own wind (two reads half a cycle apart, cross-faded, so the
 * shear never winds up), bends that latitude and so tears the bands' edges into festoons; a few
 * ovals twist the lookup into spirals; and the whole globe turns under it.
 *
 * What the board does arrives as rows of one uniform table (EVENT_ROWS): ripples and chimes in
 * the rings, jets, strikes and lightning on the cloud; the larger rewards' flourishes (a
 * cyclone, two surges round the rings, the outer strand ablaze, two shells of light) as uniforms
 * of their own. How hot play runs (`drive`) winds the ovals tighter, lights their hearts and, in
 * a fever, sets the giant's air burning along its limb: a plasma corona.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    asin,
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
    sqrt,
    step,
    texture,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHIME_FRONT_GAP,
    CHIME_TRAVEL,
    DEG,
    EVENT_ROWS,
    GIANT,
    JET_SPEED,
    RINGS,
    RING_RATE,
    RING_TAU_MAX,
    RIPPLE_SHEAR,
    RIPPLE_SPEED,
    SHOCK_LIFE,
    TAU,
    sdBell,
    sdHash33,
    sdMax3,
    sdPart,
    sdPhase,
} from './stellar-drift-tsl.js';

/** An angle wrapped into −π..π. */
const wrapPi = (a) => fract(a.div(TAU).add(0.5)).mul(TAU).sub(Math.PI);

/**
 * The flare a large reward throws off the giant, at an age: the radius of its shell, how thick it
 * is, and how far the front it sends through the ring plane has run (that one runs on through the
 * whole system; the shell itself stays close, or it would cross the card as a giant's outline).
 */
const shockShape = (age) => [
    float(1.04).add(float(0.55).mul(float(1.0).sub(exp(age.mul(-1.8))))),
    age.mul(0.06).add(0.045),
    float(1.15).add(float(1.3).mul(float(1.0).sub(exp(age.mul(-1.3))))),
];

/** Radians of longitude the fastest jet carries the cloud over one flow cycle. */
export const FLOW_SPAN = 0.62;

/**
 * The ovals: [longitude (radians, the giant's own frame), latitude (degrees), half-width east–
 * west and north–south (radians), twist (radians at the heart), drift (radians per second in
 * the giant's frame), tint (1 = the storm's own colour, negative = a pale oval)].
 */
export const STORMS = Object.freeze([
    [0.6, 21.5, 0.2, 0.105, 2.6, 0.0011, 1.0],
    [2.5, -33.5, 0.062, 0.042, 2.2, -0.0016, -0.8],
    [3.05, -34.5, 0.05, 0.036, 2.2, -0.0016, -0.7],
    [3.5, -33.2, 0.056, 0.04, 2.2, -0.0016, -0.8],
    [-1.4, 34.0, 0.07, 0.04, -2.0, 0.0019, -0.6],
    [-2.6, -22.5, 0.11, 0.06, -2.4, 0.0008, 0.7],
    [1.9, 43.5, 0.05, 0.032, 2.0, -0.0013, 0.5],
    [-0.4, -46, 0.06, 0.036, 2.2, 0.0015, -0.6],
]);

/** Far stars: [cells across the sphere of directions, share of cells that hold one, size, gain]. */
const STAR_LAYERS = Object.freeze([
    [46.0, 0.34, 0.03, 7.0],
    [120.0, 0.34, 0.028, 2.6],
    [270.0, 0.3, 0.026, 1.2],
]);

/**
 * @param {object} u     shared uniforms
 * @param {object} tier  content tier (stellar-drift-quality.js)
 */
export function createSpace(u, tier) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StellarDriftSpace';
    material.fog = false;
    material.depthTest = false;
    material.depthWrite = false;
    // Clip space: the pass covers the frame whatever the camera does.
    material.vertexNode = vec4(positionGeometry.xy.mul(2.0), 0.5, 1.0);

    const storms = uniformArray(
        STORMS.slice(0, tier.storms).flatMap((s) => [
            new THREE.Vector4(s[0], s[1] * DEG, s[2], s[3]),
            new THREE.Vector4(s[4], s[5], s[6], 0),
        ]),
        'vec4',
    );
    const stormCount = Math.min(tier.storms, STORMS.length);
    const ringSpan = RINGS.to - RINGS.from;
    const ringTexel = ringSpan / u.ringSize;
    const row = (block, i, k) => u.events.element(i.mul(2).add(block + k));

    /** The rings' profile at radius r: (tau, ice, groove, dust). */
    const ringProfile = (r, lod) => {
        const p = texture(u.ringTex, vec2(r.sub(RINGS.from).div(ringSpan), 0.5)).level(lod);
        return vec4(p.r.mul(p.r).mul(RING_TAU_MAX), p.g, p.b, p.a);
    };

    /**
     * A chain's surge round the rings at a bearing (the world's frame): two arcs of light that
     * leave the bearing facing the camera and race apart round the system, behind the giant.
     * `S` is one of the two surges in flight.
     */
    const surgeAt = (bearing, S) => {
        const x = abs(wrapPi(bearing.sub(S.x))).sub(S.y).div(0.3);
        return exp(x.mul(x).negate()).mul(S.z);
    };

    /** One of the two shells in flight, at this frame's time: its shape and how bright it is. */
    const shockLane = (K) => {
        const age = u.time.sub(K.x).toVar();
        const live = step(0.0, age).mul(step(age, SHOCK_LIFE));
        const [shellRadius, shellWidth, frontRadius] = shockShape(age);
        return {
            R: shellRadius.toVar(),
            W: shellWidth.toVar(),
            front: frontRadius.toVar(),
            fade: smoothstep(0.0, 0.08, age).mul(exp(age.mul(-1.6))).mul(K.y).mul(live)
                .toVar(),
        };
    };

    material.colorNode = Fn(() => {
        // ── The ray ─────────────────────────────────────────────────────────────
        const ndc = uv().mul(2.0).sub(1.0);
        const ro = u.camPos;
        const rd = normalize(
            u.camFwd.add(u.camRight.mul(ndc.x.mul(u.tanHalf.x))).add(u.camUp.mul(ndc.y.mul(u.tanHalf.y))),
        ).toVar();
        const V = rd.negate().toVar();
        const S = u.sunDir;
        const sunLight = u.sun.mul(u.sunGain).toVar();
        const col = vec3(0.0).toVar();

        // The giant: where the ray comes closest to its centre, and how far that is.
        const B = dot(ro, rd).toVar();
        const tc = B.negate().toVar();
        const imp2 = max(dot(ro, ro).sub(B.mul(B)), 0.0).toVar();
        const imp = sqrt(imp2).toVar();
        const px = u.pixelAngle.mul(max(tc, 0.05)).toVar();
        const cover = clamp(float(0.5).sub(imp.sub(1.0).div(px)), 0.0, 1.0).mul(step(0.0, tc)).toVar();
        const tP = tc.sub(sqrt(max(float(1.0).sub(imp2), 0.0))).toVar();

        // The ring plane.
        const rdy = max(abs(rd.y), 1e-4).mul(step(0.0, rd.y).mul(2.0).sub(1.0)).toVar();
        const tR = ro.y.negate().div(rdy).toVar();
        const hit = ro.add(rd.mul(tR)).toVar();
        const rr = length(hit.xz).toVar();
        const muV = max(abs(rd.y), 0.02).toVar();
        /** 1 where the ring crossing lies nearer than the giant. */
        const front = step(tR, tc).toVar();

        // The flares large rewards throw off the giant (each front lights the rings as it crosses
        // them). Two can be in flight: a second never wipes the first.
        const shockA = shockLane(u.shock);
        const shockB = shockLane(u.shockB);

        // ── The sky ─────────────────────────────────────────────────────────────
        If(cover.lessThan(0.999), () => {
            const fz = max(dot(rd, u.skyFwd), 0.25);
            const s = vec2(dot(rd, u.skyRight), dot(rd, u.skyUp)).div(fz).mul(u.skyScale).toVar();
            // Inside a branch the sampler may not choose a mip: the sheet's scale is the same all
            // over the frame, so the level follows from the uniforms.
            const skyLod = (freq) => clamp(log2(u.pixelAngle.mul(u.skyScale).mul(freq * u.fbmSize)), 0.0, 6.0);
            const n1 = u.fbmLod(s.mul(0.42).add(vec2(0.13, 0.71)), skyLod(0.42)).toVar();
            const sw = s.add(n1.rg.sub(0.5).mul(0.46)).toVar();
            const n2 = u.fbmLod(sw.mul(1.05).add(vec2(0.57, 0.19)), skyLod(1.05)).toVar();
            const n3 = (tier.nebulaDetail > 0
                ? u.fbmLod(sw.mul(3.1).add(n2.rg.mul(0.3)), skyLod(3.1))
                : vec4(n2.b, n2.a, n2.r, n2.g)).toVar();

            // The bank: a spine of gas from one anchor to the other, with a head at each end.
            const pa = sw.sub(u.skyBank.xy).toVar();
            const ba = u.skyBank.zw.sub(u.skyBank.xy);
            const along = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0).toVar();
            const off = pa.sub(ba.mul(along));
            const pb = sw.sub(u.skyBank.zw);
            const body = clamp(
                exp(dot(off, off).mul(-9.0)).mul(0.62)
                    .add(exp(dot(pa, pa).mul(-4.2)).mul(0.95))
                    .add(exp(dot(pb, pb).mul(-6.5)).mul(0.6)),
                0.0,
                1.3,
            ).toVar();
            const cloud = smoothstep(0.3, 0.86, n1.r.mul(0.46).add(n2.g.mul(0.54))).toVar();
            const dens = cloud.mul(body).toVar();
            const side = clamp(along.add(n1.b.sub(0.5).mul(0.9)), 0.0, 1.0);
            const gas = mix(u.gasA, u.gasB, smoothstep(0.2, 0.8, side)).toVar();
            // Thin bright threads where the fine field crosses its middle, dark lanes of dust.
            // (A tier without the fine field has no threads: a fold of the coarse one would
            // paint broad bright bands instead.)
            const fold = float(1.0).sub(abs(n3.a.mul(2.0).sub(1.0)));
            const thread = tier.nebulaDetail > 0
                ? fold.mul(fold).mul(fold).mul(smoothstep(0.28, 0.7, n2.r))
                : float(0.0);
            const lane = smoothstep(0.46, 0.76, n2.b.mul(0.55).add(n3.r.mul(0.45))).mul(smoothstep(0.05, 0.45, dens));
            const heart = dens.mul(dens).mul(dens);
            const fold2 = float(1.0).sub(abs(n2.a.mul(2.0).sub(1.0)));
            const wisp = fold2.mul(fold2).mul(smoothstep(0.2, 0.7, n1.g));
            const glow = gas.mul(dens.mul(dens).mul(0.36).add(thread.mul(dens).mul(0.44)).add(wisp.mul(dens).mul(0.2)))
                .add(mix(gas, vec3(1.0, 0.96, 0.9), 0.45).mul(heart.mul(0.5)));
            // A second, far fainter veil of the other gas fills the rest of the sky.
            const veil = mix(u.gasB, u.gasA, n1.g).mul(smoothstep(0.35, 0.9, n1.a.mul(0.6).add(n2.a.mul(0.4)))).mul(0.016);
            const sky = u.deep.mul(s.y.mul(0.22).add(1.0))
                .add(glow.mul(float(1.0).sub(lane.mul(0.86))).mul(tier.nebulaDetail > 0 ? 1.0 : 0.7))
                .add(veil.mul(float(1.0).sub(lane.mul(0.6))))
                .toVar();

            // Far stars: one per cell of a lattice the sphere of directions cuts through.
            const pixel = u.pixelAngle;
            const starLayer = (scale, chance, size, gain) => {
                const p = rd.mul(scale);
                const id = floor(p);
                const h = sdHash33(id);
                const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
                const d = length(f.sub(rd.mul(dot(f, rd))));
                // Never smaller than a pixel: a sub-pixel star would shimmer as the camera drifts.
                const r = max(float(size), pixel.mul(scale).mul(0.75));
                const ratio = float(size).div(r);
                const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(ratio.mul(ratio));
                const m2 = h.z.mul(h.z);
                const mag = m2.mul(m2).mul(h.z).mul(0.95).add(0.05);
                const twinkle = sin(u.time.mul(h.y.mul(2.4).add(0.6)).add(h.x.mul(40.0))).mul(0.22).add(0.78);
                const tint = mix(u.starTint, vec3(1.0, 0.82, 0.62), smoothstep(0.7, 1.0, h.y));
                return tint.mul(core.mul(mag).mul(twinkle).mul(step(h.x, chance)).mul(gain));
            };
            let stars = vec3(0.0);
            for (let i = 0; i < Math.min(tier.starLayers, STAR_LAYERS.length); i++) {
                const [scale, chance, size, gain] = STAR_LAYERS[i];
                stars = stars.add(starLayer(scale, chance, size, gain));
            }
            sky.addAssign(stars.mul(float(1.0).sub(dens.mul(0.6))));
            col.assign(sky);

            // ── The moons ───────────────────────────────────────────────────────
            const moon = (M, kind) => {
                const oc = ro.sub(M.xyz).toVar();
                const b = dot(oc, rd).toVar();
                const d2 = max(dot(oc, oc).sub(b.mul(b)), 0.0).toVar();
                const mpx = u.pixelAngle.mul(max(b.negate(), 0.05));
                const cov = clamp(float(0.5).sub(sqrt(d2).sub(M.w).div(mpx)), 0.0, 1.0).mul(step(0.0, b.negate())).toVar();
                If(cov.greaterThan(0.001), () => {
                    const tm = b.negate().sub(sqrt(max(M.w.mul(M.w).sub(d2), 0.0)));
                    const N = normalize(ro.add(rd.mul(tm)).sub(M.xyz)).toVar();
                    const q = N.mul(kind === 0 ? 7.0 : 5.0).add(vec3(u.time.mul(kind === 0 ? 0.006 : 0.011), 3.1, 1.7)).toVar();
                    const a = u.noise3(q).toVar();
                    const bN = u.noise3(q.mul(2.7).add(11.0)).toVar();
                    const albedo = vec3(0.0).toVar();
                    if (kind === 0) {
                        // Ice: pale plains, blue-grey patches, and long cracks.
                        const crack = float(1.0).sub(abs(bN.x.mul(2.0).sub(1.0)));
                        const lines = pow(crack, 12.0).mul(smoothstep(0.35, 0.7, a.y));
                        albedo.assign(mix(u.moonIce, u.moonIce.mul(vec3(0.5, 0.62, 0.8)), smoothstep(0.38, 0.72, a.x)));
                        albedo.mulAssign(float(0.86).add(bN.y.mul(0.2)).sub(lines.mul(0.42)));
                    } else {
                        // Rust: sulphur plains, dark calderas with pale rims.
                        const spot = smoothstep(0.66, 0.8, bN.x);
                        const rim = sdBell(bN.x.sub(0.64).div(0.05));
                        albedo.assign(mix(u.moonRust, u.moonRust.mul(vec3(1.2, 1.1, 0.72)), smoothstep(0.3, 0.75, a.x)));
                        albedo.assign(mix(albedo, u.moonRust.mul(vec3(0.22, 0.12, 0.1)), spot.mul(0.85)));
                        albedo.mulAssign(float(0.82).add(a.y.mul(0.26)).add(rim.mul(0.3)));
                    }
                    const m0 = dot(N, S).toVar();
                    const lit = pow(max(m0, 0.0), 0.84).mul(smoothstep(-0.03, 0.1, m0));
                    // The giant's own light on the side that faces it.
                    const toGiant = normalize(M.xyz.negate());
                    const shine = max(dot(N, toGiant), 0.0).mul(0.035);
                    const light = sunLight.mul(lit).mul(1.05).add(u.shine.mul(shine)).add(u.night.mul(0.015));
                    col.assign(mix(col, albedo.mul(light), cov));
                });
            };
            moon(u.moonA, 0);
            moon(u.moonB, 1);

            // The icy moon vents: a fan of fine jets from its south, lit from behind.
            If(u.plume.greaterThan(0.004), () => {
                const M = u.moonA;
                const oc = ro.sub(M.xyz).toVar();
                const tca = dot(oc, rd).negate();
                const near = oc.add(rd.mul(tca)).toVar(); // the ray's closest point, from the moon's centre
                const up = dot(near, u.plumeDir).div(M.w).toVar();
                const lateral = length(near.sub(u.plumeDir.mul(dot(near, u.plumeDir)))).div(M.w).toVar();
                const rise = max(up.sub(0.75), 0.0).toVar();
                const wide = rise.mul(0.34).add(0.2);
                const fan = exp(lateral.mul(lateral).div(wide.mul(wide)).negate());
                // Fine separate jets across the fan.
                const strands = sin(lateral.mul(26.0).div(wide.add(0.3)).add(M.x.mul(3.0))).mul(0.5).add(0.5);
                const fall = exp(rise.mul(-0.62)).mul(smoothstep(0.75, 1.02, up));
                const fwd = sdPhase(dot(rd, S), float(0.6)).mul(0.5).add(0.5);
                col.addAssign(u.moonIce.mul(sunLight).mul(fan.mul(fall).mul(strands.mul(0.55).add(0.45)))
                    .mul(fwd).mul(u.plume)
                    .mul(0.3)
                    .mul(step(0.0, tca)));
            });
        });

        // ── The rings (one crossing per ray) ────────────────────────────────────
        const ringCol = vec3(0.0).toVar();
        const ringGlow = vec3(0.0).toVar();
        const ringA = float(0.0).toVar();
        If(tR.greaterThan(0.0).and(rr.greaterThan(RINGS.from)).and(rr.lessThan(RINGS.hazeOuter)), () => {
            // Is this point of the plane in the giant's shadow?
            const along = dot(hit, S).negate().toVar();
            const away = sqrt(max(dot(hit, hit).sub(along.mul(along)), 0.0)).toVar();
            const pen = along.mul(0.012).add(0.008);
            const shade = mix(float(1.0), smoothstep(float(1.0).sub(pen), float(1.0).add(pen), away), step(0.0, along)).toVar();
            // The last light through the giant's air, along the shadow's edge.
            const ember = sdBell(away.sub(1.0).div(pen.mul(2.2))).mul(step(0.0, along));
            const cosA = dot(S, V).toVar();
            const theta = atan(hit.z, hit.x).toVar();

            If(rr.lessThan(RINGS.to), () => {
                // A pixel's footprint across the rings, in texels of the profile.
                const foot = u.pixelAngle.mul(tR).div(muV).mul(0.42).div(ringTexel);
                const lod = clamp(log2(max(foot, 1.0)), 0.0, 9.0);
                const prof = ringProfile(rr, lod).toVar();
                const tau = prof.x.toVar();
                const mu0 = max(abs(S.y), 0.04);
                // Light scattered once by a slab of ice, seen from the lit side.
                const refl = float(1.0).sub(exp(tau.mul(float(1.0).div(mu0).add(float(1.0).div(muV))).negate()))
                    .mul(mu0.div(mu0.add(muV)));
                // Ice shines back toward the light; dust throws it on, past the eye.
                const back = pow(clamp(cosA.mul(0.5).add(0.5), 0.0, 1.0), 2.5).mul(0.85).add(0.5);
                const forward = sdPhase(cosA.negate(), float(0.7)).mul(0.55);
                const phase = mix(back, forward.add(0.25), prof.w);
                // Spokes: faint radial smudges that ride round with the giant's field.
                const spoke = u.fbmLod(vec2(theta.div(TAU).mul(5.0).add(u.spin.mul(0.16)), rr.mul(0.7)), 2.0);
                const smudge = smoothstep(0.52, 0.8, spoke.r).mul(smoothstep(1.55, 1.7, rr))
                    .mul(float(1.0).sub(smoothstep(1.86, 1.95, rr))).mul(u.ringGlow.y);
                const grain = u.fbmLod(vec2(theta.div(TAU).mul(24.0).sub(u.time.mul(0.004)), rr.mul(9.0)), 1.0).g;
                const ice = mix(u.ringDust, u.ringIce, prof.y).mul(prof.z.mul(0.66).add(0.48))
                    .mul(grain.mul(0.16).add(0.92)).mul(float(1.0).sub(smudge.mul(0.3)));
                const lit = sunLight.mul(refl).mul(phase).mul(shade).mul(1.55);
                // In the shadow the rings keep the giant's own light and the sky's.
                const dim = u.shine.mul(0.02).add(u.night.mul(0.035)).mul(float(1.0).sub(exp(tau.mul(-2.0))));
                ringCol.assign(ice.mul(lit.add(dim))
                    .add(u.haze.mul(vec3(1.0, 0.42, 0.18)).mul(ember).mul(refl).mul(0.5)));
                ringA.assign(float(1.0).sub(exp(tau.div(muV).negate())));

                // What carries light in the rings is their ice: gaps stay dark under any event.
                const body = float(1.0).sub(exp(tau.mul(-2.6))).toVar();
                // Light that runs through the rings lights them ringlet by ringlet, like the grooves
                // of a record, never as a smooth wash.
                const grooves = prof.z.mul(prof.z).mul(1.3).add(0.25).toVar();
                // How much the passing waves crowd the ice: a crest brightens the rings themselves,
                // the trough behind it thins them.
                const crowd = float(0.0).toVar();

                // Ripples: a lock's density wave, wound into a spiral by the rings' own shear.
                const omega = pow(max(rr, 1.0), -1.5).mul(RING_RATE).toVar();
                Loop({
                    start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'rp',
                }, ({ rp }) => {
                    const A = row(EVENT_ROWS.ripple, rp, 0);
                    const C = row(EVENT_ROWS.ripple, rp, 1);
                    const age = max(u.time.sub(A.z), 0.0).toVar();
                    const born = step(A.z, u.time).mul(A.w).toVar();
                    // Unwind the shear since the lock: inner ice has run ahead, outer ice has fallen behind.
                    const turn = omega.sub(C.w).mul(age).mul(-RIPPLE_SHEAR).toVar();
                    const cs = cos(turn);
                    const sn = sin(turn);
                    const q = vec2(hit.x.mul(cs).sub(hit.z.mul(sn)), hit.x.mul(sn).add(hit.z.mul(cs))).toVar();
                    const d = length(q.sub(A.xy)).toVar();
                    const reach = age.mul(RIPPLE_SPEED);
                    // A density wave: the ice crowds at the front and thins behind it, so the rings
                    // themselves brighten and dim as it passes; only its first crest carries colour.
                    const x = d.sub(reach).div(age.mul(0.025).add(0.018)).toVar();
                    const envelope = exp(x.mul(x).mul(mix(float(-0.3), float(-1.0), step(0.0, x))));
                    const wave = cos(x.mul(2.2)).mul(envelope).mul(exp(age.mul(-0.75))).mul(born)
                        .toVar();
                    crowd.addAssign(wave.mul(0.5));
                    const crest = max(wave, 0.0).mul(grooves).mul(exp(age.mul(-1.5))).mul(0.5);
                    // The impact: a white-hot point, and the ringlet it falls on lit along its orbit
                    // both ways (the unwound frame above carries that light round at its own pace):
                    // an arc that lies along the rings' own grain, never a hoop across it.
                    const r0 = length(A.xy).toVar();
                    const flash = exp(d.mul(d).div(age.mul(0.012).add(0.0005)).negate()).mul(exp(age.mul(-5.0))).mul(4.5);
                    const dr = length(q).sub(r0).div(age.mul(0.003).add(0.0035));
                    const arcLen = atan(A.x.mul(q.y).sub(A.y.mul(q.x)), dot(A.xy, q)).mul(r0);
                    const glint = exp(dr.mul(dr).negate()).mul(exp(abs(arcLen).div(age.mul(0.6).add(0.04)).negate()))
                        .mul(exp(age.mul(-0.9))).mul(smoothstep(0.0, 0.04, age))
                        .mul(3.0);
                    // What the lock leaves in the ice: a stain of its colour, drawn out into an
                    // arc by the shear and fading over a quarter of a minute.
                    const stain = exp(d.mul(d).mul(-170.0)).mul(exp(age.mul(-0.12))).mul(smoothstep(0.0, 0.5, age)).mul(1.1);
                    ringGlow.addAssign(C.rgb.mul(crest.add(stain.mul(grooves).mul(born)))
                        .add(mix(C.rgb, vec3(1.0), 0.6).mul(flash.add(glint).mul(born))));
                });

                // Chimes: a clear's light running out through the whole system, one front per line.
                Loop({
                    start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'ch',
                }, ({ ch }) => {
                    const A = row(EVENT_ROWS.chime, ch, 0);
                    const C = row(EVENT_ROWS.chime, ch, 1);
                    const since = u.time.sub(A.x).sub(rr.sub(RINGS.cInner).div(RINGS.aOuter - RINGS.cInner).mul(CHIME_TRAVEL))
                        .toVar();
                    let fronts = float(0.0);
                    let lead = float(0.0);
                    for (let k = 0; k < 4; k++) {
                        const on = step(k + 0.5, A.z);
                        const at = since.sub(k * CHIME_FRONT_GAP);
                        fronts = fronts.add(sdBell(at.div(0.05)).mul(on));
                        // Its leading edge burns white.
                        lead = lead.add(sdBell(at.add(0.016).div(0.018)).mul(on));
                    }
                    const after = exp(max(since, 0.0).mul(-1.1)).mul(step(0.0, since)).mul(0.3);
                    // A T-spin's chime is a spiral: two arms of light wound through the rings,
                    // winding tighter as they turn.
                    const age = max(u.time.sub(A.x), 0.0).toVar();
                    const arm = fract(theta.div(TAU).mul(A.w).sub(rr.sub(RINGS.cInner).mul(age.mul(1.4).add(2.0)))
                        .add(age.mul(0.5))).toVar();
                    const spiralEnv = exp(age.mul(-0.55)).mul(smoothstep(0.0, 0.2, age));
                    const spiral = sdBell(arm.sub(0.5).div(0.06)).mul(2.4).add(sdBell(arm.sub(0.5).div(0.2)).mul(0.35))
                        .mul(spiralEnv);
                    const spiralEdge = sdBell(arm.sub(0.535).div(0.022)).mul(spiralEnv);
                    const isSpiral = step(0.5, A.w);
                    crowd.addAssign(fronts.mul(0.45).add(spiral.mul(0.2)).mul(A.y));
                    const light = mix(fronts.mul(1.3).add(after), spiral, isSpiral);
                    ringGlow.addAssign(C.rgb.mul(light).mul(grooves).add(vec3(1.0).mul(mix(lead, spiralEdge, isSpiral)).mul(1.2))
                        .mul(A.y));
                });

                // A chain's glow: the rings hum in the chain's colour, brightest in the dense ice.
                // (slow swells running outward: a standing hum, not a wash).
                const swell = sin(rr.mul(34.0).sub(u.ringGlow.z.mul(1.7))).mul(0.5).add(0.5);
                ringGlow.addAssign(u.accent.mul(u.ringGlow.x).mul(prof.z.mul(0.6).add(0.4))
                    .mul(swell.mul(swell).mul(0.55).add(0.1)));
                // A milestone of the chain: two arcs of its light race round the rings, leaving a
                // wake that lights the ringlets as it passes.
                If(u.surge.z.add(u.surgeB.z).greaterThan(0.002), () => {
                    const surged = surgeAt(theta, u.surge).toVar();
                    const surgedB = surgeAt(theta, u.surgeB).toVar();
                    ringGlow.addAssign(u.surgeTint.mul(surged).mul(u.surge.w.mul(0.8).add(1.6))
                        .add(u.surgeTintB.mul(surgedB).mul(u.surgeB.w.mul(0.8).add(1.6)))
                        .mul(grooves));
                    crowd.addAssign(surged.add(surgedB).mul(0.35));
                });
                // The shells a large reward throws off the giant light the rings as they cross them.
                const crossA = rr.sub(shockA.front).div(0.07);
                const crossB = rr.sub(shockB.front).div(0.07);
                const crossingA = exp(crossA.mul(crossA).negate()).mul(shockA.fade).toVar();
                const crossingB = exp(crossB.mul(crossB).negate()).mul(shockB.fade).toVar();
                ringGlow.addAssign(u.shockTint.mul(crossingA).add(u.shockTintB.mul(crossingB)).mul(grooves).mul(1.4));
                crowd.addAssign(crossingA.add(crossingB).mul(0.6));
                // Many lights at once (a storm, a long chain) must not burn the rings white: the
                // sum is rolled off on its brightest channel, so each light keeps its colour.
                ringGlow.mulAssign(body.div(sdMax3(ringGlow).mul(0.42).add(1.0)));
                ringCol.mulAssign(clamp(crowd.add(1.0), 0.4, 2.4));

                // A back-to-back clear sets the outer strand ablaze: two threads braided round
                // each other, with knots of light running along them. (Not held back by the ice:
                // it burns in the strand's own gaps.) Its light is the world's: a second blaze feeds
                // the one still burning, and a streak of them keeps it smouldering.
                const strandAge = u.time.sub(u.strand.x).toVar();
                If(strandAge.greaterThan(0.0).and(u.strand.y.greaterThan(0.003)), () => {
                    const env = u.strand.y;
                    // Never thinner than a pixel and a half across the plane.
                    const w = max(u.pixelAngle.mul(tR).div(muV).mul(0.75), 0.0028);
                    const wob = sin(theta.mul(11.0).add(strandAge.mul(1.6)).add(u.strand.z)).mul(0.0045);
                    const a = rr.sub(RINGS.strand).sub(wob).div(w);
                    const b = rr.sub(RINGS.strand).add(wob).div(w);
                    const braid = exp(a.mul(a).negate()).add(exp(b.mul(b).negate()));
                    const sheathX = rr.sub(RINGS.strand).div(0.022);
                    const sheath = exp(sheathX.mul(sheathX).negate()).mul(0.22);
                    const knotWave = sin(theta.mul(6.0).sub(strandAge.mul(2.6)).add(u.strand.z)).mul(0.5).add(0.5);
                    const k2 = knotWave.mul(knotWave);
                    const knots = k2.mul(k2).mul(k2).mul(2.6).add(0.4);
                    ringGlow.addAssign(u.strandTint.mul(braid.mul(knots).add(sheath)).mul(env).mul(1.6));
                });
            }).Else(() => {
                // The haze of ice beyond the rings: seen only by the light it throws forward.
                const span = smoothstep(RINGS.hazeInner, RINGS.hazePeak, rr)
                    .mul(float(1.0).sub(smoothstep(RINGS.hazePeak, RINGS.hazeOuter, rr)));
                const column = span.mul(RINGS.hazeThickness).div(muV).min(3.0);
                const forward = sdPhase(cosA.negate(), float(0.72)).mul(0.5).add(0.12);
                ringCol.assign(mix(u.ringIce, u.haze, 0.3).mul(sunLight).mul(forward).mul(shade)
                    .mul(0.085));
                ringA.assign(float(1.0).sub(exp(column.mul(-0.5))));
                // (Faint: this haze covers much of the sky, and a lift there veils the whole frame.)
                ringGlow.assign(u.accent.mul(u.ringGlow.x).mul(ringA).mul(0.012));
            });
        });

        // The rings' far side goes in before the giant.
        const far = ringA.mul(float(1.0).sub(front));
        col.assign(mix(col, ringCol, far).add(ringGlow.mul(float(1.0).sub(front))));

        // ── The giant ───────────────────────────────────────────────────────────
        If(cover.greaterThan(0.001), () => {
            const P = normalize(ro.add(rd.mul(tP))).toVar();
            const mu = max(dot(P, V), 0.03).toVar();
            const mu0 = dot(P, S).toVar();
            const sinLat = clamp(P.y, -0.9999, 0.9999).toVar();
            const cosLat = sqrt(float(1.0).sub(sinLat.mul(sinLat))).toVar();
            const lat0 = asin(sinLat).toVar();
            const lonSky = atan(P.z, P.x).toVar();
            const lon0 = lonSky.add(u.spin).toVar();

            // The ovals twist the lookup into spirals.
            const lon = lon0.toVar();
            const lat = lat0.toVar();
            const tint = float(0.0).toVar();
            const pale = float(0.0).toVar();
            const collar = float(0.0).toVar();
            const churn = float(0.0).toVar();
            if (stormCount > 0) {
                Loop({
                    start: int(0), end: int(stormCount), type: 'int', condition: '<', name: 'st',
                }, ({ st }) => {
                    const A = storms.element(st.mul(2));
                    const C = storms.element(st.mul(2).add(1));
                    const dl = fract(lon0.sub(A.x).sub(C.y.mul(u.time)).div(TAU).add(0.5)).mul(TAU).sub(Math.PI);
                    const dx = dl.mul(cosLat).div(A.z).toVar();
                    const dy = lat0.sub(A.y).div(A.w).toVar();
                    const r2 = dx.mul(dx).add(dy.mul(dy)).toVar();
                    If(r2.lessThan(7.0), () => {
                        const fall = exp(r2.mul(-0.85)).toVar();
                        // Hot play winds them tighter.
                        const ang = C.x.mul(fall).mul(u.drive.x).toVar();
                        const cs = cos(ang);
                        const sn = sin(ang);
                        const rx = dx.mul(cs).sub(dy.mul(sn));
                        const ry = dx.mul(sn).add(dy.mul(cs));
                        lon.addAssign(rx.sub(dx).mul(A.z).div(max(cosLat, 0.2)));
                        lat.addAssign(ry.sub(dy).mul(A.w));
                        const heart = exp(r2.mul(-1.5));
                        tint.addAssign(heart.mul(max(C.z, 0.0)));
                        pale.addAssign(heart.mul(max(C.z.negate(), 0.0)));
                        const edge = sqrt(r2).sub(1.3);
                        collar.addAssign(exp(edge.mul(edge).mul(-7.0)).mul(0.6));
                        churn.addAssign(fall);
                    });
                });
            }
            // A T-spin's cyclone: where it was spun the bands are wound into a storm that tightens
            // for a few seconds and then lets go; two arms of light are wound with them. Its
            // strength is the world's: a second spin feeds the storm still turning.
            const cycloneLight = float(0.0).toVar();
            const cyAge = u.time.sub(u.cyclone.z).toVar();
            If(cyAge.greaterThan(0.0).and(u.cyclone.w.greaterThan(0.004)), () => {
                const size = 0.15;
                const dx = wrapPi(lon0.sub(u.cyclone.x)).mul(cosLat).div(size).toVar();
                const dy = lat0.sub(u.cyclone.y).div(size).toVar();
                const r2 = dx.mul(dx).add(dy.mul(dy)).toVar();
                If(r2.lessThan(10.0), () => {
                    const env = u.cyclone.w.toVar();
                    // Tapered to nothing before the edge of the test, or the bands would step there.
                    const fall = exp(r2.mul(-0.55)).mul(float(1.0).sub(smoothstep(5.0, 10.0, r2))).toVar();
                    const ang = u.cycloneTint.w.mul(smoothstep(0.0, 3.0, cyAge).mul(5.5).add(1.0)).mul(env).mul(fall).toVar();
                    const cs = cos(ang);
                    const sn = sin(ang);
                    const rx = dx.mul(cs).sub(dy.mul(sn));
                    const ry = dx.mul(sn).add(dy.mul(cs));
                    lon.addAssign(rx.sub(dx).mul(size).div(max(cosLat, 0.2)));
                    lat.addAssign(ry.sub(dy).mul(size));
                    churn.addAssign(fall.mul(env));
                    // The arms follow the cloud's own spiral: a feature at angle φ is carried to φ − ang.
                    const armPhase = atan(dy, dx).add(ang).mul(2.0).sub(u.cycloneTint.w.mul(cyAge).mul(0.5));
                    const armWave = cos(armPhase).mul(0.5).add(0.5);
                    const arms = armWave.mul(armWave).mul(armWave).mul(armWave);
                    const band = exp(r2.mul(-0.32)).mul(float(1.0).sub(exp(r2.mul(-4.0))));
                    const eye = exp(r2.mul(-26.0));
                    cycloneLight.assign(arms.mul(arms).mul(band).add(eye.mul(0.9)).mul(env));
                    collar.addAssign(exp(r2.mul(-0.3)).mul(env).mul(0.25));
                });
            });

            // A six-sided jet rings the north pole.
            lat.addAssign(cos(lon.mul(6.0)).mul(0.014).mul(smoothstep(1.2, 1.3, lat0))
                .mul(float(1.0).sub(smoothstep(1.38, 1.47, lat0))));

            const latN = lat.div(Math.PI).add(0.5).toVar();
            const meta = texture(u.bandMetaTex, vec2(latN, 0.5)).level(0).toVar();
            const wind = meta.g.mul(2.0).sub(1.0).toVar();
            const shear = clamp(meta.b.add(churn.mul(0.5)), 0.0, 1.2).toVar();

            // The cloud, read along each band's own wind: two reads half a cycle apart.
            const arc = u.pixelAngle.mul(tP).div(sqrt(mu)).toVar();
            const lodOf = (cyclesPerTurn) => clamp(log2(arc.mul((cyclesPerTurn / TAU) * u.fbmSize)), 0.0, 6.0);
            const nA = vec4(0.0).toVar();
            const nB = vec4(0.0).toVar();
            const nC = vec4(0.0).toVar();
            const norm = float(0.0).toVar();
            const reads = tier.cloudDetail >= 1 ? 2 : 1;
            for (let k = 0; k < reads; k++) {
                const ph = reads === 2 ? fract(u.flow.add(k * 0.5)) : float(0.5);
                const w = reads === 2 ? float(1.0).sub(abs(ph.mul(2.0).sub(1.0))) : float(1.0);
                const L = lon.sub(wind.mul(ph.sub(0.5)).mul(FLOW_SPAN)).div(TAU).toVar();
                const a = u.fbmLod(vec2(L.mul(2.0), latN.mul(1.7).add(k * 0.37)), lodOf(2.6)).sub(0.5).toVar();
                const b = u.fbmLod(
                    vec2(L.mul(6.0).add(a.r.mul(0.2)), latN.mul(5.6).add(a.g.mul(0.14)).add(k * 0.61)),
                    lodOf(8.0),
                ).sub(0.5).toVar();
                nA.addAssign(a.mul(w));
                nB.addAssign(b.mul(w));
                if (tier.cloudDetail >= 2) {
                    const c = u.fbmLod(
                        vec2(L.mul(11.0).add(b.r.mul(0.16)), latN.mul(38.0).add(b.g.mul(0.07)).add(k * 0.13)),
                        lodOf(34.0),
                    ).sub(0.5);
                    nC.addAssign(c.mul(w));
                }
                norm.addAssign(w.mul(w));
            }
            // A cross-fade of two fields loses contrast half-way: give it back.
            const gain = float(1.0).div(sqrt(max(norm, 1e-3))).toVar();
            nA.mulAssign(gain);
            nB.mulAssign(gain);
            nC.mulAssign(gain);

            // Bent latitude → the band's colour. Each band takes the next palette at its own moment.
            const bend = nA.r.mul(0.09).add(nB.g.mul(0.06)).mul(shear).add(nC.b.mul(0.026).mul(shear.mul(0.6).add(0.4)));
            const latB = clamp(lat.add(bend).div(Math.PI).add(0.5), 0.003, 0.997).toVar();
            const when = clamp(meta.a.mul(0.6).add(nA.g.mul(0.14)).add(0.03), 0.0, 0.66);
            const stagger = smoothstep(when, when.add(0.34), fract(u.bandPlace));
            const bandV = floor(u.bandPlace).add(0.5).add(stagger).div(u.bandRows)
                .toVar();
            const sharp = texture(u.bandTex, vec2(latB, bandV)).level(0).toVar();
            // Where a band is thinner than a pixel (the limb, the poles) read the blurred table.
            const thin = smoothstep(0.7, 2.2, arc.mul(u.bandSize / Math.PI).mul(float(1.0).div(sqrt(mu))));
            const band = mix(sharp, texture(u.bandFarTex, vec2(latB, bandV)).level(0), thin).toVar();

            const mottle = nB.b.mul(0.7).add(nC.r.mul(0.8)).mul(churn.mul(1.4).add(1.0)).toVar();
            const albedo = band.rgb.mul(float(1.0).add(mottle.mul(band.a.mul(0.6).add(0.5)))).toVar();
            // High white cloud in the zones, torn by the fine field.
            const wisp = smoothstep(0.1, 0.42, nC.g.add(nB.a.mul(0.6))).mul(float(1.0).sub(band.a)).mul(0.22);
            albedo.assign(mix(albedo, band.rgb.mul(1.22).add(0.04), wisp));
            albedo.assign(mix(albedo, u.storm.mul(mottle.mul(0.5).add(0.95)), clamp(tint, 0.0, 1.0).mul(0.82)));
            albedo.assign(mix(albedo, vec3(0.92, 0.9, 0.86), clamp(pale, 0.0, 1.0).mul(0.6)));
            albedo.mulAssign(float(1.0).sub(clamp(collar, 0.0, 1.0).mul(0.3)));

            // The rings' shadow on the cloud tops: the same profile, seen through from below.
            const ringShade = float(1.0).toVar();
            const ts = P.y.negate().div(max(abs(S.y), 0.03).mul(step(0.0, S.y).mul(2.0).sub(1.0))).toVar();
            If(ts.greaterThan(0.0).and(mu0.greaterThan(-0.12)), () => {
                const sh = P.add(S.mul(ts));
                const rs = length(sh.xz).toVar();
                const blur = ts.mul(0.004).add(arc.mul(1.5)).div(ringTexel);
                const prof = ringProfile(rs, clamp(log2(max(blur, 1.0)), 0.0, 9.0));
                const inside = step(RINGS.from, rs).mul(step(rs, RINGS.to));
                ringShade.assign(mix(float(1.0), exp(prof.x.div(max(abs(S.y), 0.05)).negate()), inside));
            });

            // Sunlight: a soft terminator that reddens, a limb that darkens.
            const day = smoothstep(-0.1, 0.2, mu0).toVar();
            const diffuse = pow(max(mu0, 0.0), 0.78).mul(mix(float(1.0), pow(mu, 0.42), 0.72));
            const dusk = mix(vec3(1.0, 0.6, 0.4), vec3(1.0), smoothstep(0.0, 0.3, mu0));
            const light = sunLight.mul(dusk).mul(diffuse.mul(day).mul(1.12)).mul(ringShade.mul(0.94).add(0.06));
            // The night side keeps the sky's light and the rings' (on the hemisphere that sees their lit face).
            const dark = float(1.0).sub(day);
            const ringshine = max(P.y.mul(step(0.0, S.y).mul(2.0).sub(1.0)).add(0.25), 0.0).mul(0.02);
            const nightLight = u.night.mul(0.034).add(u.ringIce.mul(sunLight).mul(ringshine)).mul(dark.mul(0.8).add(0.2));
            const surface = albedo.mul(light.add(nightLight)).toVar();

            // The air: a veil toward the limb on the day side.
            const rim = float(1.0).sub(mu);
            const rim2 = rim.mul(rim);
            surface.assign(mix(surface, u.haze.mul(sunLight).mul(day).mul(0.42), rim2.mul(rim2).mul(0.5)));
            // The night side's own air: a thin glow that keeps its limb apart from the sky.
            surface.addAssign(u.night.mul(rim2.mul(rim2)).mul(dark).mul(0.34));

            // ── What the board has written on the cloud ──
            const emit = vec3(0.0).toVar();
            const glow = vec3(0.0).toVar();
            const under = mottle.mul(0.6).add(0.8).toVar(); // light from below shows the cloud's structure
            // Light inside the cloud shows its relief more strongly still, and breaks a line of it
            // into brighter and fainter pieces where the cloud is thick and thin.
            const relief = clamp(under.mul(under), 0.2, 2.2).toVar();
            const lumps = clamp(nC.r.mul(2.4).add(nB.b.mul(1.4)).add(0.75), 0.15, 1.6).toVar();

            // The cyclone's arms, lit in the colour of the piece that spun it.
            glow.addAssign(u.cycloneTint.xyz.mul(cycloneLight).mul(relief).mul(lumps).mul(0.4));
            // In a fever the great storms burn in their hearts.
            glow.addAssign(u.storm.mul(clamp(tint, 0.0, 1.0)).mul(lumps).mul(u.drive.y));

            // Jets: a cleared row is written round the giant on its own latitude: a hairline of
            // light with a white-hot head, racing from the limb, the line behind it lit through
            // the cloud and cooling from its far end.
            Loop({
                start: int(0), end: int(u.counts.z), type: 'int', condition: '<', name: 'jt',
            }, ({ jt }) => {
                const A = row(EVENT_ROWS.jet, jt, 0);
                const C = row(EVENT_ROWS.jet, jt, 1);
                const age = max(u.time.sub(A.y), 0.0).toVar();
                // It hugs the band's festoons, as the wind that carries it would.
                const dLat = lat0.add(bend.mul(0.45)).sub(A.x).toVar();
                // Nothing of it shows more than a few degrees off its latitude.
                If(abs(dLat).lessThan(0.12), () => {
                    // Never thinner than a pixel and a half on the cloud.
                    const w = max(arc.mul(1.3), 0.0045);
                    const lx = dLat.div(w);
                    const line = exp(lx.mul(lx).negate()).toVar();
                    const halo = exp(dLat.mul(dLat).mul(-1400.0)).toVar();
                    const dl = abs(wrapPi(lonSky.sub(A.w))).toVar();
                    const reach = age.mul(JET_SPEED);
                    const ahead = dl.sub(reach);
                    const hot = exp(ahead.mul(ahead).mul(-180.0)).mul(exp(age.mul(-0.5))).toVar();
                    const trail = exp(max(reach.sub(dl), 0.0).mul(-1.8)).mul(step(dl, reach)).mul(exp(age.mul(-0.45)))
                        .toVar();
                    const fade = step(A.y, u.time).mul(A.z);
                    const core = C.rgb.mul(trail.mul(lumps).mul(1.4)).add(mix(C.rgb, vec3(1.0), 0.75).mul(hot.mul(3.5)));
                    const lit = C.rgb.mul(trail.mul(0.22).add(hot.mul(0.9))).mul(relief);
                    glow.addAssign(core.mul(line).add(lit.mul(halo)).mul(fade));
                });
            });

            // Strikes, as the comet that hit Jupiter in 1994 struck: a blinding fireball, a shock
            // running out through the cloud tops and lighting them, heat cooling to embers, then a
            // dark scar with a crescent of ejecta thrown downrange, sheared by the band's own wind.
            const scar = float(0.0).toVar();
            Loop({
                start: int(0), end: int(u.counts.w), type: 'int', condition: '<', name: 'sk',
            }, ({ sk }) => {
                const A = row(EVENT_ROWS.strike, sk, 0);
                const C = row(EVENT_ROWS.strike, sk, 1);
                const age = max(u.time.sub(A.z), 0.0).toVar();
                const s = A.w.mul(0.03).add(0.035).toVar(); // strikeSize()
                // The scar rides its band's wind (a few times faster than the cloud's, so it shows):
                // each latitude through it drifts its own way, and it shears.
                const drift = wind.mul(age).mul((FLOW_SPAN * 4) / GIANT.flowCycle);
                const dl = wrapPi(lon0.sub(A.x).sub(drift)).mul(cosLat).toVar();
                const dy = lat0.sub(A.y).toVar();
                const d2 = dl.mul(dl).add(dy.mul(dy)).toVar();
                const k = sqrt(d2).div(s).toVar();
                const born = step(A.z, u.time).mul(min(A.w, 1.5)).toVar();
                // Nothing of it reaches past six of its sizes.
                If(k.lessThan(6.0), () => {
                    const s2 = s.mul(s);
                    const fire = exp(d2.div(s2.mul(age.mul(0.6).add(0.04))).negate()).mul(exp(age.mul(-11.0))).mul(7.0);
                    const heat = exp(d2.div(s2.mul(age.mul(0.8).add(0.3))).negate()).mul(exp(age.mul(-1.2))).mul(lumps);
                    const ember = exp(d2.div(s2.mul(0.4)).negate()).mul(exp(age.mul(-0.31))).mul(smoothstep(0.3, 1.0, age))
                        .mul(lumps);
                    // One broad front, seen only in the cloud it lights (its thick parts catch it).
                    const r1 = float(1.0).sub(exp(age.mul(-1.6))).mul(2.6).add(0.5);
                    const x1 = k.sub(r1).div(age.mul(0.4).add(0.35));
                    const shock = exp(x1.mul(x1).negate()).mul(exp(age.mul(-1.7))).mul(smoothstep(0.0, 0.05, age))
                        .mul(relief)
                        .mul(relief);
                    const hotCol = mix(
                        mix(vec3(1.0, 0.92, 0.8), C.rgb, smoothstep(0.1, 0.7, age)),
                        vec3(1.0, 0.45, 0.15),
                        smoothstep(0.7, 2.0, age),
                    );
                    glow.addAssign(vec3(1.0).mul(fire).add(hotCol.mul(heat.mul(2.2)))
                        .add(vec3(1.0, 0.32, 0.08).mul(ember.mul(0.8)))
                        .add(mix(C.rgb, vec3(1.0), 0.35).mul(shock).mul(0.45))
                        .mul(born));
                    // Downrange: the way the meteor was crossing the cloud when it hit.
                    const down = dl.mul(cos(C.w)).add(dy.mul(sin(C.w))).div(max(sqrt(d2), 1e-4));
                    const cx = k.sub(2.2).div(0.75);
                    const crescent = exp(cx.mul(cx).negate()).mul(smoothstep(-0.25, 0.85, down));
                    const heart = exp(k.mul(k).mul(-0.9));
                    scar.addAssign(heart.mul(1.1).add(crescent.mul(0.8)).mul(exp(age.div(-11.0))).mul(smoothstep(0.25, 1.4, age))
                        .mul(born));
                });
            });
            surface.mulAssign(mix(vec3(1.0), vec3(0.2, 0.15, 0.14), clamp(scar, 0.0, 1.0)));

            // Lightning under the cloud: a flash that lights the cloud from below, and in its heart
            // the branching channels themselves (where a fine field crosses its middle).
            Loop({
                start: int(0), end: int(u.bolts), type: 'int', condition: '<', name: 'bl',
            }, ({ bl }) => {
                const A = row(EVENT_ROWS.bolt, bl, 0);
                const C = row(EVENT_ROWS.bolt, bl, 1);
                If(A.w.greaterThan(0.002), () => {
                    const dl = wrapPi(lon0.sub(A.x)).mul(cosLat);
                    const dy = lat0.sub(A.y);
                    const s2 = C.x.mul(C.x).toVar();
                    const d2 = dl.mul(dl).add(dy.mul(dy)).toVar();
                    // Only the cloud round the cell is lit (four of its radii; beyond, nothing shows).
                    If(d2.lessThan(s2.mul(64.0)), () => {
                        const flare = exp(d2.div(s2).negate()).mul(0.7)
                            .add(exp(d2.div(s2.mul(16.0)).negate()).mul(relief).mul(0.18))
                            .toVar();
                        // The channels themselves (Medium and up): one fetch, only near the heart.
                        if (tier.cloudDetail >= 2) {
                            If(d2.lessThan(s2.mul(16.0)), () => {
                                const n = u.fbmLod(vec2(dl, dy).div(C.x).mul(0.07).add(vec2(C.y.mul(7.31), C.y.mul(3.17))), 0.0);
                                const ra = float(1.0).sub(abs(n.r.mul(2.0).sub(1.0)));
                                const rb = float(1.0).sub(abs(n.g.mul(2.0).sub(1.0)));
                                const ra2 = ra.mul(ra);
                                const ra4 = ra2.mul(ra2);
                                const rb2 = rb.mul(rb);
                                const veins = ra4.mul(ra4).mul(ra4).mul(ra2).mul(1.6)
                                    .add(rb2.mul(rb2).mul(rb2).mul(rb2).mul(0.5));
                                flare.addAssign(veins.mul(exp(d2.div(s2.mul(4.0)).negate())));
                            });
                        }
                        emit.addAssign(u.bolt.mul(flare.mul(A.w)).mul(under));
                    });
                });
            });
            // Lightning reads on the night side; by day the sun drowns it. What the board
            // writes is seen on both.
            surface.addAssign(emit.mul(dark.mul(0.8).add(0.2))).addAssign(glow.mul(dark.mul(0.5).add(1.0)).mul(1.5));

            // A chain is felt in the air itself: a breath of the chain's colour in the limb.
            surface.addAssign(u.accent.mul(u.ringGlow.x).mul(rim2).mul(0.05));
            col.assign(mix(col, surface, cover));
        });

        // ── The limb's haze, against the sky ────────────────────────────────────
        If(tc.greaterThan(0.0).and(imp.lessThan(1.0 + GIANT.hazeHeight * 9.0)), () => {
            const T = normalize(ro.add(rd.mul(tc))); // the point the ray passes nearest
            const height = max(imp.sub(1.0), 0.0);
            const air = exp(height.div(u.hazeHeight).negate()).mul(float(1.0).sub(cover));
            const facing = dot(T, S).toVar();
            const sunny = smoothstep(-0.3, 0.2, facing);
            // Looking toward the sun through the air, it blazes: the thin bright arc of a crescent.
            const forward = pow(max(dot(rd, S), 0.0), 5.0).mul(2.6).add(0.3);
            const dusk = mix(vec3(1.0, 0.62, 0.4), vec3(1.0), smoothstep(-0.05, 0.3, facing));
            col.addAssign(u.haze.mul(sunLight).mul(dusk).mul(air.mul(sunny).mul(forward).mul(0.5))
                .add(u.night.mul(air).mul(float(1.0).sub(sunny)).mul(0.22)));
        });

        // ── The plasma corona: hot play sets the giant's air burning along its limb ──
        // Fine streamers of the chain's colour, each its own reach (a ridge of noise across the
        // limb, the same all the way out along each ray from the giant, drifting slowly), white-hot
        // where they leave the cloud, brightest over the night side (the day side's own air
        // already shines there).
        If(u.drive.z.greaterThan(0.003).and(tc.greaterThan(0.0)).and(imp.lessThan(1.45)), () => {
            const T = normalize(ro.add(rd.mul(tc)));
            const h = max(imp.sub(1.0), 0.0).toVar();
            const n = u.noise3(T.mul(6.0).add(vec3(1.7, u.time.mul(0.04), 0.4)));
            const ridge = float(1.0).sub(abs(n.x.mul(2.0).sub(1.0)));
            const streamer = ridge.mul(ridge).mul(ridge).toVar();
            const reach = streamer.mul(0.12).add(n.y.mul(0.03)).add(0.018);
            const air = exp(h.div(reach).negate()).mul(float(1.0).sub(cover));
            const nightward = float(1.0).sub(smoothstep(-0.3, 0.25, dot(T, S)).mul(0.6));
            const hue = mix(u.accent, vec3(1.0), exp(h.mul(-90.0)).mul(0.5));
            col.addAssign(hue.mul(air.mul(streamer.mul(0.9).add(0.25)).mul(nightward).mul(u.drive.z).mul(0.55)));
        });

        // ── The rings' near side ────────────────────────────────────────────────
        col.assign(mix(col, ringCol, ringA.mul(front)).add(ringGlow.mul(front)));

        // ── The flare a large reward throws off the giant ───────────────────────
        // A shell of plasma with a soft Gaussian profile, seen through: brightest where the ray
        // runs along it (just off the limb), with no hard line at either edge, torn into
        // filaments by 3D noise, and its far half hidden by the giant.
        // Two shells may be in flight (a crown inside a four-line clear's): one tear of noise
        // serves both.
        If(shockA.fade.add(shockB.fade).greaterThan(0.002).and(tc.greaterThan(0.0)), () => {
            const shellOf = (K) => {
                const twoRw = K.R.mul(K.W).mul(2.0);
                const inside = sqrt(twoRw.div(max(K.R.mul(K.R).sub(imp2), 0.0).add(twoRw)));
                // Outside the shell its light thins out slowly, so it has no rim to trace.
                const g = imp.sub(K.R).div(K.W.mul(3.0));
                return mix(inside, exp(g.mul(g).negate()), step(K.R, imp));
            };
            const shellA = shellOf(shockA).toVar();
            const shellB = shellOf(shockB).toVar();
            // Over the disc only a breath of it shows: the giant's face must stay readable.
            const open = float(1.0).sub(cover.mul(0.85));
            const shownA = shellA.mul(shockA.fade).mul(open).toVar();
            const shownB = shellB.mul(shockB.fade).mul(open).toVar();
            const shown = shownA.add(shownB).toVar();
            If(shown.greaterThan(0.004), () => {
                const T = normalize(ro.add(rd.mul(tc)));
                const n = u.noise3(T.mul(8.0).add(vec3(u.time.mul(0.6), 0.0, 1.3)));
                const ridge = float(1.0).sub(abs(n.x.mul(2.0).sub(1.0)));
                const r2 = ridge.mul(ridge);
                const filaments = r2.mul(r2).mul(1.8).add(n.y.mul(0.3)).add(0.1);
                const s = max(shellA, shellB);
                const s4 = s.mul(s).mul(s.mul(s));
                const light = u.shockTint.mul(shownA).add(u.shockTintB.mul(shownB));
                col.addAssign(mix(light, vec3(shown), s4.mul(0.4)).mul(filaments));
            });
        });

        return vec4(max(col, vec3(0.0)), 1.0);
    })();

    return sdPart('StellarDriftSpace', geometry, material, -100);
}
