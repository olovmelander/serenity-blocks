import { describe, expect, it } from 'vitest';
import { StardustSim, IMPULSE_TYPE } from '../../src/themes/starlight/sim/stardust-particles.js';
import { createStardustRenderer } from '../../src/themes/starlight/rendering/stardust-renderer.js';

function quietSim(count = 2) {
    const sim = new StardustSim(count);
    sim.uFlowStrength.value = 0;
    sim.uBreeze.value.set(0, 0, 0);
    sim.positionData.set([1, 0, 0, 0.3, -1, 1, 0, 0.7]);
    sim.velocityData.set([0, 0, 0, 20, 0, 0, 0, 20]);
    return sim;
}

describe('Starlight WebGL2 stardust', () => {
    it.each([
        [IMPULSE_TYPE.RADIAL, 'x', 1],
        [IMPULSE_TYPE.VORTEX, 'y', 1],
        [IMPULSE_TYPE.ATTRACTOR, 'x', -1],
    ])('preserves the direction of event impulse %s', (type, axis, direction) => {
        const sim = quietSim();
        sim.pushImpulse({ x: 0, y: 0, z: 0 }, 3, { x: 0, y: 0, z: 1 }, type);

        sim.updateCPU(1 / 60, 1);

        const index = { x: 0, y: 1, z: 2 }[axis];
        expect(sim.velocityData[index] * direction).toBeGreaterThan(0);
        expect(sim.positionData[3]).toBeGreaterThan(0.3);
    });

    it('feeds distinct live particles into instanced attributes instead of per-vertex storage fallback', () => {
        const sim = quietSim();
        const dust = createStardustRenderer(sim, { useStorage: false });
        const positions = dust.mesh.geometry.getAttribute('aDustPosition');
        const colors = dust.mesh.geometry.getAttribute('aDustColor');
        const previousVersion = positions.version;
        sim.uBreeze.value.x = 0.05;

        sim.updateCPU(1 / 60, 1);
        dust.update(1);

        expect(positions.isInstancedBufferAttribute).toBe(true);
        expect(colors.isInstancedBufferAttribute).toBe(true);
        expect(positions.array).toBe(sim.positionData);
        expect(colors.array).toBe(sim.colorData);
        expect(positions.getX(0)).not.toBe(positions.getX(1));
        expect(positions.getW(0)).not.toBe(positions.getW(1));
        expect(positions.getX(0)).toBeGreaterThan(1);
        expect(positions.version).toBeGreaterThan(previousVersion);
        expect(dust.mesh.count).toBe(sim.count);
        expect(dust.material.isNodeMaterial).toBe(true);
        expect(sim.computeNode).toBeNull();
        dust.dispose();
    });

    it('respawns expired motes within the authored slab and keeps their palette', () => {
        const sim = quietSim();
        sim.positionData[3] = 0.999;
        sim.velocityData[3] = 0.01;
        const palette = [...sim.colorData.slice(0, 3)];

        sim.updateCPU(1, 1);

        expect(sim.positionData[3]).toBe(0);
        expect(Math.abs(sim.positionData[0])).toBeLessThanOrEqual(sim.bounds.width);
        expect(Math.abs(sim.positionData[1])).toBeLessThanOrEqual(sim.bounds.height);
        expect(Math.abs(sim.positionData[2])).toBeLessThanOrEqual(sim.bounds.depth);
        expect([...sim.positionData, ...sim.velocityData, ...sim.colorData].every(Number.isFinite)).toBe(true);
        expect([...sim.colorData.slice(0, 3)]).toEqual(palette);
    });
});
