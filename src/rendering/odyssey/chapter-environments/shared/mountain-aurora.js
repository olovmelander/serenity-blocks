/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    float,
    mix,
    positionLocal,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec3,
} from 'three/tsl';
import { snoise3 } from './odyssey-tsl-noise.js';

export const MOUNTAIN_AURORA_CURTAIN_CONFIGS = Object.freeze([
    Object.freeze({
        x: 0, y: 600, z: -1500, width: 4000, height: 1500, rotY: 0, opacity: 1.0,
    }),
    Object.freeze({
        x: -500, y: 500, z: -1300, width: 2500, height: 1200, rotY: 0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 500, y: 550, z: -1350, width: 2500, height: 1200, rotY: -0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 0, y: 800, z: -2000, width: 5000, height: 1800, rotY: 0, opacity: 0.6,
    }),
]);

export const SURFACE_WORLD_AURORA_PREVIEW_LAYER_OPACITIES = Object.freeze([0.35, 0.25, 0.18]);
export const SURFACE_WORLD_AURORA_PREVIEW_START = 0.27;
export const SURFACE_WORLD_AURORA_PREVIEW_END = 0.33;

// ── TSL aurora curtain (WebGPU twin of the Ashima-snoise ShaderMaterial) ─────────
//
// The original was a single GLSL THREE.ShaderMaterial (Ashima `snoise` curtain) that
// cannot render on WebGPURenderer. It is rebuilt here as a MeshBasicNodeMaterial:
//   • positionNode reproduces the vertex displacement (z/x wobble from snoise3 of the
//     local position), and stashes the per-vertex displacement in a varying so the
//     fragment band term matches the GLSL `vDisplacement`.
//   • colorNode / opacityNode reproduce the fragment gradient + edge fades + bands.
// Ashima `snoise` (~[-1,1]) maps to the shared `snoise3` (built-in MaterialX gradient
// noise, also ~[-1,1]) per docs/ODYSSEY_AAA_MASTER_PLAN.md §3.4 — same curtain look,
// runs on both the WebGPU and the WebGL2-fallback backends. Additive + bloom-eligible.

/**
 * Build the displaced TSL position node for one aurora curtain and capture the
 * per-vertex displacement into the returned varying (mirrors the GLSL `vDisplacement`).
 * @param {*} uTime float node — shared time
 * @param {*} uLayerOffset float node — per-layer phase offset
 * @returns {{ positionNode:*, vDisplacement:* }}
 */
function buildAuroraCurtainNodes(uTime, uLayerOffset) {
    const t = uTime.mul(0.2).add(uLayerOffset);
    const pos = positionLocal;

    const noise1 = snoise3(vec3(pos.x.mul(0.05), pos.y.mul(0.05), t.mul(0.5)));
    const noise2 = snoise3(vec3(pos.x.mul(0.1), pos.y.mul(0.1), t.mul(0.8))).mul(0.5);
    const displacement = noise1.add(noise2);

    // Pass the vertex displacement to the fragment exactly like the GLSL varying.
    const vDisplacement = varying(displacement);

    const transformed = vec3(
        pos.x.add(sin(pos.y.mul(0.05).add(t)).mul(5.0)),
        pos.y,
        pos.z.add(displacement.mul(10.0)),
    );

    return { positionNode: transformed, vDisplacement };
}

/**
 * Resolve the shared time as a TSL node. Post-migration callers (mountain-peaks.js /
 * surface-world.js) pass a TSL `uniform()` node for `uniforms.uTime`, which the graph
 * uses directly. A defensive `uniform()` wrapper is returned for the legacy
 * `{ value }` plain-object form so a stale caller still constructs without throwing.
 * @param {*} sharedTime the caller's `uniforms.uTime`
 * @returns {*} a TSL float node usable in the graph (supports `.mul`)
 */
function resolveTimeNode(sharedTime) {
    if (sharedTime && typeof sharedTime.mul === 'function') {
        return sharedTime;
    }
    return uniform(Number.isFinite(sharedTime?.value) ? sharedTime.value : 0);
}

