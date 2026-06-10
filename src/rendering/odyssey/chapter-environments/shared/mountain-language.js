/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview ONE mountain language — the single source of truth for every alpine
 * surface in the Odyssey (Surface World distant range + Mountains chapter heroes +
 * the foothill skirt that ramps between them).
 *
 * Part of the Odyssey Visual Cohesion master plan (Phase A, batch 2 — Unit A5). Before
 * this module there were FOUR mismatched mountain treatments (a distant-range palette
 * and a tundra-slope palette in surface-world.tsl.js; a main-peak palette and a
 * foothill-apron palette in mountain-peaks.tsl.js — each reading as a different rock,
 * a different snow, a different fog). They are unified here into ONE canonical palette,
 * ONE FBM displacement profile, and ONE snow-line + alpenglow + rim treatment.
 *
 * Per-instance variation is driven by exactly TWO parameters:
 *   1. distance / fogDensity — atmospheric perspective (how hazed/recessed a peak is).
 *   2. coolTemp (0..1)       — a temperature ramp from neutral grey-blue (Surface
 *                              horizon range, coolTemp≈0) to saturated cool blue
 *                              (Mountains chapter heroes, coolTemp≈1).
 * Snow stays bright, rock slate-blue, shadowed faces cool, and the high snow grazing
 * the light catches a warm alpenglow rose.
 *
 * THIS MODULE IS THREE-FREE FOR ITS DATA: the canonical palette + numeric profiles are
 * plain hex integers / numbers (trivially unit-testable, no renderer needed). The TSL
 * shading helpers import ONLY from `three/tsl` (no MeshBasicNodeMaterial here) — the
 * sibling `.tsl.js` builders own the materials/geometry and feed these helpers their
 * stage nodes (normalView / positionWorld / aHeight) + per-instance THREE.Color
 * uniforms resolved from `resolveMountainTreatment()`. WebGPU/TSL only.
 *
 * USAGE (in a .tsl.js builder):
 *   import { resolveMountainTreatment, mountainColorNode, mountainCpuDisplacement }
 *     from './shared/mountain-language.js';
 *   const t = resolveMountainTreatment({ coolTemp: 1.0 });          // hero peak
 *   const uSnow = uniform(new THREE.Color(t.snow)); ...             // build uniforms
 *   material.colorNode = mountainColorNode({ uSnow, uRock, ... , vHeight, vNormal });
 *   // and bake geometry height with mountainCpuDisplacement(...) so all bakes match.
 */

import {
    abs,
    cameraPosition,
    dot,
    float,
    length,
    max,
    mix,
    normalize,
    oneMinus,
    pow,
    smoothstep,
    vec3,
} from 'three/tsl';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE CANONICAL PALETTE (plain hex — THREE-free, unit-testable)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The one mountain palette. Two temperature poles per channel: the NEUTRAL pole is the
 * grey-blue read of Surface World's far horizon range (coolTemp 0); the COOL pole is the
 * saturated cool blue of the Mountains chapter heroes (coolTemp 1). `resolveMountainTreatment`
 * lerps between them by coolTemp so a single language spans both chapters.
 *
 *  - snow  : bright high-altitude snow (kept off pure white so it never blooms out).
 *  - rock  : slate-blue exposed rock.
 *  - shadow: the cool ice-shadow bounce that faces turned away from the key fall into.
 *  - fog   : the atmospheric body distant peaks recede into (matches the chapter fog read).
 *  - alpen : warm rose alpenglow grazing the highest sunlit snow (temperature-independent).
 *  - rim   : cool sky-fill rim along silhouette edges.
 */
