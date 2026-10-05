/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** A layered orbital voyage. One analytic scene for WebGPU and node WebGL2. */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraViewMatrix, cos, dot, exp, float, length,
    mix, normalGeometry, normalize, positionGeometry, positionLocal, positionWorld,
    pow, sin, smoothstep, texture, transformNormalToView,
    uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { StellarDriftEventEffects } from './stellar-drift-event-effects.js';
import { StellarDriftBackdrop } from './stellar-drift-backdrop.js';
import {
    createGasGiantTexture, createStellarDriftPlanetMaterial,
    createStellarDriftAtmosphereMaterial, createStellarDriftMoonMaterial,
} from './stellar-drift-planets.js';

export { createGasGiantTexture } from './stellar-drift-planets.js';

export const DRIFT_TIERS = Object.freeze({
    Extreme: {
        sphere: 96, stars: 5200, rocks: 500, dust: 1500, texture: 1024,
    },
    Ultra: {
        sphere: 80, stars: 4300, rocks: 400, dust: 1200, texture: 1024,
    },
    High: {
        sphere: 64, stars: 3400, rocks: 300, dust: 900, texture: 512,
    },
    Medium: {
        sphere: 48, stars: 2200, rocks: 200, dust: 600, texture: 512,
    },
    Low: {
        sphere: 32, stars: 1300, rocks: 100, dust: 320, texture: 256,
    },
    Minimal: {
        sphere: 24, stars: 800, rocks: 50, dust: 160, texture: 256,
    },
});

const TAU = Math.PI * 2;
const RADIUS = 12.8;
const bounded = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);

/** Seamless multiscale density; CPU baked once, sampled cheaply by every layer. */
export function createDriftNoise(size = 256) {
    const pixels = new Uint8Array(size * size * 4);
    let state = 913731;
    const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
    for (let channel = 0; channel < 3; channel += 1) {
        const field = new Float32Array(size * size);
        let weight = 0.5; let total = 0;
        for (let grid = 4; grid <= 64; grid *= 2) {
            const cells = Float32Array.from({ length: grid * grid }, random);
            for (let y = 0; y < size; y += 1) {
                const py = (y * grid) / size; const iy = Math.floor(py); const fy = py - iy;
                const sy = fy * fy * (3 - 2 * fy);
                for (let x = 0; x < size; x += 1) {
                    const px = (x * grid) / size; const ix = Math.floor(px); const fx = px - ix;
                    const sx = fx * fx * (3 - 2 * fx);
                    const a = cells[iy * grid + ix]; const b = cells[iy * grid + ((ix + 1) % grid)];
                    const c = cells[((iy + 1) % grid) * grid + ix];
                    const d = cells[((iy + 1) % grid) * grid + ((ix + 1) % grid)];
                    field[y * size + x] += ((a + (b - a) * sx) * (1 - sy)
                        + (c + (d - c) * sx) * sy) * weight;
                }
            }
            total += weight; weight *= 0.52;
        }
        for (let i = 0; i < field.length; i += 1) pixels[i * 4 + channel] = Math.round((field[i] / total) * 255);
    }
    for (let i = 0; i < size * size; i += 1) pixels[i * 4 + 3] = 255;
    const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true; map.name = 'stellar-drift-density';
    return map;
}

function material(name, options = {}) {
    const result = new THREE.MeshBasicNodeMaterial({ fog: false, ...options });
    result.name = `stellar-drift-${name}`; result.emissiveNode = vec3(0);
    return result;
}

function instances(base, seeds, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index; geometry.attributes = base.attributes;
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    return geometry;
}

