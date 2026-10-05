/**
 * Breathing's intentionally shared WebGL renderer (ADR-0008).
 * Twelve environments use a retained scene, analytic light and GPU particle motion.
 * The same artwork runs on desktop and mobile; tiers only reduce render cost.
 */
import * as THREE from 'three';
import {
    BREATHING_VISUAL_PROFILES, FULLSCREEN_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER,
} from './breathing-atmosphere.js';

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

const APERTURE_FRAGMENT = `
    uniform float uTime, uBreath, uMotion, uReveal, uPhaseProgress, uSession;
    uniform vec2 uResolution;
    uniform vec3 uColorA, uColorB, uColorC;
    varying vec2 vUv;
    void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        p.x *= uResolution.x / uResolution.y;
        float r = length(p);
        float a = atan(p.y, p.x);
        float t = uTime * uMotion;
        float radius = mix(0.23, 0.43, uBreath);
        float ripple = sin(a * 7.0 + t * 0.24) * sin(a * 3.0 - t * 0.17);
        float rim = abs(r - radius - ripple * 0.008);
        float fine = exp(-rim * 290.0);
        float halo = exp(-rim * 29.0) * 0.25;
        float inner = exp(-abs(r - radius * 0.87) * 160.0) * 0.18;
        float outer = exp(-abs(r - radius * 1.16) * 140.0) * 0.13;
        float thread = sin(a * 18.0 - t * 0.35) * 0.5 + 0.5;
        vec3 c = mix(uColorA, uColorB, sin(a * 2.0 + t * 0.1) * 0.5 + 0.5);
        c = mix(c, uColorC, pow(thread, 8.0) * 0.35);
        float light = fine * 0.8 + halo + inner + outer;
        float phaseAngle = mod(a + 1.5707963 + 6.2831853, 6.2831853) / 6.2831853;
        float track = exp(-abs(r - 0.49) * 220.0);
        light += track * (phaseAngle < uPhaseProgress ? 0.32 : 0.035);
        float heart = exp(-r * r * 26.0) * 0.015;
        gl_FragColor = vec4(c * (1.0 + fine * 0.6), clamp(light + heart, 0.0, 0.95) * uReveal);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;
const PARTICLE_VERTEX = `
    attribute float aSeed, aSize;
    uniform float uTime, uBreath, uMotion, uPixelRatio, uSession;
    varying float vAlpha, vSeed;
    void main() {
        float t = uTime * uMotion;
        vec3 p = position;
        float angle = t * (0.009 + aSeed * 0.012);
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        p.xz = rotation * p.xz;
        p.x += sin(t * 0.1 + aSeed * 40.0) * 0.08;
        p.y += sin(t * 0.08 + aSeed * 25.0) * 0.14;
        p.xy *= 0.9 + uBreath * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPixelRatio * (5.0 / -mv.z), 1.0, 10.0);
        vAlpha = (0.28 + 0.22 * sin(t * 0.45 + aSeed * 90.0)) * (0.65 + uBreath * 0.35);
        vSeed = aSeed;
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
            premultipliedAlpha: fragmentShader === ATMOSPHERE_FRAGMENT_SHADER,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        this.scene.add(mesh);
        return mesh;
    }

    _buildRetainedScene() {
        this.sceneObjects.atmosphere = this._makePlane(ATMOSPHERE_FRAGMENT_SHADER, 0);
        this.sceneObjects.aperture = this._makePlane(APERTURE_FRAGMENT, 2);
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
        this.sceneObjects.motifs = new THREE.Group();
        this.sceneObjects.motifs.renderOrder = 1;
        this.scene.add(this.sceneObjects.motifs);
        this._buildMotifs();
    }

    _buildMotifs() {
        const group = this.sceneObjects.motifs;
        this.motifs = {};
        const lineMaterial = () => new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const orbits = new THREE.Group();
        for (let j = 0; j < 3; j++) {
            const points = [];
            for (let i = 0; i <= 160; i++) {
                const a = (i / 160) * Math.PI * 2;
                points.push(new THREE.Vector3(Math.cos(a) * 1.38, Math.sin(a) * 1.38, 0));
            }
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial());
            line.rotation.set(0.72 + j * 0.6, j * 0.85, j * 0.3);
            orbits.add(line);
        }
        this.motifs.orbits = orbits;
        const crystal = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.28)), lineMaterial());
        crystal.rotation.z = Math.PI / 6;
        this.motifs.crystal = crystal;
        const geometry = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.3)), lineMaterial());
        this.motifs.geometry = geometry;
        const heartPoints = [];
        for (let i = 0; i <= 160; i++) {
            const a = (i / 160) * Math.PI * 2;
            heartPoints.push(new THREE.Vector3(
                Math.sin(a) ** 3 * 1.15,
                (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * 0.07,
                0,
            ));
        }
        this.motifs.heart = new THREE.Line(new THREE.BufferGeometry().setFromPoints(heartPoints), lineMaterial());
        const solarPoints = [];
        for (let i = 0; i <= 320; i++) {
            const a = (i / 320) * Math.PI * 2;
            const r = 1.32 + Math.sin(a * 12) * 0.09;
            solarPoints.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
        }
        this.motifs.solar = new THREE.Line(new THREE.BufferGeometry().setFromPoints(solarPoints), lineMaterial());
        Object.values(this.motifs).forEach((motif) => group.add(motif));
    }

    setTechnique(name, params = {}) {
        this.currentTechnique = BREATHING_VISUAL_PROFILES[name] ? name : 'deep-relaxation';
        this.techniqueParams = params || {};
        if (!this.uniforms) return;
        const profile = BREATHING_VISUAL_PROFILES[this.currentTechnique];
        this.uniforms.uMode.value = profile.mode;
        const defaults = [{ r: 80, g: 200, b: 255 }, { r: 180, g: 100, b: 255 }, { r: 100, g: 255, b: 180 }];
        ['color', 'secondaryColor', 'tertiaryColor'].forEach((key, index) => {
            const c = this.techniqueParams[key] || defaults[index];
            this.targetColors[index].setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
        });
        if (!this.isRunning) ['uColorA', 'uColorB', 'uColorC'].forEach((key, i) => this.uniforms[key].value.copy(this.targetColors[i]));
        Object.entries(this.motifs).forEach(([key, motif]) => { motif.visible = key === (profile.motif || 'orbits'); });
        this.reveal = Math.min(this.reveal, 0.35);
    }

    // Compatibility entry point; scene resources are retained rather than rebuilt.
    rebuildScene() { this.setTechnique(this.currentTechnique, this.techniqueParams); }

    updateIntensity(intensity, phase, progress = 0) {
        this.intensity = Number.isFinite(intensity) ? THREE.MathUtils.clamp(intensity, 0, 1) : 0.3;
        this.phase = phase;
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
        const motifScale = 0.8 + this.intensity * 0.24;
        this.sceneObjects.motifs.scale.setScalar(motifScale);
        const motion = this.reducedMotion ? 0 : time;
        Object.entries(this.motifs).forEach(([key, motif]) => {
            if (!motif.visible) return;
            if (key !== 'heart') motif.rotation.y = motion * 0.025;
            motif.rotation.z = key === 'heart' ? 0 : motion * 0.012;
            motif.traverse((object) => {
                if (object.material) {
                    object.material.color.copy(this.uniforms.uColorC.value);
                    object.material.opacity = (0.12 + this.intensity * 0.12) * this.reveal;
                }
            });
        });
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
        this.motifs = null;
    }
}
