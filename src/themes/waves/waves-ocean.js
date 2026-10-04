/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** A sculpted, flowing surf barrel. Shared TSL graphs for both renderer backends. */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cos, cross, dot, exp,
    float, fract, length, mix, normalize, positionGeometry, positionWorld,
    pow, sin, smoothstep, texture, uniform, uniformArray, instanceIndex,
    uv, vec2, vec3, vec4, varying,
} from 'three/tsl';
import { WAVES_REACTION_LIMITS } from './waves-reactions.js';

export const OCEAN_TIERS = Object.freeze({
    Extreme: {
        around: 192, depth: 144, spray: 1700, shafts: 8, noise: 256,
    },
    Ultra: {
        around: 160, depth: 120, spray: 1300, shafts: 7, noise: 256,
    },
    High: {
        around: 128, depth: 96, spray: 1000, shafts: 6, noise: 256,
    },
    Medium: {
        around: 96, depth: 72, spray: 600, shafts: 5, noise: 128,
    },
    Low: {
        around: 64, depth: 48, spray: 300, shafts: 4, noise: 128,
    },
    Minimal: {
        around: 48, depth: 32, spray: 150, shafts: 3, noise: 64,
    },
});

export function createOceanNoise(size = 256) {
    const data = new Uint8Array(size * size * 4);
    let state = 732491;
    const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
    for (let channel = 0; channel < 3; channel += 1) {
        const field = new Float32Array(size * size);
        let weight = 0.5;
        let total = 0;
        for (let grid = 4; grid <= 64; grid *= 2) {
            const cells = Float32Array.from({ length: grid * grid }, random);
            for (let y = 0; y < size; y += 1) {
                const py = (y * grid) / size;
                const iy = Math.floor(py);
                const fy = py - iy;
                const sy = fy * fy * (3 - 2 * fy);
                for (let x = 0; x < size; x += 1) {
                    const px = (x * grid) / size;
                    const ix = Math.floor(px);
                    const fx = px - ix;
                    const sx = fx * fx * (3 - 2 * fx);
                    const a = cells[iy * grid + ix];
                    const b = cells[iy * grid + ((ix + 1) % grid)];
                    const c = cells[((iy + 1) % grid) * grid + ix];
                    const d = cells[((iy + 1) % grid) * grid + ((ix + 1) % grid)];
                    field[y * size + x] += ((a + (b - a) * sx) * (1 - sy)
                        + (c + (d - c) * sx) * sy) * weight;
                }
            }
            total += weight;
            weight *= 0.52;
        }
        for (let i = 0; i < field.length; i += 1) data[i * 4 + channel] = Math.round((field[i] / total) * 255);
    }
    for (let i = 0; i < size * size; i += 1) data[i * 4 + 3] = 255;
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    map.name = 'waves-periodic-water-density';
    return map;
}

function material(name, options = {}) {
    const result = new THREE.MeshBasicNodeMaterial({ fog: false, ...options });
    result.name = `waves-${name}`;
    result.emissiveNode = vec3(0);
    return result;
}