export class StellarDriftAtmosphere {
    constructor({
        scene, camera, quality = 'High', rng = Math.random,
    }) {
        this.scene = scene; this.camera = camera; this.quality = quality;
        this.tier = DRIFT_TIERS[quality] || DRIFT_TIERS.High; this.rng = rng;
        this.group = new THREE.Group(); this.group.name = 'stellar-drift-orbital-voyage';
        this.hero = new THREE.Group(); this.hero.name = 'stellar-drift-planet-system';
        this.orbit = new THREE.Group(); this.orbit.rotation.set(1.10, -0.08, -0.38);
        this.hero.add(this.orbit); this.group.add(this.hero);
        this.noise = createDriftNoise(quality === 'Minimal' ? 128 : 256);
        this.planetMap = createGasGiantTexture(this.tier.texture);
        this.time = uniform(0);
        this.viewHalfHeight = uniform(45 * Math.tan(THREE.MathUtils.degToRad(24)));
        this.viewHalfWidth = uniform(this.viewHalfHeight.value * this.camera.aspect);
        this.cameraBase = new THREE.Vector3(0, 0, 45);
        this.pointerTarget = new THREE.Vector2(); this.pointer = new THREE.Vector2();
        this.reducedMotion = typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        this.moonAnchor = new THREE.Vector3(); this.innerMoonAnchor = new THREE.Vector3();
        this.rim = uniform(0); this.aurora = uniform(0); this.dust = uniform(0);
        this.stars = uniform(0); this.glow = uniform(0); this.impact = uniform(0);
        this.heroCenter = uniform(new THREE.Vector3());
        this.heroRadius = uniform(RADIUS);
        this.ringNormal = uniform(new THREE.Vector3(0, 0, 1).applyEuler(this.orbit.rotation));
        this.disposed = false;
    }

    build() {
        this.createNebula(); this.createStars(); this.createPlanet(); this.createRings();
        this.createRocks(); this.createDust(); this.createMoons();
        this.createForeground(); this.createSpaceDust(); this.createAurora();
        this.effects = new StellarDriftEventEffects({
            parent: this.hero, orbitalParent: this.orbit, camera: this.camera, radius: RADIUS, quality: this.quality,
        }).build();
        this.scene.add(this.group); this.prepareCamera(this.camera.aspect);
        this.update(0, 0, {});
        return this;
    }

    createNebula() {
        this.backdrop = new StellarDriftBackdrop({
            parent: this.group, noise: this.noise, time: this.time,
        }).build();
    }

    seedArray(count) {
        const seeds = new Float32Array(count * 4);
        for (let i = 0; i < seeds.length; i += 1) seeds[i] = this.rng();
        return seeds;
    }

    createStars() {
        const seed = attribute('aSeed', 'vec4');
        const flat = varying(seed, 'vDriftStarSeed').setInterpolation('flat');
        const stars = material('parallax-stars', { transparent: true, depthWrite: false });
        stars.positionNode = Fn(() => {
            const z = seed.z.mul(-140).sub(22).toVar();
            const distanceScale = float(45).sub(z).div(45).toVar();
            const size = pow(seed.w, 7).mul(0.49).add(0.055).mul(distanceScale.sqrt())
                .toVar();
            const x = seed.x.sub(0.5).mul(this.viewHalfWidth).mul(2.3).mul(distanceScale);
            const y = seed.y.sub(0.5).mul(this.viewHalfHeight).mul(2.3).mul(distanceScale);
            return positionGeometry.mul(size).add(vec3(x, y, z));
        })();
        const star = Fn(() => {
            const p = uv().sub(0.5).mul(2).toVar();
            const core = exp(dot(p, p).mul(-13)).toVar();
            const cross = exp(abs(p.x).mul(-45)).mul(exp(abs(p.y).mul(-5)))
                .add(exp(abs(p.y).mul(-45)).mul(exp(abs(p.x).mul(-5)))).mul(pow(flat.w, 12));
            const flicker = sin(this.time.mul(0.65).add(flat.z.mul(25))).mul(0.13).add(0.87);
            const tint = mix(vec3(0.49, 0.70, 1.2), vec3(1.2, 0.83, 0.49), flat.z);
            const value = core.add(cross).mul(flicker).mul(flat.w.mul(1.4).add(0.5)).mul(this.stars.mul(0.3).add(1));
            return vec4(tint.mul(1.8), value);
        })();
        stars.colorNode = star.rgb; stars.opacityNode = star.a; stars.emissiveNode = star.rgb.mul(star.a).mul(0.65);
        const geometry = instances(new THREE.PlaneGeometry(1, 1), this.seedArray(this.tier.stars), this.tier.stars);
        const mesh = new THREE.Mesh(geometry, stars);
        mesh.name = 'stellar-drift-starfield'; mesh.frustumCulled = false; mesh.renderOrder = -80;
        this.group.add(mesh);
    }

