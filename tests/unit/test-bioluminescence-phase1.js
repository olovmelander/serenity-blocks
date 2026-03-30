import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import BioluminescenceTheme from '../../src/themes/bioluminescence/bioluminescence-theme.js';
import * as THREE from 'three';

// Mock Global Browser APIs
global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { search: '', href: '', pathname: '/' },
};
global.document = {
    getElementById: vi.fn().mockReturnValue({
        appendChild: vi.fn(),
        style: {},
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn() },
    }),
    createElement: vi.fn().mockImplementation((tag) => {
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                style: {},
                remove: vi.fn(),
                getContext: vi.fn().mockReturnValue({
                    fillRect: vi.fn(),
                    drawImage: vi.fn(),
                    getImageData: vi.fn().mockReturnValue({
                        data: new Uint8ClampedArray(256 * 256 * 4),
                        width: 256,
                        height: 256,
                    }),
                    createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(256 * 256 * 4) }),
                    putImageData: vi.fn(),
                    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
                    createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
                    beginPath: vi.fn(),
                    arc: vi.fn(),
                    fill: vi.fn(),
                    stroke: vi.fn(),
                    moveTo: vi.fn(),
                    lineTo: vi.fn(),
                    closePath: vi.fn(),
                    save: vi.fn(),
                    restore: vi.fn(),
                    translate: vi.fn(),
                    rotate: vi.fn(),
                    scale: vi.fn(),
                }),
            };
        }
        // Default: return a container-like element (div, etc.)
        return {
            appendChild: vi.fn(),
            removeChild: vi.fn(),
            innerHTML: '',
            style: {},
            children: [],
            tagName: tag.toUpperCase(),
            classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn() },
        };
    }),
};
global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16));
global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));

// Mock THREE.WebGPURenderer and THREE.WebGLRenderer
vi.mock('three/examples/jsm/objects/Water.js', () => ({
    Water: vi.fn().mockImplementation(() => ({
        rotation: { x: 0, y: 0, z: 0 },
        position: { set: vi.fn(), x: 0, y: 0, z: 0 },
        material: {
            uniforms: {
                time: { value: 0 },
                sunDirection: { value: { set: vi.fn(), copy: vi.fn() } },
            }
        }
    })),
}));

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
    EffectComposer: vi.fn().mockImplementation(() => ({
        addPass: vi.fn(),
        render: vi.fn(),
        setSize: vi.fn(),
        dispose: vi.fn(),
    })),
}));

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
    RenderPass: vi.fn(),
}));

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
    UnrealBloomPass: vi.fn(),
}));

vi.mock('three/examples/jsm/postprocessing/ShaderPass.js', () => ({
    ShaderPass: vi.fn(),
}));

vi.mock('three/examples/jsm/shaders/GammaCorrectionShader.js', () => ({
    GammaCorrectionShader: {},
}));

