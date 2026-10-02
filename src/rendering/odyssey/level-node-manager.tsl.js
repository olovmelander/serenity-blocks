/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Level-node manager materials — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — final batch). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. Faithful TSL ports of the four GLSL
 * ShaderMaterials that LevelNodeManager.js builds for the world-map level orbs:
 *
 *   1. glassMat   — the per-instance glass node shells (InstancedMesh). Eight per-world
 *                   shell identities (magma geode / bubble pearl / seed lantern / cairn
 *                   lantern / cloud wisp / starlit orb / lensed shard / neon sign) driven
 *                   by per-instance attributes aNodeStyle / aNodeColor / aNodeAccentColor
 *                   / aNodeSeed / aState, gated by the uAAA uniform; bloom-eligible.
 *   2. glowMat    — the additive back-side halo (InstancedMesh) with the P3 focal-
 *                   hierarchy beat pulse; bloom-eligible.
 *   3. particleMat— the 7040-particle (55 nodes × 128) orbital sparkle cloud
 *                   (THREE.Points), per-particle aOffset / aPState / aNodePos /
 *                   aNodeScale / aNodeLocked; bloom-eligible.
 *   4. fluidInner — the per-node theme-icon core material, with the uUseTexture branch
 *                   between a sampled icon texture and a flat fallback colour.
 *
 * All four are rebuilt as NodeMaterials so they run on the WebGPURenderer and its
 * automatic WebGL2 fallback backend. The additive glass shell, halo and sparkle cloud
 * carry `userData.emitsBloom = true` for the future MRT selective-bloom pass;
 * emissiveNode is wired when the TSL post graph lands (kept off here so the standalone
 * pilot harness, which has no MRT bloom, does not double-brighten). The opaque inner
 * fluid core is NOT bloom-eligible.
 *
 * The GLSL `ns_hash21` (an inline copy of od_hash21) maps to the shared `hash21` from
 * odyssey-tsl-noise.js (identical 0.1031 / 33.33 constants), so the cracked/sparkle
 * lookups carry over GLSL→TSL.
 *
 * This is ADDITIVE: the live LevelNodeManager.js (raw GLSL ShaderMaterial on
 * WebGLRenderer) and its manager class / layout / update logic are untouched and keep
 * working. lockMat / starMat are plain MeshBasicMaterial and stay in the live file.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    cos,
    dot,
    float,
    floor,
    mod,
    length,
    max,
    min,
    mix,
    normalize,
    oneMinus,
    pow,
    sin,
    smoothstep,
    step,
    normalView,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    attribute,
    uniformArray,
    positionGeometry,
    positionLocal,
    positionView,
    normalLocal,
    normalGeometry,
} from 'three/tsl';
import { snoise3 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './chapter-environments/shared/odyssey-tsl-billboard.js';

// Geometry constants mirror LevelNodeManager.js so the pilot reproduces orb sizes.
const GLASS_ORB_SCALE = 1.4;
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const GLASS_GLOW_RADIUS = 1.12 * GLASS_ORB_SCALE;
const INNER_FLOW_STRENGTH = 0.28;
const INNER_WOBBLE_STRENGTH = 0.028;

const TAU = Math.PI * 2;

// ── State language (2026-10 seamless pass) ───────────────────────────────────────
// State is told by BRIGHTNESS and SHAPE, never by hue — the hue belongs to the chapter:
//   locked    dim (<= 35 %), frosted, no halo, a small padlock glyph in the chapter tint
//   unlocked  half glow, a small halo
//   current   an inner light breathing at ~0.5 Hz, the biggest halo, the ribbon's spark
//   completed a steady warm fill, the stars
//   selected  a crisp ring (aState.w — read nowhere before this pass)
const WARM_FILL = vec3(1.0, 0.78, 0.44);

/** 0..1 breathing at 0.5 Hz (one breath every two seconds). */
function breathe(uTime) {
    return sin(uTime.mul(Math.PI)).mul(0.5).add(0.5);
}

// ── Glass node shells (additive per-instance shell identity; bloom-eligible) ─────

/** GLSL ns_wave: sin((p.x+seed)*8) * sin((p.y-seed)*6) * sin((p.z+seed*0.7)*7). */
function nsWave(p, seed) {
    return sin(p.x.add(seed).mul(8.0))
        .mul(sin(p.y.sub(seed).mul(6.0)))
        .mul(sin(p.z.add(seed.mul(0.7)).mul(7.0)));
}

/**
 * Per-instance glass shell. Reads the per-instance attributes aState / aNodeStyle /
 * aNodeColor / aNodeAccentColor / aNodeSeed and reproduces the eight uAAA shell looks
 * plus the default white-glass fallback, including the per-style vertex displacement.
 * Port of glassMat (vertex + fragment).
 *
 * SNOW-GLOBE: a final "glassify" pass (see the matching blocks at the end of colorNode /
 * glassOpacityNode) collapses every per-world painted shell into one CLEAR-glass identity —
 * near-transparent body so the themed inner core reads as the object inside the globe, with
 * an accent-tinted Fresnel rim + specular glint. The per-style colour survives only as a
 * faint (×0.12) chapter tint, so worlds stay subtly distinct without an opaque shell.
 */
export function createGlassShellTSL(uTime = uniform(0), uAAA = uniform(0)) {
    const aState = attribute('aState', 'vec4'); // x:locked y:completed z:hovered w:selected
    const aNodeStyle = attribute('aNodeStyle', 'float');
    const aNodeColor = attribute('aNodeColor', 'vec3');
    const aNodeAccentColor = attribute('aNodeAccentColor', 'vec3');
    const aNodeSeed = attribute('aNodeSeed', 'float');

    const vUv = uv();

    // ── Vertex: per-style displacement along the normal (only when uAAA > 0.5) ──
    const positionNode = Fn(() => {
        const transformed = positionLocal.toVar();
        const aaaOn = step(0.5, uAAA);

        If(uAAA.greaterThan(0.5), () => {
            const s = aNodeStyle.add(0.5);
            const wave = nsWave(positionGeometry, aNodeSeed.mul(TAU));
            const displacement = float(0.0).toVar();

            If(s.lessThan(1.0), () => {
                displacement.assign(0.0);
            }).ElseIf(s.lessThan(2.0), () => {
                displacement.assign(
                    sin(uTime.mul(0.9).add(positionGeometry.y.mul(5.0)).add(aNodeSeed.mul(12.0))).mul(0.026),
                );
            }).ElseIf(s.lessThan(3.0), () => {
                const ribs = pow(abs(sin(vUv.x.add(aNodeSeed).mul(18.0))), 8.0);
                displacement.assign(ribs.mul(0.055));
            }).ElseIf(s.lessThan(4.0), () => {
                displacement.assign(floor(abs(wave).mul(4.0)).mul(0.018));
            })
                .ElseIf(s.lessThan(5.0), () => {
                    displacement.assign(
                        sin(
                            uTime.mul(0.45)
                                .add(vUv.x.mul(11.0))
                                .add(vUv.y.mul(13.0))
                                .add(aNodeSeed.mul(9.0)),
                        ).mul(0.036),
                    );
                })
                .ElseIf(s.lessThan(6.0), () => {
                    displacement.assign(smoothstep(0.88, 1.0, abs(wave)).mul(0.045));
                })
                .ElseIf(s.lessThan(7.0), () => {
                    transformed.x.mulAssign(1.055);
                    transformed.y.mulAssign(0.965);
                    displacement.assign(sin(length(vUv.sub(0.5)).mul(40.0).sub(uTime.mul(1.5))).mul(0.028));
                })
                .Else(() => {
                    transformed.x.mulAssign(1.035);
                    transformed.y.mulAssign(1.035);
                    transformed.z.mulAssign(0.985);
                    displacement.assign(sin(vUv.y.add(aNodeSeed).mul(36.0).add(uTime.mul(3.0))).mul(0.018));
                });

            transformed.addAssign(normalLocal.mul(displacement));
        });

        // aaaOn gates the whole displacement block (transformed === position when off).
        return mix(positionLocal, transformed, aaaOn);
    })();

    // Cross-stage: view-space normal + view position for the rim term.
    const vNormal = normalView;
    const vViewPosition = varying(positionView.negate());

    // aState = (locked, completed, hovered + 2*current, selected).
    const uLocked = aState.x;
    const uCompleted = aState.y;
    const uCurrent = step(1.5, aState.z);
    const uHovered = aState.z.sub(uCurrent.mul(2.0));
    const uSelected = aState.w;

    // ── Clear glass, told by state. (The eight painted per-world shell ladders that used
    // to run here were multiplied by 0.08 and then overwritten — dead cost, removed; the
    // per-world identity returns as the opaque beacon skins.)
    // Pure expressions, rebuilt per slot: colour and opacity must be STANDALONE graphs. A
    // single Fn feeding both slots (rgb / a of one vec4) left the opacity reading a var the
    // colour build had assigned — the shell rendered fully transparent.
    const glassTerms = () => {
        const viewDir = normalize(vViewPosition);
        const gN = normalize(vNormal);
        const ndv = abs(dot(gN, viewDir));
        const fresnel = pow(oneMinus(ndv), 3.0);
        // Fixed view-space key light → a studio glint upper-front (MeshBasic: faked).
        const hot = pow(clamp(dot(gN, normalize(vec3(0.45, 0.7, 0.75))), 0.0, 1.0), 26.0);
        const breath = breathe(uTime);

        // Brightness ladder: locked 0.35, unlocked 0.55, current 0.7..1.0, completed 0.85.
        const bright = mix(
            mix(float(0.55), float(0.85), uCompleted),
            float(0.7).add(breath.mul(0.3)),
            uCurrent,
        ).mul(mix(1.0, 0.35 / 0.55, uLocked));

        // Rim colour: the chapter tint; completed leans warm; locked is FROSTED (desaturated).
        const tint0 = mix(aNodeColor, mix(aNodeColor, WARM_FILL, 0.5), uCompleted);
        const tint = mix(
            tint0,
            vec3(dot(tint0, vec3(0.299, 0.587, 0.114))).mul(0.8).add(0.12),
            uLocked.mul(0.75),
        );

        // Selection ring: a crisp band just inside the silhouette (r ~ 0.88-0.96).
        const edge = oneMinus(ndv);
        const ring = smoothstep(0.42, 0.52, edge).mul(oneMinus(smoothstep(0.66, 0.78, edge)));
        const ringOn = max(uSelected, uHovered.mul(0.35));

        const col = tint.mul(fresnel).mul(bright).mul(1.15)
            .add(vec3(hot.mul(mix(1.0, 0.25, uLocked))))
            // Frost: a faint milky body so a locked orb reads as frosted glass.
            .add(vec3(0.85, 0.9, 1.0).mul(uLocked).mul(0.06))
            // Warm fill (completed) / breathing inner light (current) through the body.
            .add(WARM_FILL.mul(uCompleted).mul(0.10))
            .add(aNodeColor.mul(uCurrent).mul(breath).mul(0.16))
            .add(mix(aNodeAccentColor, vec3(1.0), 0.5).mul(ring).mul(ringOn).mul(0.9));

        const alpha = clamp(
            float(0.05)
                .add(fresnel.mul(0.5).mul(bright.add(0.3)))
                .add(hot.mul(0.9).mul(mix(1.0, 0.3, uLocked)))
                .add(uLocked.mul(0.16))
                .add(uCompleted.mul(0.08))
                .add(uCurrent.mul(breath).mul(0.10))
                .add(ring.mul(ringOn).mul(0.8)),
            0.0,
            0.9,
        ).mul(uHovered.mul(0.4).add(0.6));

        return { col: min(col, vec3(1.0)), alpha };
    };

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = Fn(() => glassTerms().col)();
    material.opacityNode = Fn(() => glassTerms().alpha)();
    material.transparent = true;
    material.depthWrite = false;
    material.userData.emitsBloom = true;

    const geometry = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 48, 48);
    return {
        mesh: null, material, geometry, uniforms: { uTime, uAAA },
    };
}

