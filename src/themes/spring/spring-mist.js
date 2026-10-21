/**
 * Spring — the fall's breath: mist rolling up where its tongues land and hanging over the boil,
 * spray thrown off the face where the water bursts on a ledge or a slab, and off the rapids'
 * biggest ledges.
 *
 * One instanced mesh of soft camera-facing puffs. Each puff loops on its own period in closed
 * form (born again at its emitter when its age wraps), so nothing runs on the CPU per frame: it
 * rises, drifts downstream, swells and fades. Puffs are lit as water droplets: dim from the sky,
 * bright where the sun stands behind them (forward scattering), so the backlit mist glows. Their
 * lower edges fade, so a puff never cuts a hard line into the water. The flood thickens them and a
 * surge leaving the pool throws a burst.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { airClarity } from './spring-light.js';
import {
    FALL, LEDGES, S_OUTLET, S_POOL, courseAt, levelAt,
} from './spring-plan.js';
import {
    BURSTS, FALL_FRAME, LANDINGS, fallToWorld,
} from './spring-fall-plan.js';

/** Puff kinds: where a tongue lands, the pool's boil, a rapids ledge's spray, a burst on the face. */
export const PUFF = Object.freeze({
    foot: 0, boil: 1, ledge: 2, burst: 3,
});

/** One of `rows` picked by weight (its `power`). */
function pickBy(rows, random) {
    const total = rows.reduce((sum, row) => sum + row.power, 0);
    let x = random() * total;
    for (const row of rows) {
        x -= row.power;
        if (x <= 0) return row;
    }
    return rows[rows.length - 1];
}

/**
 * Lay the puffs out: positions at their emitters, how they move over a period, how they look.
 * Per puff: aBase (x, y, z, period s), aMove (drift x, drift z, rise m, size m),
 * aLook (seed, kind, opacity, phase 0..1).
 */
export function mistLayout(count = 360, seed = 0x3a17) {
    const random = mulberry32(seed);
    const rows = [];
    const nFoot = Math.round(count * 0.5);
    const nBurst = BURSTS.length ? Math.round(count * 0.14) : 0;
    const nBoil = Math.round(count * 0.16);
    const nLedge = count - nFoot - nBurst - nBoil;
    const { tx, tz } = FALL_FRAME;
    const p = {};
    // Where the tongues land, by how hard: the main one throws a cloud that billows up the face
    // and rolls out over the pool, the side ones less.
    // (Weighted by the root of the power: the cloud spreads along the whole foot, not in one ball.)
    const landings = LANDINGS.filter((row) => row.power > 0.05)
        .map((row) => ({ ...row, power: Math.sqrt(row.power) }));
    for (let i = 0; i < nFoot; i++) {
        const row = pickBy(landings, random);
        fallToWorld(row.along + (random() - 0.35) * 4, row.across + (random() - 0.5) * 2.4, p);
        const big = 0.45 + 0.75 * row.power;
        rows.push([p.x, FALL.pool + 1.0, p.z, 7 + random() * 5,
            tx * (7 + random() * 15), tz * (7 + random() * 15), (3 + random() * 9) * big, (7 + random() * 10) * big,
            random(), PUFF.foot, (0.16 + random() * 0.2) * Math.min(1, 0.45 + row.power), random()]);
    }
    // Spray thrown up off the face where the water lands on a ledge or meets a slab.
    for (let i = 0; i < nBurst; i++) {
        const burst = pickBy(BURSTS, random);
        fallToWorld(burst.along + 0.5 + random() * 1.6, burst.across + (random() - 0.5) * 1.6, p);
        rows.push([p.x, burst.y + 0.2, p.z, 3 + random() * 3,
            tx * (2 + random() * 4), tz * (2 + random() * 4), 1.2 + random() * 2.6, 1.6 + random() * 2.8,
            random(), PUFF.burst, 0.1 + random() * 0.14, random()]);
    }
    for (let i = 0; i < nBoil; i++) {
        const foot = courseAt(S_POOL, {});
        const across = (random() * 2 - 1) * foot.halfWidth * 0.9;
        const along = 3 + random() * 16;
        const c = courseAt(S_POOL + along, {});
        rows.push([c.x - c.tz * across, FALL.pool + 0.9, c.z + c.tx * across, 6 + random() * 5,
            c.tx * (3 + random() * 6), c.tz * (3 + random() * 6), 2 + random() * 4, 3 + random() * 4,
            random(), PUFF.boil, 0.16 + random() * 0.12, random()]);
    }
    const big = LEDGES.filter((l) => l.drop >= 0.6);
    for (let i = 0; i < nLedge; i++) {
        const ledge = big[i % big.length];
        const s = S_OUTLET + ledge.at + 1 + random() * 3;
        const c = courseAt(s, {});
        const across = (random() * 2 - 1) * c.halfWidth * 0.85;
        rows.push([c.x - c.tz * across, levelAt(s) + 0.5, c.z + c.tx * across, 3 + random() * 3,
            c.tx * (2 + random() * 4), c.tz * (2 + random() * 4), 1 + random() * 2.2, 1.2 + random() * 1.8,
            random(), PUFF.ledge, 0.07 + random() * 0.07, random()]);
    }
    return rows;
}

