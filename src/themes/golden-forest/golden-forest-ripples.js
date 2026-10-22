/**
 * Golden Forest — the rings on the water.
 *
 * A fixed pool of expanding rings, each a position, an age and a strength that the lake's
 * shader reads as one vec4. Pure data: the game adds rings, time ages them, and nothing
 * is allocated while it runs.
 */
import * as THREE from 'three/webgpu';

const RING_LIFE = 9;

/**
 * What is left of a ring as the water shader draws it: its strength, fading as it ages and
 * spreading thinner as it widens (golden-forest-lake.js: exp(-0.42 age) / (1 + 0.09 · 2.6 age)).
 */
export function goldenForestRingEnergy(ring) {
    if (!(ring.w > 0)) return 0;
    return (ring.w * Math.exp(-0.42 * ring.z)) / (1 + 0.234 * ring.z);
}

/** A fixed pool of expanding rings: position, age and strength for the water shader. */
export class GoldenForestRipples {
    constructor(count = 8) {
        this.count = Math.max(1, Math.floor(count));
        this.rings = Array.from({ length: this.count }, () => new THREE.Vector4(0, 0, 0, 0));
        this.cursor = 0;
    }

    reset() {
        this.rings.forEach((ring) => ring.set(0, 0, 0, 0));
        this.cursor = 0;
    }

    /**
     * Start a ring at a point on the water in a free slot, else in place of the ring with the
     * least left of it, so a broad clear ring still spreading is never cut for a spark's touch.
     * A new ring weaker than every ring on the water is the one let go (returns null).
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
            const energy = goldenForestRingEnergy(ring);
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
                if (ring.z > RING_LIFE) ring.set(0, 0, 0, 0);
            }
        }
    }

    active() {
        return this.rings.reduce((total, ring) => total + (ring.w > 0 ? 1 : 0), 0);
    }
}
