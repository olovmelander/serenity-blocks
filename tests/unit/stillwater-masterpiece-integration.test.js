import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    acceptsLocalStillwaterPayload,
    createStillwaterMasterpieceRuntime,
    writeStillwaterWaterReaction,
} from '../../src/themes/stillwater/rendering/stillwater-runtime.js';
import {
    create as createStillwaterMasterpiecePlayground,
} from '../../src/playground/effects/stillwater-masterpiece.effect.js';

const moduleMocks = vi.hoisted(() => ({
    waterFactory: vi.fn(),
    forestFactory: vi.fn(),
    characterFactory: vi.fn(),
    atmosphereFactory: vi.fn(),
    reactionFactory: vi.fn(),
    pipelineFactory: vi.fn(),
    selectiveBloomConfigurator: vi.fn((material, emissiveNode = null) => {
        material.mrtNode = { output: true, emissive: emissiveNode };
        material.userData = {
            ...(material.userData || {}),
            mrtRole: emissiveNode
                ? 'stillwater-emissive'
                : 'stillwater-zero-emissive',
        };
        return material;
    }),
}));

vi.mock('../../src/themes/stillwater/rendering/stillwater-water.js', () => ({
    createStillwaterWater: moduleMocks.waterFactory,
}));

vi.mock('../../src/themes/stillwater/rendering/stillwater-forest.js', () => ({
    createStillwaterForest: moduleMocks.forestFactory,
    // The forest owns the mount transform so its shoreline conversion and the
    // runtime's FOREST_TRANSFORM cannot drift apart; the runtime reads these.
    FOREST_WORLD_SCALE: 0.52,
    FOREST_WORLD_Y: 1.0,
    FOREST_WORLD_Z: -4,
}));

vi.mock('../../src/themes/stillwater/rendering/stillwater-characters.js', () => ({
    createStillwaterCharacters: moduleMocks.characterFactory,
}));

vi.mock('../../src/themes/stillwater/rendering/stillwater-atmosphere.js', () => ({
    createStillwaterAtmosphere: moduleMocks.atmosphereFactory,
}));

vi.mock('../../src/themes/stillwater/rendering/stillwater-reactions.js', () => ({
    createStillwaterReactions: moduleMocks.reactionFactory,
}));

vi.mock('../../src/themes/stillwater/post/stillwater-pipeline.js', () => ({
    configureStillwaterSelectiveBloomMaterial:
        moduleMocks.selectiveBloomConfigurator,
    StillwaterPipeline: class StillwaterPipelineMock {
        constructor(...args) {
            Object.assign(this, moduleMocks.pipelineFactory(...args));
        }
    },
}));

const runtimeSource = readFileSync(
    new URL(
        '../../src/themes/stillwater/rendering/stillwater-runtime.js',
        import.meta.url,
    ),
    'utf8',
);
const adapterSource = readFileSync(
    new URL(
        '../../src/playground/effects/stillwater-masterpiece.effect.js',
        import.meta.url,
    ),
    'utf8',
);

