/**
 * Verdant Hills — gusts through the grass.
 *
 * A fixed pool of expanding rings, each a position, an age and a strength that a shader
 * reads as one vec4. The downs use it for the gusts that spread through the grass from the
 * foot of the board. Pure data: the game adds rings, time ages them, and nothing is
 * allocated while it runs.
 */
import * as THREE from 'three/webgpu';

/** The strongest a gust can be. */
const RING_CEILING = 3;
/** A ring this young and this close (metres) takes a new one into itself when the pool is full. */
const JOIN_AGE = 0.3;
const JOIN_REACH = 3;

export class VerdantHillsRings {
    constructor(count = 8, life = 9) {
        this.count = Math.max(1, Math.floor(count));
        this.life = life;
        this.rings = Array.from({ length: this.count }, () => new THREE.Vector4(0, 0, 0, 0));
        this.cursor = 0;
    }

    reset() {
        this.rings.forEach((ring) => ring.set(0, 0, 0, 0));
        this.cursor = 0;
    }

    /**
     * Start a ring at a point in a free slot. With every slot spreading, a ring that has only just
     * set out from (nearly) the same place takes the new one into itself (it carries on, stronger);
     * otherwise the ring with the least left to give (its strength as it has faded, the way the
     * grass feels it) makes way, never one in full flood because it happened to start first.
     */
    add(x, z, strength = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !(strength > 0)) return null;
        const asked = Math.min(RING_CEILING, strength);
        let selected = -1;
        let least = Infinity;
        for (let step = 0; step < this.count; step += 1) {
            const index = (this.cursor + step) % this.count;
            const ring = this.rings[index];
            if (ring.w <= 0) {
                selected = index;
                least = -1;
                break;
            }
            const left = ring.w * Math.exp(-0.5 * ring.z);
            if (left < least) {
                least = left;
                selected = index;
            }
        }
        if (least >= 0) {
            for (const ring of this.rings) {
                if (ring.z < JOIN_AGE && Math.hypot(ring.x - x, ring.y - z) < JOIN_REACH) {
                    ring.w = Math.min(RING_CEILING, ring.w + asked * 0.5);
                    return ring;
                }
            }
        }
        this.cursor = (selected + 1) % this.count;
        return this.rings[selected].set(x, z, 0, asked);
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
