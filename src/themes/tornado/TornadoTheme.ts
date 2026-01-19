import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { normalizeQuality } from '../../utils/quality.js';
import { TORNADO_TETROMINOS } from './tornado-tetrominos.js';
import { TORNADO_PARAM_DEFAULTS } from './params.ts';
import { TornadoGround } from './TornadoGround.ts';
import { TornadoPost } from './TornadoPost.ts';
import { TornadoRibbons } from './TornadoRibbons.ts';
import { TornadoWindStreaks } from './TornadoWindStreaks.ts';
import { eventBus, EVENTS } from '../../events/event-bus.js';

const BACKGROUND_COLOR = new THREE.Color(0x0b0604);

// Combo color progression - transitions through these colors based on combo level
const COMBO_COLORS = [
    '#ff8a3b', // Level 0-2: Default orange/red
    '#ff5733', // Level 3-4: Deeper red
    '#c71585', // Level 5-6: Purple/magenta
    '#4169e1', // Level 7-8: Blue
    '#00ffff', // Level 9-10: Cyan
    '#ffffff', // Level 11+: White/gold transcendence
];

const QUALITY_PRESETS = {
    Minimal: {
        ribbonCount: 50, ribbonSegments: 60, groundSegments: 80, windStreakCount: 0, enableBloom: false,
    },
    Low: {
        ribbonCount: 70, ribbonSegments: 70, groundSegments: 100, windStreakCount: 8, enableBloom: false,
    },
    Medium: {
        ribbonCount: 100, ribbonSegments: 80, groundSegments: 120, windStreakCount: 12, enableBloom: true,
    },
    High: {
        ribbonCount: 130, ribbonSegments: 100, groundSegments: 140, windStreakCount: 16, enableBloom: true,
    },
    Ultra: {
        ribbonCount: 160, ribbonSegments: 120, groundSegments: 160, windStreakCount: 20, enableBloom: true,
    },
    Extreme: {
        ribbonCount: 200, ribbonSegments: 150, groundSegments: 180, windStreakCount: 24, enableBloom: true,
    },
};
type QualityName = keyof typeof QUALITY_PRESETS;

export default class TornadoTheme extends BaseTheme {
    private scene: THREE.Scene | null;
    private camera: THREE.PerspectiveCamera | null;
    private renderer: THREE.WebGPURenderer | null;
    private ribbons: TornadoRibbons | null;
    private ground: TornadoGround | null;
    private windStreaks: TornadoWindStreaks | null;
    private post: TornadoPost | null;
    private resizeHandler: (() => void) | null;
    private renderLoop: (() => void) | null;
    private settingsHandler: ((event: CustomEvent) => void) | null;
    private qualityPreset: typeof QUALITY_PRESETS.High;
    private qualityName: QualityName;
    private params: typeof TORNADO_PARAM_DEFAULTS;

    // Combo effect system
    private comboUnsubscribe: (() => void) | null;
    private comboLevel: number;
    private baseParams: typeof TORNADO_PARAM_DEFAULTS;
    private targetParams: typeof TORNADO_PARAM_DEFAULTS;
    private transitionSpeed: number;

    // Camera shake
    private cameraBasePosition: THREE.Vector3;
    private cameraShakeIntensity: number;
    private cameraShakeDecay: number;

    // Reusable color objects for combo effects
    private currentColorObject: THREE.Color;
    private targetColorObject: THREE.Color;

    constructor() {
        super('tornado');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.ribbons = null;
        this.ground = null;
        this.windStreaks = null;
        this.post = null;
        this.resizeHandler = null;
        this.renderLoop = null;
        this.settingsHandler = null;
        this.qualityPreset = QUALITY_PRESETS.High;
        this.qualityName = 'High';
        this.params = { ...TORNADO_PARAM_DEFAULTS };

        // Combo effect system
        this.comboUnsubscribe = null;
        this.comboLevel = 0;
        this.baseParams = { ...TORNADO_PARAM_DEFAULTS };
        this.targetParams = { ...TORNADO_PARAM_DEFAULTS };
        this.transitionSpeed = 0.05; // Smooth transition speed

        // Camera shake
        this.cameraBasePosition = new THREE.Vector3(0, 6, 18);
        this.cameraShakeIntensity = 0;
        this.cameraShakeDecay = 0.92; // How fast shake decays

        // Reusable color objects (avoid allocations in render loop)
        this.currentColorObject = new THREE.Color();
        this.targetColorObject = new THREE.Color();
    }

