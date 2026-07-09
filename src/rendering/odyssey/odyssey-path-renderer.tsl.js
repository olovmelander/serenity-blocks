/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey diegetic PATH renderer — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — final batch). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md. Faithful TSL ports of
 * OdysseyPathRenderer.js's three GLSL ShaderMaterials — the outer per-chapter path
 * tube, the bright inner core tube, and the additive glow halo tube — rebuilt as
 * NodeMaterials so they run on the WebGPURenderer and its automatic WebGL2 fallback.
 *
 * The most logic-dense material on the board: the outer + core fragment shaders inject
 * PATH_CHAPTER_GLSL, whose `chapterAt()` cross-fades eight per-chapter base/emissive
 * colours along arc-length (vUv.x) and `stylePattern()` paints eight per-world surface
 * styles (lavaCrust / causticCurrent / leyLine / cairnRidge / jetStream / stellarStream
 * / horizonFilament / neonDataLine). Both are reproduced here as TSL node graphs: the
 * eight chapter colours/styles + bounds are uniforms; the chapter is selected by vUv.x
 * via a forward seam-crossfade chain (numerically equivalent to the GLSL bracket loop);
 * the eight style patterns are built as node expressions and selected by a styleId
 * mask. `pr_vnoise`/`pr_hash21` map to the shared TSL noise lib (noise2/hash21).
 *
 * All three tubes glow (the path is an emitter) → tagged `userData.emitsBloom = true`
 * for the future MRT selective-bloom pass; emissiveNode is wired when the TSL post
 * graph lands (kept off here so the standalone smoke harness, which has no MRT bloom,
 * does not double-brighten).
 *
 * This is ADDITIVE: the live OdysseyPathRenderer.js (raw GLSL ShaderMaterial on
 * WebGLRenderer) is untouched and keeps working.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    cameraPosition,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalView,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import { hash21, noise2 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import {
    ODYSSEY_CHAPTER_PROFILES,
    ODYSSEY_PATH_STYLES,
} from './chapter-environments/shared/chapter-profile.js';

// Map each path style to a shader style index (mirrors OdysseyPathRenderer.PATH_STYLE_INDEX).
const PATH_STYLE_INDEX = {
    [ODYSSEY_PATH_STYLES.LAVA_CRUST]: 0,
    [ODYSSEY_PATH_STYLES.CAUSTIC_CURRENT]: 1,
    [ODYSSEY_PATH_STYLES.LEY_LINE]: 2,
    [ODYSSEY_PATH_STYLES.CAIRN_RIDGE]: 3,
    [ODYSSEY_PATH_STYLES.JET_STREAM]: 4,
    [ODYSSEY_PATH_STYLES.STELLAR_STREAM]: 5,
    [ODYSSEY_PATH_STYLES.HORIZON_FILAMENT]: 6,
    [ODYSSEY_PATH_STYLES.NEON_DATA_LINE]: 7,
};

const CHAPTER_COUNT = 8;
const SEAM = 0.012; // chapterAt() seam width (matches live GLSL).

/**
 * UNIT A4-PATH — ONE locked path cross-section spec shared by every chapter. The path
 * must read with the SAME thickness/brightness in all eight worlds, varying ONLY in hue
 * (the per-biome emissive/base colour, kept). The per-chapter `path.widthScale`
 * (chapter-profile, read-only) acts as a GENTLE multiplier on `outerRadius` only — its
 * spread is compressed toward 1.0 by `gentleWidthScale()` so a chapter never visibly
 * fattens or pinches the ribbon.
 *
 *  - outerRadius / coreRadius / glowRadius lock the three concentric tubes.
 *  - radialSegments / tubularSegments are high enough that the polygonal silhouette
 *    disappears (Urban read as faceted at the old 16/8 radial counts).
 *  - emission / coreEmission / flowGlowPeak / coreBrightness keep the RAW linear
 *    emissive sane (peak <= ~1.5 linear) so the post ACES tonemap lands on a saturated
 *    glowing ribbon, not a white-clipped one.
 *
 * NOTE: the live OdysseyPathRenderer.js mounts these NodeMaterials on its own
 * variable-radius tube geometry (built in `_createVariableTubeGeometry`); the radius /
 * segment values here drive the standalone pilot + the builder defaults. Raising the
 * live tube's radialSegments to match (>= 28) lives in OdysseyPathRenderer.js (owned by
 * another agent) — surfaced via ODYSSEY_PATH_CROSS_SECTION so both can read one spec.
 */
export const ODYSSEY_PATH_CROSS_SECTION = Object.freeze({
    outerRadius: 0.6,
    coreScale: 0.3, // core radius = outerRadius * coreScale
    glowScale: 2.0, // glow radius = (outerRadius * coreScale) * glowScale (legacy ratio)
    // High subdivision so the tube silhouette is smooth in every chapter (was 16 / 8).
    radialSegments: 32,
    coreRadialSegments: 24,
    glowRadialSegments: 20,
    tubularSegments: 480,
    coreTubularSegments: 480,
    glowTubularSegments: 320,
    // Raw linear emissive ceilings — kept <= ~1.5 at peak so post-tonemap stays sub-white.
    // FIGURE-GROUND (masterplan D2): live captures showed the path was the BRIGHTEST object in
    // every chapter frame, out-reading the world hero. Dropped the ceilings ~25-35% so the path
    // stays a clear leading line but recedes below the chapter's own scene. Capture-verified on
    // the worst offenders (ch3 green, ch4 white, ch5 blue). Prior values in parens.
    emission: 1.0, // outer overall emissive multiplier (was 1.35).
    flowGlowPeak: 0.16, // outer flow-pulse glow peak (was 0.22).
    edgeGlowPeak: 0.72, // outer leading-edge glow gain (was 1.0).
    coreBrightness: 1.05, // inner-core emissive multiplier (was 1.45).
    glowAlphaPeak: 0.09, // additive halo alpha peak (was 0.14).
    // widthScale compression: chapter widthScale s -> 1 + (s-1)*widthScaleBlend.
    widthScaleBlend: 0.35,
});

/**
 * Compress a per-chapter `path.widthScale` toward 1.0 so it is only a gentle nudge on
 * the locked base radius (the data agent is also narrowing its spread). Plain JS so it
 * can scale the geometry radius at build time.
 * @param {number} [widthScale]
 * @returns {number} multiplier near 1.0
 */
export function gentleWidthScale(widthScale = 1) {
    const s = Number.isFinite(widthScale) ? widthScale : 1;
    return 1 + (s - 1) * ODYSSEY_PATH_CROSS_SECTION.widthScaleBlend;
}

/**
 * Default per-chapter base/emissive/style/bounds, derived from ODYSSEY_CHAPTER_PROFILES
 * exactly like OdysseyPathRenderer._buildChapterUniforms (minus the live layout's
 * chapterPositions, which it overrides). Returns plain JS values for `uniform()`.
 * @param {number[]} [chapterPositions] optional 8 chapter-start positions
 */
function buildChapterDefaults(chapterPositions = []) {
    const bounds = chapterPositions.filter((p) => Number.isFinite(p));
    while (bounds.length < 9) bounds.push(1);
    if (bounds[bounds.length - 1] < 1) bounds.push(1);

    const base = [];
    const emissive = [];
    const style = [];
    for (let i = 0; i < CHAPTER_COUNT; i += 1) {
        const profile = ODYSSEY_CHAPTER_PROFILES[i] || ODYSSEY_CHAPTER_PROFILES[0];
        base.push(new THREE.Color(profile.path.baseColor));
        emissive.push(new THREE.Color(profile.path.emissiveColor));
        style.push(PATH_STYLE_INDEX[profile.path.style] ?? 0);
    }
    return {
        bounds: bounds.slice(0, 9), base, emissive, style,
    };
}

/**
 * Build the per-chapter uniform set shared by the outer / core / glow materials.
 * Mirrors OdysseyPathRenderer's `_chapterUniforms` (bounds[9], base[8], emissive[8],
 * style[8], uFlow, uHead, uBeat) but as individual `uniform()` nodes so the chapter
 * lookup unrolls cleanly into a node graph.
 * @param {number[]} [chapterPositions]
 */
export function createPathChapterUniforms(chapterPositions = []) {
    const defaults = buildChapterDefaults(chapterPositions);
    // uniform() must wrap a plain JS value (number / THREE.Color), NOT a TSL node —
    // wrapping a float() node yields an un-named uniform ("Uniform null not declared").
    const uBounds = defaults.bounds.map((b) => uniform(b));
    const uBase = defaults.base.map((c) => uniform(c));
    const uEmissive = defaults.emissive.map((c) => uniform(c));
    const uStyle = defaults.style.map((s) => uniform(s));
    return {
        uBounds,
        uBase,
        uEmissive,
        uStyle,
        uFlow: uniform(0),
        uHead: uniform(0),
        uBeat: uniform(0),
    };
}

// ── chapterAt() — per-chapter colour/style lookup along vUv.x ─────────────────────

/**
 * Forward seam-crossfade equivalent of the GLSL `chapterAt()` bracket loop. Because the
 * chapter bounds are contiguous (`chapter i` spans [bounds[i], bounds[i+1]]), folding a
 * `smoothstep(b-seam, b, x)` crossfade at every interior boundary reproduces the same
 * piecewise colour as the live per-bracket `if (x > hi - seam)` blend, with the same
 * 0.012 seam. styleId switches hard at the seam midpoint (step(0.5, t)) like the GLSL.
 * @returns {{ baseCol, emisCol, styleId }} TSL nodes
 */
function chapterAt(chapter, x) {
    const {
        uBounds, uBase, uEmissive, uStyle,
    } = chapter;

    let baseCol = uBase[0];
    let emisCol = uEmissive[0];
    let styleId = uStyle[0];

    for (let i = 0; i < CHAPTER_COUNT - 1; i += 1) {
        const hi = uBounds[i + 1];
        const t = smoothstep(hi.sub(SEAM), hi, x);
        baseCol = mix(baseCol, uBase[i + 1], t);
        emisCol = mix(emisCol, uEmissive[i + 1], t);
        styleId = mix(styleId, uStyle[i + 1], step(0.5, t));
    }

    return { baseCol, emisCol, styleId };
}

// ── stylePattern() — eight per-world surface characters selected by styleId ───────

/** pr_vnoise(p) → value noise in ~[0,1] (shared noise2). */
function prVnoise(p) {
    return noise2(p);
}

/**
 * Port of the GLSL `stylePattern(styleId, uv, t)` if/else ladder. Each style is built
 * as a node expression; the ladder is reproduced as a chain of `mix(prev, next, mask)`
 * where `mask = step(s_threshold, styleId + 0.5)` — i.e. the same `s < n` thresholds
 * the GLSL uses (`s = styleId + 0.5`). Selecting by `style + 0.5` keeps the integer
 * style ids on the correct side of every threshold even after the seam crossfade.
 */
function stylePattern(styleId, vUv, t) {
    const s = styleId.add(0.5);

    // 0 — lavaCrust: cracked molten cells.
    const n0 = prVnoise(vec3(vUv.x.mul(60.0), vUv.y.mul(8.0), 0.0).xy);
    const cracks = smoothstep(0.44, 0.5, n0).sub(smoothstep(0.5, 0.56, n0));
    const lava = float(0.7)
        .add(cracks.mul(2.4))
        .add(prVnoise(vec3(vUv.x.mul(130.0), vUv.y.mul(12.0), 0.0).xy).mul(0.2));

    // 1 — causticCurrent: flowing caustic stripes.
    const c = sin(vUv.x.mul(38.0).sub(t.mul(2.0))).mul(sin(vUv.y.mul(10.0).add(t.mul(0.7))));
    const caustic = float(0.8).add(c.mul(c).mul(0.7));

    // 2 — leyLine: travelling dashes.
    const d = fract(vUv.x.mul(26.0).sub(t.mul(0.4)));
    const dash = smoothstep(0.0, 0.12, d).mul(smoothstep(0.55, 0.4, d));
    const ley = float(0.6).add(dash.mul(1.3));

    // 3 — cairnRidge: stone with bright veins.
    const v = smoothstep(0.47, 0.5, prVnoise(vec3(vUv.x.mul(24.0), vUv.y.mul(4.0), 0.0).xy));
    const cairn = float(0.65).add(v.mul(1.4));

    // 4 — jetStream: wind streaks along length.
    const st = sin(vUv.x.mul(9.0).add(vUv.y.mul(2.0)).sub(t.mul(3.0))).mul(0.5).add(0.5);
    const jet = float(0.7).add(st.mul(0.7));

    // 5 — stellarStream: sparkle particle river.
    const sp = hash21(floor(vec3(vUv.x.mul(80.0), vUv.y.mul(16.0), 0.0).xy).add(floor(t.mul(4.0))));
    const stellar = float(0.7).add(step(0.93, sp).mul(2.2));

    // 6 — horizonFilament: stretched lensing streaks.
    const l = sin(vUv.x.mul(48.0).sub(t.mul(4.0))).mul(0.5).add(0.5);
    const horizon = float(0.7).add(pow(l, 3.0).mul(1.1));

    // 7 — neonDataLine: scanline data segments.
    const sc = step(0.5, fract(vUv.x.mul(46.0).sub(t.mul(1.4))));
    const neon = float(0.6).add(sc.mul(0.85));

    // if/else ladder: each threshold switches the running pattern to the next style.
    let pat = lava;
    pat = mix(pat, caustic, step(1.0, s));
    pat = mix(pat, ley, step(2.0, s));
    pat = mix(pat, cairn, step(3.0, s));
    pat = mix(pat, jet, step(4.0, s));
    pat = mix(pat, stellar, step(5.0, s));
    pat = mix(pat, horizon, step(6.0, s));
    pat = mix(pat, neon, step(7.0, s));
    return pat;
}

// ── Standalone-curve helper (default geometry for the smoke harness) ──────────────

/**
 * A short straight CatmullRom curve so the builders construct standalone without the
 * live odyssey layout. The live renderer builds a variable-radius tube; here we use a
 * plain TubeGeometry of the requested radius (uv.x = along path, uv.y = around tube),
 * which is sufficient for the graph-construct smoke test.
 */
function defaultPathCurve() {
    return new THREE.CatmullRomCurve3([
        new THREE.Vector3(-20, -10, 0),
        new THREE.Vector3(-6, -2, 4),
        new THREE.Vector3(6, 4, -4),
        new THREE.Vector3(20, 12, 0),
    ]);
}

function makeTube(curve, radius, radialSegments, tubularSegments) {
    return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

// `1.0 - step(edge, x)` — the GLSL `(1.0 - step(uProgress, vUv.x))` edge mask.
function oneMinusStep(edge, x) {
    return float(1.0).sub(step(edge, x));
}

// ── Outer path tube (per-chapter diegetic surface; bloom-eligible) ────────────────

/**
 * Port of OdysseyPathRenderer.createPathTube's AAA outer material. The diegetic branch
 * (per-chapter colour + per-world `stylePattern` + flow pulse + beat + transition band)
 * replaces the legacy orange→purple gradient, exactly as the live `this.aaa` branch.
 * @param {object} uTime shared time uniform (uniform(0))
 * @param {object} [opts]
 */
export function createPathOuterTSL(uTime = uniform(0), opts = {}) {
    const chapter = opts.chapter ?? createPathChapterUniforms(opts.chapterPositions);
    const curve = opts.curve ?? defaultPathCurve();
    // ONE locked cross-section; per-chapter widthScale is only a gentle multiplier.
    const radius = (opts.radius ?? ODYSSEY_PATH_CROSS_SECTION.outerRadius)
        * gentleWidthScale(opts.widthScale);
    const radialSegments = opts.radialSegments ?? ODYSSEY_PATH_CROSS_SECTION.radialSegments;
    const tubularSegments = opts.tubularSegments ?? ODYSSEY_PATH_CROSS_SECTION.tubularSegments;

    const uEmission = opts.uEmission ?? uniform(ODYSSEY_PATH_CROSS_SECTION.emission);
    const uTransitionColor = opts.uTransitionColor ?? uniform(new THREE.Color(0xffffff));
    const uTransitionMix = opts.uTransitionMix ?? uniform(0);
    const uTransitionHead = opts.uTransitionHead ?? uniform(0.5);
    const uTransitionWidth = opts.uTransitionWidth ?? uniform(0.08);
    const uProgress = opts.uProgress ?? uniform(0);

    const {
        uFlow, uHead, uBeat,
    } = chapter;

    const vUv = uv();
    const vNormal = normalView;

    // Progress illumination / edge glow / rim (shared with the legacy path).
    const lit = step(vUv.x, uProgress);
    const edgeGlow = smoothstep(uProgress.sub(0.05), uProgress, vUv.x)
        .mul(oneMinusStep(uProgress, vUv.x));
    const rim = pow(float(1.0).sub(abs(dot(vNormal, vec3(0.0, 0.0, 1.0)))), 1.5);

    const transitionBand = float(1.0).sub(
        smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
    );

    // ── AAA: per-chapter diegetic path (colour + per-world surface) ──
    const { baseCol, emisCol, styleId } = chapterAt(chapter, vUv.x);
    const pat = stylePattern(styleId, vUv, uTime);

    // flow pulse travelling toward the head (player progress)
    const flow = sin(vUv.x.sub(uHead).mul(55.0).sub(uTime.mul(uFlow.mul(3.0).add(2.0))));
    const flowGlow = smoothstep(0.2, 1.0, flow)
        .mul(ODYSSEY_PATH_CROSS_SECTION.flowGlowPeak)
        .mul(lit);

    let aaaColor = mix(
        baseCol.mul(0.5),
        mix(baseCol, emisCol, 0.65).mul(pat),
        max(lit, 0.4),
    );
    // Clamp the summed emissive GAIN so the brightest ribbon pixel stays a saturated
    // glow rather than clipping to white (raw linear peak ~ emisCol * 1.0, x uEmission).
    const emisGain = clamp(
        rim.mul(0.5).add(flowGlow).add(uBeat.mul(0.18)).add(edgeGlow.mul(ODYSSEY_PATH_CROSS_SECTION.edgeGlowPeak)),
        0.0,
        1.0,
    );
    aaaColor = aaaColor.add(emisCol.mul(emisGain));

    // ── Ch5 (Sky) two-tone sun/aurora rim — SURGICAL, ch5-gated, ADDITIVE ──
    // The Sky chapter's path style is jetStream (styleId 4). Where the ribbon faces
    // the on-camera sun (top half of the tube, vUv.y > 0.5) add a thin WARM sun-side
    // rim; the side facing away picks up a COOL aurora rim. Gated hard to styleId 4
    // so no other chapter is touched. Kept small + additive so it never lifts the
    // ribbon to white (the global emissive ceiling below still clamps).
    const ch5Gate = step(3.5, styleId).mul(oneMinusStep(styleId, 4.5));
    const sunSide = smoothstep(0.42, 0.62, vUv.y); // top of tube faces the sun
    const twoToneRim = pow(float(1.0).sub(abs(dot(vNormal, vec3(0.0, 0.0, 1.0)))), 2.2);
    const ch5Warm = vec3(1.0, 0.78, 0.46); // warm sun-side rim
    const ch5Cool = vec3(0.36, 0.92, 1.0); // cool aurora rim
    const ch5RimTint = mix(ch5Cool, ch5Warm, sunSide);
    aaaColor = aaaColor.add(ch5RimTint.mul(twoToneRim).mul(0.28).mul(ch5Gate));

    aaaColor = aaaColor.mul(uEmission);
    // B4 EMISSIVE CAP (~0.9 display): the path is the through-line in ALL 8 frames, so its
    // consistency matters most — cap the raw linear emissive to 1.0 (ACES → ~0.80 display)
    // so even after the post exposure/bloom (incl. ch8 ignition swell) the brightest ribbon
    // pixel lands near ~0.9 display, never white. The ch5 two-tone rim above is preserved.
    aaaColor = min(aaaColor, vec3(1.0));
    aaaColor = mix(
        aaaColor,
        mix(aaaColor, uTransitionColor.mul(pat.add(1.4)), 0.8),
        transitionBand.mul(uTransitionMix),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = aaaColor;
    material.transparent = false;
    material.userData.emitsBloom = true;

    const geometry = makeTube(curve, radius, radialSegments, tubularSegments);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-path-outer-tsl';
    return {
        mesh,
        material,
        geometry,
        chapter,
        uniforms: {
            uTime,
            uProgress,
            uEmission,
            uTransitionColor,
            uTransitionMix,
            uTransitionHead,
            uTransitionWidth,
        },
    };
}

// ── Inner core tube (bright chapter-emissive centre line; bloom-eligible) ─────────

/**
 * Port of OdysseyPathRenderer's inner-core material AAA branch. The core is always
 * bright (uses the chapter emissive colour); a faster pulse + beat term + the
 * transition band mirror the live core fragment shader.
 */
export function createPathCoreTSL(uTime = uniform(0), opts = {}) {
    const chapter = opts.chapter ?? createPathChapterUniforms(opts.chapterPositions);
    const curve = opts.curve ?? defaultPathCurve();
    const radius = (opts.radius
        ?? ODYSSEY_PATH_CROSS_SECTION.outerRadius * ODYSSEY_PATH_CROSS_SECTION.coreScale)
        * gentleWidthScale(opts.widthScale);
    const radialSegments = opts.radialSegments ?? ODYSSEY_PATH_CROSS_SECTION.coreRadialSegments;
    const tubularSegments = opts.tubularSegments ?? ODYSSEY_PATH_CROSS_SECTION.coreTubularSegments;

    const uTransitionColor = opts.uTransitionColor ?? uniform(new THREE.Color(0xffffff));
    const uTransitionMix = opts.uTransitionMix ?? uniform(0);
    const uTransitionHead = opts.uTransitionHead ?? uniform(0.5);
    const uTransitionWidth = opts.uTransitionWidth ?? uniform(0.06);
    const uProgress = opts.uProgress ?? uniform(0);

    const { uBeat } = chapter;

    const vUv = uv();
    const lit = step(vUv.x, uProgress);
    const pulse = sin(vUv.x.mul(30.0).sub(uTime.mul(4.0))).mul(0.2).add(0.8);
    const transitionBand = float(1.0).sub(
        smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
    );

    // Core is always bright, even brighter when lit.
    const intensity = float(0.8).add(lit.mul(pulse).mul(0.5));

    // AAA: bright inner core uses the chapter emissive colour. coreBrightness (1.45,
    // was 2.0) keeps the raw linear core a saturated glow rather than a white blowout.
    const { emisCol } = chapterAt(chapter, vUv.x);
    let finalColor = emisCol.mul(intensity).mul(ODYSSEY_PATH_CROSS_SECTION.coreBrightness)
        .add(emisCol.mul(uBeat).mul(0.3));

    finalColor = mix(
        finalColor,
        uTransitionColor.mul(pulse.add(2.2)),
        transitionBand.mul(uTransitionMix),
    );
    // B4 EMISSIVE CAP (~0.9 display): cap the bright inner core to 1.0 raw linear (ACES →
    // ~0.80 display) so the path's centre line stays a saturated glow, not a white blowout,
    // in every chapter and through the post exposure/bloom swells.
    finalColor = min(finalColor, vec3(1.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.transparent = false;
    material.userData.emitsBloom = true;

    const geometry = makeTube(curve, radius, radialSegments, tubularSegments);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-path-core-tsl';
    return {
        mesh,
        material,
        geometry,
        chapter,
        uniforms: {
            uTime,
            uProgress,
            uTransitionColor,
            uTransitionMix,
            uTransitionHead,
            uTransitionWidth,
        },
    };
}

// ── Additive glow halo tube (per-chapter emissive halo; AdditiveBlending) ─────────

/**
 * Port of OdysseyPathRenderer.createPathGlow's AAA material. Transparent additive
 * halo: alpha = lit * pulse * 0.15 + transitionBand contribution + beat; colour is the
 * chapter emissive tinted toward the transition colour. BackSide + AdditiveBlending +
 * depthWrite off, like the live glow.
 */
export function createPathGlowTSL(uTime = uniform(0), opts = {}) {
    const chapter = opts.chapter ?? createPathChapterUniforms(opts.chapterPositions);
    const curve = opts.curve ?? defaultPathCurve();
    const radius = (opts.radius
        ?? ODYSSEY_PATH_CROSS_SECTION.outerRadius * ODYSSEY_PATH_CROSS_SECTION.coreScale
            * ODYSSEY_PATH_CROSS_SECTION.glowScale)
        * gentleWidthScale(opts.widthScale);
    const radialSegments = opts.radialSegments ?? ODYSSEY_PATH_CROSS_SECTION.glowRadialSegments;
    const tubularSegments = opts.tubularSegments ?? ODYSSEY_PATH_CROSS_SECTION.glowTubularSegments;

    const uTransitionColor = opts.uTransitionColor ?? uniform(new THREE.Color(0xffffff));
    const uTransitionMix = opts.uTransitionMix ?? uniform(0);
    const uTransitionHead = opts.uTransitionHead ?? uniform(0.5);
    const uTransitionWidth = opts.uTransitionWidth ?? uniform(0.1);
    const uProgress = opts.uProgress ?? uniform(0);

    const { uBeat } = chapter;

    const vUv = uv();
    const lit = step(vUv.x, uProgress);
    const pulse = sin(vUv.x.mul(30.0).sub(uTime.mul(3.0))).mul(0.3).add(0.7);
    const transitionBand = float(1.0).sub(
        smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
    );

    // AAA: per-chapter glow halo tinted by the chapter emissive colour. glowAlphaPeak
    // (0.14) keeps the additive halo from stacking into a white bloom over the ribbon.
    //
    // CAMERA-PROXIMITY FADE (creative plan ch7 item 4 — the frame-15 blowout): when the
    // camera sat INSIDE the glow tube, the unfeathered additive volume filled ~35% of
    // frame as a flat banded cone. The glow now fades to zero within a small radius of
    // the lens, so the camera can never clip into unfeathered glow (all chapters).
    const nearClipFade = smoothstep(2.5, 9.0, length(positionWorld.sub(cameraPosition)));
    const { emisCol } = chapterAt(chapter, vUv.x);
    const alpha = clamp(
        lit.mul(pulse).mul(ODYSSEY_PATH_CROSS_SECTION.glowAlphaPeak)
            .add(transitionBand.mul(uTransitionMix).mul(0.25))
            .add(uBeat.mul(0.06).mul(lit)),
        0.0,
        0.5,
    ).mul(nearClipFade);

    const color = mix(emisCol, uTransitionColor, transitionBand.mul(uTransitionMix));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = makeTube(curve, radius, radialSegments, tubularSegments);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-path-glow-tsl';
    return {
        mesh,
        material,
        geometry,
        chapter,
        uniforms: {
            uTime,
            uProgress,
            uTransitionColor,
            uTransitionMix,
            uTransitionHead,
            uTransitionWidth,
        },
    };
}

/**
 * Assemble the three converted tubes on one short demo curve into a THREE.Group + the
 * shared uniforms the caller ticks each frame (uTime + the per-chapter flow/beat/head).
 * Mirrors createDeepOceanPilotTSL / createBlackHoleTranscendencePilotTSL — used by the
 * standalone WebGPU pilot validation page and the graph-construct smoke test.
 * @param {object} [opts]
 */
export function createPathRendererPilotTSL(opts = {}) {
    const uTime = uniform(0);
    const chapter = createPathChapterUniforms(opts.chapterPositions);
    const curve = opts.curve ?? defaultPathCurve();

    const group = new THREE.Group();
    group.name = 'odyssey-path-renderer-pilot-tsl';

    // Let the builders fall through to the ONE locked ODYSSEY_PATH_CROSS_SECTION spec.
    const outer = createPathOuterTSL(uTime, { chapter, curve });
    const core = createPathCoreTSL(uTime, { chapter, curve });
    const glow = createPathGlowTSL(uTime, { chapter, curve });

    group.add(outer.mesh, core.mesh, glow.mesh);

    const parts = [outer, core, glow];

    return {
        group,
        uniforms: {
            uTime,
            uFlow: chapter.uFlow,
            uHead: chapter.uHead,
            uBeat: chapter.uBeat,
        },
        chapter,
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createPathRendererPilotTSL;
