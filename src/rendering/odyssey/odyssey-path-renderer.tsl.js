/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey diegetic PATH ribbon — TSL/WebGPU materials + geometry.
 *
 * The ribbon is TWO draws on one Catmull-Rom curve:
 *
 *   - the BODY: an opaque, unlit MeshBasic tube whose surface carries the per-chapter
 *     character (colour + a world-unit surface pattern + flow + the hot centre line that
 *     used to be a separate, never-visible core tube), and
 *   - the HAZE: an additive back-face shell around it (the soft halo / the world's air
 *     around the ribbon).
 *
 * ── CENTRE-LINE GEOMETRY (2026-10 seamless pass) ──────────────────────────────────────
 * Both tubes are built from a CENTRE-LINE geometry: every ring of vertices sits ON the
 * spline (position) with its radial direction in `normal`; the radius is applied in the
 * vertex shader. That is what lets the ribbon behave like a thing in the world instead of a
 * plastic pipe at every distance:
 *
 *   - NEAR the lens the radius collapses (smoothstep(1.5, 6, d)): the rail used to pass
 *     0.6-1.3 u from the camera at the 4->5 and 7->8 seams and fill a third of the frame as
 *     a pole / wedge / slab (the 7->8 capture was a 36->100->38 luma flash).
 *   - FAR away it never drops below ~1.2 px wide, so a distant stretch reads as a steady
 *     line instead of a shimmering sub-pixel hairline.
 *   - Both ENDS taper to a point instead of showing a cut tube end to the camera (ch8).
 *
 * ── ARC-LENGTH PATTERNS ────────────────────────────────────────────────────────────────
 * `uv.x` is the arc-length parameter in 0..1 over the WHOLE 2533-u journey. The old
 * patterns used it as if it were world units, so a lava crack was 42 u long, a caustic 66,
 * a ley dash 97 and a flow pulse ~290: far too large to read as surface, which is why every
 * chapter's ribbon looked like flat neon plastic. Every pattern now runs on
 * `s = uv.x * uArc` (world units along the path) and an around-the-tube coordinate in world
 * units, tuned to 2-8 u features, and fades to its mean with distance so it cannot alias.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    mod,
    modelWorldMatrix,
    normalLocal,
    normalView,
    normalize,
    positionLocal,
    positionView,
    pow,
    screenSize,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { hash21 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import {
    ODYSSEY_CHAPTER_PROFILES,
    ODYSSEY_PATH_STYLES,
} from './chapter-environments/shared/chapter-profile.js';

// Map each path style to a shader style index.
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
 * The ribbon's shared cross-section + emission spec.
 *
 *  - outerRadius is the BODY radius before the per-chapter widthScale; the live renderer
 *    passes ODYSSEY_PATH_DATA.radius (0.4). glowScale is the HAZE radius / body radius.
 *  - radialSegments / tubularSegments are the live tessellation. 1536 lengthwise segments
 *    put a ring every ~1.65 u (it was 256 = 9.9 u, which drew visible elbows at every tight
 *    turn: ch1 shot 1, ch7 shots 2/4, ch8 shots 2/4). 8 around is enough for a tube that is
 *    a few pixels wide almost everywhere and is never allowed near the lens.
 *  - minPixels: the far-field floor on the body's on-screen diameter.
 *  - near / far fades are in world units from the camera.
 *  - emission / flowGlowPeak / edgeGlowPeak / coreBrightness keep the raw linear emissive
 *    sane (<= ~1.0 at peak) so the post tonemap lands on a saturated glow, not white.
 */
export const ODYSSEY_PATH_CROSS_SECTION = Object.freeze({
    outerRadius: 0.4,
    glowScale: 2.0,
    radialSegments: 8,
    glowRadialSegments: 6,
    tubularSegments: 1536,
    glowTubularSegments: 768,
    minPixels: 1.2,
    // ...and a CEILING: the body's on-screen radius never exceeds this fraction of the
    // screen height (~20 px at 720p), so wherever the rail passes the camera it reads as a
    // rail, never as a pole. Ribbons further than ~14 u away are untouched by it.
    maxScreenRadius: 0.028,
    nearFadeStart: 1.5,
    nearFadeEnd: 6.0,
    glowNearFadeStart: 2.5,
    glowNearFadeEnd: 9.0,
    endTaper: 4.0,
    emission: 1.0,
    flowGlowPeak: 0.16,
    edgeGlowPeak: 0.72,
    coreBrightness: 0.55,
    glowAlphaPeak: 0.09,
    // widthScale compression: chapter widthScale s -> 1 + (s-1)*widthScaleBlend.
    widthScaleBlend: 0.35,
});

/**
 * Compress a per-chapter `path.widthScale` toward 1.0 so it is only a gentle nudge on
 * the locked base radius.
 * @param {number} [widthScale]
 * @returns {number} multiplier near 1.0
 */
export function gentleWidthScale(widthScale = 1) {
    const s = Number.isFinite(widthScale) ? widthScale : 1;
    return 1 + (s - 1) * ODYSSEY_PATH_CROSS_SECTION.widthScaleBlend;
}

/**
 * Default per-chapter base/emissive/style/width/bounds from ODYSSEY_CHAPTER_PROFILES.
 * @param {number[]} [chapterPositions] optional 8 chapter-start positions
 */
function buildChapterDefaults(chapterPositions = []) {
    const bounds = chapterPositions.filter((p) => Number.isFinite(p));
    while (bounds.length < 9) bounds.push(1);
    if (bounds[bounds.length - 1] < 1) bounds.push(1);

    const base = [];
    const emissive = [];
    const style = [];
    const width = [];
    for (let i = 0; i < CHAPTER_COUNT; i += 1) {
        const profile = ODYSSEY_CHAPTER_PROFILES[i] || ODYSSEY_CHAPTER_PROFILES[0];
        base.push(new THREE.Color(profile.path.baseColor));
        emissive.push(new THREE.Color(profile.path.emissiveColor));
        style.push(PATH_STYLE_INDEX[profile.path.style] ?? 0);
        width.push(Number.isFinite(profile.path.widthScale) ? profile.path.widthScale : 1);
    }
    return {
        bounds: bounds.slice(0, 9), base, emissive, style, width,
    };
}

/**
 * Build the per-chapter uniform set shared by the body + haze materials.
 * @param {number[]} [chapterPositions]
 * @param {object} [opts]
 * @param {number} [opts.arcLength] total arc length of the curve, world units
 */
export function createPathChapterUniforms(chapterPositions = [], opts = {}) {
    const defaults = buildChapterDefaults(chapterPositions);
    // uniform() must wrap a plain JS value (number / THREE.Color), NOT a TSL node —
    // wrapping a float() node yields an un-named uniform ("Uniform null not declared").
    const uBounds = defaults.bounds.map((b) => uniform(b));
    const uBase = defaults.base.map((c) => uniform(c));
    const uEmissive = defaults.emissive.map((c) => uniform(c));
    const uStyle = defaults.style.map((s) => uniform(s));
    const uWidth = defaults.width.map((w) => uniform(w));
    return {
        uBounds,
        uBase,
        uEmissive,
        uStyle,
        uWidth,
        // World units along the whole curve: uv.x * uArc = distance along the path.
        uArc: uniform(Number.isFinite(opts.arcLength) && opts.arcLength > 0 ? opts.arcLength : 2532.7),
        uFlow: uniform(0),
        uHead: uniform(0),
        uBeat: uniform(0),
    };
}

// ── chapterAt() — per-chapter colour/style lookup along uv.x ───────────────────────

/**
 * Forward seam-crossfade along the arc parameter: a `smoothstep(b-seam, b, x)` crossfade
 * at every interior boundary. styleId switches at the seam midpoint.
 * @returns {{ baseCol, emisCol, styleId, width }} TSL nodes
 */
function chapterAt(chapter, x) {
    const {
        uBounds, uBase, uEmissive, uStyle, uWidth,
    } = chapter;

    let baseCol = uBase[0];
    let emisCol = uEmissive[0];
    let styleId = uStyle[0];
    let width = uWidth ? uWidth[0] : float(1);

    for (let i = 0; i < CHAPTER_COUNT - 1; i += 1) {
        const hi = uBounds[i + 1];
        const t = smoothstep(hi.sub(SEAM), hi, x);
        baseCol = mix(baseCol, uBase[i + 1], t);
        emisCol = mix(emisCol, uEmissive[i + 1], t);
        styleId = mix(styleId, uStyle[i + 1], step(0.5, t));
        if (uWidth) width = mix(width, uWidth[i + 1], t);
    }

    return {
        baseCol, emisCol, styleId, width,
    };
}

// ── Seamless value noise around the tube ─────────────────────────────────────────

/**
 * 2D value noise whose lattice WRAPS in y with an integer period, so a pattern laid on
 * (s, uv.y * period) is seamless around the tube (the plain noise2 left a hard seam line
 * down the tube where uv.y jumps 1 -> 0).
 */
const noise2Wrap = /* @__PURE__ */ Fn(([pIn, period]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const y0 = mod(i.y, period);
    const y1 = mod(i.y.add(1.0), period);
    const a = hash21(vec2(i.x, y0));
    const b = hash21(vec2(i.x.add(1.0), y0));
    const c = hash21(vec2(i.x, y1));
    const d = hash21(vec2(i.x.add(1.0), y1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({
    name: 'odp_noise2wrap',
    type: 'float',
    inputs: [{ name: 'pIn', type: 'vec2' }, { name: 'period', type: 'float' }],
});

// ── stylePattern() — eight per-world surface characters, in WORLD UNITS ───────────

/**
 * The eight per-world surface patterns, laid on `s` (world units along the path) and
 * `v` (0..1 around the tube). Feature sizes are 2-8 u. Selected by styleId via the same
 * `step(n, styleId + 0.5)` ladder as before.
 */
function stylePattern(styleId, s, v, t) {
    const sel = styleId.add(0.5);
    // Around-the-tube lattice: 4 cells around (~0.6 u each on a 0.4-radius tube).
    const AROUND = 4.0;
    const va = v.mul(AROUND);

    // 0 — lavaCrust: cracked molten cells (~4 u crust plates, thin bright seams).
    const n0 = noise2Wrap(vec2(s.mul(0.28), va), float(AROUND));
    const cracks = smoothstep(0.44, 0.5, n0).sub(smoothstep(0.5, 0.56, n0));
    const lava = float(0.7)
        .add(cracks.mul(2.4))
        .add(noise2Wrap(vec2(s.mul(0.9), va.mul(2.0)), float(AROUND * 2)).mul(0.2));

    // 1 — causticCurrent: flowing caustic stripes (~5 u).
    const c = sin(s.mul(1.25).sub(t.mul(2.0))).mul(sin(v.mul(Math.PI * 2 * 2).add(t.mul(0.7))));
    const caustic = float(0.8).add(c.mul(c).mul(0.7));

    // 2 — leyLine: travelling dashes (6 u period).
    const d = fract(s.div(6.0).sub(t.mul(0.4)));
    const dash = smoothstep(0.0, 0.12, d).mul(smoothstep(0.55, 0.4, d));
    const ley = float(0.6).add(dash.mul(1.3));

    // 3 — cairnRidge: stone with bright veins (~3 u).
    const vn = smoothstep(0.47, 0.5, noise2Wrap(vec2(s.mul(0.33), va), float(AROUND)));
    const cairn = float(0.65).add(vn.mul(1.4));

    // 4 — jetStream: wind streaks along the length (~8 u).
    const st = sin(s.mul(0.78).add(v.mul(Math.PI * 2)).sub(t.mul(3.0))).mul(0.5).add(0.5);
    const jet = float(0.7).add(st.mul(0.7));

    // 5 — stellarStream: sparkle river (0.6 u cells).
    const sp = hash21(floor(vec2(s.mul(1.6), va.mul(2.0))).add(floor(t.mul(4.0))));
    const stellar = float(0.7).add(step(0.93, sp).mul(2.2));

    // 6 — horizonFilament: lensing streaks (~7 u).
    const l = sin(s.mul(0.9).sub(t.mul(4.0))).mul(0.5).add(0.5);
    const horizon = float(0.7).add(pow(l, 3.0).mul(1.1));

    // 7 — neonDataLine: scanline data segments (3 u).
    const sc = step(0.5, fract(s.div(3.0).sub(t.mul(1.4))));
    const neon = float(0.6).add(sc.mul(0.85));

    let pat = lava;
    pat = mix(pat, caustic, step(1.0, sel));
    pat = mix(pat, ley, step(2.0, sel));
    pat = mix(pat, cairn, step(3.0, sel));
    pat = mix(pat, jet, step(4.0, sel));
    pat = mix(pat, stellar, step(5.0, sel));
    pat = mix(pat, horizon, step(6.0, sel));
    pat = mix(pat, neon, step(7.0, sel));
    return pat;
}

// ── Geometry ─────────────────────────────────────────────────────────────────────

/**
 * A short straight-ish CatmullRom curve so the builders construct standalone (pilot page,
 * graph-construct test) without the live odyssey layout.
 */
function defaultPathCurve() {
    return new THREE.CatmullRomCurve3([
        new THREE.Vector3(-20, -10, 0),
        new THREE.Vector3(-6, -2, 4),
        new THREE.Vector3(6, 4, -4),
        new THREE.Vector3(20, 12, 0),
    ]);
}

/**
 * CENTRE-LINE tube geometry: each ring's vertices sit on the curve at arc parameter
 * t = i/segments (uv.x), with the unit radial direction in `normal` and uv.y = 0..1 around.
 * The materials apply the radius in their positionNode. Indexed exactly like a TubeGeometry
 * so the triangle winding faces outward once inflated.
 * @param {THREE.Curve} curve arc-length parameterised curve (getPointAt / computeFrenetFrames)
 * @param {number} tubularSegments
 * @param {number} radialSegments
 * @returns {THREE.BufferGeometry}
 */
export function createPathCentreLineGeometry(curve, tubularSegments = 256, radialSegments = 8) {
    const segments = Math.max(2, Math.floor(tubularSegments));
    const sides = Math.max(3, Math.floor(radialSegments));
    const vertexCount = (segments + 1) * (sides + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(segments * sides * 6);
    const frames = curve.computeFrenetFrames(segments, false);
    const point = new THREE.Vector3();
    const radial = new THREE.Vector3();

    for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        curve.getPointAt(t, point);
        for (let j = 0; j <= sides; j += 1) {
            const v = j / sides;
            const angle = v * Math.PI * 2;
            radial.copy(frames.normals[i]).multiplyScalar(Math.cos(angle));
            radial.addScaledVector(frames.binormals[i], Math.sin(angle)).normalize();
            const vertexIndex = i * (sides + 1) + j;
            const p3 = vertexIndex * 3;
            positions[p3] = point.x;
            positions[p3 + 1] = point.y;
            positions[p3 + 2] = point.z;
            normals[p3] = radial.x;
            normals[p3 + 1] = radial.y;
            normals[p3 + 2] = radial.z;
            uvs[vertexIndex * 2] = t;
            uvs[vertexIndex * 2 + 1] = v;
        }
    }

    let k = 0;
    for (let i = 0; i < segments; i += 1) {
        for (let j = 0; j < sides; j += 1) {
            const a = i * (sides + 1) + j;
            const b = (i + 1) * (sides + 1) + j;
            const c = (i + 1) * (sides + 1) + j + 1;
            const d = i * (sides + 1) + j + 1;
            indices[k] = a; indices[k + 1] = b; indices[k + 2] = d;
            indices[k + 3] = b; indices[k + 4] = c; indices[k + 5] = d;
            k += 6;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    // The inflated tube is at most a couple of units wider than the centre line.
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 4;
    return geometry;
}

// ── Shared vertex-stage radius ───────────────────────────────────────────────────

/**
 * World-space radius for a centre-line vertex: base * chapter width, held between a
 * `minPixels` floor and a `maxScreen` ceiling (fraction of screen height), collapsed near
 * the lens, tapered at both path ends.
 * MUST be called inside a positionNode (positionLocal = the centre-line point there).
 */
function ribbonRadius({
    baseRadius, width, arc, minPixels, maxScreen, nearStart, nearEnd, taper,
}) {
    const centreWorld = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
    const dCam = length(centreWorld.sub(cameraPosition));
    // The screen spans 2 d tan(fov/2) = 2 d / P11 world units vertically at distance d.
    const p11 = cameraProjectionMatrix.element(1).y;
    const screenSpan = dCam.mul(2.0).div(p11);
    const pixelRadius = screenSpan.mul(minPixels).mul(0.5).div(max(screenSize.y, 1.0));
    const maxRadius = screenSpan.mul(maxScreen);
    const r = min(max(baseRadius.mul(width), pixelRadius), max(maxRadius, pixelRadius));
    // Squared so the last few units before the lens collapse to nothing rather than
    // streaking across the frame as a thinning wedge (7->8 capture at p 0.9649).
    const near = smoothstep(nearStart, nearEnd, dCam);
    const s = uv().x.mul(arc);
    const ends = smoothstep(0.0, taper, s).mul(smoothstep(0.0, taper, arc.sub(s)));
    return r.mul(near).mul(near).mul(ends);
}

// `1.0 - step(edge, x)` — the `(1.0 - step(uProgress, vUv.x))` edge mask.
function oneMinusStep(edge, x) {
    return float(1.0).sub(step(edge, x));
}

// ── Body (per-chapter diegetic surface + folded hot centre line) ──────────────────

/**
 * The ribbon BODY. Opaque unlit tube on centre-line geometry.
 * @param {object} uTime shared time uniform (uniform(0))
 * @param {object} [opts]
 */
export function createPathOuterTSL(uTime = uniform(0), opts = {}) {
    const curve = opts.curve ?? defaultPathCurve();
    const chapter = opts.chapter ?? createPathChapterUniforms(opts.chapterPositions, {
        arcLength: curve.getLength(),
    });
    const geometry = opts.geometry ?? createPathCentreLineGeometry(
        curve,
        opts.tubularSegments ?? 160,
        opts.radialSegments ?? ODYSSEY_PATH_CROSS_SECTION.radialSegments,
    );

    const uEmission = opts.uEmission ?? uniform(ODYSSEY_PATH_CROSS_SECTION.emission);
    const uRadius = opts.uRadius ?? uniform(opts.radius ?? ODYSSEY_PATH_CROSS_SECTION.outerRadius);
    const uMinPixels = opts.uMinPixels ?? uniform(ODYSSEY_PATH_CROSS_SECTION.minPixels);
    const uTransitionColor = opts.uTransitionColor ?? uniform(new THREE.Color(0xffffff));
    const uTransitionMix = opts.uTransitionMix ?? uniform(0);
    const uTransitionHead = opts.uTransitionHead ?? uniform(0.5);
    const uTransitionWidth = opts.uTransitionWidth ?? uniform(0.08);
    const uProgress = opts.uProgress ?? uniform(0);

    const {
        uFlow, uHead, uBeat, uArc,
    } = chapter;

    const vUv = uv();
    const { width } = chapterAt(chapter, vUv.x);

    const positionNode = Fn(() => {
        const r = ribbonRadius({
            baseRadius: uRadius,
            width,
            arc: uArc,
            minPixels: uMinPixels,
            maxScreen: float(ODYSSEY_PATH_CROSS_SECTION.maxScreenRadius),
            nearStart: float(ODYSSEY_PATH_CROSS_SECTION.nearFadeStart),
            nearEnd: float(ODYSSEY_PATH_CROSS_SECTION.nearFadeEnd),
            taper: float(ODYSSEY_PATH_CROSS_SECTION.endTaper),
        });
        return positionLocal.add(normalLocal.mul(r));
    })();

    // World units along the path (s) and the camera distance (pattern LOD).
    const s = vUv.x.mul(uArc);
    const dView = length(positionView);
    const viewDir = normalize(positionView.negate());
    const ndv = abs(dot(normalize(normalView), viewDir));

    // Progress illumination / leading-edge glow (the last ~8 u before the frontier) / rim.
    const lit = step(vUv.x, uProgress);
    const sHead = uProgress.mul(uArc);
    const edgeGlow = smoothstep(sHead.sub(8.0), sHead, s)
        .mul(oneMinusStep(uProgress, vUv.x));
    const rim = pow(float(1.0).sub(ndv), 1.5);

    const transitionBand = float(1.0).sub(
        smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
    );

    const { baseCol, emisCol, styleId } = chapterAt(chapter, vUv.x);
    // Surface pattern, faded to its mean (1.0) with distance so it can never alias.
    const patLod = smoothstep(90.0, 320.0, dView);
    const pat = mix(stylePattern(styleId, s, vUv.y, uTime), float(1.0), patLod);

    // Flow pulse travelling toward the head (player progress), ~16 u wavelength.
    const flow = sin(s.sub(uHead.mul(uArc)).mul(0.4).sub(uTime.mul(uFlow.mul(3.0).add(2.0))));
    const flowGlow = smoothstep(0.2, 1.0, flow)
        .mul(ODYSSEY_PATH_CROSS_SECTION.flowGlowPeak)
        .mul(lit)
        .mul(float(1.0).sub(patLod));

    let color = mix(
        baseCol.mul(0.5),
        mix(baseCol, emisCol, 0.65).mul(pat),
        max(lit, 0.4),
    );
    const emisGain = clamp(
        rim.mul(0.5).add(flowGlow).add(uBeat.mul(0.18)).add(edgeGlow.mul(ODYSSEY_PATH_CROSS_SECTION.edgeGlowPeak)),
        0.0,
        1.0,
    );
    color = color.add(emisCol.mul(emisGain));

    // HOT CENTRE LINE — folded in from the old core tube (which sat entirely inside this
    // opaque tube and was never visible: one wasted draw + pipeline). The camera-facing
    // middle of the tube carries the chapter emissive, brighter on the lit stretch.
    const coreLine = pow(ndv, 6.0).mul(float(0.45).add(lit.mul(0.55)));
    color = color.add(emisCol.mul(coreLine).mul(ODYSSEY_PATH_CROSS_SECTION.coreBrightness));

    // Ch5 (Sky) two-tone sun/aurora rim — ch5-gated, additive.
    const ch5Gate = step(3.5, styleId).mul(oneMinusStep(styleId, 4.5));
    const sunSide = smoothstep(0.42, 0.62, vUv.y);
    const twoToneRim = pow(float(1.0).sub(ndv), 2.2);
    const ch5RimTint = mix(vec3(0.36, 0.92, 1.0), vec3(1.0, 0.78, 0.46), sunSide);
    color = color.add(ch5RimTint.mul(twoToneRim).mul(0.28).mul(ch5Gate));

    color = color.mul(uEmission);
    // EMISSIVE CAP: the path is in every frame — cap the raw linear emissive to 1.0 so the
    // brightest ribbon pixel stays a saturated glow through exposure/bloom swells.
    color = min(color, vec3(1.0));
    color = mix(
        color,
        mix(color, uTransitionColor.mul(pat.add(1.4)), 0.8),
        transitionBand.mul(uTransitionMix),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.transparent = false;
    material.userData.emitsBloom = true;

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
            uRadius,
            uMinPixels,
            uTransitionColor,
            uTransitionMix,
            uTransitionHead,
            uTransitionWidth,
        },
    };
}

// ── Additive haze shell ────────────────────────────────────────────────────────────

/**
 * The additive back-face HAZE around the body (AdditiveBlending, depthWrite off). Same
 * centre-line geometry; radius = body radius * glowScale, no pixel floor, faded near the
 * lens (smoothstep(2.5, 9, d) — the creative-plan ch7 frame-15 blowout) and with distance.
 */
export function createPathGlowTSL(uTime = uniform(0), opts = {}) {
    const curve = opts.curve ?? defaultPathCurve();
    const chapter = opts.chapter ?? createPathChapterUniforms(opts.chapterPositions, {
        arcLength: curve.getLength(),
    });
    const geometry = opts.geometry ?? createPathCentreLineGeometry(
        curve,
        opts.tubularSegments ?? 96,
        opts.radialSegments ?? ODYSSEY_PATH_CROSS_SECTION.glowRadialSegments,
    );

    const uRadius = opts.uRadius ?? uniform(
        (opts.radius ?? ODYSSEY_PATH_CROSS_SECTION.outerRadius) * ODYSSEY_PATH_CROSS_SECTION.glowScale,
    );
    const uTransitionColor = opts.uTransitionColor ?? uniform(new THREE.Color(0xffffff));
    const uTransitionMix = opts.uTransitionMix ?? uniform(0);
    const uTransitionHead = opts.uTransitionHead ?? uniform(0.5);
    const uTransitionWidth = opts.uTransitionWidth ?? uniform(0.1);
    const uProgress = opts.uProgress ?? uniform(0);

    const { uBeat, uArc } = chapter;

    const vUv = uv();
    const { width, emisCol } = chapterAt(chapter, vUv.x);

    const positionNode = Fn(() => {
        const r = ribbonRadius({
            baseRadius: uRadius,
            width,
            arc: uArc,
            minPixels: float(0.0),
            maxScreen: float(ODYSSEY_PATH_CROSS_SECTION.maxScreenRadius * ODYSSEY_PATH_CROSS_SECTION.glowScale),
            nearStart: float(ODYSSEY_PATH_CROSS_SECTION.glowNearFadeStart),
            nearEnd: float(ODYSSEY_PATH_CROSS_SECTION.glowNearFadeEnd),
            taper: float(ODYSSEY_PATH_CROSS_SECTION.endTaper * 2.0),
        });
        return positionLocal.add(normalLocal.mul(r));
    })();

    const s = vUv.x.mul(uArc);
    const lit = step(vUv.x, uProgress);
    const pulse = sin(s.mul(0.5).sub(uTime.mul(3.0))).mul(0.3).add(0.7);
    const transitionBand = float(1.0).sub(
        smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
    );

    const dView = length(positionView);
    // Soft radial profile: back faces seen head-on (centre of the halo) are densest.
    const viewDir = normalize(positionView.negate());
    const soft = pow(abs(dot(normalize(normalView), viewDir)), 1.5);
    const nearFade = varying(smoothstep(
        ODYSSEY_PATH_CROSS_SECTION.glowNearFadeStart,
        ODYSSEY_PATH_CROSS_SECTION.glowNearFadeEnd,
        dView,
    ));
    const farFade = float(1.0).sub(smoothstep(160.0, 600.0, dView));
    const alpha = clamp(
        lit.mul(pulse).mul(ODYSSEY_PATH_CROSS_SECTION.glowAlphaPeak)
            .add(transitionBand.mul(uTransitionMix).mul(0.25))
            .add(uBeat.mul(0.06).mul(lit)),
        0.0,
        0.5,
    ).mul(nearFade).mul(farFade).mul(soft);

    const color = mix(emisCol, uTransitionColor, transitionBand.mul(uTransitionMix));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

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
            uRadius,
            uTransitionColor,
            uTransitionMix,
            uTransitionHead,
            uTransitionWidth,
        },
    };
}

/**
 * Assemble the body + haze on one short demo curve into a THREE.Group + the shared
 * uniforms the caller ticks each frame. Used by the standalone WebGPU pilot page and the
 * graph-construct smoke test.
 * @param {object} [opts]
 */
export function createPathRendererPilotTSL(opts = {}) {
    const uTime = uniform(0);
    const curve = opts.curve ?? defaultPathCurve();
    const chapter = createPathChapterUniforms(opts.chapterPositions, { arcLength: curve.getLength() });

    const group = new THREE.Group();
    group.name = 'odyssey-path-renderer-pilot-tsl';

    const outer = createPathOuterTSL(uTime, { chapter, curve });
    const glow = createPathGlowTSL(uTime, { chapter, curve });

    group.add(outer.mesh, glow.mesh);

    const parts = [outer, glow];

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
