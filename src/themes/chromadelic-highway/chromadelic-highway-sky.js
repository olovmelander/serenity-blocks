/**
 * Chromadelic Highway — velvet deep-space sky dome, sculptural nebula, cosmic aurora,
 * Milky Way star-powder, and magnitude-hierarchy starfield with blazing binary companion.
 *
 * Sky: ONE opaque BackSide dome drawn after the opaque road (early-Z rejects road pixels).
 *   - Velvety obsidian-indigo cosmos (#03010b -> #0b051d) so every neon arch, crystal bevel,
 *     planet crescent and star gleams with jewel-like contrast.
 *   - Multi-layer astrophysical emission nebula read from our deterministic baked RGBA atlas
 *     (broad billowy clouds, warped ridge ionization filaments, dark absorbing Bok dust rifts
 *     and fine aurora grain) — crisp on every screen with zero blurry JPEG stretch.
 *   - Grand diagonal Milky Way band with an absorbing dust lane and analytic pinpoint star-powder
 *     (gotcha #146) that never blurs or crawls.
 *   - Sector-driven flowing cosmic aurora curtains (branched out when inactive, gotcha #269)
 *     draping gracefully across the open side windows in Aurora Slipstream / Ion Corridor sectors
 *     and flaring on major clears.
 *   - Luminous board-sun core radiance and wispy horizon mist anchored behind the vanishing point;
 *     the card calm-zone engages ONLY while a board is actually on screen (uBoardActive), so
 *     menus, transitions and no-board captures never show a ghost dark rectangle.
 *
 * Stars: instanced camera-facing quads with steep magnitude hierarchy (gotcha #1411), authentic
 * blackbody colors, jewel-like beacon stars with delicate 4-point glints on High+, multi-hue
 * event twinkle waves, and a dazzling gold/sapphire binary pair bridged by a luminous plasma halo.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    pow,
    screenUV,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { pickStellarClass } from '../../rendering/odyssey/chapter-environments/odyssey-stellar-ramp.js';
import { chdHash21, chdNeonColor, chdRoundBoxSdf } from './chromadelic-highway-tsl.js';

const lin = (hex) => new THREE.Color(hex);
const v3 = (c, k = 1) => vec3(c.r * k, c.g * k, c.b * k);
const norm = (r, g, b) => new THREE.Color(r, g, b);

/** Sky palette (scene-linear). Velvet obsidian space floor + vivid jewel nebula stops. */
export const SKY_PALETTE = Object.freeze({
    zenith: lin('#020108'),
    horizon: lin('#070316'),
    nadir: lin('#020107'),
    core: lin('#2e125c'),
    coreWarm: lin('#ff3e92'),
    warm: [norm(0.38, 0.04, 0.94), norm(0.80, 0.06, 1.0), norm(1.0, 0.20, 0.56)],
    warmFilament: norm(1.0, 0.34, 0.80),
    warmFringe: norm(0.05, 0.86, 1.0),
    cool: [norm(0.03, 0.34, 0.94), norm(0.02, 0.64, 1.0), norm(0.18, 0.90, 1.0)],
    coolFilament: norm(0.22, 0.96, 1.0),
    bandGlow: norm(0.56, 0.42, 1.0),
});

const ramp3 = (x, a, b, c) => mix(mix(a, b, smoothstep(0.2, 0.58, x)), c, smoothstep(0.58, 0.94, x));

// The dust head at the branching point of the nebula sits in front of the stars.
// Sky and star vertices share its coordinates. Its textured silhouette extends
// beyond this opaque centre.
const pocketRadiusSq = Fn(([bankX, bankY]) => {
    const dx = bankX.sub(0.32);
    const dy = bankY.sub(0.09).sub(dx.mul(0.48)).add(dx.mul(dx).mul(0.32));
    const p = vec2(dx.div(0.18), dy.div(0.054));
    return dot(p, p);
}).setLayout({
    name: 'chdPocketRadiusSq',
    type: 'float',
    inputs: [
        { name: 'bankX', type: 'float' }, { name: 'bankY', type: 'float' },
    ],
});

/** Rotate a linear colour's hue by `turns` around the grey axis (for palette steps). */
export function rotateHue(color, turns, out = new THREE.Color()) {
    const a = turns * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = (1 - c) / 3;
    const r = Math.sqrt(1 / 3) * s;
    const { r: x, g: y, b: z } = color;
    return out.setRGB(
        Math.max(0, x * (c + k) + y * (k - r) + z * (k + r)),
        Math.max(0, x * (k + r) + y * (c + k) + z * (k - r)),
        Math.max(0, x * (k - r) + y * (k + r) + z * (c + k)),
    );
}

/**
 * @param {object} opts
 * @param {THREE.Texture|null} opts.nebulaMap   baked seamless RGBA cosmic nebula atlas
 * @param {number} [opts.taps=2]                0 (Minimal), 1 (Low) or 2 (Medium+)
 * @param {boolean} [opts.aurora=true]          enable cosmic aurora curtains (Medium+)
 * @param {object} opts.shared                  shared world uniform bag
 */
