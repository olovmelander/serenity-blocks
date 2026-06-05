/**
 * @fileoverview ChapterThresholdDirector
 *
 * Phase 5 of the Odyssey AAA overhaul: authored, continuous chapter breaches.
 * The director owns a compact set of prebuilt scene-space effects centered on
 * the chapter seam. Triggers only update state; no geometry is allocated while
 * the player crosses a boundary.
 */

import * as THREE from 'three';

const DEFAULT_PROFILE = Object.freeze({
    id: '1-2',
    name: 'Steam Quench',
    kind: 0,
    stinger: 'steam-quench',
    primary: 0xff6a22,
    secondary: 0x58d8ff,
    particle: 0xbdefff,
    ringScale: 1.0,
    veilScale: 1.0,
});

export const ODYSSEY_THRESHOLD_PROFILES = Object.freeze({
    '1-2': Object.freeze({
        id: '1-2',
        name: 'Steam Quench',
        kind: 0,
        stinger: 'steam-quench',
        primary: 0xff6a22,
        secondary: 0x58d8ff,
        particle: 0xc7f4ff,
        ringScale: 0.95,
        veilScale: 1.0,
    }),
    '2-3': Object.freeze({
        id: '2-3',
        name: 'Surface Breach',
        kind: 1,
        stinger: 'surface-breach',
        primary: 0x4bd6ff,
        secondary: 0xfff1b8,
        particle: 0xffffff,
        ringScale: 1.08,
        veilScale: 1.1,
    }),
    '3-4': Object.freeze({
        id: '3-4',
        name: 'Ridgeline Rise',
        kind: 2,
        stinger: 'ridgeline-rise',
        primary: 0xa7e96a,
        secondary: 0xd9efff,
        particle: 0xe8f7ff,
        ringScale: 1.0,
        veilScale: 0.95,
    }),
    '4-5': Object.freeze({
        id: '4-5',
        name: 'Summit Liftoff',
        kind: 3,
        stinger: 'summit-liftoff',
        primary: 0xffd1b6,
        secondary: 0xaed6ff,
        particle: 0xf4fbff,
        ringScale: 1.18,
        veilScale: 1.25,
    }),
    '5-6': Object.freeze({
        id: '5-6',
        name: 'Atmosphere Edge',
        kind: 4,
        stinger: 'atmosphere-edge',
        primary: 0x9fd0ff,
        secondary: 0x1d2254,
        particle: 0xbddcff,
        ringScale: 1.35,
        veilScale: 1.3,
    }),
    '6-7': Object.freeze({
        id: '6-7',
        name: 'Lensing Engage',
        kind: 5,
        stinger: 'lensing-engage',
        primary: 0xb38bff,
        secondary: 0xff7a42,
        particle: 0xffc175,
        ringScale: 1.45,
        veilScale: 1.2,
    }),
    '7-8': Object.freeze({
        id: '7-8',
        name: 'Neon Snap',
        kind: 6,
        stinger: 'neon-snap',
        primary: 0xffffff,
        secondary: 0x00f0ff,
        particle: 0xff66c4,
        ringScale: 1.25,
        veilScale: 1.35,
    }),
});

export function getOdysseyThresholdProfile(boundaryId) {
    return ODYSSEY_THRESHOLD_PROFILES[boundaryId] || DEFAULT_PROFILE;
}

function makeUniforms() {
    return {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uIntensity: { value: 0 },
        uKind: { value: 0 },
        uPrimary: { value: new THREE.Color(DEFAULT_PROFILE.primary) },
        uSecondary: { value: new THREE.Color(DEFAULT_PROFILE.secondary) },
        uParticle: { value: new THREE.Color(DEFAULT_PROFILE.particle) },
        uDirection: { value: 1 },
    };
}

function easeOutCubic(t) {
    const inv = 1 - THREE.MathUtils.clamp(t, 0, 1);
    return 1 - inv * inv * inv;
}

function envelope(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    return Math.sin(clamped * Math.PI);
}

