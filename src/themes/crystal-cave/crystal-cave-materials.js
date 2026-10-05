/** Jeweled facets, mineral strata, and a rippled mirror share one node path. */
import * as THREE from 'three/webgpu';
import {
    abs, cameraPosition, color, dot, exp, float, instanceColor, length, mix,
    normalWorld, normalize, positionGeometry, positionWorld, pow,
    reflector, screenUV, sin, smoothstep, texture, uniform, uv, vec2, vec3, vertexColor,
} from 'three/tsl';
import { seededRandom } from '../../utils/helpers.js';

export function createCrystalCaveUniforms() {
    return {
        time: uniform(0),
        energy: uniform(0),
        resonance: uniform(0),
        waveRadius: uniform(-100),
        waveIntensity: uniform(0),
        waveOrigin: uniform(new THREE.Vector3(0, -7, -8)),
    };
}

function mineralTexture() {
    const size = 128;
    const rng = seededRandom(8317);
    const grids = [4, 8, 16, 32].map((n) => ({ n, data: Float32Array.from({ length: n * n }, rng) }));
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let value = 0;
            let weight = 0.53;
            for (const { n, data: grid } of grids) {
                const px = (x / size) * n; const py = (y / size) * n;
                const ix = Math.floor(px); const iy = Math.floor(py);
                const fx = px - ix; const fy = py - iy;
                const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
                const at = (dx, dy) => grid[((iy + dy) % n) * n + ((ix + dx) % n)];
                value += ((at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy)
                    + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy) * weight;
                weight *= 0.5;
            }
            const offset = (y * size + x) * 4;
            data[offset] = Math.round(value * 255);
            data[offset + 1] = Math.round(Math.abs(value * 2 - 1) * 255);
            data[offset + 2] = Math.round(rng() * 255);
            data[offset + 3] = 255;
        }
    }
    const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    result.wrapS = THREE.RepeatWrapping; result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter; result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true; result.needsUpdate = true;
    return result;
}

