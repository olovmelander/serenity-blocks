/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stellar Velocity's nebula and plasma corridor. One background draw and one
 * instanced filament draw; the same TSL graphs run on WebGPU and node WebGL2.
 * The periodic noise is baked once on the CPU, keeping shader compilation small.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cos, exp, float, length, mix, normalWorld,
    cameraPosition, normalize, dot, positionGeometry, positionWorld,
    pow, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';

export const ATMOSPHERE_TIERS = Object.freeze({
    Extreme: { ribbons: 18, segments: 96, noiseSize: 256 },
    Ultra: { ribbons: 16, segments: 80, noiseSize: 256 },
    High: { ribbons: 12, segments: 64, noiseSize: 256 },
    Medium: { ribbons: 8, segments: 48, noiseSize: 128 },
    Low: { ribbons: 5, segments: 32, noiseSize: 128 },
    Minimal: { ribbons: 3, segments: 24, noiseSize: 64 },
});

export function getStellarDestinationLayout(aspect, hasBoard) {
    if (hasBoard && aspect < 0.8) return { x: -0.48, y: 0.78, scale: 0.45 };
    if (hasBoard) return { x: -0.64, y: 0.08, scale: 1 };
    return { x: -0.12, y: 0.04, scale: aspect < 0.8 ? 0.62 : 1 };
}

/** Seeded, periodic value-noise octaves; no canvas or external asset loading. */
export function bakeStellarNoise(size = 256) {
    const data = new Uint8Array(size * size * 4);
    const channels = Array.from({ length: 3 }, () => new Float32Array(size * size));
    let state = 713927;
    const random = () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
    for (const channel of channels) {
        let weight = 0.55;
        let total = 0;
        for (let grid = 4; grid <= 64; grid *= 2) {
            const lattice = Float32Array.from({ length: grid * grid }, random);
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
                    const a = lattice[iy * grid + ix];
                    const b = lattice[iy * grid + ((ix + 1) % grid)];
                    const c = lattice[((iy + 1) % grid) * grid + ix];
                    const d = lattice[((iy + 1) % grid) * grid + ((ix + 1) % grid)];
                    channel[y * size + x] += ((a + (b - a) * sx) * (1 - sy)
                        + (c + (d - c) * sx) * sy) * weight;
                }
            }
            total += weight;
            weight *= 0.52;
        }
        for (let i = 0; i < channel.length; i += 1) channel[i] /= total;
    }
    for (let i = 0; i < size * size; i += 1) {
        for (let c = 0; c < 3; c += 1) data[i * 4 + c] = Math.round(channels[c][i] * 255);
        data[i * 4 + 3] = 255;
    }
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    map.name = 'stellar-velocity-periodic-density';
    return map;
}

function metadata(material, role, bloomWeight = 0) {
    material.name = `stellar-velocity-${role}`;
    material.userData = {
        mrtRole: role,
        emitsBloom: bloomWeight > 0,
        bloomWeight,
        zeroEmissiveEnforced: bloomWeight === 0,
    };
    if (bloomWeight === 0) material.emissiveNode = vec3(0);
    return material;
}

export class StellarVelocityAtmosphere {
    constructor({ scene, quality = 'High' }) {
        this.scene = scene;
        this.tier = ATMOSPHERE_TIERS[quality] || ATMOSPHERE_TIERS.High;
        this.root = new THREE.Group();
        this.root.name = 'stellar-velocity-atmosphere';
        this.coreGroup = new THREE.Group();
        this.coreGroup.name = 'stellar-velocity-stellar-destination';
        this.noise = bakeStellarNoise(this.tier.noiseSize);
        this.time = uniform(0);
        this.warp = uniform(0);
        this.pulse = uniform(0);
        this.primary = uniform(new THREE.Color(0x94edff));
        this.secondary = uniform(new THREE.Color(0x7273eb));
        this.anchor = uniform(new THREE.Vector2(-0.12, 0.04));
        this.travelAxis = uniform(new THREE.Vector2());
        this.layout = getStellarDestinationLayout(1, false);
        this.board = null;
        this.nextLayoutCheck = 0;
    }

