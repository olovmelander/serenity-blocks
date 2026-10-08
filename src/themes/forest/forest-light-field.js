/**
 * Forest — the light the fireflies shed.
 *
 * A small top-down map of the glade. Every frame each lit firefly near the floor adds a soft
 * pool of light to it, and the moss, ferns, trunks and mist read it back, so a flashing
 * firefly really does light the fern it passes. Gathering is plain typed-array work: the
 * same on both backends, in the playground's deterministic `seek`, and in the unit tests.
 */
export const FOREST_LIGHT_FIELD_BOUNDS = Object.freeze({
    minX: -42, maxX: 42, minZ: -70, maxZ: 14,
});
const KERNEL_RADIUS = 2;
const KERNEL_SIDE = KERNEL_RADIUS * 2 + 1;
// A firefly higher than this sheds nothing worth gathering on the floor.
const CEILING = 6;

export class ForestLightField {
    constructor(size = 96, bounds = FOREST_LIGHT_FIELD_BOUNDS) {
        this.size = Math.max(8, Math.floor(size));
        this.bounds = bounds;
        this.sum = new Float32Array(this.size * this.size);
        this.data = new Uint8Array(this.size * this.size);
        this.scaleX = (this.size - 1) / (bounds.maxX - bounds.minX);
        this.scaleZ = (this.size - 1) / (bounds.maxZ - bounds.minZ);
        this.kernel = new Float32Array(KERNEL_SIDE * KERNEL_SIDE);
        for (let row = 0; row < KERNEL_SIDE; row += 1) {
            for (let column = 0; column < KERNEL_SIDE; column += 1) {
                const distance = Math.hypot(column - KERNEL_RADIUS, row - KERNEL_RADIUS) / (KERNEL_RADIUS + 0.5);
                this.kernel[row * KERNEL_SIDE + column] = Math.max(0, 1 - distance * distance) ** 2;
            }
        }
        this.dirty = true;
    }

    clear() {
        this.sum.fill(0);
        this.dirty = true;
    }

    /** Add one firefly's pool of light: `height` above the floor, `light` its brightness. */
    add(x, z, height, light) {
        if (!(light > 0.004) || !(height < CEILING)) return;
        const fx = (x - this.bounds.minX) * this.scaleX;
        const fz = (z - this.bounds.minZ) * this.scaleZ;
        const column = Math.round(fx);
        const row = Math.round(fz);
        // Keep a margin, so nothing is ever written to the edge the sampler clamps to.
        if (column < KERNEL_RADIUS + 1 || row < KERNEL_RADIUS + 1
            || column > this.size - KERNEL_RADIUS - 2 || row > this.size - KERNEL_RADIUS - 2) return;
        const lift = Math.max(0, height);
        const reach = light / (1 + lift * lift * 0.5);
        const { sum, size, kernel } = this;
        for (let r = 0; r < KERNEL_SIDE; r += 1) {
            const offset = (row + r - KERNEL_RADIUS) * size + column - KERNEL_RADIUS;
            for (let c = 0; c < KERNEL_SIDE; c += 1) sum[offset + c] += kernel[r * KERNEL_SIDE + c] * reach;
        }
    }

    /** Gather a simulation's lit fireflies. `place` is xyz,size; `glow` is brightness,... */
    gather(place, glow, count, groundHeight) {
        this.sum.fill(0);
        for (let i = 0; i < count; i += 1) {
            const light = glow[i * 4];
            if (light > 0.02) {
                const x = place[i * 4];
                const z = place[i * 4 + 2];
                this.add(x, z, place[i * 4 + 1] - groundHeight(x, z), light);
            }
        }
        return this.commit();
    }

    /** Pack the gathered light into bytes with a soft shoulder, so a swarm cannot clip. */
    commit() {
        const { sum, data } = this;
        for (let i = 0; i < sum.length; i += 1) {
            const value = sum[i];
            data[i] = value <= 0 ? 0 : Math.min(255, Math.round((1 - Math.exp(-value * 0.9)) * 255));
        }
        this.dirty = true;
        return data;
    }
}
