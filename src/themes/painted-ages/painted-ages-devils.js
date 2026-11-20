/**
 * Painted Ages — the dust devils: funnels of pigment dust standing on the valley floor.
 *
 * A twist spins one up in the piece's colour (a twist that clears nothing, a small one), and now
 * and then the weather raises a pale one of its own. Each is ONE card that turns to the eye about
 * its upright axis and draws the funnel in its fragment stage: a hollow tube seen from the side
 * (its walls thickest at the rims), narrow at the foot and opening as it climbs, its axis swaying,
 * pigment winding up the near wall one way and the far wall the other, a skirt of dust dragged
 * along the ground. It climbs out of the ground, stands, drifts with the wind, then lifts off its
 * foot and thins away. Lit by the hour's sun from its side and read through the air.
 *
 * The cards are always in the scene (a dormant one collapses to a point): nothing is created at
 * event time. Rows of the shared table `u.devils` (painted-ages-tsl.js):
 *   (foot x, y, z, start time) + (rgb, height m) + (seed, drift x, drift z in m/s, strength)
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    asin,
    attribute,
    clamp,
    dot,
    exp,
    float,
    int,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEVILS } from './painted-ages-tsl.js';
import { aerial } from './painted-ages-light.js';

/** A devil's whole life (s): it climbs for the first second and a half, thins over the last. */
export const DEVIL_LIFE = 7.5;
/** The card's half-width, in funnel heights. */
const HALF = 0.4;
const DUST = Object.freeze([0.66, 0.5, 0.38]);

const sq = (x) => x.mul(x);

