/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, dot, float, mix, normalWorld, normalize,
    positionWorld, smoothstep, uniform, vec3,
} from 'three/tsl';

const ROOT = [0.018, 0.044, 0.018];
const PIGMENT_SCALE = [1.04, 0.94, 0.68];
const TIP_SCALE = [1.12, 1.02, 0.76];
const SCATTER = [0.30, 0.38, 0.085];
const SUN = [-0.16, 0.93, -0.32];
const glslVec = (values) => `vec3(${values.map((value) => value.toFixed(4)).join(', ')})`;

/**
 * Matte, vertex-painted kelp. Blender owns the motion and color variation;
 * this surface adds dark holdfasts, a little leaf transmission and sparse
 * amber growth. It uses neither transmission render targets nor textures.
 */
export function createOceanForestKelpMaterial({ isWebGPU = true, usesNodeMaterials = isWebGPU } = {}) {
    const Material = usesNodeMaterials ? THREE.MeshStandardNodeMaterial : THREE.MeshStandardMaterial;
    const material = new Material({
        color: 0xffffff,
        // The node graph consumes COLOR_0 directly. Enabling the built-in
        // multiplier there would apply the painted pigment twice in r186.
        vertexColors: !usesNodeMaterials,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        transparent: false,
        depthWrite: true,
        roughness: 0.88,
        metalness: 0,
        envMapIntensity: 0.35,
    });
    const makeUniform = (value) => (usesNodeMaterials ? uniform(value) : { value });
    const uTime = makeUniform(0);
    const uCurrentStrength = makeUniform(0.5);
    const uGlowIntensity = makeUniform(0.8);
    material.name = 'Ocean forest olive kelp tissue';
    material.userData = {
        uTime, uCurrentStrength, uGlowIntensity, forestKelp: true,
    };

    if (usesNodeMaterials) {
        const paint = attribute('color', 'vec3');
        const height = attribute('aHeroKelpHeight', 'float').clamp(0, 1);
        const leaf = smoothstep(float(0.025), float(0.68), height);
        const tip = smoothstep(float(0.58), float(0.98), height);
        const pigment = mix(vec3(...ROOT), paint.mul(vec3(...PIGMENT_SCALE)), leaf.mul(0.82).add(0.18));
        material.colorNode = mix(pigment, pigment.mul(vec3(...TIP_SCALE)), tip.mul(0.38));
        material.roughnessNode = mix(float(0.94), float(0.80), leaf);

        // Ochre leaves have R≈G; only the separately painted amber nodules
        // have enough red/green separation to contribute self illumination.
        const growth = smoothstep(float(0.10), float(0.30), paint.r.sub(paint.g))
            .mul(smoothstep(float(0.30), float(0.70), paint.r));
        const view = normalize(cameraPosition.sub(positionWorld));
        const edge = float(1).sub(abs(dot(normalWorld, view))).clamp(0, 1);
        const leafLight = abs(dot(normalWorld, normalize(vec3(...SUN)))).mul(0.65).add(0.35);
        const warmVein = paint.r.sub(paint.b).mul(3).clamp(0, 1);
        const thinLeaf = leaf.mul(float(1).sub(growth));
        const transmission = edge.mul(edge).mul(0.55).add(0.45)
            .mul(leafLight)
            .mul(thinLeaf)
            .mul(tip.mul(0.5).add(warmVein.mul(0.3)).add(0.2))
            .mul(0.18);
        // Under-leaf fill keeps the painted lamina readable against dark
        // water even when the hemisphere light strikes its opposite face.
        const tissueFill = pigment.mul(leaf.mul(0.17).add(0.05)).mul(float(1).sub(growth));
        material.emissiveNode = tissueFill.add(vec3(...SCATTER).mul(transmission))
            .add(paint.mul(growth).mul(1.35).mul(float(0.8).add(uGlowIntensity.mul(0.2))));
    } else {
        // Preserve native morph/normal chunks and use the identical authored
        // pigment and height inputs on classic WebGL's standard material.
        material.uniforms = { uTime, uCurrentStrength, uGlowIntensity };
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uOceanForestGlow = uGlowIntensity;
            shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
                attribute float aHeroKelpHeight;
                varying float vOceanForestHeight;
                varying vec3 vOceanForestNormal;
            `).replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
                vOceanForestNormal = inverseTransformDirection(transformedNormal, viewMatrix);
                vOceanForestHeight = clamp(aHeroKelpHeight, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
                uniform float uOceanForestGlow;
                varying float vOceanForestHeight;
                varying vec3 vOceanForestNormal;
                float oceanForestLeaf() { return smoothstep(0.025, 0.68, vOceanForestHeight); }
                float oceanForestTip() { return smoothstep(0.58, 0.98, vOceanForestHeight); }
                float oceanForestGrowth(vec3 paint) {
                    return smoothstep(0.10, 0.30, paint.r - paint.g) * smoothstep(0.30, 0.70, paint.r);
                }
            `).replace('#include <color_fragment>', `#include <color_fragment>
                vec3 forestPigment = mix(${glslVec(ROOT)}, vColor.rgb * ${glslVec(PIGMENT_SCALE)},
                    oceanForestLeaf() * 0.82 + 0.18);
                diffuseColor.rgb = mix(forestPigment, forestPigment * ${glslVec(TIP_SCALE)},
                    oceanForestTip() * 0.38);
            `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(0.94, 0.80, oceanForestLeaf());
            `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                vec3 forestView = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
                float forestGrowth = oceanForestGrowth(vColor.rgb);
                float forestEdge = clamp(1.0 - abs(dot(normalize(vOceanForestNormal), forestView)), 0.0, 1.0);
                float forestLeafLight = abs(dot(normalize(vOceanForestNormal), normalize(${glslVec(SUN)})))
                    * 0.65 + 0.35;
                float forestVein = clamp((vColor.r - vColor.b) * 3.0, 0.0, 1.0);
                float forestTransmission = (forestEdge * forestEdge * 0.55 + 0.45) * forestLeafLight
                    * oceanForestLeaf() * (1.0 - forestGrowth)
                    * (oceanForestTip() * 0.5 + forestVein * 0.3 + 0.2) * 0.18;
                vec3 forestTissueFill = forestPigment * (oceanForestLeaf() * 0.17 + 0.05) * (1.0 - forestGrowth);
                totalEmissiveRadiance += forestTissueFill + ${glslVec(SCATTER)} * forestTransmission
                    + vColor.rgb * forestGrowth * 1.35 * (0.8 + uOceanForestGlow * 0.2);
            `);
        };
        material.customProgramCacheKey = () => 'ocean-forest-kelp-v1';
    }
    return material;
}
