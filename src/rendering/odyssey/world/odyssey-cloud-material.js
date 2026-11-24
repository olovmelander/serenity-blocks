import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, attribute, clamp, cos, dot, exp, float, floor, int, max, min, mix, mod, normalize, positionGeometry, sign,
    sin, smoothstep, step, texture3D, uniformArray, varyingProperty, vec3, vec4,
} from 'three/tsl';
import { CLOUD_SHAPES, CLOUD_VOLUMES } from './odyssey-cloud-data.js';

/**
 * A CLOUD, TRACED (2026-11-24). Every cloud is a box; inside it the eye's ray walks the cloud's own
 * distance field (sculpted in Blender, odyssey-cloud-data.js), in long strides through clear air and short
 * ones through its skin, and gathers the light the sculptor solved for it: the sun's, scattered, for this
 * world's one sun; the sky's; what comes up from the sea. A tiling billow noise carves the skin as it walks,
 * so a cloud has edges at every size, and the noise rises and rolls, so they are never still.
 *
 * Only the pixels a cloud's box covers are paid for. All of them are one draw, sorted far to near.
 *
 * Instances (one interleaved buffer):
 *   aAt    the base's middle xyz, the turn about up
 *   aForm  width u, how much taller than sculpted, shape, its own random
 *   aLife  how eaten away it is (0 whole .. 1 gone), cover (0..1), softness, how far the air has taken it
 */

/**
 * The look. `band` and `density` are the skin: how thick it is and how fast it closes (per u). `carve` is
 * how far the billows move the skin (shares of the cloud's width), at `tile` (widths) and `fine` of that.
 * `rise` is how fast they climb (u/s). `lean` is how far toward the sun a billow looks for its own shade
 * (tiles), `relief` how much of that and of its crease it wears.
 */
export const CLOUD_LOOK = Object.freeze({
    band: 0.024,
    density: 0.085,
    carve: 0.036,
    fineCarve: 0.015,
    tile: 0.62,
    fine: 4.3,
    lean: 0.040,
    rise: 3.2,
    relief: 0.42,
    sun: 1.18,
    sky: 0.92,
    ground: 0.46,
    silver: 0.85,
    rim: 0.22,
});

export const CLOUD_INSTANCE = Object.freeze({
    stride: 12,
    layout: Object.freeze([Object.freeze(['aAt', 0]), Object.freeze(['aForm', 4]), Object.freeze(['aLife', 8])]),
});

/** How much wider than the sculpt its box is drawn, shape units: what the billows may push out. */
const PAD = 0.035;

/**
 * @param {object} ctx
 *   volumes  the four textures (odyssey-cloud-data.js)
 *   uOn      0 until they have landed
 *   steps    the most steps a ray takes
 *   fineOn   whether the fine billows are drawn
 *   cameraPosition  in the world's own frame
 *   uTime, uSunDir
 *   prepare  (rd) -> k: what the light needs once a ray
 *   light    (k, { sun, sky, ground, body, h, relief, lit, dens, eaten }) -> colour: the world's light on a place in it
 *            (relief 0 in a crease .. 1 on a crown; lit 0 a billow's own shaded side .. 1 its sunlit one)
 *   air      (colour, alpha, rd, p, dist, far) -> vec4(rgb, alpha): the air between, and the world's output
 */