export function createSkyDome({
    nebulaMap = null, taps = 2, aurora = true, radius = 9000, shared,
} = {}) {
    const uTime = uniform(0);
    const uNebBreath = uniform(0);
    const uVpDir = uniform(new THREE.Vector3(0, 0, -1));
    const uWarmDir = uniform(new THREE.Vector3(-0.566, 0.199, -0.8).normalize());
    const uCoolDir = uniform(new THREE.Vector3(0.615, 0.174, -0.769).normalize());
    const uBandNormal = uniform(new THREE.Vector3(0.458, 0.889, 0).normalize());
    const P = SKY_PALETTE;
    const useTaps = nebulaMap ? Math.max(0, Math.min(2, taps)) : 0;
    const baseStops = [
        ...P.warm, ...P.cool, P.warmFringe, P.bandGlow, P.warmFilament, P.coolFilament,
    ];
    const stops = baseStops.map((c) => uniform(new THREE.Color().copy(c)));
    const [uW0, uW1, uW2, uC0, uC1, uC2, uFringe, uBandGlow, uWFil, uCFil] = stops;
    let appliedShift = 0;

    // The tunnel's air colour + cosmic sector uniforms + event resonance uniforms.
    const uAir = uniform(new THREE.Color(0, 0, 0));
    const uSectorA = uniform(new THREE.Vector4(0.96, 0.85, 0.08, 0.85)); // nebulaGain, dustDepth, aurora, milkyWay
    const uSectorB = uniform(new THREE.Vector4(0.25, 0.52, 0.0, 0.0)); // coreWarmth, auroraHue, skyPulse, nova
    const uSectorC = uniform(new THREE.Vector4(0.9, 0.95, 0.14, 0.56)); // ionBoost, warmAccent.rgb
    const uSkyShift = uniform(new THREE.Vector3(0, 0, 0));
    const uBoardActive = shared?.uBoardActive ?? uniform(0);

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
    });
    material.name = 'chromadelic-sky';
    material.fog = false;

    material.colorNode = Fn(() => {
        const d = normalize(positionLocal).toVar();
        const e = d.y.toVar();
        const tz = max(d.z.negate(), 0.12).toVar();
        const tx = d.x.div(tz).toVar();

        // Deep velvet obsidian space gradient (never muddy grey; subtle sector tint).
        const up = mix(v3(P.horizon), v3(P.zenith), smoothstep(0.0, 0.52, e));
        const dn = mix(v3(P.horizon), v3(P.nadir), smoothstep(0.0, -0.26, e));
        const base = mix(dn, up, step(0.0, e)).add(uSkyShift.mul(smoothstep(0.65, -0.05, e))).max(vec3(0.001, 0.0006, 0.003)).toVar();

        // Card calm zone: ONLY applied when a live board card is present (uBoardActive > 0),
        // completely eliminating the ghost dark rectangle in menus, transitions & icon renders.
        const p = screenUV.mul(shared.uViewportPx);
        const sdf = chdRoundBoxSdf(p, shared.uCardRectPx, shared.uCardRadiusPx);
        const calmRaw = smoothstep(0.0, shared.uViewportPx.y.mul(0.11), sdf);
        const calm = mix(float(1.0), calmRaw, uBoardActive).toVar();

        // Board-sun core radiance behind the vanishing point (peeks warmly around card flanks).
        const c = max(dot(d, uVpDir), 0.0).toVar();
        const coreBroad = pow(c, 52.0).mul(0.17).mul(smoothstep(0.34, -0.04, e));
        const coreTight = pow(c, 180.0).mul(0.45).mul(smoothstep(0.26, -0.06, e));
        const coreCol = mix(v3(P.core), v3(P.coreWarm), clamp(uSectorB.x.mul(0.55), 0.0, 0.7));
        base.addAssign(coreCol.mul(coreBroad.add(coreTight.mul(uSectorB.x.add(0.45)))).mul(mix(float(0.35), float(1.0), calm)));

        // Subtle luminous horizon ribbon + tunnel air scattering around the vanishing point.
        const he = e.sub(0.008).div(0.055);
        const ha = tx.div(0.42);
        const horizon = exp(he.mul(he).negate()).mul(exp(ha.mul(ha).negate())).toVar();
        base.addAssign(vec3(0.032, 0.007, 0.048).mul(horizon));

        const tunnel = pow(c, 28.0).mul(0.025).add(pow(c, 8.0).mul(0.004)).mul(smoothstep(0.52, -0.02, e));
        const me = e.sub(0.014).div(0.08);
        const mistBand = exp(me.mul(me).negate()).mul(exp(ha.mul(ha).mul(-2))).mul(calm).toVar();
        base.addAssign(uAir.mul(tunnel.add(horizon.mul(0.015)).add(mistBand.mul(0.012))));

        if (useTaps === 0) return base;

        // ── Sculptural astrophysical emission nebula & dark dust rifts ──
        const skyPlane = d.xy.div(tz).toVar();
        const warmAnchor = uWarmDir.xy.div(max(uWarmDir.z.negate(), 0.12));
        const flankSign = mix(float(1.0), float(-1.0), step(0.0, uWarmDir.x));
        const bankX = skyPlane.x.sub(warmAnchor.x).mul(flankSign).toVar();
        const bankY = skyPlane.y.sub(warmAnchor.y).toVar();
        const pocket = pocketRadiusSq(bankX, bankY).toVar();
        const drift = vec2(uTime.mul(0.00042), uTime.mul(-0.00026));
        // Read the atlas across the cloud as well as along it. The flank-local coordinates
        // keep the dust lane beside the hero when the composition mirrors the planets.
        const suv = vec2(bankX, bankY.sub(bankX.mul(0.32))).toVar();
        const t1 = texture(nebulaMap, suv.mul(vec2(0.83, 1.05)).add(vec2(0.36, 0.67)).add(drift)).level(0.5).toVar();
        const cloud = t1.r.toVar();
        const fil = t1.g.toVar();
        const dust = t1.b.toVar();
        const wisp = t1.a.toVar();
        const threads = float(0.0).toVar();
        if (useTaps >= 2) {
            const warpUv = suv.mul(vec2(2.85, 4.90)).add(vec2(t1.r, t1.a).sub(0.5).mul(0.40)).sub(drift);
            const t2 = texture(nebulaMap, warpUv).level(0.65).toVar();
            cloud.assign(smoothstep(0.23, 0.76, t1.r.mul(0.70).add(t2.r.mul(0.30))));
            fil.assign(t1.g.mul(0.36).add(t2.g.mul(0.64)));
            dust.assign(smoothstep(0.29, 0.77, t1.b.mul(0.75).add(t2.b.mul(0.25))));
            wisp.assign(t2.a);
            // Intersecting ion fronts have a fine luminous spine. The weaker tributaries
            // use a different atlas channel so that they separate and rejoin.
            const spine = smoothstep(0.69, 0.93, t2.g);
            const fine = abs(t2.a.sub(0.53).add(t1.a.sub(0.5).mul(0.18)));
            const tributary = float(1.0).sub(smoothstep(0.012, 0.070, fine));
            threads.assign(spine.mul(t2.a.mul(0.78).add(0.22)).add(tributary.mul(t2.b).mul(0.52)));
        } else {
            cloud.assign(smoothstep(0.18, 0.78, t1.r));
            dust.assign(smoothstep(0.3, 0.78, t1.b));
        }

        // An inclined molecular cloud forks around a winding pocket of unlit dust. Each rim
        // follows the same displaced spine as its shadow, so the illuminated edge has depth.
        const lift = uSectorB.x.mul(0.10).sub(0.03);
        const crest = bankY.sub(bankX.mul(0.32)).sub(lift)
            .add(t1.r.sub(0.5).mul(0.45)).add(wisp.sub(0.5).mul(0.09))
            .toVar();
        const spread = cloud.mul(0.07).add(0.083).toVar();
        const trunk = crest.div(spread).toVar();
        const fork = crest.add(0.07).add(smoothstep(-0.11, 0.52, bankX).mul(0.22)).div(spread.mul(0.78)).toVar();
        const warm = exp(bankX.mul(bankX).mul(-4.4)).toVar();
        const body = exp(trunk.mul(trunk).mul(-0.70)).add(exp(fork.mul(fork).negate()).mul(0.68)).mul(warm).toVar();
        const lane = trunk.add(0.13).add(dust.sub(0.5).mul(0.76)).toVar();
        const rift = exp(lane.mul(lane).mul(-5.2)).mul(warm).toVar();
        const litRim = lane.sub(0.65).toVar();
        const forkRim = fork.sub(0.48).toVar();
        const rims = exp(litRim.mul(litRim).mul(-7.0)).add(exp(forkRim.mul(forkRim).mul(-5.5)).mul(0.43))
            .mul(warm).toVar();
        const cool = exp(dot(d, uCoolDir).sub(1.0).div(0.035)).mul(0.74).toVar();
        const bn = dot(d, uBandNormal).toVar();
        const band = exp(bn.mul(bn).mul(-34.0)).toVar();
        const below = smoothstep(-0.22, -0.02, e).toVar();

        // Horizon mist textured by fine wisps so it reads as backlit cosmic haze, not a flat bar.
        base.addAssign(uAir.mul(mistBand.mul(cloud.mul(0.6).add(wisp.mul(0.4))).mul(0.018)));

        // Dark absorbing Bok dust carving real high-contrast depth into the nebula & Milky Way.
        const dustAbsorb = clamp(dust.mul(uSectorA.y), 0.0, 0.95).toVar();
        const nebGain = uSectorA.x;
        const ionBoost = uSectorC.x;
        const warmTint = uSectorC.yzw;
        const nW = body.mul(cloud.mul(0.82).add(0.18))
            .mul(float(1.0).sub(rift.mul(0.90))).mul(float(1.0).sub(dustAbsorb.mul(0.71))).toVar();
        const nC = cool.mul(cloud.mul(cloud)).mul(float(1.0).sub(dustAbsorb.mul(0.8))).toVar();
        const nB = band.mul(cloud.mul(0.78).add(0.22)).mul(float(1.0).sub(dustAbsorb.mul(0.84))).toVar();

        // Luminous ionization edges right where emission meets dark dust rifts (blazes in Ion Corridor!).
        const ionEdge = smoothstep(0.40, 0.88, fil).mul(cloud.mul(0.68).add(0.32)).mul(ionBoost);
        const warmCloud = mix(ramp3(nW, uW0, uW1, uW2), warmTint, clamp(uSectorB.x.mul(0.55), 0.0, 0.55));
        const neb = warmCloud.mul(0.52).mul(nW)
            .add(mix(uWFil, warmTint, 0.38).mul(rims).mul(ionEdge.mul(0.50).add(0.06)))
            .add(ramp3(nC, uC0, uC1, uC2).mul(0.17).mul(nC))
            .add(uCFil.mul(ionEdge).mul(nC).mul(0.16))
            .add(uFringe.mul(0.038).mul(nW).mul(float(1.0).sub(cloud)))
            .mul(nebGain)
            .toVar();
        if (useTaps >= 2) {
            const filaments = rims.mul(0.75).add(nW.mul(0.46)).mul(threads);
            const knots = smoothstep(0.53, 0.85, threads).mul(smoothstep(0.38, 0.69, cloud)).mul(rims);
            const veins = mix(uWFil, warmTint, 0.6).mul(filaments).mul(0.43);
            const pearls = vec3(1.0, 0.60, 0.78).mul(knots).mul(0.34);
            neb.addAssign(veins.add(pearls).mul(nebGain).mul(ionBoost));
        }

        // Galactic band & razor-fine dual-octave Milky Way stardust (zero flat polka dots!) —
        // INDEPENDENT of nebGain so Starlight Crossing opens a deep obsidian vault crossed by
        // thousands of crisp pinpoint sparkling dust grains!
        const mwAmount = uSectorA.w;
        const bandTangent = normalize(vec3(uBandNormal.y.negate(), uBandNormal.x, float(0.0)));
        const bandLon = atan(dot(d, bandTangent), max(d.z.negate(), 0.05));
        const mwBand = uBandGlow.mul(0.033).mul(nB).mul(mwAmount);

        // Octave 1: ultra-fine dense cosmic diamond-dust pinpoints (~240 cells/rad, razor-tight core)
        const mwCell1 = vec2(bandLon.mul(240.0), bn.mul(240.0));
        const mwId1 = floor(mwCell1.add(512.0));
        const mwF1 = fract(mwCell1).sub(0.5);
        const h1A = chdHash21(mwId1);
        const h1B = chdHash21(mwId1.add(vec2(19.0, 41.0)));
        const h1C = chdHash21(mwId1.add(vec2(73.0, 11.0)));
        const mwOff1 = mwF1.sub(vec2(h1B, h1C).sub(0.5).mul(0.68));
        const mwSpot1 = exp(dot(mwOff1, mwOff1).mul(-145.0));
        const mwMag1 = pow(h1A, 7.0);
        const mwTwk1 = sin(uTime.mul(h1B.mul(2.4).add(1.1)).add(h1C.mul(36.0))).mul(0.24).add(0.76);
        const mwChance1 = step(float(0.56).sub(nB.mul(0.42)), h1A);
        const mwCol1 = mix(vec3(0.58, 0.80, 1.0), vec3(1.0, 0.74, 0.94), h1C);
        const mwColHot1 = mix(mwCol1, vec3(1.0), mwSpot1.mul(0.58));
        const mwDust1 = mwColHot1.mul(mwSpot1).mul(mwChance1).mul(mwMag1.mul(0.85).add(0.15))
            .mul(mwTwk1);

        // Octave 2: sparse pinpoint jewel sparkles embedded in the galactic cloud
        const mwCell2 = vec2(bandLon.mul(132.0).add(13.7), bn.mul(132.0).sub(9.1));
        const mwId2 = floor(mwCell2.add(512.0));
        const mwF2 = fract(mwCell2).sub(0.5);
        const h2A = chdHash21(mwId2);
        const h2B = chdHash21(mwId2.add(vec2(31.0, 17.0)));
        const h2C = chdHash21(mwId2.add(vec2(53.0, 89.0)));
        const mwOff2 = mwF2.sub(vec2(h2B, h2C).sub(0.5).mul(0.66));
        const mwD2 = dot(mwOff2, mwOff2);
        const mwCore2 = exp(mwD2.mul(-190.0));
        const mwHalo2 = exp(mwD2.mul(-32.0)).mul(0.16);
        const mwTwk2 = pow(sin(uTime.mul(h2B.mul(2.8).add(0.9)).add(h2C.mul(42.0))).mul(0.5).add(0.5), 4.0)
            .mul(0.55).add(0.55);
        const mwChance2 = step(float(0.91).sub(nB.mul(0.18)), h2A);
        const mwCol2 = mix(vec3(0.48, 0.86, 1.0), vec3(1.0, 0.84, 0.62), h2C);
        const mwDust2 = mix(mwCol2, vec3(1.0), mwCore2.mul(0.72)).mul(mwCore2.add(mwHalo2))
            .mul(mwChance2).mul(mwTwk2)
            .mul(1.25);

        const mwMask = nB.mul(0.78).add(band.mul(0.22)).mul(mwAmount);
        const mwPowder = mwDust1.add(mwDust2).mul(mwMask).mul(0.39);
        neb.addAssign(mwBand.add(mwPowder));

        // Dark dust lanes carve true deep obsidian contrast into the base sky gradient.
        const riftShadow = float(1.0).sub(dustAbsorb.mul(band.mul(0.58).add(warm.mul(0.34))).mul(0.58));
        base.mulAssign(riftShadow.mul(float(1.0).sub(rift.mul(0.78))));

        // ── Cosmic Aurora Slipstream (INDEPENDENT of nebGain so Aurora Slipstream truly transforms the sky!) ──
        if (aurora) {
            const aurStrength = uSectorA.z;
            If(aurStrength.greaterThan(0.01), () => {
                // Tall luminous cosmic aurora curtains draped across both left & right corridors!
                const az = atan(d.x, max(d.z.negate(), 0.05));
                const flank = smoothstep(0.12, 0.38, abs(az)).mul(smoothstep(1.18, 0.56, abs(az)));
                const alt = smoothstep(-0.04, 0.10, e).mul(smoothstep(0.72, 0.22, e));
                // Dual-fold flowing aurora curtain (one smooth read stretched vertically — no plaid, #1400).
                const wave1 = sin(az.mul(4.2).add(uTime.mul(0.18))).mul(0.075)
                    .add(cos(az.mul(8.5).sub(uTime.mul(0.12))).mul(0.032));
                const wave2 = sin(az.mul(6.2).sub(uTime.mul(0.14)).add(1.8)).mul(0.055);
                const sheetA = e.sub(0.13).add(wave1);
                const sheetB = e.sub(0.27).add(wave2);
                const hem = exp(sheetA.mul(sheetA).mul(-740.0)).mul(1.05)
                    .add(exp(sheetB.mul(sheetB).mul(-520.0)).mul(0.62));
                const veil = smoothstep(-0.04, 0.02, sheetA).mul(exp(max(sheetA, 0.0).mul(-5.2)))
                    .add(smoothstep(-0.03, 0.02, sheetB).mul(exp(max(sheetB, 0.0).mul(-6.2))).mul(0.55));
                const rayNoise = texture(
                    nebulaMap,
                    vec2(az.mul(1.15).add(uTime.mul(0.009)), e.mul(0.14).sub(uTime.mul(0.006))),
                ).level(1.0);
                const rays = pow(clamp(rayNoise.a.mul(0.78).add(rayNoise.g.mul(0.48)), 0.0, 1.0), 1.6);
                const curtain = hem.mul(rays.mul(0.90).add(0.28)).add(veil.mul(rays).mul(0.56)).mul(flank).mul(alt);
                // Vertical gradient: vivid emerald/aqua foot -> violet/orchid crown (#1404).
                const footCol = chdNeonColor(uSectorB.y, float(0.56));
                const crownCol = chdNeonColor(fract(uSectorB.y.add(0.32)), float(0.48));
                const aurCol = mix(footCol, crownCol, smoothstep(0.0, 0.34, max(sheetA, 0.0)));
                neb.addAssign(aurCol.mul(curtain).mul(aurStrength).mul(0.44));
            });
        }

        // Subtle event breath + cosmic sky pulse (strictly outside card calm zone).
        const skyEnergy = float(1.0).add(uNebBreath).add(uSectorB.z.mul(0.45));
        const finalSky = base.add(neb.mul(calm).mul(below).mul(skyEnergy)).toVar();
        const cloudDepth = pocket.add(wisp.sub(0.5).mul(1.4)).add(cloud.sub(0.5).mul(0.8));
        const transmission = smoothstep(0.56, 1.95, cloudDepth);
        finalSky.assign(mix(vec3(0.0018, 0.0008, 0.0045), finalSky, transmission));

        // Perfect Clear celestial prism fan peeking symmetrically around the board-sun (#1706).
        const nova = uSectorB.w;
        If(nova.greaterThan(0.004), () => {
            const ang = atan(d.y.sub(uVpDir.y), d.x.sub(uVpDir.x));
            const rad = length(d.xy.sub(uVpDir.xy));
            // Whole number of rays around the circle (no seam at ±π, #1405).
            const raysA = cos(ang.mul(12.0).sub(uTime.mul(0.7))).mul(0.5).add(0.5);
            const raysB = cos(ang.mul(24.0).add(uTime.mul(0.45))).mul(0.5).add(0.5);
            const fan = pow(raysA, 4.0).mul(0.85).add(pow(raysB, 5.0).mul(0.4));
            const reach = smoothstep(0.07, 0.22, rad).mul(exp(rad.mul(-2.8)));
            const fanCol = mix(chdNeonColor(fract(ang.div(Math.PI * 2).add(uTime.mul(0.12))), float(0.56)), vec3(1.0, 0.90, 0.56), 0.35);
            finalSky.addAssign(fanCol.mul(fan.mul(0.92).add(0.08)).mul(reach).mul(calm).mul(nova)
                .mul(0.58));
        });

        return finalSky;
    })();

    const geometry = new THREE.SphereGeometry(radius, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;

    return {
        mesh,
        material,
        uniforms: {
            uTime,
            uNebBreath,
            uVpDir,
            uWarmDir,
            uCoolDir,
            uBandNormal,
            uAir,
            uSectorA,
            uSectorB,
            uSectorC,
            uSkyShift,
        },
        /** Turn the nebula palette (the spectrum's movements); a no-op when unchanged. */
        setHueShift(turns) {
            if (Math.abs(turns - appliedShift) < 1e-4) return;
            appliedShift = turns;
            baseStops.forEach((col, i) => rotateHue(col, turns, stops[i].value));
        },
        /** The tunnel's air colour (scene-linear, luma ~0.4). */
        setAir(color) {
            uAir.value.copy(color);
        },
        /** Push blended cosmic sector state + event sky energies (aurora boost, sky pulse, nova). */
        setSector(sec, { auroraBoost = 0, skyPulse = 0, nova = 0 } = {}) {
            uSectorA.value.set(
                sec.nebulaGain,
                sec.dustDepth,
                Math.min(1.9, sec.aurora + auroraBoost),
                sec.milkyWay,
            );
            uSectorB.value.set(sec.coreWarmth, sec.auroraHue, skyPulse, nova);
            const wa = sec.warmAccent || [0.95, 0.14, 0.56];
            uSectorC.value.set(sec.ionBoost ?? 1.0, wa[0], wa[1], wa[2]);
            uSkyShift.value.set(sec.skyShift[0], sec.skyShift[1], sec.skyShift[2]);
        },
        /** Aim the masks from the composition solver's sky output. */
        setDirections(sky) {
            uWarmDir.value.copy(sky.warmDir);
            uCoolDir.value.copy(sky.coolDir);
            uBandNormal.value.copy(sky.bandNormal);
            uVpDir.value.copy(sky.vpDir);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield (steep magnitude hierarchy + dazzling gold/sapphire binary pair)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 4-tier optical jewel hierarchy with multi-shell 3D depth (gotcha #1411):
 *   0: Deep pinpoint diamond dust (distant shell, razor-fine, crisp scintillation)
 *   1: Mid-space colored jewels (hot white core + saturated optical Airy halo)
 *   2: Near-mid radiant stars (closer 3D parallax shell, HDR core + delicate glint)
 *   3: Curated blazing diamond beacons (4-point optical diffraction spikes)
 */
const STAR_TIERS = [
    {
        share: 0.65, value: [0.08, 0.54], size: [1.8, 2.9], depth: [6800, 8200], twinkle: 0.25, wave: 0.6,
    },
    {
        share: 0.27, value: [0.39, 1.28], size: [3.4, 5.4], depth: [4600, 7000], twinkle: 0.20, wave: 0.35,
    },
    {
        share: 0.07, value: [0.96, 1.95], size: [6.2, 9.2], depth: [2800, 5200], twinkle: 0.16, wave: 0.28,
    },
    {
        share: 0.01, value: [1.95, 3.0], size: [11.5, 16.5], depth: [3600, 6200], twinkle: 0.10, wave: 0.42,
    },
];
const NEON_PINK = lin('#ff6ad8');
const NEON_CYAN = lin('#5ceeff');
const JEWEL_GOLD = lin('#ffd06e');
const JEWEL_SAPPHIRE = lin('#5aaeff');
const BINARY_A = lin('#ffc46b');
const BINARY_B = lin('#6ceeff');
const SHELL_RADIUS = 8000;
const TAN_HALF_REST = Math.tan(THREE.MathUtils.degToRad(30));

/**
 * @param {object} opts
 * @param {number} opts.count                 field stars (the binary adds 2 instances)
 * @param {() => number} opts.random          deterministic RNG
 * @param {THREE.Vector3} [opts.bandNormal]
 * @param {boolean} [opts.spikes=true]        diffraction spikes on the binary & beacon stars
 * @param {object} [opts.dustDirection]       shared nebula anchor for stars behind the dust head
 */
export function createStarfield({
    count = 3000, random = Math.random, bandNormal, spikes = true, dustDirection = null,
} = {}) {
    const n = Math.max(1, Math.floor(count));
    const total = n + 2;
    const band = (bandNormal || new THREE.Vector3(0.458, 0.889, 0)).clone().normalize();
    const aA = new Float32Array(total * 4); // dir·R, value
    const aB = new Float32Array(total * 4); // tier, twinkle phase, twinkle freq (rad/s), twinkle amp
    const aC = new Float32Array(total * 4); // rgb, size px
    const dir = new THREE.Vector3();
    const tierCut = STAR_TIERS.reduce((acc, t) => {
        acc.push((acc.length ? acc[acc.length - 1] : 0) + t.share);
        return acc;
    }, []);
    const lerp = (a, b, t) => a + (b - a) * t;

    for (let k = 0; k < n; k++) {
        const i = k + 2; // instances 0 and 1 are the binary pair
        let tierIdx = 0;
        const tr = random();
        while (tierIdx < STAR_TIERS.length - 1 && tr > tierCut[tierIdx]) tierIdx++;
        for (let attempt = 0; attempt < 24; attempt++) {
            const az = (random() * 2 - 1) * THREE.MathUtils.degToRad(66);
            const el = THREE.MathUtils.degToRad(-35 + random() * 78);
            dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
            const tanAz = Math.abs(Math.tan(az));
            const bn = dir.dot(band);
            let w = tanAz < 0.2 ? 0.24 : 1;
            w *= 1 + 1.85 * Math.exp(-36 * bn * bn);
            if (el < THREE.MathUtils.degToRad(-3)) w *= 0.48;
            if (tierIdx >= 3 && tanAz / (2 * TAN_HALF_REST) < 0.26) w = 0;
            if (random() * 2.8 < w) break;
        }
        const t = STAR_TIERS[tierIdx];
        const cls = pickStellarClass(random);
        const col = new THREE.Color(cls.color[0], cls.color[1], cls.color[2]);
        // Enrich spectral jewel saturation so small stars gleam like distinct colored gems in deep space.
        const cLum = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
        col.setRGB(
            Math.max(0, cLum + (col.r - cLum) * 1.65),
            Math.max(0, cLum + (col.g - cLum) * 1.65),
            Math.max(0, cLum + (col.b - cLum) * 1.65),
        );
        const tintRoll = random();
        if (tintRoll < 0.16) col.lerp(NEON_CYAN, 0.52);
        else if (tintRoll < 0.28) col.lerp(NEON_PINK, 0.48);
        else if (tintRoll < 0.38) col.lerp(JEWEL_GOLD, 0.48);
        else if (tintRoll < 0.48) col.lerp(JEWEL_SAPPHIRE, 0.48);

        const uVal = random();
        // Steep power curve inside each tier for realistic astronomical magnitude contrast.
        const val = lerp(t.value[0], t.value[1], uVal * uVal);
        const sizePx = tierIdx === 3 && !spikes ? 4.8 : lerp(t.size[0], t.size[1], Math.sqrt(uVal));
        const shellR = lerp(t.depth[0], t.depth[1], random());
        aA.set([dir.x * shellR, dir.y * shellR, dir.z * shellR, val], i * 4);
        aB.set([tierIdx, random() * Math.PI * 2, (0.45 + random() * 1.75) * Math.PI * 2, t.twinkle], i * 4);
        aC.set([col.r, col.g, col.b, sizePx], i * 4);
    }

    // The binary pair (instances 0 and 1): larger canvas for crisp six-arm spikes + tidal glow.
    aB.set([4, 0, 0, 0], 0);
    aC.set([BINARY_A.r, BINARY_A.g, BINARY_A.b, spikes ? 84 : 36], 0);
    aA.set([0, 0, -SHELL_RADIUS, 2.2], 0);
    aB.set([5, Math.PI, 0, 0], 4);
    aC.set([BINARY_B.r, BINARY_B.g, BINARY_B.b, spikes ? 76 : 34], 4);
    aA.set([0, 0, -SHELL_RADIUS, 2.0], 4);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('aStarA', new THREE.InstancedBufferAttribute(aA, 4));
    geometry.setAttribute('aStarB', new THREE.InstancedBufferAttribute(aB, 4));
    geometry.setAttribute('aStarC', new THREE.InstancedBufferAttribute(aC, 4));
    geometry.instanceCount = total;

    const uTime = uniform(0);
    const uViewportH = uniform(1080);
    const uProjScaleY = uniform(1.73);
    const uBinaryDir = uniform(new THREE.Vector3(0.47, 0.37, -0.8).normalize());
    const uBinaryFlare = uniform(0);
    const uBinaryGold = uniform(0);
    const uStarBoost = uniform(1.0);
    const uWaveOrigin = uniform(new THREE.Vector3(0, 0, -1));
    const uWaveColor = uniform(new THREE.Color().copy(NEON_CYAN));
    const uWaveTime = uniform(-100);
    const uWaveBoost = uniform(0);
    const uWaveTime2 = uniform(-100);
    const uWaveBoost2 = uniform(0);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
    });
    material.name = 'chromadelic-stars';
    material.fog = false;
    material.forceSinglePass = true;

    const tierOf = () => attribute('aStarB', 'vec4').x;
    const worldOf = Fn(() => {
        const a = attribute('aStarA', 'vec4');
        const isBinary = step(3.5, tierOf());
        return mix(a.xyz, uBinaryDir.mul(SHELL_RADIUS), isBinary);
    });

    material.vertexNode = Fn(() => {
        const c = attribute('aStarC', 'vec4');
        const tierIdx = tierOf();
        const vp = cameraViewMatrix.mul(vec4(worldOf(), 1.0)).toVar();
        const dist = vp.z.negate().max(float(0.01));
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        // Binary pair: ±5.5 px mutual orbit (72 s), A and B opposite; grows cleanly during flare.
        const isBinary = step(3.5, tierIdx);
        const sgn = mix(float(1.0), float(-1.0), step(4.5, tierIdx));
        const ang = uTime.mul((Math.PI * 2) / 72);
        const orbit = vec2(cos(ang), sin(ang)).mul(5.5).mul(sgn).mul(isBinary);
        const sizeScale = float(1.0).add(uBinaryFlare.mul(0.45).mul(isBinary));
        let transmission = float(1.0);
        if (dustDirection) {
            const ray = worldOf().sub(cameraPosition);
            const sky = ray.xy.div(max(ray.z.negate(), 1.0));
            const anchor = dustDirection.xy.div(max(dustDirection.z.negate(), 0.12));
            const sign = mix(float(1.0), float(-1.0), step(0.0, dustDirection.x));
            const radiusSq = pocketRadiusSq(sky.x.sub(anchor.x).mul(sign), sky.y.sub(anchor.y));
            transmission = max(isBinary, smoothstep(0.65, 2.25, radiusSq));
        }
        const off = positionLocal.xy.mul(c.w).mul(sizeScale.mul(transmission)).add(orbit).mul(worldPerPx);
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();

    material.colorNode = Fn(() => {
        const a = attribute('aStarA', 'vec4');
        const b = attribute('aStarB', 'vec4');
        const c = attribute('aStarC', 'vec4');
        const tierIdx = b.x;
        const isBinary = step(3.5, tierIdx);
        const isMid = step(0.5, tierIdx).mul(float(1.0).sub(isBinary));
        const isRadiant = step(1.5, tierIdx).mul(float(1.0).sub(isBinary));
        const isBeacon = step(2.5, tierIdx).mul(float(1.0).sub(isBinary));
        const sizePx = c.w.mul(float(1.0).add(uBinaryFlare.mul(0.45).mul(isBinary)));
        const pxv = positionLocal.xy.mul(sizePx);
        const rho = length(pxv);
        const quadFade = smoothstep(sizePx.mul(0.5), sizePx.mul(0.24), rho);

        // Dimensional optical star profile: razor-pinpoint incandescent core transitioning smoothly
        // into a saturated colored Airy halo (never a flat uniform Gaussian disc!).
        const coreSigma = mix(
            mix(float(0.36), float(0.45), isMid),
            mix(float(0.58), float(0.76), isBeacon),
            isRadiant,
        );
        const haloDecay = mix(
            mix(float(0.82), float(1.38), isMid),
            mix(float(1.95), float(2.85), isBeacon),
            isRadiant,
        );
        const haloGain = mix(
            mix(float(0.18), float(0.34), isMid),
            mix(float(0.32), float(0.28), isBeacon),
            isRadiant,
        );
        const coreShape = exp(rho.mul(rho).div(coreSigma.mul(coreSigma).mul(-2.0))).toVar();
        const haloShape = exp(rho.div(haloDecay.negate())).mul(haloGain).mul(quadFade).toVar();

        // Crisp diamond scintillation: smooth cosmic breath + sharp glint sparkle peaks!
        const oscA = sin(uTime.mul(b.z).add(b.y));
        const oscB = sin(uTime.mul(b.z.mul(1.63)).sub(b.y.mul(0.71)));
        const sparkle = pow(oscA.mul(0.5).add(0.5), 6.0).mul(oscB.mul(0.4).add(0.6));
        const twinkle = float(1.0).add(b.w.mul(oscA.mul(0.45).add(sparkle.mul(0.95))));

        const spikeShape = float(0.0).toVar();
        if (spikes) {
            const spkReach = mix(float(1.65), float(3.2), isBeacon);
            const crossX = exp(pxv.y.mul(pxv.y).mul(-3.4)).mul(exp(abs(pxv.x).div(spkReach.negate())));
            const crossY = exp(pxv.x.mul(pxv.x).mul(-3.4)).mul(exp(abs(pxv.y).div(spkReach.negate())));
            // Delicate rotated micro-glint on near-mid radiant stars, crisp full cross on beacons!
            const glintGain = mix(float(0.07), float(0.40), isBeacon)
                .mul(float(0.85).add(sparkle.mul(0.45)));
            spikeShape.assign(crossX.add(crossY).mul(glintGain).mul(quadFade).mul(isRadiant));
        }

        const value = a.w.mul(twinkle).mul(uStarBoost);

        // Multi-hue twinkle wave rolling out from the board-sun.
        const dStar = normalize(worldOf().sub(cameraPosition));
        const lag = length(dStar.sub(uWaveOrigin)).div(1.55);
        const phase = uTime.sub(uWaveTime).sub(lag);
        const phase2 = uTime.sub(uWaveTime2).sub(lag);
        const tierWave = mix(
            mix(float(STAR_TIERS[0].wave), float(STAR_TIERS[1].wave), isMid),
            mix(float(STAR_TIERS[2].wave), float(STAR_TIERS[3].wave), isBeacon),
            isRadiant,
        );
        const pulse = min(
            exp(phase.mul(phase).mul(-26.0)).mul(min(uWaveBoost, 1.15))
                .add(exp(phase2.mul(phase2).mul(-26.0)).mul(min(uWaveBoost2, 1.15))),
            1.4,
        ).mul(tierWave);

        // Chromatic scintillation shift + incandescent white-hot pinpoint core -> vivid jewel halo!
        const scintTint = mix(vec3(0.75, 0.94, 1.0), vec3(1.0, 0.78, 0.96), oscB.mul(0.5).add(0.5));
        const starBase = mix(c.xyz, scintTint, sparkle.mul(0.28).mul(b.w));
        const fieldCol = mix(starBase, uWaveColor, pulse.mul(0.55).min(0.42));
        const coreCol = mix(fieldCol, vec3(1.0), clamp(coreShape.mul(0.78), 0.0, 0.88));
        const field = coreCol.mul(coreShape)
            .add(fieldCol.mul(haloShape))
            .add(mix(fieldCol, vec3(1.0), 0.55).mul(spikeShape))
            .mul(value)
            .mul(float(1.0).add(pulse));

        // Dazzling Binary Star Pair: blazing white-hot pinpoint core + soft chromatic corona +
        // razor-sharp 6-arm optical diffraction starburst (gilded gold on B2B / Perfect Clear).
        const bCore = exp(rho.mul(rho).mul(-0.42));
        const bInner = exp(rho.div(-3.5)).mul(0.24);
        const bHalo = exp(rho.div(-11.0)).mul(0.09).mul(smoothstep(sizePx.mul(0.5), sizePx.mul(0.24), rho));
        const bTint = mix(c.xyz, vec3(1.0, 0.86, 0.48), clamp(uBinaryGold, 0.0, 0.85));
        const binary = mix(bTint, vec3(1.0), bCore.mul(0.65)).mul(bCore.add(bInner)).add(bTint.mul(bHalo)).toVar();
        if (spikes) {
            const reach = float(28.0).add(uBinaryFlare.mul(16.0));
            const arm = (deg, wGain) => {
                const ca = Math.cos(THREE.MathUtils.degToRad(deg));
                const sa = Math.sin(THREE.MathUtils.degToRad(deg));
                const along = abs(pxv.x.mul(ca).add(pxv.y.mul(sa)));
                const across = pxv.x.mul(-sa).add(pxv.y.mul(ca));
                return exp(across.mul(across).mul(-2.2))
                    .mul(exp(along.div(reach.mul(-0.28))))
                    .mul(smoothstep(reach, reach.mul(0.45), along))
                    .mul(wGain);
            };
            const spikeSum = arm(14, 1.0).add(arm(74, 0.85)).add(arm(134, 0.85));
            const spikeCol = mix(vec3(0.94, 0.96, 1.0), vec3(1.0, 0.88, 0.56), clamp(uBinaryGold, 0.0, 0.9));
            binary.addAssign(spikeCol.mul(spikeSum).mul(float(0.26).add(uBinaryFlare.mul(0.32))));
        }
        binary.mulAssign(a.w.mul(float(1.0).add(uBinaryFlare.mul(1.1))));

        const rgb = mix(field, binary, isBinary);
        return vec4(min(rgb, vec3(12.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-stars';
    mesh.frustumCulled = false;
    mesh.renderOrder = -150;

    return {
        mesh,
        material,
        count: n,
        uniforms: {
            uTime,
            uViewportH,
            uProjScaleY,
            uBinaryDir,
            uBinaryFlare,
            uBinaryGold,
            uStarBoost,
            uWaveOrigin,
            uWaveColor,
            uWaveTime,
            uWaveBoost,
            uWaveTime2,
            uWaveBoost2,
        },
        setProjection(viewportHeightPx, projScaleY) {
            if (Number.isFinite(viewportHeightPx) && viewportHeightPx > 0) uViewportH.value = viewportHeightPx;
            if (Number.isFinite(projScaleY) && projScaleY > 0) uProjScaleY.value = projScaleY;
        },
        setDensity(scale) {
            const k = Math.max(0.25, Math.min(1, Number.isFinite(scale) ? scale : 1));
            geometry.instanceCount = 2 + Math.floor(n * k);
        },
        triggerWave(time, origin, boost, color = null) {
            uWaveOrigin.value.copy(origin).normalize();
            if (color) uWaveColor.value.copy(color);
            else uWaveColor.value.copy(NEON_CYAN);
            if (!(boost > 0)) {
                uWaveTime.value = time;
                uWaveBoost.value = 0;
                uWaveTime2.value = time;
                uWaveBoost2.value = 0;
                return;
            }
            const slots = [[uWaveTime, uWaveBoost], [uWaveTime2, uWaveBoost2]];
            for (const [t, b] of slots) {
                if (b.value > 0 && Math.abs(time - t.value) < 0.1) {
                    b.value = Math.min(1.25, Math.max(b.value, boost) + 0.5 * Math.min(b.value, boost));
                    return;
                }
            }
            const gone = (k) => slots[k][1].value <= 0 || time - slots[k][0].value > 1.5;
            let k = slots[0][0].value <= slots[1][0].value ? 0 : 1;
            if (gone(0)) k = 0;
            else if (gone(1)) k = 1;
            slots[k][0].value = time;
            slots[k][1].value = boost;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
