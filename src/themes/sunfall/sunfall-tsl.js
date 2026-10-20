/**
 * Sunfall Theme — TSL Node Shaders & Material Builders (Three.js r186 WebGPU/WebGL2)
 *
 * Implements the Hang Sơn Đoòng doline shader architecture:
 * - `sunlitAtNode`: shared analytical oculus-ellipse + rotating vine-fringe projection
 * - `dlBowNode`: analytic Lee/Airy primary + secondary double rainbow (Cataract only)
 * - `createSunbeamMaterial`: Simpson's-rule closed-form pillar on all tiers + TSL `Loop`
 *   volumetric march on Medium+ with `.level(0)` texture sampling, lengthwise vine-fringe
 *   comb fingers, Sevenfold combo splitting, and board-calm attenuation (`1 - 0.85 * calmMask`).
 * - `createCaveVaultMaterial`: organic karst limestone strata + normal perturbation +
 *   smooth alpha-feathered oculus skylight rim + warm green-gold pool bounce ("Doline, not cave").
 * - `createJungleFoliageMaterial`: instanced tropical foliage with per-shoot delayed greening
 *   (`exp(-age / tau)`) from piece swatch to mature emerald + backlit chartreuse transmission.
 * - `createGourTerraceMaterial`: dry travertine rimstone dams with view-dependent iridescent
 *   blue Peacock Spikemoss (`Selaginella willdenowii`) thin-film interference.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    floor,
    float,
    length,
    max,
    min,
    mix,
    mod,
    negate,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BACKLIT_LEAF_RGB,
    MATURE_LEAF_RGB,
    PIECE_SWATCH_RGB,
    SUNFALL_STATIONS,
} from './sunfall-core.js';

const TWO_PI = Math.PI * 2;

export function createSunfallUniforms() {
    const s1 = SUNFALL_STATIONS[1];
    return {
        time: uniform(0),
        sunDir: uniform(new THREE.Vector3(...s1.sunDir)),
        bowSun: uniform(new THREE.Vector3(-0.10, 0.78, 0.61)),
        fringeAngle: uniform(0),
        cloudHoleOpen: uniform(1.0),
        beamWarmth: uniform(s1.beamWarmth),
        cloudFloor: uniform(s1.cloudFloor),

        skyZenith: uniform(new THREE.Vector3(...s1.skyZenith)),
        skyRim: uniform(new THREE.Vector3(...s1.skyRim)),
        beamCore: uniform(new THREE.Vector3(...s1.beamCore)),
        beamScatter: uniform(new THREE.Vector3(...s1.beamScatter)),
        poolSun: uniform(new THREE.Vector3(...s1.poolSun)),
        bounceVault: uniform(new THREE.Vector3(...s1.bounceVault)),
        caveShadow: uniform(new THREE.Vector3(...s1.caveShadow)),
        mistTint: uniform(new THREE.Vector3(...s1.mistTint)),
        gourBlue: uniform(new THREE.Vector3(...s1.gourBlue)),

        dripScale: uniform(0.75),
        mistScale: uniform(0.95),
        cloudOpacity: uniform(0.65),
        sprayRate: uniform(0.45),

        flushPulse: uniform(0),
        flushColor: uniform(new THREE.Vector3(...PIECE_SWATCH_RGB.T)),
        flushWorldPos: uniform(new THREE.Vector3(18, -14, -94)),

        snapPulse: uniform(0),
        snapU: uniform(0.5),
        snapColor: uniform(new THREE.Vector3(...PIECE_SWATCH_RGB.S)),

        showerPulse: uniform(0),
        ripenPulse: uniform(0),
        ripenRow: uniform(12),
        ripenCodesPacked: uniform(0),

        cataractPulse: uniform(0),
        rainbowStrength: uniform(0),

        comboLift: uniform(0),
        comboColumns: uniform(1),
        sevenfoldPulse: uniform(0),
        exhalePulse: uniform(0),

        floodThreads: uniform(0),
        echoBoost: uniform(0),
        turningPulse: uniform(0),
        zenithPulse: uniform(0),
        overCloudClose: uniform(0),

        calmStrength: uniform(0.85),
    };
}

export const pieceSwatchNode = Fn(([codeIdx]) => {
    const idx = mod(floor(max(float(0), codeIdx)), float(7));
    const cI = vec3(...PIECE_SWATCH_RGB.I);
    const cO = vec3(...PIECE_SWATCH_RGB.O);
    const cT = vec3(...PIECE_SWATCH_RGB.T);
    const cS = vec3(...PIECE_SWATCH_RGB.S);
    const cZ = vec3(...PIECE_SWATCH_RGB.Z);
    const cJ = vec3(...PIECE_SWATCH_RGB.J);
    const cL = vec3(...PIECE_SWATCH_RGB.L);

    let col = cI;
    col = mix(col, cO, smoothstep(float(0.5), float(1.0), idx));
    col = mix(col, cT, smoothstep(float(1.5), float(2.0), idx));
    col = mix(col, cS, smoothstep(float(2.5), float(3.0), idx));
    col = mix(col, cZ, smoothstep(float(3.5), float(4.0), idx));
    col = mix(col, cJ, smoothstep(float(4.5), float(5.0), idx));
    col = mix(col, cL, smoothstep(float(5.5), float(6.0), idx));
    return col;
});

/**
 * Shared analytical oculus projection `sunlitAtNode(worldPos, sunDir, fringeAngle, holeScale)`.
 * Uses `.level(0)` so it is valid inside TSL `Loop` bodies.
 */