function createVeilMaterial(uniforms) {
    return new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uProgress;
            uniform float uIntensity;
            uniform float uKind;
            uniform vec3 uPrimary;
            uniform vec3 uSecondary;
            varying vec2 vUv;

            float hash21(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash21(i);
                float b = hash21(i + vec2(1.0, 0.0));
                float c = hash21(i + vec2(0.0, 1.0));
                float d = hash21(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float r = length(uv);
                float band = 0.0;
                float mist = noise(vUv * vec2(8.0, 5.0) + vec2(uTime * 0.18, -uTime * 0.11));
                float wave = sin((vUv.y + uProgress * 0.7) * 34.0 + uTime * 2.4);

                if (uKind < 0.5) {
                    float quench = smoothstep(-0.55, 0.45, uv.y + wave * 0.045);
                    band = mix(mist, 1.0 - mist, quench) * (1.0 - smoothstep(0.25, 1.1, r));
                } else if (uKind < 1.5) {
                    float waterline = 1.0 - smoothstep(0.0, 0.18, abs(uv.y - (uProgress - 0.45) * 0.7));
                    band = waterline + pow(1.0 - smoothstep(0.15, 1.0, r), 2.0) * 0.55;
                } else if (uKind < 2.5) {
                    float ridge = smoothstep(-0.55, 0.4, uv.y + abs(uv.x) * 0.45);
                    band = ridge * (0.45 + mist * 0.8);
                } else if (uKind < 3.5) {
                    float split = smoothstep(0.08, 0.85, abs(uv.x) + uProgress * 0.55);
                    band = (1.0 - split) * 0.7 + pow(1.0 - smoothstep(0.1, 1.05, r), 2.0);
                } else if (uKind < 4.5) {
                    float rim = 1.0 - smoothstep(0.02, 0.16, abs(r - (0.34 + uProgress * 0.38)));
                    band = rim + step(0.955, hash21(floor(vUv * 70.0))) * 0.55;
                } else if (uKind < 5.5) {
                    float lens = 1.0 - smoothstep(0.02, 0.18, abs(r - (0.28 + uProgress * 0.52)));
                    band = lens * (0.8 + wave * 0.2) + mist * 0.22;
                } else {
                    float scan = step(0.5, fract(vUv.y * 38.0 - uTime * 6.0));
                    float snap = 1.0 - smoothstep(0.0, 0.92, r);
                    band = snap * (0.85 + scan * 0.45);
                }

                float alpha = clamp(band * uIntensity * (1.0 - smoothstep(0.78, 1.28, r)), 0.0, 0.92);
                vec3 color = mix(uPrimary, uSecondary, smoothstep(-0.4, 0.8, uv.y) + mist * 0.18);
                gl_FragColor = vec4(color * (1.0 + uIntensity * 0.75), alpha);
            }
        `,
    });
}

function createRingMaterial(uniforms) {
    return new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uProgress;
            uniform float uIntensity;
            uniform float uKind;
            uniform vec3 uPrimary;
            uniform vec3 uSecondary;
            varying vec2 vUv;

            void main() {
                float scan = sin((vUv.x * 24.0) - uTime * (2.4 + uKind * 0.22));
                float edge = smoothstep(0.08, 0.5, vUv.y) * smoothstep(0.95, 0.45, vUv.y);
                float pulse = 0.55 + 0.45 * scan;
                vec3 color = mix(uPrimary, uSecondary, smoothstep(0.0, 1.0, vUv.x + uProgress * 0.2));
                float alpha = edge * (0.35 + pulse * 0.65) * uIntensity;
                gl_FragColor = vec4(color * (1.35 + uIntensity), alpha);
            }
        `,
    });
}