/**
 * A puff's card: the unit square (±0.5) with its corners cut, an octagon whose sides touch the
 * circle the square's sides touch. A puff fades as exp(−2.6 r²) from its middle, so past that
 * circle it is already as faint as at the square's own edges; the corners only cost fragments,
 * a sixth of them, and where the tongues land the puffs lie a hundred deep.
 */
export function puffGeometry() {
    const r = 0.5 / Math.cos(Math.PI / 8);
    const position = [0, 0, 0];
    for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        position.push(r * Math.cos(a), r * Math.sin(a), 0);
    }
    const index = [];
    for (let k = 0; k < 8; k++) index.push(0, 1 + k, 1 + ((k + 1) % 8));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    return geometry;
}

export class Mist {
    constructor(u, tex, count = 360) {
        this.u = u;
        this.count = Math.max(1, count);
        const rows = mistLayout(this.count);
        const base = new Float32Array(this.count * 4);
        const move = new Float32Array(this.count * 4);
        const look = new Float32Array(this.count * 4);
        rows.forEach((r, i) => {
            base.set(r.slice(0, 4), i * 4);
            move.set(r.slice(4, 8), i * 4);
            look.set(r.slice(8, 12), i * 4);
        });
        const quad = puffGeometry();
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = quad.index;
        geometry.setAttribute('position', quad.getAttribute('position'));
        geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
        geometry.setAttribute('aMove', new THREE.InstancedBufferAttribute(move, 4));
        geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
        geometry.instanceCount = this.count;
        this.geometry = geometry;
        this.material = this.createMaterial(tex);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.name = 'SpringMist';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 28;
    }

