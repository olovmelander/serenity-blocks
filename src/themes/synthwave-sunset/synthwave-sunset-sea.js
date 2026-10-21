/**
 * Synthwave Sunset — the sea and the beach: ONE opaque plane at sea level, shaded per pixel as
 * open water, surf, the swash's thin sheet, or wet sand.
 *
 * Sea. The swell is a sum of directional sine trains with analytic slopes; each train fades out
 * once its phase changes by about a radian per pixel, and the slope variance it carried moves into
 * the roughness of the sun's highlight, so the glitter path is stable at every distance instead of
 * sparkling into noise. The sea mirrors the sky along its reflected ray (`swSky`, the dome's own
 * function: exact, full resolution, no reflection pass) and draws the sun as a Beckmann lobe of
 * the sun's real size: the classic road of light under a setting sun.
 *
 * Surf and swash share the shore's wave period (SHORE.period). Breakers roll in across the surf
 * zone as white water (lit by the dusk sky, never glowing); each one that reaches the waterline
 * runs up the beach as a thin sheet with a foam edge, then drains back, leaving the sand glossy.
 * The whole foreground stays damp and reflective: the tide is going out.
 *
 * What stands in the scene (the wheel, the pier, its lights) is mirrored by a planar reflector()
 * that renders only the mirror layer, at reduced resolution, with alpha, over the mirrored sky:
 * displaced by the waves on the water, smeared into long streaks on the wet sand.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    reflect,
    reflector,
    screenUV,
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SEA_HAZE,
    SHORE,
    rgb,
    swFresnel,
    swHash21,
    swHash22,
    swNoise2,
    swSky,
    swSkyGradient,
    swSunAlign,
} from './synthwave-sunset-tsl.js';

/** Swell trains: heading (deg, 0 = toward the beach, +z), wavelength (m), steepness a·k, phase. */
export const WAVE_TRAINS = Object.freeze([
    [0, 26, 0.07, 0.0],
    [17, 14, 0.085, 1.3],
    [-24, 9.2, 0.095, 2.1],
    [38, 5.6, 0.105, 4.0],
    [-52, 3.4, 0.11, 0.7],
    [9, 2.1, 0.12, 5.2],
    [64, 1.3, 0.12, 3.3],
    [-33, 0.8, 0.12, 1.9],
]);

/** Breaker spacing in the surf zone (m). With SHORE.period it sets their speed (~1.5 m/s). */
const SURF_WAVELENGTH = 12.5;
/** Mean-square slope the eye cannot resolve on calm water (capillary ripples). */
const BASE_ROUGHNESS = 0.0035;

/**
 * The mean waterline (world z) at x: a gently wandering shore that bends seaward round the bay
 * right of the pier. JS twin of `shoreZ`.
 */
export function shoreLineZ(x) {
    const bay = Math.max(x - SHORE.bayX, 0);
    return SHORE.z + 1.5 * Math.sin(x * 0.011 + 0.5) + 0.7 * Math.sin(x * 0.029 + 2.1) - SHORE.bayK * bay * bay;
}

/** The shore's slope dz/dx at x (for the inland normal). */
export function shoreSlope(x) {
    const bay = Math.max(x - SHORE.bayX, 0);
    return 1.5 * 0.011 * Math.cos(x * 0.011 + 0.5) + 0.7 * 0.029 * Math.cos(x * 0.029 + 2.1) - 2 * SHORE.bayK * bay;
}

/** A point `inland` metres inland of the waterline at x, square to the shore. */
export function inlandOf(x, inland, target = { x: 0, z: 0 }) {
    const k = shoreSlope(x);
    const len = Math.hypot(k, 1);
    target.x = x - (k / len) * inland;
    target.z = shoreLineZ(x) + (1 / len) * inland;
    return target;
}