// ── Additive halo / glow (bloom-eligible) ────────────────────────────────────────

/**
 * Back-side additive halo. rim uses the GLSL fixed view direction (0,0,1) against the
 * view-space normal; aState.z flags the focal "current" node so it blazes and beat-
 * pulses (uBeatPulse). Port of glowMat.
 */
export function createGlowHaloTSL(uTime = uniform(0), uBeatPulse = uniform(0)) {
    const aColor = attribute('aColor', 'vec3');
    // aState = (locked, hovered + 2*selected, current, completed).
    const aState = attribute('aState', 'vec4');

    const vNormal = normalView;
    const vColor = aColor;

    const uLocked = aState.x;
    const uSelected = step(1.5, aState.y);
    const uHovered = aState.y.sub(uSelected.mul(2.0));
    const uCurrent = aState.z;
    const uCompleted = aState.w;

    // Back-face halo rim against the fixed view direction: 1.0 at the halo's silhouette.
    const rimRaw = oneMinus(abs(dot(vNormal, vec3(0.0, 0.0, 1.0))));
    const rim = pow(rimRaw, 4.0);
    const breath = breathe(uTime);
    // Halo size by state: none when locked, small when unlocked, steady when completed,
    // biggest + breathing (and beat-pulsing) on the current node.
    const emphasis = mix(mix(float(0.10), float(0.16), uCompleted), breath.mul(0.16).add(0.22)
        .add(uBeatPulse.mul(0.12)), uCurrent)
        .add(uHovered.mul(0.12));
    // The selection ring: a crisp line at the halo's silhouette.
    const ring = smoothstep(0.80, 0.9, rimRaw).mul(oneMinus(smoothstep(0.95, 1.0, rimRaw))).mul(uSelected);
    const alpha = clamp(
        rim.mul(emphasis).add(ring.mul(0.55)).mul(oneMinus(uLocked)),
        0.0,
        0.6,
    );
    const haloColor = mix(mix(vColor, mix(vColor, WARM_FILL, 0.45), uCompleted), vec3(1.0), ring.mul(0.5));

    const material = new THREE.MeshBasicNodeMaterial();
    // Keep the halo a saturated tint (sub-white) so bloom adds glow, not a white core.
    material.colorNode = min(haloColor, vec3(1.0));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    // uTime is part of the live uniform set (unused in the fragment math) — kept on the
    // builder signature so the manager can share its single uTime; referenced here so
    // lint does not flag it and the uniform survives tree-shaking.
    material.userData.uTime = uTime;

    const geometry = new THREE.IcosahedronGeometry(GLASS_GLOW_RADIUS, 2);
    // The halo shader reads only normalView + aColor + aState (never uv). On an
    // InstancedMesh the vertex-buffer count is position+normal+uv(3) + instanceMatrix(4)
    // + aColor+aState(2) = 9, which exceeds the WebGPU max of 8 and makes the pipeline
    // invalid. Dropping the unused uv attribute brings it to 8 (valid).
    geometry.deleteAttribute('uv');
    return {
        mesh: null, material, geometry, uniforms: { uTime, uBeatPulse },
    };
}

