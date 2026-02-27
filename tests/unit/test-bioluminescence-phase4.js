import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const computePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-compute.js');
const materialsPath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-materials.js');
const themePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-theme.js');
const planPath = path.join(root, 'docs', 'BIOLUMINESCENCE_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'BIOLUMINESCENCE_ART_DIRECTION.md');

const computeSource = fs.readFileSync(computePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');

describe('Bioluminescence Phase 4: GPU Compute Particles and Mycelium', () => {
    it('defines alignment-safe particle buffer contract and quality budgets', () => {
        assert(computeSource.includes('export const BIOLUMINESCENCE_PARTICLE_LAYOUT'), 'Missing Phase 4 particle layout contract');
        assert(computeSource.includes('strideBytes: 64'), 'Missing 64-byte stride contract');
        assert(computeSource.includes('offsetBytes: 48'), 'Missing misc vec4 alignment offset');
        assert(computeSource.includes('export const BIOLUMINESCENCE_COMPUTE_BUDGETS'), 'Missing compute quality budgets');
        assert(computeSource.includes('sporeCount: 1000'), 'Missing High-tier spore compute target');
        assert(computeSource.includes('sporeCount: 3000'), 'Missing Extreme-tier spore compute target');
        assert(computeSource.includes('fireflyCount: 200'), 'Missing Extreme-tier firefly compute target');
    });

    it('implements Spore/Firefly/Mycelium compute classes with ping-pong dispatch flow', () => {
        assert(computeSource.includes('export class SporeCompute'), 'Missing SporeCompute class');
        assert(computeSource.includes('export class FireflyCompute'), 'Missing FireflyCompute class');
        assert(computeSource.includes('export class MyceliumPulseCompute'), 'Missing MyceliumPulseCompute class');
        assert(computeSource.includes('createComputeNode()'), 'Missing compute node builder');
        assert(computeSource.includes('dispatch(renderer, time)'), 'Missing compute dispatch API');
        assert(computeSource.includes('getDisplayBufferIndexUniform()'), 'Missing ping-pong display index uniform accessor');
        assert(computeSource.includes('queueBurst(params = {})'), 'Missing particle burst reaction API');
        assert(computeSource.includes('queuePulse(params = {})'), 'Missing mycelium pulse reaction API');
    });

    it('uses storage-buffer vertex pulling for WebGPU compute material paths', () => {
        assert(materialsSource.includes('sporeCompute.getPositionBuffers()'), 'Spore material should read ping-pong position buffers');
        assert(materialsSource.includes('fireflyCompute.getPositionBuffers()'), 'Firefly material should read ping-pong position buffers');
        assert(materialsSource.includes("storage(positionBuffers[0], 'vec4', sporeCompute.count)"), 'Spore storage lookup missing');
        assert(materialsSource.includes("storage(positionBuffers[0], 'vec4', fireflyCompute.count)"), 'Firefly storage lookup missing');
        assert(materialsSource.includes('myceliumCompute.getStateBuffers()'), 'Mycelium material should read compute state buffers');
        assert(materialsSource.includes('instanceIndex'), 'Compute material path should use instanceIndex-driven vertex pulling');
        assert(materialsSource.includes("primitive: 'billboard-quad'"), 'Compute particles should render as billboards on WebGPU');
    });

    it('wires theme lifecycle to setup, update, and dispose compute systems with runtime fallback', () => {
        assert(themeSource.includes('setupComputeSystems()'), 'Theme missing compute setup method');
        assert(themeSource.includes('disposeComputeSystems()'), 'Theme missing compute dispose method');
        assert(themeSource.includes('updateComputeSystems(delta)'), 'Theme missing per-frame compute update method');
        assert(themeSource.includes('handleComputeRuntimeFailure(stage, error)'), 'Theme missing runtime compute failure handler');
        assert(themeSource.includes('rebuildParticleVisualsForNoCompute()'), 'Theme should rebuild particle visuals on compute failure');
        assert(themeSource.includes('this.flags.noCompute = true;'), 'Theme should toggle noCompute when runtime compute fails');
        assert(themeSource.includes('this.setupComputeSystems();'), 'Scene creation should initialize compute systems');
        assert(themeSource.includes('this.createFireflySystem();'), 'Scene creation should include firefly system');
        assert(themeSource.includes('this.createMyceliumPulseSystem();'), 'Scene creation should include mycelium compute visuals');
        assert(themeSource.includes('this.disposeComputeSystems();'), 'Runtime disposal should release compute resources');

        const setupIndex = themeSource.lastIndexOf('this.setupComputeSystems();');
        const sporeIndex = themeSource.lastIndexOf('this.createSporeSystem();');
        const fireflyIndex = themeSource.lastIndexOf('this.createFireflySystem();');
        const myceliumIndex = themeSource.lastIndexOf('this.createMyceliumPulseSystem();');
        assert(setupIndex >= 0 && sporeIndex >= 0, 'Scene build order missing setup or spore creation');
        assert(setupIndex < sporeIndex, 'Compute setup should happen before spore visual creation');
        assert(sporeIndex < fireflyIndex, 'Spore system should initialize before fireflies');
        assert(fireflyIndex < myceliumIndex, 'Firefly system should initialize before mycelium visual pass');
    });

    it('routes gameplay events into compute bursts and mycelium pulse triggers', () => {
        assert(themeSource.includes('this.queueSporeBurst('), 'Missing compute spore event reaction');
        assert(themeSource.includes('this.queueFireflyBurst('), 'Missing compute firefly event reaction');
        assert(themeSource.includes('this.queueMyceliumPulse('), 'Missing compute mycelium event reaction');
        assert(themeSource.includes('handleLineClear(eventPayload)'), 'Theme missing line-clear event handler');
        assert(themeSource.includes('handleCombo(eventPayload)'), 'Theme missing combo event handler');
    });

    it('matches plan/art-direction requirements for phase 4 scope and counts', () => {
        assert(planSource.includes('### Phase 4: GPU Compute Particle Systems & Mycelium (High)'), 'Plan missing Phase 4 section');
        assert(planSource.includes('Stride: 64 bytes per particle'), 'Plan missing explicit 64-byte particle stride');
        assert(planSource.includes('WebGPU:** Spore/firefly visuals use instanced billboards'), 'Plan missing billboard requirement');
        assert(planSource.includes('?bioluminescenceNoCompute=1'), 'Plan missing noCompute fallback flag requirement');
        assert(artSource.includes('High: 1000 spores + 100 fireflies + 1000 dust motes'), 'Art direction missing High particle target');
        assert(artSource.includes('Extreme: 3000 spores + 200 fireflies + 2000 dust motes'), 'Art direction missing Extreme particle target');
        assert(artSource.includes('WebGL fallback: 200 spores (THREE.Points)'), 'Art direction missing WebGL fallback particle target');
    });
});