const shoreZ = (x) => {
    const bay = max(x.sub(SHORE.bayX), 0.0);
    return float(SHORE.z).add(sin(x.mul(0.011).add(0.5)).mul(1.5)).add(sin(x.mul(0.029).add(2.1)).mul(0.7))
        .sub(bay.mul(bay).mul(SHORE.bayK));
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {number} [opts.trains=8]   swell trains (tier)
 * @param {number} [opts.clouds=2]   cloud octaves in the reflection
 * @param {boolean} [opts.swash=true] the swash's moving sheet and foam edge
 * @param {number} [opts.mirrorScale=0]  reflector resolution scale (0 = mirrored sky only)
 * @param {boolean} [opts.sandDetail=true] wind ripples, the wrack line and shells on the sand
 */
export function createSea(u, opts = {}) {
    const trains = WAVE_TRAINS.slice(0, Math.max(2, Math.min(WAVE_TRAINS.length, opts.trains ?? 8)));
    const reflectionClouds = opts.clouds ?? 2;
    const withSwash = opts.swash !== false;
    const sandDetail = opts.sandDetail !== false;
    const T = SHORE.period;
    const mirrorScale = opts.mirrorScale ?? 0;
    const reflection = mirrorScale > 0
        ? reflector({ resolutionScale: mirrorScale, bounces: false, generateMipmaps: false })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'SynthwaveSeaReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveSea';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const E = rel.div(dist).negate().toVar(); // toward the eye
        const fwX = max(fwidth(p.x), 1e-4).toVar();
        const fwZ = max(fwidth(p.z), 1e-4).toVar();
        const t = u.time;

        // ── Where we are: metres up the beach from the mean waterline (negative at sea), square
        // to the shore (it bends round the bay) ──
        const bayRun = max(p.x.sub(SHORE.bayX), 0.0);
        const shoreK = bayRun.mul(2 * SHORE.bayK);
        const up = p.z.sub(shoreZ(p.x)).div(sqrt(shoreK.mul(shoreK).add(1.0))).toVar();
        const ds = up.negate().toVar(); // metres out to sea
        // Waves arrive a little obliquely and unevenly along the beach.
        const arrive = swNoise2(vec2(p.x.mul(0.018), 3.1)).mul(0.55).add(p.x.mul(0.0015)).toVar();

        // ── Swell: analytic slope of the sine trains, filtered by the pixel footprint ──
        const warp = swNoise2(vec2(p.x, p.z).mul(0.004)).mul(5.0).toVar();
        const slope = vec2(0.0, 0.0).toVar();
        const unresolved = float(BASE_ROUGHNESS).toVar();
        for (const [headingDeg, lambda, steep, phi] of trains) {
            const h = THREE.MathUtils.degToRad(headingDeg);
            const dx = Math.sin(h);
            const dz = Math.cos(h);
            const k = (2 * Math.PI) / lambda;
            const omega = Math.sqrt(9.81 * k);
            const perPixel = fwX.mul(Math.abs(dx) * k).add(fwZ.mul(Math.abs(dz) * k));
            const keep = float(1.0).sub(smoothstep(0.7, 1.8, perPixel));
            const phase = p.x.mul(dx * k).add(p.z.mul(dz * k)).sub(t.mul(omega)).add(phi)
                .add(warp);
            slope.addAssign(vec2(dx, dz).mul(cos(phase).mul(steep).mul(keep)));
            unresolved.addAssign(float(steep * steep * 0.5).mul(float(1.0).sub(keep)));
        }

        // ── Surf: breakers rolling in across the surf zone ──
        const surfPhase = ds.div(SURF_WAVELENGTH).add(t.div(T)).add(arrive).toVar();
        const w = fract(surfPhase).toVar(); // 0 at a breaker's front, growing seaward
        const waveIndex = floor(surfPhase);
        const inSurf = smoothstep(-0.5, 3.0, ds).mul(float(1.0).sub(smoothstep(SHORE.surfZone - 8, SHORE.surfZone + 6, ds)));
        // Shoaling: the swell steepens toward the beach; its slope faces the shore.
        const swellEnv = smoothstep(0.0, 6.0, ds).mul(float(1.0).sub(smoothstep(24.0, 48.0, ds)))
            .mul(swNoise2(vec2(p.x.mul(0.035), waveIndex.mul(2.3))).mul(0.8).add(0.2));
        slope.addAssign(vec2(0.0, sin(w.mul(Math.PI * 2)).mul(0.07).mul(swellEnv)));
        const breakAt = float(18.0).add(swNoise2(vec2(p.x.mul(0.02), waveIndex.mul(1.7))).mul(12.0));
        const broken = float(1.0).sub(smoothstep(breakAt.sub(3.0), breakAt.add(2.0), ds));
        const fwW = max(fwidth(surfPhase), 1e-4);
        const front = smoothstep(0.0, fwW.mul(1.5), w);
        const trailing = exp(w.mul(-SURF_WAVELENGTH / 4.5)).mul(front);
        const breakup = smoothstep(0.15, 0.62, swNoise2(vec2(p.x.mul(0.07), ds.mul(0.16).add(waveIndex.mul(3.1)))))
            .mul(0.7).add(swNoise2(vec2(p.x.mul(0.31), ds.mul(0.5).add(waveIndex.mul(1.3)))).mul(0.3));
        const surfFoam = trailing.mul(breakup).mul(broken).mul(inSurf)
            .add(exp(w.mul(-SURF_WAVELENGTH / 0.7)).mul(front).mul(broken).mul(inSurf)
                .mul(0.6))
            .toVar();

        // ── Swash: the sheet each breaker runs up the beach, synced to the surf ──
        const psi = fract(t.div(T).add(arrive)).toVar();
        const cycle = floor(t.div(T).add(arrive));
        const reach = max(
            float(SHORE.reach).add(swNoise2(vec2(p.x.mul(0.035), cycle.mul(1.37))).sub(0.5).mul(2 * SHORE.reachSpread)),
            2.0,
        ).toVar();
        const UPRUSH = 0.42;
        const rise = clamp(psi.div(UPRUSH), 0.0, 1.0);
        const uprushFront = reach.mul(float(1.0).sub(float(1.0).sub(rise).mul(float(1.0).sub(rise))));
        const backwash = reach.mul(float(1.0).sub(smoothstep(UPRUSH, 1.0, psi)));
        const edge = select(psi.lessThan(UPRUSH), uprushFront, backwash).toVar();
        const film = float(0.0).toVar();
        const swashFoam = float(0.0).toVar();
        if (withSwash) {
            const fwUp = max(fwidth(up), 1e-4).toVar();
            film.assign(smoothstep(0.0, max(fwUp.mul(1.5), 0.25), edge.sub(up))
                .mul(smoothstep(-0.4, 0.2, up))
                .mul(mix(float(1.0), float(0.55), smoothstep(UPRUSH, 1.0, psi))));
            const running = float(1.0).sub(smoothstep(UPRUSH - 0.08, UPRUSH + 0.14, psi));
            const draining = smoothstep(UPRUSH - 0.04, UPRUSH + 0.06, psi).toVar();
            // The front: foam piled at the leading edge of the sheet, crisp in front and thinning
            // out behind over a width that wanders along the beach.
            const behind = uprushFront.sub(up).toVar();
            const width = mix(float(0.2), float(0.85), swNoise2(vec2(p.x.mul(0.31), cycle.mul(2.7)))).toVar();
            const band = smoothstep(fwUp.mul(-1.2), fwUp.mul(0.4), behind).mul(exp(max(behind, 0.0).div(width).negate()));
            // Lace: holes through the foam in the sheet's own coordinates (they ride up the beach
            // with the front). The fine octave fades by its footprint; far lace keeps its mean.
            const lp = vec2(p.x.mul(1.9), behind.mul(3.1).add(cycle.mul(7.3))).toVar();
            const fwL = max(fwidth(lp.x), fwidth(lp.y)).toVar();
            const fineLace = float(1.0).sub(smoothstep(0.25, 0.8, fwL));
            const coarseLace = float(1.0).sub(smoothstep(0.6, 1.6, fwL)).toVar();
            const laceN = swNoise2(lp).mul(0.62)
                .add(mix(float(0.5), swNoise2(lp.mul(2.6).add(vec2(5.2, 1.3))), fineLace).mul(0.38))
                .toVar();
            const holes = mix(float(0.55), smoothstep(0.4, 0.62, laceN), coarseLace);
            // A front thinner than the pixel is drawn no brighter than the share it covers, so the
            // far swash is a soft seam instead of a bright wire across the frame.
            const cover = clamp(width.div(fwUp.mul(1.5)), 0.0, 1.0);
            swashFoam.assign(band.mul(holes).mul(cover).mul(running).mul(smoothstep(0.0, 0.6, up)));
            // The swash mark: where the sheet stopped, a wavy line of bubbles lingers while it drains.
            const markAt = reach.sub(0.1).add(swNoise2(vec2(p.x.mul(1.3), cycle.mul(3.1))).sub(0.5).mul(0.3));
            const markW = 0.06;
            const mark = exp(abs(up.sub(markAt)).div(max(fwUp.mul(0.6), markW)).negate())
                .mul(clamp(float(markW).div(fwUp.mul(0.6)), 0.0, 1.0))
                .mul(draining).mul(float(1.0).sub(smoothstep(UPRUSH + 0.12, 0.96, psi)))
                .mul(mix(float(0.75), smoothstep(0.2, 0.7, swNoise2(vec2(p.x.mul(1.1), cycle.mul(5.9)))), coarseLace));
            swashFoam.addAssign(mark.mul(0.45));
        }

        // ── Sand: damp everywhere, glossy where the last waves ran, runnels of standing water ──
        const onSand = smoothstep(-0.25, 0.25, up).toVar();
        // Wind ripples on the dry sand above the highest swash: crests along the beach about a
        // hand apart, wandering and forking, asymmetric (a long gentle back, a short steep lee).
        // Each is faded out by its footprint before it can alias.
        const dryUp = SHORE.reach + SHORE.reachSpread + 1.5;
        let ripple = float(0.0);
        if (sandDetail) {
            const ripplePhase = up.mul(8.6)
                .add(swNoise2(vec2(p.x, p.z).mul(0.85)).mul(2.4))
                .add(swNoise2(vec2(p.x, p.z).mul(2.3).add(1.7)).mul(0.7))
                .add(swNoise2(vec2(p.x.mul(0.21), p.z.mul(0.21)).add(4.1)).mul(5.0))
                .toVar();
            const rippleKeep = float(1.0).sub(smoothstep(0.28, 0.75, fwidth(ripplePhase)))
                .mul(smoothstep(dryUp, dryUp + 3.0, up))
                .mul(float(1.0).sub(smoothstep(SHORE.promenade - 2.5, SHORE.promenade - 0.5, up)));
            const rippleArg = ripplePhase.mul(Math.PI * 2);
            // Patchy: the wind combs some stretches into ripples and leaves others smooth.
            const ripplePatch = mix(float(0.25), float(1.0), smoothstep(0.3, 0.72, swNoise2(vec2(p.x.mul(0.13), p.z.mul(0.2)).add(9.4))));
            ripple = sin(rippleArg).add(sin(rippleArg.mul(2.0).add(1.1)).mul(0.38)).mul(0.085)
                .mul(rippleKeep)
                .mul(ripplePatch);
        }
        const sandSlope = vec2(
            cos(p.x.mul(1.3).add(p.z.mul(0.4))).mul(0.012).add(cos(p.x.mul(0.31).sub(p.z.mul(0.9))).mul(0.02)),
            cos(p.z.mul(1.7).sub(p.x.mul(0.5))).mul(0.012).add(cos(p.z.mul(0.27).add(p.x.mul(0.6))).mul(0.02))
                .add(ripple),
        ).toVar();
        const glossy = float(1.0).sub(smoothstep(reach.mul(0.9), reach.add(3.0), up)).toVar();
        const dryness = smoothstep(7.0, 22.0, up).toVar();
        // Grain: damp and drier sand in long streaks along the beach (metres wide, so it never
        // shimmers), finer wind streaks fading out with distance.
        const fine = float(1.0).sub(smoothstep(0.04, 0.16, fwZ));
        const mottle = swNoise2(vec2(p.x.mul(0.16), p.z.mul(0.75))).mul(0.55)
            .add(swNoise2(vec2(p.x.mul(0.9), p.z.mul(3.4)).add(5.3)).mul(0.45).mul(fine).add(float(0.225).mul(float(1.0).sub(fine))))
            .toVar();
        // Runnels: long shallow pools parallel to the waterline, left as the tide goes out.
        const runnel = smoothstep(0.6, 0.68, swNoise2(vec2(p.x.mul(0.05), up.mul(0.42)).add(vec2(2.7, 9.1))))
            .mul(smoothstep(reach.add(1.0), reach.add(3.0), up)).mul(float(1.0).sub(smoothstep(16.0, 21.0, up)))
            .toVar();
        const sandRough = mix(float(0.03), float(0.09), dryness).mul(mix(float(1.0), float(0.45), glossy));
        const sandGloss = mix(float(0.1), float(0.42), glossy).mul(mix(float(1.0), float(0.35), dryness))
            .mul(mix(float(0.55), float(1.45), mottle));

        // ── One surface: sea, sheet, runnel or sand ──
        const pool = max(film, runnel).toVar();
        const water = max(float(1.0).sub(onSand), pool).toVar();
        const sl = mix(sandSlope, slope, float(1.0).sub(onSand)).mul(float(1.0).sub(pool.mul(0.8)));
        const N = normalize(vec3(sl.x.negate(), 1.0, sl.y.negate())).toVar();
        const rough = mix(sandRough, unresolved, float(1.0).sub(onSand)).toVar();
        rough.assign(mix(rough, float(0.0018), pool));
        const gloss = mix(sandGloss, float(1.0), water);

        // Diffuse base: sea body, the sheet over sand, the sand itself (all in dusk light).
        const duskLight = mix(float(1.0), float(0.5), u.dusk);
        // Beyond the promenade the land is the town's dark ground, not sand.
        const town = smoothstep(SHORE.promenade - 1.0, SHORE.promenade + 2.0, up);
        // Relief: the low sun and the bright western sky light the faces that turn toward them
        // (the ripples' backs, the beach's swells); after sunset the light comes from above.
        const relief = float(1.0).add(dot(sandSlope.negate(), u.sunAz).mul(mix(float(2.2), float(0.8), u.dusk)))
            .toVar();
        // The wrack line: the last high tide's seaweed in a wavy band just above the swash, in
        // clumps, with shells scattered along it and, more thinly, over the dry sand.
        let wrack = float(0.0);
        let shell = float(0.0);
        if (sandDetail) {
            const wrackAt = float(dryUp + 0.6).add(swNoise2(vec2(p.x.mul(0.045), 7.7)).sub(0.5).mul(3.0))
                .add(sin(p.x.mul(0.21)).mul(0.5));
            const wrackOff = up.sub(wrackAt).div(0.55);
            const wrackBand = exp(wrackOff.mul(wrackOff).mul(2.2).negate()).toVar();
            const clumps = smoothstep(0.5, 0.78, swNoise2(vec2(p.x.mul(2.6), p.z.mul(3.4))).mul(0.6)
                .add(swNoise2(vec2(p.x.mul(7.9), p.z.mul(8.3)).add(3.3)).mul(0.4)));
            // Far away, where the clumps are under a pixel, the band keeps their mean and softens.
            const clumpsKept = mix(float(0.3), clumps, float(1.0).sub(smoothstep(0.08, 0.3, fwZ.mul(3.4))));
            wrack = wrackBand.mul(clumpsKept).mul(float(1.0).sub(town)).toVar();
            const shellCell = floor(vec2(p.x, p.z).mul(5.0));
            const shellHash = swHash21(shellCell.add(vec2(13.1, 71.7)));
            const shellOdds = mix(float(0.996), float(0.955), smoothstep(0.1, 0.6, wrackBand));
            const shellAt = fract(vec2(p.x, p.z).mul(5.0)).sub(0.5).sub(swHash22(shellCell).sub(0.5).mul(0.5));
            const shellR = length(shellAt.mul(vec2(1.0, 1.35)));
            const fwShell = max(fwZ.mul(5.0), 1e-4);
            shell = float(1.0).sub(smoothstep(0.16, max(fwShell.mul(1.2), 0.03).add(0.16), shellR))
                .mul(step(shellOdds, shellHash)).mul(smoothstep(dryUp - 2.0, dryUp + 0.5, up))
                .mul(float(1.0).sub(town))
                .mul(float(1.0).sub(smoothstep(0.08, 0.3, fwShell)))
                .toVar();
        }
        const sandTone = mix(rgb(0x4a3446), rgb(0x9a7a80), dryness.mul(0.85)).mul(mix(float(0.82), float(1.12), mottle))
            .mul(relief);
        const sandCol = mix(
            mix(mix(sandTone, rgb(0x3a2a2e), wrack.mul(0.6)), rgb(0xe8c8d0), shell.mul(0.7)),
            rgb(0x2a2232),
            town,
        ).mul(duskLight);
        const shallow = float(1.0).sub(smoothstep(2.0, 26.0, ds));
        const seaBody = mix(rgb(0x0a1026), rgb(0x173444), shallow.mul(0.6)).mul(duskLight);
        const base = mix(sandCol, mix(sandCol.mul(0.45), seaBody, float(1.0).sub(onSand)), water).toVar();

        // ── Reflection: the sky along the mirror ray, one lookup per pixel ──
        const V = E.negate();
        const R0 = reflect(V, N);
        const R = normalize(vec3(R0.x, max(R0.y, 0.003), R0.z)).toVar();
        const sky = swSky(u, R, {
            pxRad: float(0.002),
            clouds: reflectionClouds,
            stars: false,
            sunDisc: false,
            cloudMix: mix(float(0.25), float(1.0), water),
        });
        const mirror = sky.color.toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen. On the wet
            // sand the image is smeared down the line of sight into streaks.
            const mirrorReach = float(1.0).div(dist.mul(0.02).add(1.0));
            const sandy = onSand.mul(float(1.0).sub(pool));
            // The shift is held to a few per cent of the screen (the trains' summed slope would tear
            // the image into blocks), and the image is drawn down into short streaks on the
            // water too, as lights on a rippled sea are.
            const wobble = clamp(
                vec2(sl.x.mul(0.55), sl.y.mul(1.15)).mul(mirrorReach).mul(mix(float(0.55), float(0.18), sandy)),
                vec2(-0.03, -0.05),
                vec2(0.03, 0.05),
            );
            const ruv = screenUV.flipX().add(wobble).toVar();
            // Five taps down the line of sight, Gaussian weights: a soft streak, not ghost copies.
            const smear = sandy.mul(rough.mul(0.35).add(0.006)).add(float(1.0).sub(sandy).mul(abs(sl.y).mul(0.035).add(0.003)));
            const held = vec4(reflection.sample(ruv)).mul(0.36)
                .add(vec4(reflection.sample(ruv.add(vec2(0.0, smear)))).mul(0.22))
                .add(vec4(reflection.sample(ruv.sub(vec2(0.0, smear)))).mul(0.22))
                .add(vec4(reflection.sample(ruv.add(vec2(0.0, smear.mul(2.2))))).mul(0.1))
                .add(vec4(reflection.sample(ruv.sub(vec2(0.0, smear.mul(2.2))))).mul(0.1))
                .toVar();
            mirror.assign(mirror.mul(float(1.0).sub(clamp(held.a, 0.0, 1.0))).add(max(held.rgb, vec3(0.0))));
        }
        const F = swFresnel(dot(N, E));
        const col = mix(base, mirror, F.mul(gloss)).toVar();

        // ── The sun on the water: a Beckmann lobe the size of the sun's disc ──
        // Anisotropic: rougher across the line of sight than along it (a stylised wide road of
        // light; at grazing angles a physical lobe is a hairline column).
        const L = u.sunDir;
        const H = normalize(L.add(E));
        const nh = clamp(dot(N, H), 1e-3, 1.0);
        const nh2 = nh.mul(nh);
        const along = normalize(vec3(V.x, 0.0, V.z));
        const across = vec3(along.z.negate(), 0.0, along.x);
        const ha = dot(H, along);
        const hb = dot(H, across);
        const m2 = rough.mul(2.0).add(u.sunTan.mul(u.sunTan).mul(0.5));
        const mb2 = m2.mul(5.0);
        const tan2 = ha.mul(ha).div(m2).add(hb.mul(hb).div(mb2)).div(nh2);
        const D = exp(tan2.negate()).div(sqrt(m2.mul(mb2)).mul(nh2).mul(nh2).mul(Math.PI));
        const ne = clamp(dot(N, E), 0.015, 1.0);
        const sunUp = smoothstep(-0.11, 0.03, L.y);
        const glint = D.mul(swFresnel(dot(H, E))).div(ne.mul(4.0)).mul(0.055).mul(sunUp)
            .mul(gloss);
        const glintCol = mix(rgb(0xffb060), rgb(0xff6a3a), u.dusk);
        col.addAssign(glintCol.mul(clamp(glint, 0.0, 14.0)));

        // ── White water: surf foam and the swash's edge, lit by the dusk sky ──
        const hLen = max(length(vec2(E.x, E.z)), 1e-4);
        const sa = swSunAlign(dot(vec2(E.x, E.z).negate().div(hLen), u.sunAz));
        const foamCol = rgb(0xead0dc, 0.82).add(rgb(0xffa070, 0.3).mul(sa)).mul(duskLight);
        const foam = clamp(surfFoam.add(swashFoam), 0.0, 1.0).mul(0.9);
        col.assign(mix(col, foamCol, foam));

        // ── Distance haze toward the horizon colour of this bearing ──
        const flat = normalize(vec3(V.x, 0.0, V.z));
        const haze = float(1.0).sub(exp(dist.mul(-SEA_HAZE)));
        return mix(col, swSkyGradient(u, flat).color, haze);
    })();

    // z from +70 (behind the camera) to −3600: the far edge sits a hair below the horizon.
    const geometry = new THREE.PlaneGeometry(9000, 3670, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 70 - 3670 / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveSea';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.userData.reflection = reflection;
    return mesh;
}

/** For tests and the world: the waterline and the sea constants. */
export const SEA = Object.freeze({ shoreLineZ, surfWavelength: SURF_WAVELENGTH });