// ── Orbital sparkle particles (additive instanced billboards, bloom-eligible) ────

/**
 * Build the per-node orbital sparkle cloud geometry as instanced billboard quads.
 * Each instance carries the same per-particle attributes the GLSL points read —
 * aOffset / aPState / aNodePos / aNodeScale / aNodeLocked — but on a unit quad so the
 * material can size + round the sprite (THREE.Points renders 1px on WebGPU).
 *
 * @param {number} count instance (particle) count
 * @param {object} arrays { offsetArray, pStateArray, nodePosArray, nodeScaleArray, nodeLockedArray }
 * @returns {THREE.InstancedBufferGeometry}
 */
export function createNodeParticleGeometry(count, {
    offsetArray,
    pStateArray,
    nodePosArray,
    nodeScaleArray,
    nodeLockedArray,
}) {
    return makeQuadInstancedGeometry(count, {
        aOffset: { array: offsetArray, itemSize: 3 },
        aPState: { array: pStateArray, itemSize: 2 },
        aNodePos: { array: nodePosArray, itemSize: 3 },
        aNodeScale: { array: nodeScaleArray, itemSize: 1 },
        aNodeLocked: { array: nodeLockedArray, itemSize: 1 },
    });
}

/**
 * The per-node orbital sparkle cloud as instanced billboard quads. Per-particle
 * attributes aOffset / aPState / aNodePos / aNodeScale / aNodeLocked drive an animated
 * world-space CENTER (same wander as the GLSL vertex); the old gl_PointSize
 * (2.5 * aNodeScale * 300/-viewZ) becomes a WORLD-space billboard size (~0.04 *
 * aNodeScale, perspective is automatic). gl_PointCoord → uv(); the GLSL `discard` at
 * d>0.5 becomes a soft round falloff under additive blending. Port of particleMat.
 */
