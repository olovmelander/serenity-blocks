/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
import * as THREE from 'three';
import {
    createGameplayBubbleNodeMaterial,
    createGameplayCausticRibbonNodeMaterial,
    createGameplayRippleNodeMaterial,
    createGameplayShockwaveNodeMaterial,
    createGameplaySiltNodeMaterial,
} from './ocean-materials.js';

export const QUALITY_EFFECT_LIMITS = {
    Minimal: {
        ripples: 0,
        ribbons: 0,
        shockwaves: 0,
        siltBursts: 2,
        bubbleBursts: 2,
        siltParticles: 12,
        bubbleParticles: 10,
        plumeBubbles: 0,
        postScale: 0.42,
        comboScale: 0.34,
        maxComboSurge: 0.38,
        fishResponse: false,
        resonance: false,
        cameraShake: 'none',
        chromaticAberration: false,
    },
    Low: {
        ripples: 0,
        ribbons: 0,
        shockwaves: 0,
        siltBursts: 3,
        bubbleBursts: 3,
        siltParticles: 16,
        bubbleParticles: 12,
        plumeBubbles: 6,
        postScale: 0.5,
        comboScale: 0.42,
        maxComboSurge: 0.46,
        fishResponse: false,
        resonance: false,
        cameraShake: 'none',
        chromaticAberration: false,
    },
    Medium: {
        ripples: 5,
        ribbons: 2,
        shockwaves: 2,
        siltBursts: 4,
        bubbleBursts: 4,
        siltParticles: 24,
        bubbleParticles: 18,
        plumeBubbles: 10,
        postScale: 0.7,
        comboScale: 0.66,
        maxComboSurge: 0.72,
        fishResponse: false,
        resonance: false,
        cameraShake: 'subtle',
        chromaticAberration: false,
    },
    High: {
        ripples: 7,
        ribbons: 3,
        shockwaves: 3,
        siltBursts: 5,
        bubbleBursts: 5,
        siltParticles: 30,
        bubbleParticles: 22,
        plumeBubbles: 14,
        postScale: 0.86,
        comboScale: 0.82,
        maxComboSurge: 0.92,
        fishResponse: true,
        resonance: true,
        cameraShake: 'standard',
        chromaticAberration: false,
    },
    Ultra: {
        ripples: 10,
        ribbons: 5,
        shockwaves: 4,
        siltBursts: 6,
        bubbleBursts: 6,
        siltParticles: 36,
        bubbleParticles: 28,
        plumeBubbles: 18,
        postScale: 1.0,
        comboScale: 1.0,
        maxComboSurge: 1.08,
        fishResponse: true,
        resonance: true,
        cameraShake: 'cinematic',
        chromaticAberration: true,
    },
    Extreme: {
        ripples: 12,
        ribbons: 6,
        shockwaves: 5,
        siltBursts: 7,
        bubbleBursts: 7,
        siltParticles: 42,
        bubbleParticles: 34,
        plumeBubbles: 22,
        postScale: 1.0,
        comboScale: 1.0,
        maxComboSurge: 1.12,
        fishResponse: true,
        resonance: true,
        cameraShake: 'cinematic',
        chromaticAberration: true,
    },
};

const CAMERA_SHAKE_SCALE = {
    none: 0,
    subtle: 0.5,
    standard: 1.0,
    cinematic: 1.0,
};