export function createCloudMaterial(ctx) {
    const L = CLOUD_LOOK;
    const aAt = attribute('aAt', 'vec4');
    const aForm = attribute('aForm', 'vec4');
    const aLife = attribute('aLife', 'vec4');
    const n = CLOUD_SHAPES.length;
    const [, sy] = CLOUD_VOLUMES.sdf;
    const [, ly] = CLOUD_VOLUMES.light;
    const { reach } = CLOUD_VOLUMES;
    // (box xyz, -), (low corner xyz, -), (high corner xyz, -) of every shape, in its own units.
    const rows = [];
    CLOUD_SHAPES.forEach((s) => {
        const at = (u, i) => (i === 1 ? u * s.box[1] : (u - 0.5) * s.box[i]);
        rows.push(new THREE.Vector4(...s.box, 0));
        rows.push(new THREE.Vector4(...[0, 1, 2].map((i) => at(s.lo[i], i) - PAD), 0));
        rows.push(new THREE.Vector4(...[0, 1, 2].map((i) => at(s.hi[i], i) + PAD), 0));
    });
    const uShapes = uniformArray(rows, 'vec4');

    const vAt = varyingProperty('vec4', 'vCloudAt');
    const vForm = varyingProperty('vec4', 'vCloudForm');
    const vLife = varyingProperty('vec4', 'vCloudLife');
    const vWorld = varyingProperty('vec3', 'vCloudWorld');

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.name = 'OdysseyClouds';
    mat.fog = false;
    mat.transparent = true;
    mat.premultipliedAlpha = true;
    mat.depthWrite = false;
    // (The near faces: the eye is never inside a cloud's box, and a cloud behind a mountain must be hidden by it.)
    mat.side = THREE.FrontSide;
    mat.positionNode = Fn(() => {
        const shape = int(floor(aForm.z.add(0.5))).mul(3).toVar();
        const lo = uShapes.element(shape.add(1)).xyz;
        const hi = uShapes.element(shape.add(2)).xyz;
        const q = mix(lo, hi, positionGeometry.add(0.5)).toVar();
        const c = cos(aAt.w).toVar();
        const s = sin(aAt.w).toVar();
        const p = vec3(q.x.mul(c).add(q.z.mul(s)), q.y.mul(aForm.y), q.z.mul(c).sub(q.x.mul(s))).mul(aForm.x)
            .add(aAt.xyz)
            .toVar();
        vAt.assign(aAt);
        vForm.assign(aForm);
        vLife.assign(aLife);
        vWorld.assign(p);
        // Gone, or not here yet: no pixel.
        return mix(aAt.xyz, p, ctx.uOn.mul(step(0.001, aLife.y)));
    })();

    const out = Fn(() => {
        const ro = vec3(ctx.cameraPosition).toVar();
        const rd = normalize(vWorld.sub(ro)).toVar();
        const kit = ctx.prepare(rd);
        const W = vForm.x.toVar();
        const tall = vForm.y.toVar();
        const row = int(floor(vForm.z.add(0.5))).mul(3).toVar();
        const slab = floor(vForm.z.add(0.5)).toVar();
        const box = uShapes.element(row).xyz.toVar();
        const lo = uShapes.element(row.add(1)).xyz.toVar();
        const hi = uShapes.element(row.add(2)).xyz.toVar();
        const c = cos(vAt.w).toVar();
        const s = sin(vAt.w).toVar();
        const own = (v) => vec3(v.x.mul(c).sub(v.z.mul(s)), v.y.div(tall), v.z.mul(c).add(v.x.mul(s)));
        const o = own(ro.sub(vAt.xyz)).div(W).toVar();
        const d = own(rd).div(W).toVar();
        // The box, in the cloud's own frame; t stays in world units.
        const inv = vec3(1).div(sign(d).mul(max(abs(d), vec3(1e-7))).add(vec3(1e-9))).toVar();
        const t0 = lo.sub(o).mul(inv).toVar();
        const t1 = hi.sub(o).mul(inv).toVar();
        const near = min(t0, t1).toVar();
        const far3 = max(t0, t1).toVar();
        const tIn = max(max(near.x, near.y), max(near.z, float(2))).toVar();
        const tOut = min(min(far3.x, far3.y), far3.z).toVar();
        const rgb = vec3(0).toVar();
        const through = float(1).toVar();
        const firstAt = float(0).toVar();
        const weight = float(0).toVar();
        If(tOut.greaterThan(tIn), () => {
            const t = float(tIn).toVar();
            const eaten = vLife.x.mul(reach * 1.15).toVar();
            const band = float(L.band).mul(vLife.z).toVar();
            const seed = vForm.w.toVar();
            const still = vec3(seed.mul(17.3), seed.mul(5.1), seed.mul(41.7)).toVar();
            const lift = ctx.uTime.mul(L.rise).div(W).toVar();
            const metric = min(tall, float(1)).toVar();
            // A pixel's size here sets the shortest step, so a far cloud takes few.
            const footprint = tIn.mul(0.0011).div(W).toVar();
            const least = max(float(0.0075), footprint.mul(2.2)).toVar();
            const fineOn = ctx.fineOn ? float(1).sub(smoothstep(float(0.0012), float(0.0045), footprint)).toVar() : float(0);
            // The sun's turn in the sculptor's four.
            const quarter = mod(vAt.w.div(Math.PI / 2).add(8), float(4)).toVar();
            const q0 = floor(quarter).toVar();
            const qf = quarter.sub(q0).toVar();
            const pick = (k) => vec4(
                step(k, 0.5),
                step(0.5, k).mul(step(k, 1.5)),
                step(1.5, k).mul(step(k, 2.5)),
                step(2.5, k),
            );
            const q1 = mod(q0.add(1), float(4)).toVar();
            const toward = own(vec3(ctx.uSunDir)).mul(L.lean).toVar();
            const sunPick = mix(pick(q0), pick(q1), qf).toVar();
            const uvwAt = (p, half) => vec3(
                p.x.div(box.x).add(0.5),
                slab.add(clamp(p.y.div(box.y), half, float(1).sub(half))).div(n),
                p.z.div(box.z).add(0.5),
            );
            const halfS = 0.5 / sy;
            const halfL = 0.5 / ly;
            Loop(ctx.steps, () => {
                const p = o.add(d.mul(t)).toVar();
                const field = texture3D(ctx.volumes.sdf, uvwAt(p, float(halfS)), 0).r.sub(0.5).mul(2 * reach).toVar();
                const dist = field.add(eaten).toVar();
                const carve = float(L.carve + L.fineCarve).toVar();
                const relief = float(0.5).toVar();
                const at = vec3(0).toVar();
                If(dist.lessThan(carve.add(band)), () => {
                    at.assign(p.div(L.tile).add(still).add(vec3(0, lift.negate(), 0)));
                    const n1 = texture3D(ctx.volumes.billow, at, 0).toVar();
                    const big = n1.r.mul(0.60).add(n1.g.mul(0.28)).add(n1.b.mul(0.12)).toVar();
                    relief.assign(big);
                    dist.subAssign(big.sub(0.46).mul(L.carve * 2));
                    if (ctx.fineOn) {
                        If(fineOn.greaterThan(0.02).and(dist.lessThan(band.add(L.fineCarve))), () => {
                            const n2 = texture3D(ctx.volumes.billow, at.mul(L.fine).add(vec3(0, lift.mul(-2.1), 0)), 0).toVar();
                            const small = n2.r.mul(0.62).add(n2.g.mul(0.38)).toVar();
                            dist.subAssign(small.sub(0.46).mul(L.fineCarve * 2).mul(fineOn));
                            relief.assign(mix(big, small, fineOn.mul(0.34)));
                        });
                    }
                });
                const stride = max(dist.mul(0.80).mul(metric), least).mul(W).toVar();
                const dens = smoothstep(band, band.negate(), dist).toVar();
                If(dens.greaterThan(0.004), () => {
                    const a = float(1).sub(exp(dens.mul(stride).mul(L.density).negate())).toVar();
                    const uvl = uvwAt(p, float(halfL)).toVar();
                    const sun4 = texture3D(ctx.volumes.sun, uvl, 0).toVar();
                    const air4 = texture3D(ctx.volumes.air, uvl, 0).toVar();
                    // A billow's own two sides: the noise here against the noise a little toward the sun.
                    const n3 = texture3D(ctx.volumes.billow, at.add(toward), 0).toVar();
                    const before = n3.r.mul(0.60).add(n3.g.mul(0.28)).add(n3.b.mul(0.12));
                    const lit = clamp(relief.sub(before).mul(1.5).add(0.55), 0, 1);
                    const col = ctx.light(kit, {
                        sun: dot(sun4, sunPick),
                        sky: air4.r,
                        ground: air4.g,
                        body: air4.b,
                        h: clamp(p.y.div(box.y), 0, 1),
                        relief,
                        lit,
                        dens,
                        eaten: vLife.x,
                    });
                    const w = through.mul(a).toVar();
                    rgb.addAssign(col.mul(w));
                    firstAt.addAssign(t.mul(w));
                    weight.addAssign(w);
                    through.mulAssign(float(1).sub(a));
                });
                t.addAssign(stride);
                If(through.lessThan(0.02).or(t.greaterThan(tOut)), () => { Break(); });
            });
        });
        const alpha = float(1).sub(through).mul(vLife.y).toVar();
        const meanT = firstAt.div(max(weight, float(1e-4))).toVar();
        return ctx.air(rgb.mul(vLife.y), alpha, rd, ro.add(rd.mul(meanT)), meanT, vLife.w);
    })();
    mat.colorNode = vec3(0);
    mat.outputNode = out;
    return mat;
}

/** The boxes of every cloud, one instanced geometry over one dynamic buffer. */
export function createCloudGeometry(capacity) {
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', cube.getAttribute('position'));
    geo.setIndex(cube.getIndex());
    const data = new Float32Array(capacity * CLOUD_INSTANCE.stride);
    const buffer = new THREE.InstancedInterleavedBuffer(data, CLOUD_INSTANCE.stride, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    CLOUD_INSTANCE.layout.forEach(([name, offset]) => {
        geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
    });
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return { geometry: geo, data, buffer };
}
