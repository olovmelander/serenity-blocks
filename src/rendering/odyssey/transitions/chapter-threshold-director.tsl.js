/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter Threshold Breach — TSL/WebGPU conversion (P3, final batch).
 *
 * Part of the Odyssey AAA WebGPU migration. See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md.
 * Faithful TSL ports of the three GLSL ShaderMaterials that ChapterThresholdDirector.js
 * uses to render the chapter-seam breach: the full-screen breach veil (a `uKind` switch
 * selecting 7 breach patterns 0..6 — steam/waterline/ridge/split/atmosphere-rim/lensing/
 * neon-scan), the scanning ring, and the additive particle burst. All three are additive,
 * bloom-eligible glows, rebuilt as NodeMaterials so they run on the WebGPURenderer and its
 * automatic WebGL2 fallback backend.
 *
 * The director class itself (trigger/setSeamPhase/update placement logic) stays in the
 * live ChapterThresholdDirector.js and is out of scope here — only the three materials and
 * the particle geometry layout are converted. The veil's inline `hash21`/`noise` map to the
 * shared TSL `hash21`/`noise2`. The veil/ring/particle surfaces are tagged
 * `userData.emitsBloom = true` for the future MRT selective-bloom pass; emissiveNode is
 * wired when the TSL post graph lands (kept off here so the standalone pilot harness, which
 * has no MRT bloom, does not double-brighten).
 *
 * This is ADDITIVE: the live ChapterThresholdDirector.js (raw GLSL ShaderMaterial on
 * WebGLRenderer) is untouched and keeps working.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    clamp,
    dot,
    floor,
    fract,
    length,
    mix,
    oneMinus,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    attribute,
} from 'three/tsl';
import { hash21, noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from '../chapter-environments/shared/odyssey-tsl-billboard.js';

const DEFAULT_PRIMARY = 0xff6a22;
const DEFAULT_SECONDARY = 0x58d8ff;
const DEFAULT_PARTICLE = 0xbdefff;

// A6 — ECOTONE demotion of the breach FX. The transition is now carried by the wider
// co-present biome overlap (ChapterEnvironmentManager ecotone), so the full-screen veil
// wash and the scanning portal ring are demoted from "the event" to faint accents.
const VEIL_ACCENT_ALPHA = 0.34; // was effectively up to 0.92 (a near-opaque white wash)

// Radial feather for the veil quad, in units of `r = length(uv * 2 - 1)`. `end` MUST stay at
// or below 1.0: every point on the quad's boundary has r >= 1, so an `end` above 1.0 leaves
// the additive veil lit along its own edges and it renders as a hard-edged rectangle.
// Guarded by chapter-threshold-veil.test.js.
export const VEIL_RADIAL_FEATHER = Object.freeze({ start: 0.78, end: 1.0 });
const RING_ACCENT_ALPHA = 0.4; // ceiling for the scanning-ring accent alpha

/**
 * Build the shared uniform set mirroring ChapterThresholdDirector's makeUniforms(). The
 * caller's uTime is shared in so the director can tick one clock across veil/ring/particles.
 */
function makeThresholdUniforms(uTime) {
    return {
        uTime: uTime ?? uniform(0),
        uProgress: uniform(0),
        uIntensity: uniform(0),
        uKind: uniform(0),
        uPrimary: uniform(new THREE.Color(DEFAULT_PRIMARY)),
        uSecondary: uniform(new THREE.Color(DEFAULT_SECONDARY)),
        uParticle: uniform(new THREE.Color(DEFAULT_PARTICLE)),
        uDirection: uniform(1),
    };
}

// ── Breach veil (additive, DoubleSide, bloom-eligible) ───────────────────────────

/**
 * Full breach veil — a `uKind` switch selecting 7 breach patterns (0..6:
 * steam/waterline/ridge/split/atmosphere-rim/lensing/neon-scan). The GLSL if/else chain on
 * uKind is reproduced as a select() ladder keyed by step() thresholds on the uKind uniform.
 * Port of createVeilMaterial. The inline hash21/noise map to the shared hash21/noise2.
 *
 * @param {object} [u] shared uniform set from makeThresholdUniforms (constructed if omitted)
 */
export function createVeilMaterialTSL(uTime = uniform(0), u = makeThresholdUniforms(uTime)) {
    const {
        uProgress, uIntensity, uKind, uPrimary, uSecondary, uDirection,
    } = u;
    const time = u.uTime;

    const vUv = uv();
    const uvc = vUv.mul(2.0).sub(1.0); // vUv * 2 - 1
    const r = length(uvc);

    const mist = noise2(vUv.mul(vec2(8.0, 5.0)).add(vec2(time.mul(0.18), time.mul(-0.11))));
    const wave = sin(vUv.y.add(uProgress.mul(0.7)).mul(34.0).add(time.mul(2.4)));

    // ── kind 0: steam quench (1->2) ── Earth Core lava quenching into Deep Ocean:
    // a RISING STEAM/BUBBLE COLUMN that breaks UPWARD into water — warm at the bottom
    // (lava) -> white-cyan at the top (the colour lerp in `color` below does the
    // temperature). A vertical plume mask centred on the seam, animated upward + a
    // bubble lattice climbing through it, feathered at the radial edge.
    const plumeWidth = oneMinus(smoothstep(0.0, 0.5, abs(uvc.x).sub(mist.mul(0.12))));
    const plumeRise = smoothstep(-0.7, 0.55, uvc.y.add(wave.mul(0.05)).sub(uProgress.mul(0.2)));
    // Bubbles crawling UP the plume over time (the column boils upward as it quenches).
    const bubbleLattice = noise2(vec2(uvc.x.mul(6.0), uvc.y.mul(7.0).sub(time.mul(1.3))));
    const steamColumn = plumeWidth.mul(plumeRise).mul(bubbleLattice.mul(0.5).add(0.55));
    const band0 = steamColumn.mul(oneMinus(smoothstep(0.35, 1.15, r)));

    // ── kind 1: surface breach (2->3) ── a REAL water-surface breach from below: an
    // undulating refractive water rim (a fresnel-bright horizontal band the camera
    // rises through) + a downward "water sheeting off the lens" wipe so on the upward
    // breach the water visibly sheets DOWN and off frame as we emerge into sky.
    const breachLine = uProgress.sub(0.45).mul(0.7);
    const ripple = sin(uvc.x.mul(9.0).add(time.mul(2.0))).mul(0.06)
        .add(mist.mul(0.05));
    const waterline = oneMinus(
        smoothstep(0.0, 0.16, abs(uvc.y.sub(breachLine).sub(ripple))),
    );
    // Fresnel-bright rim: a thin hot edge just under the undulating waterline.
    const rimBright = oneMinus(smoothstep(0.0, 0.05, abs(uvc.y.sub(breachLine).sub(ripple).add(0.04))));
    // Water sheeting DOWN off the lens below the breach line, gated by an upward breach
    // (uDirection > 0). Vertical streaks falling, fading toward the bottom of frame.
    const sheetStreaks = noise2(vec2(uvc.x.mul(10.0), uvc.y.mul(3.0).add(time.mul(2.4))));
    const belowBreach = smoothstep(0.18, 0.0, uvc.y.sub(breachLine));
    const sheeting = belowBreach.mul(sheetStreaks.mul(0.5).add(0.2))
        .mul(clamp(uDirection, 0.0, 1.0));
    const band1 = waterline
        .add(rimBright.mul(0.6))
        .add(sheeting.mul(0.5))
        .add(pow(oneMinus(smoothstep(0.15, 1.0, r)), 2.0).mul(0.45));

    // ── kind 2: ridgeline ──
    const ridge = smoothstep(-0.55, 0.4, uvc.y.add(abs(uvc.x).mul(0.45)));
    const band2 = ridge.mul(mist.mul(0.8).add(0.45));

    // ── kind 3: split ──
    const split = smoothstep(0.08, 0.85, abs(uvc.x).add(uProgress.mul(0.55)));
    const band3 = oneMinus(split).mul(0.7).add(pow(oneMinus(smoothstep(0.1, 1.05, r)), 2.0));

    // ── kind 4: AIRGLOW MEMBRANE (5->6, creative plan rework) ── the real ~90km
    // airglow shell seen edge-on: a THIN horizontal olive-green luminous band (not a
    // radial rim) that sweeps past as the camera punches through the last shell of
    // atmosphere — a designed under-a-second event. The faint sparkle is the first
    // stars igniting beyond the membrane (gated to the back half of the breach). The
    // profile's lens-bubble PARTICLE component is untouched and fades across the seam
    // beats exactly as Chapter 5's Transition Out specifies.
    const membraneY = uProgress.mul(1.6).sub(0.8); // sweeps bottom→top across the breach
    const membraneCore = oneMinus(
        smoothstep(0.0, 0.05, abs(uvc.y.sub(membraneY).sub(mist.mul(0.03)))),
    );
    const membraneGlow = oneMinus(smoothstep(0.0, 0.22, abs(uvc.y.sub(membraneY)))).mul(0.4);
    const sparkle4 = step(0.955, hash21(floor(vUv.mul(70.0))))
        .mul(0.45)
        .mul(smoothstep(0.4, 0.9, uProgress));
    const band4 = membraneCore.add(membraneGlow).add(sparkle4);

    // ── kind 5: GRAVITATIONAL SHEAR (6->7, creative plan rework) ── the old tight
    // expanding interference ring buried the portal eye in moiré. Replaced by 3–5
    // BROAD, SLOW shear arcs bowing around the eye — the first hint of lensing —
    // expanding with progress and decaying with the seam envelope (the director's
    // position-driven intensity is the decay tail). Chapter 7's screen-space lens warp
    // inherits the same arc geometry, so the hand-off reads as one physics intensifying.
    const arcPhase = r.mul(6.0).sub(uProgress.mul(2.6)).sub(time.mul(0.18));
    const arcs = pow(sin(arcPhase).mul(0.5).add(0.5), 3.0);
    const arcMask = smoothstep(0.16, 0.42, r).mul(oneMinus(smoothstep(0.6, 1.05, r)));
    const band5 = arcs.mul(arcMask).mul(0.9).add(mist.mul(0.12));

    // ── kind 6: neon scan ──
    const scan = step(0.5, fract(vUv.y.mul(38.0).sub(time.mul(6.0))));
    const snap = oneMinus(smoothstep(0.0, 0.92, r));
    const band6 = snap.mul(scan.mul(0.45).add(0.85));

    // Reproduce the GLSL if/else ladder: pick band by uKind via select() thresholds.
    // band = uKind<0.5 ? band0 : uKind<1.5 ? band1 : ... : band6
    const band = step(0.5, uKind).select(
        step(1.5, uKind).select(
            step(2.5, uKind).select(
                step(3.5, uKind).select(
                    step(4.5, uKind).select(
                        step(5.5, uKind).select(band6, band5),
                        band4,
                    ),
                    band3,
                ),
                band2,
            ),
            band1,
        ),
        band0,
    );

    // A6: the veil used to wash the seam to a near-opaque (0.92) full-screen glow that hid
    // a hard portal cut. The ecotone now carries the transition, so the veil is demoted to
    // a faint colour breath over the overlap — low alpha ceiling + softer additive punch.
    // The radial feather MUST reach zero by r = 1. `r` is length(uv * 2 - 1), so every point
    // on the quad's boundary has r >= 1 (exactly 1 at the edge midpoints, up to 1.414 at the
    // corners) — ending the ramp at 1.28 left the veil at 59% of its weight along all four
    // edges, and an additive quad that is 59% lit at its own border draws its border. Against
    // Ch4's now-opaque massif that showed up as a hard-edged bright RECTANGLE hanging in the
    // mountain, reading exactly like a transparent window cut through it. The ramp START is
    // unchanged, so the veil's solid core keeps its authored size; only the amputated tail is
    // given room to finish.
    const alpha = clamp(
        band.mul(uIntensity)
            .mul(oneMinus(smoothstep(VEIL_RADIAL_FEATHER.start, VEIL_RADIAL_FEATHER.end, r)))
            .mul(VEIL_ACCENT_ALPHA),
        0.0,
        VEIL_ACCENT_ALPHA,
    );
    const color = mix(
        uPrimary,
        uSecondary,
        smoothstep(-0.4, 0.8, uvc.y).add(mist.mul(0.18)),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(uIntensity.mul(0.35).add(0.85));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(32, 20, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'threshold-veil-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: u,
    };
}

// ── Scanning ring (additive, bloom-eligible) ─────────────────────────────────────

/**
 * Scanning ring banding on a torus. Port of createRingMaterial. The scan frequency tracks
 * uKind exactly (2.4 + uKind*0.22).
 *
 * @param {object} [u] shared uniform set from makeThresholdUniforms (constructed if omitted)
 */
export function createRingMaterialTSL(uTime = uniform(0), u = makeThresholdUniforms(uTime)) {
    const {
        uProgress, uIntensity, uKind, uPrimary, uSecondary,
    } = u;
    const time = u.uTime;

    const vUv = uv();

    const scan = sin(vUv.x.mul(24.0).sub(time.mul(uKind.mul(0.22).add(2.4))));
    const edge = smoothstep(0.08, 0.5, vUv.y).mul(smoothstep(0.95, 0.45, vUv.y));
    const pulse = scan.mul(0.45).add(0.55);
    const color = mix(uPrimary, uSecondary, smoothstep(0.0, 1.0, vUv.x.add(uProgress.mul(0.2))));
    // A6: DEMOTE the portal ring to a subtle accent inside the ecotone overlap. The world
    // TRANSFORMING (co-present biomes) is now the visible event, not a glowing portal halo.
    // Cap the alpha low and cut the additive colour punch so the ring whispers rather than
    // washing the seam. uIntensity is still director-driven (breach mechanic/API unchanged).
    const alpha = clamp(
        edge.mul(pulse.mul(0.65).add(0.35)).mul(uIntensity).mul(RING_ACCENT_ALPHA),
        0.0,
        RING_ACCENT_ALPHA,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(uIntensity.mul(0.35).add(0.85));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.TorusGeometry(6.2, 0.075, 14, 144);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'threshold-ring-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: u,
    };
}

// ── Particle burst geometry (mirrors createParticleGeometry in the live file) ────

/**
 * Reproduce createParticleGeometry's deterministic layout exactly: a position buffer +
 * a per-point `aSeed` attribute read by the points material.
 */
export function createParticleGeometry(count = 180) {
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const seed = (i + 0.5) / count;
        const theta = seed * Math.PI * 2 * 17.0;
        const radius = 1.3 + ((((i * 37) % 101) / 101) * 3.6);
        const z = (((i * 53) % 97) / 97 - 0.5) * 1.8;
        const idx = i * 3;
        bases[idx] = Math.cos(theta) * radius;
        bases[idx + 1] = Math.sin(theta) * radius * 0.72;
        bases[idx + 2] = z;
        seeds[i] = seed;
    }

    // Instanced billboard quads (NOT THREE.Points — points are 1px on WebGPU).
    return makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
    });
}