    build() {
        this.createNebula();
        this.createFilaments();
        this.createCorona();
        this.root.add(this.coreGroup);
        this.scene.add(this.root);
        return this;
    }

    createNebula() {
        const material = metadata(new THREE.MeshBasicNodeMaterial({
            depthWrite: false, depthTest: false, fog: false,
        }), 'nebula-field');
        material.colorNode = Fn(() => {
            const q = uv().sub(0.5).mul(vec2(2.6, 1.6)).toVar();
            const drift = vec2(this.time.mul(0.0015), this.time.mul(-0.001)).toVar();
            const p = vec2(q.x.add(q.y.mul(0.45)), q.y.sub(q.x.mul(0.38))).toVar();
            const warp = texture(this.noise, p.mul(0.21).add(drift)).rg.sub(0.5).toVar();
            const density = texture(this.noise, p.mul(0.48).add(warp.mul(0.7)).add(drift)).rgb.toVar();
            const detail = texture(this.noise, p.mul(1.6).add(warp.mul(0.2)).sub(drift)).rgb.toVar();
            const fine = texture(this.noise, p.mul(4.6).add(warp.mul(0.45))).g.toVar();
            const band = exp(abs(p.y.add(warp.y.mul(0.55)).add(0.05)).mul(-3.8)).toVar();
            const clouds = smoothstep(0.25, 0.74, density.r.add(detail.r.mul(0.12))).mul(band).toVar();
            const threads = pow(float(1).sub(abs(density.g.sub(0.5)).mul(2)).max(0), 18)
                .mul(smoothstep(0.42, 0.72, detail.b)).mul(band).toVar();
            const blue = vec3(0.025, 0.09, 0.22).mul(clouds.mul(1.4)).toVar();
            const violet = vec3(0.24, 0.045, 0.26).mul(clouds.mul(density.b).mul(2)).toVar();
            const warm = vec3(0.18, 0.075, 0.03).mul(threads).mul(smoothstep(-0.8, 0.6, p.x)).toVar();
            const aperture = exp(length(q.sub(this.anchor).mul(vec2(1, 1.2))).mul(-4.5)).toVar();
            const soot = smoothstep(0.28, 0.59, density.b).mul(0.8).toVar();
            return vec3(0.0015, 0.0025, 0.009)
                .add(blue.add(violet).mul(float(1).sub(soot)).mul(fine.mul(0.8).add(0.6)))
                .add(vec3(0.05, 0.18, 0.27).mul(threads)).add(warm)
                .add(this.secondary.mul(aperture).mul(0.032))
                .mul(float(1).add(this.pulse.mul(0.12)));
        })();
        const sky = new THREE.Mesh(new THREE.PlaneGeometry(260000, 180000), material);
        sky.position.z = -70000;
        sky.renderOrder = -100;
        sky.frustumCulled = false;
        sky.name = 'stellar-velocity-nebula-field';
        this.root.add(sky);
    }