    async createScene() {
        const themeContainer = document.getElementById('tornado-theme');
        if (!themeContainer) {
            console.error('[TornadoTheme] Theme container not found');
            return;
        }

        this.disposeScene();
        this.params = this.getStoredParams();
        this.baseParams = { ...this.params }; // Store base params for combo effects
        this.targetParams = { ...this.params };

        themeContainer.innerHTML = '';
        themeContainer.style.background = '#0b0604';

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x080402, 6, 40);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
        this.camera.position.set(0, 6, 18);
        this.camera.lookAt(0, 3, 0);

        this.renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });

        try {
            await this.renderer.init();
        } catch (error) {
            console.error('[TornadoTheme] Renderer initialization failed:', error);
            return;
        }

        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(BACKGROUND_COLOR, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '1';
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        this.applyQualityPreset();
        this.createTornadoObjects();

        // Conditional post-processing based on quality
        if (this.qualityPreset.enableBloom) {
            this.post = new TornadoPost(this.renderer, this.scene, this.camera, {
                bloomStrength: this.params.bloomStrength,
                bloomRadius: this.params.bloomRadius,
            });
            this.post.setSize(width, height);
        } else {
            this.post = null;
        }

        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);

        this.renderLoop = () => {
            if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;
            if (!this.shouldRenderFrame()) return;

            // Update combo effects
            this.updateComboEffects();

            // Update camera shake
            this.updateCameraShake();

            // Update wind streaks animation
            this.windStreaks?.update();

            if (this.post) {
                this.post.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        };

        this.renderer.setAnimationLoop(this.renderLoop);

        this.setupSettingsListener();
        this.setupComboListener();

        console.log('[TornadoTheme] WebGPU tornado ribbons ready');
    }

    private applyQualityPreset(qualityOverride?: string) {
        const quality = normalizeQuality(qualityOverride
            ?? (typeof window !== 'undefined' ? window.settings?.effectQuality : null));
        this.qualityName = quality as QualityName;
        this.qualityPreset = QUALITY_PRESETS[this.qualityName] || QUALITY_PRESETS.High;
    }

    private createTornadoObjects() {
        if (!this.scene) return;

        this.ribbons = new TornadoRibbons({
            count: this.qualityPreset.ribbonCount,
            segments: this.qualityPreset.ribbonSegments,
            height: 12,
            width: 0.85,
            radiusBottom: 0.6,
            radiusTop: 4.2,
            turns: 5.5,
            spinSpeed: 1.6,
            noiseAmplitude: 0.6,
            twistAmount: 0.25,
            twistFrequency: 4.0,
            params: this.params,
        });
        this.ribbons.group.position.y = 0.5;
        this.ribbons.addToScene(this.scene);

        this.ground = new TornadoGround({
            innerRadius: 3.2,
            outerRadius: 16.0,
            segments: this.qualityPreset.groundSegments,
            params: {
                emissiveColor: this.params.emissiveColor,
                timeScale: this.params.timeScale,
            },
        });
        this.ground.addToScene(this.scene);

        // Create wind streaks if quality allows
        if (this.qualityPreset.windStreakCount > 0) {
            this.windStreaks = new TornadoWindStreaks({
                count: this.qualityPreset.windStreakCount,
                length: 8.0, // Length of each streak
                thickness: 0.8, // Thickness of streak particles
                baseRadius: 5.0, // Distance from tornado center
                radiusVariation: 3.0, // Vary the distance
                heightMin: -1.0, // Bottom of height range
                heightMax: 9.0, // Top of height range
                params: {
                    emissiveColor: this.params.emissiveColor,
                    timeScale: this.params.timeScale,
                },
            });
            this.windStreaks.addToScene(this.scene);
        }
    }

    private getStoredParams() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return {
            ...TORNADO_PARAM_DEFAULTS,
            ...(settings?.tornadoThemeParams || {}),
        };
    }

    /**
     * Setup combo event listener
     */
    private setupComboListener() {
        this.teardownComboListener();

        this.comboUnsubscribe = eventBus.on(EVENTS.COMBO, (data: any) => {
            if (!this.isActive) return;
            this.handleCombo(data.comboCount);
        });
    }

    /**
     * Teardown combo event listener
     */
    private teardownComboListener() {
        if (this.comboUnsubscribe) {
            this.comboUnsubscribe();
            this.comboUnsubscribe = null;
        }
    }

    /**
     * Handle combo event - trigger visual effects
     */
    private handleCombo(comboCount: number) {
        if (!this.scene || comboCount < 2) return;

        console.log(`[TornadoTheme] Combo ${comboCount} triggered!`);

        // Update combo level (take the max so rapid combos escalate properly)
        this.comboLevel = Math.max(this.comboLevel, comboCount);

        // 1. Growth + Speed + Color Progression
        this.updateComboTargetParams(this.comboLevel);

        // 2. Camera Shake
        this.triggerCameraShake(comboCount);
    }

    /**
     * Update target parameters based on combo level
     */
    private updateComboTargetParams(comboLevel: number) {
        // Get color for this combo level
        const colorIndex = Math.min(Math.floor(comboLevel / 2), COMBO_COLORS.length - 1);
        const comboColor = COMBO_COLORS[colorIndex];

        // Scale factors based on combo level
        const growthScale = 1 + (comboLevel * 0.1); // +10% per combo level
        const heightScale = 1 + (comboLevel * 0.12); // +12% height per combo level
        const widthScale = 1 + (comboLevel * 0.10); // +10% width per combo level
        const speedScale = 1 + (comboLevel * 0.15); // +15% speed per combo
        const bloomScale = 1 + (comboLevel * 0.2); // +20% bloom per combo
        const parabolaScale = 1 + (comboLevel * 0.08); // +8% parabola per combo

        // Set target params (will smoothly interpolate to these)
        this.targetParams = {
            ...this.baseParams,
            emissiveColor: comboColor,
            timeScale: this.baseParams.timeScale * speedScale,
            parabolaStrength: this.baseParams.parabolaStrength * parabolaScale,
            parabolaAmplitude: this.baseParams.parabolaAmplitude * growthScale,
            bloomStrength: this.baseParams.bloomStrength * bloomScale,
            bloomRadius: Math.min(this.baseParams.bloomRadius * bloomScale, 1.0),
        };

        // Apply 3D scaling to tornado groups (grows bigger overall)
        if (this.ribbons) {
            this.ribbons.group.scale.set(widthScale, heightScale, widthScale);
        }
        if (this.ground) {
            // Ground also grows wider to match
            this.ground.mesh?.scale.set(widthScale, 1.0, widthScale);
        }
        if (this.windStreaks) {
            // Wind streaks also scale with combo
            this.windStreaks.group.scale.set(widthScale, heightScale, widthScale);
        }
    }

    /**
     * Trigger camera shake based on combo level
     */
    private triggerCameraShake(comboLevel: number) {
        // Shake intensity scales with combo level
        const shakeIntensity = Math.min(0.05 + comboLevel * 0.02, 0.3);
        this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, shakeIntensity);
    }

    /**
     * Update combo effects each frame (smooth transitions)
     */
    private updateComboEffects() {
        // Smoothly interpolate current params toward target params
        const keys = Object.keys(this.params) as (keyof typeof TORNADO_PARAM_DEFAULTS)[];

        keys.forEach((key) => {
            const current = this.params[key];
            const target = this.targetParams[key];

            if (key === 'emissiveColor') {
                // Smoothly interpolate colors (using cached objects)
                this.currentColorObject.set(current as string);
                this.targetColorObject.set(target as string);
                this.currentColorObject.lerp(this.targetColorObject, this.transitionSpeed);
                this.params[key] = `#${this.currentColorObject.getHexString()}` as any;
            } else if (typeof current === 'number' && typeof target === 'number') {
                // Smoothly interpolate numbers
                this.params[key] = (current + (target - current) * this.transitionSpeed) as any;
            }
        });

        // Update all tornado objects with current params
        this.ribbons?.updateParams(this.params);
        this.ground?.updateParams(this.params);
        this.windStreaks?.updateParams(this.params);
        this.post?.updateParams(this.params);

        // Decay combo level over time (return to baseline)
        // Use exponential decay for smooth, natural falloff
        if (this.comboLevel > 0) {
            // Exponential decay: reduces by 8% per frame (~2-3 seconds to baseline)
            this.comboLevel *= 0.92;

            // When combo level is very low, snap to zero and reset
            if (this.comboLevel < 0.1) {
                this.comboLevel = 0;
                // Reset target params to base when combo ends
                this.targetParams = { ...this.baseParams };
                // Reset all scales to 1.0
                if (this.ribbons) {
                    this.ribbons.group.scale.set(1.0, 1.0, 1.0);
                }
                if (this.ground?.mesh) {
                    this.ground.mesh.scale.set(1.0, 1.0, 1.0);
                }
                if (this.windStreaks) {
                    this.windStreaks.group.scale.set(1.0, 1.0, 1.0);
                }
            } else {
                // Continue updating target params as combo decays
                this.updateComboTargetParams(this.comboLevel);
            }
        }
    }

    /**
     * Update camera shake effect
     */
    private updateCameraShake() {
        if (!this.camera) return;

        if (this.cameraShakeIntensity > 0.001) {
            // Apply shake offset
            const shakeX = (Math.random() - 0.5) * this.cameraShakeIntensity;
            const shakeY = (Math.random() - 0.5) * this.cameraShakeIntensity;
            const shakeZ = (Math.random() - 0.5) * this.cameraShakeIntensity * 0.5;

            this.camera.position.set(
                this.cameraBasePosition.x + shakeX,
                this.cameraBasePosition.y + shakeY,
                this.cameraBasePosition.z + shakeZ,
            );

            // Decay shake intensity
            this.cameraShakeIntensity *= this.cameraShakeDecay;
        } else {
            // Reset to base position when shake is negligible
            this.camera.position.copy(this.cameraBasePosition);
            this.cameraShakeIntensity = 0;
        }
    }

    private setupSettingsListener() {
        this.teardownSettingsListener();

        this.settingsHandler = (event: CustomEvent) => {
            const detail = event.detail || {};

            if (detail.tornadoThemeParams) {
                this.params = { ...this.params, ...detail.tornadoThemeParams };
                // Update baseParams so combo effects respect new settings
                this.baseParams = { ...this.baseParams, ...detail.tornadoThemeParams };
                this.targetParams = { ...this.targetParams, ...detail.tornadoThemeParams };
                this.ribbons?.updateParams(this.params);
                this.ground?.updateParams(this.params);
                this.windStreaks?.updateParams(this.params);
                this.post?.updateParams(this.params);
            }

            if (detail.effectQuality) {
                const normalized = normalizeQuality(detail.effectQuality);
                if (normalized !== this.qualityName) {
                    this.applyQualityPreset(normalized);
                    this.rebuildTornado();
                }
            }

            if (detail.renderScale !== undefined) {
                this.handleResize();
            }
        };

        window.addEventListener('settingsChanged', this.settingsHandler as EventListener);
    }

    private teardownSettingsListener() {
        if (!this.settingsHandler) return;
        window.removeEventListener('settingsChanged', this.settingsHandler as EventListener);
        this.settingsHandler = null;
    }

    private handleResize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);

        if (this.post) {
            this.post.setSize(width, height);
        }
    }

    private rebuildTornado() {
        if (!this.scene) return;
        this.disposeRibbons();
        this.disposeGround();
        this.disposeWindStreaks();
        this.createTornadoObjects();
    }

    private disposeRibbons() {
        if (!this.ribbons) return;
        if (this.scene) {
            this.scene.remove(this.ribbons.group);
        }
        this.ribbons.dispose();
        this.ribbons = null;
    }

    private disposeGround() {
        if (!this.ground) return;
        if (this.scene && this.ground.mesh) {
            this.scene.remove(this.ground.mesh);
        }
        this.ground.dispose();
        this.ground = null;
    }

    private disposeWindStreaks() {
        if (!this.windStreaks) return;
        if (this.scene) {
            this.scene.remove(this.windStreaks.group);
        }
        this.windStreaks.dispose();
        this.windStreaks = null;
    }

    private disposeScene() {
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
        }

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.teardownSettingsListener();
        this.teardownComboListener();

        this.disposeRibbons();
        this.disposeGround();
        this.disposeWindStreaks();

        if (this.post) {
            this.post.dispose();
            this.post = null;
        }

        if (this.scene) {
            this.scene.traverse((object) => {
                if ((object as THREE.Mesh).geometry) {
                    (object as THREE.Mesh).geometry.dispose();
                }
                const material = (object as THREE.Mesh).material;
                if (material) {
                    if (Array.isArray(material)) {
                        material.forEach((mat) => mat.dispose());
                    } else {
                        material.dispose();
                    }
                }
            });
        }

        if (this.renderer) {
            const canvas = this.renderer.domElement;
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
            this.renderer.dispose();
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }

    resume() {
        super.resume();

        if (!this.renderer || !this.scene || !this.camera || !this.renderLoop) {
            return false;
        }

        if (!this.resizeHandler) {
            this.resizeHandler = () => this.handleResize();
            window.addEventListener('resize', this.resizeHandler);
        }

        this.setupSettingsListener();
        this.setupComboListener();
        this.handleResize();
        this.renderer.setAnimationLoop(this.renderLoop);
        return true;
    }

    stop() {
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
        }
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        this.teardownSettingsListener();
        this.teardownComboListener();
        super.stop();
    }

    cleanup() {
        this.disposeScene();
        super.cleanup();
    }

    getTetrominoConfig() {
        return TORNADO_TETROMINOS;
    }
}
