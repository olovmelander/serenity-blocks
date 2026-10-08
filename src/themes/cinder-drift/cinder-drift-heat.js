/**
 * Cinder Drift — the lake's memory of heat (CPU only, three-free).
 *
 * A square of crust that drifts with the plates. Every lock melts a pool into it, a bomb another
 * where it lands, and the pools cool together: the field stores the heat as it stood at one
 * reference moment, and both the shader and `sample` cool it from there in closed form
 * (heat · e^(−(t − ref)/hold)). Writing a pool re-bases the whole field to the present first, so
 * the texture is uploaded only when gameplay happens.
 *
 * Coordinates are PLATE space: world xz minus how far the crust has drifted. The field wraps.
 */

import {
    HEAT_EXTENT, HEAT_HOLD, HEAT_MAX, HEAT_SIZE,
} from './cinder-drift-core.js';

export class HeatField {
    constructor({ size = HEAT_SIZE, extent = HEAT_EXTENT, hold = HEAT_HOLD } = {}) {
        this.size = size;
        this.extent = extent;
        this.hold = hold;
        this.data = new Float32Array(size * size);
        /** The moment `data` is true for. */
        this.ref = 0;
        /** Bumped on every write: whoever mirrors the field to a texture uploads when it moves. */
        this.version = 0;
    }

    reset(time = 0) {
        this.data.fill(0);
        this.ref = time;
        this.version += 1;
    }

    /** Cool the stored field to `time` and make that the reference moment. */
    rebase(time) {
        if (!(time > this.ref)) return;
        const k = Math.exp(-(time - this.ref) / this.hold);
        const { data } = this;
        for (let i = 0; i < data.length; i++) data[i] *= k;
        this.ref = time;
    }

    /**
     * Melt a pool `radius` metres across at plate-space (px, pz).
     * @returns {number} texels touched
     */
    stamp(px, pz, radius, amount, time) {
        if (!(radius > 0) || !(amount > 0)) return 0;
        this.rebase(time);
        const { size, extent, data } = this;
        const texel = extent / size;
        const cx = px / texel - 0.5;
        const cz = pz / texel - 0.5;
        const reach = Math.ceil((radius * 1.9) / texel);
        const i0 = Math.round(cx);
        const j0 = Math.round(cz);
        let touched = 0;
        for (let dj = -reach; dj <= reach; dj++) {
            for (let di = -reach; di <= reach; di++) {
                const dx = (i0 + di - cx) * texel;
                const dz = (j0 + dj - cz) * texel;
                const w = Math.exp(-(dx * dx + dz * dz) / (radius * radius * 0.7));
                if (w < 0.004) continue;
                const i = (((i0 + di) % size) + size) % size;
                const j = (((j0 + dj) % size) + size) % size;
                const at = j * size + i;
                data[at] = Math.min(HEAT_MAX, data[at] + amount * w);
                touched += 1;
            }
        }
        this.version += 1;
        return touched;
    }

    /** The heat at plate-space (px, pz) at `time` (bilinear, wrapping): the shader's CPU twin. */
    sample(px, pz, time = this.ref) {
        const { size, extent, data } = this;
        const fx = (px / extent) * size - 0.5;
        const fz = (pz / extent) * size - 0.5;
        const x0 = Math.floor(fx);
        const z0 = Math.floor(fz);
        const tx = fx - x0;
        const tz = fz - z0;
        const at = (i, j) => data[((((j % size) + size) % size) * size) + (((i % size) + size) % size)];
        const top = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * tx;
        const bottom = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * tx;
        return (top + (bottom - top) * tz) * Math.exp(-Math.max(0, time - this.ref) / this.hold);
    }

    /** All the heat the field holds at `time` (diagnostics). */
    total(time = this.ref) {
        let sum = 0;
        for (let i = 0; i < this.data.length; i++) sum += this.data[i];
        return sum * Math.exp(-Math.max(0, time - this.ref) / this.hold);
    }
}
