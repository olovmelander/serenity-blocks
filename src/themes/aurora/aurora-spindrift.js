/**
 * Spindrift: the ring of ice dust a hard drop kicks up off the lake.
 *
 * A piece that falls a long way lands on the water: its ring opens there (aurora-landscape.js)
 * and frost and spray are thrown up with it. The dust leaves the landing in every direction,
 * the first of it flung clear of the board at once, the rest riding the ring's front out
 * across the lake, each crystal on a low arc of its own and glinting in the piece's colour
 * as it turns. It reads as a ring of sparks widening over the water, where a plain lock
 * leaves only the ripple.
 *
 * A fixed pool: SPINDRIFT.slots bursts of `spindriftCount` crystals each. A burst is two
 * uniform rows; every crystal's place and glint is a closed form of its seed and the burst's
 * age, computed in the vertex stage. Nothing is allocated after the build.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, dot, exp, float, instancedBufferAttribute, int,
    length, max, mix, positionGeometry, select, sin, smoothstep, uniformArray, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';

export const SPINDRIFT = Object.freeze({
    /** Bursts in flight at once. */
    slots: 4,
    /** Seconds a burst lasts. */
    seconds: 2.6,
    /** World units the first dust is flung in its first moment, at most. */
    fling: 18,
    /** How far behind the ring's front the slowest dust rides (share of the front's run). */
    lag: 0.16,
});

/** Where one crystal of a burst is, `age` seconds in: [radius from the landing, height]. */
export function spindriftAt(seedRadius, seedHeight, age, speed, strength, out = [0, 0]) {
    // Most of the dust keeps to the ring's front (the seed is squared: few lag far behind).
    const behind = seedRadius * seedRadius * SPINDRIFT.lag;
    const flung = (1 - Math.exp(-3.2 * age)) * (0.55 + 0.45 * seedRadius) * SPINDRIFT.fling;
    out[0] = speed * age * (1.04 - behind) + flung;
    const u = Math.min(1, (age / SPINDRIFT.seconds) * (0.8 + 0.7 * seedHeight));
    out[1] = 0.25 + (0.3 + 2.6 * seedHeight * seedHeight) * strength * 4 * u * (1 - u);
    return out;
}