export function createNodeParticlesTSL(uTime = uniform(0), accentColors = null) {
    const aOffset = attribute('aOffset', 'vec3');
    const aPState = attribute('aPState', 'vec2'); // x:speed y:phase
    const aNodePos = attribute('aNodePos', 'vec3');
    const aNodeScale = attribute('aNodeScale', 'float');
    // Packed (8-vertex-buffer ceiling): locked + 2*completed + 4*chapterIndex(0..7).
    const aNodePacked = attribute('aNodeLocked', 'float');
    const chapterIndex = floor(aNodePacked.add(0.5).mul(0.25));
    const stateBits = aNodePacked.sub(chapterIndex.mul(4.0));
    const nodeCompleted = step(1.5, stateBits);
    const aNodeLocked = stateBits.sub(nodeCompleted.mul(2.0));
    // The sparkle takes the CHAPTER's accent (it was a hard-coded orange on every orb in
    // every world — the "same gold ring" on all 59 nodes).
    const accents = uniformArray(
        (accentColors && accentColors.length === 8 ? accentColors : [
            0xffd27a, 0xc8f6ff, 0xfff2c0, 0xffffff, 0xffd9a0, 0xe6e9ff, 0xffe0a8, 0xff66c4,
        ]).map((c) => new THREE.Color(c)),
        'color',
    );
    const accent = varying(accents.element(chapterIndex.toInt()).rgb);

    const speed = aPState.x.mul(mix(1.0, 0.35, aNodeLocked));
    const phase = aPState.y;
    const t = uTime.mul(speed).add(phase);

    // Gentle orbital movement (animatedOffset = aOffset + small sinusoidal wander).
    const animatedOffset = aOffset.add(vec3(
        sin(t.mul(0.7)).mul(0.1),
        cos(t.mul(0.5)).mul(0.1),
        sin(t.mul(1.1)).mul(0.1),
    ));
    // Animated world-space CENTER of the particle (was the GLSL worldPos / gl_Position).
    const center = aNodePos.add(animatedOffset.mul(aNodeScale));

    // The swarm is a quiet shimmer, never a ring (the selection ring is the only ring): the
    // opaque core hides the inner motes, so a dense bright swarm read as a halo band around
    // every orb — "every orb wears the same gold ring". Locked orbs barely glitter;
    // completed ones carry a warmer, slightly brighter swarm.
    const vOpacity = varying(sin(t.mul(1.5)).mul(0.08).add(0.14)
        .mul(mix(1.0, 0.25, aNodeLocked))
        .mul(nodeCompleted.mul(0.4).add(1.0)));

    // World-space billboard size (replaces gl_PointSize; perspective is automatic).
    //
    // RESTORED 2026-08-12: the port's conversion was ~30x too small. The legacy sprite was
    // `2.5 * aNodeScale` px scaled by `300 / -viewZ`, i.e. ~26 px at the nearest orb (28.9 u)
    // — but 0.04 world units renders at 0.86 px there, which is INVISIBLE. The orbs stopped
    // glittering the day of the WebGPU port and nobody noticed, because a sparkle you cannot
    // see produces no bug report, only a bill (5,280 instances per frame). The correct
    // px-matched size is resolution-dependent (1.20 at 720p, 0.80 at 1080p, same arithmetic);
    // a world-space billboard cannot match both, so 1.0 splits the difference. Lane B's fill
    // cost for the restored glitter rides on the §7.1 measurement (the no-level-nodes A/B
    // now prices the orbs WITH visible sparkles, which is the question that matters).
    // Small glints (nodes now scale up to 1.75x with act camera distance).
    const worldSize = aNodeScale.mul(0.2);
    const positionNode = billboardWorld(center, worldSize);

    // gl_PointCoord → uv(); round mask via the quad uv (soft falloff under additive).
    const p = uv().mul(2.0).sub(1.0);
    const r = dot(p, p);
    const sprite = clamp(oneMinus(r), 0.0, 1.0);
    const alpha = sprite.mul(vOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = mix(accent, mix(accent, WARM_FILL, 0.5), nodeCompleted);
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // FLAT SURFACE, ONE PASS (plan item: forceSinglePass audit, 2026-08-22). `transparent +
    // DoubleSide` makes three draw the object TWICE — BackSide then FrontSide (Renderer.js
    // renderObject / _renderTransparents) — which exists so a CLOSED transparent shell sorts
    // against itself. Every surface here is a single facet (a billboard quad, a plane, an open
    // cone) with depthWrite off, so the second pass re-shades the same fragments: it doubles the
    // fill and, because the passes differ only in `material.side`, it compiles a SECOND pipeline
    // per material (33 of them across the startup groups). Precedent: odyssey-planet-aurora.js.
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    return {
        mesh: null, material, geometry: null, uniforms: { uTime },
    };
}

// ── Core grading ───────────────────────────────────────────────────────────────

/**
 * The level's theme icon, re-graded into the chapter: its structure (luminance) survives,
 * its hue becomes the chapter's. A pink theme icon no longer fights the lava world — it
 * reads as ember-lit glass in ch1, plankton-lit in ch2, and so on.
 */
function gradeIconToChapter(icon, tint) {
    const lum = dot(icon, vec3(0.299, 0.587, 0.114));
    const graded = tint.mul(lum.mul(0.8).add(0.38));
    return mix(icon, graded, 0.8);
}

/**
 * Shared core state response (brightness, never hue): locked dims to ~35 % and frosts,
 * the current node breathes an inner light at 0.5 Hz, completed carries a warm fill.
 */
function applyCoreState(color, {
    locked, completed, hovered, selected, current, tint, uTime,
}) {
    const luma = dot(color, vec3(0.299, 0.587, 0.114));
    // Frost: desaturate toward a cool milky luminance.
    color.assign(mix(color, vec3(luma).mul(vec3(0.92, 0.96, 1.0)).add(tint.mul(0.05)), locked.mul(0.8)));
    color.mulAssign(mix(1.0, 0.35, locked));
    color.addAssign(WARM_FILL.mul(completed).mul(0.16));
    color.mulAssign(current.mul(breathe(uTime).mul(0.45).add(0.1)).add(1.0));
    color.mulAssign(hovered.mul(0.10).add(selected.mul(0.06)).add(1.0));
}

// ── Inner fluid theme-icon core (opaque; NOT bloom-eligible) ─────────────────────

/**
 * The per-node inner core. Vertex wobble along the normal; the fragment swirls UVs and
 * either samples the theme-icon texture (uUseTexture > 0.5) or uses the flat fallback
 * colour. `map` may be null for the standalone harness — then the procedural fallback
 * path is used unconditionally (no texture node is created without a real texture).
 * Port of createFluidInnerMaterial.
 *
 * @param {THREE.Texture|null} map per-node icon texture (or null → fallback only)
 * @param {THREE.Color} [chapterColor] fallback colour
 * @param {number} [levelId] level id (drives the deterministic uSeed)
 * @param {object} [uTime] shared time uniform
 */
export function createFluidInnerTSL(
    map = null,
    chapterColor = new THREE.Color(0xffffff),
    levelId = 1,
    uTime = uniform(0),
) {
    const hasTexture = Boolean(map);
    const seed = ((levelId || 1) * 0.61803398875) % 1000;

    const uUseTexture = uniform(hasTexture ? 1.0 : 0.0);
    const uFallbackColor = uniform(chapterColor.clone());
    const uSeed = uniform(seed);
    const uFlowStrength = uniform(INNER_FLOW_STRENGTH);
    const uWobbleStrength = uniform(INNER_WOBBLE_STRENGTH);
    const uLocked = uniform(0.0);
    const uCompleted = uniform(0.0);
    const uHovered = uniform(0.0);
    const uSelected = uniform(0.0);

    // ── Vertex: wobble along the normal ──
    const vertexSpeed = mix(0.22, 1.25, oneMinus(uLocked));
    const vPhase = uTime.mul(vertexSpeed).add(uSeed);
    const waveA = sin(vPhase.add(positionLocal.y.mul(7.0)).add(positionLocal.x.mul(5.0)));
    const waveB = cos(vPhase.mul(0.8).add(positionLocal.z.mul(6.0)).sub(positionLocal.y.mul(4.0)));
    const wobble = waveA.add(waveB.mul(0.65)).mul(uWobbleStrength);
    const positionNode = positionLocal.add(normalLocal.mul(wobble));

    const vViewNormal = normalView;

    // ── Fragment: swirl UVs, then texture-or-fallback colour grading ──
    const colorNode = Fn(() => {
        const baseUv = uv();
        const fragSpeed = mix(0.28, 1.25, oneMinus(uLocked));
        const t = uTime.mul(fragSpeed).add(uSeed);

        const centered = baseUv.sub(0.5);
        const radius = length(centered);

        const flow = vec2(
            sin(baseUv.y.add(t.mul(0.42)).mul(10.0)).add(cos(baseUv.y.mul(1.7).sub(t.mul(0.31)).mul(5.0))),
            cos(baseUv.x.sub(t.mul(0.37)).mul(10.0)).add(sin(baseUv.x.mul(1.4).add(t.mul(0.33)).mul(5.0))),
        );

        const swirlEnvelope = smoothstep(0.75, 0.0, radius);
        const swirlDir = vec2(centered.y.negate(), centered.x);

        const swirledUv = baseUv
            .add(flow.mul(uFlowStrength.mul(0.010)))
            .add(swirlDir.mul(sin(t.mul(1.2).add(radius.mul(11.0))).mul(uFlowStrength).mul(0.05).mul(swirlEnvelope)));
        const clampedUv = clamp(swirledUv, vec2(0.01), vec2(0.99));

        // Texture-or-fallback branch. With no real texture we use a smooth procedural
        // molten core so Chapter 1 keeps round magma balls instead of texture-wrapped
        // cracked theme icons.
        const sampled = hasTexture ? texture(map, clampedUv).rgb : uFallbackColor;
        const fallbackMagma = mix(
            uFallbackColor.mul(0.36),
            vec3(0.92, 0.24, 0.045),
            smoothstep(
                0.24,
                0.86,
                snoise3(vec3(baseUv.mul(3.4), t.mul(0.12)).add(uSeed)).mul(0.5).add(0.5),
            ).mul(0.58),
        );
        const color = mix(fallbackMagma, gradeIconToChapter(sampled, uFallbackColor), step(0.5, uUseTexture))
            .toVar();
        applyCoreState(color, {
            locked: uLocked,
            completed: uCompleted,
            hovered: uHovered,
            selected: uSelected,
            current: float(0.0),
            tint: uFallbackColor,
            uTime,
        });
        const rim = pow(oneMinus(abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)))), 2.2);
        color.addAssign(rim.mul(0.08));
        return color;
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;
    material.transparent = false;
    material.toneMapped = true;

    const geometry = new THREE.SphereGeometry(GLASS_INNER_RADIUS, 32, 32);
    return {
        mesh: null,
        material,
        geometry,
        uniforms: {
            uTime,
            uUseTexture,
            uFallbackColor,
            uSeed,
            uFlowStrength,
            uWobbleStrength,
            uLocked,
            uCompleted,
            uHovered,
            uSelected,
        },
    };
}