export function makeSunlitAtNode(fringeTex) {
    return Fn(([worldPos, sunDir, fringeAngle, holeScale]) => {
        const sy = max(float(0.15), abs(sunDir.y));
        const t = float(56.0).sub(worldPos.y).div(sy);
        const hit = worldPos.xz.add(sunDir.xz.mul(t));

        const q = hit.sub(vec2(24.0, -108.0)).div(vec2(24.0, 18.0));
        const r = length(q).div(max(float(0.25), holeScale));
        const angle = atan(q.y, q.x).add(fringeAngle);
        const fringeUv = vec2(angle.div(float(TWO_PI)).add(float(0.5)), clamp(r.mul(0.5), 0.0, 1.0));
        const fringeSample = texture(fringeTex, fringeUv).level(0).r;

        const open = float(1.0).sub(smoothstep(float(0.76), float(1.10), r));
        const rimMod = mix(float(1.0), fringeSample, smoothstep(float(0.28), float(0.95), r));
        return open.mul(rimMod);
    });
}

/**
 * Pure analytic Lee/Airy primary + secondary double rainbow `dlBowNode(cosTheta)`.
 * Used ONLY on the 4-line Cataract spray sheet.
 */
export const dlBowNode = Fn(([cosTheta]) => {
    const gauss = (mu, invSigma) => {
        const d = cosTheta.sub(float(mu)).mul(float(invSigma));
        return exp(negate(d.mul(d)).mul(0.5));
    };

    const pR = gauss(0.742, 153.8);
    const pG = gauss(0.751, 166.7);
    const pB = gauss(0.760, 153.8);

    const sup1 = gauss(0.769, 263.0).mul(0.28);
    const sup2 = gauss(0.776, 285.0).mul(0.14);

    const sR = gauss(0.636, 105.0).mul(0.36);
    const sG = gauss(0.623, 111.0).mul(0.36);
    const sB = gauss(0.610, 105.0).mul(0.36);

    return vec3(
        pR.add(sup1.mul(0.45)).add(sR),
        pG.add(sup1.mul(0.85)).add(sup2.mul(0.55)).add(sG),
        pB.add(sup1.mul(0.95)).add(sup2.mul(0.90)).add(sB),
    );
});

/**
 * World-space calm factor node that attenuates volumetric light inside the central
 * board lane (`1 - calmStrength * calmMask`).
 */
export const boardCalmFactorNode = Fn(([worldPos, calmStrength]) => {
    const depth = max(float(12.0), float(22.0).sub(worldPos.z));
    // Keep the calm lane centered on the left-center board corridor (`x ~ -5m`)
    // so the Sunfall Pillar at `x = +14..+28m` shines at full volumetric intensity!
    const sightlineX = negate(depth.mul(0.045));
    const relX = worldPos.x.sub(sightlineX).div(depth);
    const relY = worldPos.y.sub(float(6.0)).div(depth);

    const maskX = float(1.0).sub(smoothstep(float(0.07), float(0.14), abs(relX)));
    const maskY = float(1.0).sub(smoothstep(float(0.18), float(0.32), abs(relY)));
    const mask = maskX.mul(maskY);
    return float(1.0).sub(calmStrength.mul(mask));
});

/**
 * 1. Sky & Oculus Glare + Distant Second Doline Sky Backdrop Material
 * Renders a continuous exterior sky gradient with high clouds and warm golden skylight glare
 * behind the oculus and far doline openings (never a floating circle).
 */