function barrelGeometry(around, depth) {
    const positions = [];
    const normals = [];
    const coordinates = [];
    const indices = [];
    for (let j = 0; j <= depth; j += 1) {
        for (let i = 0; i <= around; i += 1) {
            const angle = (i / around) * Math.PI * 2;
            positions.push(Math.cos(angle) * 14, Math.sin(angle) * 14, -32 + (j / depth) * 78);
            normals.push(-Math.cos(angle), -Math.sin(angle), 0);
            coordinates.push(i / around, j / depth);
            if (i < around && j < depth) {
                const a = j * (around + 1) + i;
                const b = a + around + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
    geometry.setIndex(indices);
    return geometry;
}

function instancedPlane(count, seeds) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes = base.attributes;
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    return geometry;
}

export class WavesOcean {
    constructor({
        scene, camera, quality = 'High', rng = Math.random,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = OCEAN_TIERS[quality] ? quality : 'High';
        this.tier = OCEAN_TIERS[this.quality];
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'waves-ocean';
        this.noise = createOceanNoise(this.tier.noise);
        this.time = uniform(0);
        this.pulse = uniform(0);
        this.foam = uniform(0);
        this.spray = uniform(0);
        this.shafts = uniform(0);
        this.surgeStrength = uniform(0);
        this.surgeZ = uniform(-20);
        const impactCount = WAVES_REACTION_LIMITS[this.quality];
        this.impactData = Array.from({ length: impactCount }, () => new THREE.Vector4(0, 0, 1, 0));
        this.impacts = uniformArray(this.impactData, 'vec4');
        this.nextBoardCheck = 0;
        this.hasBoard = false;
        this.boardTopRatio = null;
        const surface = Fn(([angle, z, time, surgeZ, surgeStrength]) => {
            const depth = smoothstep(-32, 46, z).toVar();
            const wave = sin(angle.mul(5).add(z.mul(0.44)).sub(time.mul(0.85))).mul(0.23)
                .add(sin(angle.mul(9).sub(z.mul(0.28)).add(time.mul(1.2))).mul(0.10)).toVar();
            const swell = exp(pow(z.sub(surgeZ), 2).mul(-0.045)).mul(surgeStrength).mul(0.45).toVar();
            const radius = float(14.7).sub(depth.mul(3.4)).add(sin(angle.mul(2).add(z.mul(0.025))).mul(0.85))
                .add(wave)
                .add(swell)
                .toVar();
            return vec3(
                cos(angle).mul(radius).add(depth.mul(7)),
                sin(angle).mul(radius).mul(0.88).add(depth.mul(1.2)),
                z,
            );
        }).setLayout({
            name: 'wavesSurface',
            type: 'vec3',
            inputs: [
                { name: 'angle', type: 'float' }, { name: 'z', type: 'float' },
                { name: 'time', type: 'float' }, { name: 'surgeZ', type: 'float' },
                { name: 'surgeStrength', type: 'float' },
            ],
        });
        this.surface = (angle, z) => surface(angle, z, this.time, this.surgeZ, this.surgeStrength);
        const surfaceNormal = Fn(([angle, z, time, surgeZ, surgeStrength]) => {
            const t = z.add(32).div(78).clamp(0, 1).toVar();
            const depth = t.mul(t).mul(float(3).sub(t.mul(2))).toVar();
            const depthSlope = t.mul(float(1).sub(t)).mul(6 / 78).toVar();
            const a = angle.mul(5).add(z.mul(0.44)).sub(time.mul(0.85)).toVar();
            const b = angle.mul(9).sub(z.mul(0.28)).add(time.mul(1.2)).toVar();
            const c = angle.mul(2).add(z.mul(0.025)).toVar();
            const swell = exp(pow(z.sub(surgeZ), 2).mul(-0.045)).mul(surgeStrength).mul(0.45).toVar();
            const radius = float(14.7).sub(depth.mul(3.4)).add(sin(c).mul(0.85))
                .add(sin(a).mul(0.23))
                .add(sin(b).mul(0.1))
                .add(swell)
                .toVar();
            const da = cos(c).mul(1.7).add(cos(a).mul(1.15)).add(cos(b).mul(0.9))
                .toVar();
            const dz = depthSlope.mul(-3.4).add(cos(c).mul(0.02125)).add(cos(a).mul(0.1012))
                .sub(cos(b).mul(0.028))
                .sub(swell.mul(z.sub(surgeZ)).mul(0.09))
                .toVar();
            const tangentA = vec3(
                cos(angle).mul(da).sub(sin(angle).mul(radius)),
                sin(angle).mul(da).add(cos(angle).mul(radius)).mul(0.88),
                0,
            ).toVar();
            const tangentZ = vec3(
                cos(angle).mul(dz).add(depthSlope.mul(7)),
                sin(angle).mul(dz).mul(0.88).add(depthSlope.mul(1.2)),
                1,
            ).toVar();
            return normalize(cross(tangentA, tangentZ));
        }).setLayout({
            name: 'wavesSurfaceNormal',
            type: 'vec3',
            inputs: [
                { name: 'angle', type: 'float' }, { name: 'z', type: 'float' },
                { name: 'time', type: 'float' }, { name: 'surgeZ', type: 'float' },
                { name: 'surgeStrength', type: 'float' },
            ],
        });
        this.surfaceNormal = (angle, z) => surfaceNormal(angle, z, this.time, this.surgeZ, this.surgeStrength);
    }

    build() {
        this.createSky();
        this.createWater();
        this.createSpray();
        this.createRipples();
        this.createImpactSpray();
        this.createCrestSpray();
        this.createShafts();
        this.scene.add(this.group);
        this.prepareCamera(this.camera.aspect, false);
        return this;
    }

    createSky() {
        const sky = material('sunset-sky', { depthWrite: false, depthTest: false });
        const field = Fn(() => {
            const q = uv().toVar();
            const p = q.sub(vec2(0.57, 0.54)).mul(vec2(1.6, 1)).toVar();
            const glow = exp(length(p).mul(-9)).toVar();
            const sun = float(1).sub(smoothstep(0.019, 0.024, length(p))).toVar();
            const clouds = texture(this.noise, q.mul(vec2(1.4, 3.8)).add(vec2(this.time.mul(0.0008), 0))).r.toVar();
            const cloudBand = smoothstep(0.43, 0.66, clouds).mul(exp(abs(q.y.sub(0.56)).mul(-6))).toVar();
            const horizonGlow = exp(abs(q.y.sub(0.50)).mul(-7));
            const gradient = mix(vec3(0.035, 0.12, 0.24), vec3(0.74, 0.38, 0.18), horizonGlow).toVar();
            const skyColor = gradient.add(vec3(0.7, 0.4, 0.18).mul(glow))
                .mul(float(1).sub(cloudBand.mul(0.45))).add(vec3(0.78, 0.49, 0.26).mul(cloudBand).mul(glow));
            const sea = mix(vec3(0.012, 0.11, 0.17), vec3(0.08, 0.30, 0.34), q.y.mul(2));
            const seaNoise = texture(this.noise, q.mul(vec2(4, 15)).sub(vec2(0, this.time.mul(0.004)))).r.toVar();
            const ripples = sin(q.y.mul(550).add(seaNoise.mul(8))).mul(0.5).add(0.5).toVar();
            const reflection = exp(abs(q.x.sub(0.57)).mul(-35)).mul(ripples).mul(0.22);
            const ocean = sea.mul(ripples.mul(0.13).add(0.87)).add(vec3(0.83, 0.49, 0.23).mul(reflection));
            return mix(
                ocean,
                skyColor,
                smoothstep(0.44, 0.445, q.y),
            ).add(vec3(2.0, 1.4, 0.65).mul(sun));
        })();
        sky.colorNode = field;
        sky.emissiveNode = field.sub(0.6).max(0).mul(0.2);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 100), sky);
        mesh.position.set(7, 1, 85);
        mesh.rotation.y = Math.PI;
        mesh.renderOrder = -100;
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    createWater() {
        const water = material('sculpted-water', { side: THREE.DoubleSide });
        water.positionNode = this.surface(uv().x.mul(Math.PI * 2), uv().y.mul(78).sub(32));
        const field = Fn(() => {
            const q = uv().toVar();
            const angle = q.x.mul(Math.PI * 2).toVar();
            const flow = vec2(q.x.mul(4).add(q.y.mul(0.8)), q.y.mul(5).sub(this.time.mul(0.035))).toVar();
            const coarse = texture(this.noise, flow).rgb.toVar();
            const fine = texture(this.noise, flow.mul(4).add(vec2(this.time.mul(0.012), 0))).rgb.toVar();
            // Analytic derivatives remain smooth between triangles and follow the actual swell.
            const geometricNormal = this.surfaceNormal(angle, q.y.mul(78).sub(32)).toVar();
            const tangent = vec3(sin(angle).negate(), cos(angle).mul(0.88), 0).toVar();
            const normal = normalize(geometricNormal.add(tangent.mul(fine.r.sub(0.5)).mul(0.22))
                .add(vec3(0, 0, fine.g.sub(0.5).mul(0.11)))).toVar();
            const view = normalize(cameraPosition.sub(positionWorld)).toVar();
            const fresnel = pow(float(1).sub(abs(dot(normal, view))), 3).toVar();
            const light = normalize(vec3(7, 5, 70).sub(positionWorld)).toVar();
            const sheen = pow(abs(dot(normal, normalize(light.add(view)))), 28).toVar();
            const transmitted = smoothstep(-0.6, 1, sin(angle)).mul(q.y.mul(0.6).add(0.35)).toVar();
            const body = mix(vec3(0.002, 0.025, 0.055), vec3(0.018, 0.38, 0.43), transmitted)
                .mul(coarse.g.mul(0.75).add(0.7)).toVar();
            const filaments = pow(float(1).sub(abs(coarse.r.sub(0.5)).mul(2)), 22)
                .mul(smoothstep(0.34, 0.67, fine.g)).toVar();
            const crest = smoothstep(0.55, 0.95, sin(angle))
                .mul(smoothstep(0.43, 0.69, coarse.b.add(fine.b.mul(0.15)))).toVar();
            const lace = smoothstep(0.44, 0.67, fine.r).mul(crest).mul(0.7)
                .add(filaments.mul(0.23))
                .mul(float(1).add(this.foam.mul(0.4)))
                .clamp(0, 0.85)
                .toVar();
            const reflection = mix(vec3(0.022, 0.12, 0.23), vec3(0.24, 0.47, 0.51), fine.g)
                .mul(fresnel).mul(0.75).toVar();
            const caustic = filaments.mul(transmitted).mul(0.35).toVar();
            const base = body.add(reflection).add(vec3(0.025, 0.20, 0.19).mul(caustic))
                .add(vec3(0.62, 0.46, 0.23).mul(sheen).mul(q.y.mul(0.45).add(0.1)))
                .mul(float(1).add(this.pulse.mul(0.08)))
                .toVar();
            return vec4(mix(base, vec3(0.54, 0.80, 0.79).mul(fine.g.mul(0.4).add(0.8)), lace), lace);
        })();
        water.colorNode = field.rgb;
        water.emissiveNode = vec3(0.035, 0.18, 0.19).mul(field.a).mul(this.pulse).mul(0.12);
        const mesh = new THREE.Mesh(barrelGeometry(this.tier.around, this.tier.depth), water);
        mesh.name = 'waves-sculpted-barrel';
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.water = mesh;
    }

    createSpray() {
        const seeds = new Float32Array(this.tier.spray * 4);
        for (let i = 0; i < this.tier.spray; i += 1) {
            seeds.set([this.rng(), this.rng(), this.rng(), this.rng()], i * 4);
        }
        const spray = material('salt-spray', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const seed = attribute('aSeed', 'vec4');
        const seedFlat = varying(seed, 'vWaveSpraySeed').setInterpolation('flat');
        spray.positionNode = Fn(() => {
            const z = fract(seed.z.add(this.time.mul(0.008))).mul(66).sub(19).toVar();
            const angle = seed.x.mul(Math.PI * 2).add(this.time.mul(0.025)).toVar();
            const radius = seed.y.mul(5).add(6).toVar();
            const size = seed.w.mul(0.055).add(0.028).mul(float(1).add(this.spray.mul(0.25))).toVar();
            return vec3(
                cos(angle).mul(radius).add(z.add(32).mul(0.09)),
                sin(angle).mul(radius).mul(0.85),
                z,
            ).add(vec3(positionGeometry.xy.mul(size), 0));
        })();
        const r = length(uv().sub(0.5).mul(2));
        const rim = exp(abs(r.sub(0.56)).mul(-15));
        const soft = exp(r.mul(r).mul(-12));
        spray.colorNode = mix(vec3(0.28, 0.59, 0.63), vec3(0.89, 0.76, 0.53), seedFlat.z);
        spray.opacityNode = rim.mul(0.3).add(soft.mul(0.18)).mul(seedFlat.w.mul(0.5).add(0.5))
            .mul(float(0.6).add(this.spray.mul(0.3)));
        spray.emissiveNode = spray.colorNode.mul(soft).mul(0.08);
        const mesh = new THREE.Mesh(instancedPlane(this.tier.spray, seeds), spray);
        mesh.name = 'waves-salt-spray';
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    createRipples() {
        const ripple = material('surface-impact', {
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const hit = this.impacts.element(instanceIndex);
        const hitFlat = varying(hit, 'vWaveImpact').setInterpolation('flat');
        ripple.positionNode = Fn(() => {
            const radius = hit.z.mul(6).add(0.5).toVar();
            const angle = hit.x.add(positionGeometry.x.mul(radius).div(13)).toVar();
            const z = hit.y.add(positionGeometry.y.mul(radius)).toVar();
            const surface = this.surface(angle, z).toVar();
            return surface.sub(vec3(cos(angle), sin(angle).mul(0.88), 0).mul(0.06));
        })();
        const radius = length(uv().sub(0.5).mul(2));
        const ring = exp(abs(radius.sub(0.73)).mul(-42));
        const envelope = sin(hitFlat.z.clamp(0, 1).mul(Math.PI)).max(0);
        ripple.colorNode = vec3(0.25, 0.78, 0.76).add(vec3(0.4, 0.35, 0.18).mul(this.pulse));
        ripple.opacityNode = ring.mul(envelope).mul(hitFlat.w).mul(0.85);
        ripple.emissiveNode = ripple.colorNode.mul(ripple.opacityNode).mul(0.25);
        const count = this.impactData.length;
        const mesh = new THREE.Mesh(instancedPlane(count, new Float32Array(count * 4)), ripple);
        mesh.name = 'waves-surface-impact-rings';
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    createImpactSpray() {
        const perImpact = { Minimal: 8, Low: 12 }[this.quality] ?? 24;
        const count = this.impactData.length * perImpact;
        const seeds = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            seeds.set([
                Math.floor(i / perImpact), this.rng() * Math.PI * 2, this.rng(), this.rng(),
            ], i * 4);
        }
        const droplets = material('impact-droplets', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const seed = attribute('aSeed', 'vec4');
        const hit = this.impacts.element(seed.x.toInt());
        const hitFlat = varying(hit, 'vWaveDropletImpact').setInterpolation('flat');
        const seedFlat = varying(seed, 'vWaveDropletSeed').setInterpolation('flat');
        droplets.positionNode = Fn(() => {
            const age = hit.z.toVar();
            const origin = this.surface(hit.x, hit.y).toVar();
            const inward = vec3(cos(hit.x).negate(), sin(hit.x).negate().mul(0.88), 0).toVar();
            const tangent = vec3(sin(hit.x).negate(), cos(hit.x).mul(0.88), 0).toVar();
            const spread = age.mul(seed.z.mul(2).add(0.7)).toVar();
            const motion = inward.mul(spread.mul(1.6).add(0.18))
                .add(tangent.mul(cos(seed.y)).mul(spread))
                .add(vec3(0, age.mul(1.1).sub(age.mul(age).mul(2.2)), sin(seed.y).mul(spread))).toVar();
            const size = seed.w.mul(0.09).add(0.06).toVar();
            return origin.add(motion).add(vec3(positionGeometry.xy.mul(vec2(size, size.mul(1.4))), 0));
        })();
        const r = length(uv().sub(0.5).mul(2));
        const core = exp(r.mul(r).mul(-10));
        const rim = exp(abs(r.sub(0.60)).mul(-14));
        const fade = sin(hitFlat.z.clamp(0, 1).mul(Math.PI)).max(0);
        droplets.colorNode = mix(vec3(0.32, 0.79, 0.87), vec3(1.1, 1.08, 0.88), seedFlat.w);
        droplets.opacityNode = core.mul(0.8).add(rim.mul(0.3)).mul(fade).mul(hitFlat.w);
        droplets.emissiveNode = droplets.colorNode.mul(core).mul(fade).mul(hitFlat.w).mul(0.12);
        const mesh = new THREE.Mesh(instancedPlane(count, seeds), droplets);
        mesh.name = 'waves-impact-droplets';
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    createCrestSpray() {
        const count = Math.max(60, Math.floor(this.tier.spray * 0.35));
        const seeds = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            seeds.set([
                0.45 + this.rng() * 2.0, this.rng(), this.rng(), this.rng(),
            ], i * 4);
        }
        const foam = material('breaking-crest-spray', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const seed = attribute('aSeed', 'vec4');
        const lane = varying(seed, 'vWaveCrestSpray').setInterpolation('flat');
        foam.positionNode = Fn(() => {
            const age = fract(seed.y.add(this.time.mul(0.24))).toVar();
            const z = seed.z.mul(42).sub(13).toVar();
            const origin = this.surface(seed.x, z).toVar();
            const drop = age.mul(age).mul(seed.w.mul(5).add(4)).toVar();
            const size = seed.w.mul(0.09).add(0.045).toVar();
            return origin.add(vec3(cos(seed.x).negate().mul(age).mul(0.8), drop.negate(), age.mul(0.5)))
                .add(vec3(positionGeometry.xy.mul(vec2(size, size.mul(1.7))), 0));
        })();
        const radius = length(uv().sub(0.5).mul(2));
        const core = exp(radius.mul(radius).mul(-8));
        const age = fract(lane.y.add(this.time.mul(0.24)));
        const fade = sin(age.mul(Math.PI)).max(0);
        foam.colorNode = mix(vec3(0.32, 0.66, 0.69), vec3(0.86, 0.92, 0.82), lane.w);
        foam.opacityNode = core.mul(fade).mul(this.foam).mul(0.7);
        foam.emissiveNode = foam.colorNode.mul(foam.opacityNode).mul(0.1);
        const mesh = new THREE.Mesh(instancedPlane(count, seeds), foam);
        mesh.name = 'waves-breaking-crest-spray';
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    createShafts() {
        const count = this.tier.shafts;
        const seeds = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) seeds.set([i / count, this.rng(), this.rng(), this.rng()], i * 4);
        const rays = material('sun-shafts', {
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const seed = attribute('aSeed', 'vec4');
        const lane = varying(seed, 'vWaveShaft').setInterpolation('flat');
        rays.positionNode = Fn(() => {
            const t = positionGeometry.y.add(0.5).toVar();
            const spread = t.mul(1.7).add(0.18).toVar();
            return vec3(
                float(7).mul(float(1).sub(t)).add(seed.x.sub(0.5).mul(t).mul(6))
                    .add(positionGeometry.x.mul(spread)),
                float(7).sub(t.mul(9)).add(seed.y.sub(0.5).mul(t).mul(2)),
                float(46).sub(t.mul(56)),
            );
        })();
        const edge = exp(pow(uv().x.sub(0.5).mul(2), 2).mul(-10))
            .mul(float(1).sub(smoothstep(0.8, 1, abs(uv().x.sub(0.5)).mul(2))));
        const fade = smoothstep(0, 0.1, uv().y).mul(float(1).sub(smoothstep(0.65, 1, uv().y)));
        const wisps = texture(this.noise, vec2(uv().y.mul(1.7).sub(this.time.mul(0.014)), lane.y)).r;
        rays.colorNode = vec3(0.82, 0.65, 0.38);
        const depth = smoothstep(-32, 46, positionWorld.z);
        const wallRadius = float(14.7).sub(depth.mul(3.4));
        const radialDistance = length(vec2(
            positionWorld.x.sub(depth.mul(7)),
            positionWorld.y.sub(depth.mul(1.2)).div(0.88),
        ));
        const wallFade = smoothstep(0.2, 1.6, wallRadius.sub(radialDistance));
        rays.opacityNode = edge.mul(fade).mul(wisps).mul(wallFade)
            .mul(float(0.025).add(this.shafts.mul(0.25)));
        rays.emissiveNode = rays.colorNode.mul(rays.opacityNode).mul(0.08);
        const mesh = new THREE.Mesh(instancedPlane(count, seeds), rays);
        mesh.name = 'waves-sun-shafts';
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    prepareCamera(aspect, hasBoard = this.hasBoard, boardTopRatio = this.boardTopRatio) {
        this.hasBoard = hasBoard;
        this.boardTopRatio = boardTopRatio;
        this.camera.fov = aspect < 0.8 ? 84 : 75;
        this.camera.position.set(0, -0.4, -25);
        const desktopTargetX = hasBoard ? -25 : -6;
        let targetY = hasBoard && aspect < 0.8 ? -34 : 1;
        if (hasBoard && aspect < 0.8 && Number.isFinite(boardTopRatio)) {
            // Real phone cards can occupy almost the whole viewport. Anchor the
            // exit light in the available top margin, rather than behind the card.
            const center = THREE.MathUtils.clamp(boardTopRatio * 0.5, 0.025, 0.25);
            const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
            const tilt = Math.atan((1 - 2 * center) * Math.tan(halfFov)) - Math.atan2(1.6, 71);
            targetY = -0.4 - Math.tan(tilt) * 60;
        }
        this.camera.lookAt(
            aspect < 0.8 ? 3 : desktopTargetX,
            targetY,
            35,
        );
        this.camera.updateProjectionMatrix();
    }

    update(time, dt, frame = {}) {
        this.time.value = time;
        this.pulse.value = Math.min(1.5, frame.pulse || 0);
        this.foam.value = Math.min(1.5, frame.foam || 0);
        this.spray.value = Math.min(1.5, frame.spray || 0);
        this.shafts.value = Math.min(1.5, frame.shafts || 0);
        this.surgeStrength.value = Math.min(2.5, frame.surgeStrength || 0);
        this.surgeZ.value = frame.surgeZ ?? -20;
        this.impactData.forEach((data) => data.set(0, 0, 1, 0));
        (frame.impacts || []).forEach((impact, index) => {
            if (impact.active === false || index >= this.impactData.length) return;
            this.impactData[impact.id ?? index]?.set(
                impact.angle,
                impact.z,
                Math.min(1, impact.age / Math.max(0.01, impact.duration)),
                impact.strength,
            );
        });
        if (time >= this.nextBoardCheck) {
            this.nextBoardCheck = time + 0.5;
            const board = typeof document === 'undefined' ? null
                : document.querySelector('.player-card[data-player="solo"], #game-container canvas');
            const rect = board?.getBoundingClientRect();
            const hasBoard = Boolean(rect?.width > 0 && rect?.height > 0);
            const height = typeof window === 'undefined' ? 0 : window.innerHeight;
            const boardTopRatio = hasBoard && Number.isFinite(rect.top) && height > 0 ? rect.top / height : null;
            if (hasBoard !== this.hasBoard || boardTopRatio !== this.boardTopRatio) {
                this.prepareCamera(this.camera.aspect, hasBoard, boardTopRatio);
            }
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        const geometries = new Set();
        const materials = new Set();
        this.group.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((mat) => mat.dispose());
        this.noise.dispose();
    }
}