    createFilaments() {
        const { ribbons: count, segments } = this.tier;
        const positions = [];
        const uvs = [];
        const indices = [];
        for (let i = 0; i <= segments; i += 1) {
            const t = i / segments;
            positions.push(-1, t, 0, 1, t, 0);
            uvs.push(0, t, 1, t);
            if (i < segments) {
                const a = i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        const normals = Array.from({ length: positions.length / 3 }, () => [0, 0, 1]).flat();
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setIndex(indices);
        const lanes = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            lanes.set([(i / count) * Math.PI * 2, i * 1.713, 0.55 + (i % 3) * 0.3, i % 2], i * 4);
        }
        geometry.setAttribute('aLane', new THREE.InstancedBufferAttribute(lanes, 4));
        geometry.instanceCount = count;
        const material = metadata(new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            fog: false,
        }), 'plasma-filament', 0.18);
        const lane = attribute('aLane', 'vec4');
        const laneFlat = varying(lane, 'vStellarLane').setInterpolation('flat');
        material.positionNode = Fn(() => {
            const t = positionGeometry.y.toVar();
            const angle = lane.x.add(t.mul(1.05)).add(this.time.mul(0.017))
                .add(sin(t.mul(9).add(lane.y).sub(this.time.mul(0.06))).mul(0.15)).toVar();
            const radius = float(2600).add(t.mul(9000))
                .mul(float(1).sub(this.warp.mul(0.15))).toVar();
            const width = positionGeometry.x.mul(lane.z).mul(0.035).toVar();
            const z = t.mul(-55000).sub(1200).toVar();
            const axis = this.travelAxis.mul(cameraPosition.z.sub(z)).toVar();
            return vec3(
                cos(angle.add(width)).mul(radius).add(axis.x),
                sin(angle.add(width)).mul(radius).mul(0.84).add(axis.y),
                z,
            );
        })();
        const field = Fn(() => {
            const q = uv().toVar();
            const cross = abs(q.x.sub(0.5)).mul(2).toVar();
            const soft = pow(float(1).sub(cross).max(0), 2.4).toVar();
            const thread = exp(cross.mul(-18)).toVar();
            const flowUV = vec2(q.y.mul(1.2).sub(this.time.mul(0.008)), laneFlat.y.mul(0.1));
            const flow = texture(this.noise, flowUV).r.toVar();
            const ends = smoothstep(0, 0.08, q.y).mul(float(1).sub(smoothstep(0.88, 1, q.y))).toVar();
            const pulse = sin(q.y.mul(27).sub(this.time.mul(1.2)).add(laneFlat.y)).mul(0.5).add(0.5).toVar();
            const hue = mix(this.primary, this.secondary, laneFlat.w.mul(0.75)).toVar();
            const light = soft.mul(0.25).add(thread.mul(0.85)).mul(flow.mul(0.9).add(0.3)).toVar();
            const opacity = light.mul(ends).mul(float(0.7).add(this.warp.mul(0.8)))
                .mul(float(0.75).add(pulse.mul(0.25))).toVar();
            return vec4(hue.mul(float(0.55).add(thread.mul(1.5))).mul(float(1).add(this.pulse.mul(0.25))), opacity);
        })();
        material.colorNode = field.rgb;
        material.opacityNode = field.a;
        material.emissiveNode = field.rgb.mul(field.a).mul(0.18);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'stellar-velocity-plasma-filaments';
        mesh.frustumCulled = false;
        this.root.add(mesh);
        this.filaments = mesh;
    }

    createCorona() {
        const material = metadata(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }), 'stellar-corona', 0.26);
        const glow = Fn(() => {
            const q = uv().sub(0.5).mul(2).toVar();
            const r = length(q).toVar();
            const haze = exp(r.mul(-8)).toVar();
            const density = texture(this.noise, q.mul(0.7).add(vec2(this.time.mul(0.006), 0))).r.toVar();
            const corona = exp(abs(r.sub(0.16).sub(density.mul(0.04))).mul(-70))
                .mul(density.mul(0.6).add(0.4)).toVar();
            const lens = exp(abs(q.y).mul(-180)).mul(exp(abs(q.x).mul(-4.5))).mul(0.22).toVar();
            const intensity = haze.mul(0.10).add(corona.mul(0.26)).add(lens)
                .mul(float(1).add(this.pulse.mul(0.25)))
                .toVar();
            return vec4(mix(this.secondary, this.primary, haze), intensity);
        })();
        material.colorNode = glow.rgb;
        material.opacityNode = glow.a;
        material.emissiveNode = glow.rgb.mul(glow.a).mul(0.26);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), material);
        mesh.name = 'stellar-velocity-stellar-corona';
        mesh.position.z = -525;
        this.coreGroup.add(mesh);
    }

    createCoreMaterial() {
        const uGlowIntensity = uniform(0.5);
        const uPulseBoost = uniform(0);
        const uColor = this.primary;
        const material = metadata(new THREE.MeshBasicNodeMaterial(), 'warpCore', 0.55);
        material.colorNode = Fn(() => {
            const q = uv().toVar();
            const distortion = texture(this.noise, q.mul(1.6).add(vec2(this.time.mul(0.003), 0))).rg.sub(0.5).toVar();
            const density = texture(this.noise, q.mul(vec2(3, 1.5)).add(distortion.mul(0.25))
                .sub(vec2(this.time.mul(0.02), 0))).r.toVar();
            const striation = sin(q.y.mul(95).add(density.mul(12)).sub(this.time.mul(0.22))).mul(0.5).add(0.5).toVar();
            const eye = pow(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))), 2).toVar();
            const surface = mix(vec3(0.008, 0.04, 0.10), uColor.mul(0.8), density.mul(0.8)).toVar();
            const threads = pow(striation, 9).mul(smoothstep(0.3, 0.75, density)).toVar();
            return surface.mul(eye.mul(0.4).add(0.5))
                .add(uColor.mul(threads).mul(1.25))
                .add(uColor.mul(pow(float(1).sub(eye), 3)).mul(0.8))
                .mul(float(0.8).add(uGlowIntensity.mul(0.6)).add(uPulseBoost.mul(0.15)));
        })();
        material.emissiveNode = material.colorNode.mul(0.55);
        material.userData.uniforms = {
            uTime: this.time, uColor, uGlowIntensity, uPulseBoost,
        };
        return material;
    }

    bindCore(theme) {
        const objects = [theme.warpCore, ...theme.warpCoreRings, ...theme.warpCoreGlowPlanes,
            ...theme.routeGuides, theme.warpAccretionDisc];
        objects.filter(Boolean).forEach((object) => this.coreGroup.add(object));
    }

    update(theme, dt = 0) {
        this.time.value = theme.time;
        this.warp.value = THREE.MathUtils.clamp(theme.currentSpeed / theme.maxSpeed, 0, 1);
        this.pulse.value = Math.min(1, theme.reactiveEnvelope.pulse);
        this.primary.value.copy(theme.activePalette.primary);
        this.secondary.value.copy(theme.activePalette.secondary);
        if (theme.time >= this.nextLayoutCheck) {
            this.nextLayoutCheck = theme.time + 0.5;
            this.board = typeof document === 'undefined' ? null
                : document.querySelector('.player-card[data-player="solo"], #game-container canvas');
            const rect = this.board?.getBoundingClientRect();
            const hasBoard = rect?.width > 0 && rect?.height > 0;
            this.layout = getStellarDestinationLayout(theme.camera.aspect, hasBoard);
        }
        const damping = this.layoutInitialized && dt > 0 ? 1 - Math.exp(-dt * 2.8) : 1;
        this.layoutInitialized = true;
        this.anchor.value.x += (this.layout.x - this.anchor.value.x) * damping;
        this.anchor.value.y += (this.layout.y - this.anchor.value.y) * damping;
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(theme.camera.fov) * 0.5)
            * (theme.camera.position.z + 500 * this.layout.scale);
        this.coreGroup.position.set(
            this.anchor.value.x * halfHeight * theme.camera.aspect,
            this.anchor.value.y * halfHeight,
            0,
        );
        this.coreGroup.scale.setScalar(this.layout.scale);
        const distance = theme.camera.position.z + 500 * this.layout.scale;
        this.travelAxis.value.set(this.coreGroup.position.x / distance, this.coreGroup.position.y / distance);
        const starAxis = theme.starfield?.material?.userData?.uniforms?.uTravelAxis;
        starAxis?.value.copy(this.travelAxis.value);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        const geometries = new Set();
        const materials = new Set();
        this.root.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        this.noise.dispose();
    }
}
