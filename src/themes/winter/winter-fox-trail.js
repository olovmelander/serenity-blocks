/**
 * Winter — the way a roaming fox lays as it goes (winter-fox-roam.js). Three-free and
 * renderer-free: plain samples of a line over the ground.
 */

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The fox's way as it lays it: samples (x, z, heading) with the distance run to each. It is only
 * ever laid a little ahead of the fox, and may be cut where the fox stands and laid anew from
 * there — on a heading of its own when the fox stands still and turns.
 */
export class FoxTrail {
    constructor(x = 0, z = 0, h = 0) {
        /** (So the fox mind the themes share can count turns on it: it has none.) */
        this.turns = [];
        this.start(x, z, h, 0);
    }

    /** Begin anew from a place, a distance run already. */
    start(x, z, h, at = 0) {
        this.xs = [x];
        this.zs = [z];
        this.hs = [h];
        this.ds = [at];
    }

    /** The distance run to the end of what is laid. */
    get end() {
        return this.ds[this.ds.length - 1];
    }

    /** Where what is laid ends: (x, z, heading). */
    tip(out = [0, 0, 0]) {
        const i = this.ds.length - 1;
        out[0] = this.xs[i];
        out[1] = this.zs[i];
        out[2] = this.hs[i];
        return out;
    }

    /** Lay more of it: a flat list of (x, z, heading). */
    extend(points) {
        for (let k = 0; k < points.length; k += 3) {
            const i = this.ds.length - 1;
            const x = points[k];
            const z = points[k + 1];
            const step = Math.hypot(x - this.xs[i], z - this.zs[i]);
            if (step < 1e-6) {
                this.hs[i] = points[k + 2];
                continue;
            }
            this.xs.push(x);
            this.zs.push(z);
            this.hs.push(points[k + 2]);
            this.ds.push(this.ds[i] + step);
        }
    }

    /** The last sample at or before a distance run. */
    index(distance) {
        const { ds } = this;
        if (distance <= ds[0]) return 0;
        let lo = 0;
        let hi = ds.length - 1;
        if (distance >= ds[hi]) return hi;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (ds[mid] <= distance) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    /** Its place a distance run: (x, z, heading). Past the end it goes straight on. */
    at(distance, out = [0, 0, 0]) {
        const i = this.index(distance);
        const last = this.ds.length - 1;
        if (i >= last) {
            const over = Math.max(0, distance - this.ds[last]);
            const h = this.hs[last];
            out[0] = this.xs[last] + Math.sin(h) * over;
            out[1] = this.zs[last] + Math.cos(h) * over;
            out[2] = h;
            return out;
        }
        const span = this.ds[i + 1] - this.ds[i];
        const t = span > 0 ? clamp01((distance - this.ds[i]) / span) : 1;
        out[0] = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
        out[1] = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
        out[2] = wrap(this.hs[i] + wrap(this.hs[i + 1] - this.hs[i]) * t);
        return out;
    }

    /** Cut it at a distance run: nothing is laid beyond. */
    cut(distance) {
        if (distance >= this.end) return;
        const p = this.at(distance, [0, 0, 0]);
        const n = this.index(distance) + 1;
        this.xs.length = n;
        this.zs.length = n;
        this.hs.length = n;
        this.ds.length = n;
        if (this.ds[n - 1] < distance - 1e-9) {
            this.xs.push(p[0]);
            this.zs.push(p[1]);
            this.hs.push(p[2]);
            this.ds.push(distance);
        }
    }

    /** It sets off from its end on another heading (it turns where it stands). */
    turnEnd(h) {
        this.hs[this.hs.length - 1] = h;
    }

    /** Let go of what lies well behind a distance run. */
    forget(before) {
        const i = this.index(before);
        if (i < 400) return;
        this.xs.splice(0, i);
        this.zs.splice(0, i);
        this.hs.splice(0, i);
        this.ds.splice(0, i);
    }
}
