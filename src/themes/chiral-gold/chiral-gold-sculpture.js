/**
 * Chiral Gold's continuous sculpture: oppositely handed ribbons suspended in an
 * amber void. The geometry and node graphs are shared by WebGPU and WebGL2.
 *
 * Geometry is baked once. Motion lives in a small set of uniforms and object
 * transforms; event halos reuse a fixed pool instead of allocating at lock time.
 */
import * as THREE from 'three/webgpu';
import {
    abs, cameraPosition, clamp, dot, exp, float, fract, mix,
    normalWorld, normalize, positionLocal, positionWorld, pow, sin, smoothstep,
    uniform, uv, vec2, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
const LENS = { distance: 1520, fov: 64 };

export const CHIRAL_GOLD_SCULPTURE_TIERS = {
    Extreme: {
        segments: 280, ribbons: 3, filaments: 10, halos: 8,
    },
    Ultra: {
        segments: 240, ribbons: 3, filaments: 8, halos: 8,
    },
    High: {
        segments: 192, ribbons: 3, filaments: 6, halos: 6,
    },
    Medium: {
        segments: 152, ribbons: 3, filaments: 4, halos: 4,
    },
    Low: {
        segments: 112, ribbons: 2, filaments: 3, halos: 4,
    },
    Minimal: {
        segments: 80, ribbons: 2, filaments: 2, halos: 2,
    },
};

function saturate(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Opposite signs are actual handedness, rather than a mirrored flat spiral. */
function helixPoint(t, hand, phase, radius = 205, flourish = 0) {
    const theta = hand * (t * TAU * 1.38 + phase);
    const waveRadius = radius * (0.82 + 0.19 * Math.cos(t * TAU * 0.72 + phase * 0.45));
    const taperCurve = Math.sin(t * Math.PI);
    return new THREE.Vector3(
        Math.cos(theta) * waveRadius + Math.sin(t * TAU * 0.61) * 73
            + flourish * taperCurve,
        (t - 0.5) * 2070 + Math.sin(theta * 0.48) * 38,
        Math.sin(theta) * waveRadius * 0.9 + Math.sin(t * TAU) * 40,
    );
}

/**
 * A bevelled ribbon has a real narrow edge and a broad reflective face. Keeping
 * the frame analytical avoids tube-frame flips at the ends of the sculpture.
 */
function ribbonGeometry({
    segments, hand, phase, width, radius, filament = false,
}) {
    const section = filament
        ? [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]]
        : [[-1, -0.35], [-0.94, -1], [0.94, -1], [1, -0.35],
            [1, 0.35], [0.94, 1], [-0.94, 1], [-1, 0.35], [-1, -0.35]];
    const stride = section.length;
    const positions = new Float32Array((segments + 1) * stride * 3);
    const uvs = new Float32Array((segments + 1) * stride * 2);
    const indices = new Uint32Array(segments * (stride - 1) * 6);
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3();
    const wide = new THREE.Vector3();
    const thin = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const vertex = new THREE.Vector3();

    for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const center = helixPoint(t, hand, phase, radius);
        tangent.copy(helixPoint(Math.min(1, t + 0.001), hand, phase, radius))
            .sub(helixPoint(Math.max(0, t - 0.001), hand, phase, radius)).normalize();
        normal.crossVectors(tangent, up).normalize();
        binormal.crossVectors(tangent, normal).normalize();
        const twist = t * TAU * hand * 0.83 + phase * 0.9;
        wide.copy(normal).multiplyScalar(Math.cos(twist))
            .addScaledVector(binormal, Math.sin(twist));
        thin.crossVectors(tangent, wide).normalize();
        const tip = Math.max(0.025, Math.sin(Math.PI * t)) ** 0.58;
        const halfWidth = width * tip * (0.76 + Math.sin(t * TAU + phase) * 0.19);
        const halfThickness = filament ? halfWidth : Math.max(1.8, width * 0.052 * tip);
        for (let j = 0; j < stride; j += 1) {
            const k = (i * stride + j) * 3;
            vertex.copy(center).addScaledVector(wide, section[j][0] * halfWidth)
                .addScaledVector(thin, section[j][1] * halfThickness);
            positions[k] = vertex.x;
            positions[k + 1] = vertex.y;
            positions[k + 2] = vertex.z;
            uvs[(i * stride + j) * 2] = t;
            uvs[(i * stride + j) * 2 + 1] = j / (stride - 1);
        }
    }
    let cursor = 0;
    for (let i = 0; i < segments; i += 1) {
        for (let j = 0; j < stride - 1; j += 1) {
            const a = i * stride + j;
            const b = a + stride;
            indices[cursor++] = a;
            indices[cursor++] = b;
            indices[cursor++] = a + 1;
            indices[cursor++] = a + 1;
            indices[cursor++] = b;
            indices[cursor++] = b + 1;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function tagMaterial(material, emissiveNode, role) {
    material.emissiveNode = emissiveNode;
    material.userData.emitsBloom = true;
    material.userData.mrtRole = role;
    return material;
}

/** Four bounded wavefronts travel away from the initiating lock's height. */
function travellingPulse(t, uniforms) {
    let result = float(0);
    for (const channel of ['x', 'y', 'z', 'w']) {
        const offset = abs(t.sub(uniforms.waveOrigins[channel])).sub(uniforms.waveRadii[channel]);
        result = result.add(exp(offset.mul(offset).mul(-350)).mul(uniforms.waveStrengths[channel]));
    }
    return result;
}

function createFoilMaterial(uniforms) {
    const {
        time, pulse, energy, heat,
    } = uniforms;
    const surfaceUv = uv();
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const key = normalize(vec3(-0.48, 0.72, 0.66));
    const bounce = normalize(vec3(0.72, -0.21, 0.82));
    const facing = abs(dot(N, V));
    const fresnel = pow(float(1).sub(clamp(facing, 0, 1)), 2.8);
    const diffuse = abs(dot(N, key));
    const broadReflection = pow(abs(dot(N, normalize(key.add(V)))), 12);
    const glint = pow(abs(dot(N, normalize(bounce.add(V)))), 85);
    const brushed = sin(surfaceUv.x.mul(1500).add(surfaceUv.y.mul(80))).mul(0.022).add(0.978);
    const reflectionBand = sin(surfaceUv.x.mul(19).sub(time.mul(0.2))).mul(0.5).add(0.5);
    const movingHead = fract(time.mul(0.042).add(surfaceUv.y.mul(0.055)));
    const d = abs(surfaceUv.x.sub(movingHead));
    const sweep = exp(d.mul(d).mul(-420));
    const eventFront = travellingPulse(surfaceUv.x, uniforms);
    const coreGold = mix(vec3(0.58, 0.22, 0.027), vec3(0.94, 0.56, 0.13), reflectionBand.mul(0.48));
    const base = coreGold.mul(diffuse.mul(0.64).add(0.12)).mul(brushed);
    const hot = vec3(1.0, 0.81, 0.42).mul(broadReflection.mul(1.3))
        .add(vec3(1.0, 0.95, 0.76).mul(glint.mul(4.4)))
        .add(vec3(0.95, 0.48, 0.075).mul(fresnel.mul(0.45)))
        .add(vec3(1.0, 0.78, 0.30).mul(sweep).mul(pulse.mul(0.9).add(0.1)))
        .add(vec3(1.0, 0.90, 0.58).mul(eventFront).mul(1.7));
    const color = base.add(hot).mul(energy.mul(0.16).add(1));
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'ChiralGold / sculpted gold foil';
    material.colorNode = mix(color, color.mul(vec3(1.10, 0.93, 0.74)), heat.mul(0.3));
    // Give bloom only the narrow reflected glints, preserving the dark gold body.
    return tagMaterial(material, hot.mul(0.42), 'sculptureFoil');
}

function createFilamentMaterial(uniforms) {
    const { time, pulse, energy } = uniforms;
    const t = uv().x;
    const flow = sin(t.mul(31).sub(time.mul(0.62))).mul(0.5).add(0.5);
    const glint = pow(flow, 12);
    const eventFront = travellingPulse(t, uniforms);
    const tip = smoothstep(0.0, 0.035, t).mul(float(1).sub(smoothstep(0.965, 1, t)));
    const color = mix(vec3(0.76, 0.30, 0.044), vec3(1.0, 0.83, 0.44), glint)
        .mul(glint.mul(2.1).add(0.65)).mul(pulse.mul(0.85).add(1))
        .add(vec3(1.0, 0.94, 0.68).mul(eventFront).mul(3.2));
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
    });
    material.name = 'ChiralGold / flowing fine gold';
    material.colorNode = color;
    material.opacityNode = tip.mul(energy.mul(0.14).add(0.78));
    return tagMaterial(material, color.mul(tip).mul(0.65), 'sculptureFilament');
}

function createAtmosphereMaterial(uniforms) {
    const p = uv().mul(2).sub(1);
    const drift = sin(uniforms.time.mul(0.036)).mul(0.045);
    const leftP = p.sub(vec2(-0.73, -0.16)).add(vec2(drift, 0));
    const rightP = p.sub(vec2(0.73, 0.22)).sub(vec2(drift, 0));
    const leftPool = exp(leftP.x.mul(leftP.x).mul(-14).sub(leftP.y.mul(leftP.y).mul(2.1)));
    const rightPool = exp(rightP.x.mul(rightP.x).mul(-12).sub(rightP.y.mul(rightP.y).mul(2.8)));
    const overhead = exp(p.x.mul(p.x).mul(-2.3).sub(p.y.sub(0.95).pow(2).mul(19)));
    const veil = sin(p.x.mul(6.2).add(p.y.mul(2.5)).add(uniforms.time.mul(0.025))).mul(0.16).add(0.84);
    const centerQuiet = smoothstep(0.07, 0.4, abs(p.x));
    const pools = leftPool.mul(0.82).add(rightPool).mul(veil).mul(centerQuiet);
    const color = vec3(0.0022, 0.0014, 0.0007)
        .add(vec3(0.077, 0.028, 0.0047).mul(pools).mul(uniforms.pulse.mul(0.5).add(1)))
        .add(vec3(0.039, 0.015, 0.0054).mul(overhead));
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, depthWrite: false });
    material.name = 'ChiralGold / amber atmospheric pools';
    material.colorNode = color;
    material.userData.emitsBloom = false;
    return material;
}

