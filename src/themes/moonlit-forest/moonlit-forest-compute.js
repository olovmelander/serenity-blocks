import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cos,
    float,
    fract,
    instanceIndex,
    sin,
    storage,
    uniform,
} from 'three/tsl';

/**
 * WebGPU compute simulation for Moonlit ambient fireflies.
 *
 * Dense ambient swarms are simulated on GPU when WebGPU compute is available.
 * Other burst-oriented particles continue using the existing CPU sprite pools.
 */
export class MoonlitAmbientFireflyCompute {
    constructor(count, bounds = {}, randomFn = Math.random) {
        this.count = count;
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;
        this.bounds = {
            xSpan: bounds.xSpan ?? 920,
            yMin: bounds.yMin ?? -90,
            yMax: bounds.yMax ?? 220,
            zMin: bounds.zMin ?? -1120,
            zMax: bounds.zMax ?? -360,
        };

        this.positionData = new Float32Array(count * 4);
        this.miscData = new Float32Array(count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFlowStrength = uniform(1.0);
        this.uPulse = uniform(0);

        this.computeNode = null;
    }

    setInitialState(positions, randoms, twinkles, sizeSeeds) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 0;

            this.miscData[i4] = randoms[i]; // phase seed
            this.miscData[i4 + 1] = twinkles[i]; // movement speed seed
            this.miscData[i4 + 2] = sizeSeeds[i]; // size seed
            this.miscData[i4 + 3] = this.random(); // extra seed
        }

        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const xSpan = float(this.bounds.xSpan);
        const yMin = float(this.bounds.yMin);
        const yMax = float(this.bounds.yMax);
        const zMin = float(this.bounds.zMin);
        const zMax = float(this.bounds.zMax);
        const zSpan = zMax.sub(zMin);

        const delta = this.uDelta;
        const time = this.uTime;
        const flow = this.uFlowStrength;
        const pulse = this.uPulse;

        const computeFireflies = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const phaseSeed = misc.x;
            const speedSeed = misc.y;
            const sizeSeed = misc.z;
            const extraSeed = misc.w;

            const driftX = sin(time.mul(speedSeed.mul(0.62).add(0.3)).add(phaseSeed.mul(6.283185)))
                .mul(float(7.5).add(flow.mul(4.5)));
            const driftZ = cos(time.mul(speedSeed.mul(0.44).add(0.25)).add(extraSeed.mul(6.283185)))
                .mul(float(6.2).add(flow.mul(3.2)));
            const hoverY = sin(time.mul(speedSeed.mul(0.96).add(0.4)).add(sizeSeed.mul(6.283185)))
                .mul(float(2.2).add(pulse.mul(1.8)));
            const rise = float(0.42).add(speedSeed.mul(0.34)).add(pulse.mul(0.24));

            pos.x.addAssign(driftX.mul(delta));
            pos.z.addAssign(driftZ.mul(delta));
            pos.y.addAssign(hoverY.mul(delta).add(rise.mul(delta)));

            If(pos.x.greaterThan(xSpan), () => {
                pos.x.assign(xSpan.negate());
            });
            If(pos.x.lessThan(xSpan.negate()), () => {
                pos.x.assign(xSpan);
            });

            If(pos.z.greaterThan(zMax), () => {
                pos.z.assign(pos.z.sub(zSpan));
            });
            If(pos.z.lessThan(zMin), () => {
                pos.z.assign(pos.z.add(zSpan));
            });

            If(pos.y.greaterThan(yMax), () => {
                const seed = float(index).add(time.mul(0.13)).add(phaseSeed.mul(71.0));
                const rx = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                const rz = fract(sin(seed.mul(78.233)).mul(43758.5453));
                pos.y.assign(yMin);
                pos.x.assign(rx.sub(0.5).mul(xSpan.mul(2.0)));
                pos.z.assign(zMin.add(rz.mul(zSpan)));
            });
            If(pos.y.lessThan(yMin), () => {
                pos.y.assign(yMin);
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computeFireflies().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (options.flowStrength !== undefined) {
            this.uFlowStrength.value = options.flowStrength;
        }
        if (options.pulse !== undefined) {
            this.uPulse.value = options.pulse;
        }
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.miscData = null;
    }
}
