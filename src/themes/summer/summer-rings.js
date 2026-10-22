/**
 * Summer — rings on the water and gusts through the grass.
 *
 * A fixed pool of expanding rings, each a position, an age and a strength that a shader
 * reads as one vec4. The lake uses one pool for the rings a locking piece leaves on it; the
 * meadow uses another for the gusts that spread through the grass from the foot of the
 * board. Pure data: the game adds rings, time ages them, and nothing is allocated while it
 * runs.
 */
import * as THREE from 'three/webgpu';

export class SummerRings {
    /**
     * @param {number} count slots
     * @param {number} life seconds a ring lasts
     * @param {number} fade how fast its shader fades it (amplitude × exp(-fade · age)): the lake's
     *   rings 0.42, the meadow's gusts 0.55
     * @param {number} spread how much thinner it runs as it widens (÷ (1 + spread · age))
     */
    constructor(count = 8, life = 9, fade = 0.42, spread = 0) {
        this.count = Math.max(1, Math.floor(count));
        this.life = life;
        this.fade = Number.isFinite(fade) && fade >= 0 ? fade : 0.42;
        this.spread = Number.isFinite(spread) && spread >= 0 ? spread : 0;
        this.rings = Array.from({ length: this.count }, () => new THREE.Vector4(0, 0, 0, 0));
        this.cursor = 0;
    }

    /** What is left of a ring as its shader draws it: its strength, fading as it ages. */
    energy(ring) {
        if (!(ring.w > 0)) return 0;
        return (ring.w * Math.exp(-this.fade * ring.z)) / (1 + this.spread * ring.z);
    }

    reset() {
        this.rings.forEach((ring) => ring.set(0, 0, 0, 0));
        this.cursor = 0;
    }

    /**
     * Start a ring at a point in a free slot, else in place of the ring with the least left of
     * it, so a broad clear ring still spreading is never cut for a petal's touch. A new ring
     * weaker than every ring still spreading is the one let go (returns null).
     */
    add(x, z, strength = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !(strength > 0)) return null;
        let selected = -1;
        let weakest = Infinity;
        for (let step = 0; step < this.count; step += 1) {
            const index = (this.cursor + step) % this.count;
            const ring = this.rings[index];
            if (ring.w <= 0) {
                selected = index;
                weakest = 0;
                break;
            }
            const energy = this.energy(ring);
            if (energy < weakest) {
                weakest = energy;
                selected = index;
            }
        }
        const value = Math.min(3, strength);
        if (value < weakest) return null;
        this.cursor = (selected + 1) % this.count;
        return this.rings[selected].set(x, z, 0, value);
    }

    update(dt) {
        if (!(dt > 0)) return;
        for (let i = 0; i < this.count; i += 1) {
            const ring = this.rings[i];
            if (ring.w > 0) {
                ring.z += dt;
                if (ring.z > this.life) ring.set(0, 0, 0, 0);
            }
        }
    }

    active() {
        return this.rings.reduce((total, ring) => total + (ring.w > 0 ? 1 : 0), 0);
    }
}
