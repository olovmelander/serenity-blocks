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
    acos,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { airClarity, sprayBow } from './spring-light.js';
import {
    FALL, LEDGES, S_OUTLET, S_POOL, courseAt, levelAt,
} from './spring-plan.js';
import {
    BURSTS, FALL_FRAME, LANDINGS, fallToWorld,
} from './spring-fall-plan.js';

/**
 * Puff kinds: where a tongue lands, the pool's boil, a rapids ledge's spray, a burst on the face,
 * and the splash a tongue throws up where it hits the pool (quick, crisp plumes).
 */
export const PUFF = Object.freeze({
    foot: 0, boil: 1, ledge: 2, burst: 3, splash: 4,
});

/** How bright the spray bow is in the spray (times the sun's light). */
export const MIST_BOW = 0.36;

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
    const nFoot = Math.round(count * 0.4);
    const nSplash = Math.round(count * 0.14);
    const nBurst = BURSTS.length ? Math.round(count * 0.14) : 0;
    const nBoil = Math.round(count * 0.16);
    const nLedge = count - nFoot - nSplash - nBurst - nBoil;
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
    // The splash where each tongue hits the pool: plumes thrown up and out in a second or two,
    // the harder the landing the bigger.
    for (let i = 0; i < nSplash; i++) {
        const row = pickBy(landings, random);
        fallToWorld(row.along + random() * 1.5, row.across + (random() - 0.5) * 2, p);
        const big = 0.5 + 0.7 * row.power;
        rows.push([p.x, FALL.pool + 0.3, p.z, 1.3 + random() * 0.9,
            tx * (2 + random() * 5), tz * (2 + random() * 5), (3 + random() * 6) * big, (1.6 + random() * 2.2) * big,
            random(), PUFF.splash, 0.3 + random() * 0.25, random()]);
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
        // How far (degrees) this corner stands from the point opposite the sun, for the spray bow:
        // worked out a corner (the bow's ring is smooth enough across a puff to interpolate).
        const vTheta = varying(float(0.0), 'spMistTheta');
        // The puff's middle over the water under it, and its card's half-height (m).
        // (z: how crisp its edge is: a splash's plume is crisp, the drifting cloud soft.)
        const vSoft = varying(vec3(0.0), 'spMistSoft');
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
            vSoft.assign(vec3(centre.y.sub(water), size.mul(0.5), step(3.5, kind)));
            // Droplets: dim from the sky, bright with the sun behind them.
            const V = normalize(centre.sub(u.eye));
            const fwd = clamp(dot(V, u.sunDir), 0.0, 1.0);
            const f2 = fwd.mul(fwd);
            const f8 = f2.mul(f2).mul(f2).mul(f2);
            vLight.assign(vec3(
                f8.mul(0.48).add(0.36),
                airClarity(u, centre),
                smoothstep(0.0, 14.0, centre.y.sub(FALL.pool)).mul(0.35),
            ));
            const anti = normalize(cameraViewMatrix.mul(vec4(u.sunDir.negate(), 0.0)).xyz);
            vTheta.assign(acos(clamp(dot(normalize(lifted.xyz), anti), -1.0, 1.0)).mul(180 / Math.PI));
            return cameraProjectionMatrix.mul(lifted);
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.fragmentNode = Fn(() => {
            const corner = vInfo.xy;
            const r2 = dot(corner, corner);
            // A billowing puff: lumps of cloud whose edges are its noise's, turning as it rises
            // (a splash's crisper than the drifting cloud's).
            const swirl = texture(tex.noise, corner.mul(0.35).add(vec2(vInfo.z.mul(0.3), vCentre.x.mul(0.013)))).r;
            const curls = texture(tex.noise, corner.mul(0.9).add(vec2(vCentre.z.mul(0.011), vInfo.z.mul(0.5)))).g;
            const heap = swirl.mul(0.7).add(curls.mul(0.45)).add(float(1.0).sub(r2).mul(0.45)).sub(0.42)
                .toVar();
            const crisp = vSoft.z;
            const edgeLo = mix(float(0.05), float(0.3), crisp);
            const edgeHi = mix(float(0.75), float(0.5), crisp);
            const shape = exp(r2.mul(-2.2)).mul(smoothstep(edgeLo, edgeHi, heap)).mul(1.15);
            // The lower edge fades, and the puff thins to nothing where it meets the water: a puff
            // standing in the pool was cut by its surface in a hard white line (a long chain's
            // thick cloud the brightest).
            const over = vSoft.x.add(corner.y.mul(vSoft.y));
            // (A splash's plume stands solid nearly down to the water it bursts from.)
            const meets = mix(vSoft.y.mul(0.35).add(0.8), float(0.3), vSoft.z);
            const lower = mix(smoothstep(-1.0, -0.2, corner.y), float(1.0), vSoft.z);
            const foot = lower.mul(smoothstep(0.0, meets, over));
            const alpha = clamp(shape.mul(foot).mul(vInfo.w), 0.0, 1.0);
            // Spray in the sun is white; with the sun behind it, it blazes. A cloud's low parts are
            // shaded by the spray over them, its top and its upper edge lit.
            // Each lump is lit on its upper side and shaded under the lumps over it: the cloud
            // reads as heaped, not as a glow.
            const top = smoothstep(-0.6, 0.8, corner.y.add(curls.sub(0.5).mul(0.6))).mul(0.45).add(vLight.z).add(0.35);
            // (Not under a splash, and not where the cloud meets the water: a dark underside there
            // stood the white boil out against it as a bar.)
            const under = smoothstep(-0.9, 0.5, corner.y.add(swirl.sub(0.5).mul(0.8)));
            const shade = mix(float(0.78), float(1.0), max(under, max(vSoft.z, smoothstep(2.5, 0.5, over))));
            const lit = u.fill.mul(mix(float(1.35), float(1.9), shade)).add(u.sun.mul(u.sunUp).mul(vLight.x).mul(top))
                .mul(shade);
            // The spray bow: where the spray stands about 42° from the point opposite the sun
            // (with the sun high behind the eye, the bow arcs through the spray at the fall's foot).
            // Back-to-back and the heat of play brighten it (u.bow, 1 at rest).
            const bow = sprayBow(vTheta).mul(u.sun).mul(u.sunUp).mul(u.bow.mul(MIST_BOW));
            const col = mix(u.haze, lit.mul(0.92).add(bow), vLight.y);
            return vec4(col, alpha);
        })();
        return material;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
