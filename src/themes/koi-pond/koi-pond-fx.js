/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — spray.
 *
 * A small ballistic simulation on the CPU (so it is the same on both backends and in a replay):
 * the pebble of light a locking piece throws into the pond, the drops flung up where it lands,
 * by a koi leaving the water and by its return. Each is drawn as a streak along its own flight.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraViewMatrix, exp, float, length, max, positionGeometry, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { TAU, mulberry32 } from './koi-pond-core.js';

// ── Spray ───────────────────────────────────────────────────────────────────────────────────

export const DROP_GRAVITY = 7.2;
const DROP_STRIDE = 12;

export class Spray {
    /**
     * @param {PondLight} light
     * @param {number} count   drops in the pool
     */
    constructor(light, count, seed = 771) {
        this.count = Math.max(8, count);
        this.rand = mulberry32(seed);
        this.seed = seed;
        const n = this.count;
        this.px = new Float32Array(n);
        this.py = new Float32Array(n);
        this.pz = new Float32Array(n);
        this.vx = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.vz = new Float32Array(n);
        this.age = new Float32Array(n).fill(1e3);
        this.life = new Float32Array(n).fill(1);
        this.size = new Float32Array(n);
        this.tint = new Float32Array(n * 3);
        this.cursor = 0;
        this.alive = 0;

        const quad = new THREE.PlaneGeometry(1, 1);
        this.quad = quad;
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setIndex(quad.getIndex());
        geometry.setAttribute('position', quad.getAttribute('position'));
        geometry.setAttribute('uv', quad.getAttribute('uv'));
        this.data = new Float32Array(n * DROP_STRIDE);
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, DROP_STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aDrop', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
        geometry.setAttribute('aDropVel', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
        geometry.setAttribute('aDropTint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
        geometry.instanceCount = n;
        this.geometry = geometry;
        const aDrop = attribute('aDrop', 'vec4');
        const aVel = attribute('aDropVel', 'vec4');
        const aTint = attribute('aDropTint', 'vec4');

        const material = new THREE.MeshBasicNodeMaterial({
            fog: false,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
            // The streak's axes turn with the drop's flight, so its winding does too: a
            // single-sided quad would be culled for half of all directions.
            side: THREE.DoubleSide,
        });
        material.name = 'Koi Pond — spray';
        material.positionNode = Fn(() => {
            // A streak along the drop's flight as the eye sees it.
            const viewVel = cameraViewMatrix.mul(vec4(aVel.xyz, 0.0)).xyz;
            const speed = length(viewVel.xy);
            const along = viewVel.xy.div(max(speed, 1e-3));
            const across = vec2(along.y.negate(), along.x);
            const stretch = float(1.0).add(speed.mul(0.24));
            const local = along.mul(positionGeometry.y.mul(aDrop.w).mul(stretch)).add(across.mul(positionGeometry.x.mul(aDrop.w)));
            const right = vec3(cameraViewMatrix[0].x, cameraViewMatrix[1].x, cameraViewMatrix[2].x);
            const up = vec3(cameraViewMatrix[0].y, cameraViewMatrix[1].y, cameraViewMatrix[2].y);
            return aDrop.xyz.add(right.mul(local.x)).add(up.mul(local.y));
        })();
        material.outputNode = Fn(() => {
            const p = uv().sub(0.5).mul(2.0);
            const d = length(p);
            const bead = exp(d.mul(d).mul(-5.5)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
            return vec4(aTint.rgb.mul(bead.mul(aVel.w)).mul(light.u.breath), 0.0);
        })();
        this.material = material;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = 'Koi Pond — spray';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9;
        this.mesh.castShadow = false;
    }

    reset() {
        this.rand = mulberry32(this.seed);
        [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.size, this.tint].forEach((a) => a.fill(0));
        this.age.fill(1e3);
        this.life.fill(1);
        this.cursor = 0;
        this.alive = 0;
        this.data.fill(0);
        this.buffer.needsUpdate = true;
    }

    /**
     * Throw `n` drops from (x, z).
     * @param {object} o
     * @param {number[]} [o.out]   outward speed range (m/s)
     * @param {number[]} [o.up]    upward speed range (m/s)
     * @param {number} [o.dirX]    a direction the spray leans toward (with o.dirZ)
     * @param {number} [o.lean]    0 = a full crown, 1 = thrown along the direction
     * @param {number} [o.fan]     with lean 1: radians the throw may stray either side
     * @param {number[]} [o.rgb]
     */
    emit({
        x, z, y = 0.03, n = 12, out = [0.4, 1.6], up = [1.2, 3.2], dirX = 0, dirZ = 0, lean = 0, fan = null, size = 0.035,
        rgb = null, radius = 0.08, life = [0.5, 1.0],
    }) {
        const { rand } = this;
        const heading = Math.atan2(dirZ, dirX);
        const stray = fan !== null ? fan * 2 : TAU * (1 - lean * 0.82);
        for (let k = 0; k < n; k += 1) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % this.count;
            const a = lean > 0 ? heading + (rand() - 0.5) * stray : rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand();
            const r = Math.sqrt(rand()) * radius;
            const ra = rand() * TAU;
            this.px[i] = x + Math.cos(ra) * r;
            this.py[i] = y;
            this.pz[i] = z + Math.sin(ra) * r;
            this.vx[i] = Math.cos(a) * speed;
            this.vy[i] = up[0] + (up[1] - up[0]) * rand() ** 0.7;
            this.vz[i] = Math.sin(a) * speed;
            this.age[i] = 0;
            this.life[i] = life[0] + (life[1] - life[0]) * rand();
            this.size[i] = size * (0.55 + rand() * 0.9);
            this.tint[i * 3] = rgb ? rgb[0] : 0.72;
            this.tint[i * 3 + 1] = rgb ? rgb[1] : 0.86;
            this.tint[i * 3 + 2] = rgb ? rgb[2] : 1.0;
        }
    }

    step(dt) {
        let alive = 0;
        for (let i = 0; i < this.count; i += 1) {
            if (this.age[i] >= this.life[i]) continue;
            this.age[i] += dt;
            this.vy[i] -= DROP_GRAVITY * dt;
            const drag = Math.exp(-dt * 0.6);
            this.vx[i] *= drag;
            this.vz[i] *= drag;
            this.px[i] += this.vx[i] * dt;
            this.py[i] += this.vy[i] * dt;
            this.pz[i] += this.vz[i] * dt;
            // A drop is gone when it meets the water again.
            if (this.py[i] < 0 && this.vy[i] < 0) this.age[i] = this.life[i];
            else alive += 1;
        }
        this.alive = alive;
    }

    commit() {
        const { data } = this;
        for (let i = 0; i < this.count; i += 1) {
            const o = i * DROP_STRIDE;
            const f = this.age[i] / this.life[i];
            if (f >= 1) {
                data[o + 3] = 0;
                data[o + 7] = 0;
                continue;
            }
            data[o] = this.px[i];
            data[o + 1] = this.py[i];
            data[o + 2] = this.pz[i];
            data[o + 3] = this.size[i];
            data[o + 4] = this.vx[i];
            data[o + 5] = this.vy[i];
            data[o + 6] = this.vz[i];
            data[o + 7] = Math.min(1, f * 12) * (1 - f * f) * 3.2;
            data[o + 8] = this.tint[i * 3];
            data[o + 9] = this.tint[i * 3 + 1];
            data[o + 10] = this.tint[i * 3 + 2];
        }
        this.buffer.needsUpdate = true;
    }

    dispose() {
        this.quad.dispose();
    }
}