function createRuntimeMocks() {
    const calls = {
        water: {
            camera: vi.fn((_time, activeCamera) => {
                activeCamera.position.set(0, 17.5, 36);
            }),
            update: vi.fn(),
            triggerReaction: vi.fn(() => true),
            clearReactions: vi.fn(),
            getDiagnostics: vi.fn(() => ({ post: false, proxies: false })),
            getResourceState: vi.fn(() => ({ water: true })),
            getRendererCounters: vi.fn(() => ({ drawCalls: 1 })),
            dispose: vi.fn(),
        },
        forest: {
            root: new THREE.Group(),
            update: vi.fn(),
            pulse: vi.fn(),
            setEnchantmentTide: vi.fn(),
            setReducedMotion: vi.fn(),
            getDiagnostics: vi.fn(() => ({ mode: 'flora' })),
            getResourceState: vi.fn(() => ({ forest: true })),
            dispose: vi.fn(),
        },
        characters: {
            criticalReady: Promise.resolve(true),
            ready: Promise.resolve(true),
            update: vi.fn(),
            pulse: vi.fn(),
            pulseSpirit: vi.fn(),
            pulseTroll: vi.fn(),
            settleLodTransition: vi.fn(),
            setReducedMotion: vi.fn(),
            setLevelEnrichment: vi.fn(),
            getDiagnostics: vi.fn(() => ({ boardSafe: true })),
            getResourceState: vi.fn(() => ({ characters: true })),
            dispose: vi.fn(),
        },
        atmosphere: {
            uMotion: { value: 1 },
            update: vi.fn(),
            setReducedMotion: vi.fn(),
            getDiagnostics: vi.fn(() => ({ activeMotes: 360 })),
            getResourceState: vi.fn(() => ({ atmosphere: true })),
            dispose: vi.fn(),
        },
        reactions: {
            dimple: vi.fn(),
            wake: vi.fn(),
            twist: vi.fn(),
            miracle: vi.fn(),
            echo: vi.fn(),
            tide: vi.fn(),
            update: vi.fn(),
            setReducedMotion: vi.fn(),
            getDiagnostics: vi.fn(() => ({ moteCapacity: 192 })),
            getResourceState: vi.fn(() => ({ reactions: true })),
            dispose: vi.fn(),
        },
        pipeline: {
            uExposure: { value: 0.9 },
            setSize: vi.fn(),
            setBloomStrength: vi.fn(),
            render: vi.fn(),
            renderAsync: vi.fn(() => Promise.resolve()),
            resize: vi.fn(),
            getDiagnostics: vi.fn(() => ({ outputTransformCount: 1 })),
            getResourceState: vi.fn(() => ({ post: true })),
            dispose: vi.fn(),
        },
    };

    moduleMocks.waterFactory.mockReturnValue(calls.water);
    moduleMocks.forestFactory.mockImplementation(({ scene }) => {
        scene.add(calls.forest.root);
        return calls.forest;
    });
    moduleMocks.characterFactory.mockReturnValue(calls.characters);
    moduleMocks.atmosphereFactory.mockReturnValue(calls.atmosphere);
    moduleMocks.reactionFactory.mockReturnValue(calls.reactions);
    moduleMocks.pipelineFactory.mockReturnValue(calls.pipeline);
    return calls;
}

function createContext(search = '') {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = {
        domElement: { width: 1280, height: 720 },
    };
    return {
        scene,
        camera,
        renderer,
        params: new URLSearchParams(search),
        sizes: { width: 1280, height: 720 },
    };
}

