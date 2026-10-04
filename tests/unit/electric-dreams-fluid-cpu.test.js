import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { FluidParticleSim, IMPULSE_TYPE } from '../../src/themes/electric-dreams-v3/sim/fluid-particles.js';
import {
    createFluidParticlesRenderer,
} from '../../src/themes/electric-dreams-v3/rendering/fluid-particles-renderer.js';

function makeSim(count = 1) {
    const sim = new FluidParticleSim(count, { cpu: true, gravityStrength: 0, turbulence: 0 });
    sim.positionData.fill(0);
    sim.velocityData.fill(0);
    for (let i = 0; i < count; i += 1) sim.velocityData[i * 4 + 3] = 100;
    sim.uDamping.value = 1;
    return sim;
}

describe('Electric Dreams fluid on WebGL2', () => {
    it('renders distinct instances without storage reads or a compute dispatch', () => {
        const sim = makeSim(8);
        const visual = createFluidParticlesRenderer(sim);
        expect(sim.createComputeNode()).toBeNull();
        expect(sim.positionBuffer.isInstancedBufferAttribute).toBe(true);
        expect(sim.colorBuffer.isInstancedBufferAttribute).toBe(true);
        expect(visual.mesh.geometry.getAttribute('aFluidPosition')).toBe(sim.positionBuffer);
        expect(visual.mesh.geometry.getAttribute('aFluidColor')).toBe(sim.colorBuffer);
        expect(visual.mesh.count).toBe(8);
        visual.dispose();
        sim.dispose();
    });

    it.each([
        [IMPULSE_TYPE.RADIAL, 'x', 1],
        [IMPULSE_TYPE.ATTRACTOR, 'x', -1],
        [IMPULSE_TYPE.VORTEX, 'y', 1],
    ])('preserves impulse type %s direction', (type, axis, sign) => {
        const sim = makeSim();
        sim.positionData[0] = 1;
        sim.pushImpulse(new Vector3(), 5, new Vector3(0, 0, 1), type);
        sim.update(0.016, 1);
        sim.stepCPU();
        const velocity = sim.velocityData[axis === 'x' ? 0 : 1];
        expect(velocity * sign).toBeGreaterThan(0);
        expect(sim.positionBuffer.version).toBeGreaterThan(0);
        sim.dispose();
    });

    it('converges toward authored shape targets while keeping every particle finite', () => {
        const sim = makeSim(64);
        sim.setShape('torus');
        sim.setShapeStrength(1);
        sim.uDamping.value = 0.94;
        const distance = () => {
            let sum = 0;
            for (let i = 0; i < sim.count; i += 1) {
                const j = i * 4;
                sum += Math.hypot(
                    sim.targetData[j] - sim.positionData[j],
                    sim.targetData[j + 1] - sim.positionData[j + 1],
                    sim.targetData[j + 2] - sim.positionData[j + 2],
                );
            }
            return sum;
        };
        const initial = distance();
        for (let i = 0; i < 180; i += 1) {
            sim.update(1 / 60, i / 60);
            sim.stepCPU();
        }
        expect(distance()).toBeLessThan(initial * 0.2);
        expect([...sim.positionData, ...sim.velocityData, ...sim.colorData].every(Number.isFinite)).toBe(true);
        sim.dispose();
    });

    it('respawns expired particles and makes zero-delta frames inert', () => {
        const sim = makeSim();
        sim.positionData[3] = 0.999;
        sim.velocityData[3] = 0.1;
        sim.update(10, 2);
        expect(sim.uDelta.value).toBe(0.033);
        sim.stepCPU();
        expect(sim.positionData[3]).toBe(0);
        const saved = [...sim.positionData];
        const { version } = sim.positionBuffer;
        sim.update(0, 2);
        sim.stepCPU();
        expect([...sim.positionData]).toEqual(saved);
        expect(sim.positionBuffer.version).toBe(version);
        sim.dispose();
    });
});