export function createSkyOculusMaterial(u, textures) {
    const colorNode = Fn(() => {
        const vUv = uv();

        const cloudUvA = vUv.mul(2.2).add(vec2(u.time.mul(0.005), negate(u.time.mul(0.003))));
        const cloudUvB = vUv.mul(4.1).sub(vec2(u.time.mul(0.004), u.time.mul(0.005)));
        const skyCloud = mix(
            texture(textures.cloudTex, cloudUvA).r,
            texture(textures.cloudTex, cloudUvB).g,
            float(0.45),
        );

        // Vertical gradient from warm golden-amber horizon to luminous cyan-white zenith
        const heightGrad = smoothstep(float(0.0), float(0.85), vUv.y);
        const skyBase = mix(u.skyRim.mul(1.25), u.skyZenith.mul(1.38), heightGrad);
        const withClouds = mix(skyBase, u.beamCore.mul(1.55), skyCloud.mul(0.48));

        // Sun-core bloom near center of each skylight window
        const centered = vUv.sub(vec2(0.5, 0.52)).mul(2.0);
        const sunBlaze = float(1.0).sub(smoothstep(float(0.0), float(0.95), length(centered)));
        const echoGain = float(1.0).add(u.echoBoost.mul(0.45));

        return withClouds.add(u.beamCore.mul(sunBlaze.mul(0.95))).mul(echoGain);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
}

/**
 * 2. Karst Limestone Cave Vault, Walls, Floor & Passage Material ("Doline, not cave")
 * Features shader-driven rock normal perturbation, organic domain-warped strata,
 * smooth alpha-feathered oculus rim, deep foreground crevices (`#15221B` anchor),
 * and warm emerald-gold bounce on the lower vault walls around the jungle garden.
 */
export function createCaveVaultMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);

    const vaultEval = Fn(() => {
        const P = positionWorld;
        const baseN = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(P));

        // Multi-scale karst limestone strata: stretched horizontally for authentic sedimentary bedding planes
        const rockUv1 = vec2(P.x.mul(0.007).add(P.z.mul(0.007)), P.y.mul(0.055));
        const rockUv2 = vec2(P.z.mul(0.011).sub(P.x.mul(0.006)), P.y.mul(0.032).add(P.x.mul(0.004)));
        const rockUv3 = vec2(P.x.mul(0.036).add(P.z.mul(0.028)), P.y.mul(0.085));
        const s1 = texture(textures.rockTex, rockUv1);
        const s2 = texture(textures.rockTex, rockUv2);
        const s3 = texture(textures.rockTex, rockUv3);

        // Horizontal karst bedding ledges + vertical stalactitic solution flutes
        const bedding = sin(P.y.mul(0.55).add(s1.r.mul(3.8))).mul(0.5).add(0.5);
        const strata = mix(mix(s1.r, s2.r, float(0.45)), bedding, float(0.38));
        const grain = mix(s2.g, s3.g, float(0.52));
        const seep = s1.b;
        const cavityAo = smoothstep(float(0.18), float(0.86), mix(s1.a, s3.a, float(0.48)));

        // Strong normal perturbation so the limestone vault reads as chiseled karst rock
        const bumpVec = vec3(
            s3.r.sub(0.5).mul(0.85).add(s2.r.sub(0.5).mul(0.45)),
            s1.r.sub(0.5).mul(0.65).add(bedding.sub(0.5).mul(0.35)),
            s3.g.sub(0.5).mul(0.85).add(s2.g.sub(0.5).mul(0.45)),
        );
        const N = normalize(baseN.add(bumpVec));

        // Smooth organic oculus cutout in the upper-right ceiling (24, 56, -108)
        const qOculus = vec2(
            P.x.sub(24.0).div(24.5),
            P.z.sub(-108.0).div(18.5),
        );
        const rOculus = length(qOculus).add(s2.r.sub(0.5).mul(0.22)).add(s3.g.sub(0.5).mul(0.08));
        const isUpperVault = smoothstep(float(28.0), float(42.0), P.y);
        const oculusCutout = smoothstep(float(0.84), float(1.02), rOculus);
        const alphaOculus = mix(float(1.0), oculusCutout, isUpperVault);

        // Smooth organic second-doline opening at the end of the left passage (-32, 16, -275)
        const qFar = vec2(
            P.x.sub(-32.0).div(21.0),
            P.y.sub(16.0).div(18.0),
        );
        const rFar = length(qFar).add(s1.g.sub(0.5).mul(0.24)).add(s3.r.sub(0.5).mul(0.09));
        const deepMask = smoothstep(float(245.0), float(268.0), negate(P.z));
        const farCutout = smoothstep(float(0.80), float(1.02), rFar);
        const alphaFar = mix(float(1.0), farCutout, deepMask);

        const finalAlpha = min(alphaOculus, alphaFar);

        // Direct oculus sunfall on rim & sunlit shelves
        const directSun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const ndotl = max(float(0.15), dot(N, u.sunDir));

        // Glowing golden-emerald rim around the primary oculus opening
        const oculusRim = float(1.0).sub(smoothstep(float(0.76), float(1.48), rOculus)).mul(isUpperVault);

        // Focused green-gold bounce from the sunlit jungle cone at (16, -18, -94)
        const toPool = P.sub(vec3(16.0, -18.0, -94.0)).div(vec3(42.0, 52.0, 42.0));
        const poolFalloff = pow(float(1.0).sub(smoothstep(float(0.08), float(1.18), length(toPool))), float(1.45));
        const dirToPool = normalize(vec3(16.0, -18.0, -94.0).sub(P));
        const poolFacing = max(float(0.0), dot(N, dirToPool)).mul(0.78).add(0.22);
        const bounceStrength = poolFalloff.mul(poolFacing).mul(float(0.95).add(u.zenithPulse.mul(0.45)));

        // Distant second doline daylight bounce around (-32, 16, -275)
        const toFar = P.sub(vec3(-32.0, 16.0, -275.0)).div(vec3(46.0, 40.0, 74.0));
        const farBounce = pow(float(1.0).sub(smoothstep(float(0.08), float(1.25), length(toFar))), float(1.3))
            .mul(float(0.95).add(u.echoBoost.mul(0.65)));

        // Deep cave roof shadow anchor (#15221B, linear ~ 0.04, 0.08, 0.06) so the sunbeam & jungle pop!
        const camDist = length(P.sub(cameraPosition));
        const nearFraming = smoothstep(float(18.0), float(78.0), camDist).mul(0.62).add(0.38);
        const roofShadowMask = smoothstep(float(-8.0), float(38.0), P.y).mul(float(1.0).sub(oculusRim.mul(0.85)));
        const deepSlate = u.caveShadow.mul(vec3(0.42, 0.48, 0.44));
        const shadowRock = mix(u.caveShadow, deepSlate, roofShadowMask.mul(0.65))
            .mul(float(0.18).add(cavityAo.mul(0.56)).add(strata.mul(0.18)))
            .mul(nearFraming);

        // Warm travertine & emerald-gold radiosity on walls near the sunlit garden
        const warmLimestone = mix(
            u.bounceVault.mul(0.88),
            vec3(0.46, 0.56, 0.34),
            strata.mul(0.58),
        ).mul(float(0.55).add(cavityAo.mul(0.68)));

        const baseRock = mix(
            shadowRock,
            warmLimestone,
            clamp(bounceStrength.mul(0.95).add(strata.mul(0.08)), 0.0, 1.0),
        );

        // Lush hanging moss carpet on upward-facing karst ledges near the jungle cone & oculus lip
        const upwardLedge = smoothstep(float(0.38), float(0.82), N.y);
        const mossReach = max(poolFalloff.mul(0.95), oculusRim.mul(0.85));
        const ledgeMoss = mix(
            vec3(...MATURE_LEAF_RGB).mul(0.72),
            u.poolSun.mul(0.98),
            clamp(directSun.add(oculusRim.mul(0.65)), 0.0, 1.0),
        );
        const withMoss = mix(baseRock, ledgeMoss, upwardLedge.mul(mossReach).mul(0.76));

        // Direct sunlit travertine gold on the oculus rim & sunlit walls
        const rimLight = max(directSun.mul(ndotl), pow(oculusRim, float(1.35)).mul(0.95));
        const sunlitRock = withMoss.add(
            u.beamCore.mul(rimLight.mul(float(0.78).add(grain.mul(0.45)))),
        );

        // Second doline cyan-gold daylight flooding the deep left passage
        const farCol = mix(u.skyZenith, u.skyRim, float(0.40)).mul(1.18);
        const withFarDoline = sunlitRock.add(farCol.mul(farBounce.mul(float(0.58).add(cavityAo.mul(0.42)))));

        // Wet karst specular sheen on damp seepage bands
        const wetness = clamp(seep.mul(0.58).add(u.showerPulse.mul(0.45)).add(u.cataractPulse.mul(0.55)), 0.0, 1.0);
        const H = normalize(V.add(vec3(0.15, 0.82, 0.45)));
        const spec = pow(max(float(0.0), dot(N, H)), float(28.0)).mul(wetness).mul(0.36);
        const withSpec = withFarDoline.add(u.skyRim.mul(spec));

        // Atmospheric mist only deep down the left passage (z < -130) so the main chamber stays crisp & high-contrast
        const deepPassageFog = smoothstep(float(135.0), float(295.0), camDist).mul(0.62);
        const hazeColor = mix(
            u.caveShadow.mul(0.85),
            u.mistTint.mul(0.88),
            clamp(farBounce.add(oculusRim.mul(0.4)), 0.0, 1.0),
        );

        return vec4(mix(withSpec, hazeColor, deepPassageFog), finalAlpha);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode: vaultEval.xyz,
        opacityNode: vaultEval.w,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
    });
}