function createHaloMaterial() {
    const opacity = uniform(0);
    const heat = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
    });
    material.name = 'ChiralGold / reaction corona';
    const color = mix(vec3(1.0, 0.43, 0.055), vec3(1.0, 0.92, 0.62), heat).mul(2.9);
    material.colorNode = color;
    material.opacityNode = opacity;
    tagMaterial(material, color.mul(opacity), 'sculptureHalo');
    return { material, opacity, heat };
}

/**
 * @param {{ scene: THREE.Scene, quality?: string, random?: () => number }} options
 * @returns {object} The owned sculpture and its finite, pooled reactions.
 */
export function createChiralGoldSculpture({ scene, quality = 'High', random = Math.random }) {
    const tier = CHIRAL_GOLD_SCULPTURE_TIERS[quality] || CHIRAL_GOLD_SCULPTURE_TIERS.High;
    const root = new THREE.Group();
    root.name = 'ChiralGold / paired chiral sculpture';
    scene.add(root);
    const uniforms = {
        time: uniform(0),
        pulse: uniform(0),
        energy: uniform(0),
        heat: uniform(0),
        waveOrigins: uniform(new THREE.Vector4(0.5, 0.5, 0.5, 0.5)),
        waveRadii: uniform(new THREE.Vector4(0, 0, 0, 0)),
        waveStrengths: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
    const waves = Array.from({ length: 4 }, () => ({ age: 10, strength: 0 }));
    const geometries = new Set();
    const materials = new Set();
    const foil = createFoilMaterial(uniforms);
    const filament = createFilamentMaterial(uniforms);
    materials.add(foil);
    materials.add(filament);
    const sideGroups = [];
    const ribbonMeshes = [];
    let disposed = false;
    let time = 0;
    let kick = 0;
    let heat = 0;
    let lastSide = 1;
    let nextHaloIndex = 0;
    let nextWaveIndex = 0;
    let viewportHalfWidth = 1700;
    let portrait = false;

    const atmosphereGeometry = new THREE.PlaneGeometry(2, 2);
    const atmosphereMaterial = createAtmosphereMaterial(uniforms);
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphere.name = 'ChiralGold / atmospheric backdrop';
    atmosphere.position.z = -1750;
    atmosphere.renderOrder = -20;
    atmosphere.frustumCulled = false;
    root.add(atmosphere);
    geometries.add(atmosphereGeometry);
    materials.add(atmosphereMaterial);

    for (let side = -1; side <= 1; side += 2) {
        const group = new THREE.Group();
        group.name = side < 0 ? 'ChiralGold / left-handed weave' : 'ChiralGold / right-handed weave';
        root.add(group);
        const hand = side;
        for (let i = 0; i < tier.ribbons; i += 1) {
            const geometry = ribbonGeometry({
                segments: tier.segments,
                hand,
                phase: (i * TAU) / 3 + (side > 0 ? 0.7 : 0),
                width: 39 + i * 8,
                radius: 188 + i * 20,
            });
            const ribbon = new THREE.Mesh(geometry, foil);
            ribbon.name = `ChiralGold / ribbon ${side} ${i}`;
            ribbon.userData.phase = i * 1.2 + (side > 0 ? 0.75 : 0);
            group.add(ribbon);
            ribbonMeshes.push(ribbon);
            geometries.add(geometry);
        }
        for (let i = 0; i < tier.filaments; i += 1) {
            const geometry = ribbonGeometry({
                segments: Math.max(80, Math.floor(tier.segments * 0.82)),
                hand,
                phase: (i * TAU) / tier.filaments + 0.32,
                width: 0.85 + (i % 3) * 0.33,
                radius: 242 + i * 8,
                filament: true,
            });
            const mesh = new THREE.Mesh(geometry, filament);
            mesh.name = `ChiralGold / fine filament ${side} ${i}`;
            group.add(mesh);
            geometries.add(geometry);
        }
        sideGroups.push({ group, side });
    }

    // The distant elliptical orbit carries the same gold through the upper frame.
    const orbitGeometry = new THREE.TorusGeometry(1, 0.0011, 4, Math.max(96, tier.segments));
    geometries.add(orbitGeometry);
    const orbitMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    orbitMaterial.name = 'ChiralGold / distant orbit';
    const orbitColor = vec3(0.94, 0.46, 0.10).mul(uniforms.pulse.mul(0.3).add(0.85));
    const orbitMask = smoothstep(-0.06, 0.8, positionLocal.y);
    orbitMaterial.colorNode = orbitColor;
    orbitMaterial.opacityNode = orbitMask.mul(0.44);
    tagMaterial(orbitMaterial, orbitColor.mul(orbitMask).mul(0.3), 'sculptureOrbit');
    materials.add(orbitMaterial);
    const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
    orbit.name = 'ChiralGold / distant golden crown';
    orbit.position.set(0, 40, -1050);
    orbit.rotation.set(0.12, -0.12, -0.15);
    root.add(orbit);

    const haloGeometry = new THREE.TorusGeometry(1, 0.006, 4, 96);
    geometries.add(haloGeometry);
    const halos = Array.from({ length: tier.halos }, () => {
        const { material, opacity, heat: haloHeat } = createHaloMaterial();
        materials.add(material);
        const mesh = new THREE.Mesh(haloGeometry, material);
        mesh.visible = false;
        mesh.name = 'ChiralGold / pooled event corona';
        root.add(mesh);
        return {
            mesh,
            opacity,
            heat: haloHeat,
            age: 10,
            life: 1.6,
            strength: 0,
            baseX: 0,
            baseY: 0,
            side: 1,
            phase: random() * TAU,
        };
    });

    const resize = (width, height, cameraDistance = LENS.distance) => {
        if (disposed) return;
        const aspect = Math.max(0.2, width / Math.max(1, height));
        portrait = aspect < 1;
        const planeHalfHeight = Math.tan((LENS.fov * Math.PI) / 360) * (cameraDistance + 400);
        viewportHalfWidth = planeHalfHeight * aspect;
        const halfHeight = Math.tan((LENS.fov * Math.PI) / 360) * (cameraDistance + 1750);
        atmosphere.scale.set(halfHeight * aspect * 1.22, halfHeight * 1.18, 1);
        // On a phone the entire artwork survives as two slender gold columns.
        // It does not switch to an unrelated low-tier particle-only composition.
        const sideX = viewportHalfWidth * (portrait ? 0.84 : 0.59);
        const sideWidth = Math.min(1.24, Math.max(0.25, viewportHalfWidth / 1300));
        const verticalScale = planeHalfHeight / 1260;
        for (const entry of sideGroups) {
            entry.group.position.set(entry.side * sideX, entry.side * 34, -400);
            entry.group.scale.set(sideWidth, verticalScale, sideWidth);
            entry.group.userData.baseX = entry.side * sideX;
            entry.group.userData.baseY = entry.side * 34;
        }
        const orbitHalfHeight = Math.tan((LENS.fov * Math.PI) / 360) * (cameraDistance + 1050);
        orbit.scale.set(viewportHalfWidth * (portrait ? 1.30 : 0.84), orbitHalfHeight * 0.80, 460);
    };

    const trigger = (kind = 'lock', strength = 1, position = null) => {
        if (disposed) return;
        const force = Math.min(2.4, Math.max(0.15, Number.isFinite(strength) ? strength : 1));
        const heroEvent = kind === 'combo' || kind === 'tetris' || kind === 'levelUp';
        kick = Math.min(2, kick + force * (heroEvent ? 0.65 : 0.19));
        heat = Math.min(1, heat + force * 0.18);
        if (kind === 'beat') return;
        const origin = Number.isFinite(position?.y) ? saturate((position.y + 1035) / 2070) : 0.5;
        const wave = waves[nextWaveIndex];
        wave.age = 0;
        wave.strength = force * (heroEvent ? 0.83 : 0.48);
        uniforms.waveOrigins.value.setComponent(nextWaveIndex, origin);
        uniforms.waveRadii.value.setComponent(nextWaveIndex, 0);
        uniforms.waveStrengths.value.setComponent(nextWaveIndex, wave.strength);
        nextWaveIndex = (nextWaveIndex + 1) % waves.length;
        const count = heroEvent ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
            const halo = halos[nextHaloIndex];
            nextHaloIndex = (nextHaloIndex + 1) % halos.length;
            let side;
            if (count === 2) side = i ? 1 : -1;
            else {
                lastSide *= -1;
                side = lastSide;
            }
            halo.age = 0;
            halo.life = heroEvent ? 2.15 : 1.55;
            halo.strength = force * (heroEvent ? 1.15 : 0.58);
            halo.side = side;
            halo.baseX = Number.isFinite(position?.x) && Math.abs(position.x) > viewportHalfWidth * 0.34
                ? position.x : sideGroups[side < 0 ? 0 : 1].group.position.x;
            halo.baseY = Number.isFinite(position?.y) ? THREE.MathUtils.clamp(position.y, -700, 700)
                : Math.sin(time * 0.57 + i * 2.1) * 360;
            halo.heat.value = heroEvent ? 0.82 : 0.32;
            halo.mesh.visible = true;
            halo.mesh.rotation.set(side * 0.55, side * 0.48, time * 0.08 + i * 0.7 + halo.phase * 0.08);
            halo.mesh.position.set(halo.baseX, halo.baseY, -110);
            halo.opacity.value = 0;
        }
    };

    const update = (nextTime, delta = 0, state = {}) => {
        if (disposed) return;
        time = Number.isFinite(nextTime) ? nextTime : time;
        const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
        kick *= Math.exp(-dt * 2.25);
        heat *= Math.exp(-dt * 0.62);
        uniforms.time.value = time;
        uniforms.energy.value = saturate(state.energy);
        uniforms.pulse.value = Math.min(2, kick + saturate(state.pulse) * 0.65 + saturate(state.beat) * 0.35);
        uniforms.heat.value = heat;
        for (let i = 0; i < waves.length; i += 1) {
            const wave = waves[i];
            if (wave.age > 2) continue;
            wave.age += dt;
            uniforms.waveRadii.value.setComponent(i, wave.age * 0.62);
            uniforms.waveStrengths.value.setComponent(i, wave.age > 2 ? 0 : wave.strength * Math.exp(-wave.age * 1.2));
        }
        for (const { group, side } of sideGroups) {
            group.rotation.y = Math.sin(time * 0.074 + side * 0.7) * 0.16;
            group.rotation.z = side * (0.055 + Math.sin(time * 0.052 + side * 0.4) * 0.024);
            group.position.x = group.userData.baseX + side * Math.sin(time * 0.066) * (portrait ? 5 : 15);
            group.position.y = group.userData.baseY + Math.sin(time * 0.093 + side) * 27;
        }
        for (const ribbon of ribbonMeshes) {
            ribbon.rotation.y = Math.sin(time * 0.11 + ribbon.userData.phase) * 0.08;
        }
        orbit.rotation.z = -0.15 + Math.sin(time * 0.025) * 0.08;
        for (const halo of halos) {
            if (!halo.mesh.visible) continue;
            halo.age += dt;
            const progress = halo.age / halo.life;
            if (progress >= 1) {
                halo.mesh.visible = false;
                halo.opacity.value = 0;
                continue;
            }
            const radius = (40 + progress * 250) * Math.sqrt(halo.strength);
            halo.mesh.scale.set(radius * (portrait ? 0.42 : 1), radius * 1.38, radius);
            halo.mesh.position.x = halo.baseX + halo.side * progress * (portrait ? 14 : 75);
            halo.mesh.position.y = halo.baseY + progress * 95;
            halo.mesh.rotation.z += dt * halo.side * 0.21;
            halo.opacity.value = Math.sin(Math.PI * progress) ** 1.25 * (1 - progress) * 0.58;
        }
    };

    resize(1600, 900);
    return {
        root,
        resize,
        update,
        trigger,
        resetReactions() {
            kick = 0;
            heat = 0;
            nextHaloIndex = 0;
            nextWaveIndex = 0;
            uniforms.pulse.value = 0;
            uniforms.heat.value = 0;
            uniforms.waveStrengths.value.set(0, 0, 0, 0);
            waves.forEach((wave) => { wave.age = 10; });
            halos.forEach((halo) => {
                halo.age = 10;
                halo.mesh.visible = false;
                halo.opacity.value = 0;
            });
        },
        stats: { ribbonCount: tier.ribbons * 2, filamentCount: tier.filaments * 2, haloPoolSize: tier.halos },
        diagnostics() {
            return {
                quality,
                ribbonCount: tier.ribbons * 2,
                filamentCount: tier.filaments * 2,
                haloPoolSize: tier.halos,
                activeHalos: halos.filter((halo) => halo.mesh.visible).length,
                travelFrontPoolSize: waves.length,
                activeTravelFronts: waves.filter((wave) => wave.age <= 2).length,
                disposed,
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            root.removeFromParent();
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            root.clear();
        },
    };
}