// ── Particle burst (additive PointsNodeMaterial, bloom-eligible) ─────────────────

/**
 * Additive particle burst. Port of createParticleMaterial — a PointsNodeMaterial driving
 * the createParticleGeometry buffer. The GLSL vertex displacement of `position` by aSeed/
 * uProgress/uDirection becomes positionNode; gl_PointSize → sizeNode (sizeAttenuation off,
 * so the `300 / -mv.z` perspective term is reproduced manually); gl_PointCoord → pointUV;
 * the `if (r>1) discard` hard cut becomes a soft round falloff under additive blending.
 *
 * @param {object} [u] shared uniform set from makeThresholdUniforms (constructed if omitted)
 */
export function createParticleMaterialTSL(uTime = uniform(0), u = makeThresholdUniforms(uTime)) {
    const { uProgress, uIntensity, uDirection } = u;
    const time = u.uTime;

    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');

    const burst = smoothstep(0.0, 1.0, uProgress);
    const swirl = sin(time.mul(2.0).add(aSeed.mul(6.2831))).mul(0.38);

    // Animate the particle CENTER (same math as the GLSL vertex displacement, on aBase).
    const xyScale = burst.mul(aSeed.mul(1.25).add(1.7)).add(0.45);
    const cx = aBase.x.mul(xyScale).add(swirl.mul(burst));
    const cy = aBase.y.mul(xyScale).add(burst.sub(0.5).mul(uDirection).mul(aSeed.add(1.2)));
    const cz = aBase.z.add(sin(aSeed.mul(31.0).add(time)).mul(0.55).mul(burst));
    const center = vec3(cx, cy, cz);

    // World-space billboard size (replaces the pixel gl_PointSize; perspective is automatic).
    const size = aSeed.mul(0.16).add(0.06).mul(uIntensity.mul(0.6).add(0.4));
    const positionNode = billboardWorld(center, size);

    // Round sprite mask via the quad uv (r = |2*uv-1|^2; soft falloff under additive blending).
    const p = uv().mul(2.0).sub(1.0);
    const r = dot(p, p);
    const core = pow(clamp(oneMinus(r), 0.0, 1.0), 2.4);
    const sparkle = sin(aSeed.mul(41.0)).mul(0.25).add(0.75);
    const alpha = core.mul(uIntensity).mul(sparkle);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = u.uParticle.mul(uIntensity.mul(0.8).add(1.0));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = createParticleGeometry(180);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'threshold-particles-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: u,
    };
}