/**
 * 3. Subterranean Cave-Cloud Deck (`y = 26 m`) & Combo Exhale Ring (`y = 22 m`)
 * Softly feathered well inside the chamber walls so it never leaves a hard line on the rock.
 */
export function createCaveCloudMaterial(u, textures, { isExhaleRing = false } = {}) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);

    const sampleCloud = Fn(() => {
        const P = positionWorld;
        const driftA = vec2(u.time.mul(0.008), negate(u.time.mul(0.005)));
        const driftB = vec2(negate(u.time.mul(0.006)), u.time.mul(0.007));
        const uvA = P.xz.mul(0.015).add(driftA);
        const uvB = P.xz.mul(0.031).add(driftB);

        const cA = texture(textures.cloudTex, uvA);
        const cB = texture(textures.cloudTex, uvB);
        const billow = mix(cA.r, cB.r, float(0.48));

        const sunHole = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const holeMask = float(1.0).sub(
            smoothstep(float(0.22), float(0.78), sunHole)
                .mul(float(1.0).sub(u.overCloudClose.mul(0.85))),
        );

        // Warm gold forward-scattered rim where the sunbeam punches through the cloud deck
        const rimRing = smoothstep(float(0.05), float(0.45), sunHole)
            .mul(float(1.0).sub(smoothstep(float(0.45), float(0.92), sunHole)));

        // Radial envelope stays strictly inside the cavern interior (no wall-clipping line!)
        const radial = length(P.xz.sub(vec2(14.0, -102.0)).div(vec2(34.0, 32.0)));
        const edgeFade = pow(float(1.0).sub(smoothstep(float(0.25), float(0.95), radial)), float(1.6));

        const baseColor = mix(u.caveShadow.mul(1.35), u.mistTint.mul(0.95), billow);
        const litColor = baseColor
            .add(u.beamCore.mul(rimRing.mul(1.65)))
            .add(u.poolSun.mul(rimRing.mul(0.32)));

        const calm = boardCalmFactorNode(P, u.calmStrength.mul(0.55));
        const density = smoothstep(float(0.28), float(0.76), billow)
            .mul(holeMask)
            .mul(edgeFade)
            .mul(calm);

        const alpha = isExhaleRing
            ? density.mul(u.exhalePulse).mul(0.65)
            : density.mul(u.cloudOpacity).mul(u.cloudFloor).mul(0.46);

        return vec4(litColor, clamp(alpha, 0.0, 0.65));
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode: sampleCloud.xyz,
        opacityNode: sampleCloud.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}

/**
 * 4. Sunlit Jungle Breakdown Cone (Terraced Boulder Mound & Instanced Tropical Foliage)
 */
export function createJungleMoundMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);

    const colorNode = Fn(() => {
        const P = positionWorld;
        const baseN = normalize(normalWorld);
        const sun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const s1 = texture(textures.rockTex, P.xz.mul(0.042));
        const s2 = texture(textures.rockTex, vec2(P.x.mul(0.085), P.y.mul(0.095)));

        const N = normalize(baseN.add(vec3(s2.r.sub(0.5).mul(0.6), s1.g.sub(0.5).mul(0.4), s2.b.sub(0.5).mul(0.6))));

        // Deep karst boulder shadow vs rich mossy humus vs sunlit chartreuse moss carpet
        const boulderRock = u.caveShadow.mul(float(0.32).add(s1.a.mul(0.58)));
        const mossMature = vec3(...MATURE_LEAF_RGB).mul(float(0.55).add(s2.g.mul(0.65)));
        const mossSunlit = mix(vec3(...MATURE_LEAF_RGB), u.poolSun, float(0.68)).mul(float(0.75).add(s1.r.mul(0.45)));
        const ndotl = max(float(0.15), dot(N, u.sunDir));

        const dFlush = length(P.xz.sub(u.flushWorldPos.xz));
        const flushRing = float(1.0).sub(smoothstep(float(0.0), float(14.0), dFlush)).mul(u.flushPulse);

        const mossMask = smoothstep(float(0.28), float(0.82), N.y.add(s1.r.sub(0.5).mul(0.35)));
        const base = mix(boulderRock, mossMature, mossMask);
        const lit = mix(base, mossSunlit, clamp(sun.mul(ndotl).mul(mossMask).mul(1.2), 0.0, 1.0));
        const withFlush = mix(lit, u.flushColor.mul(1.15), flushRing.mul(0.65));
        const wetGlow = u.beamCore.mul(u.showerPulse.mul(0.18).add(u.zenithPulse.mul(0.25)).mul(sun));

        return withFlush.add(wetGlow);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode,
    });
}