export function createCrystalCaveMaterials({ scene, uniforms: u, quality }) {
    const noise = mineralTexture();
    const distance = length(positionWorld.sub(u.waveOrigin));
    const wave = exp(abs(distance.sub(u.waveRadius)).mul(-0.8)).mul(u.waveIntensity);
    const view = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1).sub(abs(dot(normalWorld, view))).clamp(), 3);
    const grain = texture(noise, positionWorld.xz.mul(0.025)).r;

    const crystal = new THREE.MeshPhysicalNodeMaterial({
        vertexColors: true,
        roughness: 0.27,
        metalness: 0.06,
        clearcoat: 0.42,
        clearcoatRoughness: 0.23,
        ior: 1.46,
        specularIntensity: 0.45,
        flatShading: true,
    });
    crystal.name = 'Crystal Cave — opaline mineral facets';
    // True world-space normals keep facets stable during camera drift.
    const striae = sin(positionGeometry.y.mul(29).add(positionGeometry.x.mul(8))).mul(0.008).add(0.992);
    crystal.colorNode = vec3(0.52, 0.61, 0.72).mul(striae);
    const core = smoothstep(0.05, 0.9, positionGeometry.y).mul(0.25).add(0.09);
    const breath = sin(u.time.mul(0.65).add(positionWorld.x.mul(0.17)).add(positionWorld.z.mul(0.09))).mul(0.04).add(0.96);
    const innerVein = pow(sin(positionGeometry.y.mul(18).add(positionGeometry.x.mul(13))).abs(), 26).mul(0.08);
    const tint = instanceColor.mul(vertexColor().rgb);
    crystal.emissiveNode = tint.mul(core.add(rim.mul(0.8)).add(innerVein)
        .add(u.energy.mul(0.25)).add(u.resonance.mul(0.2))
        .add(wave.mul(1.4))).mul(breath);
    // Facet sheen hints at internal refraction without the cost of transparent sorting.
    crystal.emissiveNode = crystal.emissiveNode.add(mix(color(0x7655bc), color(0x62dbe5), rim).mul(rim).mul(0.065));

    const rock = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.07, flatShading: true });
    rock.name = 'Crystal Cave — weathered mineral strata';
    const strata = sin(positionWorld.y.mul(1.1).add(grain.mul(8))).mul(0.5).add(0.5);
    rock.colorNode = mix(color(0x111126), color(0x3b354c), grain.mul(0.8).add(strata.mul(0.2)));
    const veins = pow(sin(positionWorld.y.mul(0.45).add(positionWorld.x.mul(0.25)).add(grain.mul(7))).abs(), 38);
    const sideTint = mix(color(0x7650bf), color(0x137d8f), smoothstep(-20, 20, positionWorld.x));
    rock.emissiveNode = sideTint.mul(veins.mul(0.012).add(wave.mul(0.18)));

    const backdrop = new THREE.MeshBasicNodeMaterial({ depthWrite: false, fog: false });
    backdrop.name = 'Crystal Cave — distant grotto light';
    const p = uv().sub(0.5);
    const glow = exp(length(p.mul(vec2(3.8, 2.8))).mul(-3.4));
    const chamber = sin(p.x.mul(24).add(sin(p.y.mul(12)))).mul(0.5).add(0.5);
    backdrop.colorNode = color(0x080913).add(color(0x154e65).mul(glow).mul(0.55))
        .add(color(0x261645).mul(chamber).mul(0.055));

    const water = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    water.name = 'Crystal Cave — mineral mirror pool';
    const caveFlow = sin(positionWorld.x.mul(0.27).add(u.time.mul(0.32)))
        .add(sin(positionWorld.z.mul(0.19).sub(u.time.mul(0.21))));
    const caveRippleAmplitude = float(0.0013).add(u.energy.mul(0.0007));
    const caveWaterBody = vec3(0.008, 0.017, 0.035);
    const caveWaterTint = mix(
        vec3(0.08, 0.23, 0.25),
        vec3(0.16, 0.07, 0.24),
        smoothstep(-16, 16, positionWorld.x),
    );
    let reflection = null;
    if (quality.reflectionScale > 0) {
        reflection = reflector({ resolutionScale: quality.reflectionScale, bounces: false, samples: 0 });
        reflection.target.rotation.x = -Math.PI / 2;
        reflection.target.position.y = -7;
        scene.add(reflection.target);
        const caveReflected = reflection.sample(screenUV.flipX()
            .add(vec2(caveFlow.mul(caveRippleAmplitude), caveFlow.mul(caveRippleAmplitude).mul(0.5)))).rgb;
        const caveFresnel = cameraPosition.sub(positionWorld).normalize().y.abs().oneMinus()
            .pow(2).mul(0.65)
            .add(0.22);
        water.colorNode = mix(caveWaterBody, caveReflected.mul(vec3(0.87, 0.93, 1.03)), caveFresnel);
    } else {
        // The direct low-tier surface retains a quiet colored sheen without a second scene render.
        const caveSheen = sin(positionWorld.x.mul(0.15).add(caveFlow.mul(0.02))).pow2().mul(0.08);
        water.colorNode = caveWaterBody.add(caveWaterTint.mul(caveSheen));
    }
    water.colorNode = water.colorNode.add(caveWaterTint.mul(0.012));

    const mist = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    mist.name = 'Crystal Cave — soft pool mist';
    mist.colorNode = vec3(0.18, 0.3, 0.42);
    const caveMistUv = uv().sub(0.5).mul(vec2(2, 2.5));
    const caveMistSoftness = caveMistUv.dot(caveMistUv).mul(-3).exp();
    const caveMistDrift = sin(uv().x.mul(19).add(u.time.mul(0.08)))
        .mul(0.12).add(0.88);
    mist.opacityNode = caveMistSoftness.mul(caveMistDrift).mul(0.11);

    const shaft = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    shaft.name = 'Crystal Cave — mineral light shafts';
    shaft.colorNode = vec3(0.32, 0.53, 0.72);
    shaft.opacityNode = uv().x.sub(0.5).mul(8).pow2().negate()
        .exp()
        .mul(smoothstep(0, 0.15, uv().y))
        .mul(smoothstep(1, 0.25, uv().y))
        .mul(0.065);

    const vein = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
    vein.name = 'Crystal Cave — mineral seams';
    vein.colorNode = vec3(1).mul(float(0.42).add(u.energy.mul(0.25)));
    const materials = {
        crystal, rock, water, backdrop, mist, shaft, vein,
    };
    let disposed = false;
    return {
        uniforms: u,
        materials,
        reflection,
        dispose() {
            if (disposed) return;
            disposed = true;
            reflection?.target.removeFromParent();
            reflection?.dispose();
            Object.values(materials).forEach((material) => material.dispose());
            noise.dispose();
        },
    };
}