export function resolveMountainAuroraPreviewOpacity(progress) {
    if (!Number.isFinite(progress)) {
        return 0;
    }

    return THREE.MathUtils.smoothstep(
        progress,
        SURFACE_WORLD_AURORA_PREVIEW_START,
        SURFACE_WORLD_AURORA_PREVIEW_END,
    );
}

export function createMountainAuroraBackdrop(uniforms, options = {}) {
    const {
        layerCount = MOUNTAIN_AURORA_CURTAIN_CONFIGS.length,
        layerOpacities = null,
        name = 'mountain-aurora',
    } = options;

    const group = new THREE.Group();
    group.name = name;

    // Share the caller's uTime node into the TSL graph so its update() ticks unchanged.
    const uTime = resolveTimeNode(uniforms?.uTime);

    const selectedConfigs = MOUNTAIN_AURORA_CURTAIN_CONFIGS.slice(
        0,
        Math.min(layerCount, MOUNTAIN_AURORA_CURTAIN_CONFIGS.length),
    );
    group.userData.auroraAnchors = selectedConfigs.map((config) => ({
        x: config.x,
        y: config.y,
        z: config.z,
        rotY: config.rotY,
    }));

    selectedConfigs.forEach((config, index) => {
        const geometry = new THREE.PlaneGeometry(config.width, config.height, 64, 16);
        const layerOpacity = Number.isFinite(layerOpacities?.[index])
            ? layerOpacities[index]
            : config.opacity;

        // Per-curtain uniforms as TSL nodes. uOpacity/uAuroraFade/uLayerOpacity are
        // exposed back on `material.uniforms` (below) with numeric `.value` so the
        // callers' collectUniformTargets()/update() find and tick them as before.
        const uLayerOffset = uniform(index * 2.0);
        const uColor1 = uniform(new THREE.Color(0x00ffaa));
        const uColor2 = uniform(new THREE.Color(0x00aaff));
        const uColor3 = uniform(new THREE.Color(0xaa00ff));
        const uOpacity = uniform(1);
        const uAuroraFade = uniform(1);
        const uLayerOpacity = uniform(layerOpacity);

        const { positionNode, vDisplacement } = buildAuroraCurtainNodes(uTime, uLayerOffset);

        const vUv = uv();

        // Edge fades (smoothstep windows match the GLSL fragment).
        const yFade = smoothstep(0.0, 0.4, vUv.y)
            .mul(float(1.0).sub(smoothstep(0.7, 1.0, vUv.y)));
        const xFade = smoothstep(0.0, 0.2, vUv.x)
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, vUv.x)));

        // Color gradient + noise-driven tertiary tint.
        const noiseVal = snoise3(vec3(vUv.x.mul(2.0), vUv.y.mul(1.0), uTime.mul(0.1)));
        const colorBase = mix(uColor1, uColor2, vUv.y);
        const color = mix(colorBase, uColor3, smoothstep(0.4, 0.6, noiseVal)).mul(1.1);

        // Vertical bands modulated by the per-vertex displacement varying.
        const bands = sin(vUv.y.mul(20.0).add(vDisplacement.mul(2.0))).mul(0.5).add(0.5);
        const alpha = yFade.mul(xFade)
            .mul(float(0.5).add(bands.mul(0.5)))
            .mul(0.45)
            .mul(uLayerOpacity)
            .mul(uAuroraFade)
            .mul(uOpacity);

        const material = new THREE.MeshBasicNodeMaterial();
        material.positionNode = positionNode;
        material.colorNode = color;
        material.opacityNode = alpha;
        material.transparent = true;
        material.side = THREE.DoubleSide;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.userData.emitsBloom = true;

        // Legacy-shaped uniform bridge: collectUniformTargets()/update() in the callers
        // read & mutate material.uniforms.{uAuroraFade,uOpacity}.value (numeric). These
        // ARE the TSL uniform nodes, so writing .value reactively updates the graph.
        material.uniforms = {
            uTime,
            layerOffset: uLayerOffset,
            uColor1,
            uColor2,
            uColor3,
            uOpacity,
            uAuroraFade,
            uLayerOpacity,
        };

        const curtain = new THREE.Mesh(geometry, material);
        curtain.position.set(config.x, config.y, config.z);
        curtain.rotation.y = config.rotY;
        curtain.renderOrder = -50;
        group.add(curtain);
    });

    return group;
}