vi.mock('three', async () => {
    return {
        WebGLRenderer: vi.fn().mockImplementation(() => ({
            domElement: document.createElement('canvas'),
            setSize: vi.fn(),
            setPixelRatio: vi.fn(),
            dispose: vi.fn(),
            render: vi.fn(),
            setClearColor: vi.fn(),
            info: { render: {}, memory: {} },
            capabilities: { isWebGL2: true },
        })),
        Scene: vi.fn().mockImplementation(() => ({
            add: vi.fn(),
            remove: vi.fn(),
            fog: null,
            background: null
        })),
        PerspectiveCamera: vi.fn().mockImplementation(() => ({
            position: { set: vi.fn() },
            lookAt: vi.fn()
        })),
        Clock: vi.fn().mockImplementation(() => ({
            getDelta: vi.fn().mockReturnValue(0.016)
        })),
        Color: vi.fn(),
        FogExp2: vi.fn(),
        ConeGeometry: vi.fn(),
        Vector2: vi.fn(),
        Group: vi.fn().mockImplementation(() => ({
            add: vi.fn(),
            position: { set: vi.fn(), x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { set: vi.fn() },
            traverse: vi.fn(),
        })),
        MeshBasicMaterial: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
        MeshStandardMaterial: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
        Mesh: vi.fn().mockImplementation((geo, mat) => ({
            position: { set: vi.fn(), copy: vi.fn() },
            rotation: { x: 0 },
            geometry: geo || { dispose: vi.fn() },
            material: mat || { dispose: vi.fn() },
        })),
        CatmullRomCurve3: vi.fn().mockImplementation(() => ({
            getPoint: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
        })),
        TubeGeometry: vi.fn().mockImplementation(() => ({
            attributes: {
                position: { count: 100 },
                uv: { count: 100 },
            },
            computeVertexNormals: vi.fn(),
            dispose: vi.fn(),
            setAttribute: vi.fn(),
            scale: vi.fn(),
            translate: vi.fn(),
        })),
        BufferAttribute: vi.fn(),
        HemisphereLight: vi.fn(),
        AmbientLight: vi.fn(),
        RectAreaLight: vi.fn(),
        PointLight: vi.fn().mockImplementation(() => ({
            position: { set: vi.fn(), copy: vi.fn() },
            shadow: {
                camera: { near: 0, far: 0, fov: 0, updateProjectionMatrix: vi.fn() },
                mapSize: { width: 0, height: 0 },
            },
        })),
        SpotLight: vi.fn().mockImplementation(() => ({
            position: { set: vi.fn(), copy: vi.fn() },
            target: { position: { set: vi.fn() } },
            shadow: {
                camera: { near: 0, far: 0, fov: 0, updateProjectionMatrix: vi.fn() },
                mapSize: { width: 0, height: 0 },
            },
        })),
        DirectionalLight: vi.fn().mockImplementation(() => ({
            position: { set: vi.fn(), copy: vi.fn() },
            shadow: {
                camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0, updateProjectionMatrix: vi.fn() },
                mapSize: { width: 0, height: 0 },
            },
        })),
        Points: vi.fn().mockImplementation((geo, mat) => ({
            position: { set: vi.fn() },
            rotation: { x: 0, y: 0, z: 0 },
            geometry: geo || { dispose: vi.fn() },
            material: mat || { dispose: vi.fn() },
        })),
        BufferGeometry: vi.fn().mockImplementation(() => ({
            attributes: {
                position: { count: 100 },
                size: { count: 100 },
                phase: { count: 100 },
                speed: { count: 100 },
            },
            setAttribute: vi.fn(),
            dispose: vi.fn(),
        })),
        SphereGeometry: vi.fn().mockImplementation(() => ({
            attributes: {
                position: { count: 100 },
                uv: { count: 100 },
            },
            scale: vi.fn(),
            translate: vi.fn(),
            rotateX: vi.fn(),
            rotateY: vi.fn(),
            rotateZ: vi.fn(),
            computeVertexNormals: vi.fn(),
            setAttribute: vi.fn(),
            dispose: vi.fn(),
        })),
        PlaneGeometry: vi.fn().mockImplementation(() => ({
            attributes: {
                position: {
                    array: new Float32Array(100),
                    count: 33,
                    getX: vi.fn().mockReturnValue(0),
                    getY: vi.fn().mockReturnValue(0),
                    getZ: vi.fn().mockReturnValue(0),
                    setX: vi.fn(),
                    setY: vi.fn(),
                    setZ: vi.fn(),
                    count: 33,
                    clone: vi.fn().mockReturnThis(),
                },
                uv: {
                    array: new Float32Array(100),
                    clone: vi.fn().mockReturnThis(),
                },
                normal: {
                    array: new Float32Array(100),
                    clone: vi.fn().mockReturnThis(),
                },
            },
            computeVertexNormals: vi.fn(),
            dispose: vi.fn(),
            setAttribute: vi.fn(),
            scale: vi.fn(),
            translate: vi.fn(),
        })),
        LatheGeometry: vi.fn(),
        CircleGeometry: vi.fn(),
        RingGeometry: vi.fn().mockImplementation(() => ({
            attributes: {
                position: { count: 10 },
                uv: { count: 10 },
            },
            dispose: vi.fn(),
        })),
        CylinderGeometry: vi.fn(),
        ShaderMaterial: vi.fn().mockImplementation(() => ({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uCapTexture: { value: null },
            },
            clone: vi.fn().mockReturnThis(),
            dispose: vi.fn(),
        })),
        BackSide: 1,
        AdditiveBlending: 2,
        DoubleSide: 0,
        Vector3: vi.fn().mockImplementation(() => ({
            set: vi.fn(),
            x: 0, y: 0, z: 0
        })),
        TextureLoader: vi.fn(),
        RepeatWrapping: 1000,
        CanvasTexture: vi.fn().mockImplementation(() => ({
            repeat: { set: vi.fn() },
            wrapS: 1000,
            wrapT: 1000,
            dispose: vi.fn()
        })),
        LinearFilter: 1006,
        LinearMipmapLinearFilter: 1008,
        ACESFilmicToneMapping: 3,
        NoToneMapping: 0,
    };
});

vi.mock('three/webgpu', async () => {
    return {
        WebGPURenderer: vi.fn(),
    };
});

