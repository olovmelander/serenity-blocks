import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { normalizeQuality } from '../../utils/quality.js';
import { TORNADO_TETROMINOS } from './tornado-tetrominos.js';
import { TORNADO_PARAM_DEFAULTS } from './params.ts';
import { TornadoGround } from './TornadoGround.ts';
import { TornadoPost } from './TornadoPost.ts';
import { TornadoRibbons } from './TornadoRibbons.ts';

const BACKGROUND_COLOR = new THREE.Color(0x0b0604);
const QUALITY_PRESETS = {
    Minimal: { ribbonCount: 50, ribbonSegments: 180, groundSegments: 120 },
    Low: { ribbonCount: 70, ribbonSegments: 200, groundSegments: 140 },
    Medium: { ribbonCount: 100, ribbonSegments: 220, groundSegments: 160 },
    High: { ribbonCount: 130, ribbonSegments: 250, groundSegments: 180 },
    Ultra: { ribbonCount: 160, ribbonSegments: 280, groundSegments: 200 },
    Extreme: { ribbonCount: 200, ribbonSegments: 320, groundSegments: 240 },
};
type QualityName = keyof typeof QUALITY_PRESETS;

export default class TornadoTheme extends BaseTheme {
    private scene: THREE.Scene | null;
    private camera: THREE.PerspectiveCamera | null;
    private renderer: THREE.WebGPURenderer | null;
    private ribbons: TornadoRibbons | null;
    private ground: TornadoGround | null;
    private post: TornadoPost | null;
    private resizeHandler: (() => void) | null;
    private renderLoop: (() => void) | null;
    private settingsHandler: ((event: CustomEvent) => void) | null;
    private qualityPreset: typeof QUALITY_PRESETS.High;
    private qualityName: QualityName;
    private params: typeof TORNADO_PARAM_DEFAULTS;

    constructor() {
        super('tornado');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.ribbons = null;
        this.ground = null;
        this.post = null;
        this.resizeHandler = null;
        this.renderLoop = null;
        this.settingsHandler = null;
        this.qualityPreset = QUALITY_PRESETS.High;
        this.qualityName = 'High';
        this.params = { ...TORNADO_PARAM_DEFAULTS };
    }

    async createScene() {
        const themeContainer = document.getElementById('tornado-theme');
        if (!themeContainer) {
            console.error('[TornadoTheme] Theme container not found');
            return;
        }

        this.disposeScene();
        this.params = this.getStoredParams();

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

        this.post = new TornadoPost(this.renderer, this.scene, this.camera, {
            bloomStrength: this.params.bloomStrength,
            bloomRadius: this.params.bloomRadius,
        });
        this.post.setSize(width, height);

        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);

        this.renderLoop = () => {
            if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;
            if (!this.shouldRenderFrame()) return;
            if (this.post) {
                this.post.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        };

        this.renderer.setAnimationLoop(this.renderLoop);

        this.setupSettingsListener();

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
            width: 0.6,
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
            outerRadius: 6.4,
            segments: this.qualityPreset.groundSegments,
            params: {
                emissiveColor: this.params.emissiveColor,
                timeScale: this.params.timeScale,
            },
        });
        this.ground.addToScene(this.scene);
    }

    private getStoredParams() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return {
            ...TORNADO_PARAM_DEFAULTS,
            ...(settings?.tornadoThemeParams || {}),
        };
    }

    private setupSettingsListener() {
        this.teardownSettingsListener();

        this.settingsHandler = (event: CustomEvent) => {
            const detail = event.detail || {};

            if (detail.tornadoThemeParams) {
                this.params = { ...this.params, ...detail.tornadoThemeParams };
                this.ribbons?.updateParams(this.params);
                this.ground?.updateParams(this.params);
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

    private disposeScene() {
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
        }

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.teardownSettingsListener();

        this.disposeRibbons();
        this.disposeGround();

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
