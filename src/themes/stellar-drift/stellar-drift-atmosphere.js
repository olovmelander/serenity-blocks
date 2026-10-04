/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** A quiet orbital voyage. One analytic scene for WebGPU and node WebGL2. */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraViewMatrix, cos, cross as vectorCross, dot, exp, float, length,
    mix, normalGeometry, normalWorld, normalize, positionGeometry, positionLocal, positionWorld,
    pow, reference, sin, smoothstep, texture, transformNormalToView,
    uniform, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { STELLAR_DRIFT_COMET_CONTACT, STELLAR_DRIFT_REACTION_LIMITS } from './stellar-drift-reactions.js';

export const DRIFT_TIERS = Object.freeze({
    Extreme: {
        sphere: 96, stars: 2900, rocks: 500, dust: 1500, texture: 1024,
    },
    Ultra: {
        sphere: 80, stars: 2400, rocks: 400, dust: 1200, texture: 1024,
    },
    High: {
        sphere: 64, stars: 1900, rocks: 300, dust: 900, texture: 512,
    },
    Medium: {
        sphere: 48, stars: 1300, rocks: 200, dust: 600, texture: 512,
    },
    Low: {
        sphere: 32, stars: 850, rocks: 100, dust: 320, texture: 256,
    },
    Minimal: {
        sphere: 24, stars: 550, rocks: 50, dust: 160, texture: 256,
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

/** Banded cloud belts with eddies, fine filaments and an oval storm, without an asset load race. */
export function createGasGiantTexture(width = 512) {
    const height = width / 2; const data = new Uint8Array(width * height * 4);
    const wrap = (v) => v - Math.floor(v);
    // Linear-light colors: colored highlights survive tone mapping without turning chalky.
    const palette = [
        [0.16, 0.035, 0.28], [0.60, 0.115, 0.035], [0.88, 0.235, 0.12],
        [0.85, 0.48, 0.09], [0.86, 0.65, 0.35],
    ];
    const stormPalette = [0.48, 0.055, 0.16];
    for (let y = 0; y < height; y += 1) {
        const v = y / height;
        for (let x = 0; x < width; x += 1) {
            const u = x / width;
            const ripple = Math.sin(u * TAU * 9 + Math.sin(v * 25) * 3) * 0.009
                + Math.sin(u * TAU * 23 - v * 75) * 0.003;
            let latitude = v + ripple;
            const dx = (wrap(u - 0.29 + 0.5) - 0.5) / 0.065; const dy = (v - 0.43) / 0.035;
            const distance = Math.sqrt(dx * dx + dy * dy);
            latitude += Math.exp(-distance * distance * 0.7) * Math.sin(Math.atan2(dy, dx) * 2 + distance * 8) * 0.024;
            const belt = 0.5 + 0.5 * Math.sin(latitude * 97 + Math.sin(latitude * 23) * 1.5);
            const fine = 0.5 + 0.5 * Math.sin(latitude * 260 + Math.sin(u * TAU * 19) * 1.1);
            const whorls = Math.sin(u * TAU * 17 + latitude * 85) * Math.sin(u * TAU * 7 - latitude * 140);
            const pale = belt ** 0.7;
            const storm = Math.exp(-distance * distance * 1.4);
            const coordinate = pale * (palette.length - 1);
            const stop = Math.min(palette.length - 2, Math.floor(coordinate));
            const fraction = coordinate - stop;
            const shade = fine * 0.018 + whorls * 0.012;
            const index = (y * width + x) * 4;
            for (let c = 0; c < 3; c += 1) {
                const base = palette[stop][c] + (palette[stop + 1][c] - palette[stop][c]) * fraction;
                const color = base * (1 - storm * 0.65) + stormPalette[c] * storm * 0.65 + shade;
                data[index + c] = Math.round(Math.min(1, Math.max(0, color)) * 255);
            }
            data[index + 3] = 255;
        }
    }
    const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
    map.needsUpdate = true; map.name = 'stellar-drift-cloud-belts';
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
        this.orbit = new THREE.Group(); this.orbit.rotation.set(1.15, -0.1, -0.31);
        this.hero.add(this.orbit); this.group.add(this.hero);
        this.noise = createDriftNoise(quality === 'Minimal' ? 128 : 256);
        this.planetMap = createGasGiantTexture(this.tier.texture);
        this.time = uniform(0);
        this.rim = uniform(0); this.aurora = uniform(0); this.dust = uniform(0);
        this.stars = uniform(0); this.glow = uniform(0); this.impact = uniform(0);
        this.heroCenter = uniform(new THREE.Vector3());
        this.heroRadius = uniform(RADIUS);
        const limits = STELLAR_DRIFT_REACTION_LIMITS[quality] || STELLAR_DRIFT_REACTION_LIMITS.High;
        this.maxArcs = limits.arcs; this.maxComets = limits.comets;
        this.arcVectors = Array.from({ length: this.maxArcs }, () => new THREE.Vector4(1, 0, 0, 0));
        this.arcs = uniformArray(this.arcVectors, 'vec4');
        this.cometVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector4(0, 0, 0, 0));
        this.comets = uniformArray(this.cometVectors, 'vec4');
        this.cometTargetVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector3());
        this.cometTargets = uniformArray(this.cometTargetVectors, 'vec3');
        this.cometApproachVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector3());
        this.cometApproaches = uniformArray(this.cometApproachVectors, 'vec3');
        this.cometDirectionValues = Array.from({ length: this.maxComets }, () => 1);
        this.cometDirections = uniformArray(this.cometDirectionValues, 'float');
        this.contactNormal = new THREE.Vector3();
        this.contactNormalNode = uniform(this.contactNormal);
        this.contactU = new THREE.Vector3(); this.contactV = new THREE.Vector3();
        this.contactRadial = new THREE.Vector3(); this.contactTangent = new THREE.Vector3();
        this.contactRadius = RADIUS; this.contactOffset = 0;
        this.impactAngle = null;
        this.disposed = false;
    }

    build() {
        this.createNebula(); this.createStars(); this.createPlanet(); this.createRings();
        this.createRocks(); this.createDust(); this.createMoons(); this.createAurora(); this.createComets();
        this.scene.add(this.group); this.prepareCamera(this.camera.aspect);
        this.update(0, 0, {});
        return this;
    }

    createNebula() {
        const nebula = material('nebula-depth', { depthWrite: false, depthTest: false });
        const field = Fn(() => {
            const q = uv().toVar();
            const coords = q.mul(vec2(2.2, 2.8)).add(vec2(this.time.mul(0.0005), 0)).toVar();
            const broad = texture(this.noise, coords).rgb.toVar();
            const detail = texture(this.noise, coords.mul(3.5).add(broad.rg.mul(0.55))).rgb.toVar();
            const fine = texture(this.noise, coords.mul(13).add(detail.rg.mul(0.18))).rgb.toVar();
            const band = exp(abs(q.y.sub(q.x.mul(0.42).add(0.29)).add(broad.r.sub(0.5).mul(0.22))).mul(-7)).toVar();
            const clouds = smoothstep(0.34, 0.69, broad.r.add(detail.r.mul(0.14)))
                .mul(band).toVar();
            const filaments = pow(float(1).sub(abs(detail.g.sub(0.52)).mul(2)).max(0), 14)
                .mul(smoothstep(0.35, 0.65, fine.r)).mul(clouds).toVar();
            const hollow = smoothstep(0.48, 0.72, detail.b).mul(clouds).toVar();
            const tint = mix(vec3(0.24, 0.035, 0.40), vec3(0.018, 0.31, 0.47), smoothstep(0.30, 0.8, q.x)).toVar();
            const light = exp(length(q.sub(vec2(0.18, 0.79)).mul(vec2(1, 1.3))).mul(-5)).toVar();
            const rose = exp(length(q.sub(vec2(0.42, 0.74))).mul(-6))
                .mul(smoothstep(0.38, 0.65, detail.b)).mul(clouds);
            const color = vec3(0.005, 0.007, 0.025).add(tint.mul(clouds).mul(0.8))
                .add(vec3(0.035, 0.18, 0.32).mul(filaments).mul(0.55))
                .add(vec3(0.36, 0.025, 0.16).mul(rose).mul(0.5))
                .add(vec3(0.30, 0.12, 0.028).mul(light).mul(clouds))
                .mul(float(1).sub(hollow.mul(0.62)))
                .add(vec3(0.012, 0.017, 0.025).mul(light));
            return color;
        })();
        nebula.colorNode = field;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(350, 230), nebula);
        mesh.position.set(0, 0, -170); mesh.renderOrder = -100; mesh.frustumCulled = false;
        this.group.add(mesh);
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
            const size = pow(seed.w, 7).mul(0.55).add(0.07).toVar();
            const x = seed.x.sub(0.5).mul(235).add(sin(this.time.mul(0.005).add(seed.z.mul(TAU))).mul(0.5));
            return positionGeometry.mul(size).add(vec3(x, seed.y.sub(0.5).mul(145), seed.z.mul(-105).sub(30)));
        })();
        const star = Fn(() => {
            const p = uv().sub(0.5).mul(2).toVar();
            const core = exp(dot(p, p).mul(-13)).toVar();
            const cross = exp(abs(p.x).mul(-45)).mul(exp(abs(p.y).mul(-5)))
                .add(exp(abs(p.y).mul(-45)).mul(exp(abs(p.x).mul(-5)))).mul(pow(flat.w, 12));
            const flicker = sin(this.time.mul(0.65).add(flat.z.mul(25))).mul(0.13).add(0.87);
            const tint = mix(vec3(0.65, 0.82, 1), vec3(1, 0.86, 0.69), flat.z);
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
        const planet = material('gas-giant');
        const field = Fn(() => {
            const n = normalize(normalWorld).toVar();
            const view = normalize(cameraPosition.sub(positionWorld)).toVar();
            const light = normalize(vec3(-0.62, 0.7, 0.75)).toVar();
            const diffuse = dot(n, light).max(0).toVar();
            const limb = pow(float(1).sub(dot(n, view).max(0)), 3.7).toVar();
            const clouds = texture(this.planetMap, uv().add(vec2(this.time.mul(0.0012), 0))).rgb.toVar();
            const terrain = texture(this.noise, uv().mul(vec2(8, 3)).add(vec2(this.time.mul(0.002), 0))).r;
            const lit = clouds.mul(pow(diffuse, 0.65).mul(1.12).add(0.095))
                .mul(terrain.mul(0.14).add(0.94)).toVar();
            const blue = vec3(0.035, 0.35, 0.68).mul(limb).mul(float(0.32).add(this.rim.mul(0.3)))
                .mul(float(1).sub(diffuse).mul(0.8).add(0.2));
            const gold = vec3(0.65, 0.29, 0.07).mul(limb).mul(diffuse).mul(0.32);
            return lit.add(blue).add(gold);
        })();
        planet.colorNode = field; planet.emissiveNode = vec3(0.04, 0.14, 0.22).mul(this.rim).mul(0.08);
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, this.tier.sphere, this.tier.sphere / 2), planet);
        sphere.name = 'stellar-drift-cloud-planet'; sphere.rotation.z = -0.15; sphere.rotation.y = 1.2;
        this.hero.add(sphere); this.planet = sphere;

        const shell = material('atmospheric-scattering', {
            transparent: true, depthWrite: false, side: THREE.BackSide,
        });
        const scattering = Fn(() => {
            const n = normalize(normalWorld); const view = normalize(cameraPosition.sub(positionWorld));
            const edge = pow(float(1).sub(abs(dot(n, view))), 7);
            const sun = dot(n, normalize(vec3(-0.62, 0.7, 0.75))).mul(0.5).add(0.5);
            const color = mix(vec3(0.06, 0.42, 0.95), vec3(1.0, 0.43, 0.16), sun);
            return vec4(color, edge.mul(this.rim.mul(0.23).add(0.32)));
        })();
        shell.colorNode = scattering.rgb; shell.opacityNode = scattering.a;
        shell.emissiveNode = scattering.rgb.mul(scattering.a).mul(0.6);
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
            const fine = sin(radius.mul(93)).mul(0.5).add(0.5).toVar();
            const bands = sin(radius.mul(10).add(grain.mul(5))).mul(0.5).add(0.5).toVar();
            const gap = smoothstep(1.79, 1.83, radial).mul(float(1).sub(smoothstep(1.88, 1.91, radial)));
            const edge = smoothstep(1.24, 1.31, radial).mul(float(1).sub(smoothstep(2.19, 2.31, radial)));
            let arc = float(0);
            const direction = normalize(p);
            for (let i = 0; i < this.maxArcs; i += 1) {
                const entry = this.arcs.element(i);
                arc = arc.add(pow(dot(direction, entry.xy).max(0), 22).mul(entry.z));
            }
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
            const ice = smoothstep(1.88, 2.27, radial);
            const brightBand = mix(vec3(0.80, 0.50, 0.15), vec3(0.075, 0.48, 0.78), ice);
            const color = mix(vec3(0.24, 0.075, 0.39), brightBand, bands.mul(0.8))
                .mul(grain.mul(0.4).add(0.8)).mul(shadow)
                .add(vec3(0.045, 0.48, 0.85).mul(arc).mul(0.7))
                .add(vec3(0.24, 0.15, 0.07).mul(this.dust).mul(0.2));
            const opacity = edge.mul(float(1).sub(gap.mul(0.96)))
                .mul(fine.mul(0.08).add(bands.mul(0.18)).add(0.40));
            return vec4(color, opacity);
        })();
        rings.colorNode = field.rgb; rings.opacityNode = field.a;
        rings.emissiveNode = field.rgb.mul(this.glow.mul(0.1)).mul(field.a);
        const mesh = new THREE.Mesh(new THREE.RingGeometry(RADIUS * 1.24, RADIUS * 2.31, 256, 12), rings);
        mesh.name = 'stellar-drift-fine-rings'; mesh.renderOrder = 5; this.orbit.add(mesh);
    }

    createRocks() {
        const seed = attribute('aSeed', 'vec4');
        const rock = material('drifting-asteroids');
        rock.positionNode = Fn(() => {
            const theta = seed.x.mul(TAU).add(this.time.mul(seed.z.mul(0.008).add(0.006))).toVar();
            const radius = seed.y.mul(8).add(20).toVar();
            const size = pow(seed.w, 3).mul(0.38).add(0.045).toVar();
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
        const moon = material('cratered-moon');
        const icy = reference('userData.driftMoonPalette', 'float');
        const field = Fn(() => {
            const q = uv().mul(vec2(4, 2)); const n = texture(this.noise, q).rgb;
            const fine = texture(this.noise, q.mul(7)).r;
            const craters = pow(float(1).sub(abs(n.g.sub(0.5)).mul(2)).max(0), 30);
            const light = dot(normalize(normalWorld), normalize(vec3(-0.8, 0.35, 0.7))).max(0);
            // A per-object palette keeps the icy and copper bodies on one shared material.
            const low = mix(vec3(0.34, 0.045, 0.065), vec3(0.018, 0.07, 0.30), icy);
            const high = mix(vec3(0.85, 0.34, 0.065), vec3(0.07, 0.55, 0.85), icy);
            const view = normalize(cameraPosition.sub(positionWorld));
            const limb = pow(float(1).sub(dot(normalize(normalWorld), view).max(0)), 3);
            return mix(low, high, n.r).mul(light.mul(0.95).add(0.07)).mul(fine.mul(0.2).add(0.85))
                .mul(float(1).sub(craters.mul(light).mul(0.14)))
                .add(mix(vec3(0.20, 0.02, 0.075), vec3(0.015, 0.16, 0.34), icy).mul(limb).mul(0.25));
        })();
        moon.colorNode = field;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(5.8, this.tier.sphere, this.tier.sphere / 2), moon);
        mesh.name = 'stellar-drift-distant-moon'; mesh.position.set(36, 17, -55); mesh.rotation.z = 0.3;
        mesh.userData.driftMoonPalette = 1;
        this.group.add(mesh); this.moon = mesh;
        const small = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), moon);
        small.position.set(12, -14, -22); small.name = 'stellar-drift-inner-moon'; this.group.add(small);
        small.userData.driftMoonPalette = 0;
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
                .mul(this.aurora.mul(0.48).add(0.018));
            return vec4(mix(vec3(0.025, 0.80, 0.61), vec3(0.56, 0.055, 0.85), q.y), alpha);
        })();
        aurora.colorNode = field.rgb; aurora.opacityNode = field.a;
        aurora.emissiveNode = field.rgb.mul(field.a).mul(1.2);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 160, 12), aurora);
        mesh.frustumCulled = false; mesh.name = 'stellar-drift-auroral-curtains'; mesh.renderOrder = 4;
        this.hero.add(mesh);
    }

    createComets() {
        for (let i = 0; i < this.maxComets; i += 1) {
            const entry = this.comets.element(i);
            const contact = this.cometTargets.element(i);
            const outwardApproach = this.cometApproaches.element(i);
            const comet = material(`comet-${i}`, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
            comet.positionNode = Fn(() => {
                const q = uv().toVar();
                const travel = entry.x.div(STELLAR_DRIFT_COMET_CONTACT).clamp(0, 1).toVar();
                // Contact shares the coordinates used by impactMesh, in hero-local
                // space. Rotate the trail's basis, never the complete trajectory.
                const target = contact.toVar();
                const approach = outwardApproach.toVar();
                const velocity = normalize(approach.negate()).toVar();
                const across = normalize(vectorCross(this.contactNormalNode, velocity)).toVar();
                const head = target.add(approach.mul(float(1).sub(travel)))
                    .add(this.contactNormalNode.mul(0.035)).toVar();
                // UV (0.96, 0.5) is the head itself; all lower-X samples trail
                // behind it and can no longer offset the head beyond the rim.
                const offset = velocity.mul(q.x.sub(0.96).mul(11))
                    .add(across.mul(q.y.sub(0.5).mul(0.5)));
                return head.add(offset);
            })();
            const field = Fn(() => {
                const q = uv(); const tail = exp(abs(q.y.sub(0.5)).mul(-33))
                    .mul(pow(q.x, 1.7)).mul(smoothstep(0, 0.03, q.x));
                const core = exp(length(q.sub(vec2(0.96, 0.5)).mul(vec2(11, 0.5))).mul(-18));
                const afterContact = float(1).sub(smoothstep(STELLAR_DRIFT_COMET_CONTACT, 0.84, entry.x));
                const fade = smoothstep(0, 0.08, entry.x).mul(afterContact).mul(entry.z);
                return vec4(mix(vec3(0.12, 0.46, 0.73), vec3(1.7, 1.3, 0.85), core), tail.add(core).mul(fade));
            })();
            comet.colorNode = field.rgb; comet.opacityNode = field.a;
            comet.emissiveNode = field.rgb.mul(field.a).mul(0.85);
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), comet);
            mesh.name = `stellar-drift-pooled-comet-${i}`; mesh.frustumCulled = false; mesh.renderOrder = 7;
            this.hero.add(mesh);
        }
        const impact = material('meteor-contact', { transparent: true, depthWrite: false });
        const p = uv().sub(0.5).mul(2); const alpha = exp(dot(p, p).mul(-5)).mul(this.impact).mul(0.3);
        impact.colorNode = vec3(1.1, 0.65, 0.32); impact.opacityNode = alpha;
        impact.emissiveNode = vec3(1.1, 0.48, 0.18).mul(alpha);
        this.impactMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), impact);
        this.impactMesh.position.set(9, 9, 10); this.impactMesh.renderOrder = 8; this.hero.add(this.impactMesh);
    }

    prepareCamera(aspect, boardRect = null, viewport = {}) {
        this.camera.fov = 48; this.camera.near = 0.1; this.camera.far = 500;
        this.camera.position.set(0, 0, 45); this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        const halfHeight = 45 * Math.tan(THREE.MathUtils.degToRad(24));
        if (aspect < 0.85) {
            // The actual portrait board occupies almost the whole screen. Put a luminous horizon
            // into the exposed upper margin instead of hiding the planetary highlight behind it.
            const screenHeight = viewport.height || 844;
            const top = boardRect?.top ?? screenHeight * 0.12;
            this.hero.scale.setScalar(0.8);
            this.hero.position.set(-halfHeight * aspect * 0.2, halfHeight * (1 - (2 * top) / screenHeight) + 6.8, 0);
            this.moon.position.set(halfHeight * aspect * 0.6, halfHeight * 0.58, -55);
        } else {
            this.hero.scale.setScalar(1);
            const width = viewport.width || 1440;
            const left = boardRect?.left ?? width * 0.39;
            const centerPixel = Math.min(width * 0.25, Math.max(width * 0.14, left * 0.52));
            this.hero.position.set(((centerPixel / width) * 2 - 1) * halfHeight * aspect, -2.5, 0);
            this.moon.position.set(36, 17, -55);
        }
        this.heroCenter.value.copy(this.hero.position);
        this.heroRadius.value = RADIUS * this.hero.scale.x;
    }

    resize(width, height, boardRect = null) {
        if (!(width > 0 && height > 0)) return;
        this.camera.aspect = width / height;
        this.prepareCamera(width / height, boardRect, { width, height });
    }

    update(time, _dt, frame = {}) {
        if (this.disposed) return;
        this.time.value = Number.isFinite(time) ? Math.max(0, time) : 0;
        for (const key of ['rim', 'aurora', 'dust', 'stars', 'glow', 'impact']) this[key].value = bounded(frame[key]);
        for (let i = 0; i < this.maxArcs; i += 1) {
            const arc = frame.arcs?.find((entry) => entry.id === i);
            const angle = (arc?.angle || 0) + (arc?.progress || 0) * (arc?.direction || 1) * 2.8;
            const brightness = arc?.active ? arc.strength * Math.sin(Math.PI * arc.progress) : 0;
            this.arcVectors[i].set(Math.cos(angle), Math.sin(angle), brightness, 0);
        }
        // A perspective sphere's visible limb is its camera-facing tangent circle.
        // Build it in hero-local space so portrait scaling and desktop offsets
        // use the same contact point for the head and the warm atmospheric flash.
        this.contactNormal.copy(this.camera.position).sub(this.hero.position);
        const distance = Math.max(RADIUS + 0.0001, this.contactNormal.length() / this.hero.scale.x);
        this.contactNormal.normalize();
        const ratio = RADIUS / distance;
        this.contactRadius = RADIUS * Math.sqrt(1 - ratio * ratio);
        this.contactOffset = RADIUS * ratio;
        this.contactU.set(1, 0, 0).addScaledVector(this.contactNormal, -this.contactNormal.x);
        if (this.contactU.lengthSq() < 1e-10) {
            this.contactU.set(0, 1, 0).addScaledVector(this.contactNormal, -this.contactNormal.y);
        }
        this.contactU.normalize();
        this.contactV.crossVectors(this.contactNormal, this.contactU).normalize();
        let newestImpact = null;
        for (let i = 0; i < this.maxComets; i += 1) {
            const comet = frame.comets?.find((entry) => entry.id === i);
            const strength = comet?.active ? comet.strength : 0;
            this.cometVectors[i].set(comet?.progress || 0, comet?.angle || 0, strength, comet?.seed || 0);
            this.cometDirectionValues[i] = comet?.direction === -1 ? -1 : 1;
            const angle = comet?.angle || 0;
            this.contactRadial.copy(this.contactU).multiplyScalar(Math.cos(angle))
                .addScaledVector(this.contactV, Math.sin(angle));
            this.contactTangent.copy(this.contactU).multiplyScalar(-Math.sin(angle))
                .addScaledVector(this.contactV, Math.cos(angle));
            this.cometTargetVectors[i].copy(this.contactRadial).multiplyScalar(this.contactRadius)
                .addScaledVector(this.contactNormal, this.contactOffset);
            // Approach from outside this limb, rather than cutting across the
            // opaque planet on the way to a correctly placed contact endpoint.
            const seed = bounded(comet?.seed);
            this.cometApproachVectors[i].copy(this.contactRadial).multiplyScalar(20 + seed * 12)
                .addScaledVector(this.contactTangent, this.cometDirectionValues[i] * (8 + seed * 16));
            if (comet?.impacted && (!newestImpact || comet.impactAge < newestImpact.impactAge)) newestImpact = comet;
        }
        if (newestImpact) this.impactAngle = newestImpact.angle;
        if (this.impactAngle !== null) {
            this.impactMesh.position.copy(this.contactU).multiplyScalar(this.contactRadius * Math.cos(this.impactAngle))
                .addScaledVector(this.contactV, this.contactRadius * Math.sin(this.impactAngle))
                .addScaledVector(this.contactNormal, this.contactOffset + 0.035);
        }
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            stars: this.tier.stars,
            meteorCount: this.tier.rocks,
            dust: this.tier.dust,
            analyticMotion: true,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
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