const FALLBACK_ANCHORS = [
    { x: -78, z: -78 },
    { x: 82, z: -66 },
    { x: -54, z: 22 },
    { x: 68, z: 34 },
    { x: -104, z: -18 },
    { x: 102, z: -6 },
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

function createFallbackParticleMaterial(kind) {
    const isBubble = kind === 'bubble';
    return new THREE.ShaderMaterial({
        uniforms: {
            uOpacity: { value: 0 },
            uColor: { value: new THREE.Color(isBubble ? 0x8feaff : 0x8c7550) },
        },
        vertexShader: `
            attribute float aLife;
            attribute float aSize;
            varying float vLife;

            void main() {
                vLife = aLife;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (150.0 / max(12.0, -mvPosition.z));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            uniform vec3 uColor;
            varying float vLife;

            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                if (d > 1.0) discard;
                ${
    isBubble
        ? `
                float shell = smoothstep(0.66, 0.84, d) * (1.0 - smoothstep(0.84, 1.0, d));
                float core = (1.0 - smoothstep(0.0, 0.5, d)) * 0.1;
                float alpha = (shell * 0.58 + core) * vLife * uOpacity;
                vec3 color = uColor * (shell + core) + vec3(0.9, 1.0, 1.0) * core * 0.4;
                `
        : `
                float dust = pow(1.0 - d, 1.8);
                float alpha = dust * vLife * uOpacity * 0.34;
                vec3 color = uColor * dust;
                `
}
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
}

function createFallbackRibbonMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
        },
        vertexShader: `
            varying vec2 vUv;

            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;

            void main() {
                float side = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
                float cross = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
                float lace = abs(sin(vUv.x * 28.0 + vUv.y * 10.0 - uTime * 2.2));
                lace *= abs(sin(vUv.x * 45.0 - uTime * 1.6));
                lace = pow(lace * 0.65 + 0.35, 6.0);
                float mask = side * cross * lace;
                vec3 color = mix(vec3(0.10, 0.58, 0.58), vec3(1.0, 0.76, 0.38), 0.28);
                gl_FragColor = vec4(color * mask, mask * uOpacity * 0.42);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}

function setMaterialOpacity(material, opacity) {
    if (!material) return;
    if (material.userData?.uOpacity) material.userData.uOpacity.value = opacity;
    if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = opacity;
    if ('opacity' in material) material.opacity = opacity;
}

function setMaterialTime(material, time) {
    if (!material) return;
    if (material.userData?.uTime) material.userData.uTime.value = time;
    if (material.uniforms?.uTime) material.uniforms.uTime.value = time;
}

function disposeObject(object) {
    if (!object) return;
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
}

export class OceanGameplayEffects {
    constructor({
        scene,
        camera,
        preset,
        quality = 'High',
        isWebGPU = false,
        getSeabedHeight,
        getPost,
        getFishSystem,
        getCamera,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.quality = quality;
        this.isWebGPU = isWebGPU;
        this.getSeabedHeight = getSeabedHeight;
        this.getPost = getPost;
        this.getFishSystem = getFishSystem;
        this.getCamera = getCamera;
        this.limits = QUALITY_EFFECT_LIMITS[quality] || QUALITY_EFFECT_LIMITS.High;

        this.group = new THREE.Group();
        this.group.name = 'OceanGameplayEffects';
        this.group.userData.isOceanGameplayEffects = true;

        this.ripplePool = [];
        this.shockwavePool = [];
        this.siltPool = [];
        this.bubblePool = [];
        this.ribbonPool = [];
        this.fallbackAnchorIndex = 0;
        this.anchorScratch = new THREE.Vector3();
        this.directionScratch = new THREE.Vector3();
        this.billboardDummy = new THREE.Object3D();
        this.screenRaycaster = new THREE.Raycaster();
        this.screenNdc = new THREE.Vector2();
        this.anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 16);
        this.lastPlayAnchor = null;

        // Displayed envelope values (lerp toward target)
        this.gameplayPulse = 0;
        this.comboSurge = 0;
        this.causticSweepStrength = 0;
        this.resonance = 0;
        // Targets — set on trigger, decay each frame; gameplayPulse lerps toward target
        // for a perceptible attack curve instead of instant snap.
        this.pulseTarget = 0;
        this.surgeTarget = 0;
        this.sweepTarget = 0;
        this.resonanceTarget = 0;

        this.lastComboTier = 0;
        this.lastTriggerType = null;
        this.deferredShockwave = null;
        this.stats = {
            pieceLocks: 0,
            combos: 0,
            lineClears: 0,
        };
        this._idlePostParams = {
            gameplayPulse: 0,
            comboSurge: 0,
            causticSweepStrength: 0,
            chromaticAberrationEnabled: this.limits.chromaticAberration === true,
        };
        this._activePostParams = { ...this._idlePostParams };
        this._updateResult = {
            currentBoost: 0,
            glowBoost: 0,
            comboSurge: 0,
            gameplayPulse: 0,
            causticSweepStrength: 0,
        };
    }

    init() {
        if (!this.scene) return;
        this.scene.add(this.group);

        // Pre-warm shared materials for WebGPU to avoid shader compilation lag
        if (this.isWebGPU) {
            this.rippleMat = createGameplayRippleNodeMaterial();
            this.shockwaveMat = createGameplayShockwaveNodeMaterial();
            this.siltMat = createGameplaySiltNodeMaterial();
            this.bubbleMat = createGameplayBubbleNodeMaterial();
            this.ribbonMat = createGameplayCausticRibbonNodeMaterial();
        }

        this.createRipplePool();
        this.createShockwavePool();
        this.createParticlePool('silt');
        this.createParticlePool('bubble');
        this.createRibbonPool();
    }

    /**
     * Temporarily expose zero-alpha pool members so compileAsync can discover
     * every lock/combo material. Returns an idempotent restore callback.
     */
    prepareForCompile() {
        const states = [];
        this.group.traverse((object) => {
            if (!object.material) return;
            states.push({
                object,
                visible: object.visible,
                count: object.isInstancedMesh ? object.count : null,
                frustumCulled: object.frustumCulled,
            });
            object.visible = true;
            object.frustumCulled = false;
            if (object.isInstancedMesh && object.count === 0) object.count = 1;
        });

        let restored = false;
        return () => {
            if (restored) return;
            restored = true;
            states.forEach((state) => {
                // A real event may have claimed a pool member while the async
                // compiler was running. Never rewind that live effect back to
                // its precompile hidden/count=0 snapshot.
                if (state.object.userData?.effect?.active) return;
                state.object.visible = state.visible;
                state.object.frustumCulled = state.frustumCulled;
                if (state.count !== null) state.object.count = state.count;
            });
        };
    }

    setMeshOpacity(mesh, opacity) {
        if (!mesh) return;
        const attr = mesh.geometry.attributes.aBurstOpacity;
        if (attr) {
            attr.array.fill(opacity);
            attr.needsUpdate = true;
        } else {
            setMaterialOpacity(mesh.material, opacity);
        }
    }

    createRipplePool() {
        for (let i = 0; i < this.limits.ripples; i += 1) {
            const geometry = new THREE.RingGeometry(0.68, 1.0, 32, 1);
            geometry.rotateX(-Math.PI / 2);

            if (this.isWebGPU) {
                const opacities = new Float32Array(geometry.attributes.position.count).fill(0);
                geometry.setAttribute('aBurstOpacity', new THREE.BufferAttribute(opacities, 1));
            }

            const material = this.isWebGPU
                ? (this.rippleMat || createGameplayRippleNodeMaterial())
                : new THREE.MeshBasicMaterial({
                    color: 0x65d5d5,
                    transparent: true,
                    opacity: 0,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData.effect = {
                active: false,
                age: 0,
                duration: 1,
                intensity: 0,
                baseScale: 1,
            };
            this.group.add(mesh);
            this.ripplePool.push(mesh);
        }
    }

    createShockwavePool() {
        // Thin bright edge ring that expands fast — punctuates lock + line clear.
        for (let i = 0; i < this.limits.shockwaves; i += 1) {
            const geometry = new THREE.RingGeometry(0.92, 1.0, 32, 1);
            geometry.rotateX(-Math.PI / 2);

            if (this.isWebGPU) {
                const opacities = new Float32Array(geometry.attributes.position.count).fill(0);
                geometry.setAttribute('aBurstOpacity', new THREE.BufferAttribute(opacities, 1));
            }

            const material = this.isWebGPU
                ? (this.shockwaveMat || createGameplayShockwaveNodeMaterial())
                : new THREE.MeshBasicMaterial({
                    color: 0xc6f7ff,
                    transparent: true,
                    opacity: 0,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData.effect = {
                active: false,
                age: 0,
                duration: 0.7,
                intensity: 0,
                baseScale: 1,
                startScale: 0.18,
                endScale: 1.0,
            };
            this.group.add(mesh);
            this.shockwavePool.push(mesh);
        }
    }

    createParticlePool(kind) {
        const pool = kind === 'silt' ? this.siltPool : this.bubblePool;
        const burstCount = kind === 'silt' ? this.limits.siltBursts : this.limits.bubbleBursts;
        const maxParticles = kind === 'silt' ? this.limits.siltParticles : this.limits.bubbleParticles;

        for (let i = 0; i < burstCount; i += 1) {
            const positions = new Float32Array(maxParticles * 3);
            const lives = new Float32Array(maxParticles);
            const sizes = new Float32Array(maxParticles);
            const phases = new Float32Array(maxParticles);

            let geometry;
            let material;
            let particles;
            const isBillboard = this.isWebGPU;

            if (this.isWebGPU) {
                geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
                geometry.setAttribute('aLife', new THREE.InstancedBufferAttribute(lives, 1));
                geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
                geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
                geometry.setAttribute('aBurstOpacity', new THREE.InstancedBufferAttribute(new Float32Array(maxParticles).fill(0), 1));
                geometry.attributes.aLife.setUsage(THREE.DynamicDrawUsage);
                geometry.attributes.aSize.setUsage(THREE.DynamicDrawUsage);
                geometry.attributes.aPhase.setUsage(THREE.DynamicDrawUsage);
                geometry.attributes.aBurstOpacity.setUsage(THREE.DynamicDrawUsage);
                material = kind === 'silt'
                    ? (this.siltMat || createGameplaySiltNodeMaterial())
                    : (this.bubbleMat || createGameplayBubbleNodeMaterial());
                particles = new THREE.InstancedMesh(geometry, material, maxParticles);
                particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                particles.count = 0;
                particles.userData.primitive = 'billboard-quad';
            } else {
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
                geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
                geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
                geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
                geometry.attributes.aLife.setUsage(THREE.DynamicDrawUsage);
                geometry.setDrawRange(0, 0);
                material = createFallbackParticleMaterial(kind);
                particles = new THREE.Points(geometry, material);
            }

            particles.frustumCulled = false;
            particles.visible = false;
            particles.userData.effect = {
                kind,
                isBillboard,
                active: false,
                age: 0,
                duration: kind === 'silt' ? 1.35 : 1.85,
                intensity: 0,
                activeCount: 0,
                maxParticles,
                positions,
                lives,
                sizes,
                phases,
                velocities: new Float32Array(maxParticles * 3),
                corkscrew: false,
            };
            this.group.add(particles);
            pool.push(particles);
        }
    }

    createRibbonPool() {
        for (let i = 0; i < this.limits.ribbons; i += 1) {
            const geometry = new THREE.PlaneGeometry(1, 1, 8, 1);
            geometry.rotateX(-Math.PI / 2);

            if (this.isWebGPU) {
                const opacities = new Float32Array(geometry.attributes.position.count).fill(0);
                geometry.setAttribute('aBurstOpacity', new THREE.BufferAttribute(opacities, 1));
            }

            const material = this.isWebGPU
                ? (this.ribbonMat || createGameplayCausticRibbonNodeMaterial())
                : createFallbackRibbonMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData.effect = {
                active: false,
                age: 0,
                duration: 1.6,
                intensity: 0,
                direction: new THREE.Vector3(1, 0, 0),
            };
            this.group.add(mesh);
            this.ribbonPool.push(mesh);
        }
    }

    triggerPieceLock(payload = {}) {
        if (!this.scene) return;
        const anchor = this.resolveAnchor(payload);
        this.rememberPlayAnchor(anchor);
        const { postScale } = this.limits;
        this.stats.pieceLocks += 1;
        this.lastTriggerType = 'piece-lock';
        // Boosted lock amplitudes — these read clearly through the haze.
        this.pulseTarget = Math.max(this.pulseTarget, 0.68 * postScale);
        this.sweepTarget = Math.max(this.sweepTarget, 0.40 * postScale);
        this.resonanceTarget = Math.max(this.resonanceTarget, 0.28 * postScale);

        if (this.limits.ripples > 0) {
            this.spawnRipple(anchor, randRange(7.5, 11), 0.88);
        }
        // Concentric shockwave: a thin bright edge that follows the soft ripple.
        this.spawnShockwave(anchor, randRange(10, 13.5), 0.82);
        // Second offset shockwave queued for ~80 ms — produces the perceptual punch.
        this.deferredShockwave = {
            delay: 0.08,
            anchor: anchor.clone(),
            radius: randRange(8, 11),
            alpha: 0.58,
        };

        this.spawnParticleBurst(
            this.siltPool,
            anchor,
            Math.round(randRange(8, Math.min(20, this.limits.siltParticles))),
            0.82,
        );
        // Vertical bubble plume rising from the lock site.
        const plumeBudget = clamp(
            this.limits.plumeBubbles,
            0,
            this.limits.bubbleParticles,
        );
        if (plumeBudget > 0) {
            this.spawnParticleBurst(
                this.bubblePool,
                anchor,
                plumeBudget,
                0.98,
                false,
                true,
            );
        } else {
            this.spawnParticleBurst(
                this.bubblePool,
                anchor,
                Math.round(randRange(8, Math.min(20, this.limits.bubbleParticles))),
                0.68,
            );
        }

        this.applyCameraShake(0.018, 140);
        this.logIfDebug('piece-lock', { anchor });
    }

    triggerLineClear(payload = {}) {
        const lineCount = Number(payload?.lineCount ?? 1);
        if (!Number.isFinite(lineCount) || lineCount <= 0) return;
        const anchor = this.resolveAnchor(payload, { preferLastPlayAnchor: true });
        const isTetris = lineCount >= 4;
        this.stats.lineClears += 1;
        this.lastTriggerType = 'line-clear';
        const intensity = clamp(0.32 + lineCount * 0.12, 0.32, 0.86) * this.limits.postScale;

        // Tetris hero moment: a sustained surge boost that drives the post-flash.
        if (isTetris) {
            this.surgeTarget = this.raiseSurgeTarget(0.95 * this.limits.postScale);
            this.pulseTarget = Math.max(this.pulseTarget, 0.6 * this.limits.postScale);
            this.sweepTarget = Math.max(this.sweepTarget, 0.78 * this.limits.postScale);
            this.resonanceTarget = Math.max(
                this.resonanceTarget,
                this.limits.resonance ? 0.62 * this.limits.postScale : 0,
            );
            // Optional cathedral mood transition — only if the camera supports it.
            const camera = this.getCamera?.();
            if (camera?.requestImpulseMood) camera.requestImpulseMood('cathedral', 3.2);
        } else {
            this.pulseTarget = Math.max(this.pulseTarget, 0.28 * intensity);
            this.sweepTarget = Math.max(this.sweepTarget, 0.22 * intensity);
            this.resonanceTarget = Math.max(this.resonanceTarget, 0.12 * intensity);
        }

        if (this.limits.ripples > 0) {
            this.spawnRipple(anchor, 4.5 + lineCount * 1.2, 0.55 * intensity);
        }
        let shockwaveAlpha = 0.7;
        if (isTetris) shockwaveAlpha = 0.85;
        else if (lineCount >= 2) shockwaveAlpha = 0.78;
        this.spawnShockwave(anchor, 9 + lineCount * 2.4, shockwaveAlpha);
        this.spawnParticleBurst(
            this.siltPool,
            anchor,
            Math.round(clamp(5 + lineCount * 3, 6, this.limits.siltParticles)),
            0.55 * intensity,
        );
        this.spawnParticleBurst(
            this.bubblePool,
            anchor,
            Math.round(clamp(5 + lineCount * 3, 6, this.limits.bubbleParticles)),
            0.5 * intensity,
        );

        if (lineCount >= 2 && this.limits.ribbons > 0) {
            this.spawnCausticRibbon(anchor, intensity);
        }

        // Tetris fan: 4–5 ribbons radiating from the play column.
        if (isTetris && this.limits.ribbons > 0) {
            const fanCount = Math.min(this.limits.ribbons, 5) - 1;
            for (let i = 0; i < fanCount; i += 1) {
                this.spawnCausticRibbon(anchor, intensity, {
                    angleOverride: ((i + 1) / fanCount) * Math.PI * 2,
                });
            }
        }

        if (isTetris) this.applyCameraShake(0.12, 480);
        else if (lineCount >= 2) this.applyCameraShake(0.045 * lineCount, 200);

        this.logIfDebug('line-clear', {
            lineCount, intensity, anchor, isTetris,
        });
    }

    triggerCombo(comboCount) {
        const count = Number(comboCount?.comboCount ?? comboCount ?? 0);
        if (!Number.isFinite(count) || count < 2) return;

        let tier = 1;
        if (count >= 8) tier = 3;
        else if (count >= 5) tier = 2;

        let baseIntensity = 1.0;
        if (tier === 1) baseIntensity = 0.42 + (count - 2) * 0.08;
        else if (tier === 2) baseIntensity = 0.72 + (count - 5) * 0.07;

        const intensity = clamp(
            baseIntensity * this.limits.comboScale,
            0,
            this.limits.maxComboSurge,
        );
        const anchorPayload = typeof comboCount === 'object' ? comboCount : {};
        const anchor = this.resolveAnchor(anchorPayload, { preferLastPlayAnchor: true });

        this.stats.combos += 1;
        this.lastTriggerType = 'combo';
        this.lastComboTier = tier;
        this.surgeTarget = this.raiseSurgeTarget(intensity * 1.4);
        this.pulseTarget = Math.max(this.pulseTarget, 0.55 * intensity);
        this.sweepTarget = Math.max(this.sweepTarget, 0.7 * intensity);
        this.resonanceTarget = Math.max(
            this.resonanceTarget,
            this.limits.resonance ? intensity * (tier >= 2 ? 0.85 : 0.42) : 0,
        );

        // First ribbon anchored to the play site so combos visibly emanate from
        // the action; additional ribbons fan out from peripheral fallbacks.
        let requestedRibbonCount = 1;
        if (tier === 2) requestedRibbonCount = 2;
        else if (tier >= 3) requestedRibbonCount = tier + 1;
        const ribbonCount = Math.min(this.limits.ribbons, requestedRibbonCount);
        for (let i = 0; i < ribbonCount; i += 1) {
            const ribbonAnchor = i === 0 ? anchor.clone() : this.pickFallbackAnchor();
            this.spawnCausticRibbon(ribbonAnchor, intensity);
        }

        // The synchronous line-clear that follows already owns local silt,
        // bubbles, and a soft ripple. Combo stays readable as the world-scale
        // ribbon/crown/fish crescendo instead of exhausting those same pools.

        // Shockwaves stack with tier — 1 / 2 / 3 rings out from the anchor.
        const shockwaveCount = Math.min(this.limits.shockwaves, tier);
        for (let i = 0; i < shockwaveCount; i += 1) {
            const radius = 9 + tier * 3 + i * 2.5;
            this.spawnShockwave(anchor, radius, intensity * 0.85);
        }

        // Fish scatter at tier 2+ (was tier 3) and stronger amplitude.
        if (tier >= 2 && this.limits.fishResponse) {
            this.getFishSystem?.()?.triggerGameplaySurge?.(intensity * 1.4, anchor);
        }

        if (tier === 1) this.applyCameraShake(0.025, 180);
        else if (tier === 2) this.applyCameraShake(0.06, 240);
        else this.applyCameraShake(0.1, 360);

        this.logIfDebug('combo', {
            count, tier, intensity, anchor,
        });
    }

    applyCameraShake(magnitude, durationMs) {
        const reducedMotion = typeof window !== 'undefined'
            && (
                window.settings?.reducedMotion === true
                || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
            );
        if (reducedMotion) return;
        const scale = CAMERA_SHAKE_SCALE[this.limits.cameraShake] ?? 0;
        if (scale <= 0) return;
        const camera = this.getCamera?.();
        if (!camera?.applyShakeImpulse) return;
        camera.applyShakeImpulse(magnitude * scale, durationMs);
    }

    raiseSurgeTarget(value) {
        return Math.min(
            this.limits.maxComboSurge,
            Math.max(this.surgeTarget, value),
        );
    }

    rememberPlayAnchor(anchor) {
        if (!anchor) return;
        if (!this.lastPlayAnchor) this.lastPlayAnchor = new THREE.Vector3();
        this.lastPlayAnchor.copy(anchor);
    }

    resolveAnchor(payload = {}, { preferLastPlayAnchor = false } = {}) {
        const positionAsWorld = payload?.position && Number.isFinite(payload.position.z) ? payload.position : null;
        const explicit = payload?.worldPosition || payload?.positionWorld || positionAsWorld;
        if (explicit && Number.isFinite(explicit.x) && Number.isFinite(explicit.z)) {
            const x = clamp(explicit.x, -118, 118);
            const z = clamp(explicit.z, -120, 72);
            return this.anchorScratch.set(x, this.getAnchorY(x, z), z).clone();
        }

        const screenPosition = payload?.position || payload?.screenPosition;
        if (
            screenPosition
            && Number.isFinite(screenPosition.x)
            && Number.isFinite(screenPosition.y)
            && this.camera
            && typeof window !== 'undefined'
        ) {
            const width = Math.max(1, window.innerWidth || 1);
            const height = Math.max(1, window.innerHeight || 1);
            this.screenNdc.set(
                (screenPosition.x / width) * 2 - 1,
                -(screenPosition.y / height) * 2 + 1,
            );
            this.screenRaycaster.setFromCamera(this.screenNdc, this.camera);
            const hit = this.screenRaycaster.ray.intersectPlane(
                this.anchorPlane,
                this.anchorScratch,
            );
            if (hit) {
                let x = clamp(hit.x, -118, 118);
                if (Math.abs(x) < 24) x += x < 0 ? -34 : 34;
                const z = clamp(hit.z, -120, 72);
                return this.anchorScratch.set(x, this.getAnchorY(x, z), z).clone();
            }
        }

        const piece = payload?.piece || payload || {};
        const pieceAnchor = this.resolvePieceAnchor(piece);
        if (pieceAnchor) return pieceAnchor;

        if (preferLastPlayAnchor && this.lastPlayAnchor) {
            return this.lastPlayAnchor.clone();
        }

        return this.pickFallbackAnchor();
    }

    resolvePieceAnchor(piece = {}) {
        if (!piece || typeof piece !== 'object') return null;

        let rawX = [piece.x, piece.col, piece.column].find(Number.isFinite);
        let rawY = [piece.y, piece.row].find(Number.isFinite);

        if (Array.isArray(piece.shape) && Number.isFinite(piece.x) && Number.isFinite(piece.y)) {
            let sumX = 0;
            let sumY = 0;
            let occupied = 0;

            piece.shape.forEach((row, localY) => {
                if (!Array.isArray(row)) return;
                row.forEach((cell, localX) => {
                    if (!cell) return;
                    sumX += piece.x + localX;
                    sumY += piece.y + localY;
                    occupied += 1;
                });
            });

            if (occupied > 0) {
                rawX = sumX / occupied;
                rawY = sumY / occupied;
            }
        }

        if (!Number.isFinite(rawX)) return null;

        let x = (clamp(rawX, -2, 12) - 4.5) * 12.0;
        if (Math.abs(x) < 24) x += x < 0 ? -34 : 34;
        const z = Number.isFinite(rawY)
            ? clamp(58 - rawY * 6.2, -116, 66)
            : randRange(-72, 42);
        return this.anchorScratch.set(x, this.getAnchorY(x, z), z).clone();
    }

    pickFallbackAnchor() {
        const anchor = FALLBACK_ANCHORS[this.fallbackAnchorIndex % FALLBACK_ANCHORS.length];
        this.fallbackAnchorIndex += 1;
        const x = anchor.x + randRange(-5, 5);
        const z = anchor.z + randRange(-5, 5);
        return this.anchorScratch.set(x, this.getAnchorY(x, z), z).clone();
    }

    getAnchorY(x, z) {
        const seabedY = typeof this.getSeabedHeight === 'function' ? this.getSeabedHeight(x, z) : -16;
        return seabedY + 1.6;
    }

    spawnRipple(anchor, baseScale, intensity) {
        const mesh = this.ripplePool.find((item) => !item.userData.effect.active);
        if (!mesh) return;
        const { effect } = mesh.userData;
        effect.active = true;
        effect.age = 0;
        effect.duration = 1.05 + intensity * 0.25;
        effect.intensity = intensity;
        effect.baseScale = baseScale;
        mesh.position.copy(anchor);
        mesh.position.y += 0.18;
        mesh.rotation.z = randRange(0, Math.PI * 2);
        mesh.scale.setScalar(baseScale * 0.45);
        mesh.visible = true;
        this.setMeshOpacity(mesh, 0.55 * intensity);
    }

    spawnShockwave(anchor, baseScale, intensity) {
        const mesh = this.shockwavePool.find((item) => !item.userData.effect.active);
        if (!mesh) return;
        const { effect } = mesh.userData;
        effect.active = true;
        effect.age = 0;
        effect.duration = 0.62 + intensity * 0.18;
        effect.intensity = intensity;
        effect.baseScale = baseScale;
        effect.startScale = 0.16;
        effect.endScale = 1.05;
        mesh.position.copy(anchor);
        mesh.position.y += 0.22;
        mesh.rotation.z = randRange(0, Math.PI * 2);
        mesh.scale.setScalar(baseScale * effect.startScale);
        mesh.visible = true;
        this.setMeshOpacity(mesh, 0.95 * intensity);
    }

    spawnCausticRibbon(anchor, intensity, options = {}) {
        const mesh = this.ribbonPool.find((item) => !item.userData.effect.active);
        if (!mesh) return;
        const { effect } = mesh.userData;
        const angle = Number.isFinite(options.angleOverride)
            ? options.angleOverride
            : randRange(-0.55, 0.55) + (Math.random() < 0.5 ? 0 : Math.PI);
        effect.active = true;
        effect.age = 0;
        effect.duration = 1.25 + intensity * 0.55;
        effect.intensity = intensity;
        effect.direction.set(Math.cos(angle), 0, Math.sin(angle));
        mesh.position.copy(anchor);
        mesh.position.y += 0.4;
        mesh.rotation.y = -angle;
        mesh.scale.set(36 + intensity * 28, 1, 6 + intensity * 5);
        mesh.visible = true;
        this.setMeshOpacity(mesh, 0.65 * intensity);
    }

    spawnParticleBurst(pool, anchor, requestedCount, intensity, corkscrew = false, plumeUp = false) {
        const points = pool.find((item) => !item.userData.effect.active);
        if (!points) return;
        const { effect } = points.userData;
        const { geometry } = points;
        const positions = effect.isBillboard
            ? effect.positions
            : geometry.attributes.position.array;
        const lives = effect.isBillboard ? effect.lives : geometry.attributes.aLife.array;
        const sizes = effect.isBillboard ? effect.sizes : geometry.attributes.aSize.array;
        const phases = effect.isBillboard ? effect.phases : geometry.attributes.aPhase.array;
        const { velocities } = effect;
        const count = clamp(Math.floor(requestedCount), 1, effect.maxParticles);
        const isBubble = effect.kind === 'bubble';

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const angle = randRange(0, Math.PI * 2);
            // Plume mode: tight horizontal radius, hard upward bias.
            const radius = plumeUp
                ? randRange(0.1, 1.2)
                : randRange(0.2, isBubble ? 2.1 : 3.8);
            let rise;
            if (plumeUp) rise = randRange(7.5, 12.5);
            else if (isBubble) rise = randRange(4.2, 8.8);
            else rise = randRange(0.7, 2.2);
            let drift;
            if (plumeUp) drift = randRange(0.15, 0.6);
            else if (isBubble) drift = randRange(0.4, 1.8);
            else drift = randRange(0.8, 2.6);
            positions[i3] = anchor.x + Math.cos(angle) * radius;
            positions[i3 + 1] = anchor.y + randRange(0, isBubble ? 1.3 : 0.45);
            positions[i3 + 2] = anchor.z + Math.sin(angle) * radius;
            velocities[i3] = Math.cos(angle) * drift + (corkscrew ? -Math.sin(angle) * 2.2 : 0);
            velocities[i3 + 1] = rise;
            velocities[i3 + 2] = Math.sin(angle) * drift + (corkscrew ? Math.cos(angle) * 2.2 : 0);
            lives[i] = 1;
            const sizeBoost = plumeUp ? 1.35 : 1.0;
            sizes[i] = isBubble
                ? randRange(1.4, 3.9) * intensity * sizeBoost
                : randRange(1.1, 3.2);
            phases[i] = randRange(0, Math.PI * 2);
        }

        for (let i = count; i < effect.maxParticles; i += 1) {
            lives[i] = 0;
        }

        effect.active = true;
        effect.age = 0;
        const durationBase = isBubble ? 1.45 : 1.12;
        const durationGain = isBubble ? 0.9 : 0.45;
        effect.duration = (durationBase + intensity * durationGain) * (plumeUp ? 1.6 : 1.0);
        effect.intensity = intensity;
        effect.activeCount = count;
        effect.corkscrew = corkscrew;
        effect.plumeUp = plumeUp;
        points.visible = true;
        if (effect.isBillboard) {
            points.count = count;
            this.updateParticleBillboards(points);
        } else {
            geometry.setDrawRange(0, count);
            geometry.attributes.position.needsUpdate = true;
        }
        geometry.attributes.aLife.needsUpdate = true;
        // Optimization: sizes and phases are static after spawn, only update if kind requires it
        geometry.attributes.aSize.needsUpdate = true;
        geometry.attributes.aPhase.needsUpdate = true;
        this.setMeshOpacity(points, clamp(0.5 * intensity + 0.25, 0, 0.95));
    }

    update(delta, time) {
        const dt = clamp(delta || 0.016, 0.001, 0.05);
        this._effectTime = time;

        // Decay targets (rate matches the previous decay so peak duration is preserved).
        this.pulseTarget = Math.max(0, this.pulseTarget - dt * 1.6);
        this.surgeTarget = Math.max(0, this.surgeTarget - dt * 0.48);
        this.sweepTarget = Math.max(0, this.sweepTarget - dt * 0.82);
        this.resonanceTarget = Math.max(0, this.resonanceTarget - dt * 0.62);

        // Lerp displayed value toward target with a ~25ms time constant — gives
        // a perceptible attack curve instead of an instant snap to peak.
        const attackTau = 0.025;
        const attackAlpha = 1 - Math.exp(-dt / attackTau);
        this.gameplayPulse += (this.pulseTarget - this.gameplayPulse) * attackAlpha;
        this.comboSurge += (this.surgeTarget - this.comboSurge) * attackAlpha;
        this.causticSweepStrength
            += (this.sweepTarget - this.causticSweepStrength) * attackAlpha;
        this.resonance += (this.resonanceTarget - this.resonance) * attackAlpha;

        // Deferred follow-up shockwave (lock-piece punch).
        if (this.deferredShockwave) {
            this.deferredShockwave.delay -= dt;
            if (this.deferredShockwave.delay <= 0) {
                const { anchor, radius, alpha } = this.deferredShockwave;
                this.spawnShockwave(anchor, radius, alpha);
                this.deferredShockwave = null;
            }
        }

        // Idle fast-path: when every envelope has settled, nothing is queued,
        // and no pool has a live member, the material-time writes, billboard
        // matrix precompute, five pool passes, and post update would all be
        // no-ops (the pool passes already skip inactive items). Skip them and
        // return zero boosts — identical rendered result. We push exact-zero
        // post params once on entering idle so the post graph is fully at rest.
        const envelopesQuiet = this.pulseTarget === 0 && this.surgeTarget === 0
            && this.sweepTarget === 0 && this.resonanceTarget === 0
            && this.gameplayPulse < 1e-4 && this.comboSurge < 1e-4
            && this.causticSweepStrength < 1e-4 && this.resonance < 1e-4;
        if (envelopesQuiet && !this.deferredShockwave && !this._hasActiveEffects()) {
            this.gameplayPulse = 0;
            this.comboSurge = 0;
            this.causticSweepStrength = 0;
            this.resonance = 0;
            if (!this._idleParamsPushed) {
                this.getPost?.()?.updateParams?.(this._idlePostParams);
                this._idleParamsPushed = true;
            }
            this._updateResult.currentBoost = 0;
            this._updateResult.glowBoost = 0;
            this._updateResult.comboSurge = 0;
            this._updateResult.gameplayPulse = 0;
            this._updateResult.causticSweepStrength = 0;
            return this._updateResult;
        }
        this._idleParamsPushed = false;

        // Shared time and billboard state pre-computation
        if (this.isWebGPU) {
            setMaterialTime(this.rippleMat, time);
            setMaterialTime(this.shockwaveMat, time);
            setMaterialTime(this.siltMat, time);
            setMaterialTime(this.bubbleMat, time);
            setMaterialTime(this.ribbonMat, time);

            // Precompute the billboard rotation matrix once per frame instead of per-particle
            if (this.camera && this.billboardDummy) {
                this.billboardDummy.position.set(0, 0, 0);
                this.billboardDummy.quaternion.copy(this.camera.quaternion);
                this.billboardDummy.scale.setScalar(1);
                this.billboardDummy.updateMatrix();
                this._sharedBillboardMatrix = this.billboardDummy.matrix.elements;
            }
        }

        this.updateRipples(dt, time);
        this.updateShockwaves(dt, time);
        this.updateParticles(this.siltPool, dt, time);
        this.updateParticles(this.bubblePool, dt, time);
        this.updateRibbons(dt, time);

        this._activePostParams.gameplayPulse = this.gameplayPulse;
        this._activePostParams.comboSurge = this.comboSurge;
        this._activePostParams.causticSweepStrength = this.causticSweepStrength;
        this.getPost?.()?.updateParams?.(this._activePostParams);

        this._updateResult.currentBoost = this.comboSurge * 0.55 + this.gameplayPulse * 0.12;
        this._updateResult.glowBoost = this.comboSurge * 0.32
            + this.gameplayPulse * 0.16
            + this.resonance * 0.38;
        this._updateResult.comboSurge = this.comboSurge;
        this._updateResult.gameplayPulse = this.gameplayPulse;
        this._updateResult.causticSweepStrength = this.causticSweepStrength;
        return this._updateResult;
    }

    updateShockwaves(dt, time) {
        this.shockwavePool.forEach((mesh) => {
            const { effect } = mesh.userData;
            if (!effect.active) return;
            effect.age += dt;
            const t = clamp01(effect.age / effect.duration);
            // Rapid expansion (ease-out cubic), then quick fade.
            const expand = 1 - (1 - t) ** 3;
            const scale = effect.baseScale * (effect.startScale + expand * (effect.endScale - effect.startScale));
            mesh.scale.setScalar(scale);
            mesh.position.y += dt * 0.06;
            const fade = (1 - t) ** 1.6;
            if (!this.isWebGPU) setMaterialTime(mesh.material, time);
            this.setMeshOpacity(mesh, fade * effect.intensity);
            if (t >= 1) {
                effect.active = false;
                mesh.visible = false;
                setMaterialOpacity(mesh.material, 0);
            }
        });
    }

    updateRipples(dt, time) {
        this.ripplePool.forEach((mesh) => {
            const { effect } = mesh.userData;
            if (!effect.active) return;
            effect.age += dt;
            const t = clamp01(effect.age / effect.duration);
            const fade = Math.sin(t * Math.PI) * (1 - t * 0.25);
            const scale = effect.baseScale * (0.45 + t * 1.5);
            mesh.scale.setScalar(scale);
            mesh.position.y += dt * 0.08;
            if (!this.isWebGPU) setMaterialTime(mesh.material, time);
            this.setMeshOpacity(mesh, fade * effect.intensity * 0.7);
            if (t >= 1) {
                effect.active = false;
                mesh.visible = false;
                setMaterialOpacity(mesh.material, 0);
            }
        });
    }

    updateParticleBillboards(mesh) {
        const effect = mesh?.userData?.effect;
        if (!effect?.isBillboard || !this._sharedBillboardMatrix) return;

        const baseMatrix = this._sharedBillboardMatrix;
        const instanceArray = mesh.instanceMatrix.array;

        for (let i = 0; i < effect.activeCount; i += 1) {
            const i3 = i * 3;
            const offset = i * 16;
            const life = effect.lives[i];
            let scale = effect.sizes[i] * (0.75 + life * 0.55);
            if (effect.kind === 'bubble') {
                const shimmer = Math.sin((this._effectTime || 0) * 1.6 + effect.phases[i]) * 0.08 + 1;
                scale = effect.sizes[i] * shimmer * (0.84 + life * 0.36);
            }

            // Scale the billboard basis, not positionLocal in TSL. In r181 the
            // instance transform runs before positionNode, so shader scaling
            // also scaled the world translation and displaced whole bursts.
            instanceArray[offset] = baseMatrix[0] * scale;
            instanceArray[offset + 1] = baseMatrix[1] * scale;
            instanceArray[offset + 2] = baseMatrix[2] * scale;
            instanceArray[offset + 3] = baseMatrix[3];

            instanceArray[offset + 4] = baseMatrix[4] * scale;
            instanceArray[offset + 5] = baseMatrix[5] * scale;
            instanceArray[offset + 6] = baseMatrix[6] * scale;
            instanceArray[offset + 7] = baseMatrix[7];

            instanceArray[offset + 8] = baseMatrix[8] * scale;
            instanceArray[offset + 9] = baseMatrix[9] * scale;
            instanceArray[offset + 10] = baseMatrix[10] * scale;
            instanceArray[offset + 11] = baseMatrix[11];

            // Set translation (particle position)
            instanceArray[offset + 12] = effect.positions[i3];
            instanceArray[offset + 13] = effect.positions[i3 + 1];
            instanceArray[offset + 14] = effect.positions[i3 + 2];
            instanceArray[offset + 15] = 1;
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    updateParticles(pool, dt, time) {
        pool.forEach((points) => {
            const { effect } = points.userData;
            if (!effect.active) return;
            effect.age += dt;
            const t = clamp01(effect.age / effect.duration);
            const fade = Math.sin(t * Math.PI);
            const { geometry } = points;
            const positions = effect.isBillboard
                ? effect.positions
                : geometry.attributes.position.array;
            const lives = effect.isBillboard ? effect.lives : geometry.attributes.aLife.array;
            const { velocities } = effect;

            for (let i = 0; i < effect.activeCount; i += 1) {
                const i3 = i * 3;
                if (effect.corkscrew) {
                    const swirl = Math.sin(effect.age * 7.5 + i * 0.6) * dt * 1.4;
                    const vx = velocities[i3];
                    velocities[i3] += velocities[i3 + 2] * swirl;
                    velocities[i3 + 2] -= vx * swirl;
                }
                positions[i3] += velocities[i3] * dt;
                positions[i3 + 1] += velocities[i3 + 1] * dt;
                positions[i3 + 2] += velocities[i3 + 2] * dt;
                velocities[i3] *= 0.988;
                velocities[i3 + 1] *= effect.kind === 'bubble' ? 0.996 : 0.952;
                velocities[i3 + 2] *= 0.988;
                lives[i] = fade;
            }

            if (!this.isWebGPU) setMaterialTime(points.material, time);
            this.setMeshOpacity(
                points,
                fade * clamp(0.55 * effect.intensity + 0.25, 0, 0.9),
            );
            if (effect.isBillboard) this.updateParticleBillboards(points);
            else geometry.attributes.position.needsUpdate = true;
            geometry.attributes.aLife.needsUpdate = true;

            if (t >= 1) {
                effect.active = false;
                effect.activeCount = 0;
                points.visible = false;
                if (effect.isBillboard) points.count = 0;
                else geometry.setDrawRange(0, 0);
                setMaterialOpacity(points.material, 0);
            }
        });
    }

    updateRibbons(dt, time) {
        this.ribbonPool.forEach((mesh) => {
            const { effect } = mesh.userData;
            if (!effect.active) return;
            effect.age += dt;
            const t = clamp01(effect.age / effect.duration);
            const fade = Math.sin(t * Math.PI) * (1 - t * 0.1);
            mesh.position.addScaledVector(effect.direction, dt * (8 + effect.intensity * 9));
            mesh.scale.x *= 1 + dt * 0.12;
            if (!this.isWebGPU) setMaterialTime(mesh.material, time);
            this.setMeshOpacity(mesh, fade * effect.intensity * 0.85);
            if (t >= 1) {
                effect.active = false;
                mesh.visible = false;
                setMaterialOpacity(mesh.material, 0);
            }
        });
    }

    countActive(pool) {
        return pool.reduce((count, item) => count + (item.userData.effect.active ? 1 : 0), 0);
    }

    _hasActiveEffects() {
        return this.ripplePool.some((m) => m.userData.effect.active)
            || this.shockwavePool.some((m) => m.userData.effect.active)
            || this.siltPool.some((m) => m.userData.effect.active)
            || this.bubblePool.some((m) => m.userData.effect.active)
            || this.ribbonPool.some((m) => m.userData.effect.active);
    }

    logIfDebug(label, payload) {
        if (typeof window === 'undefined' || window.__oceanGameplayDebug !== true) return;
        const a = payload?.anchor;
        const anchorStr = a ? `(${a.x.toFixed(1)}, ${a.y.toFixed(1)}, ${a.z.toFixed(1)})` : 'n/a';
        // eslint-disable-next-line no-console
        console.log(
            `🌊 [Ocean] ${label} anchor=${anchorStr} pulse=${this.gameplayPulse.toFixed(
                2,
            )} surge=${this.comboSurge.toFixed(2)}`,
            payload,
        );
    }

    collectSignoff() {
        return {
            enabled: true,
            quality: this.quality,
            state: {
                gameplayPulse: Number(this.gameplayPulse.toFixed(3)),
                comboSurge: Number(this.comboSurge.toFixed(3)),
                causticSweepStrength: Number(this.causticSweepStrength.toFixed(3)),
                resonance: Number(this.resonance.toFixed(3)),
                lastComboTier: this.lastComboTier,
                lastTriggerType: this.lastTriggerType,
            },
            active: {
                ripples: this.countActive(this.ripplePool),
                shockwaves: this.countActive(this.shockwavePool),
                siltBursts: this.countActive(this.siltPool),
                bubbleBursts: this.countActive(this.bubblePool),
                causticRibbons: this.countActive(this.ribbonPool),
            },
            pool: {
                ripples: this.ripplePool.length,
                shockwaves: this.shockwavePool.length,
                siltBursts: this.siltPool.length,
                bubbleBursts: this.bubblePool.length,
                causticRibbons: this.ribbonPool.length,
                siltParticlesPerBurst: this.limits.siltParticles,
                bubbleParticlesPerBurst: this.limits.bubbleParticles,
                plumeBubblesPerBurst: this.limits.plumeBubbles,
            },
            qualityFeatures: {
                fishResponse: this.limits.fishResponse === true,
                jellyfishCoralResonance: this.limits.resonance === true,
                postScale: this.limits.postScale,
                maxComboSurge: this.limits.maxComboSurge,
                cameraShake: this.limits.cameraShake,
                chromaticAberration: this.limits.chromaticAberration === true,
            },
            rendering: {
                primitive: this.isWebGPU ? 'billboard-quad' : 'points',
                webgpuPointSprites: false,
            },
            triggers: { ...this.stats },
        };
    }

    dispose() {
        [
            ...this.ripplePool,
            ...this.shockwavePool,
            ...this.siltPool,
            ...this.bubblePool,
            ...this.ribbonPool,
        ].forEach(disposeObject);
        this.group?.parent?.remove(this.group);
        this.ripplePool = [];
        this.shockwavePool = [];
        this.siltPool = [];
        this.bubblePool = [];
        this.ribbonPool = [];
        this.deferredShockwave = null;
        this.scene = null;
        this.camera = null;
        this.group = null;
        this.anchorScratch = null;
        this.directionScratch = null;
        this.billboardDummy = null;
        this.screenRaycaster = null;
        this.screenNdc = null;
        this.anchorPlane = null;
    }
}

export default OceanGameplayEffects;
