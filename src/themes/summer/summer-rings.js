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

    /** Start a ring at a point; replaces a free slot or the oldest ring. */
    add(x, z, strength = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !(strength > 0)) return null;
        let selected = -1;
        let oldest = -1;
        for (let step = 0; step < this.count; step += 1) {
            const index = (this.cursor + step) % this.count;
            const ring = this.rings[index];
            if (ring.w <= 0) {
                selected = index;
                break;
            }
            if (ring.z > oldest) {
                oldest = ring.z;
                selected = index;
            }
        }
        this.cursor = (selected + 1) % this.count;
        return this.rings[selected].set(x, z, 0, Math.min(3, strength));
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