export function createJungleFoliageMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);
    const aShootMeta = attribute('aShootMeta', 'vec4'); // (codeIdx, birthTime, tau, rowNorm)

    const positionNode = Fn(() => {
        const pos = positionLocal;
        const P = positionWorld;
        const tipWeight = clamp(uv().y, 0.0, 1.0);
        const phase = P.x.mul(0.21).add(P.z.mul(0.17)).add(u.time.mul(1.55));
        const sway = sin(phase).mul(0.28).mul(tipWeight);
        const snapWave = sin(u.time.mul(12.0).sub(P.y.mul(0.35))).mul(u.snapPulse).mul(0.42).mul(tipWeight);
        return pos.add(vec3(sway.add(snapWave), sway.mul(0.22), sway.mul(0.55)));
    })();

    const leafEval = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld);
        const vUv = uv();
        const fol = texture(textures.foliageTex, vUv);

        const veins = fol.r;
        const gloss = fol.g;
        const translucency = fol.b;

        const codeIdx = aShootMeta.x;
        const birthTime = aShootMeta.y;
        const tau = max(float(8.0), aShootMeta.z);
        const rowNorm = aShootMeta.w;

        // Botanical Delayed Greening: young anthocyanin swatch -> mature emerald
        const age = max(float(0.0), u.time.sub(birthTime));
        const youngWeight = clamp(
            exp(negate(age.div(tau))).add(u.zenithPulse.mul(0.85)),
            0.0,
            1.0,
        );
        const swatch = pieceSwatchNode(codeIdx);

        // Deep under-canopy occlusion at frond base (`vUv.y = 0`) & lower skirt (`P.y < -16`)
        const heightAo = smoothstep(float(-22.0), float(-6.0), P.y).mul(0.68).add(0.32);
        const stemShadow = smoothstep(float(0.0), float(0.78), vUv.y).mul(0.74).add(0.26);
        const deepCanopy = vec3(0.03, 0.11, 0.045);
        const mature = mix(
            deepCanopy,
            vec3(...MATURE_LEAF_RGB).mul(float(0.65).add(gloss.mul(0.68))),
            stemShadow.mul(heightAo),
        );
        const laminaBase = mix(mature, swatch.mul(stemShadow.mul(0.75).add(0.30)), youngWeight.mul(0.86));

        // Row-band Ripening wave on 1–3 line clears
        const rowDist = abs(rowNorm.mul(19.0).sub(u.ripenRow));
        const rowHit = float(1.0).sub(smoothstep(float(0.0), float(3.5), rowDist)).mul(u.ripenPulse);

        // Lock Flush wave near landed piece
        const dFlush = length(P.xz.sub(u.flushWorldPos.xz));
        const flushHit = float(1.0).sub(smoothstep(float(0.0), float(12.0), dFlush)).mul(u.flushPulse);

        const withEvents = mix(
            laminaBase,
            mix(swatch, u.flushColor, flushHit),
            clamp(rowHit.mul(0.75).add(flushHit.mul(0.80)), 0.0, 0.90),
        );

        // Direct oculus sunfall + thin-leaf backlit chartreuse transmission
        const sun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const backlit = mix(
            vec3(...BACKLIT_LEAF_RGB),
            u.beamCore,
            float(0.24),
        ).mul(float(0.88).add(veins.mul(0.42))).mul(stemShadow.mul(0.65).add(0.35));
        const transFactor = sun.mul(float(0.28).add(translucency.mul(0.66))).mul(heightAo);
        const sunlitLeaf = mix(withEvents, backlit, clamp(transFactor, 0.0, 0.88));

        const V = normalize(cameraPosition.sub(P));
        const H = normalize(V.add(u.sunDir));
        const spec = pow(max(float(0.0), dot(N, H)), float(20.0))
            .mul(sun.mul(0.32).add(u.showerPulse.mul(0.28)).add(0.04));

        const finalCol = sunlitLeaf.add(u.beamCore.mul(spec));
        return vec4(finalCol, fol.a);
    })();

    return new THREE.MeshBasicNodeMaterial({
        positionNode,
        colorNode: leafEval.xyz,
        opacityNode: leafEval.w,
        alphaTest: 0.22,
        side: THREE.DoubleSide,
    });
}

