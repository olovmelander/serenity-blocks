import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import {
    chiralParticlePositions, createChiralParticleObject,
} from '../../src/themes/chiral-gold/chiral-gold-particles.js';
import {
    CHIRAL_GOLD_SCULPTURE_TIERS, createChiralGoldSculpture,
} from '../../src/themes/chiral-gold/chiral-gold-sculpture.js';

const themes = [];
const resources = [];
function createTheme(quality = 'High') {
    const theme = new ChiralGoldTheme();
    theme.applyQualityPreset(quality);
    theme.isActive = true;
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.PerspectiveCamera(64, 1600 / 900, 0.1, 50000);
    theme.camera.position.set(0, 0, 1520);
    theme.camera.updateMatrixWorld();
    theme.renderer = { isWebGPURenderer: true };
    theme.random = () => 0.5;
    themes.push(theme);
    return theme;
}
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function finiteGeometry(root) {
    root.traverse((object) => {
        for (const attribute of Object.values(object.geometry?.attributes || {})) {
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        for (const vector of [object.position, object.rotation, object.scale]) {
            expect([vector.x, vector.y, vector.z].every(Number.isFinite)).toBe(true);
        }
    });
}

beforeEach(() => {
    vi.stubGlobal('window', {
        innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
        location: { search: '' }, settings: { effectQuality: 'High' },
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
        hidden: false, getElementById: () => null, querySelector: () => null,
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    for (const theme of themes.splice(0)) {
        theme.sculpture?.dispose();
        theme.clearTempEffects();
        theme.disposeSceneResources();
        theme.disposeComputeResources();
    }
    for (const dispose of resources.splice(0)) dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Chiral Gold sized particle geometry', () => {
    it('renders a quad per node particle while retaining CPU array identity and attribute usage', () => {
        const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
        const lives = new Float32Array([0.25, 1]);
        const source = new THREE.BufferGeometry();
        source.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        source.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        const sourceDispose = vi.spyOn(source, 'dispose');
        const material = new THREE.SpriteNodeMaterial();
        const sprite = createChiralParticleObject(source, material);
        resources.push(() => { sprite.geometry.dispose(); material.dispose(); });
        expect(sprite.isSprite).toBe(true);
        expect(sprite.geometry.isInstancedBufferGeometry).toBe(true);
        expect(sprite.geometry.instanceCount).toBe(2);
        expect(sprite.geometry.attributes.position.count).toBe(4);
        expect(sprite.geometry.index.count).toBe(6);
        expect(chiralParticlePositions(sprite).array).toBe(positions);
        expect(chiralParticlePositions(sprite).isInstancedBufferAttribute).toBe(true);
        expect(chiralParticlePositions(sprite).usage).toBe(THREE.DynamicDrawUsage);
        expect(sprite.geometry.attributes.aLife.array).toBe(lives);
        positions[0] = 19;
        expect(chiralParticlePositions(sprite).getX(0)).toBe(19);
        expect(sprite.frustumCulled).toBe(false);
        expect(sourceDispose).toHaveBeenCalledOnce();
    });

    it('preserves the classic point object and original geometry when the material is classic', () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const material = new THREE.PointsMaterial();
        const object = createChiralParticleObject(geometry, material);
        resources.push(() => { geometry.dispose(); material.dispose(); });
        expect(object.isPoints).toBe(true);
        expect(object.geometry).toBe(geometry);
        expect(chiralParticlePositions(object)).toBe(geometry.getAttribute('position'));
    });
});

describe('Chiral Gold event placement and retirement', () => {
    it('keeps a lock burst at the projected piece position after scene composition and viewport changes', () => {
        const theme = createTheme('Low');
        theme.createCpuBurstPools(2, 24);
        for (const [width, height] of [[1600, 900], [390, 844], [844, 390]]) {
            window.innerWidth = width;
            window.innerHeight = height;
            theme.camera.aspect = width / height;
            theme.camera.updateProjectionMatrix();
            theme.applySceneComposition();
            const origin = theme.getOriginFromPiece({ shape: [[1]], x: 2, y: 14 });
            theme.triggerBurst(0.5, 0, { profile: 'lock_burst', origin });
            const pool = theme.burstPools.find((entry) => entry.userData.cpuBurst.active);
            pool.updateMatrixWorld();
            const position = new THREE.Vector3().fromBufferAttribute(chiralParticlePositions(pool), 0);
            const world = pool.localToWorld(position);
            expect(world.distanceTo(origin)).toBeLessThan(0.001);
            expect(pool.scale.toArray()).toEqual([1, 1, 1]);
            theme.updateBurstCpu(10);
        }
    });

    it('uploads the final CPU expiry frame, hides the empty pool and reuses it for another burst', () => {
        const theme = createTheme('Low');
        theme.createCpuBurstPools(1, 24);
        const pool = theme.burstPools[0];
        expect(pool.visible).toBe(false);
        theme.triggerBurst(1, 1, new THREE.Vector3(10, 20, 30));
        const position = chiralParticlePositions(pool);
        const life = pool.geometry.attributes.aLife;
        const positionVersion = position.version;
        const lifeVersion = life.version;
        expect(pool.visible).toBe(true);
        theme.updateBurstCpu(10);
        expect(pool.userData.cpuBurst.active).toBe(false);
        expect(pool.visible).toBe(false);
        expect(pool.userData.cpuBurst.life.every((value) => value === 0)).toBe(true);
        expect(pool.userData.cpuBurst.positions.every((value, index) => index % 3 !== 2 || value === -9999)).toBe(true);
        expect(position.version).toBeGreaterThan(positionVersion);
        expect(life.version).toBeGreaterThan(lifeVersion);
        theme.triggerBurst(1, 2, new THREE.Vector3(-10, 50, 0));
        expect(pool.visible).toBe(true);
        expect(pool.userData.cpuBurst.active).toBe(true);
    });

    it('consumes pending combo state even when the clear provides an explicit combo count', () => {
        const theme = createTheme();
        const burst = vi.spyOn(theme, 'triggerBurst').mockImplementation(() => {});
        theme.handleCombo({ comboCount: 6 });
        theme.handleLineClear({ lineCount: 1, comboCount: 2 });
        expect(theme.pendingComboCount).toBe(0);
        expect(burst.mock.calls.every(([, combo]) => combo === 2)).toBe(true);
        burst.mockClear();
        theme.handleLineClear({ lineCount: 1 });
        expect(burst.mock.calls.length).toBeGreaterThan(0);
        expect(burst.mock.calls.every(([, combo]) => combo === 0)).toBe(true);
    });

    it('keeps CPU row dissolves sparse compared with an equally intense hero burst', () => {
        const theme = createTheme('Low');
        theme.createCpuBurstPools(2, 900);
        const origin = new THREE.Vector3(-50, 0, 0);
        theme.triggerBurst(1.5, 0, { profile: 'hero_close', origin });
        theme.triggerBurst(1.5, 0, { profile: 'dissolve', origin });
        const count = (pool) => pool.userData.cpuBurst.life.filter((life) => life > 0).length;
        const heroCount = count(theme.burstPools[0]);
        const dissolveCount = count(theme.burstPools[1]);
        expect(heroCount).toBeGreaterThan(0);
        expect(dissolveCount).toBeGreaterThan(0);
        expect(dissolveCount).toBeLessThanOrEqual(heroCount * 0.25);
    });

    it.each([[1600, 900], [390, 844]])('keeps Infinity clear dissolves at the visible row band on %s×%s', (
        width, height,
    ) => {
        const theme = createTheme();
        window.innerWidth = width;
        window.innerHeight = height;
        theme.camera.aspect = width / height;
        theme.camera.updateProjectionMatrix();
        const burst = vi.spyOn(theme, 'triggerBurst').mockImplementation(() => {});
        const viewportOrigin = { x: 0.5, y: 0.35 };
        const positionsFor = (baseRow) => {
            burst.mockClear();
            theme.handleLineClear({
                lineCount: 4, comboCount: 20, viewportOrigin,
                clearedRows: [baseRow, baseRow + 1, baseRow + 2, baseRow + 3],
            });
            const dissolves = burst.mock.calls.filter(([, , options]) => options?.profile === 'dissolve');
            expect(dissolves).toHaveLength(8);
            return dissolves.map(([intensity, , options]) => {
                expect(intensity).toBeLessThanOrEqual(1.05);
                expect(options.sizeMultiplier).toBeLessThanOrEqual(0.4);
                expect(options.lifeMultiplier).toBeLessThanOrEqual(0.5);
                expect(options.sparkBoost).toBeLessThanOrEqual(0.1);
                const projected = options.origin.clone().project(theme.camera);
                expect(Math.abs(projected.x)).toBeCloseTo(0.22, 6);
                expect(projected.y).toBeCloseTo(0.36 - viewportOrigin.y * 0.72, 6);
                return options.origin.toArray();
            });
        };
        expect(positionsFor(6000)).toEqual(positionsFor(300));
    });

    it('updates temporary strand particle positions without deforming the sprite quad', () => {
        const theme = createTheme();
        theme.createTemporaryStrandSegment({ particleCount: 180, origin: new THREE.Vector3() });
        const segment = theme.tempStrandSegments[0];
        const positions = chiralParticlePositions(segment);
        const before = positions.array.slice();
        const quad = segment.geometry.getAttribute('position');
        const quadBefore = quad.array.slice();
        const version = positions.version;
        theme.time = 1;
        theme.updateTemporaryStrands(1 / 60, { midEnergy: 0.5 });
        expect(positions.array).not.toEqual(before);
        expect(positions.version).toBeGreaterThan(version);
        expect(quad.array).toEqual(quadBefore);
        expect(positions.array.every(Number.isFinite)).toBe(true);
    });

    it('animates every permanent strand particle without deforming its instanced sprite quad', () => {
        const theme = createTheme();
        theme.createStrands();
        const strand = theme.strands[0];
        const positions = chiralParticlePositions(strand);
        const before = positions.array.slice();
        const quad = strand.geometry.getAttribute('position');
        const quadBefore = quad.array.slice();
        const version = positions.version;
        theme.time = 1;
        theme.audioChannels.flow = 0.5;
        theme.updateStrands(1 / 60);
        expect(positions.count).toBeGreaterThan(quad.count);
        expect(positions.array).not.toEqual(before);
        expect(positions.version).toBeGreaterThan(version);
        expect(quad.array).toEqual(quadBefore);
        expect(positions.array.every(Number.isFinite)).toBe(true);
    });

    it('bounds transient shockwave and strand allocations and disposes displaced effects', () => {
        const theme = createTheme();
        theme.createShockwave({ origin: new THREE.Vector3() });
        theme.createTemporaryStrandSegment({ particleCount: 180, origin: new THREE.Vector3() });
        const wave = theme.shockwaves[0].mesh;
        const strand = theme.tempStrandSegments[0];
        const waveGeometryDispose = vi.spyOn(wave.geometry, 'dispose');
        const waveMaterialDispose = vi.spyOn(wave.material, 'dispose');
        const strandGeometryDispose = vi.spyOn(strand.geometry, 'dispose');
        const strandMaterialDispose = vi.spyOn(strand.material, 'dispose');
        for (let i = 0; i < 24; i++) {
            theme.createShockwave({ origin: new THREE.Vector3() });
            theme.createTemporaryStrandSegment({ particleCount: 180, origin: new THREE.Vector3() });
        }
        expect(theme.shockwaves.length).toBeLessThanOrEqual(12);
        expect(theme.tempStrandSegments.length).toBeLessThanOrEqual(8);
        expect(wave.parent).toBeNull();
        expect(strand.parent).toBeNull();
        for (const dispose of [waveGeometryDispose, waveMaterialDispose, strandGeometryDispose, strandMaterialDispose]) {
            expect(dispose).toHaveBeenCalledOnce();
        }
        finiteGeometry(theme.scene);
    });

    it.each(['hidden', 'paced'])('quiesces compute, effects and rendering while the frame is %s', (reason) => {
        const theme = createTheme();
        document.hidden = reason === 'hidden';
        vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(reason !== 'paced');
        const clock = vi.spyOn(theme.clock, 'reset');
        const dust = vi.spyOn(theme, 'updateDust');
        const render = vi.spyOn(theme, 'renderFrame');
        theme.registerDeferredTimeout(vi.fn(), 0);
        theme.animate();
        expect(clock).toHaveBeenCalledTimes(reason === 'hidden' ? 1 : 0);
        expect(theme.time).toBe(0);
        expect(theme.deferredTimeouts.size).toBe(1);
        expect(dust).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('preserves elapsed time across FPS-paced skips so thirty-FPS animation keeps its intended speed', () => {
        let timestamp = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => timestamp);
        const theme = createTheme();
        vi.spyOn(theme, 'shouldRenderFrame').mockReturnValueOnce(false).mockReturnValueOnce(true);
        vi.spyOn(theme, 'renderFrame').mockImplementation(() => {});
        theme.clock.reset();
        timestamp = 1000 / 60;
        theme.animate();
        expect(theme.time).toBe(0);
        timestamp = 1000 / 30;
        theme.animate();
        expect(theme.time).toBeCloseTo(1 / 30, 8);
    });

    it.each(['generation', 'renderer'])('cannot reveal an obsolete scene after %s changes during precompile', async (changedOwner) => {
        const theme = createTheme();
        const container = { innerHTML: '', style: {} };
        const gate = deferred();
        const entered = deferred();
        for (const name of [
            'disposeRuntimeResources', 'createDustSystem', 'createBurstSystem', 'createWispSystem',
            'createStrands', 'createVolumetricBeams', 'createBackgroundEnvelope', 'setupPostProcessing',
            'ensureMrtMaterials', 'configureRendererColorPipeline', 'registerDebugApi',
            'setupResizeHandler', 'setupEventListeners',
        ]) vi.spyOn(theme, name).mockImplementation(() => {});
        vi.spyOn(theme, 'ensureThemeContainer').mockReturnValue(container);
        vi.spyOn(theme, 'initRenderer').mockResolvedValue(true);
        vi.spyOn(theme, 'precompileSceneWithTimeout').mockImplementation(() => {
            entered.resolve();
            return gate.promise;
        });
        const start = vi.spyOn(theme, 'startAnimation').mockImplementation(() => {});
        const creating = theme.createScene(theme.lifecycleGeneration);
        await entered.promise;
        if (changedOwner === 'generation') theme.lifecycleGeneration += 1;
        else theme.renderer = { isWebGPURenderer: true };
        gate.resolve();
        await creating;
        expect(start).not.toHaveBeenCalled();
        expect(container.style.opacity).toBeUndefined();
    });

    it.each(['ready', 'failed'])('warms hidden pools through the shipped render and restores them after %s', async (outcome) => {
        const theme = createTheme('Low');
        theme.createCpuBurstPools(1, 24);
        const pool = theme.burstPools[0];
        const originalCulling = pool.frustumCulled;
        const compileAsync = vi.fn();
        const gpuFence = vi.fn().mockResolvedValue(undefined);
        theme.renderer = { compileAsync, backend: { device: { queue: { onSubmittedWorkDone: gpuFence } } } };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const render = vi.spyOn(theme, 'renderFrame').mockImplementation(() => {
            expect(pool.visible).toBe(true);
            expect(pool.frustumCulled).toBe(false);
            if (outcome === 'failed') throw new Error('post render rejected');
        });
        await expect(theme.precompileSceneWithTimeout()).resolves.toBeUndefined();
        expect(render).toHaveBeenCalledOnce();
        expect(compileAsync).not.toHaveBeenCalled();
        expect(pool.visible).toBe(false);
        expect(pool.frustumCulled).toBe(originalCulling);
        expect(theme.compileStats.status).toBe(outcome === 'ready' ? 'success' : 'fallback');
        expect(gpuFence).toHaveBeenCalledTimes(outcome === 'ready' ? 1 : 0);
    });
});

describe('Chiral Gold sculpture continuity', () => {
    it.each(Object.keys(CHIRAL_GOLD_SCULPTURE_TIERS))('retains both sculptures with finite geometry on %s', (quality) => {
        const scene = new THREE.Scene();
        const sculpture = createChiralGoldSculpture({ scene, quality, random: () => 0.5 });
        resources.push(() => sculpture.dispose());
        expect(sculpture.stats.ribbonCount).toBeGreaterThanOrEqual(4);
        expect(sculpture.root.children.filter((child) => child.isGroup)).toHaveLength(2);
        for (const [width, height] of [[1600, 900], [390, 844], [844, 390]]) {
            sculpture.resize(width, height);
            sculpture.update(18, 1 / 60, { pulse: 0.8, energy: 0.6, beat: 1 });
            const camera = new THREE.PerspectiveCamera(64, width / height, 0.1, 50000);
            camera.position.set(0, 0, 1520);
            camera.updateMatrixWorld();
            for (const group of sculpture.root.children.filter((child) => child.isGroup)) {
                const projected = group.getWorldPosition(new THREE.Vector3()).project(camera);
                expect(Math.abs(projected.x)).toBeGreaterThan(0.45);
                expect(Math.abs(projected.x)).toBeLessThan(0.9);
            }
            finiteGeometry(sculpture.root);
        }
    });

    it('reuses a bounded halo pool during event spam and fully fades those halos', () => {
        const scene = new THREE.Scene();
        const sculpture = createChiralGoldSculpture({ scene, quality: 'Low', random: () => 0.5 });
        resources.push(() => sculpture.dispose());
        const objects = [];
        sculpture.root.traverse((object) => objects.push(object));
        const geometries = objects.map((object) => object.geometry).filter(Boolean);
        for (let i = 0; i < 100; i++) {
            sculpture.trigger(i % 4 ? 'lock' : 'tetris', 2, { x: -200, y: 80 });
            sculpture.update(i / 60, 1 / 60);
        }
        const after = [];
        sculpture.root.traverse((object) => after.push(object));
        expect(after).toEqual(objects);
        expect(after.map((object) => object.geometry).filter(Boolean)).toEqual(geometries);
        const halos = objects.filter((object) => object.name === 'ChiralGold / pooled event corona');
        expect(halos).toHaveLength(sculpture.stats.haloPoolSize);
        expect(halos.some((object) => object.visible)).toBe(true);
        for (let i = 0; i < 180; i++) sculpture.update(2 + i / 60, 1 / 60);
        expect(halos.every((object) => !object.visible && object.material.opacityNode.value === 0)).toBe(true);
    });

    it('resets active reactions for reproducible seeking without reallocating the pool', () => {
        const scene = new THREE.Scene();
        const sculpture = createChiralGoldSculpture({ scene, quality: 'Minimal' });
        resources.push(() => sculpture.dispose());
        const objects = [];
        sculpture.root.traverse((object) => objects.push(object));
        const halos = objects.filter((object) => object.name === 'ChiralGold / pooled event corona');
        sculpture.trigger('tetris', 2);
        sculpture.update(3, 1 / 60);
        expect(halos.every((halo) => halo.visible && halo.material.opacityNode.value > 0)).toBe(true);
        sculpture.resetReactions();
        expect(halos.every((halo) => !halo.visible && halo.material.opacityNode.value === 0)).toBe(true);
        sculpture.trigger('lock');
        sculpture.update(4, 1 / 60);
        expect(halos.filter((halo) => halo.visible)).toHaveLength(1);
        const after = [];
        sculpture.root.traverse((object) => after.push(object));
        expect(after).toEqual(objects);
    });

    it('releases shared geometry and materials exactly once and stops accepting updates after disposal', () => {
        const scene = new THREE.Scene();
        const sculpture = createChiralGoldSculpture({ scene, quality: 'Minimal' });
        const geometries = new Set();
        const materials = new Set();
        sculpture.root.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        const spies = [...geometries, ...materials].map((resource) => vi.spyOn(resource, 'dispose'));
        sculpture.dispose();
        sculpture.dispose();
        sculpture.trigger('combo', 2);
        sculpture.resize(390, 844);
        sculpture.update(10, 1 / 60);
        expect(sculpture.root.parent).toBeNull();
        expect(sculpture.root.children).toHaveLength(0);
        for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    });
});