export const MOUNTAIN_PALETTE = Object.freeze({
    // Snow — bright SUNLIT alpine snow. Pushed brighter + a hair warmer toward white so the
    // sun-facing caps blaze against dark rock (the Alps read the user wanted). Kept just shy
    // of pure white so ACES/bloom roll it off rather than clipping.
    snowNeutral: 0xeef3fb,
    snowCool: 0xf4f8ff,
    // SHADOWED snow — cool ice-blue the snow falls into on faces turned from the sun. This is
    // the third zone (sunlit snow / ice-blue shadowed snow / dark rock) that gives the caps
    // dimensional alpine modelling instead of one flat white sheet.
    snowShadowNeutral: 0xa9c4e2,
    snowShadowCool: 0x8fb4dc,
    // Rock — DARK exposed slate-blue, deeper + more saturated than before so the snow line is
    // a hard, high-contrast boundary (was a washed mid-grey that buried the caps). The cool
    // pole leans steel-blue; the neutral pole keeps a touch of warm schist so distant rock
    // doesn't go monochrome.
    rockNeutral: 0x39424d,
    rockCool: 0x202f40,
    // Shadowed-face bounce — deep cold blue, colder + darker as coolTemp climbs (more
    // contrast on the unlit faces, less wash).
    shadowNeutral: 0x1f2a39,
    shadowCool: 0x0e1c30,
    // Atmospheric fog body — neutral sky-blue haze -> denser deep cool blue.
    fogNeutral: 0x7fa4cf,
    fogCool: 0x33506e,
    // Warm alpenglow rose grazing the highest sunlit snow (shared, not temperature-lerped).
    // Richer, more saturated rose-gold so sunlit tops catch real alpenglow.
    alpenglow: 0xf59478,
    // Cool silhouette rim.
    rim: 0x9cc1e0,
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. THE ONE FBM DISPLACEMENT + SHADING PROFILE (plain numbers)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The single FBM displacement profile every CPU heightfield bake shares so all alpine
 * geometry (Surface distant range, Mountains heroes, the foothill apron) is sculpted by
 * the SAME ridge language — only `size`/`height`/`seed` vary per instance. These mirror
 * the (previously duplicated) cone-falloff + value-noise FBM walk the chapters used.
 */
export const MOUNTAIN_DISPLACEMENT = Object.freeze({
    coneExponent: 1.5, // (1 - normDist)^coneExponent radial cone falloff
    coneRadiusFrac: 0.45, // cone reaches zero at size * coneRadiusFrac
    octaves: 5, // value-noise FBM octaves
    baseFreq: 0.01, // first FBM sample frequency
    detailFreq: 0.04, // second (finer) FBM sample frequency
    baseWeight: 0.7, // weight of the coarse FBM
    detailWeight: 0.3, // weight of the fine FBM
    detailAmplitude: 0.4, // detail scaled to height * detailAmplitude
});

/**
 * The single snow-line / lighting / fog shading profile. Per-instance shaders read these
 * defaults; only `snowLine` is nudged per call site (heroes vs. foothills) and the snow
 * line also drops as the live winter snowBlend climbs.
 */
export const MOUNTAIN_SHADING = Object.freeze({
    snowLine: 0.46, // height (0..1) where snow begins on hero peaks — slightly lower so the
    // snowy caps dominate the upper peak (the user wants more snow on the tops).
    snowLineFoothill: 0.64, // higher line for the lower foothill apron
    snowLineNoiseAmp: 0.14, // FBM jitter on the snow line so it isn't a clean band (tightened
    // so the boundary still reads as a CRISP alpine snow line, not a fuzzy gradient)
    snowBand: 0.06, // ± soft transition width — tighter = a sharper, more defined snow line
    slopeSnowMin: 0.42, // slopes shallower than this hold snow
    slopeSnowMax: 0.78, // slopes steeper than this are bare rock (widened so steep upper
    // crags show dark rock streaks through the snow = alpine relief, not a smooth dome)
    keyDir: [0.5, 0.8, 0.5], // shared key-light direction
    keyDiffuse: 0.86, // diffuse weight ... (stronger key → more sun/shade contrast, de-wash)
    keyAmbient: 0.18, // ... + ambient floor (lower floor so shadowed faces stay deep)
    shadowAmount: 0.6, // how far shadowed faces lerp toward the cool shadow bounce (deeper
    // shadows = more contrast, the dominant de-wash lever)
    alpenHeightLo: 0.55, // alpenglow only on snow above this height
    alpenHeightHi: 0.92,
    alpenStrength: 0.42, // alpenglow intensity
    rimPower: 4.2,
    rimStrength: 0.14,
    fogNear: 620, // distance fog onset pushed OUT (was 420) so near/mid peaks keep full
    // contrast instead of hazing toward the pale fog body — the main wash culprit.
    fogFar: 1500, // distance fog saturation
    fogMax: 0.58, // cap lowered (was 0.7) so even far peaks keep a crisp, contrasty silhouette
});

// ── Foothill SKIRT (the Surface→Mountains ramp): meadow base -> rock top ─────────
/** Surface meadow green the skirt blends UP FROM at its base (matches landscape grass). */
export const MOUNTAIN_SKIRT_MEADOW = 0x3f7a33;

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PER-INSTANCE TREATMENT RESOLVER (THREE-free — returns hex + numbers)
// ═══════════════════════════════════════════════════════════════════════════════

function lerpChannel(a, b, t) {
    return a + (b - a) * t;
}

/** Lerp two hex colors in (gamma) RGB space; returns a hex int. Pure, no THREE. */
export function lerpHexColor(hexA, hexB, t) {
    const k = Math.max(0, Math.min(1, t));
    const ar = Math.floor(hexA / 65536) % 256;
    const ag = Math.floor(hexA / 256) % 256;
    const ab = hexA % 256;
    const br = Math.floor(hexB / 65536) % 256;
    const bg = Math.floor(hexB / 256) % 256;
    const bb = hexB % 256;
    const r = Math.round(lerpChannel(ar, br, k));
    const g = Math.round(lerpChannel(ag, bg, k));
    const b = Math.round(lerpChannel(ab, bb, k));
    return (r * 65536) + (g * 256) + b;
}

/**
 * Resolve the canonical palette to one instance's colors using the TWO parameters.
 * @param {object} [opts]
 * @param {number} [opts.coolTemp=0] 0 = neutral grey-blue (Surface horizon range),
 *   1 = saturated cool blue (Mountains chapter heroes).
 * @param {number} [opts.snowLine] override the snow line (defaults to the hero line).
 * @returns {{snow:number, snowShadow:number, rock:number, shadow:number, fog:number,
 *   alpenglow:number, rim:number, snowLine:number, coolTemp:number}} hex colors + numbers.
 */
export function resolveMountainTreatment(opts = {}) {
    const coolTemp = Math.max(0, Math.min(1, opts.coolTemp ?? 0));
    return {
        coolTemp,
        snow: lerpHexColor(MOUNTAIN_PALETTE.snowNeutral, MOUNTAIN_PALETTE.snowCool, coolTemp),
        snowShadow: lerpHexColor(
            MOUNTAIN_PALETTE.snowShadowNeutral,
            MOUNTAIN_PALETTE.snowShadowCool,
            coolTemp,
        ),
        rock: lerpHexColor(MOUNTAIN_PALETTE.rockNeutral, MOUNTAIN_PALETTE.rockCool, coolTemp),
        shadow: lerpHexColor(MOUNTAIN_PALETTE.shadowNeutral, MOUNTAIN_PALETTE.shadowCool, coolTemp),
        fog: lerpHexColor(MOUNTAIN_PALETTE.fogNeutral, MOUNTAIN_PALETTE.fogCool, coolTemp),
        alpenglow: MOUNTAIN_PALETTE.alpenglow,
        rim: MOUNTAIN_PALETTE.rim,
        snowLine: opts.snowLine ?? MOUNTAIN_SHADING.snowLine,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THE ONE CPU FBM DISPLACEMENT (so every bake shares one ridge language)
// ═══════════════════════════════════════════════════════════════════════════════

function fractCpu(n) {
    return n - Math.floor(n);
}

function mixCpu(a, b, t) {
    return a * (1 - t) + b * t;
}

/**
 * The canonical CPU value-noise + FBM lattice (mirrors the chapters' previous inline
 * `hash`/`noise`/`fbm`). Kept here so every alpine bake (Surface distant range,
 * Mountains heroes, foothill apron) is sculpted by the identical noise field.
 */
export function mountainFbm(x, y, seed = 0) {
    const rand = (i, j) => Math.sin(i * 12.9898 + j * 78.233 + seed) * 43758.5453;
    const noise = (nx, ny) => {
        const i = Math.floor(nx);
        const j = Math.floor(ny);
        const f = fractCpu(nx);
        const g = fractCpu(ny);
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);
        return mixCpu(
            mixCpu(fractCpu(rand(i, j)), fractCpu(rand(i + 1, j)), u),
            mixCpu(fractCpu(rand(i, j + 1)), fractCpu(rand(i + 1, j + 1)), u),
            v,
        );
    };

    let sampleX = x;
    let sampleY = y;
    let value = 0.0;
    let amp = 0.5;
    for (let i = 0; i < MOUNTAIN_DISPLACEMENT.octaves; i += 1) {
        value += amp * noise(sampleX, sampleY);
        sampleX *= 2.0;
        sampleY *= 2.0;
        amp *= 0.5;
    }
    return value;
}

/**
 * The canonical per-vertex displacement height for one (x, z) on a peak of the given
 * size/height/seed — cone falloff + FBM detail. Returns 0 outside the cone radius.
 * Both Surface World's distant range and the Mountains chapter use this so a peak in
 * Ch3's horizon is the SAME mountain shape Ch4 shows up close.
 * @returns {number} world-space height for that vertex.
 */
export function mountainCpuDisplacement(x, z, { size, height, seed = 0 }) {
    const dist = Math.sqrt(x * x + z * z);
    const maxDist = size * MOUNTAIN_DISPLACEMENT.coneRadiusFrac;
    if (dist > maxDist) return 0;

    const normDist = dist / maxDist;
    const cone = (1.0 - normDist) ** MOUNTAIN_DISPLACEMENT.coneExponent * height;

    const n = mountainFbm(x * MOUNTAIN_DISPLACEMENT.baseFreq, z * MOUNTAIN_DISPLACEMENT.baseFreq, seed);
    const n2 = mountainFbm(
        x * MOUNTAIN_DISPLACEMENT.detailFreq,
        z * MOUNTAIN_DISPLACEMENT.detailFreq,
        seed + 10.0,
    );
    const detail = (n * MOUNTAIN_DISPLACEMENT.baseWeight + n2 * MOUNTAIN_DISPLACEMENT.detailWeight)
        * height * MOUNTAIN_DISPLACEMENT.detailAmplitude * (1.0 - normDist);

    return cone + detail;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. THE ONE TSL SHADING TREATMENT (snow-line + alpenglow + rim + atmospheric fog)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the canonical mountain `colorNode`. Both `.tsl.js` builders call this with the
 * stage nodes (vNormal/vWorldPosition/vHeight), the per-instance THREE.Color uniforms
 * (resolved via resolveMountainTreatment), and the live snow-blend / snow-line uniforms.
 * One snow-line, one alpenglow, one rim, one atmospheric-fog treatment — everywhere.
 *
 * @param {object} a
 * @param {*} a.uSnow vec3/Color uniform — snow color for this instance.
 * @param {*} a.uRock vec3/Color uniform — rock color.
 * @param {*} a.uShadow vec3/Color uniform — cool ice-shadow bounce color.
 * @param {*} a.uFog vec3/Color uniform — atmospheric fog body color.
 * @param {*} a.uAlpen vec3/Color uniform — warm alpenglow color.
 * @param {*} a.uRim vec3/Color uniform — cool silhouette rim color.
 * @param {*} [a.uSnowShadow] optional vec3/Color uniform — cool ICE-BLUE shadowed snow
 *   (the snow on faces turned from the sun). When supplied the snow is modelled in three
 *   zones (sunlit snow / ice-blue shadowed snow / dark rock); when omitted the snow falls
 *   back to a flat lit `uSnow` (Surface's distant-range read is then unchanged).
 * @param {*} a.uSnowLine float uniform — base snow line (0..1).
 * @param {*} a.uSnowBlend float uniform — live winter blend (0..1); drops the snow line.
 * @param {*} a.vNormal normalView node.
 * @param {*} a.vWorldPosition positionWorld node.
 * @param {*} a.vHeight aHeight attribute node (0..1 normalized peak height).
 * @param {*} a.snowNoise optional float node (FBM ~[0,1]) jittering the snow line; if
 *   omitted the line is clean.
 * @param {*} [a.alpenScale] optional float node (0..1) scaling the alpenglow — e.g.
 *   `oneMinus(uTransition)` to fade the rose as the chapter goes to night. Default 1.
 * @param {number} [a.fogNear] / [a.fogFar] distance-fog window override.
 * @param {number[]} [a.keyDir] optional [x,y,z] key-light direction OVERRIDE (defaults to
 *   MOUNTAIN_SHADING.keyDir). The Mountains chapter aligns this to its on-screen sun's
 *   lightDir so lit faces face the sun; Surface's distant range omits it (unchanged).
 * @param {number} [a.alpenStrength] / [a.alpenHeightLo] optional alpenglow intensity /
 *   height-floor OVERRIDES (default to MOUNTAIN_SHADING) so the Mountains chapter can fire
 *   a stronger, lower alpenglow without touching the Surface-shared defaults. ADDITIVE.
 * @param {*} [a.snowSparkle] optional float node (~[0,1]) of crisp high-freq snow
 *   micro-detail (granular sparkle + wind streaks). Added ONLY where snow is present and
 *   only on the highest band; omitted by Surface (distant-range read is unchanged).
 * @returns {*} vec3 colorNode.
 */
export function mountainColorNode(a) {
    const {
        uSnow, uRock, uShadow, uFog, uAlpen, uRim,
        uSnowShadow = null,
        uSnowLine, uSnowBlend,
        vNormal, vWorldPosition, vHeight,
        snowNoise = null,
        alpenScale = null,
        fogNear = MOUNTAIN_SHADING.fogNear,
        fogFar = MOUNTAIN_SHADING.fogFar,
        keyDir = MOUNTAIN_SHADING.keyDir,
        alpenStrength = MOUNTAIN_SHADING.alpenStrength,
        alpenHeightLo = MOUNTAIN_SHADING.alpenHeightLo,
        snowSparkle = null,
    } = a;

    const n = normalize(vNormal);
    const [lx, ly, lz] = keyDir;
    const lightDir = normalize(vec3(lx, ly, lz));
    const ndl = max(0.0, dot(n, lightDir));
    const diff = ndl.mul(MOUNTAIN_SHADING.keyDiffuse).add(MOUNTAIN_SHADING.keyAmbient);

    // Rock falls into the cool ice-shadow bounce on faces turned from the key.
    const shadeAmt = oneMinus(ndl).mul(MOUNTAIN_SHADING.shadowAmount);
    const rock = mix(uRock.mul(diff), uShadow, shadeAmt);

    // THREE-ZONE ALPINE SNOW (the user's "snow on the tops like the Alps"): the snow itself
    // is shaded between BRIGHT SUNLIT snow (faces toward the sun) and a cool ICE-BLUE shadow
    // (faces turned away), driven by ndl — not a flat white sheet. A small ambient lift keeps
    // the deepest shadowed snow from going muddy. When no shadow-snow uniform is supplied
    // (Surface distant range) we fall back to the prior flat lit snow so that read is intact.
    const sunLitSnow = uSnow.mul(diff.mul(0.85).add(0.15));
    const snow = uSnowShadow
        ? mix(uSnowShadow, sunLitSnow, smoothstep(0.05, 0.85, ndl))
        : sunLitSnow;

    // Snow line — jittered by optional FBM, dropped as the live winter blend climbs, and
    // gated by slope so steep faces stay bare rock.
    const lineBase = mix(uSnowLine.add(0.04), uSnowLine.sub(0.16), uSnowBlend);
    const snowLine = snowNoise
        ? lineBase.add(snowNoise.sub(0.5).mul(MOUNTAIN_SHADING.snowLineNoiseAmp))
        : lineBase;
    const slope = oneMinus(abs(dot(n, vec3(0.0, 1.0, 0.0))));
    const slopeFactor = smoothstep(MOUNTAIN_SHADING.slopeSnowMax, MOUNTAIN_SHADING.slopeSnowMin, slope);
    const snowMix = smoothstep(
        snowLine.sub(MOUNTAIN_SHADING.snowBand),
        snowLine.add(MOUNTAIN_SHADING.snowBand),
        vHeight,
    ).mul(slopeFactor);

    let color = mix(rock, snow, snowMix);

    // Crisp snow micro-detail (ADDITIVE, opt-in): a higher-freq sparkle + wind-streak node
    // supplied by the caller, gated to the snow band + the highest vHeight so it reads as
    // granular sunlit snow rather than flat smooth snow. Soft-capped so it never clips white.
    // Sparkle is also gated by ndl so it only glints on the SUNLIT snow (real snow micro-
    // facets catch the sun) and never lights up the ice-blue shadowed snow.
    // Surface's distant range passes none → its read is unchanged.
    if (snowSparkle) {
        const sparkleBand = smoothstep(0.55, 0.85, vHeight).mul(snowMix).mul(ndl);
        color = color.add(snowSparkle.mul(sparkleBand).mul(0.2));
    }

    // Alpenglow — warm rose grazing only the highest sunlit snow. Strength + height-floor
    // are overridable so the Mountains chapter fires a stronger, lower glow than Surface.
    const alpenHeight = smoothstep(alpenHeightLo, MOUNTAIN_SHADING.alpenHeightHi, vHeight);
    const alpenLight = pow(ndl, float(1.6));
    let alpenGlow = alpenHeight.mul(alpenLight).mul(snowMix).mul(alpenStrength);
    if (alpenScale) alpenGlow = alpenGlow.mul(alpenScale);
    color = color.add(uAlpen.mul(alpenGlow));

    // Cool silhouette rim.
    const viewDir = normalize(cameraPosition.sub(vWorldPosition));
    const rim = pow(oneMinus(max(dot(n, viewDir), 0.0)), float(MOUNTAIN_SHADING.rimPower));
    color = color.add(uRim.mul(rim).mul(MOUNTAIN_SHADING.rimStrength));

    // Atmospheric perspective — distance fog capped so peaks keep a crisp silhouette.
    const dist = length(vWorldPosition.sub(cameraPosition));
    const fogFactor = smoothstep(float(fogNear), float(fogFar), dist).mul(MOUNTAIN_SHADING.fogMax);
    color = mix(color, uFog, fogFactor);

    return color;
}

/**
 * Build the foothill-SKIRT `colorNode`: a height-blended RAMP from Surface meadow-green
 * at the base up into canonical mountain rock at the top (NOT a hard seam). Snow caps the
 * very top as the live winter blend climbs. Shares the canonical lighting + fog.
 *
 * @param {object} a
 * @param {*} a.uMeadow vec3/Color uniform — Surface meadow green (skirt base).
 * @param {*} a.uRock vec3/Color uniform — canonical rock (skirt top).
 * @param {*} a.uSnow vec3/Color uniform — canonical snow (cap).
 * @param {*} a.uShadow vec3/Color uniform — cool shadow bounce.
 * @param {*} a.uFog vec3/Color uniform — atmospheric fog body.
 * @param {*} a.uSnowBlend float uniform — live winter blend (0..1).
 * @param {*} a.vNormal normalView node.
 * @param {*} a.vWorldPosition positionWorld node.
 * @param {*} a.vLocalHeight float node — local Y (model space) of the skirt vertex.
 * @param {*} a.noise float node (~[0,1]) breaking up the meadow/rock + snow boundaries.
 * @param {number} a.rockStartY local height where rock fully takes over the meadow.
 * @param {number} a.snowStartY local height where the snow cap begins (at full blend).
 * @returns {*} vec3 colorNode.
 */
export function mountainSkirtColorNode(a) {
    const {
        uMeadow, uRock, uSnow, uShadow, uFog, uSnowBlend,
        vNormal, vWorldPosition, vLocalHeight, noise,
        rockStartY, snowStartY,
    } = a;

    const n = normalize(vNormal);
    const [lx, ly, lz] = MOUNTAIN_SHADING.keyDir;
    const lightDir = normalize(vec3(lx, ly, lz));
    const ndl = max(0.0, dot(n, lightDir));
    const diff = ndl.mul(MOUNTAIN_SHADING.keyDiffuse).add(MOUNTAIN_SHADING.keyAmbient);

    // Height RAMP: meadow at the base lerps up into rock — a continuous gradient, not a
    // seam. Noise + slope nudge the boundary so it reads as terrain, not a contour line.
    const slope = oneMinus(abs(dot(n, vec3(0.0, 1.0, 0.0))));
    const rampInput = vLocalHeight.add(noise.mul(10.0)).add(slope.mul(10.0));
    const rockMask = smoothstep(float(-4.0), float(rockStartY), rampInput);
    let base = mix(uMeadow, uRock, rockMask);

    // Lit + shadow bounce.
    base = mix(uShadow, base, diff);

    // Snow cap on the very top as winter climbs.
    const snowRamp = smoothstep(0.45, 1.0, uSnowBlend);
    const snowMix = smoothstep(
        float(snowStartY),
        float(snowStartY + 40.0),
        vLocalHeight.add(noise.mul(14.0)).sub(oneMinus(snowRamp).mul(16.0)),
    ).mul(snowRamp.mul(0.85).add(0.15));
    let color = mix(base, uSnow.mul(diff.mul(0.85).add(0.15)), snowMix);

    // Shared atmospheric fog.
    const dist = length(vWorldPosition.sub(cameraPosition));
    const fogFactor = smoothstep(float(380.0), float(1400.0), dist).mul(0.5);
    color = mix(color, uFog, fogFactor);

    return color;
}

export default MOUNTAIN_PALETTE;