/**
 * Assemble the converted veil + ring + particle materials on their original geometries into
 * one group, sharing a single uniform set (incl. uTime the caller ticks each frame). Mirrors
 * createDeepOceanPilotTSL / createBlackHoleTranscendencePilotTSL — used by the standalone
 * WebGPU pilot validation page. Geometry types/sizes and mesh placement match
 * ChapterThresholdDirector's constructor.
 *
 * @param {object} [opts]
 * @param {number} [opts.particleCount] override the burst point count (default 180).
 */
export function createThresholdBreachPilotTSL({ particleCount = 180 } = {}) {
    const uTime = uniform(0);
    const u = makeThresholdUniforms(uTime);
    const group = new THREE.Group();
    group.name = 'threshold-breach-pilot-tsl';
    group.renderOrder = 80;

    const veil = createVeilMaterialTSL(uTime, u);
    const ring = createRingMaterialTSL(uTime, u);

    // Particle material with the requested point count (createParticleMaterialTSL builds 180
    // by default; rebuild on the requested-count geometry to honor the quality override).
    const particles = createParticleMaterialTSL(uTime, u);
    if (particleCount !== 180) {
        particles.geometry.dispose();
        particles.geometry = createParticleGeometry(particleCount);
        particles.mesh.geometry = particles.geometry;
    }

    group.add(veil.mesh, ring.mesh, particles.mesh);

    const parts = [veil, ring, particles];

    return {
        group,
        uniforms: u,
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createThresholdBreachPilotTSL;