export function createDevils(u, tex) {
    const positions = new Float32Array(DEVILS * 4 * 3);
    const uvs = new Float32Array(DEVILS * 4 * 2);
    const slots = new Float32Array(DEVILS * 4);
    const index = [];
    for (let i = 0; i < DEVILS; i++) {
        uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
        slots.fill(i, i * 4, i * 4 + 4);
        const b = i * 4;
        index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aSlot', new THREE.BufferAttribute(slots, 1));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -2000), 60000);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesDevils';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    const slot = attribute('aSlot', 'float');
    const row = (k) => u.devils.element(int(slot.add(0.5)).mul(3).add(k));
    /** The foot (it drifts with the wind) and the unit vector across the card, toward its right. */
    const footOf = (a, c, age) => a.xyz.add(vec3(c.y, 0.0, c.z).mul(max(age, 0.0)));
    const acrossOf = (foot) => {
        const toEye = u.eye.xz.sub(foot.xz);
        return normalize(vec2(toEye.y, toEye.x.negate()).add(vec2(1e-5, 0.0)));
    };

    material.positionNode = Fn(() => {
        const a = row(0);
        const b = row(1);
        const c = row(2);
        const age = u.time.sub(a.w);
        const live = c.w.greaterThan(0.001).and(age.greaterThanEqual(0.0)).and(age.lessThan(DEVIL_LIFE));
        const foot = footOf(a, c, age);
        const across = acrossOf(foot);
        const st = uv();
        const P = foot.add(vec3(across.x, 0.0, across.y).mul(st.x.sub(0.5).mul(2.0 * HALF).mul(b.w)))
            .add(vec3(0.0, st.y.mul(b.w), 0.0));
        // A dormant card collapses to a point far under the land.
        return live.select(P, vec3(0.0, -1e5, 0.0));
    })();

    material.colorNode = Fn(() => {
        const a = row(0);
        const b = row(1);
        const c = row(2);
        const st = uv();
        const age = u.time.sub(a.w).toVar();
        // (Clamped: under MSAA a card's coordinate is extrapolated past its edge.)
        const y = clamp(st.y, 0.0, 1.0).toVar();
        const X = clamp(st.x, 0.0, 1.0).sub(0.5).mul(2.0 * HALF).toVar();
        const seed = c.x;
        const { time } = u;
        const grown = smoothstep(0.0, 1.5, age).toVar();
        const going = smoothstep(DEVIL_LIFE - 2.8, DEVIL_LIFE, age).toVar();
        // The axis sways, more the higher it stands, and leans one way with the wind's shear.
        const axis = sin(y.mul(4.2).add(time.mul(1.7)).add(seed.mul(6.28))).mul(0.04).mul(y)
            .add(sin(y.mul(9.5).sub(time.mul(2.6)).add(seed.mul(17.0))).mul(0.012).mul(y))
            .add(y.mul(y).mul(seed.sub(0.5).mul(0.3)));
        // Narrow at the foot, opening as it climbs; it breathes as it turns.
        const radius = float(0.03).add(y.mul(sqrt(y)).mul(0.14))
            .add(sin(y.mul(13.0).add(time.mul(3.1)).add(seed.mul(9.0))).mul(0.006))
            .mul(grown.mul(0.45).add(0.55));
        const q = X.sub(axis).div(radius).toVar();
        const rim = float(1.0).sub(smoothstep(0.7, 1.0, abs(q)));
        const depth = sqrt(max(float(1.0).sub(q.mul(q)), 0.0));
        const th = asin(clamp(q, -0.999, 0.999));
        // Pigment winds up the walls: across the near wall one way, across the far wall the other.
        const wind = y.mul(2.4).sub(time.mul(0.55)).add(seed.mul(3.0));
        const climb = y.mul(1.3).sub(time.mul(0.3));
        const front = texture(tex.noise, vec2(th.mul(0.22).add(wind), climb)).a;
        const back = texture(tex.noise, vec2(th.mul(-0.22).add(wind).add(0.43), climb.add(0.37))).b;
        const streaks = smoothstep(0.32, 0.72, front).mul(0.75).add(smoothstep(0.4, 0.8, back).mul(0.4)).toVar();
        // A hollow tube seen from the side: its walls are thickest at the rims.
        const wall = mix(float(1.0), float(0.4), depth);
        const body = rim.mul(wall).mul(streaks.mul(0.8).add(0.5));
        // It has only climbed so far; its crown frays into the air; at the end its foot lifts off.
        const risen = float(1.0).sub(smoothstep(grown.sub(0.14), grown.add(0.001), y));
        const crown = float(1.0).sub(smoothstep(0.66, 1.0, y));
        const liftAt = going.mul(0.55).sub(0.07);
        const lifted = smoothstep(liftAt.sub(0.06), liftAt.add(0.05), y);
        // The skirt of dust it drags along the ground.
        const puff = texture(tex.noise, vec2(X.mul(2.2).add(seed), time.mul(0.25))).g.mul(0.6).add(0.55);
        const skirt = exp(y.div(-0.05)).mul(exp(sq(X.sub(axis).div(0.13)).negate())).mul(puff)
            .mul(grown)
            .mul(float(1.0).sub(going));
        const alpha = clamp(body.mul(risen).mul(crown).mul(lifted).mul(1.7)
            .add(skirt.mul(0.9)), 0.0, 0.94)
            .mul(c.w).mul(float(1.0).sub(going.mul(0.8)));
        // Colour: the pigment in streaks through pale dust.
        const tone = mix(vec3(DUST[0], DUST[1], DUST[2]), b.xyz, streaks.mul(0.6).add(0.3));
        // Lit from the sun's side across the funnel; it glows a little of its own, so it reads
        // in shade and in the dim hours.
        const foot = footOf(a, c, age);
        const across = acrossOf(foot);
        const sunSide = dot(vec3(across.x, 0.0, across.y), u.sunDir);
        const shade = clamp(q.mul(sunSide.mul(3.0).clamp(-1.0, 1.0)).mul(0.42).add(0.62), 0.15, 1.0);
        const light = u.sun.mul(u.sunUp).mul(shade).mul(0.5).add(u.fill.mul(1.3))
            .add(u.bounce)
            .add(u.moon);
        const lit = tone.mul(light).add(b.xyz.mul(streaks.mul(0.55).add(0.12)));
        return vec4(aerial(u, positionWorld, lit), alpha);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesDevils';
    mesh.frustumCulled = false;
    mesh.renderOrder = 25;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * The table's keeper: which row a new devil takes (a spent one, else the one nearest its end)
 * and what is still standing.
 */
export class DevilTable {
    constructor(u) {
        this.u = u;
        this.start = new Float64Array(DEVILS).fill(-1e6);
    }

    reset() {
        for (const r of this.u.tables.devils) r.set(0, 0, 0, 0);
        this.start.fill(-1e6);
    }

    /** How many stand at `time`. */
    standing(time) {
        let n = 0;
        for (let i = 0; i < DEVILS; i++) if (time - this.start[i] < DEVIL_LIFE && this.u.tables.devils[i * 3 + 2].w > 0) n++;
        return n;
    }

    /** Spin one up; returns its row. */
    spawn({
        x, y, z, time, rgb, height = 120, strength = 1, driftX = 0, driftZ = 0, seed = 0.5,
    }) {
        let slot = 0;
        let oldest = Infinity;
        for (let i = 0; i < DEVILS; i++) {
            if (this.start[i] < oldest) {
                oldest = this.start[i];
                slot = i;
            }
        }
        const rows = this.u.tables.devils;
        rows[slot * 3].set(x, y, z, time);
        rows[slot * 3 + 1].set(rgb[0], rgb[1], rgb[2], height);
        rows[slot * 3 + 2].set(seed, driftX, driftZ, strength);
        this.start[slot] = time;
        return slot;
    }
}
