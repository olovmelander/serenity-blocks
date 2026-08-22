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
    fract,
    length,
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
    positionGeometry,
    positionLocal,
    positionView,
    normalLocal,
    normalGeometry,
} from 'three/tsl';
import { hash21, snoise3 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './chapter-environments/shared/odyssey-tsl-billboard.js';

// Geometry constants mirror LevelNodeManager.js so the pilot reproduces orb sizes.
const GLASS_ORB_SCALE = 1.4;
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const GLASS_GLOW_RADIUS = 1.12 * GLASS_ORB_SCALE;
const INNER_FLOW_STRENGTH = 0.28;
const INNER_WOBBLE_STRENGTH = 0.028;

const TAU = Math.PI * 2;

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
    const vLocalPos = varying(positionLocal);

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

    // ── Fragment: per-style shell colour (uAAA) or default white glass ──
    // Color and opacity are built from two parallel Fn closures (same branch
    // structure) so each material node is a standalone graph — no struct threading.
    const colorNode = Fn(() => {
        const uLocked = aState.x;

        const viewDir = normalize(vViewPosition);
        const rim = pow(oneMinus(abs(dot(vNormal, viewDir))), 2.5);

        const color = vec3(0.0).toVar();

        If(uAAA.greaterThan(0.5), () => {
            const nc = aNodeColor;
            const ac = aNodeAccentColor;
            const seed = aNodeSeed;
            const s = aNodeStyle.add(0.5);

            If(s.lessThan(1.0), () => {
                // magmaGeode — smooth warm-orange waypoint shell.
                // It must read as navigation UI, not the chapter's environmental hero.
                const ftime = uTime.mul(0.08);
                const p = vLocalPos.mul(2.2).add(seed.mul(17.0));

                // Slow flowing molten noise field (domain warped for organic feel).
                const warp = snoise3(p.add(vec3(ftime, 0.0, 0.0))).mul(0.35);
                const moltenNoise = snoise3(p.add(warp).add(vec3(0.0, ftime.negate(), 0.0))).mul(0.5).add(0.5);
                const moltenIntensity = smoothstep(0.22, 0.82, moltenNoise);

                // Broad crust mottling only. High-frequency cracks made the orbs read
                // jagged and broken in the Earth Core screenshots.
                const crustNoise = snoise3(vLocalPos.mul(3.0).add(seed.mul(13.0))).mul(0.5).add(0.5);
                const crustFactor = smoothstep(0.18, 0.78, crustNoise);

                // Warm-orange body base, intentionally below the lava-fall/lake value.
                const moltenBase = vec3(0.42, 0.09, 0.018);
                const moltenHot = vec3(0.78, 0.22, 0.04);
                const moltenColor = mix(moltenBase, moltenHot, moltenIntensity.mul(0.58));

                // Base dark charred rock color (not void!)
                const crustColor = vec3(0.055, 0.018, 0.008);

                // Blended round magma-shell color with soft continents, no hard cracks.
                let bodyColor = mix(crustColor, moltenColor, oneMinus(crustFactor.mul(0.74)).mul(0.56));

                // Small warm edge only; no yellow-white rim bloom.
                bodyColor = bodyColor.add(vec3(0.66, 0.14, 0.03).mul(rim).mul(0.14));
                color.assign(min(bodyColor, vec3(0.62, 0.26, 0.10)));
            }).ElseIf(s.lessThan(2.0), () => {
                // bubblePearl — pearlescent thin-film
                const irid = cos(uTime.mul(0.24).add(rim.mul(3.2)).add(seed.mul(6.0)).add(vec3(0.0, 2.0, 4.0)))
                    .mul(0.5).add(0.5);
                color.assign(mix(vec3(0.82, 0.95, 1.0), irid, 0.55).mul(mix(vec3(1.0), ac, 0.28)));
            }).ElseIf(s.lessThan(3.0), () => {
                // seedLantern — warm organic glow
                const ribs = pow(abs(sin(vUv.x.add(seed).mul(18.0))), 8.0);
                color.assign(mix(nc.mul(0.42), ac.mul(1.2), ribs.mul(0.65).add(rim.mul(0.38))));
            }).ElseIf(s.lessThan(4.0), () => {
                // cairnLantern — icy faceted crystal
                const facet = step(0.5, fract(vUv.x.add(seed).mul(8.0))).mul(0.5)
                    .add(step(0.5, fract(vUv.y.sub(seed).mul(8.0))).mul(0.5));
                color.assign(nc.mul(rim.mul(0.95).add(0.28)).add(ac.mul(facet).mul(0.28)));
            })
                .ElseIf(s.lessThan(5.0), () => {
                // cloudWisp — soft diffuse pastel (Ch5 Sky node identity)
                    const wisps = smoothstep(
                        0.3,
                        0.95,
                        sin(
                            vUv.x.mul(15.0)
                                .add(vUv.y.mul(10.0))
                                .sub(uTime.mul(0.7))
                                .add(seed.mul(9.0)),
                        ).mul(0.5).add(0.5),
                    );
                    color.assign(
                        mix(vec3(0.92), nc, 0.48)
                            .mul(rim.mul(0.42).add(0.58))
                            .add(ac.mul(wisps).mul(0.12)),
                    );
                    // Two-tone sun/aurora rim — surgical, ch5-only (inside this branch):
                    // the upper hemisphere (facing the on-camera sun) picks up a thin
                    // WARM rim; the lower (away) picks up a COOL aurora rim. Additive +
                    // rim-gated so it stays a soft fringe (the shell ceiling clamps).
                    const sunSide = smoothstep(-0.2, 0.6, vNormal.y);
                    const rimTint = mix(vec3(0.36, 0.92, 1.0), vec3(1.0, 0.78, 0.46), sunSide);
                    color.addAssign(rimTint.mul(rim).mul(0.22));
                })
                .ElseIf(s.lessThan(6.0), () => {
                // starlitOrb — dark with sparkle points
                    const spark = step(
                        0.955,
                        hash21(floor(vUv.mul(44.0)).add(floor(uTime.mul(3.0))).add(seed.mul(17.0))),
                    );
                    color.assign(nc.mul(0.14).add(ac.mul(rim).mul(0.9)).add(vec3(1.25, 1.15, 1.5).mul(spark)));
                })
                .ElseIf(s.lessThan(7.0), () => {
                // lensedShard — concentric lensing rings
                    const rings = sin(
                        length(vUv.sub(0.5))
                            .mul(42.0)
                            .sub(uTime.mul(2.0))
                            .add(seed.mul(8.0)),
                    ).mul(0.5).add(0.5);
                    color.assign(mix(nc.mul(0.18), ac.mul(1.2), pow(rings, 3.0)).add(nc.mul(rim).mul(0.55)));
                })
                .Else(() => {
                // neonSign — bright electric rim
                    const flick = sin(uTime.mul(18.0).add(vUv.y.mul(6.0)).add(seed.mul(20.0))).mul(0.15).add(0.85);
                    const scan = step(0.9, fract(vUv.y.add(uTime.mul(0.23)).add(seed).mul(13.0)));
                    const edge = min(min(vUv.x, oneMinus(vUv.x)), min(vUv.y, oneMinus(vUv.y)));
                    const frame = oneMinus(smoothstep(0.025, 0.09, edge));
                    color.assign(
                        nc.mul(rim.mul(1.35).add(0.5))
                            .mul(flick)
                            .add(ac.mul(scan.mul(0.45).add(frame.mul(0.9)))),
                    );
                });
        }).Else(() => {
            // ── Original white glass (default look, flag off) ──
            const irid = vec3(
                cos(uTime.mul(0.2).add(rim.mul(3.0)).add(0.0)).mul(0.5).add(0.5),
                cos(uTime.mul(0.2).add(rim.mul(3.0)).add(2.0)).mul(0.5).add(0.5),
                cos(uTime.mul(0.2).add(rim.mul(3.0)).add(4.0)).mul(0.5).add(0.5),
            );
            color.assign(mix(vec3(1.0), irid, rim.mul(0.15).mul(oneMinus(uLocked.mul(0.5)))));
        });

        // ── Snow-globe glassify ──────────────────────────────────────────────────────
        // Collapse the painted per-world shell into CLEAR glass so the (now small) themed
        // core reads as the object suspended inside the globe. Almost no body; the energy
        // goes into an accent-tinted Fresnel rim plus a tight fixed-light SPECULAR HOTSPOT —
        // a bright glint on the upper-front of the sphere that reads unmistakably as shiny
        // glass (not a bare magma ball). Per-style colour survives only as a faint tint.
        const gN = normalize(vNormal);
        const gNdv = abs(dot(gN, viewDir));
        const gFresnel = pow(oneMinus(gNdv), 3.0);
        // Fixed view-space key light → a studio glint that sits upper-front regardless of
        // where the orb is on the path (MeshBasic has no real lighting, so we fake it).
        const gLightDir = normalize(vec3(0.45, 0.7, 0.75));
        const gHot = pow(clamp(dot(gN, gLightDir), 0.0, 1.0), 26.0).mul(1.3);
        const gTintRim = mix(aNodeColor, aNodeAccentColor, 0.5).mul(gFresnel).mul(0.8);
        color.assign(color.mul(0.08).add(gTintRim).add(vec3(gHot.add(gFresnel.mul(0.1)))));

        // Shared locked response (color *= 1 - uLocked*0.4); ceiling clamp keeps the bright
        // glassy rim/glint from blowing past white into the additive halo + bloom.
        return min(color.mul(oneMinus(uLocked.mul(0.4))), vec3(1.0));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.opacityNode = glassOpacityNode(
        aState,
        vNormal,
        vViewPosition,
        uTime,
        uAAA,
        aNodeStyle,
        aNodeSeed,
        vUv,
    );
    material.transparent = true;
    material.depthWrite = false;
    material.userData.emitsBloom = true;

    const geometry = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 48, 48);
    return {
        mesh: null, material, geometry, uniforms: { uTime, uAAA },
    };
}

/**
 * Opacity twin of the glass shell — re-derives rim and the per-style alpha so the
 * material's opacityNode is a standalone float node (color and alpha share the same
 * branch structure; kept separate to avoid threading a struct across stages).
 */
function glassOpacityNode(
    aState,
    vNormal,
    vViewPosition,
    uTime,
    uAAA,
    aNodeStyle,
    aNodeSeed,
    vUv,
) {
    return Fn(() => {
        const uHovered = aState.z;

        const viewDir = normalize(vViewPosition);
        const rim = pow(oneMinus(abs(dot(vNormal, viewDir))), 2.5);

        const seed = aNodeSeed;
        const alpha = float(0.0).toVar();

        If(uAAA.greaterThan(0.5), () => {
            const s = aNodeStyle.add(0.5);
            If(s.lessThan(1.0), () => {
                alpha.assign(0.34);
            }).ElseIf(s.lessThan(2.0), () => {
                const caustic = pow(
                    sin(
                        vUv.x.add(vUv.y)
                            .mul(28.0)
                            .add(uTime)
                            .add(seed.mul(8.0)),
                    ).mul(0.5).add(0.5),
                    3.0,
                );
                alpha.assign(rim.mul(0.42).add(caustic.mul(0.1)).add(0.1));
            }).ElseIf(s.lessThan(3.0), () => {
                const ribs = pow(abs(sin(vUv.x.add(seed).mul(18.0))), 8.0);
                alpha.assign(ribs.mul(0.18).add(rim.mul(0.32)).add(0.18));
            }).ElseIf(s.lessThan(4.0), () => {
                alpha.assign(rim.mul(0.5).add(0.14));
            })
                .ElseIf(s.lessThan(5.0), () => {
                    const wisps = smoothstep(
                        0.3,
                        0.95,
                        sin(
                            vUv.x.mul(15.0)
                                .add(vUv.y.mul(10.0))
                                .sub(uTime.mul(0.7))
                                .add(seed.mul(9.0)),
                        ).mul(0.5).add(0.5),
                    );
                    alpha.assign(wisps.mul(0.15).add(rim.mul(0.26)).add(0.12));
                })
                .ElseIf(s.lessThan(6.0), () => {
                    const spark = step(
                        0.955,
                        hash21(floor(vUv.mul(44.0)).add(floor(uTime.mul(3.0))).add(seed.mul(17.0))),
                    );
                    alpha.assign(rim.mul(0.32).add(spark.mul(0.6)).add(0.12));
                })
                .ElseIf(s.lessThan(7.0), () => {
                    alpha.assign(rim.mul(0.42).add(0.18));
                })
                .Else(() => {
                    const edge = min(min(vUv.x, oneMinus(vUv.x)), min(vUv.y, oneMinus(vUv.y)));
                    const frame = oneMinus(smoothstep(0.025, 0.09, edge));
                    alpha.assign(rim.mul(0.45).add(frame.mul(0.16)).add(0.2));
                });
        }).Else(() => {
            alpha.assign(rim.mul(0.25).add(0.15));
        });

        // ── Snow-globe glassify ──────────────────────────────────────────────────────
        // Clear-glass alpha profile: very transparent through the centre (so the suspended
        // core reads as the thing inside the globe), glassy toward the grazing rim, opaque at
        // the specular hotspot. depthWrite stays off so it blends over the core.
        const gN = normalize(vNormal);
        const gNdv = abs(dot(gN, viewDir));
        const gFresnel = pow(oneMinus(gNdv), 3.0);
        const gLightDir = normalize(vec3(0.45, 0.7, 0.75));
        const gHot = pow(clamp(dot(gN, gLightDir), 0.0, 1.0), 26.0);
        alpha.assign(clamp(float(0.05).add(gFresnel.mul(0.5)).add(gHot.mul(0.9)), 0.0, 0.85));

        // Shared hover response (alpha *= 0.6 + uHovered*0.4).
        return alpha.mul(uHovered.mul(0.4).add(0.6));
    })();
}

// ── Additive halo / glow (bloom-eligible) ────────────────────────────────────────

/**
 * Back-side additive halo. rim uses the GLSL fixed view direction (0,0,1) against the
 * view-space normal; aState.z flags the focal "current" node so it blazes and beat-
 * pulses (uBeatPulse). Port of glowMat.
 */
export function createGlowHaloTSL(uTime = uniform(0), uBeatPulse = uniform(0)) {
    const aColor = attribute('aColor', 'vec3');
    const aState = attribute('aState', 'vec3'); // x:locked y:hovered z:current

    const vNormal = normalView;
    const vColor = aColor;

    const uLocked = aState.x;
    const uHovered = aState.y;
    const uCurrent = aState.z;

    // A4-NODE: tighter rim falloff (pow 4.0, was 3.0) so the additive halo is a crisp
    // ring around the orb instead of a broad blob that clipped to white in
    // Surface/Mtn/Sky/Space. The halo COLOUR is the per-node aColor (already the chapter
    // accent fed by the manager) — no fixed-cyan to re-tint here.
    const rim = pow(oneMinus(abs(dot(vNormal, vec3(0.0, 0.0, 1.0)))), 4.0);
    const emphasis = uHovered.mul(0.18).add(uCurrent.mul(uBeatPulse.mul(0.22).add(0.24)));
    // Clamp the additive halo alpha so even the focal/beat-pulsing node never stacks into
    // a pure-white bloom or becomes the sustained chapter hero (peak <= 0.38).
    const alpha = clamp(
        rim.mul(emphasis.add(0.12)).mul(oneMinus(uLocked.mul(0.7))),
        0.0,
        0.38,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    // Keep the halo a saturated tint (sub-white) so bloom adds glow, not a white core.
    material.colorNode = min(vColor, vec3(1.0));
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
export function createNodeParticlesTSL(uTime = uniform(0)) {
    const aOffset = attribute('aOffset', 'vec3');
    const aPState = attribute('aPState', 'vec2'); // x:speed y:phase
    const aNodePos = attribute('aNodePos', 'vec3');
    const aNodeScale = attribute('aNodeScale', 'float');
    const aNodeLocked = attribute('aNodeLocked', 'float');

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

    const vOpacity = varying(sin(t.mul(1.5)).mul(0.12).add(0.26));

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
    const worldSize = aNodeScale.mul(1.0);
    const positionNode = billboardWorld(center, worldSize);

    // gl_PointCoord → uv(); round mask via the quad uv (soft falloff under additive).
    const p = uv().mul(2.0).sub(1.0);
    const r = dot(p, p);
    const sprite = clamp(oneMinus(r), 0.0, 1.0);
    const alpha = sprite.mul(vOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(1.0, 0.7, 0.2);
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
        const color = mix(fallbackMagma, sampled, step(0.5, uUseTexture)).toVar();

        // Locked "dormant gem" treatment — softened so a dark theme icon no longer reads as a
        // near-black void when previewing locked chapters ahead (masterplan §2 #11): gentler
        // ×0.60 brightness floor + lighter desaturation + a small biome-tint glow floor.
        const luma = dot(color, vec3(0.299, 0.587, 0.114));
        color.assign(mix(vec3(luma), color, oneMinus(uLocked.mul(0.30))));
        color.mulAssign(mix(0.60, 1.0, oneMinus(uLocked)));
        color.addAssign(uLocked.mul(uFallbackColor).mul(0.12));
        color.addAssign(uCompleted.mul(0.15));

        const rim = pow(oneMinus(abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)))), 2.2);
        color.addAssign(rim.mul(0.08));
        color.mulAssign(uHovered.mul(0.10).add(uSelected.mul(0.06)).add(1.0));

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
//   aCore.z = state bitfield: locked|completed<<1|hovered<<2|selected<<3
//   aCore.w = 5-5-5 packed fallback rgb
export function createFluidInnerInstancedTSL(arrayTexture, uTime = uniform(0)) {
    const aCore = attribute('aCore', 'vec4');
    const uFlowStrength = uniform(INNER_FLOW_STRENGTH);
    const uWobbleStrength = uniform(INNER_WOBBLE_STRENGTH);

    // Decode packed channels.
    const seed = aCore.y;
    const layerF = floor(aCore.x); // 0..LAYERS-1 (valid only when x>=0)
    const useTexture = step(float(0.0), aCore.x); // 1 when x>=0, 0 for the -1 sentinel
    const stateZ = aCore.z;
    const uLocked = step(0.5, fract(stateZ.mul(0.5)).mul(2.0)); // bit0
    const uCompleted = step(0.5, fract(floor(stateZ.mul(0.5)).mul(0.5)).mul(2.0)); // bit1
    const uHovered = step(0.5, fract(floor(stateZ.mul(0.25)).mul(0.5)).mul(2.0)); // bit2
    const uSelected = step(0.5, fract(floor(stateZ.mul(0.125)).mul(0.5)).mul(2.0)); // bit3
    // 5-5-5 unpack of the fallback colour (only feeds the *0.36 magma tint, sub-perceptual).
    const fw = aCore.w;
    const fbR = floor(fw.div(1024.0)).div(31.0);
    const fbG = floor(fw.div(32.0)).sub(floor(fw.div(1024.0)).mul(32.0)).div(31.0);
    const fbB = fw.sub(floor(fw.div(32.0)).mul(32.0)).div(31.0);
    const fallbackColor = vec3(fbR, fbG, fbB);

    // ── Vertex: wobble phases/normal from the geometry nodes — identical on r181
    // (positionLocal/normalLocal are the raw attributes inside positionNode) and correct on
    // r185 (positionLocal is post-instance there); placement rides the positionLocal add-base. ──
    const vertexSpeed = mix(0.22, 1.25, oneMinus(uLocked));
    const vPhase = uTime.mul(vertexSpeed).add(seed);
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
        const color = mix(fallbackMagma, sampled, step(0.5, useTexture)).toVar();

        // Locked "dormant gem" treatment — softened so a dark theme icon no longer reads as a
        // near-black void when previewing locked chapters ahead (masterplan §2 #11): gentler
        // ×0.60 brightness floor + lighter desaturation + a small biome-tint glow floor.
        const luma = dot(color, vec3(0.299, 0.587, 0.114));
        color.assign(mix(vec3(luma), color, oneMinus(uLocked.mul(0.30))));
        color.mulAssign(mix(0.60, 1.0, oneMinus(uLocked)));
        color.addAssign(uLocked.mul(fallbackColor).mul(0.12));
        color.addAssign(uCompleted.mul(0.15));
        const rim = pow(oneMinus(abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)))), 2.2);
        color.addAssign(rim.mul(0.08));
        color.mulAssign(uHovered.mul(0.10).add(uSelected.mul(0.06)).add(1.0));
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
    const glowStateArray = new Float32Array(instanceCount * 3);

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

        // glow aState (vec3): locked/hovered/current
        glowColorArray[i * 3 + 0] = c.r;
        glowColorArray[i * 3 + 1] = c.g;
        glowColorArray[i * 3 + 2] = c.b;
        glowStateArray[i * 3 + 0] = 0;
        glowStateArray[i * 3 + 1] = 0;
        glowStateArray[i * 3 + 2] = i === 0 ? 1 : 0;
    }

    glassMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(stateArray, 4));
    glassMesh.geometry.setAttribute('aNodeStyle', new THREE.InstancedBufferAttribute(styleArray, 1));
    glassMesh.geometry.setAttribute('aNodeColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    glassMesh.geometry.setAttribute('aNodeAccentColor', new THREE.InstancedBufferAttribute(accentArray, 3));
    glassMesh.geometry.setAttribute('aNodeSeed', new THREE.InstancedBufferAttribute(seedArray, 1));
    glassMesh.instanceMatrix.needsUpdate = true;

    glowMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(glowColorArray, 3));
    glowMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(glowStateArray, 3));
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