/**
 * 5. Hanging Aerial Root & Liana Curtains Material
 */
export function createRootCurtainMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);
    const aRootMeta = attribute('aRootMeta', 'vec4'); // (uNorm, codeIdx, tau, phase)

    const positionNode = Fn(() => {
        const pos = positionLocal;
        const hang = float(1.0).sub(clamp(uv().y, 0.0, 1.0));
        const uDist = abs(aRootMeta.x.sub(u.snapU));
        const snapMask = float(1.0).sub(smoothstep(float(0.0), float(0.25), uDist)).mul(u.snapPulse);

        const sway = sin(u.time.mul(1.15).add(aRootMeta.w).add(hang.mul(2.8))).mul(0.42).mul(hang);
        const whip = sin(hang.mul(8.0).sub(u.time.mul(14.0))).mul(snapMask).mul(1.25).mul(hang);
        return pos.add(vec3(sway.add(whip), float(0.0), sway.mul(0.5)));
    })();

    const rootEval = Fn(() => {
        const P = positionWorld;
        const sun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const swatch = pieceSwatchNode(aRootMeta.y);
        const hang = float(1.0).sub(clamp(uv().y, 0.0, 1.0));

        // Dark mossy liana shadow under the rock overhang -> emerald mid-vine -> young piece-colored tip
        const overhangShade = smoothstep(float(0.0), float(0.35), hang);
        const tipFlush = smoothstep(float(0.68), float(0.96), hang);
        const darkBark = vec3(0.04, 0.09, 0.05);
        const mossyVine = mix(darkBark, vec3(...MATURE_LEAF_RGB).mul(0.85), overhangShade.mul(0.75));
        const flushed = mix(mossyVine, swatch.mul(0.92), tipFlush.mul(0.62));

        const uDist = abs(aRootMeta.x.sub(u.snapU));
        const snapGlow = float(1.0).sub(smoothstep(float(0.0), float(0.28), uDist)).mul(u.snapPulse);

        const rimBacklight = mix(vec3(...BACKLIT_LEAF_RGB), u.beamCore, float(0.35))
            .mul(sun.mul(overhangShade).mul(0.55));
        const lit = flushed
            .add(rimBacklight)
            .add(u.snapColor.mul(snapGlow.mul(0.72)))
            .add(u.beamCore.mul(u.turningPulse.mul(sun).mul(0.42)));

        const topFeather = smoothstep(float(0.0), float(0.12), hang);
        const tipAlpha = float(1.0).sub(smoothstep(float(0.82), float(1.0), hang));
        return vec4(lit, topFeather.mul(tipAlpha).mul(0.82));
    })();

    return new THREE.MeshBasicNodeMaterial({
        positionNode,
        colorNode: rootEval.xyz,
        opacityNode: rootEval.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}

/**
 * 6. Dry Foreground Rimstone Gour Terraces + Iridescent Blue Peacock Spikemoss (`Selaginella`)
 */
export function createGourTerraceMaterial(u, textures) {
    const colorNode = Fn(() => {
        const P = positionWorld;
        const baseN = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(P));

        const rockUv1 = vec2(P.x.mul(0.065), P.z.mul(0.065));
        const rockUv2 = vec2(P.x.mul(0.14).add(P.y.mul(0.18)), P.z.mul(0.14));
        const s1 = texture(textures.rockTex, rockUv1);
        const s2 = texture(textures.rockTex, rockUv2);

        const N = normalize(baseN.add(vec3(s2.r.sub(0.5).mul(0.75), s2.g.sub(0.5).mul(0.52), s2.b.sub(0.5).mul(0.75))));

        // Warm dry travertine dam crest vs deep damp-slate basin interior
        const dryCalcite = vec3(0.56, 0.52, 0.42).mul(float(0.48).add(s1.r.mul(0.52)));
        const dampSlate = u.caveShadow.mul(float(0.18).add(s1.a.mul(0.42)));

        // Rimstone lip follows the upper ridge of the scalloped dam wall
        const rimLip = smoothstep(float(0.22), float(0.68), N.y)
            .mul(float(1.0).sub(smoothstep(float(0.82), float(0.98), N.y)));
        const baseTerrace = mix(dampSlate, dryCalcite, rimLip.mul(0.78).add(s1.r.mul(0.18)));

        // Thin-film interference of Selaginella willdenowii in foreground shade:
        // grazing view angle shifts from velvety forest-emerald to electric peacock blue (#4781F6)!
        const ndotv = abs(dot(N, V));
        const fresnel = pow(float(1.0).sub(ndotv), float(1.65));
        const mossCluster = smoothstep(float(0.28), float(0.74), mix(s1.b, s2.g, float(0.48)));
        const iridescence = mix(
            vec3(0.02, 0.18, 0.13),
            u.gourBlue.mul(1.28),
            clamp(fresnel.mul(1.38), 0.0, 1.0),
        );

        const withPeacockMoss = mix(baseTerrace, iridescence, mossCluster.mul(0.82));
        const bounceRim = u.bounceVault.mul(max(float(0.0), dot(N, vec3(0.2, 0.8, -0.5))).mul(0.28));

        return withPeacockMoss.add(bounceRim);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode,
    });
}

/**
 * 7. The Sunfall Volumetric Pillar Material ("Pillar, not rays")
 */
