import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { INTRO_PHASES, getIntroVisualProfile, getQualityBudget } from './intro-visual-config.js';

const gradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uExposure: { value: 1.04 },
        uContrast: { value: 1.12 },
        uSaturation: { value: 1.1 },
        uChromatic: { value: 0.0014 },
        uVignette: { value: 0.42 },
        uGrain: { value: 0.0025 },
        uDither: { value: 0.0018 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime, uExposure, uContrast, uSaturation;
        uniform float uChromatic, uVignette, uGrain, uDither;
        varying vec2 vUv;
        void main() {
            vec2 centered = vUv - 0.5;
            float dist = length(centered);
            vec2 offset = centered * uChromatic * (1.0 + dist * 0.6);
            vec3 hdr = vec3(texture2D(tDiffuse, vUv + offset).r,
                texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - offset).b);
            float vignette = 1.0 - smoothstep(0.35, 0.95, dist);
            hdr *= mix(1.0 - uVignette, 1.0, vignette);
            vec3 exposed = clamp(hdr, 0.0, 64.0) * uExposure;
            vec3 toned = clamp((exposed * (exposed * 2.51 + 0.03)) /
                (exposed * (exposed * 2.43 + 0.59) + 0.14), 0.0, 1.0);
            float luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            vec3 graded = (mix(vec3(luma), toned, uSaturation) - 0.5) * uContrast + 0.5;
            float grain = (fract(sin(vUv.x * 1234.5 + vUv.y * 6789.3 + uTime * 41.0)
                * 43758.5453) - 0.5) * uGrain;
            float dither = (fract(sin(vUv.x * 317.1 + vUv.y * 269.5)
                * 43758.5453) - 0.5) * uDither;
            gl_FragColor = vec4(clamp(graded + grain + dither, 0.0, 1.0), 1.0);
            #include <colorspace_fragment>
        }
    `,
};

/** Shared authored profile applied to the current classic intro's CPU scene. */
export class IntroClassicProfile {
    constructor(visual) {
        this.visual = visual;
        this.profile = getIntroVisualProfile();
        this.quality = getQualityBudget(this.profile);
        this.phase = INTRO_PHASES.IDLE;
        this.phaseState = this.getPhasePreset(this.phase);
        this.transition = null;
        this.time = 0;
        this.nextHeroInhale = 6 + Math.random() * 2;
        this.heroRelease = Infinity;
        this.audioPulse = 0;
        this.reaction = {
            surge: 0, bloom: 0, chroma: 0, cameraKick: 0, glow: 0, spin: 0, vertigo: 0, scatter: 0,
        };
        this.recyclingPolicy = { mode: 'oldest', minimumResidenceMs: 0 };
        this.gradePass = null;
        if (visual.composer) {
            this.gradePass = new ShaderPass(gradeShader);
            for (const [key, value] of Object.entries({
                uExposure: this.profile.post.baseExposure,
                uContrast: this.profile.post.contrast,
                uSaturation: this.profile.post.saturation,
                uChromatic: this.profile.post.chromatic,
                uVignette: this.profile.post.vignetteDarkness,
                uGrain: this.profile.post.grain,
                uDither: this.profile.post.dither,
            })) this.gradePass.uniforms[key].value = value;
            visual.composer.addPass(this.gradePass);
            visual.renderer.toneMapping = THREE.NoToneMapping;
        }
        visual.portableProfile = this;
        this.setPerformanceBudget('HIGH');
    }

    getPhasePreset(phase) {
        const base = this.profile.phaseCurves[phase] || this.profile.phaseCurves[INTRO_PHASES.IDLE];
        return Object.fromEntries(['bloomMul', 'attractionMul', 'spawnMul', 'titleGlowMul',
            'particleMul', 'cameraDriftMul'].map((key) => [key, base[key] ?? 1]));
    }

    setPhase(phase, immediate = false, options = null) {
        if (!phase) return;
        this.phase = phase;
        const target = this.getPhasePreset(phase);
        const durationMs = options?.durationMs ?? this.profile.phaseCurves[phase]?.durationMs ?? 520;
        this.transition = immediate ? null : {
            elapsed: 0,
            duration: Math.max(0.001, durationMs / 1000),
            from: { ...this.phaseState },
            to: target,
        };
        if (immediate) this.phaseState = target;
    }

    setPerformanceBudget(level = 'HIGH') {
        const key = ['HIGH', 'MEDIUM', 'LOW'].includes(level) ? level : 'HIGH';
        this.quality = getQualityBudget(this.profile, key);
        this.visual.performanceLevel = key;
        this.visual.quality = this.quality;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
        this.visual.renderer?.setPixelRatio(pixelRatio);
        this.visual.composer?.setPixelRatio?.(pixelRatio);
        if (this.visual.bloomPass) {
            this.visual.bloomPass.enabled = this.quality.bloom;
            this.visual.bloomPass.strength = this.quality.bloomStrength;
            this.visual.bloomPass.radius = this.profile.post.bloomRadius;
            this.visual.bloomPass.threshold = this.profile.post.bloomThreshold;
        }
        for (const cloud of this.visual.nebulaClouds || []) cloud.visible = this.quality.nebulaClouds > 0;
        const sky = this.visual.nebulaSkyUniforms;
        if (sky?.uCloudCalibration) sky.uCloudCalibration.value.set(0.6, 0.9, 0.32);
        if (sky?.uHiCyan) sky.uHiCyan.value.setRGB(0.055, 0.34, 0.47);
        if (sky?.uHiMagenta) sky.uHiMagenta.value.setRGB(0.34, 0.08, 0.42);
        if (sky?.uIntensity) {
            const tierScale = { LOW: 0.82, MEDIUM: 0.9, HIGH: 1 }[key];
            sky.uIntensity.value = (this.visual.isBackgroundMode ? 0.5 : 1) * tierScale;
        }
    }

    setReactionState(state = {}) {
        for (const key of Object.keys(this.reaction)) {
            if (!Number.isFinite(state[key])) continue;
            const min = key === 'spin' ? -1 : 0;
            const max = key === 'bloom' || key === 'chroma' ? 1.5 : 1;
            this.reaction[key] = THREE.MathUtils.clamp(state[key], min, max);
        }
    }

    setTetrominoRecyclingPolicy(policy = {}) {
        const options = typeof policy === 'string' ? { mode: policy } : (policy || {});
        const minimumResidenceMs = Number.isFinite(options.minimumResidenceMs) ? options.minimumResidenceMs : 0;
        this.recyclingPolicy = {
            mode: options.mode === 'minimum-residence' ? 'minimum-residence' : 'oldest',
            minimumResidenceMs: Math.max(0, minimumResidenceMs),
        };
        return { ...this.recyclingPolicy };
    }

    canSpawn() {
        const pieces = this.visual.activeTetrominos;
        if (pieces.length < this.quality.maxTetrominos) return true;
        const oldest = pieces.reduce((a, b) => ((a.userData.bornAt ?? 0) < (b.userData.bornAt ?? 0) ? a : b));
        if (!this.canRetire(oldest)) return false;
        this.visual.scene.remove(oldest);
        pieces.splice(pieces.indexOf(oldest), 1);
        return pieces.length < this.quality.maxTetrominos;
    }

    canRetire(piece) {
        return this.recyclingPolicy.mode !== 'minimum-residence'
            || (this.time - (piece.userData.bornAt ?? 0)) * 1000 >= this.recyclingPolicy.minimumResidenceMs;
    }

    prepareFrame(delta) {
        const dt = THREE.MathUtils.clamp(delta, 0, 1 / 30);
        this.time += dt;
        if (this.phase === INTRO_PHASES.IDLE && this.time >= this.nextHeroInhale) {
            this.setPhase(INTRO_PHASES.HERO_INHALE);
            this.heroRelease = this.time + this.profile.heroInhale.holdDuration;
        } else if (this.phase === INTRO_PHASES.HERO_INHALE && this.time >= this.heroRelease) {
            this.setPhase(INTRO_PHASES.IDLE, false, { durationMs: this.profile.heroInhale.releaseDuration * 1000 });
            this.nextHeroInhale = this.time + this.profile.heroInhale.intervalMin
                + Math.random() * (this.profile.heroInhale.intervalMax - this.profile.heroInhale.intervalMin);
        }
        if (this.transition) {
            this.transition.elapsed += dt;
            const t = Math.min(1, this.transition.elapsed / this.transition.duration);
            const ease = t * t * (3 - 2 * t);
            for (const key of Object.keys(this.transition.to)) {
                this.phaseState[key] = THREE.MathUtils.lerp(this.transition.from[key], this.transition.to[key], ease);
            }
            if (t === 1) this.transition = null;
        }
        const breath = Math.sin(this.time * 0.262) * 0.5 + 0.5;
        if (this.visual.bloomPass) {
            this.visual.bloomPass.strength = this.quality.bloom
                ? this.quality.bloomStrength * this.phaseState.bloomMul + this.audioPulse * 0.05
                + this.reaction.surge * 0.1 + breath * 0.03 + this.reaction.bloom * 0.28 : 0;
        }
        if (this.gradePass) {
            this.gradePass.uniforms.uTime.value = this.time;
            this.gradePass.uniforms.uChromatic.value = this.profile.post.chromatic + this.reaction.chroma * 0.014;
        }
        if (this.visual.nebulaSkyUniforms?.uPulse) {
            this.visual.nebulaSkyUniforms.uPulse.value = breath * 0.7
                + this.audioPulse * 0.3 + this.reaction.glow * 0.5;
        }
        if (this.visual.particles?.material?.uniforms?.uPulse) {
            this.visual.particles.material.uniforms.uPulse.value = 1 + this.audioPulse + this.reaction.glow;
            this.visual.particles.material.uniforms.uParticleMul.value = this.phaseState.particleMul;
        }
        for (const resource of Object.values(this.visual.cachedResources || {})) {
            resource.material.emissiveIntensity = 0.5 + this.reaction.glow * 0.8;
            resource.edgeMaterial.opacity = 0.9 + this.reaction.glow * 0.1;
        }
        return dt;
    }

    applyCamera(camera) {
        const state = this.reaction;
        const scale = (1 + state.surge * 1.5) / Math.max(0.1, this.phaseState.cameraDriftMul);
        camera.position.x /= scale;
        camera.position.y /= scale;
        camera.position.z = 40 - state.surge * 10 + (Math.sin(this.time * 0.262) * 0.5) * 1.4;
        if (state.cameraKick) {
            camera.position.x += Math.sin(this.time * 46) * state.cameraKick * 0.16;
            camera.position.y += Math.cos(this.time * 46 * 1.27) * state.cameraKick * 0.12;
            camera.position.z -= state.cameraKick * 1.2;
        }
        camera.position.z += state.vertigo * 3.2;
        const fov = 60 - state.vertigo * 7;
        if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    }

    pulseReactionAt(x, y, strength = 1) {
        const { visual } = this;
        if (!visual.camera || !visual.raycaster) return;
        visual.camera.updateMatrixWorld();
        visual.raycaster.setFromCamera(new THREE.Vector2(
            THREE.MathUtils.clamp(x, 0, 1) * 2 - 1,
            1 - THREE.MathUtils.clamp(y, 0, 1) * 2,
        ), visual.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const hit = visual.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (!hit) return;
        for (let i = 0; i < Math.max(1, Math.min(4, Math.round(strength * 2))); i += 1) {
            visual.createCollisionEffect(hit.x, hit.y, hit.z);
        }
    }

    dispose() {
        if (!this.gradePass) return;
        this.visual.composer?.removePass(this.gradePass);
        this.gradePass.dispose();
        this.gradePass = null;
    }
}
