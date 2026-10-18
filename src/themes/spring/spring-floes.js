/**
 * Spring — the ice going out: a four-line clear breaks up the last of the winter's ice above
 * the fall, and its floes come out of the plunge pool's boil and ride the rapids down, round
 * under the knoll and away down the valley, turning, tipping over the ledges, wearing away.
 *
 * One instanced mesh of irregular slabs (a pool; the oldest is reused). Where a floe is follows
 * from its age alone, through a table of the time it takes to drift to every metre of the river at
 * the water's own speed (spring-plan speedAt), so any moment can be shown again exactly; a few
 * dozen matrices a frame. The slab's look (snow on the top, blue-green ice at the broken edges)
 * is the shader's.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { aerial } from './spring-light.js';
import {
    RIVER, S_POOL, courseAt, levelAt, slopeAt, speedAt,
} from './spring-plan.js';

/** How a floe lives: its speed against the water's, its life (s), its size range (m). */
export const FLOE = Object.freeze({
    drift: 1.0, life: 46, size: Object.freeze([1.5, 4.5]), thickness: 0.36,
});

/** The travel-time table: seconds a floe takes from the pool to every metre down the river. */
const TRAVEL_STEP = 1;
let TRAVEL = null;
function travel() {
    if (TRAVEL) return TRAVEL;
    const n = Math.max(2, Math.floor((RIVER.length - S_POOL) / TRAVEL_STEP));
    TRAVEL = new Float64Array(n);
    for (let k = 1; k < n; k++) {
        const s = S_POOL + (k - 0.5) * TRAVEL_STEP;
        TRAVEL[k] = TRAVEL[k - 1] + TRAVEL_STEP / Math.max(2.4, speedAt(s) * FLOE.drift);
    }
    return TRAVEL;
}

/** Where (s, m) a floe that set off from s0 has drifted after `age` seconds. */
export function floeAt(s0, age) {
    const table = travel();
    const at = (s) => {
        const f = Math.min(table.length - 1.001, Math.max(0, (s - S_POOL) / TRAVEL_STEP));
        const i = Math.floor(f);
        return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
    const target = at(s0) + Math.max(0, age);
    let lo = 0;
    let hi = table.length - 1;
    if (target >= table[hi]) return S_POOL + hi * TRAVEL_STEP;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid] <= target) lo = mid;
        else hi = mid;
    }
    const f = (target - table[lo]) / Math.max(1e-6, table[hi] - table[lo]);
    return S_POOL + (lo + f) * TRAVEL_STEP;
}