function createParticleMaterial(uniforms) {
    return new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute float aSeed;
            uniform float uTime;
            uniform float uProgress;
            uniform float uIntensity;
            uniform float uDirection;
            varying float vSeed;
            void main() {
                vSeed = aSeed;
                vec3 p = position;
                float burst = smoothstep(0.0, 1.0, uProgress);
                float swirl = sin(uTime * 2.0 + aSeed * 6.2831) * 0.38;
                p.xy *= 0.45 + burst * (1.7 + aSeed * 1.25);
                p.x += swirl * burst;
                p.y += (burst - 0.5) * uDirection * (1.2 + aSeed);
                p.z += sin(aSeed * 31.0 + uTime) * 0.55 * burst;

                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_PointSize = (8.0 + aSeed * 18.0) * uIntensity * (300.0 / max(1.0, -mv.z));
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uIntensity;
            uniform vec3 uParticle;
            varying float vSeed;
            void main() {
                vec2 p = gl_PointCoord * 2.0 - 1.0;
                float r = dot(p, p);
                if (r > 1.0) discard;
                float core = pow(1.0 - r, 2.4);
                float sparkle = 0.75 + 0.25 * sin(vSeed * 41.0);
                gl_FragColor = vec4(uParticle * (1.0 + uIntensity * 0.8), core * uIntensity * sparkle);
            }
        `,
    });
}

function createParticleGeometry(count = 180) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const seed = (i + 0.5) / count;
        const theta = seed * Math.PI * 2 * 17.0;
        const radius = 1.3 + ((((i * 37) % 101) / 101) * 3.6);
        const z = (((i * 53) % 97) / 97 - 0.5) * 1.8;
        const idx = i * 3;
        positions[idx] = Math.cos(theta) * radius;
        positions[idx + 1] = Math.sin(theta) * radius * 0.72;
        positions[idx + 2] = z;
        seeds[i] = seed;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    return geometry;
}

export class ChapterThresholdDirector {
    constructor(scene, pathCurve, options = {}) {
        this.scene = scene;
        this.pathCurve = pathCurve || null;
        this.chapterPositions = Array.isArray(options.chapterPositions) ? [...options.chapterPositions] : [];
        this.qualityName = options.qualityName || 'High';
        this.time = 0;
        this.active = null;

        this.uniforms = makeUniforms();
        this.group = new THREE.Group();
        this.group.name = 'odyssey-threshold-director';
        this.group.visible = false;
        this.group.renderOrder = 80;

        this.veil = new THREE.Mesh(
            new THREE.PlaneGeometry(32, 20, 1, 1),
            createVeilMaterial(this.uniforms),
        );
        this.veil.name = 'threshold-veil';
        this.veil.frustumCulled = false;
        this.group.add(this.veil);

        this.ring = new THREE.Mesh(
            new THREE.TorusGeometry(6.2, 0.075, 14, 144),
            createRingMaterial(this.uniforms),
        );
        this.ring.name = 'threshold-ring';
        this.ring.frustumCulled = false;
        this.group.add(this.ring);

        const particleCount = this.qualityName === 'Minimal' || this.qualityName === 'Low' ? 96 : 180;
        this.particles = new THREE.Points(
            createParticleGeometry(particleCount),
            createParticleMaterial(this.uniforms),
        );
        this.particles.name = 'threshold-particles';
        this.particles.frustumCulled = false;
        this.group.add(this.particles);

        this._scratchPosition = new THREE.Vector3();
        this._scratchTangent = new THREE.Vector3(0, 1, 0);

        if (this.scene) {
            this.scene.add(this.group);
        }
    }

    setPathCurve(pathCurve) {
        this.pathCurve = pathCurve || null;
    }

    setChapterPositions(chapterPositions = []) {
        this.chapterPositions = Array.isArray(chapterPositions)
            ? chapterPositions.filter((position) => Number.isFinite(position))
            : [];
    }

    trigger({
        boundaryId,
        boundaryPosition = null,
        durationMs = 900,
        direction = 1,
        intensity = 1,
    } = {}) {
        const profile = getOdysseyThresholdProfile(boundaryId);
        const resolvedBoundary = Number.isFinite(boundaryPosition)
            ? boundaryPosition
            : this._resolveBoundaryPosition(boundaryId);

        this.active = {
            boundaryId: profile.id,
            profile,
            boundaryPosition: THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1),
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            direction: Math.sign(direction) || 1,
            intensity: THREE.MathUtils.clamp(intensity, 0.2, 1.8),
            positionDriven: false,
            progress: 0,
            envelope: 0,
        };

        this.uniforms.uKind.value = profile.kind;
        this.uniforms.uPrimary.value.set(profile.primary);
        this.uniforms.uSecondary.value.set(profile.secondary);
        this.uniforms.uParticle.value.set(profile.particle);
        this.uniforms.uDirection.value = this.active.direction;
        this.uniforms.uProgress.value = 0;
        this.uniforms.uIntensity.value = 0;

        this._positionAt(this.active.boundaryPosition, 0);
        this.group.visible = true;
    }

    setSeamPhase({
        boundaryId,
        boundaryPosition = null,
        seamProgress = 0,
        seamPhase = 0,
        envelope: seamEnvelope = 0,
        direction = 1,
        intensity = 1,
    } = {}) {
        if (!boundaryId) return;

        const profile = getOdysseyThresholdProfile(boundaryId);
        const resolvedBoundary = Number.isFinite(boundaryPosition)
            ? boundaryPosition
            : this._resolveBoundaryPosition(boundaryId);

        if (!this.active || this.active.boundaryId !== profile.id || !this.active.positionDriven) {
            this.active = {
                boundaryId: profile.id,
                profile,
                boundaryPosition: THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1),
                startTime: performance.now(),
                duration: 1,
                direction: Math.sign(direction) || 1,
                intensity: THREE.MathUtils.clamp(intensity, 0.2, 1.8),
                positionDriven: true,
                progress: 0,
                seamPhase: 0,
                envelope: 0,
            };
            this.uniforms.uKind.value = profile.kind;
            this.uniforms.uPrimary.value.set(profile.primary);
            this.uniforms.uSecondary.value.set(profile.secondary);
            this.uniforms.uParticle.value.set(profile.particle);
            this.group.visible = true;
        }

        this.active.boundaryPosition = THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1);
        this.active.direction = Math.sign(direction) || 1;
        this.active.intensity = THREE.MathUtils.clamp(intensity, 0.2, 1.8);
        this.active.progress = THREE.MathUtils.clamp(seamProgress ?? ((seamPhase + 1) * 0.5), 0, 1);
        this.active.seamPhase = THREE.MathUtils.clamp(seamPhase || 0, -1, 1);
        this.active.envelope = THREE.MathUtils.clamp(seamEnvelope || 0, 0, 1);
        this.uniforms.uDirection.value = this.active.direction;
    }

    clearSeamPhase() {
        if (this.active?.positionDriven) {
            this.active = null;
            this.group.visible = false;
            this.uniforms.uIntensity.value = 0;
        }
    }

    update(deltaSeconds = 0, camera = null, directorState = null) {
        this.time += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        this.uniforms.uTime.value = this.time;

        if (!this.active) {
            this.uniforms.uIntensity.value = 0;
            this.group.visible = false;
            return;
        }

        const elapsed = performance.now() - this.active.startTime;
        const progress = this.active.positionDriven
            ? THREE.MathUtils.clamp(this.active.progress, 0, 1)
            : THREE.MathUtils.clamp(elapsed / this.active.duration, 0, 1);
        const env = this.active.positionDriven
            ? THREE.MathUtils.clamp(this.active.envelope, 0, 1)
            : envelope(progress);
        const beat = THREE.MathUtils.clamp(directorState?.beatPulse || 0, 0, 1);
        const energy = THREE.MathUtils.clamp(directorState?.energy || 0, 0, 1);
        const intensity = env * this.active.intensity * (1 + energy * 0.35 + beat * 0.22);

        this.uniforms.uProgress.value = progress;
        this.uniforms.uIntensity.value = intensity;

        const offset = (easeOutCubic(progress) - 0.5) * 0.022 * this.active.direction;
        this._positionAt(this.active.boundaryPosition, offset);

        if (camera) {
            this.group.quaternion.copy(camera.quaternion);
        }

        const { profile } = this.active;
        const scale = 1 + env * 0.16 + energy * 0.05;
        this.veil.scale.setScalar(profile.veilScale * scale);
        this.ring.scale.setScalar(profile.ringScale * (0.75 + progress * 0.75 + env * 0.15));
        this.ring.rotation.z += deltaSeconds * (0.4 + profile.kind * 0.035) * this.active.direction;
        this.particles.scale.setScalar(1 + progress * 0.65 + beat * 0.08);

        if (!this.active.positionDriven && progress >= 1) {
            this.active = null;
            this.group.visible = false;
            this.uniforms.uIntensity.value = 0;
        }
    }

    getActiveBoundaryId() {
        return this.active?.boundaryId || null;
    }

    _resolveBoundaryPosition(boundaryId) {
        if (typeof boundaryId !== 'string') return 0.5;
        const sourceChapter = Number.parseInt(boundaryId.split('-')[0], 10);
        const position = this.chapterPositions[sourceChapter];
        return Number.isFinite(position) ? position : 0.5;
    }

    _positionAt(progress, offset = 0) {
        const t = THREE.MathUtils.clamp(progress + offset, 0, 1);
        if (this.pathCurve?.getPointAt) {
            this.pathCurve.getPointAt(t, this._scratchPosition);
            if (this.pathCurve.getTangentAt) {
                this.pathCurve.getTangentAt(t, this._scratchTangent).normalize();
            }
        } else {
            this._scratchPosition.set(0, 0, 0);
            this._scratchTangent.set(0, 1, 0);
        }

        this.group.position.copy(this._scratchPosition);
        this.group.position.addScaledVector(this._scratchTangent, 0.8);
    }

    dispose() {
        if (this.scene && this.group.parent === this.scene) {
            this.scene.remove(this.group);
        }

        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.active = null;
    }
}

export default ChapterThresholdDirector;