    createMaterial(tex) {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'SpringMist';
        material.transparent = true;
        material.depthWrite = false;
        material.fog = false;
        const aBase = attribute('aBase', 'vec4');
        const aMove = attribute('aMove', 'vec4');
        const aLook = attribute('aLook', 'vec4');
        const vInfo = varying(vec4(0.0), 'spMistInfo'); // corner xy, life t, opacity
        const vCentre = varying(vec3(0.0), 'spMistCentre');
        // What is the same over a whole puff (its forward scatter, the air between it and the eye,
        // its height over the pool) is worked out once a corner, not once a pixel: the puffs
        // overlap many deep where the tongues land.
        const vLight = varying(vec3(0.0), 'spMistLight'); // forward scatter, clarity, height's lift
        // The puff's middle over the water under it, and its card's half-height (m).
        const vSoft = varying(vec2(0.0), 'spMistSoft');
        material.vertexNode = Fn(() => {
            const period = aBase.w;
            const t = fract(u.time.div(period).add(aLook.w));
            const ease = t.mul(float(2.0).sub(t));
            // The flood swells the mist and lifts it with the water.
            // (Not so much that a long chain's cloud hides the fall it rises from.)
            const swell = u.foamBoost.mul(0.5).add(u.flood.mul(0.25)).add(1.0);
            const centre = aBase.xyz.add(vec3(aMove.x, 0.0, aMove.y).mul(ease))
                .add(vec3(0.0, aMove.z.mul(pow(t, 0.7)).mul(swell).add(u.flood), 0.0)).toVar();
            // A slow curl so neighbouring puffs never move in step.
            const curl = vec3(sin(t.mul(5.0).add(aLook.x.mul(31.0))), 0.0, cos(t.mul(4.0).add(aLook.x.mul(17.0))))
                .mul(0.6);
            centre.addAssign(curl);
            const size = aMove.w.mul(t.mul(0.6).add(0.55)).mul(swell);
            const view = cameraViewMatrix.mul(vec4(centre, 1.0));
            // Wider than tall: spray spreads out over the water more than it climbs.
            const lifted = view.add(vec4(positionGeometry.xy.mul(vec2(1.5, 1.0)).mul(size), 0.0, 0.0));
            // Densest soon after it is thrown up; it thins as it rises and spreads.
            const life = smoothstep(0.0, 0.1, t).mul(float(1.0).sub(smoothstep(0.35, 1.0, t)));
            vInfo.assign(vec4(positionGeometry.xy.mul(2.0), t, aLook.z.mul(life).mul(swell.min(1.8))));
            vCentre.assign(centre);
            // The water under the puff: the pool's (a foot or the boil's puff stands a metre over it,
            // a burst's falls to it), a rapids ledge's (half a metre under its puff); the flood lifts it.
            const kind = aLook.y;
            const water = select(kind.lessThan(1.5), aBase.y.sub(1.0), select(
                kind.lessThan(2.5),
                aBase.y.sub(0.5),
                float(FALL.pool),
            )).add(u.flood);
            vSoft.assign(vec2(centre.y.sub(water), size.mul(0.5)));
            // Droplets: dim from the sky, bright with the sun behind them.
            const V = normalize(centre.sub(u.eye));
            const fwd = clamp(dot(V, u.sunDir), 0.0, 1.0);
            const f2 = fwd.mul(fwd);
            const f8 = f2.mul(f2).mul(f2).mul(f2);
            vLight.assign(vec3(
                f8.mul(0.75).add(0.36),
                airClarity(u, centre),
                smoothstep(0.0, 14.0, centre.y.sub(FALL.pool)).mul(0.35),
            ));
            return cameraProjectionMatrix.mul(lifted);
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.fragmentNode = Fn(() => {
            const corner = vInfo.xy;
            const r2 = dot(corner, corner);
            // A soft round puff broken by noise that turns as it rises.
            const swirl = texture(tex.noise, corner.mul(0.35).add(vec2(vInfo.z.mul(0.3), vCentre.x.mul(0.013)))).r;
            const curls = texture(tex.noise, corner.mul(0.9).add(vec2(vCentre.z.mul(0.011), vInfo.z.mul(0.5)))).g;
            const shape = exp(r2.mul(-2.6)).mul(clamp(swirl.mul(1.1).add(curls.mul(0.5)).sub(0.35), 0.0, 1.2));
            // The lower edge fades, and the puff thins to nothing where it meets the water: a puff
            // standing in the pool was cut by its surface in a hard white line (a long chain's
            // thick cloud the brightest).
            const over = vSoft.x.add(corner.y.mul(vSoft.y));
            const foot = smoothstep(-1.0, -0.2, corner.y).mul(smoothstep(0.0, vSoft.y.mul(0.35).add(0.8), over));
            const alpha = clamp(shape.mul(foot).mul(vInfo.w), 0.0, 1.0);
            // Spray in the sun is white; with the sun behind it, it blazes. A cloud's low parts are
            // shaded by the spray over them, its top and its upper edge lit.
            const top = smoothstep(-0.6, 0.8, corner.y).mul(0.35).add(vLight.z).add(0.45);
            const lit = u.fill.mul(1.8).add(u.sun.mul(u.sunUp).mul(vLight.x).mul(top));
            const col = mix(u.haze, lit.mul(0.92), vLight.y);
            return vec4(col, alpha);
        })();
        return material;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
