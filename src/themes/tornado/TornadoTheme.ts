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
        ribbonCount: 40, ribbonSegments: 40, groundSegments: 60, windStreakCount: 0, enableBloom: false,
    },
    Low: {
        ribbonCount: 60, ribbonSegments: 50, groundSegments: 80, windStreakCount: 8, enableBloom: false,
    },
    Medium: {
        ribbonCount: 100, ribbonSegments: 60, groundSegments: 100, windStreakCount: 12, enableBloom: true,
    },
    High: {
        ribbonCount: 130, ribbonSegments: 80, groundSegments: 120, windStreakCount: 16, enableBloom: true,
    },
    Ultra: {
        ribbonCount: 160, ribbonSegments: 100, groundSegments: 140, windStreakCount: 20, enableBloom: true,
    },
    Extreme: {
        ribbonCount: 200, ribbonSegments: 120, groundSegments: 160, windStreakCount: 24, enableBloom: true,
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

    // Scale interpolation state
    private currentScale: THREE.Vector3;
    private targetScale: THREE.Vector3;

    // Animation state
    private clock: THREE.Clock;
    private time: number;

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

        // Scale interpolation
        this.currentScale = new THREE.Vector3(1, 1, 1);
        this.targetScale = new THREE.Vector3(1, 1, 1);
        this.clock = new THREE.Clock();
        this.time = 0;

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

        const canvas = this.renderer.domElement as unknown as HTMLElement;
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

            // Update camera movement (orbit + breathing + shake)
            this.updateCameraMovement();

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

    /**
     * Update camera position with fluid orbital movement and breathing
     */
    private updateCameraMovement() {
        if (!this.camera) return;

        // Clamp to avoid a multi-second post-stall/refocus delta lurching the
        // ambient camera sway + breathing (this.time is the animation clock).
        const dt = Math.min(this.clock.getDelta(), 1 / 20);
        this.time += dt;

        // Base Orbital Movement
        // Oscillating sway (pendulum) instead of full rotation, so it sweeps left/right
        // to reveal the tornado from behind the game board.
        const swaySpeed = 0.15;
        const orbitAngle = Math.sin(this.time * swaySpeed) * 0.8      // Main sweep (+/- 45 deg)
            + Math.cos(this.time * swaySpeed * 0.6) * 0.3; // Secondary drift

        // Breathing effect (gentle in/out and up/down)
        // Pyrestorm uses: radius +/- 80, height +/- 60 (on 1100/380 base)
        // Tornado base: radius ~18, height 6. Scale down breathing proportionally.
        const breathSpeed = 0.5;
        const radiusBreath = Math.sin(this.time * breathSpeed) * 1.5 + Math.cos(this.time * breathSpeed * 0.7) * 0.5;
        const heightBreath = Math.sin(this.time * breathSpeed * 0.6) * 0.8 + Math.cos(this.time * breathSpeed * 0.4) * 0.4;

        // Calculate target base position (without shake)
        const baseRadius = 18;
        const baseHeight = 6;

        const currentRadius = baseRadius + radiusBreath;
        const currentHeight = baseHeight + heightBreath;

        // Calculate orbital position
        // Initial pos was (0, 6, 18) -> looking at (0, 3, 0)
        // We orbit around Y axis.
        const orbX = Math.sin(orbitAngle) * currentRadius;
        const orbZ = Math.cos(orbitAngle) * currentRadius;

        // Apply position with Shake
        // Shake is applied as an offset to this calculated fluid position
        let shakeX = 0, shakeY = 0, shakeZ = 0;

        if (this.cameraShakeIntensity > 0.001) {
            shakeX = (Math.random() - 0.5) * this.cameraShakeIntensity;
            shakeY = (Math.random() - 0.5) * this.cameraShakeIntensity;
            shakeZ = (Math.random() - 0.5) * this.cameraShakeIntensity * 0.5;

            // Decay shake
            this.cameraShakeIntensity *= this.cameraShakeDecay;
        } else {
            this.cameraShakeIntensity = 0;
        }

        this.camera.position.set(
            orbX + shakeX,
            currentHeight + shakeY,
            orbZ + shakeZ
        );

        // Fluid Focus Drift (Pyrestorm style)
        // Slowly drift the look-at point so the tornado isn't dead center
        const focusDriftX = Math.sin(this.time * 0.2) * 1.5;
        const focusDriftY = Math.cos(this.time * 0.15) * 0.5;

        this.camera.lookAt(focusDriftX, 3 + focusDriftY, 0);
    }

    /**
     * Update camera shake effect - DEPRECATED (merged into updateCameraMovement)
     * Keeping empty method if called elsewhere, or remove if unused.
     * Logic moved to updateCameraMovement to compose correctly.
     */
    private applyQualityPreset(qualityOverride?: string) {
        const settings = (window as any).settings;
        const quality = normalizeQuality(qualityOverride
            ?? (typeof window !== 'undefined' ? settings?.effectQuality : null));
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

        // Update target scale instead of setting directly
        this.targetScale.set(widthScale, heightScale, widthScale);
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

        // Smoothly interpolate scale
        this.currentScale.lerp(this.targetScale, this.transitionSpeed);

        // Apply interpolated scale to objects
        if (this.ribbons) {
            this.ribbons.group.scale.copy(this.currentScale);
        }
        if (this.ground?.mesh) {
            // Ground mainly grows in width/depth, keep height (y) at 1.0 or scale subtly
            this.ground.mesh.scale.set(this.currentScale.x, 1.0, this.currentScale.z);
        }
        if (this.windStreaks) {
            this.windStreaks.group.scale.copy(this.currentScale);
        }

        // Update all tornado objects with current params
        this.ribbons?.updateParams(this.params);
        this.ground?.updateParams(this.params);
        this.windStreaks?.updateParams(this.params);
        this.post?.updateParams(this.params);

        // Decay combo level over time (return to baseline)
        if (this.comboLevel > 0) {
            // Mixed decay: Exponential (smooth falloff) + Linear (avoids infinite tail)
            // 0.99 decay maintains size longer, -0.005 ensures it eventually hits 0 cleanly
            this.comboLevel = Math.max(0, this.comboLevel * 0.992 - 0.005);

            // Lower cutoff threshold since we have linear decay helping us finish
            if (this.comboLevel < 0.01) {
                this.comboLevel = 0;
                // Reset target params to base when combo ends
                this.targetParams = { ...this.baseParams };
                this.targetScale.set(1.0, 1.0, 1.0);
            } else {
                // Continue updating target params as combo decays
                this.updateComboTargetParams(this.comboLevel);
            }
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
            const canvas = this.renderer.domElement as unknown as HTMLElement;
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
            this.disposeRenderer(this.renderer, { nullInstance: false });
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
