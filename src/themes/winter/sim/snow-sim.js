/* eslint-disable import/no-unresolved */
/**
 * Winter — Snow Compute Sim (`SnowSim`)
 *
 * One tier of the AAA falling-snow system (see docs/WINTER_SNOW_MASTERPIECE_PLAN.md).
 * Forked from the StardustSim spine (storage buffers → TSL Fn().compute → billboard
 * InstancedMesh) but the force model is snow, not a fairy-light river:
 *   - gravity (steady downward fall) + divergence-free CURL NOISE turbulence so
 *     flakes swirl in coherent eddies instead of falling on rails,
 *   - a gusting BREEZE whose amplitude breathes over ~20-30s (storm intensity),
 *   - light velocity inertia toward that target (snow at near-terminal velocity).
 * Recycling is a CAMERA-RELATIVE TOROIDAL WRAP: each flake's position is wrapped
 * into a box centred on the live camera (+ a per-tier forward/up offset), so the
 * moving camera is always enveloped with no respawn pops and no visible edge.
 *
 * Storage layout (3 × vec4 × count):
 *   positions:  xyz (world) + sizeRand   (0..1, static per-flake size jitter)
 *   velocities: xyz (vel)   + brightRand (0..1, static per-flake brightness jitter)
 *   spins:      angle (integrated) + rate + twinklePhase + twinkleFreq
 */
import * as THREE from 'three/webgpu';
import {
    Fn, instanceIndex, storage, uniform, vec3, float, mix, mod, sin,
} from 'three/tsl';
import { curlNoise3 } from '../../starlight/materials/tsl-noise-lib.js';

export class SnowSim {
    constructor(opts = {}) {
        this.count = Math.max(1, Math.floor(opts.count ?? 4000));
        const b = opts.bounds ?? { x: 1500, y: 1000, z: 1100 };
        const off = opts.boxOffset ?? new THREE.Vector3(0, 0, 0);
        const camStart = opts.camStart ?? new THREE.Vector3(0, 78, 760);
        this._fall = opts.fallSpeed ?? 60;
        const spinRate = opts.spinRate ?? 0.6;

        // Shared (passed in) or own camera-position uniform.
        this.uCamPos = opts.camPosUniform ?? uniform(camStart.clone());
        this.uBounds = uniform(new THREE.Vector3(b.x, b.y, b.z));
        this.uBoxOffset = uniform(off.clone());
        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFall = uniform(this._fall);
        this.uCurlFreq = uniform(opts.curlFreq ?? 0.006);
        this.uCurlStr = uniform(opts.curlStr ?? 24);
        this.uBreeze = uniform((opts.breeze ?? new THREE.Vector3(14, 0, 6)).clone());
        this.uGustFreq = uniform(opts.gustFreq ?? 0.22);
        this.uGustAmp = uniform(opts.gustAmp ?? 0.85);
        this.uInertia = uniform(opts.inertia ?? 0.18);

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.spinData = new Float32Array(this.count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.spinBuffer = new THREE.StorageBufferAttribute(this.spinData, 4);

        this.computeNode = null;
        this._init(b, off, camStart, spinRate);
    }

    _init(b, off, cam, spinRate) {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = cam.x + off.x + (Math.random() * 2 - 1) * b.x;
            this.positionData[i4 + 1] = cam.y + off.y + (Math.random() * 2 - 1) * b.y;
            this.positionData[i4 + 2] = cam.z + off.z + (Math.random() * 2 - 1) * b.z;
            this.positionData[i4 + 3] = Math.random(); // sizeRand

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = -this._fall;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = Math.random(); // brightRand

            this.spinData[i4] = Math.random() * Math.PI * 2; // angle
            this.spinData[i4 + 1] = (Math.random() * 2 - 1) * spinRate; // rate
            this.spinData[i4 + 2] = Math.random() * Math.PI * 2; // twinkle phase
            this.spinData[i4 + 3] = 0.4 + Math.random() * 1.6; // twinkle freq
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.spinBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const spins = storage(this.spinBuffer, 'vec4', this.count);
        const {
            uDelta, uTime, uFall, uCurlFreq, uCurlStr, uBreeze, uGustFreq, uGustAmp,
            uInertia, uBounds, uBoxOffset, uCamPos,
        } = this;

        this.computeNode = Fn(() => {
            const i = instanceIndex;
            const pos = positions.element(i).toVar();
            const vel = velocities.element(i).toVar();
            const spin = spins.element(i).toVar();
            const pXYZ = pos.xyz.toVar();
            const vXYZ = vel.xyz.toVar();

            // Gust envelope (storm-intensity breathing), 0.45 .. 0.45+gustAmp.
            const gust = uGustAmp.mul(sin(uTime.mul(uGustFreq)).mul(0.5).add(0.5)).add(0.45);
            // Divergence-free curl turbulence (coherent swirl, never clumps).
            const curl = curlNoise3(pXYZ.mul(uCurlFreq), uTime).mul(uCurlStr);
            // Target velocity = gusting breeze (x/z) + gravity (down) + curl.
            const target = vec3(uBreeze.x.mul(gust), uFall.negate(), uBreeze.z.mul(gust)).add(curl);
            vXYZ.assign(mix(vXYZ, target, uInertia));
            pXYZ.addAssign(vXYZ.mul(uDelta));

            // Camera-relative toroidal wrap: keep the flake inside a box centred on
            // the live camera (+offset) so the moving eye is always enveloped.
            const center = uCamPos.add(uBoxOffset);
            const rel = pXYZ.sub(center);
            const wrapped = mod(rel.add(uBounds), uBounds.mul(2.0)).sub(uBounds);
            pXYZ.assign(center.add(wrapped));

            // Tumble.
            spin.x.addAssign(spin.y.mul(uDelta));

            pos.x.assign(pXYZ.x);
            pos.y.assign(pXYZ.y);
            pos.z.assign(pXYZ.z);
            vel.x.assign(vXYZ.x);
            vel.y.assign(vXYZ.y);
            vel.z.assign(vXYZ.z);
            positions.element(i).assign(pos);
            velocities.element(i).assign(vel);
            spins.element(i).assign(spin);
        })().compute(this.count);

        return this.computeNode;
    }

    update(delta, time) {
        this.uDelta.value = Math.min(delta, 0.033);
        this.uTime.value = time;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.spinBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.spinData = null;
    }
}