/** An irregular slab (unit across, `FLOE.thickness` thick), its top marked for the snow. */
export function floeGeometry(sides = 9, seed = 0xf10e) {
    const random = mulberry32(seed);
    const top = [];
    for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + (random() - 0.5) * 0.4;
        const r = 0.36 + random() * 0.16;
        top.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const position = [];
    const snow = [];
    const h = FLOE.thickness;
    const push = (x, y, z, w) => {
        position.push(x, y, z);
        snow.push(w);
    };
    for (let k = 0; k < sides; k++) {
        const [ax, az] = top[k];
        const [bx, bz] = top[(k + 1) % sides];
        // The top (a fan), the broken edge (a quad), the bottom (a fan, a little smaller).
        push(0, h * 0.5, 0, 1);
        push(bx, h * 0.5, bz, 1);
        push(ax, h * 0.5, az, 1);
        push(ax, h * 0.5, az, 0);
        push(bx, h * 0.5, bz, 0);
        push(bx * 0.9, -h * 0.5, bz * 0.9, 0);
        push(ax, h * 0.5, az, 0);
        push(bx * 0.9, -h * 0.5, bz * 0.9, 0);
        push(ax * 0.9, -h * 0.5, az * 0.9, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aSnow', new THREE.Float32BufferAttribute(snow, 1));
    geometry.computeVertexNormals();
    return geometry;
}

export class Floes {
    constructor(u, count = 40, seed = 0x1ce) {
        this.u = u;
        this.count = Math.max(1, count);
        this.random = mulberry32(seed);
        this.floes = Array.from({ length: this.count }, () => ({
            alive: false, s0: 0, s: 0, across: 0, born: 0, size: 1, yaw: 0, spin: 0, bob: 0,
        }));
        this.cursor = 0;
        this.geometry = floeGeometry();
        this.material = this.createMaterial();
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
        this.mesh.name = 'SpringFloes';
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 5;
        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._p = new THREE.Vector3();
        this._s = new THREE.Vector3();
        this._c = {};
        this.clear();
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'SpringFloes';
        const snow = attribute('aSnow', 'float');
        material.colorNode = Fn(() => {
            const P = positionWorld;
            const N = normalize(normalWorld);
            const L = u.sunDir;
            // Old snow on top, rotten grey in patches; at the broken edges the ice is blue-green.
            const rotten = sin(positionGeometry.x.mul(3.1).add(positionGeometry.z.mul(2.3)));
            const top = mix(vec3(0.62, 0.64, 0.66), vec3(0.78, 0.8, 0.82), smoothstep(-0.2, 0.15, rotten));
            const edge = vec3(0.16, 0.34, 0.36);
            const albedo = mix(edge, top, snow);
            const wrap = clamp(dot(N, L).add(0.4).div(1.4), 0.0, 1.0);
            const lit = albedo.mul(u.sun.mul(u.sunUp).mul(wrap.mul(0.5)).add(u.fill.mul(1.6)).add(u.bounce.mul(0.3)));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        return material;
    }

    clear() {
        for (const floe of this.floes) floe.alive = false;
        this._m.makeScale(0, 0, 0);
        for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this._m);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.live = 0;
    }

    /** The ice goes out: `n` floes out of the pool's boil over `spread` seconds from `time`. */
    breakUp(time, n = 24, spread = 3.5) {
        const r = this.random;
        for (let k = 0; k < Math.min(n, this.count); k++) {
            const floe = this.floes[this.cursor];
            this.cursor = (this.cursor + 1) % this.count;
            floe.alive = true;
            floe.s0 = S_POOL + 3 + r() * 9;
            floe.s = floe.s0;
            floe.across = (r() * 2 - 1) * 0.72;
            floe.born = time + (k / n) * spread + r() * 0.4;
            floe.size = FLOE.size[0] + (FLOE.size[1] - FLOE.size[0]) * r() ** 1.6;
            floe.yaw = r() * Math.PI * 2;
            floe.spin = (r() - 0.5) * 0.5;
            floe.bob = r() * 6.28;
        }
    }

    /** Place the floes where the river has carried them by time t, and write their matrices. */
    update(time, flood = 0) {
        const c = this._c;
        let live = 0;
        for (let i = 0; i < this.count; i++) {
            const floe = this.floes[i];
            const age = time - floe.born;
            if (!floe.alive || age < 0) {
                this._m.makeScale(0, 0, 0);
                this.mesh.setMatrixAt(i, this._m);
                continue;
            }
            if (age > FLOE.life || floe.s > RIVER.length - 20) {
                floe.alive = false;
                this._m.makeScale(0, 0, 0);
                this.mesh.setMatrixAt(i, this._m);
                continue;
            }
            live++;
            floe.s = floeAt(floe.s0, age);
            const yaw = floe.yaw + floe.spin * age;
            courseAt(floe.s, c);
            const across = floe.across * c.halfWidth;
            // Tipped down a ledge's chute, rocked by the waves, worn away toward the end.
            const tilt = Math.atan(slopeAt(floe.s));
            const wear = 1 - Math.max(0, age - FLOE.life * 0.6) / (FLOE.life * 0.4);
            const rise = Math.min(1, age / 0.8);
            this._p.set(
                c.x - c.tz * across,
                levelAt(floe.s) + flood + 0.06 * Math.sin(time * 2.1 + floe.bob) - FLOE.thickness * (1 - rise),
                c.z + c.tx * across,
            );
            this._e.set(tilt * c.tz + 0.05 * Math.sin(time * 1.7 + floe.bob), yaw, -tilt * c.tx, 'YXZ');
            this._q.setFromEuler(this._e);
            const size = floe.size * Math.max(0.05, wear);
            this._s.set(size, 1, size * 0.8);
            this._m.compose(this._p, this._q, this._s);
            this.mesh.setMatrixAt(i, this._m);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.live = live;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose?.();
    }
}