export class AuroraSpindrift {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset (`spindriftCount`: crystals a burst)
     * @param {object} options.uniforms shared world uniforms (time, viewHeight, aspect)
     */
    constructor({ parent, preset, uniforms }) {
        this.disposed = false;
        this.perBurst = Math.max(0, Math.floor(preset.spindriftCount ?? 0));
        this.count = this.perBurst * SPINDRIFT.slots;
        this.mesh = null;
        // x, z, birth time, strength — and the tint with the ring's speed in w.
        this.rows = Array.from({ length: SPINDRIFT.slots }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.tints = Array.from({ length: SPINDRIFT.slots }, () => new THREE.Vector4(1, 1, 1, 26));
        if (this.count === 0) return;
        const u = uniforms;
        // Per crystal: bearing round the ring, how far out it runs, how high it rises, its glint
        // phase; and the burst it belongs to. Hashed from the index, so the pool is the same pool
        // on every machine.
        const seeds = new Float32Array(this.count * 4);
        const slots = new Float32Array(this.count);
        const hash = (n) => {
            const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
            return x - Math.floor(x);
        };
        for (let i = 0; i < this.count; i += 1) {
            seeds[i * 4] = (i % this.perBurst) / this.perBurst + hash(i) / this.perBurst;
            seeds[i * 4 + 1] = hash(i + 0.37);
            seeds[i * 4 + 2] = hash(i + 0.71);
            seeds[i * 4 + 3] = hash(i + 0.13);
            slots[i] = Math.floor(i / this.perBurst);
        }
        const seed = instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 4));
        const slot = instancedBufferAttribute(new THREE.InstancedBufferAttribute(slots, 1));
        const rows = uniformArray(this.rows, 'vec4');
        const tints = uniformArray(this.tints, 'vec4');
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        });
        this.material.name = 'Aurora — spindrift';
        const vColor = varyingProperty('vec3', 'auroraSpindriftColor');
        this.material.vertexNode = Fn(() => {
            const index = int(slot.add(0.5)).toVar();
            const row = rows.element(index).toVar();
            const tint = tints.element(index).toVar();
            const age = u.time.sub(row.z).toVar();
            const k = age.div(SPINDRIFT.seconds).toVar();
            const live = age.greaterThan(0).and(k.lessThan(1)).and(row.w.greaterThan(0.001));
            // Mirrors spindriftAt().
            const flung = exp(age.mul(-3.2)).oneMinus().mul(seed.y.mul(0.45).add(0.55)).mul(SPINDRIFT.fling);
            const radius = tint.w.mul(age).mul(seed.y.mul(seed.y).mul(-SPINDRIFT.lag).add(1.04)).add(flung);
            const arc = k.mul(seed.z.mul(0.7).add(0.8)).min(1).toVar();
            const lift = seed.z.mul(seed.z).mul(2.6).add(0.3).mul(row.w);
            const height = lift.mul(4).mul(arc).mul(arc.oneMinus()).add(0.25);
            const bearing = seed.x.mul(Math.PI * 2);
            const world = vec3(
                row.x.add(cos(bearing).mul(radius)),
                height,
                row.y.add(sin(bearing).mul(radius)),
            ).toVar();
            const distance = max(length(world.sub(cameraPosition)), 1).toVar();
            // A crystal turns a face to the eye now and then: mostly a faint mote, briefly a spark.
            const turn = max(sin(seed.w.mul(40).add(u.time.mul(seed.x.mul(9).add(7)))), 0);
            const t2 = turn.mul(turn);
            const t4 = t2.mul(t2);
            const glint = t4.mul(4.6).add(0.55);
            const fade = smoothstep(0, 0.05, k).mul(k.oneMinus()).mul(k.oneMinus());
            // Far dust is fainter: it thins into the mist over the water.
            const near = exp(distance.mul(-0.0042));
            vColor.assign(mix(tint.rgb, vec3(0.9, 0.95, 1.0), 0.22)
                .mul(glint.mul(fade).mul(near).mul(row.w.min(1.2))));

            const scale = u.viewHeight.div(1080).toVar();
            const drawn = mix(2.0, 3.8, seed.w).mul(max(scale, 1)).mul(float(1).add(float(30).div(distance)));
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)).toVar();
            const size = drawn.div(u.viewHeight).mul(2);
            const offset = positionGeometry.xy.mul(vec2(size.div(u.aspect), size));
            return select(live, vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w), vec4(0, 0, 2, 1));
        })();
        this.material.colorNode = Fn(() => {
            const p = uv().sub(0.5).mul(2);
            const r2 = dot(p, p);
            return vColor.mul(exp(r2.mul(-4.5)).add(exp(r2.mul(-1.3)).mul(0.1)));
        })();
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
        this.mesh.name = 'Aurora — spindrift';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 11;
        parent.add(this.mesh);
    }

    /**
     * Kick a ring of dust up off the lake at world (x, z). `tint` is a linear RGB triple and
     * `speed` the pace of the ring it rides. Takes the burst furthest through its life.
     */
    burst(time, x, z, strength, tint, speed = 26) {
        if (this.disposed || !(strength > 0)) return false;
        let chosen = 0;
        let oldest = Infinity;
        for (let i = 0; i < this.rows.length; i += 1) {
            if (this.rows[i].z < oldest) {
                oldest = this.rows[i].z;
                chosen = i;
            }
        }
        this.rows[chosen].set(x, z, time, Math.min(1.4, strength));
        this.tints[chosen].set(tint[0], tint[1], tint[2], speed);
        return true;
    }

    reset() {
        for (const row of this.rows) row.set(0, 0, -1000, 0);
    }

    getDiagnostics() {
        return { crystals: this.mesh ? this.count : 0, slots: SPINDRIFT.slots };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.mesh?.removeFromParent();
        this.mesh?.dispose();
        this.geometry?.dispose();
        this.material?.dispose();
        this.mesh = null;
    }
}