export function createSunbeamMaterial(u, textures, preset = {}) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);
    const sampleCount = Math.max(0, Math.floor(preset.beamSamples ?? 8));

    const beamEval = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(P));
        const vUv = uv();

        const edgeCos = abs(dot(N, V));
        const cylinderThickness = pow(edgeCos, float(1.15));

        const verticalEnv = smoothstep(float(0.0), float(0.12), vUv.y)
            .mul(float(1.0).sub(smoothstep(float(0.88), float(1.0), vUv.y).mul(0.18)));

        const rayStep = V.negate().mul(7.0);
        const p0 = P.sub(rayStep);
        const p1 = P;
        const p2 = P.add(rayStep);

        const s0 = sunlitAt(p0, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const s1 = sunlitAt(p1, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const s2 = sunlitAt(p2, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const simpson = s0.add(s1.mul(4.0)).add(s2).div(float(6.0));

        // Lengthwise vine-fringe comb streaks running all the way down the shaft
        const streakAngle = vUv.x.mul(float(TWO_PI)).add(u.fringeAngle);
        const streakUv = vec2(
            streakAngle.div(float(TWO_PI)),
            vUv.y.mul(0.22).sub(u.time.mul(0.010)),
        );
        const fringeComb = texture(textures.fringeTex, streakUv).level(0).r;

        const marchAccum = float(0.0).toVar();
        if (sampleCount > 0) {
            const invN = 1.0 / sampleCount;
            Loop(sampleCount, ({ i }) => {
                const frac = float(i).add(0.5).mul(float(invN)).sub(0.5);
                const samplePos = P.add(V.negate().mul(frac.mul(18.0)));
                const sunTap = sunlitAt(samplePos, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
                const cUv = samplePos.xz.mul(0.016).add(vec2(u.time.mul(0.009), samplePos.y.mul(0.008)));
                const mistTap = texture(textures.cloudTex, cUv).level(0).r;
                marchAccum.addAssign(sunTap.mul(float(0.62).add(mistTap.mul(0.58))).mul(float(invN)));
            });
        }

        const volumeDensity = sampleCount > 0
            ? mix(simpson, marchAccum, float(0.55))
            : simpson;

        const comboWave = float(0.5).add(
            float(0.5).mul(sin(vUv.x.mul(u.comboColumns).mul(float(TWO_PI)).add(u.fringeAngle.mul(2.0)))),
        );
        const comboFacet = mix(
            float(1.0),
            smoothstep(float(0.16), float(0.86), comboWave),
            clamp(u.comboLift.mul(0.68), 0.0, 0.75),
        );

        const sevenfoldIdx = mod(floor(vUv.x.mul(7.0)), float(7.0));
        const sevenfoldTint = pieceSwatchNode(sevenfoldIdx);

        // Extra warm gold forward-scattering boost where the shaft punches through the cloud layer (`P.y ~ 26m`)
        const cloudPunchBoost = float(1.0).sub(smoothstep(float(0.0), float(14.0), abs(P.y.sub(26.0)))).mul(0.32);

        const heightMix = clamp(float(1.0).sub(vUv.y), 0.0, 1.0);
        const shaftGrad = mix(
            u.beamScatter.add(u.poolSun.mul(0.38)),
            u.beamCore.mul(1.42),
            smoothstep(float(0.10), float(0.82), vUv.y),
        ).add(u.beamCore.mul(cloudPunchBoost));
        const tintedShaft = mix(shaftGrad, sevenfoldTint.mul(1.35), u.sevenfoldPulse.mul(0.55).mul(heightMix));

        const calm = boardCalmFactorNode(P, u.calmStrength);

        const streakMod = mix(float(0.48), float(1.42), fringeComb);
        const totalIntensity = volumeDensity
            .mul(streakMod)
            .mul(comboFacet)
            .mul(cylinderThickness)
            .mul(verticalEnv)
            .mul(calm)
            .mul(float(1.0).sub(u.overCloudClose.mul(0.78)));

        const alpha = clamp(totalIntensity.mul(0.30), 0.0, 0.48);
        return vec4(tintedShaft.mul(totalIntensity.mul(0.92)), alpha);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode: beamEval.xyz,
        opacityNode: beamEval.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
}

/**
 * 8. Cataract Spray Sheet & Analytic Double Rainbow + B2B Oculus Waterfall Threads
 */
export function createCataractSprayMaterial(u, textures) {
    const sprayEval = Fn(() => {
        const P = positionWorld;
        const vUv = uv();
        const viewRay = normalize(P.sub(cameraPosition));

        const sUv = vec2(vUv.x.mul(2.2), vUv.y.mul(1.8).sub(u.time.mul(0.18)));
        const mistNoise = texture(textures.cloudTex, sUv).r;
        const radialMask = sin(clamp(vUv.x, 0.0, 1.0).mul(Math.PI))
            .mul(sin(clamp(vUv.y, 0.0, 1.0).mul(Math.PI)));

        const cosTheta = dot(viewRay, negate(u.bowSun));
        const bowRgb = dlBowNode(cosTheta).mul(u.rainbowStrength).mul(1.75);

        const baseSpray = mix(u.mistTint, u.beamCore, float(0.62))
            .mul(float(0.45).add(mistNoise.mul(0.65)));
        const sprayColor = baseSpray.add(bowRgb);

        const calm = boardCalmFactorNode(P, u.calmStrength.mul(0.65));
        const activeSpray = clamp(
            u.sprayRate.mul(0.16)
                .add(u.showerPulse.mul(0.38))
                .add(u.cataractPulse.mul(0.65))
                .add(u.rainbowStrength.mul(0.60)),
            0.0,
            1.0,
        );
        const alpha = clamp(
            radialMask.mul(mistNoise.mul(0.65).add(0.35)).mul(activeSpray).mul(calm).mul(0.58),
            0.0,
            0.78,
        );

        return vec4(sprayColor, alpha);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode: sprayEval.xyz,
        opacityNode: sprayEval.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
}

export function createWaterfallThreadMaterial(u, textures) {
    const threadEval = Fn(() => {
        const vUv = uv();
        const aThreadIdx = attribute('aThreadIdx', 'float');

        const scrollUv = vec2(vUv.x.mul(0.5).add(aThreadIdx.mul(0.17)), vUv.y.mul(2.2).add(u.time.mul(1.45)));
        const mistBreakup = texture(textures.cloudTex, scrollUv).r;
        const edge = pow(sin(clamp(vUv.x, 0.0, 1.0).mul(Math.PI)), float(3.2));
        const vFade = pow(sin(clamp(vUv.y, 0.0, 1.0).mul(Math.PI)), float(2.4));

        const b2bActive = smoothstep(aThreadIdx.mul(0.33), aThreadIdx.mul(0.33).add(0.28), u.floodThreads);
        const showerBoost = u.showerPulse.mul(0.55).add(u.cataractPulse.mul(0.65)).add(u.dripScale.mul(0.04));
        const showerActive = max(b2bActive, showerBoost);

        const col = mix(u.mistTint, u.beamCore, float(0.68)).mul(1.15);
        const breakupGain = mistBreakup.mul(0.75).add(0.25);
        const alpha = clamp(edge.mul(vFade).mul(breakupGain).mul(showerActive).mul(0.38), 0.0, 0.55);
        return vec4(col, alpha);
    })();

    return new THREE.MeshBasicNodeMaterial({
        colorNode: threadEval.xyz,
        opacityNode: threadEval.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
}

/**
 * 9. Sunlit Spore Motes & Oculus Drip Beads Material
 */
export function createMotesMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);
    const aMoteSeed = attribute('aMoteSeed', 'vec4'); // (phase, radius, speed, codeIdx)

    const positionNode = Fn(() => {
        const pos = positionLocal;
        const t = u.time.mul(aMoteSeed.z.mul(0.28).add(u.comboLift.mul(0.75))).add(aMoteSeed.x.mul(10.0));
        const angle = t.add(aMoteSeed.y.mul(6.28));
        const r = float(5.0).add(aMoteSeed.y.mul(19.0));
        const liftY = mod(t.mul(8.5), float(82.0)).sub(18.0);

        const offset = vec3(
            cos(angle).mul(r).add(20.0),
            liftY,
            sin(angle).mul(r.mul(0.75)).sub(98.0),
        );
        return pos.add(offset);
    })();

    const moteEval = Fn(() => {
        const P = positionWorld;
        const vUv = uv().sub(vec2(0.5, 0.5));
        const d = length(vUv).mul(2.0);
        const disc = pow(float(1.0).sub(smoothstep(float(0.05), float(1.0), d)), float(1.8));

        const sun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const calm = boardCalmFactorNode(P, u.calmStrength);
        const swatch = pieceSwatchNode(aMoteSeed.w);
        const col = mix(u.beamCore.mul(1.35), swatch.mul(1.35), u.flushPulse.mul(0.55));
        const alpha = clamp(disc.mul(sun.mul(0.88).add(0.04)).mul(calm).mul(0.48), 0.0, 0.68);
        return vec4(col, alpha);
    })();

    return new THREE.MeshBasicNodeMaterial({
        positionNode,
        colorNode: moteEval.xyz,
        opacityNode: moteEval.w,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
}

/**
 * 10. Cave Swifts (`Aerodramus`) Orbiting the Upper Sunlit Shaft
 */
export function createSwiftBirdsMaterial(u, textures) {
    const sunlitAt = makeSunlitAtNode(textures.fringeTex);
    const aSwiftMeta = attribute('aSwiftMeta', 'vec4'); // (orbitR, orbitY, speed, phase)

    const positionNode = Fn(() => {
        const pos = positionLocal;
        const orbitR = aSwiftMeta.x.mul(float(1.0).sub(u.comboLift.mul(0.32)));
        const orbitY = aSwiftMeta.y;
        const speed = aSwiftMeta.z;
        const phase = aSwiftMeta.w;

        const theta = u.time.mul(speed).add(phase);
        const flap = sin(u.time.mul(16.0).add(phase.mul(5.0))).mul(abs(pos.x)).mul(0.42);

        const localFlapped = vec3(pos.x, pos.y.add(flap), pos.z);
        const c = cos(theta);
        const s = sin(theta);
        const rotX = localFlapped.x.mul(c).sub(localFlapped.z.mul(s));
        const rotZ = localFlapped.x.mul(s).add(localFlapped.z.mul(c));

        const center = vec3(
            float(22.0).add(cos(theta).mul(orbitR)),
            orbitY.add(sin(theta.mul(2.0)).mul(2.2)),
            float(-104.0).add(sin(theta).mul(orbitR.mul(0.78))),
        );
        return center.add(vec3(rotX, localFlapped.y, rotZ));
    })();

    const colorNode = Fn(() => {
        const P = positionWorld;
        const sun = sunlitAt(P, u.sunDir, u.fringeAngle, u.cloudHoleOpen);
        const silhouette = u.caveShadow.mul(0.55);
        const sunlitWing = u.beamCore.mul(1.35);
        return mix(silhouette, sunlitWing, clamp(sun.mul(1.15), 0.0, 1.0));
    })();

    return new THREE.MeshBasicNodeMaterial({
        positionNode,
        colorNode,
        side: THREE.DoubleSide,
    });
}