    createPlanet() {
        const planet = createStellarDriftPlanetMaterial({
            map: this.planetMap,
            noise: this.noise,
            time: this.time,
            rim: this.rim,
            heroCenter: this.heroCenter,
            heroRadius: this.heroRadius,
            ringNormal: this.ringNormal,
        });
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, this.tier.sphere, this.tier.sphere / 2), planet);
        sphere.name = 'stellar-drift-cloud-planet'; sphere.rotation.z = -0.15; sphere.rotation.y = -0.18;
        this.hero.add(sphere); this.planet = sphere;

        const shell = createStellarDriftAtmosphereMaterial({ rim: this.rim });
        const shellGeometry = new THREE.SphereGeometry(RADIUS * 1.018, this.tier.sphere, this.tier.sphere / 2);
        const atmosphere = new THREE.Mesh(shellGeometry, shell);
        atmosphere.name = 'stellar-drift-atmosphere'; this.hero.add(atmosphere);
    }

    createRings() {
        const rings = material('orbital-ice-rings', { side: THREE.DoubleSide, transparent: true, depthWrite: false });
        const field = Fn(() => {
            const p = positionLocal.xy.toVar();
            const radius = length(p).toVar(); const radial = radius.div(RADIUS).toVar();
            const grain = texture(this.noise, vec2(radial.mul(3), 0.21)).r.toVar();
            const fine = sin(radius.mul(127).add(grain.mul(3))).mul(0.5).add(0.5).toVar();
            const bands = texture(this.noise, vec2(radial.mul(7.5), 0.67)).g.toVar();
            const gap = smoothstep(1.79, 1.83, radial).mul(float(1).sub(smoothstep(1.88, 1.91, radial)));
            const edge = smoothstep(1.24, 1.31, radial).mul(float(1).sub(smoothstep(2.03, 2.16, radial)));
            // The night-side ring passes through the planet's shadow cone, rather than glowing through it.
            const fromPlanet = positionWorld.sub(this.heroCenter).toVar();
            const alongSun = dot(fromPlanet, normalize(vec3(-0.62, 0.7, 0.75))).toVar();
            const discriminant = alongSun.mul(alongSun)
                .sub(dot(fromPlanet, fromPlanet).sub(this.heroRadius.mul(this.heroRadius))).toVar();
            const hit = alongSun.negate().sub(discriminant.max(0).sqrt()).toVar();
            // Express the penumbra in world distance, not squared ray distance. A narrow
            // discriminant threshold turns the curved shadow into a harsh diagonal cut.
            const rayDistance = dot(fromPlanet, fromPlanet).sub(alongSun.mul(alongSun)).max(0).sqrt();
            const occlusion = float(1).sub(smoothstep(this.heroRadius.sub(0.9), this.heroRadius.add(0.9), rayDistance))
                .mul(smoothstep(0, 1.5, hit));
            const shadow = float(1).sub(occlusion.mul(0.68)).toVar();
            const ice = smoothstep(1.45, 2.15, radial);
            const brightBand = mix(vec3(0.47, 0.29, 0.16), vec3(0.16, 0.36, 0.47), ice);
            const color = mix(vec3(0.12, 0.13, 0.19), brightBand, bands.mul(0.85))
                .mul(grain.mul(0.4).add(0.8)).mul(shadow)
                .add(vec3(0.24, 0.15, 0.07).mul(this.dust).mul(0.2));
            const opacity = edge.mul(float(1).sub(gap.mul(0.96)))
                .mul(fine.mul(0.06).add(bands.mul(0.28)).add(0.26));
            return vec4(color, opacity);
        })();
        rings.colorNode = field.rgb; rings.opacityNode = field.a;
        rings.emissiveNode = field.rgb.mul(this.glow.mul(0.1)).mul(field.a);
        const mesh = new THREE.Mesh(new THREE.RingGeometry(RADIUS * 1.24, RADIUS * 2.16, 256, 12), rings);
        mesh.name = 'stellar-drift-fine-rings'; mesh.renderOrder = 5; this.orbit.add(mesh);
    }

    createRocks() {
        const seed = attribute('aSeed', 'vec4');
        const rock = material('drifting-asteroids');
        rock.positionNode = Fn(() => {
            const theta = seed.x.mul(TAU).add(this.time.mul(seed.z.mul(0.008).add(0.006))).toVar();
            const radius = seed.y.mul(6).add(20).toVar();
            const size = pow(seed.w, 4).mul(0.16).add(0.025).toVar();
            const p = positionGeometry.mul(size).toVar();
            const rotation = this.time.mul(0.07).add(seed.z.mul(TAU));
            return vec3(
                p.x.mul(cos(rotation)).sub(p.z.mul(sin(rotation))),
                p.y,
                p.x.mul(sin(rotation)).add(p.z.mul(cos(rotation))),
            )
                .add(vec3(cos(theta).mul(radius), sin(theta).mul(radius), seed.z.sub(0.5).mul(0.9)));
        })();
        rock.normalNode = Fn(() => {
            const n = normalGeometry.toVar();
            const rotation = this.time.mul(0.07).add(seed.z.mul(TAU));
            const rotated = vec3(
                n.x.mul(cos(rotation)).sub(n.z.mul(sin(rotation))),
                n.y,
                n.x.mul(sin(rotation)).add(n.z.mul(cos(rotation))),
            );
            return transformNormalToView(rotated).normalize();
        })();
        // MeshBasicNodeMaterial's setupNormal intentionally ignores normalNode.
        // Read it explicitly for the analytic lighting, in the matching world space.
        const rotatedNormal = rock.normalNode.transformNormalByInverseViewMatrix(cameraViewMatrix);
        const illumination = dot(rotatedNormal, normalize(vec3(-0.62, 0.7, 0.75))).max(0);
        rock.colorNode = vec3(0.30, 0.28, 0.26).mul(illumination.mul(0.8).add(0.15));
        const seeds = this.seedArray(this.tier.rocks);
        const geometry = instances(new THREE.IcosahedronGeometry(1, 0), seeds, this.tier.rocks);
        const mesh = new THREE.Mesh(geometry, rock);
        mesh.name = 'stellar-drift-ice-debris'; mesh.frustumCulled = false;
        this.orbit.add(mesh);
    }

    createDust() {
        const seed = attribute('aSeed', 'vec4'); const flat = varying(seed, 'vDriftDustSeed').setInterpolation('flat');
        const dust = material('orbital-dust', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
        dust.positionNode = Fn(() => {
            const theta = seed.x.mul(TAU).add(this.time.mul(0.012)).toVar();
            const radius = seed.y.mul(14).add(16.1).toVar();
            const size = seed.w.mul(0.055).add(0.025).mul(this.dust.mul(0.6).add(1));
            const center = vec3(cos(theta).mul(radius), sin(theta).mul(radius), seed.z.sub(0.5).mul(1.5));
            return positionGeometry.mul(size).add(center);
        })();
        const alpha = exp(dot(uv().sub(0.5).mul(2), uv().sub(0.5).mul(2)).mul(-7))
            .mul(flat.w.mul(0.35).add(0.1)).mul(this.dust.mul(0.8).add(0.35));
        dust.colorNode = vec3(0.75, 0.77, 0.83); dust.opacityNode = alpha;
        dust.emissiveNode = vec3(0.18, 0.34, 0.42).mul(alpha).mul(this.dust.mul(0.7).add(0.15));
        const geometry = instances(new THREE.PlaneGeometry(1, 1), this.seedArray(this.tier.dust), this.tier.dust);
        const mesh = new THREE.Mesh(geometry, dust);
        mesh.name = 'stellar-drift-ring-dust'; mesh.frustumCulled = false; mesh.renderOrder = 6;
        this.orbit.add(mesh);
    }

    createMoons() {
        const moon = createStellarDriftMoonMaterial({ noise: this.noise });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(5.8, this.tier.sphere, this.tier.sphere / 2), moon);
        mesh.name = 'stellar-drift-distant-moon'; mesh.position.set(36, 17, -55); mesh.rotation.z = 0.3;
        mesh.userData.driftMoonPalette = 1;
        this.group.add(mesh); this.moon = mesh;
        const small = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), moon);
        small.position.set(12, -14, -22); small.name = 'stellar-drift-inner-moon';
        this.group.add(small); this.innerMoon = small;
        small.userData.driftMoonPalette = 0;
    }

    createForeground() {
        const count = {
            Extreme: 44, Ultra: 36, High: 28, Medium: 18, Low: 10, Minimal: 6,
        }[this.quality] ?? 28;
        const seed = attribute('aSeed', 'vec4');
        const flat = varying(seed, 'vDriftForegroundSeed').setInterpolation('flat');
        const rocks = material('foreground-ice-fragments');
        const rotation = this.time.mul(0.035).add(seed.z.mul(TAU));
        rocks.positionNode = Fn(() => {
            const z = seed.z.mul(14).add(3).toVar();
            const depthScale = float(45).sub(z).div(45).toVar();
            const size = pow(seed.w, 3).mul(0.23).add(0.07).toVar();
            const local = positionGeometry.mul(size).mul(vec3(1, seed.z.mul(0.7).add(0.5), 1)).toVar();
            const rotated = vec3(
                local.x.mul(cos(rotation)).sub(local.z.mul(sin(rotation))),
                local.y,
                local.x.mul(sin(rotation)).add(local.z.mul(cos(rotation))),
            );
            const side = seed.x.greaterThan(0.5).select(1, -1);
            const x = side.mul(seed.x.mul(0.35).add(0.79)).mul(this.viewHalfWidth).mul(depthScale)
                .add(sin(this.time.mul(0.023).add(seed.y.mul(TAU))).mul(0.65));
            const y = seed.y.sub(0.5).mul(this.viewHalfHeight).mul(2.6).mul(depthScale)
                .add(this.time.mul(seed.z.sub(0.5)).mul(0.008));
            return rotated.add(vec3(x, y, z));
        })();
        rocks.normalNode = Fn(() => {
            const n = normalGeometry.toVar();
            return transformNormalToView(vec3(
                n.x.mul(cos(rotation)).sub(n.z.mul(sin(rotation))),
                n.y,
                n.x.mul(sin(rotation)).add(n.z.mul(cos(rotation))),
            )).normalize();
        })();
        const worldNormal = rocks.normalNode.transformNormalByInverseViewMatrix(cameraViewMatrix);
        const light = dot(worldNormal, normalize(vec3(-0.62, 0.7, 0.75))).max(0);
        rocks.colorNode = mix(vec3(0.065, 0.11, 0.18), vec3(0.38, 0.24, 0.14), flat.w)
            .mul(light.mul(1.15).add(0.17));
        const geometry = instances(new THREE.IcosahedronGeometry(1, 1), this.seedArray(count), count);
        const mesh = new THREE.Mesh(geometry, rocks);
        mesh.name = 'stellar-drift-foreground-debris'; mesh.frustumCulled = false;
        this.group.add(mesh); this.foregroundCount = count;
    }

    createSpaceDust() {
        const count = {
            Extreme: 2300, Ultra: 1900, High: 1500, Medium: 950, Low: 550, Minimal: 280,
        }[this.quality] ?? 1500;
        const seed = attribute('aSeed', 'vec4');
        const flat = varying(seed, 'vDriftSpaceDustSeed').setInterpolation('flat');
        const dust = material('interstellar-motes', { transparent: true, depthWrite: false });
        dust.positionNode = Fn(() => {
            const z = seed.z.mul(95).sub(76).toVar();
            const perspective = float(45).sub(z).div(45).toVar();
            const x = seed.x.sub(0.5).mul(this.viewHalfWidth).mul(2.4).mul(perspective)
                .add(sin(this.time.mul(0.052).add(seed.y.mul(TAU))).mul(0.9));
            const y = seed.y.sub(0.5).mul(this.viewHalfHeight).mul(2.4).mul(perspective)
                .add(cos(this.time.mul(0.044).add(seed.x.mul(TAU))).mul(0.5));
            const size = seed.w.mul(seed.w).mul(0.16).add(0.025).mul(perspective.sqrt());
            return positionGeometry.mul(size).add(vec3(x, y, z));
        })();
        const p = uv().sub(0.5).mul(2);
        const alpha = exp(dot(p, p).mul(-5.5)).mul(flat.w.mul(0.20).add(0.04));
        dust.colorNode = mix(vec3(0.12, 0.32, 0.55), vec3(0.70, 0.32, 0.17), flat.x);
        dust.opacityNode = alpha;
        dust.emissiveNode = dust.colorNode.mul(alpha).mul(0.25);
        const geometry = instances(new THREE.PlaneGeometry(1, 1), this.seedArray(count), count);
        const mesh = new THREE.Mesh(geometry, dust);
        mesh.name = 'stellar-drift-interstellar-dust'; mesh.frustumCulled = false; mesh.renderOrder = -30;
        this.group.add(mesh); this.spaceDustCount = count;
    }

    createAurora() {
        const aurora = material('polar-aurora', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
        aurora.positionNode = Fn(() => {
            const angle = uv().x.mul(TAU).toVar();
            const height = uv().y.mul(3.7).add(10.5).toVar();
            const radius = float(7.1).add(sin(angle.mul(11).add(this.time.mul(0.4))).mul(uv().y).mul(0.35)).toVar();
            return vec3(cos(angle).mul(radius), height, sin(angle).mul(radius));
        })();
        const field = Fn(() => {
            const q = uv();
            const flow = texture(this.noise, vec2(q.x.mul(9).add(this.time.mul(0.007)), q.y.mul(0.6))).g;
            const rays = pow(sin(q.x.mul(TAU * 54).add(flow.mul(6))).mul(0.5).add(0.5), 3);
            const alpha = sin(q.y.mul(Math.PI)).mul(flow.mul(0.7).add(rays.mul(0.3)))
                .mul(this.aurora.mul(0.70).add(0.018));
            return vec4(mix(vec3(0.025, 0.80, 0.61), vec3(0.56, 0.055, 0.85), q.y), alpha);
        })();
        aurora.colorNode = field.rgb; aurora.opacityNode = field.a;
        aurora.emissiveNode = field.rgb.mul(field.a).mul(1.7);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 160, 12), aurora);
        mesh.frustumCulled = false; mesh.name = 'stellar-drift-auroral-curtains'; mesh.renderOrder = 4;
        this.hero.add(mesh);
    }

    setPointer(x, y) {
        this.pointerTarget.set(
            Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0,
            Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0,
        );
    }

    prepareCamera(aspect, boardRect = null, viewport = {}) {
        this.camera.fov = 48; this.camera.near = 0.1; this.camera.far = 500;
        this.camera.position.copy(this.cameraBase); this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        const halfHeight = 45 * Math.tan(THREE.MathUtils.degToRad(24));
        this.viewHalfHeight.value = halfHeight; this.viewHalfWidth.value = halfHeight * aspect;
        this.backdrop.resize(aspect, halfHeight);
        const screenHeight = viewport.height || 900;
        const width = viewport.width || screenHeight * aspect;
        const portrait = aspect < 0.85;
        if (portrait) {
            const top = boardRect?.top ?? screenHeight * 0.18;
            this.hero.scale.setScalar(0.85);
            this.hero.position.set(
                -halfHeight * aspect * 0.56,
                halfHeight * (1 - (2 * top) / screenHeight) + 8.2,
                -10,
            );
            this.moon.position.set(halfHeight * aspect * 1.7, -halfHeight * 1.52, -58);
            this.innerMoon.position.set(-halfHeight * aspect * 0.90, -halfHeight * 1.06, -15);
        } else {
            this.hero.scale.setScalar(aspect < 1.5 ? 0.82 : 1);
            const left = boardRect?.left ?? width * 0.39;
            const centerPixel = Math.min(width * 0.245, Math.max(width * 0.15, left * 0.56));
            const planetaryHalfHeight = halfHeight * (61 / 45);
            this.hero.position.set(((centerPixel / width) * 2 - 1) * planetaryHalfHeight * aspect, -3.8, -16);
            this.moon.position.set(halfHeight * aspect * 1.33, halfHeight * 0.92, -58);
            this.innerMoon.position.set(halfHeight * aspect * 0.76, -halfHeight * 0.66, -15);
        }
        this.heroCenter.value.copy(this.hero.position);
        this.heroRadius.value = RADIUS * this.hero.scale.x;
        this.moonAnchor.copy(this.moon.position); this.innerMoonAnchor.copy(this.innerMoon.position);
        this.effects?.resize(width, screenHeight, boardRect);
    }

    resize(width, height, boardRect = null) {
        if (!(width > 0 && height > 0)) return;
        this.camera.aspect = width / height;
        this.prepareCamera(width / height, boardRect, { width, height });
    }

    update(time, _dt, frame = {}) {
        if (this.disposed) return;
        this.time.value = Number.isFinite(time) ? Math.max(0, time) : 0;
        const t = this.reducedMotion ? 0 : this.time.value;
        const dt = Number.isFinite(_dt) ? Math.max(0, Math.min(0.05, _dt)) : 0;
        this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-dt * 5.5));
        const pointerScale = this.reducedMotion ? 0 : Math.min(1, this.camera.aspect / 1.2);
        const x = Math.sin(t * 0.041) * 0.8 + this.pointer.x * 2.2 * pointerScale;
        const y = Math.sin(t * 0.033) * 0.34 + this.pointer.y * 1.1 * pointerScale;
        this.camera.position.set(x, y, 45 + Math.sin(t * 0.025) * 0.5);
        this.camera.lookAt(x * 0.10, y * 0.10, 0);
        this.camera.updateMatrixWorld();
        this.moon.position.copy(this.moonAnchor);
        this.moon.position.x += Math.sin(t * 0.027) * 1.3;
        this.moon.position.y += Math.sin(t * 0.019) * 0.65;
        this.innerMoon.position.copy(this.innerMoonAnchor);
        this.innerMoon.position.x += Math.sin(t * 0.055) * 0.55;
        this.innerMoon.position.y += Math.sin(t * 0.041) * 0.45;
        for (const key of ['rim', 'aurora', 'dust', 'stars', 'glow', 'impact']) this[key].value = bounded(frame[key]);
        this.effects.update(this.time.value, dt, frame);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            stars: this.tier.stars,
            meteorCount: this.tier.rocks,
            dust: this.tier.dust,
            analyticMotion: true,
            fullscreenBackdrop: true,
            foregroundDebris: this.foregroundCount,
            spaceDust: this.spaceDustCount,
            pointer: this.pointer.toArray(),
            camera: this.camera.position.toArray(),
            ...this.effects.getDiagnostics(),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.effects?.dispose();
        this.group.removeFromParent();
        const geometries = new Set(); const materials = new Set();
        this.group.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        geometries.forEach((geometry) => geometry.dispose()); materials.forEach((entry) => entry.dispose());
        this.noise.dispose(); this.planetMap.dispose(); this.group.clear();
    }
}