describe('Stillwater integrated masterpiece candidate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete globalThis.window?.__STILLWATER_MASTERPIECE__;
        delete globalThis.window?.__STILLWATER_WATER__;
    });

    it('maps normalized board origins into one reusable lake response record', () => {
        const target = {};
        const result = writeStillwaterWaterReaction(target, {
            originX: 0.75,
            originY: 0.25,
            strength: 0.8,
            cascadeDepth: 2,
            direction: -1,
        }, 12.5);

        expect(result).toBe(target);
        expect(target).toMatchObject({
            time: 12.5,
            x: 2.25,
            z: -3.5,
            strength: 0.8,
            phase: 1,
        });
        expect(target.scale).toBeCloseTo(1.288, 6);

        writeStillwaterWaterReaction(target, {
            originX: 5,
            originY: -5,
            strength: 5,
            cascadeDepth: 9,
        }, -1);
        expect(target).toMatchObject({
            time: 0.0001,
            x: 4.5,
            z: 0,
            strength: 1.35,
            scale: 1.58,
        });
    });

    it('accepts online-local gameplay but rejects explicitly remote ownership', () => {
        expect(acceptsLocalStillwaterPayload({ source: 'online' })).toBe(true);
        expect(acceptsLocalStillwaterPayload({
            source: 'online',
            isLocal: true,
        })).toBe(true);
        expect(acceptsLocalStillwaterPayload({ isLocal: false })).toBe(false);
        expect(acceptsLocalStillwaterPayload({ remote: true })).toBe(false);
        expect(acceptsLocalStillwaterPayload({ owner: 'remote' })).toBe(false);
    });

    it('publishes and removes the debug global only through the playground adapter', () => {
        createRuntimeMocks();
        const previousWindow = globalThis.window;
        globalThis.window = {};
        try {
            const runtime = createStillwaterMasterpiecePlayground(createContext());
            expect(globalThis.window.__STILLWATER_MASTERPIECE__).toBe(runtime);
            runtime.dispose();
            expect(globalThis.window.__STILLWATER_MASTERPIECE__).toBeUndefined();
        } finally {
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
        }
    });

    it('composes exact builders with terrain/proxy/post duplication removed', () => {
        expect(runtimeSource).toContain("from 'three/webgpu'");
        expect(runtimeSource).toContain("from './stillwater-water.js'");
        expect(runtimeSource).toContain('createStillwaterWater({');
        expect(runtimeSource).toContain("waterParams.set('proxies', 'off')");
        expect(runtimeSource).toContain("waterParams.set('post', 'off')");
        expect(runtimeSource).toContain("waterParams.set('event', 'idle')");
        expect(runtimeSource).toContain('includeLights: false');
        expect(runtimeSource).not.toContain('object.isLight) object.visible = false');
        expect(runtimeSource).toContain('createStillwaterForest({');
        expect(runtimeSource).toContain("mode: 'flora'");
        expect(runtimeSource).toContain('includeTerrain: false');
        expect(runtimeSource).toContain('reflectionLayer: REFLECTION_LAYER');
        expect(runtimeSource).toContain('createStillwaterCharacters({');
        expect(runtimeSource).toContain('createStillwaterAtmosphere({');
        expect(runtimeSource).toContain('createStillwaterReactions({');
        expect(runtimeSource.match(/new StillwaterPipeline\(/g)).toHaveLength(1);
        expect(runtimeSource).not.toMatch(
            /new THREE\.PostProcessing|THREE\.ShaderMaterial|\b(?:glslFn|wgslFn)\s*\(/,
        );
        expect(runtimeSource).not.toMatch(/\bwindow\b|stillwater-water\.effect/);
        expect(adapterSource).toContain('createStillwaterRuntime(context)');
        expect(adapterSource).toContain('window.__STILLWATER_MASTERPIECE__ = runtime');
        expect(adapterSource).not.toContain('new StillwaterPipeline');
    });

    it('routes collapsed canonical reactions through fixed sinks without duplicate cues', () => {
        const calls = createRuntimeMocks();
        const runtime = createStillwaterMasterpieceRuntime(createContext('quality=High'));

        expect(runtime.triggerPreset('tetris')).toBe(true);
        expect(runtime.getDiagnostics().reaction.director).toMatchObject({
            pendingStreams: 1,
            sinkErrors: 0,
        });
        runtime.flushReactions(0);
        expect(runtime.getDiagnostics().reaction.director).toMatchObject({
            pendingStreams: 0,
            sinkErrors: 0,
        });
        expect(calls.reactions.wake).toHaveBeenCalledTimes(1);
        expect(calls.water.triggerReaction).toHaveBeenCalledWith(
            'tetris',
            expect.any(Object),
        );
        expect(calls.forest.pulse).toHaveBeenCalledWith(
            'lineClear',
            expect.any(Object),
        );
        expect(calls.characters.pulse).toHaveBeenCalledWith('tetris', 1);

        runtime.resetReactions();
        expect(runtime.triggerPreset('tspin')).toBe(true);
        runtime.flushReactions(0);
        expect(calls.reactions.twist).toHaveBeenCalledTimes(1);
        expect(calls.water.triggerReaction).toHaveBeenLastCalledWith(
            'tspin',
            expect.any(Object),
        );

        runtime.resetReactions();
        expect(runtime.triggerPreset('combo')).toBe(true);
        runtime.flushReactions(0);
        expect(calls.reactions.miracle).toHaveBeenCalledTimes(1);
        expect(calls.characters.pulseSpirit).toHaveBeenCalledTimes(1);
        expect(calls.characters.pulseTroll).toHaveBeenCalledTimes(1);

        runtime.resetReactions();
        expect(runtime.triggerPreset('harddrop')).toBe(true);
        runtime.flushReactions(0);
        expect(calls.reactions.dimple).toHaveBeenCalledTimes(1);
        expect(calls.characters.pulse).toHaveBeenLastCalledWith(
            'hardDrop',
            expect.any(Number),
        );

        runtime.resetReactions();
        expect(runtime.triggerPreset('levelup', { level: 8 })).toBe(true);
        runtime.flushReactions(0);
        expect(runtime.getDiagnostics().reaction.levelEnrichmentTarget)
            .toBeGreaterThan(0);
        expect(calls.reactions.dimple).toHaveBeenCalledTimes(1);

        runtime.dispose();
    });

    it('provides idempotent production gameplay attachment and layout pullback', () => {
        createRuntimeMocks();
        const runtime = createStillwaterMasterpieceRuntime(createContext('quality=High'));
        const unsubscribers = Array.from({ length: 8 }, () => vi.fn());
        const bus = {
            on: vi.fn(() => unsubscribers[bus.on.mock.calls.length - 1]),
        };
        const events = {
            PIECE_LOCK: 'piece-lock',
            LINE_CLEAR: 'line-clear',
            COMBO: 'combo',
            TSPIN: 'tspin',
            B2B: 'b2b',
            PERFECT_CLEAR: 'perfect-clear',
            HARD_DROP: 'hard-drop',
            LEVEL_UP: 'level-up',
        };

        runtime.attach(bus, events);
        runtime.attach(bus, events);
        expect(bus.on).toHaveBeenCalledTimes(8);
        runtime.detach();
        unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });

        expect(runtime.pulse('PIECE_LOCK', { remote: true })).toBe(false);
        expect(runtime.pulse('PIECE_LOCK', { source: 'online' })).toBe(true);
        runtime.resetReactions();
        runtime.configureGameplay({ enabled: false });
        expect(runtime.pulse('PIECE_LOCK', { source: 'online' })).toBe(false);
        runtime.configureGameplay({
            enabled: true,
            backgroundComboEffects: true,
            pieceLockRipple: true,
            reducedMotion: true,
            intensity: 0.65,
        });
        expect(runtime.pulse('PIECE_LOCK', { source: 'online' })).toBe(true);

        expect(runtime.setLayout({
            layout: 'quad',
            camera: {
                position: [0, 17.5, 47],
                target: [0, 1.6, -13],
                fov: 43,
                near: 0.1,
                far: 520,
                totalPullback: 11,
            },
        })).toBe(11);
        const activeCamera = new THREE.PerspectiveCamera();
        runtime.camera(0, activeCamera);
        expect(activeCamera.position.toArray()).toEqual([0, 17.5, 47]);
        expect(activeCamera.fov).toBe(43);
        expect(runtime.cameraRadius).toBe(57);
        expect(runtime.getDiagnostics()).toMatchObject({
            reducedMotion: true,
            layout: {
                id: 'quad',
                cameraPullback: 11,
            },
        });

        runtime.dispose();
    });

    it('keeps update allocation-free and exposes all eight canonical event hooks', () => {
        const advanceBody = runtimeSource.match(
            /function advanceModules\(time, delta, advanceDirector = true\) \{([\s\S]*?)\n {4}\}/,
        )?.[1] || '';
        expect(advanceBody).not.toMatch(
            /\bnew\b|Array\.from|\.map\(|\.filter\(|\.push\(|\.splice\(/,
        );
        expect(runtimeSource).toContain('STILLWATER_EVENT.PIECE_LOCK');
        expect(runtimeSource).toContain('STILLWATER_EVENT.LINE_CLEAR');
        expect(runtimeSource).toContain('STILLWATER_EVENT.COMBO');
        expect(runtimeSource).toContain('STILLWATER_EVENT.TSPIN');
        expect(runtimeSource).toContain('STILLWATER_EVENT.B2B');
        expect(runtimeSource).toContain('STILLWATER_EVENT.PERFECT_CLEAR');
        expect(runtimeSource).toContain('STILLWATER_EVENT.HARD_DROP');
        expect(runtimeSource).toContain('STILLWATER_EVENT.LEVEL_UP');
        expect(runtimeSource).not.toMatch(/\bCASCADE\b/);
        expect(runtimeSource).toContain('const routeCounts = new Uint32Array(10)');
        expect(runtimeSource).toContain('const waterReaction = {');
    });

    it('drives the real packed reaction renderer without replacing pool identities', async () => {
        const {
            createStillwaterReactions,
        } = await vi.importActual(
            '../../src/themes/stillwater/rendering/stillwater-reactions.js',
        );
        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'High',
            reducedMotion: false,
            selectiveBloom: false,
        });
        const before = reactions.getResourceState();
        const options = {
            sequence: 7,
            originX: 0.62,
            originY: 0.71,
            strength: 0.9,
            durationMs: 980,
            moteCount: 24,
            lineCount: 4,
        };

        reactions.update(8);
        reactions.dimple(options);
        reactions.wake(options);
        reactions.twist(options);
        reactions.echo(options);
        reactions.miracle(options);
        reactions.tide(options);
        const after = reactions.getResourceState();

        expect(reactions.getDiagnostics()).toMatchObject({
            moteCapacity: 192,
            shaftCapacity: 3,
            specialSlots: 1,
            tide: 0.9,
            perEventResourceCreation: 0,
        });
        expect(reactions.getDiagnostics().emittedMotes).toBeGreaterThan(0);
        expect(reactions.getDiagnostics().emittedShafts).toBeGreaterThan(0);
        expect(reactions.getDiagnostics().emittedRunes).toBeGreaterThan(0);
        expect(after.moteOriginBirthArray).toBe(before.moteOriginBirthArray);
        expect(after.moteVelocityLifeArray).toBe(before.moteVelocityLifeArray);
        expect(after.moteStyleArray).toBe(before.moteStyleArray);
        expect(after.shaftOriginBirthArray).toBe(before.shaftOriginBirthArray);

        reactions.dispose();
        reactions.dispose();
        expect(root.children).toHaveLength(0);
    });

    it('performs one final MRT sweep after async character materials arrive', async () => {
        const calls = createRuntimeMocks();
        let resolveTarget;
        let characterRoot;
        calls.characters.ready = new Promise((resolve) => {
            resolveTarget = resolve;
        });
        moduleMocks.characterFactory.mockImplementation(({ root }) => {
            characterRoot = root;
            return calls.characters;
        });

        const runtime = createStillwaterMasterpieceRuntime(
            createContext('quality=High'),
        );
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicNodeMaterial();
        material.userData.mrtRole = 'stillwater-zero-emissive';
        characterRoot.add(new THREE.Mesh(geometry, material));
        expect(material.mrtNode).toBeNull();

        resolveTarget(true);
        await expect(runtime.ready).resolves.toBe(true);
        await runtime.ready;
        expect(material.userData.mrtRole).toBe('stillwater-zero-emissive');
        expect(moduleMocks.selectiveBloomConfigurator).toHaveBeenCalledTimes(1);
        expect(runtime.getDiagnostics()).toMatchObject({
            mrtMissing: 0,
            nonNodeMaterials: 0,
            materials: {
                finalSweepComplete: true,
                selectiveBloom: true,
            },
        });

        runtime.dispose();
        geometry.dispose();
        material.dispose();
    });

    it('rebuilds the WebGPU post graph only for a real size change', () => {
        const calls = createRuntimeMocks();
        const replacementPipeline = {
            ...calls.pipeline,
            setSize: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
        };
        moduleMocks.pipelineFactory
            .mockReturnValueOnce(calls.pipeline)
            .mockReturnValueOnce(replacementPipeline);
        const context = createContext('quality=High');
        context.renderer.backend = { isWebGPUBackend: true };
        context.renderer.getPixelRatio = vi.fn(() => 1);

        const runtime = createStillwaterMasterpieceRuntime(context);
        expect(moduleMocks.pipelineFactory).toHaveBeenCalledTimes(1);
        expect(calls.pipeline.setSize).toHaveBeenCalledWith(1280, 720);

        runtime.resize(1280, 720);
        expect(moduleMocks.pipelineFactory).toHaveBeenCalledTimes(1);
        expect(calls.pipeline.dispose).not.toHaveBeenCalled();

        runtime.resize(900, 700);
        expect(moduleMocks.pipelineFactory).toHaveBeenCalledTimes(2);
        expect(replacementPipeline.setSize).toHaveBeenCalledWith(900, 700);
        expect(calls.pipeline.resize).not.toHaveBeenCalled();
        expect(calls.pipeline.dispose).toHaveBeenCalledTimes(1);

        runtime.dispose();
        runtime.dispose();
        expect(calls.pipeline.dispose).toHaveBeenCalledTimes(1);
        expect(replacementPipeline.dispose).toHaveBeenCalledTimes(1);
    });

    it('settles async LOD readiness and deep-disposes every owner exactly once', async () => {
        const calls = createRuntimeMocks();
        const context = createContext('quality=High&event=perfectclear&fxAge=.5');
        const runtime = createStillwaterMasterpieceRuntime(context);

        await expect(runtime.criticalReady).resolves.toBe(true);
        await expect(runtime.ready).resolves.toBe(true);
        expect(calls.characters.settleLodTransition).toHaveBeenCalledTimes(1);
        expect(runtime.isCriticalReady()).toBe(true);
        expect(runtime.isReady()).toBe(true);

        runtime.update(8, 0);
        runtime.render();
        runtime.resize(900, 700);
        expect(calls.pipeline.render).toHaveBeenCalledTimes(1);
        expect(calls.pipeline.resize).toHaveBeenCalledWith(900, 700);

        runtime.dispose();
        runtime.dispose();
        expect(calls.pipeline.dispose).toHaveBeenCalledTimes(1);
        expect(calls.reactions.dispose).toHaveBeenCalledTimes(1);
        expect(calls.atmosphere.dispose).toHaveBeenCalledTimes(1);
        expect(calls.characters.dispose).toHaveBeenCalledTimes(1);
        expect(calls.forest.dispose).toHaveBeenCalledTimes(1);
        expect(calls.water.dispose).toHaveBeenCalledTimes(1);
        expect(context.scene.getObjectByName(
            'stillwater-masterpiece-characters-root',
        )).toBeUndefined();
    });
});
