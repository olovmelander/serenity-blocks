import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { createStillwaterAtmosphere } from '../../src/themes/stillwater/rendering/stillwater-atmosphere.js';
import { createStillwaterCharacters } from '../../src/themes/stillwater/rendering/stillwater-characters.js';
import { createStillwaterReactions } from '../../src/themes/stillwater/rendering/stillwater-reactions.js';
import { createStillwaterWater } from '../../src/themes/stillwater/rendering/stillwater-water.js';
import { getStillwaterQualityProfile } from '../../src/themes/stillwater/stillwater-quality.js';

function makeRenderer() {
    return {
        backend: { isWebGPUBackend: true },
        domElement: { width: 1280, height: 720 },
        info: {
            memory: {},
            render: {},
        },
        render: vi.fn(),
    };
}

function makeWater(quality, proxies = 'off', responses = 'off') {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = makeRenderer();
    const params = new URLSearchParams({
        quality,
        reflection: 'off',
        responses,
        proxies,
        post: 'off',
    });
    const water = createStillwaterWater({
        scene,
        camera,
        renderer,
        params,
        includeLights: false,
    });
    return { scene, water };
}

function countRenderableChildren(root) {
    return root.children.filter((child) => child.isMesh && child.visible !== false).length;
}

describe('Stillwater structural render budgets', () => {
    it('keeps High planar reflections inside the AMD 1080p render budget', () => {
        const medium = getStillwaterQualityProfile('Medium');
        const high = getStillwaterQualityProfile('High');
        const ultra = getStillwaterQualityProfile('Ultra');

        expect(medium.wakeSlots).toBe(4);
        expect(high.reflectionScale).toBe(0.30);
        expect(high.reflectionScale).toBeLessThan(ultra.reflectionScale);
        expect(high.bloomScale).toBe(0.45);
    });

    it('uses one pass for every planar transparent DoubleSide layer', () => {
        const scene = new THREE.Scene();
        const atmosphere = createStillwaterAtmosphere({
            scene,
            quality: 'High',
        });
        expect(atmosphere.mistLayers[0].material).toMatchObject({
            side: THREE.DoubleSide,
            forceSinglePass: true,
        });

        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'High',
        });
        const shaft = root.getObjectByName('stillwater-fixed-moon-shafts');
        const rune = root.getObjectByName('stillwater-priority-lake-rune');
        expect(shaft.material).toMatchObject({
            side: THREE.DoubleSide,
            forceSinglePass: true,
        });
        expect(rune.material).toMatchObject({
            side: THREE.DoubleSide,
            forceSinglePass: true,
        });

        reactions.dispose();
        atmosphere.dispose();
    });

    it('keeps fixed reaction pools out of idle draws and reuses them for storms', () => {
        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'High',
        });
        const motes = root.getObjectByName('stillwater-fixed-reaction-motes');
        const shafts = root.getObjectByName('stillwater-fixed-moon-shafts');
        const rune = root.getObjectByName('stillwater-priority-lake-rune');
        const options = {
            durationMs: 800,
            lineCount: 4,
            moteCount: 24,
            strength: 1,
        };

        expect([motes.visible, shafts.visible, rune.visible]).toEqual([
            false,
            false,
            false,
        ]);
        expect(reactions.getDiagnostics()).toMatchObject({
            draws: 0,
            idleDraws: 0,
            maxDraws: 3,
        });

        reactions.update(2);
        reactions.wake(options);
        reactions.echo(options);
        expect([motes.visible, shafts.visible, rune.visible]).toEqual([
            true,
            true,
            true,
        ]);
        expect(motes.count).toBe(48);
        expect(reactions.getDiagnostics().draws).toBe(3);

        reactions.update(4);
        expect([motes.visible, shafts.visible, rune.visible]).toEqual([
            false,
            false,
            false,
        ]);
        expect(motes.count).toBe(0);
        expect(reactions.getDiagnostics().draws).toBe(0);
        reactions.dispose();
    });

    it('keeps Minimal reactions to one active draw while retaining mote feedback', () => {
        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'Minimal',
        });
        const motes = root.getObjectByName('stillwater-fixed-reaction-motes');
        const rune = root.getObjectByName('stillwater-priority-lake-rune');

        reactions.miracle({
            durationMs: 800,
            moteCount: 24,
            strength: 1,
        });

        expect(motes.visible).toBe(true);
        expect(motes.count).toBe(24);
        expect(rune).toBeUndefined();
        expect(reactions.getDiagnostics()).toMatchObject({
            draws: 1,
            maxDraws: 1,
            runeModel: 'disabled-minimal',
            specialSlots: 0,
        });
        reactions.dispose();
    });

    it('omits duplicate lights and secondary lake detail on lean tiers', () => {
        const low = makeWater('Low');
        const high = makeWater('High');
        const lowLights = [];
        low.water.root.traverse((object) => {
            if (object.isLight) lowLights.push(object);
        });

        expect(lowLights).toHaveLength(0);
        expect(low.water.getDiagnostics()).toMatchObject({
            quality: 'Low',
            flowModel: 'layered-analytic-sine',
            materialXFlow: false,
            lights: 0,
            moonHalo: false,
            submergedShapes: 0,
        });
        expect(high.water.getDiagnostics()).toMatchObject({
            quality: 'High',
            flowModel: 'materialx-broad-analytic-warp',
            materialXFlow: true,
            lights: 0,
            moonHalo: true,
            submergedShapes: 5,
        });
        expect(countRenderableChildren(low.water.root)).toBe(5);
        expect(countRenderableChildren(high.water.root)
            - countRenderableChildren(low.water.root)).toBe(3);
        expect(high.water.getResourceState().ownedGeometries
            - low.water.getResourceState().ownedGeometries).toBe(2);
        expect(high.water.getResourceState().ownedMaterials
            - low.water.getResourceState().ownedMaterials).toBe(2);

        low.water.dispose();
        high.water.dispose();
    });

    it('reflects only the major proxy silhouettes, never their small detail', () => {
        const { water } = makeWater('High', 'on');
        const troll = water.root.getObjectByName('troll-reflection-proxy');
        const spirit = water.root.getObjectByName('spirit-reflection-proxy');
        const reflected = (object) => (object.layers.mask & (1 << 2)) !== 0;

        expect(troll.children.map(reflected)).toEqual([true, true, false]);
        expect(spirit.children.map(reflected)).toEqual([true, false]);
        water.dispose();
    });

    it('keeps the response shader dormant outside exact response lifetimes', () => {
        const { water } = makeWater('Medium', 'off', 'on');
        const materialVersion = water.getDiagnostics().waterMaterialVersion;

        expect(water.getDiagnostics()).toMatchObject({
            activeResponseSlots: 0,
            flowModel: 'layered-analytic-sine',
            materialXFlow: false,
            responseGraphModel: 'lean-four-wake',
            responseGraphActive: false,
            responseGraphMode: 'idle',
            wakeSlots: 4,
            responseSlotBytes: 128,
            tetrisDepthWakes: 4,
            physicalDisplacement: true,
            opticalResponse: true,
            emissiveResponse: true,
        });
        expect(water.getResourceState().responseStateValues).toHaveLength(4);
        expect(water.getResourceState().responseShapeValues).toHaveLength(4);

        water.update(1);
        expect(water.triggerReaction('lock', {
            time: 1,
            x: 0,
            z: -7,
        })).toBe(true);
        expect(water.getDiagnostics()).toMatchObject({
            activeResponseSlots: 1,
            responseGraphActive: true,
            responseGraphMode: 'lock',
        });

        water.update(2.73);
        expect(water.getDiagnostics()).toMatchObject({
            activeResponseSlots: 0,
            responseGraphActive: false,
            responseGraphMode: 'idle',
        });

        expect(water.triggerReaction('tetris', {
            time: 3,
            x: 0,
            z: -10.5,
        })).toBe(true);
        water.update(3.42);
        expect(water.getDiagnostics()).toMatchObject({
            activeResponseSlots: 1,
            responseGraphActive: true,
            responseGraphMode: 'tetris',
        });

        water.clearReactions();
        water.update(4);
        expect(water.triggerReaction('tspin', {
            time: 4,
            x: 2.2,
            z: -11.5,
        })).toBe(true);
        expect(water.getDiagnostics()).toMatchObject({
            activeResponseSlots: 1,
            responseGraphActive: true,
            responseGraphMode: 'tspin',
        });
        expect(water.getDiagnostics().waterMaterialVersion).toBe(materialVersion);

        water.dispose();
    });

    it('uses the lean response graph across every response-enabled tier', () => {
        const medium = makeWater('Medium', 'off', 'on');
        const high = makeWater('High', 'off', 'on');
        const disabled = makeWater('Medium', 'off', 'off');

        expect(medium.water.getDiagnostics().responseGraphModel)
            .toBe('lean-four-wake');
        expect(high.water.getDiagnostics().responseGraphModel)
            .toBe('lean-four-wake');
        expect(disabled.water.getDiagnostics()).toMatchObject({
            responseGraphModel: 'disabled',
            responsesEnabled: false,
            wakeSlots: 0,
            responseSlotBytes: 0,
            tetrisDepthWakes: 0,
        });

        medium.water.dispose();
        high.water.dispose();
        disabled.water.dispose();
    });

    it('keeps lean spirit silhouettes while pruning secondary draws and reflection', () => {
        const lowRoot = new THREE.Group();
        const highRoot = new THREE.Group();
        const low = createStillwaterCharacters({
            root: lowRoot,
            profile: getStillwaterQualityProfile('Low'),
            mode: 'spirit',
        });
        const high = createStillwaterCharacters({
            root: highRoot,
            profile: getStillwaterQualityProfile('High'),
            mode: 'spirit',
        });
        const lowSpirit = lowRoot.getObjectByName('stillwater-spirit');
        const highSpirit = highRoot.getObjectByName('stillwater-spirit');
        const reflectedLowChildren = lowSpirit.children.filter(
            (child) => (child.layers.mask & (1 << 2)) !== 0,
        );
        const reflectedHighChildren = highSpirit.children.filter(
            (child) => (child.layers.mask & (1 << 2)) !== 0,
        );

        expect(lowSpirit.children).toHaveLength(2);
        expect(lowRoot.getObjectByName('stillwater-spirit-flowing-veil')).toBeUndefined();
        expect(low.getDiagnostics()).toMatchObject({
            leanTier: true,
            directDrawEstimate: 2,
            reflectionDrawEstimate: 1,
        });
        // Bloom-capable tiers add the orbiting mote swarm as a fifth draw.
        expect(highSpirit.children).toHaveLength(5);
        expect(highRoot.getObjectByName('stillwater-spirit-motes')).toBeDefined();
        expect(lowRoot.getObjectByName('stillwater-spirit-motes')).toBeUndefined();
        expect(high.getDiagnostics()).toMatchObject({
            leanTier: false,
            directDrawEstimate: 5,
            // Head plus robe: mirroring only the core left a floating orb in the
            // lake with no figure under it.
            reflectionDrawEstimate: 2,
        });
        expect(reflectedLowChildren).toHaveLength(1);
        expect(reflectedHighChildren).toHaveLength(2);

        low.dispose();
        high.dispose();
    });

    it('uses the lean character silhouette on Medium where bloom is absent', () => {
        const root = new THREE.Group();
        const characters = createStillwaterCharacters({
            root,
            profile: getStillwaterQualityProfile('Medium'),
            mode: 'all',
        });

        expect(characters.getDiagnostics()).toMatchObject({
            leanTier: true,
            directDrawEstimate: 3,
            targetLod: 'medium',
        });
        expect(root.getObjectByName('stillwater-spirit-flowing-veil')).toBeUndefined();

        characters.dispose();
    });
});