// ── Instanced inner fluid core (LEVER 1: one InstancedMesh, one material) ─────────
// Twin of createFluidInnerTSL with IDENTICAL displacement/swirl/grading math. The only
// changes: per-node uniforms become channels of ONE packed vec4 instance attribute `aCore`
// (8-vertex-buffer limit: sphere position+normal+uv = 3 + instanceMatrix = 4 + aCore = 8),
// and the per-node theme texture sample becomes a layer-indexed DataArrayTexture sample.
//   aCore.x = layer+0.5 (icon) or -1 sentinel (procedural magma, no icon)
//   aCore.y = per-level seed
//   aCore.z = state bitfield: locked|completed<<1|hovered<<2|selected<<3|current<<4
//   aCore.w = 5-5-5 packed chapter tint (fallback magma + the icon grade)
export function createFluidInnerInstancedTSL(arrayTexture, uTime = uniform(0)) {
    const aCore = attribute('aCore', 'vec4');
    const uFlowStrength = uniform(INNER_FLOW_STRENGTH);
    const uWobbleStrength = uniform(INNER_WOBBLE_STRENGTH);

    // Decode packed channels.
    // DECODE IN THE VERTEX STAGE, FROM ROUNDED INTEGERS. These packed channels used to be
    // decoded per FRAGMENT with floor/fract straight off the interpolated attribute: an
    // instance constant arrives as 9.9999 on some pixels and 10.0001 on others, and
    // floor(9.9999 * 0.5) flips a bit — the locked bit flickered per pixel across a selected
    // node's core as dark "frost" speckle. Rounding first makes every decode exact; doing it
    // per vertex (varying of a constant) also takes it off the fragment bill.
    const bit = (zi, k) => mod(floor(zi.div(2 ** k)), 2.0);
    const seed = varying(aCore.y);
    const layerF = varying(floor(aCore.x)); // 0..LAYERS-1 (valid only when x>=0); x = layer + 0.5
    const useTexture = varying(step(float(0.0), aCore.x)); // 1 when x>=0, 0 for the -1 sentinel
    const stateZ = floor(aCore.z.add(0.5));
    const uLocked = varying(bit(stateZ, 0));
    const uCompleted = varying(bit(stateZ, 1));
    const uHovered = varying(bit(stateZ, 2));
    const uSelected = varying(bit(stateZ, 3));
    const uCurrent = varying(bit(stateZ, 4));
    // 5-5-5 unpack of the chapter tint (fallback magma + the icon grade).
    const fw = floor(aCore.w.add(0.5));
    const fbR = floor(fw.div(1024.0));
    const fbG = floor(fw.div(32.0)).sub(fbR.mul(32.0));
    const fbB = fw.sub(floor(fw.div(32.0)).mul(32.0));
    const fallbackColor = varying(vec3(fbR, fbG, fbB).div(31.0));

    // ── Vertex: wobble phases/normal from the geometry nodes — identical on r181
    // (positionLocal/normalLocal are the raw attributes inside positionNode) and correct on
    // r185 (positionLocal is post-instance there); placement rides the positionLocal add-base. ──
    const vertexSpeed = mix(0.22, 1.25, oneMinus(bit(stateZ, 0)));
    const vPhase = uTime.mul(vertexSpeed).add(aCore.y);
    const waveA = sin(vPhase.add(positionGeometry.y.mul(7.0)).add(positionGeometry.x.mul(5.0)));
    const waveB = cos(vPhase.mul(0.8).add(positionGeometry.z.mul(6.0)).sub(positionGeometry.y.mul(4.0)));
    const wobble = waveA.add(waveB.mul(0.65)).mul(uWobbleStrength);
    const positionNode = positionLocal.add(normalGeometry.mul(wobble));

    const vViewNormal = normalView;

    const colorNode = Fn(() => {
        const baseUv = uv();
        const fragSpeed = mix(0.28, 1.25, oneMinus(uLocked));
        const t = uTime.mul(fragSpeed).add(seed);

        const centered = baseUv.sub(0.5);
        const radius = length(centered);
        const flow = vec2(
            sin(baseUv.y.add(t.mul(0.42)).mul(10.0)).add(cos(baseUv.y.mul(1.7).sub(t.mul(0.31)).mul(5.0))),
            cos(baseUv.x.sub(t.mul(0.37)).mul(10.0)).add(sin(baseUv.x.mul(1.4).add(t.mul(0.33)).mul(5.0))),
        );
        const swirlEnvelope = smoothstep(0.75, 0.0, radius);
        const swirlDir = vec2(centered.y.negate(), centered.x);
        const swirledUv = baseUv
            .add(flow.mul(uFlowStrength.mul(0.010)))
            .add(swirlDir.mul(sin(t.mul(1.2).add(radius.mul(11.0))).mul(uFlowStrength).mul(0.05).mul(swirlEnvelope)));
        const clampedUv = clamp(swirledUv, vec2(0.01), vec2(0.99));

        // Layer-indexed array sample (LEVER 1 core change). .depth(int) → WGSL
        // textureSample(tex, sampler, uv, layer); layerF.toInt() is the 0-based layer.
        const sampled = texture(arrayTexture, clampedUv).depth(layerF.toInt()).rgb;
        const fallbackMagma = mix(
            fallbackColor.mul(0.36),
            vec3(0.92, 0.24, 0.045),
            smoothstep(
                0.24,
                0.86,
                snoise3(vec3(baseUv.mul(3.4), t.mul(0.12)).add(seed)).mul(0.5).add(0.5),
            ).mul(0.58),
        );
        const color = mix(fallbackMagma, gradeIconToChapter(sampled, fallbackColor), step(0.5, useTexture))
            .toVar();
        applyCoreState(color, {
            locked: uLocked,
            completed: uCompleted,
            hovered: uHovered,
            selected: uSelected,
            current: uCurrent,
            tint: fallbackColor,
            uTime,
        });
        const rim = pow(oneMinus(abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)))), 2.2);
        color.addAssign(rim.mul(0.08));
        return color;
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;
    material.transparent = false;
    material.toneMapped = true;
    return { material, uniforms: { uTime, uFlowStrength, uWobbleStrength } };
}

