/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey diegetic PATH ribbon — TSL/WebGPU materials + geometry.
 *
 * The ribbon is TWO draws on one Catmull-Rom curve:
 *
 *   - the BODY: an opaque, unlit MeshBasic tube that carries each world's own ribbon — a
 *     half-Lambert-lit surface (per-chapter sun, no lit-material light-set dependency) plus
 *     an emissive surface character in world units, a hot centre line, the lit frontier and
 *     its spark, and
 *   - the HAZE: an additive back-face shell around it — the world's air around the ribbon
 *     (heat, mist, vapour, nebula), not a neon halo.
 *
 * ── ONE RECIPE PER WORLD, CROSSFADED IN ARC LENGTH (2026-10 seamless pass) ─────────────
 * Every chapter's ribbon is the SAME material driven by a row of recipe parameters
 * (ODYSSEY_RIBBON_RECIPES): albedo, emissive, sun direction/colour, fill, feature weights
 * (molten cracks / caustics / drifting grains / streaks / data packets), flow, haze, width.
 * The rows live in uniform arrays; the vertex shader computes a CHAPTER COORDINATE along the
 * arc that ramps smoothly from one row to the next over a window around each boundary (the
 * chapter's own seam width, i.e. the same window the environments crossfade over), and the
 * fragment mixes the two neighbouring rows. So nothing about the ribbon steps at a seam: the
 * old ribbon hard-switched its style at boundary - 0.006 and crossfaded colour over 0.012.
 *
 * ── CENTRE-LINE GEOMETRY ───────────────────────────────────────────────────────────────
 * Both tubes are built from CENTRE-LINE geometry (rings ON the spline, radial direction in
 * `normal`); the radius is applied in the vertex shader so the rail collapses near the lens,
 * holds a pixel floor far away, never exceeds a screen-fraction ceiling and tapers at both
 * ends. See ribbonRadius().
 *
 * ── ARC-LENGTH PATTERNS ────────────────────────────────────────────────────────────────
 * `uv.x` is the arc parameter (0..1 over the whole 2533-u journey). Every feature runs on
 * `s = uv.x * uArc` — world units — sized to 2-8 u, and fades to its mean with distance.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    dot,
    exp,
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
    normalWorld,
    normalize,
    positionLocal,
    positionView,
    pow,
    screenSize,
    sin,
    smoothstep,
    step,
    uniform,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { hash21 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import {
    DEFAULT_ODYSSEY_TRANSITION,
    ODYSSEY_CHAPTER_PROFILES,
    ODYSSEY_WORLD_SUN,
} from './chapter-environments/shared/chapter-profile.js';

const CHAPTER_COUNT = 8;

/**
 * The ribbon's shared cross-section + emission spec.
 *
 *  - outerRadius is the BODY radius before the per-chapter width; the live renderer passes
 *    ODYSSEY_PATH_DATA.radius (0.4). glowScale is the HAZE radius / body radius.
 *  - 1536 lengthwise rings (~1.65 u apart; 256 drew elbows at every tight turn), 8 around.
 *  - minPixels / maxScreenRadius: the body's on-screen floor (px diameter) and ceiling
 *    (radius as a fraction of screen height — a rail, never a pole).
 *  - near fades are world units from the camera; endTaper is world units at each path end.
 *  - minSeamWindow: the narrowest arc window (in p) a recipe crossfade may use.
 */
export const ODYSSEY_PATH_CROSS_SECTION = Object.freeze({
    outerRadius: 0.4,
    glowScale: 2.0,
    radialSegments: 8,
    glowRadialSegments: 6,
    tubularSegments: 1536,
    glowTubularSegments: 768,
    minPixels: 1.2,
    maxScreenRadius: 0.028,
    nearFadeStart: 1.5,
    nearFadeEnd: 6.0,
    glowNearFadeStart: 2.5,
    glowNearFadeEnd: 9.0,
    endTaper: 4.0,
    emission: 1.0,
    minSeamWindow: 0.012,
    // widthScale compression: chapter widthScale s -> 1 + (s-1)*widthScaleBlend.
    widthScaleBlend: 0.35,
});

/**
 * Compress a per-chapter `path.widthScale` toward 1.0 (a gentle nudge on the base radius).
 * @param {number} [widthScale]
 * @returns {number} multiplier near 1.0
 */
export function gentleWidthScale(widthScale = 1) {
    const s = Number.isFinite(widthScale) ? widthScale : 1;
    return 1 + (s - 1) * ODYSSEY_PATH_CROSS_SECTION.widthScaleBlend;
}

/**
 * ONE ribbon recipe per world. Colours are sRGB hex (authored for the display-space grade).
 * Sun direction/colour/intensity and the fill come from each chapter profile's atmosphere —
 * except Act II's surface chapters (3-5), which take ODYSSEY_WORLD_SUN, the sun the One
 * World terrain is actually shaded by, so the ribbon is lit from the same side as the land
 * it lies on. `lit` is how much of the albedo the sun shapes (0 = flat), `core` the hot
 * centre line, the feature weights pick the surface character, `speed` is u/s of flow.
 */
export const ODYSSEY_RIBBON_RECIPES = Object.freeze([
    // 1 — Earth Core: basalt crust, molten cracks, magma pushes travelling to the frontier.
    Object.freeze({
        base: 0x2b1d18,
        lit: 0.85,
        emis: 0xff6a1c,
        gain: 1.0,
        core: 0.25,
        sunGain: 1.4,
        crack: 1.0,
        caustic: 0.0,
        grain: 0.18,
        streak: 0.0,
        packet: 0.0,
        pulse: 0.9,
        scale: 1.0,
        speed: 3.0,
        haze: 0xff5a18,
        hazeAmt: 0.10,
        accent: 0xffb347,
    }),
    // 2 — Deep Ocean: lit from the surface far above, caustic shimmer, drifting plankton.
    Object.freeze({
        base: 0x0f4d62,
        lit: 0.9,
        emis: 0x45dcff,
        gain: 0.8,
        core: 0.2,
        sunGain: 1.0,
        crack: 0.0,
        caustic: 1.0,
        grain: 0.8,
        streak: 0.0,
        packet: 0.0,
        pulse: 0.5,
        scale: 1.0,
        speed: 2.0,
        haze: 0x37d6ff,
        hazeAmt: 0.07,
        accent: 0xb8f4ff,
    }),
    // 3 — Surface World: a sunlit golden thread, silk fibres, floating pollen.
    Object.freeze({
        base: 0x8f7535,
        lit: 1.0,
        emis: 0xffd27a,
        gain: 0.32,
        core: 0.16,
        sunGain: 0.85,
        worldSun: true,
        crack: 0.0,
        caustic: 0.0,
        grain: 0.9,
        streak: 0.35,
        packet: 0.0,
        pulse: 0.45,
        scale: 1.0,
        speed: 1.5,
        haze: 0xffe6a8,
        hazeAmt: 0.05,
        accent: 0xfff0c0,
    }),
    // 4 — Mountains: frosted stone with glinting ice veins.
    Object.freeze({
        base: 0x8b97a6,
        lit: 1.0,
        emis: 0xdaf1ff,
        gain: 0.65,
        core: 0.18,
        sunGain: 1.0,
        worldSun: true,
        crack: 0.8,
        caustic: 0.0,
        grain: 0.6,
        streak: 0.0,
        packet: 0.0,
        pulse: 0.4,
        scale: 1.35,
        speed: 1.0,
        haze: 0xe8f4ff,
        hazeAmt: 0.05,
        accent: 0xffffff,
    }),
    // 5 — Sky & Drift: a white contrail, warm on the sun side, cool on the sky side.
    Object.freeze({
        base: 0xeef2f8,
        lit: 1.0,
        emis: 0xffffff,
        gain: 0.22,
        core: 0.1,
        sunGain: 1.0,
        worldSun: true,
        crack: 0.0,
        caustic: 0.0,
        grain: 0.1,
        streak: 0.8,
        packet: 0.0,
        pulse: 0.3,
        scale: 1.0,
        speed: 3.0,
        haze: 0xffffff,
        hazeAmt: 0.09,
        accent: 0xffffff,
        fill: 0xb4d2ff,
    }),
    // 6 — Space: a luminous stream of stardust flowing toward the black hole. (2026-10-03: it
    // was a near-dark navy tube — base 0x0d1128, core 0.15; the path has to read as a current of
    // light in the dark, warming toward chapter 7's amber.)
    Object.freeze({
        base: 0x1a2148,
        lit: 0.6,
        emis: 0xe4dcff,
        gain: 1.0,
        core: 0.34,
        sunGain: 1.0,
        crack: 0.0,
        caustic: 0.0,
        grain: 1.0,
        streak: 0.25,
        packet: 0.0,
        pulse: 0.35,
        scale: 1.0,
        speed: 2.5,
        haze: 0x9c8cff,
        hazeAmt: 0.10,
        accent: 0xffc88a,
    }),
    // 7 — Black Hole: amber-to-magenta plasma streaking toward the horizon (the disk's amber,
    // not the old hot pink 0x9a2d76).
    Object.freeze({
        base: 0x1c0b12,
        lit: 0.5,
        emis: 0xffb45a,
        gain: 1.0,
        core: 0.35,
        sunGain: 1.2,
        crack: 0.0,
        caustic: 0.0,
        grain: 0.2,
        streak: 1.0,
        packet: 0.0,
        pulse: 0.5,
        scale: 1.0,
        speed: 6.0,
        haze: 0xffa04a,
        hazeAmt: 0.08,
        accent: 0xd0489a,
    }),
    // 8 — Urban Encore: the only true neon — a segmented light-rail carrying data packets.
    Object.freeze({
        base: 0x0a0a1a,
        lit: 0.3,
        emis: 0x18d8ea,
        gain: 1.0,
        core: 0.9,
        sunGain: 0.6,
        crack: 0.0,
        caustic: 0.0,
        grain: 0.0,
        streak: 0.0,
        packet: 1.0,
        pulse: 0.4,
        scale: 1.0,
        speed: 4.0,
        haze: 0x18d8ea,
        hazeAmt: 0.14,
        accent: 0xff4fc0,
    }),
]);

const _scratchColor = new THREE.Color();
function colorVec(hex, gain = 1) {
    _scratchColor.set(hex);
    return new THREE.Vector4(_scratchColor.r * gain, _scratchColor.g * gain, _scratchColor.b * gain, 0);
}

/**
 * Pack the eight recipes into the uniform-array rows the materials read. Pure JS.
 * @returns {Record<string, THREE.Vector4[]>}
 */
export function buildRibbonRecipeRows() {
    const rows = {
        base: [], emis: [], sun: [], sunCol: [], featA: [], featB: [], haze: [], fill: [], accent: [],
    };
    for (let i = 0; i < CHAPTER_COUNT; i += 1) {
        const r = ODYSSEY_RIBBON_RECIPES[i];
        const profile = ODYSSEY_CHAPTER_PROFILES[i] || ODYSSEY_CHAPTER_PROFILES[0];
        const atmo = profile.atmosphere || {};
        const dir = new THREE.Vector3(...(r.worldSun ? ODYSSEY_WORLD_SUN : (atmo.lightDir || [0, 1, 0])))
            .normalize();
        const base = colorVec(r.base); base.w = r.lit;
        const emis = colorVec(r.emis); emis.w = r.gain;
        const sun = new THREE.Vector4(dir.x, dir.y, dir.z, atmo.ambientIntensity ?? 0.4);
        const sunCol = colorVec(atmo.lightColor ?? 0xffffff, (atmo.lightIntensity ?? 1) * r.sunGain);
        sunCol.w = r.core;
        const width = Number.isFinite(profile.path?.widthScale) ? profile.path.widthScale : 1;
        rows.base.push(base);
        rows.emis.push(emis);
        rows.sun.push(sun);
        rows.sunCol.push(sunCol);
        rows.featA.push(new THREE.Vector4(r.crack, r.caustic, r.grain, r.streak));
        rows.featB.push(new THREE.Vector4(r.packet, r.pulse, r.scale, r.speed));
        const haze = colorVec(r.haze); haze.w = r.hazeAmt;
        const fill = colorVec(r.fill ?? atmo.ambientLight ?? 0x404040);
        const accent = colorVec(r.accent); accent.w = width;
        rows.haze.push(haze);
        rows.fill.push(fill);
        rows.accent.push(accent);
    }
    return rows;
}

/**
 * Seam window (in p) for each of the 7 interior boundaries: the source chapter's transition
 * seamWidth — the same half-width the environments crossfade over (±seamWidth).
 * @returns {number[]} length 7
 */
function seamWindows() {
    const out = [];
    for (let k = 0; k < CHAPTER_COUNT - 1; k += 1) {
        const t = ODYSSEY_CHAPTER_PROFILES[k]?.transition || {};
        const w = Number.isFinite(t.seamWidth) ? t.seamWidth : DEFAULT_ODYSSEY_TRANSITION.seamWidth;
        out.push(Math.max(ODYSSEY_PATH_CROSS_SECTION.minSeamWindow, w));
    }
    return out;
}

/**
 * Build the per-chapter uniform set shared by the body + haze materials.
 * @param {number[]} [chapterPositions] 8 chapter starts (+ trailing 1.0)
 * @param {object} [opts]
 * @param {number} [opts.arcLength] total arc length of the curve, world units
 */
export function createPathChapterUniforms(chapterPositions = [], opts = {}) {
    const bounds = chapterPositions.filter((p) => Number.isFinite(p));
    while (bounds.length < 9) bounds.push(1);
    if (bounds[bounds.length - 1] < 1) bounds.push(1);
    const rows = buildRibbonRecipeRows();
    const recipe = {};
    Object.keys(rows).forEach((key) => { recipe[key] = uniformArray(rows[key], 'vec4'); });
    // uniform() must wrap a plain JS value (number / THREE.Color), NOT a TSL node.
    return {
        uBounds: bounds.slice(0, 9).map((b) => uniform(b)),
        uSeamW: seamWindows().map((w) => uniform(w)),
        recipe,
        // World units along the whole curve: uv.x * uArc = distance along the path.
        uArc: uniform(Number.isFinite(opts.arcLength) && opts.arcLength > 0 ? opts.arcLength : 2532.7),
        // Path position of the "current" node — the frontier spark. < 0 → follow uProgress.
        uFocus: uniform(-1),
        uFlow: uniform(0),
        uHead: uniform(0),
        uBeat: uniform(0),
    };
}

// ── Chapter coordinate + recipe lookup ───────────────────────────────────────────

/**
 * Chapter coordinate along the arc: an integer (0..7) inside a chapter, ramping smoothly
 * to the next integer over [b - w, b + w] around each boundary. Vertex stage.
 */
function chapterCoordinate(chapter, x) {
    const { uBounds, uSeamW } = chapter;
    let c = float(0.0);
    for (let k = 0; k < CHAPTER_COUNT - 1; k += 1) {
        const b = uBounds[k + 1];
        const w = uSeamW[k];
        c = c.add(smoothstep(b.sub(w), b.add(w), x));
    }
    return c;
}

/** Mix the two neighbouring recipe rows at chapter coordinate c. */
function recipeAt(chapter, c) {
    const lo = clamp(floor(c), 0.0, CHAPTER_COUNT - 1);
    const f = clamp(c.sub(lo), 0.0, 1.0);
    const i0 = lo.toInt();
    const i1 = min(lo.add(1.0), CHAPTER_COUNT - 1).toInt();
    const row = (arr) => mix(arr.element(i0), arr.element(i1), f);
    const r = chapter.recipe;
    return {
        base: row(r.base),
        emis: row(r.emis),
        sun: row(r.sun),
        sunCol: row(r.sunCol),
        featA: row(r.featA),
        featB: row(r.featB),
        haze: row(r.haze),
        fill: row(r.fill),
        accent: row(r.accent),
    };
}

// ── Seamless value noise around the tube ─────────────────────────────────────────

/**
 * 2D value noise whose lattice WRAPS in y with an integer period, so a pattern laid on
 * (s, uv.y * period) is seamless around the tube.
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

// ── Geometry ─────────────────────────────────────────────────────────────────────

/**
 * A short CatmullRom curve so the builders construct standalone (pilot page, graph test).
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
 * so the winding faces outward once inflated.
 * @param {THREE.Curve} curve arc-length parameterised curve
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

/**
 * CHAPTER THRESHOLDS — folded into the ribbon (they were 8 lit torus rings, each sitting
 * around the first orb of its chapter: every chapter starts ON a level node). Two collars
 * stand proud of the rail at ±COLLAR_OFFSET u either side of each interior boundary — just
 * outside the threshold node's glass at its largest act scale — so the gate frames the node
 * instead of hiding behind it. Returns 0..1 (sum over the 7 boundaries; they never overlap).
 */
const COLLAR_OFFSET = 3.6;
// Crisp light band (fragment) vs. the bulge's wider kernel (vertex): rings are ~1.65 u apart,
// so a bulge as narrow as the band would alias between them.
const COLLAR_HALF_WIDTH = 0.5;
const COLLAR_BULGE_HALF_WIDTH = 0.95;
function thresholdCollars(chapter, s, halfWidth = COLLAR_HALF_WIDTH) {
    const { uBounds, uArc } = chapter;
    let collar = float(0.0);
    for (let k = 1; k < CHAPTER_COUNT; k += 1) {
        const d = abs(s.sub(uBounds[k].mul(uArc))).sub(COLLAR_OFFSET).div(halfWidth);
        collar = collar.add(exp(d.mul(d).negate()));
    }
    return min(collar, 1.0);
}

/** 0..1 breathing at 0.5 Hz (shared with the level nodes' state language). */
function breathe(uTime) {
    return sin(uTime.mul(Math.PI)).mul(0.5).add(0.5);
}

/**
 * Lit-frontier terms shared by body + haze: `lit` (1 on the unlocked stretch), the frontier
 * `fuse` (the last ~10 u running into the current node, breathing), all in world units.
 */
function frontierTerms(s, uProgress, uFocus, uArc, uTime) {
    const sHead = uProgress.mul(uArc);
    // Soft 1.5-u edge instead of a hard step (no stair-step under MSAA-less tiers).
    const lit = float(1.0).sub(smoothstep(sHead.sub(0.75), sHead.add(0.75), s));
    const sFocus = mix(sHead, uFocus.mul(uArc), step(0.0, uFocus));
    const fuse = smoothstep(sFocus.sub(10.0), sFocus.sub(0.5), s)
        .mul(float(1.0).sub(smoothstep(sFocus.sub(0.5), sFocus.add(0.5), s)))
        .mul(breathe(uTime).mul(0.45).add(0.55));
    return { lit, fuse, sHead };
}

// ── Body ───────────────────────────────────────────────────────────────────────────

/**
 * The ribbon BODY. Opaque unlit tube on centre-line geometry, one recipe per world.
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
        uFlow, uBeat, uArc, uFocus,
    } = chapter;

    const vUv = uv();
    // Chapter coordinate, once per vertex; interpolates exactly between ring vertices.
    const vChapter = varying(chapterCoordinate(chapter, vUv.x));

    const positionNode = Fn(() => {
        const width = recipeAt(chapter, chapterCoordinate(chapter, vUv.x)).accent.w
            .mul(thresholdCollars(chapter, vUv.x.mul(uArc), COLLAR_BULGE_HALF_WIDTH).mul(1.5).add(1.0));
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

    const colorNode = Fn(() => {
        const R = recipeAt(chapter, vChapter);
        const s = vUv.x.mul(uArc);
        const v = vUv.y;
        const dView = length(positionView);
        const viewDir = normalize(positionView.negate());
        const ndv = abs(dot(normalize(normalView), viewDir));

        // ── Light: half-Lambert from the world's sun + the world's fill (unlit material,
        // so no dependence on the scene light set). ──
        const N = normalize(normalWorld);
        const ndl = dot(N, normalize(R.sun.xyz));
        const hl = pow(ndl.mul(0.5).add(0.5), 2.0);
        const light = R.fill.rgb.mul(R.sun.w).add(R.sunCol.rgb.mul(hl));
        const albedo = R.base.rgb;
        const body = mix(albedo, albedo.mul(light), R.base.w).toVar();

        // ── Surface character, world units (fades to its mean with distance). ──
        const detail = float(1.0).sub(smoothstep(110.0, 360.0, dView));
        const sc = R.featB.z;
        const speed = R.featB.w;
        const n1 = noise2Wrap(vec2(s.mul(0.32).mul(sc), v.mul(4.0)), float(4.0));
        const n2 = noise2Wrap(vec2(s.mul(0.95).mul(sc).add(13.0), v.mul(8.0)), float(8.0));

        // Molten cracks / ice veins: thin iso-lines of the noise, plus a finer octave.
        const crackLine = float(1.0).sub(smoothstep(0.0, 0.06, abs(n1.sub(0.5))));
        const crackFine = float(1.0).sub(smoothstep(0.0, 0.05, abs(n2.sub(0.5)))).mul(0.5);
        const crack = max(crackLine, crackFine).mul(R.featA.x);
        // Crust plates vary in tone between the cracks.
        body.mulAssign(float(1.0).sub(n1.mul(0.35).mul(R.featA.x)));
        // Magma pushes: brightening waves running toward the frontier (+s).
        const push = smoothstep(0.55, 1.0, sin(s.mul(0.3).sub(uTime.mul(speed).mul(0.3))));

        // Caustics: a drifting light network on the side facing the light.
        const cA = sin(s.mul(1.05).add(n1.mul(4.0)).sub(uTime.mul(1.4)));
        const cB = sin(v.mul(Math.PI * 4).add(s.mul(0.37)).add(uTime.mul(0.9)).add(n2.mul(3.0)));
        const caustic = pow(float(1.0).sub(abs(cA.mul(cB))), 6.0)
            .mul(smoothstep(-0.2, 0.8, ndl))
            .mul(R.featA.y);

        // Drifting grains (plankton / pollen / embers / glints / stardust): round dots on a
        // lattice that slides along the rail.
        const gs = vec2(s.sub(uTime.mul(speed).mul(0.4)).mul(1.7), v.mul(12.0));
        const gCell = floor(gs);
        const gHash = hash21(gCell.add(7.0));
        const gDot = float(1.0).sub(smoothstep(0.12, 0.34, length(fract(gs).sub(0.5))));
        const grain = step(0.86, gHash).mul(gDot)
            .mul(sin(uTime.mul(gHash.mul(3.0).add(2.0)).add(gHash.mul(40.0))).mul(0.5).add(0.5))
            .mul(R.featA.z);

        // Streaks (contrail turbulence / plasma / silk fibres): noise stretched along s.
        const st1 = noise2Wrap(vec2(s.mul(0.06).mul(sc).sub(uTime.mul(speed).mul(0.05)), v.mul(4.0)), float(4.0));
        const st2 = noise2Wrap(
            vec2(s.mul(0.15).mul(sc).sub(uTime.mul(speed).mul(0.11)), v.mul(8.0).add(3.0)),
            float(8.0),
        );
        const streak = smoothstep(0.42, 0.85, st1.mul(0.6).add(st2.mul(0.4))).mul(R.featA.w);

        // Data packets on a segmented light-rail.
        const segGap = step(0.1, fract(s.div(2.4)));
        const pk = fract(s.div(11.0).sub(uTime.mul(speed).div(11.0)));
        const packet = smoothstep(0.0, 0.04, pk).mul(float(1.0).sub(smoothstep(0.08, 0.14, pk))).mul(R.featB.x);

        // Lit frontier + spark.
        const { lit, fuse, sHead } = frontierTerms(s, uProgress, uFocus, uArc, uTime);
        const dormant = mix(float(0.3), float(1.0), lit);
        // Flow pulses travelling toward the head on the unlocked stretch.
        const pulse = smoothstep(0.82, 1.0, sin(s.sub(sHead).mul(0.35).sub(uTime.mul(uFlow.mul(3.0).add(2.0)))))
            .mul(R.featB.y).mul(lit);

        // Streak tint runs from the emissive toward the accent (ch7 amber → magenta).
        const streakCol = mix(R.emis.rgb, R.accent.rgb, st2);
        body.assign(mix(body, body.mul(0.72).add(streakCol.mul(0.45)), streak.mul(detail)));
        // Neon rail: dark gaps between segments.
        body.mulAssign(mix(float(1.0), segGap.mul(0.85).add(0.15), R.featB.x));

        const hot = R.emis.rgb.mul(R.emis.w);
        const features = crack.mul(push.mul(1.2).add(1.0))
            .add(caustic.mul(0.9))
            .add(grain.mul(1.4))
            .add(packet.mul(1.6));
        // Distance mean of the features, so the far ribbon keeps the same average glow.
        const featureMean = R.featA.x.mul(0.12).add(R.featA.y.mul(0.12)).add(R.featA.z.mul(0.04))
            .add(R.featB.x.mul(0.1));
        const centre = pow(ndv, 6.0).mul(R.sunCol.w).mul(lit.mul(0.6).add(0.4))
            .mul(mix(float(1.0), segGap, R.featB.x));
        const emissive = hot.mul(
            mix(featureMean, features, detail).mul(dormant)
                .add(centre)
                .add(pulse.mul(0.5))
                .add(uBeat.mul(0.12).mul(lit)),
        )
            .add(mix(hot, vec3(1.0), 0.35).mul(fuse).mul(0.9))
            // Packets read in the accent (magenta data on the cyan rail).
            .add(R.accent.rgb.mul(packet).mul(0.5).mul(detail).mul(dormant));

        // The world's air at the silhouette — the ribbon's edge melts into its atmosphere.
        const rim = pow(float(1.0).sub(ndv), 2.0);
        let color = body.add(emissive).add(R.haze.rgb.mul(rim).mul(R.haze.w).mul(3.0));
        color = color.mul(uEmission);
        // Hue-preserving cap: scale by the brightest channel (a per-channel clamp turns an
        // ember orange yellow and a glare olive) so the ribbon never clips to white.
        color = color.div(max(max(max(color.r, color.g), color.b), 1.0));

        // Threshold collars: a steady glow in the blend of both worlds' light, swelling as
        // the camera crosses (the seam envelope is POSITION-driven, so this never pops). The
        // crossing band touches ONLY the collars — it used to tint the whole visible ribbon
        // toward the incoming colour for 850 ms of wall clock at every boundary.
        const collar = thresholdCollars(chapter, s);
        const transitionBand = float(1.0).sub(
            smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
        );
        const collarGlow = collar.mul(transitionBand.mul(uTransitionMix).mul(0.25).add(0.75));
        const collarCol = mix(
            mix(R.emis.rgb, vec3(1.0), 0.35),
            uTransitionColor,
            transitionBand.mul(uTransitionMix).mul(0.4),
        );
        const withCollar = mix(color, collarCol, collarGlow.mul(0.85));
        return withCollar.div(max(max(max(withCollar.r, withCollar.g), withCollar.b), 1.0));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
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
 * The additive back-face HAZE around the body (AdditiveBlending, depthWrite off): each
 * world's air around the ribbon — heat over the lava, mist in the sea, vapour in the sky,
 * nebula in space, the neon bloom of the city. Radius = body * glowScale, no pixel floor,
 * faded near the lens (smoothstep(2.5, 9, d)) and with distance.
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

    const { uBeat, uArc, uFocus } = chapter;

    const vUv = uv();
    const vChapter = varying(chapterCoordinate(chapter, vUv.x));

    const positionNode = Fn(() => {
        const width = recipeAt(chapter, chapterCoordinate(chapter, vUv.x)).accent.w;
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

    // Haze colour + strength (pure expressions per slot — colour and opacity are separate
    // graphs; see the glass-shell note in level-node-manager.tsl.js).
    const hazeTerms = () => {
        const R = recipeAt(chapter, vChapter);
        const s = vUv.x.mul(uArc);
        const { lit, fuse } = frontierTerms(s, uProgress, uFocus, uArc, uTime);
        const dView = length(positionView);
        // Soft radial profile: back faces seen head-on (centre of the halo) are densest.
        const soft = pow(abs(dot(normalize(normalView), normalize(positionView.negate()))), 1.5);
        const nearFade = smoothstep(
            ODYSSEY_PATH_CROSS_SECTION.glowNearFadeStart,
            ODYSSEY_PATH_CROSS_SECTION.glowNearFadeEnd,
            dView,
        );
        const farFade = float(1.0).sub(smoothstep(160.0, 600.0, dView));
        // A slow drift in the air (heat shimmer / mist) along the rail.
        const drift = sin(s.mul(0.45).sub(uTime.mul(1.6))).mul(0.25).add(0.75);
        const transitionBand = float(1.0).sub(
            smoothstep(0.0, uTransitionWidth, abs(vUv.x.sub(uTransitionHead))),
        );
        const collar = thresholdCollars(chapter, s);
        const alpha = clamp(
            R.haze.w.mul(drift).mul(lit.mul(0.6).add(0.4))
                .add(fuse.mul(0.22))
                .add(collar.mul(transitionBand.mul(uTransitionMix).mul(0.25).add(0.08)))
                .add(uBeat.mul(0.04).mul(lit)),
            0.0,
            0.5,
        ).mul(nearFade).mul(farFade).mul(soft);
        const color = mix(
            mix(R.haze.rgb, R.emis.rgb, max(fuse, collar.mul(0.6))),
            uTransitionColor,
            transitionBand.mul(uTransitionMix).mul(collar),
        );
        return { color, alpha };
    };

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = Fn(() => hazeTerms().color)();
    material.opacityNode = Fn(() => hazeTerms().alpha)();
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