describe('Bioluminescence Phase 1: Lifecycle Hardening', () => {
    let mockWebGLRenderer;
    let mockWebGPURenderer;
    let container;
    let createdThemes;

    beforeEach(async () => {
        // Reset mocks
        vi.clearAllMocks();
        createdThemes = [];

        // Reset window.location between tests
        window.location = { search: '', href: '', pathname: '/' };

        container = document.createElement('div');
        container.id = 'bioluminescence-theme';
        document.getElementById = vi.fn().mockReturnValue(container);

        // Setup mock implementations
        const { WebGLRenderer } = await import('three');
        const { WebGPURenderer } = await import('three/webgpu');

        mockWebGLRenderer = {
            domElement: document.createElement('canvas'),
            setSize: vi.fn(),
            setPixelRatio: vi.fn(),
            dispose: vi.fn(),
            render: vi.fn(),
            setClearColor: vi.fn(),
            info: { render: {}, memory: {} },
            capabilities: { isWebGL2: true },
        };
        WebGLRenderer.mockImplementation(() => mockWebGLRenderer);

        mockWebGPURenderer = {
            domElement: document.createElement('canvas'),
            setSize: vi.fn(),
            setPixelRatio: vi.fn(),
            dispose: vi.fn(),
            render: vi.fn(),
            init: vi.fn().mockResolvedValue(undefined),
            setClearColor: vi.fn(),
            backend: { isWebGPUBackend: true, device: { limits: { maxColorAttachments: 4 } } },
            hasFeature: vi.fn().mockReturnValue(false),
            info: { render: {}, memory: {} },
        };
        WebGPURenderer.mockImplementation(() => mockWebGPURenderer);
    });

    afterEach(() => {
        for (const theme of createdThemes) {
            try {
                theme.cleanup();
            } catch (error) {
                // Best-effort test cleanup
            }
        }
        createdThemes = [];
    });

    it('should initialize WebGPU renderer by default', async () => {
        const theme = new BioluminescenceTheme();
        createdThemes.push(theme);
        await theme.createScene();

        const { WebGPURenderer } = await import('three/webgpu');
        expect(WebGPURenderer).toHaveBeenCalled();
        expect(theme.isWebGPU).toBe(true);
        expect(theme.renderer).toBe(mockWebGPURenderer);
    });

    it('should fallback to WebGL if WebGPU init fails', async () => {
        const { WebGPURenderer } = await import('three/webgpu');
        // Mock init failure
        mockWebGPURenderer.init.mockRejectedValue(new Error('WebGPU not supported'));

        const theme = new BioluminescenceTheme();
        createdThemes.push(theme);
        await theme.createScene();

        const { WebGLRenderer } = await import('three');
        expect(WebGPURenderer).toHaveBeenCalled();
        expect(WebGLRenderer).toHaveBeenCalled();
        expect(theme.isWebGPU).toBe(false);
        expect(theme.renderer).toBe(mockWebGLRenderer);
    });

    it('should force WebGL if flag is set', async () => {
        window.location.search = '?forceWebGL=1';

        const theme = new BioluminescenceTheme();
        createdThemes.push(theme);
        await theme.createScene();

        const { WebGPURenderer } = await import('three/webgpu');
        const { WebGLRenderer } = await import('three');

        expect(WebGPURenderer).not.toHaveBeenCalled();
        expect(WebGLRenderer).toHaveBeenCalled();
        expect(theme.isWebGPU).toBe(false);
    });

    it('should handle device loss by recovering to WebGL', async () => {
        const theme = new BioluminescenceTheme();
        createdThemes.push(theme);
        await theme.createScene();

        expect(theme.isWebGPU).toBe(true);

        // Simulate device loss handler
        expect(theme.renderer.onDeviceLost).toBeDefined();

        // handleDeviceLoss checks isActive — must be true for recovery to proceed
        theme.isActive = true;

        // Clear mock call counts so we can verify WebGLRenderer is called during recovery
        const { WebGLRenderer } = await import('three');
        WebGLRenderer.mockClear();

        // Trigger device loss
        await theme.handleDeviceLoss({ message: 'Device lost' });

        expect(WebGLRenderer).toHaveBeenCalled();
        expect(theme.isWebGPU).toBe(false);
        expect(theme.flags.forceWebGL).toBe(true);
    });

    it('should clean up resources on dispose', async () => {
        const theme = new BioluminescenceTheme();
        createdThemes.push(theme);
        await theme.createScene();

        // Capture renderer reference before cleanup nullifies it
        const rendererRef = theme.renderer;

        theme.cleanup();

        expect(rendererRef.dispose).toHaveBeenCalled();
        // Check if scene and renderer are nullified
        expect(theme.scene).toBeNull();
        expect(theme.renderer).toBeNull();
    });
});