// ── Standalone pilot assembler ───────────────────────────────────────────────────

/**
 * Build a small InstancedMesh (glass + glow) and a small Points sparkle cloud plus one
 * inner-core sphere into a Group, sharing one uTime uniform — exercises the instanced
 * and points conversion paths for the graph-construct smoke test and the standalone
 * WebGPU pilot validation page. Mirrors createDeepOceanPilotTSL.
 *
 * @param {object} [opts]
 * @param {number} [opts.instanceCount] number of orb instances to build
 * @param {number} [opts.particlesPerNode] particles per orb
 */
export function createLevelNodesPilotTSL({ instanceCount = 6, particlesPerNode = 64 } = {}) {
    const uTime = uniform(0);
    const uAAA = uniform(1);
    const uBeatPulse = uniform(0);

    const group = new THREE.Group();
    group.name = 'level-nodes-pilot-tsl';

    const palette = [
        new THREE.Color(0xff6644),
        new THREE.Color(0x44aaff),
        new THREE.Color(0x66ff99),
        new THREE.Color(0xffcc33),
        new THREE.Color(0xcc66ff),
        new THREE.Color(0xff4488),
    ];

    // ── Glass shells (InstancedMesh with per-instance attributes) ──
    const glass = createGlassShellTSL(uTime, uAAA);
    const glassMesh = new THREE.InstancedMesh(glass.geometry, glass.material, instanceCount);
    glassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const stateArray = new Float32Array(instanceCount * 4);
    const styleArray = new Float32Array(instanceCount);
    const colorArray = new Float32Array(instanceCount * 3);
    const accentArray = new Float32Array(instanceCount * 3);
    const seedArray = new Float32Array(instanceCount);

    // ── Glow halos (InstancedMesh) ──
    const glow = createGlowHaloTSL(uTime, uBeatPulse);
    const glowMesh = new THREE.InstancedMesh(glow.geometry, glow.material, instanceCount);
    glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const glowColorArray = new Float32Array(instanceCount * 3);
    const glowStateArray = new Float32Array(instanceCount * 4);

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < instanceCount; i += 1) {
        pos.set((i - (instanceCount - 1) / 2) * 3.2, 0, 0);
        matrix.compose(pos, quat, scl);
        glassMesh.setMatrixAt(i, matrix);
        glowMesh.setMatrixAt(i, matrix);

        const c = palette[i % palette.length];
        const a = palette[(i + 1) % palette.length];

        // aState (vec4): locked/completed/hovered/selected
        stateArray[i * 4 + 0] = 0;
        stateArray[i * 4 + 1] = i % 2;
        stateArray[i * 4 + 2] = 0;
        stateArray[i * 4 + 3] = 0;

        styleArray[i] = i % 8; // cycle through the eight shell identities
        colorArray[i * 3 + 0] = c.r;
        colorArray[i * 3 + 1] = c.g;
        colorArray[i * 3 + 2] = c.b;
        accentArray[i * 3 + 0] = a.r;
        accentArray[i * 3 + 1] = a.g;
        accentArray[i * 3 + 2] = a.b;
        seedArray[i] = (i * 97) / 997;

        // glow aState (vec4): locked / hovered+2*selected / current / completed
        glowColorArray[i * 3 + 0] = c.r;
        glowColorArray[i * 3 + 1] = c.g;
        glowColorArray[i * 3 + 2] = c.b;
        glowStateArray[i * 4 + 0] = 0;
        glowStateArray[i * 4 + 1] = i === 1 ? 2 : 0;
        glowStateArray[i * 4 + 2] = i === 0 ? 1 : 0;
        glowStateArray[i * 4 + 3] = i % 2;
    }

    glassMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(stateArray, 4));
    glassMesh.geometry.setAttribute('aNodeStyle', new THREE.InstancedBufferAttribute(styleArray, 1));
    glassMesh.geometry.setAttribute('aNodeColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    glassMesh.geometry.setAttribute('aNodeAccentColor', new THREE.InstancedBufferAttribute(accentArray, 3));
    glassMesh.geometry.setAttribute('aNodeSeed', new THREE.InstancedBufferAttribute(seedArray, 1));
    glassMesh.instanceMatrix.needsUpdate = true;

    glowMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(glowColorArray, 3));
    glowMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(glowStateArray, 4));
    glowMesh.instanceMatrix.needsUpdate = true;

    group.add(glassMesh, glowMesh);

    // ── Inner fluid cores (one per orb; procedural fallback — no texture) ──
    const innerParts = [];
    for (let i = 0; i < instanceCount; i += 1) {
        const inner = createFluidInnerTSL(null, palette[i % palette.length], i + 1, uTime);
        const innerMesh = new THREE.Mesh(inner.geometry, inner.material);
        innerMesh.position.set((i - (instanceCount - 1) / 2) * 3.2, 0, 0);
        group.add(innerMesh);
        innerParts.push(inner);
    }

    // ── Sparkle particles (instanced billboard quads — NOT Points on WebGPU) ──
    const particles = createNodeParticlesTSL(uTime);
    const totalParticles = instanceCount * particlesPerNode;
    const offsetArray = new Float32Array(totalParticles * 3);
    const pStateArray = new Float32Array(totalParticles * 2);
    const nodePosArray = new Float32Array(totalParticles * 3);
    const nodeScaleArray = new Float32Array(totalParticles);
    const nodeLockedArray = new Float32Array(totalParticles);

    for (let i = 0; i < instanceCount; i += 1) {
        const nx = (i - (instanceCount - 1) / 2) * 3.2;
        for (let j = 0; j < particlesPerNode; j += 1) {
            const idx = i * particlesPerNode + j;
            const r = Math.random() * 0.8;
            const theta = Math.random() * TAU;
            const phi = Math.acos((2 * Math.random()) - 1);
            offsetArray[idx * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
            offsetArray[idx * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            offsetArray[idx * 3 + 2] = r * Math.cos(phi);
            pStateArray[idx * 2 + 0] = 0.5 + Math.random();
            pStateArray[idx * 2 + 1] = Math.random() * TAU;
            nodePosArray[idx * 3 + 0] = nx;
            nodePosArray[idx * 3 + 1] = 0;
            nodePosArray[idx * 3 + 2] = 0;
            nodeScaleArray[idx] = 1;
            nodeLockedArray[idx] = 0;
        }
    }

    const particleGeo = createNodeParticleGeometry(totalParticles, {
        offsetArray,
        pStateArray,
        nodePosArray,
        nodeScaleArray,
        nodeLockedArray,
    });

    const points = new THREE.Mesh(particleGeo, particles.material);
    points.frustumCulled = false;
    points.name = 'level-node-particles-tsl';
    group.add(points);

    return {
        group,
        uniforms: {
            uTime, uAAA, uBeatPulse,
        },
        dispose() {
            glass.geometry?.dispose?.();
            glass.material?.dispose?.();
            glow.geometry?.dispose?.();
            glow.material?.dispose?.();
            particleGeo.dispose();
            particles.material?.dispose?.();
            innerParts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createLevelNodesPilotTSL;
