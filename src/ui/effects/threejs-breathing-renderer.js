/**
 * Breathing's intentionally shared WebGL renderer (ADR-0008).
 * Twelve environments use a retained scene, analytic light and GPU particle motion.
 * The same artwork runs on desktop and mobile; tiers only reduce render cost.
 */
import * as THREE from 'three';
import {
    BREATHING_VISUAL_PROFILES, FULLSCREEN_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER,
} from './breathing-atmosphere.js';
import { BREATHING_FORM_FRAGMENT } from './breathing-forms.js';

const QUALITY_PRESETS = {
    Extreme: { particleCount: 1000, pixelRatio: 1.75, frameInterval: 0 },
    High: { particleCount: 650, pixelRatio: 1.5, frameInterval: 0 },
    Medium: { particleCount: 400, pixelRatio: 1.25, frameInterval: 1000 / 45 },
    Low: { particleCount: 220, pixelRatio: 1, frameInterval: 1000 / 30 },
    Minimal: { particleCount: 100, pixelRatio: 0.8, frameInterval: 1000 / 30 },
};
const SESSION_PHASES = {
    grounding: 1, active: 2, retention: 3, recovery: 4, integration: 5,
};

const PARTICLE_VERTEX = /* glsl */ `
    attribute float aSeed, aSize;
    uniform float uTime, uBreath, uMotion, uPixelRatio, uMode;
    varying float vAlpha, vSeed;
    const float TAU = 6.2831853;
    void main() {
        float t = uTime * uMotion;
        float b = uBreath;
        float seed = aSeed;
        float angle = seed * TAU;
        vec3 p = position;
        // Each world carries its own motion language; all paths freeze under
        // reduced motion while essential inhale/exhale deformation stays live.
        if (uMode < 0.5) {
            p.x = sin(seed * 29.0 + t * 0.12) * (1.5 + b * 0.5);
            p.y = mod(position.y + t * 0.12 + 5.0, 10.0) - 5.0;
            p.y += b * 0.45;
        } else if (uMode < 1.5) {
            float edge = floor(seed * 4.0);
            float along = fract(seed * 4.0 + t * 0.025) * 2.0 - 1.0;
            float r = 1.4 + b * 0.6 + fract(seed * 37.0) * 0.3;
            if (edge < 0.5) p.xy = vec2(along, 1.0) * r;
            else if (edge < 1.5) p.xy = vec2(1.0, -along) * r;
            else if (edge < 2.5) p.xy = vec2(-along, -1.0) * r;
            else p.xy = vec2(-1.0, along) * r;
        } else if (uMode < 2.5) {
            p.x += sin(t * 0.08 + seed * 30.0) * 0.2;
            p.y = -1.2 - fract(seed * 17.0) * 1.7 + sin(p.x * 2.0 + t * 0.1) * b * 0.12;
        } else if (uMode < 3.5) {
            float r = 1.5 + fract(seed * 41.0 + t * 0.02) * 3.0 + b * 0.6;
            p.xy = vec2(cos(angle), sin(angle)) * r;
        } else if (uMode < 4.5) {
            float r = 1.3 + fract(seed * 23.0) * 1.7;
            float petal = 0.75 + sin(angle * 5.0 + t * 0.03) * 0.2;
            p.xy = vec2(cos(angle), sin(angle)) * r * petal * (0.8 + b * 0.35);
        } else if (uMode < 5.5) {
            float side = floor(seed * 3.0);
            float along = fract(seed * 3.0 + t * 0.015);
            vec2 a = vec2(sin(side * TAU / 3.0), cos(side * TAU / 3.0));
            vec2 c = vec2(sin((side + 1.0) * TAU / 3.0), cos((side + 1.0) * TAU / 3.0));
            p.xy = mix(a, c, along) * (1.9 + b * 0.55 + fract(seed * 31.0) * 0.35);
        } else if (uMode < 6.5) {
            p.y = mod(position.y + t * 0.42 + 5.0, 10.0) - 5.0;
            p.x = sin(seed * 25.0 + p.y * 0.8 + t * 0.16) * (0.2 + (p.y + 5.0) * 0.08) * (0.7 + b * 0.6);
        } else if (uMode < 7.5) {
            p.x = mod(position.x + t * 0.15 + 5.0, 10.0) - 5.0;
            p.y = -0.9 - fract(seed * 31.0) * 1.5 + sin(p.x * 1.8 + t * 0.15 + seed * 8.0) * (0.1 + b * 0.28);
        } else if (uMode < 8.5) {
            p.x = position.x * 0.85;
            p.y = -1.6 - fract(seed * 13.0) * 1.0 + sin(p.x * 2.0) * 0.1;
            p.z = -1.0;
        } else if (uMode < 9.5) {
            float r = 1.3 + fract(seed * 31.0) * 3.0;
            float arm = r * 1.25 + floor(seed * 3.0) * TAU / 3.0 + t * 0.04;
            p.xy = vec2(cos(arm), sin(arm)) * r * (0.85 + b * 0.25);
            p.z = -r * 0.35;
        } else if (uMode < 10.5) {
            p.x = sign(position.x) * (1.2 + fract(seed * 29.0) * 1.4) + sin(t * 0.1 + seed * 40.0) * b * 0.18;
            p.y = sin(seed * 35.0) * 2.7 + sin(t * 0.16 + seed * 26.0) * 0.08;
        } else {
            p.y = position.y;
            p.x = sign(position.x) * (1.3 + fract(seed * 11.0) * 1.0) + sin(p.y * 3.0 + seed * 9.0 + t * 0.2) * (0.1 + b * 0.18);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPixelRatio * (5.0 / -mv.z), 1.0, 10.0);
        vAlpha = (0.19 + 0.14 * sin(t * 0.35 + seed * 90.0)) * (0.65 + b * 0.35);
        vSeed = seed;
    }
`;
const PARTICLE_FRAGMENT = `
    uniform vec3 uColorA, uColorB, uColorC;
    uniform float uReveal;
    varying float vAlpha, vSeed;
    void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float glow = exp(-r * r * 5.0) * (1.0 - smoothstep(0.45, 1.0, r));
        vec3 c = mix(uColorA, uColorC, vSeed);
        c = mix(c, vec3(1.0), 0.28);
        gl_FragColor = vec4(c, glow * vAlpha * uReveal);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

export class ThreeJSBreathingRenderer {
    constructor(container) {
        this.container = container;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.isRunning = false;
        this.animationId = null;
        this.intensity = 0.3;
        this.phase = 'inhale';
        this.currentTechnique = 'deep-relaxation';
        this.techniqueParams = {};
        this.sceneObjects = {};
        this.qualityName = window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches ? 'Low' : 'High';
        this.quality = QUALITY_PRESETS[this.qualityName];
        this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        this.time = 0;
        this.reveal = 0;
        this.phaseProgress = 0;
        this.sessionPhase = null;
        this.lastFrameTime = null;
        this._animateBound = (now) => this.animate(now);
        this._visibilityHandler = () => {
            this.lastFrameTime = null;
            if (document.hidden) this._cancelFrame();
            else if (this.isRunning && !this.animationId) this.animationId = requestAnimationFrame(this._animateBound);
        };
        this._contextLostHandler = (event) => {
            event.preventDefault();
            this.contextLost = true;
            this._cancelFrame();
            this.container.closest('.enhanced-breathing-indicator')?.classList.remove('breathing-renderer-ready');
        };
        this._contextRestoredHandler = () => {
            this.contextLost = false;
            this.lastFrameTime = null;
            this.container.closest('.enhanced-breathing-indicator')?.classList.add('breathing-renderer-ready');
            if (this.isRunning && !document.hidden && !this.animationId) {
                this.animationId = requestAnimationFrame(this._animateBound);
            }
        };
        this._motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        this._motionHandler = (event) => { this.reducedMotion = event.matches; };
    }

    init() {
        if (this.renderer) return;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.renderer.domElement.className = 'breathing-scene-canvas';
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
        this.container.appendChild(this.renderer.domElement);
        this.renderer.domElement.addEventListener('webglcontextlost', this._contextLostHandler);
        this.renderer.domElement.addEventListener('webglcontextrestored', this._contextRestoredHandler);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 30);
        this.camera.position.z = 6;
        this.uniforms = {
            uTime: { value: 0 },
            uBreath: { value: this.intensity },
            uMode: { value: 0 },
            uMotion: { value: this.reducedMotion ? 0 : 1 },
            uReveal: { value: 0 },
            uPhaseProgress: { value: 0 },
            uPhase: { value: 0 },
            uSession: { value: 0 },
            uPixelRatio: { value: 1 },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uColorA: { value: new THREE.Color() },
            uColorB: { value: new THREE.Color() },
            uColorC: { value: new THREE.Color() },
        };
        this.targetColors = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
        this._buildRetainedScene();
        this.setTechnique(this.currentTechnique, this.techniqueParams);
        this.resize();
        this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(this.container);
        document.addEventListener('visibilitychange', this._visibilityHandler);
        this._motionQuery?.addEventListener?.('change', this._motionHandler);
    }

    _makePlane(fragmentShader, order) {
        const material = new THREE.ShaderMaterial({
            vertexShader: FULLSCREEN_VERTEX_SHADER,
            fragmentShader,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            premultipliedAlpha: true,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        this.scene.add(mesh);
        return mesh;
    }

    _buildRetainedScene() {
        this.sceneObjects.atmosphere = this._makePlane(ATMOSPHERE_FRAGMENT_SHADER, 0);
        this.sceneObjects.form = this._makePlane(BREATHING_FORM_FRAGMENT, 2);
        const count = QUALITY_PRESETS.Extreme.particleCount;
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const sizes = new Float32Array(count);
        // Stable distribution allows reproducible screenshots and allocation-free switches.
        let seed = 1847;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < count; i++) {
            const angle = random() * Math.PI * 2;
            const radius = 1.15 + random() * 3.5;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = Math.sin(angle) * radius;
            positions[i * 3 + 2] = -random() * 3;
            seeds[i] = random();
            sizes[i] = 1.5 + random() * 4;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, this.quality.particleCount);
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.particles = new THREE.Points(geometry, material);
        this.sceneObjects.particles.renderOrder = 1;
        this.scene.add(this.sceneObjects.particles);
    }

    setTechnique(name, params = {}) {
        this.currentTechnique = BREATHING_VISUAL_PROFILES[name] ? name : 'deep-relaxation';
        this.techniqueParams = params || {};
        if (!this.uniforms) return;
        const profile = BREATHING_VISUAL_PROFILES[this.currentTechnique];
        this.uniforms.uMode.value = profile.mode;
        ['color', 'secondaryColor', 'tertiaryColor'].forEach((key, index) => {
            const c = this.techniqueParams[key];
            if (c) this.targetColors[index].setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
            else this.targetColors[index].setHex(profile.colors[index], THREE.SRGBColorSpace);
        });
        if (!this.isRunning) ['uColorA', 'uColorB', 'uColorC'].forEach((key, i) => this.uniforms[key].value.copy(this.targetColors[i]));
        this.reveal = Math.min(this.reveal, 0.35);
    }

    // Compatibility entry point; scene resources are retained rather than rebuilt.
    rebuildScene() { this.setTechnique(this.currentTechnique, this.techniqueParams); }

    updateIntensity(intensity, phase, progress = 0) {
        this.intensity = Number.isFinite(intensity) ? THREE.MathUtils.clamp(intensity, 0, 1) : 0.3;
        this.phase = phase;
        if (this.uniforms) this.uniforms.uPhase.value = Math.max(0, ['inhale', 'hold1', 'exhale', 'hold2'].indexOf(phase));
        this.phaseProgress = THREE.MathUtils.clamp(progress, 0, 1);
    }

    setSessionPhase(type) {
        this.sessionPhase = type;
        if (this.uniforms) this.uniforms.uSession.value = SESSION_PHASES[type] || 0;
    }

    setQuality(name) {
        if (!QUALITY_PRESETS[name]) return;
        this.qualityName = name;
        this.quality = QUALITY_PRESETS[name];
        this.sceneObjects.particles?.geometry.setDrawRange(0, this.quality.particleCount);
        this.resize();
    }

    start() {
        if (this.isRunning) return;
        this.init();
        this.isRunning = true;
        this.lastFrameTime = null;
        if (!document.hidden) this.animationId = requestAnimationFrame(this._animateBound);
    }

    _cancelFrame() {
        if (this.animationId !== null) cancelAnimationFrame(this.animationId);
        this.animationId = null;
    }

    stop() {
        this.isRunning = false;
        this.lastFrameTime = null;
        this._cancelFrame();
    }

    animate(now) {
        this.animationId = null;
        if (!this.isRunning || document.hidden || this.contextLost) return;
        this.animationId = requestAnimationFrame(this._animateBound);
        const interval = this.reducedMotion ? 1000 / 30 : this.quality.frameInterval;
        if (this.lastFrameTime !== null && now - this.lastFrameTime < interval - 0.5) return;
        const delta = this.lastFrameTime === null ? 1 / 60 : Math.min((now - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = now;
        this.time += delta;
        this.updateScene(this.time, delta);
        this.renderer.render(this.scene, this.camera);
    }

    updateScene(time, delta = 1 / 60) {
        if (!this.uniforms) return;
        this.reveal = Math.min(1, this.reveal + delta * 0.8);
        this.uniforms.uTime.value = time;
        this.uniforms.uBreath.value = this.intensity;
        this.uniforms.uMotion.value = this.reducedMotion ? 0 : 1;
        this.uniforms.uReveal.value = this.reveal;
        this.uniforms.uPhaseProgress.value = this.phaseProgress;
        const blend = 1 - Math.exp(-delta * 4);
        ['uColorA', 'uColorB', 'uColorC'].forEach((key, i) => this.uniforms[key].value.lerp(this.targetColors[i], blend));
    }

    resize(
        width = this.container.clientWidth || this.container.offsetWidth,
        height = this.container.clientHeight || this.container.offsetHeight,
    ) {
        if (!this.renderer || !width || !height) return;
        const ratio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.uniforms.uResolution.value.set(width, height);
        this.uniforms.uPixelRatio.value = ratio;
    }

    clearScene() {
        if (!this.scene) return;
        const geometries = new Set();
        const materials = new Set();
        this.scene.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        this.scene.clear();
        this.sceneObjects = {};
    }

    dispose() {
        this.stop();
        this.resizeObserver?.disconnect();
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        this._motionQuery?.removeEventListener?.('change', this._motionHandler);
        this.clearScene();
        this.renderer?.domElement.removeEventListener('webglcontextlost', this._contextLostHandler);
        this.renderer?.domElement.removeEventListener('webglcontextrestored', this._contextRestoredHandler);
        this.renderer?.dispose();
        this.renderer?.forceContextLoss();
        this.renderer?.domElement.remove();
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.uniforms = null;
    }
}
