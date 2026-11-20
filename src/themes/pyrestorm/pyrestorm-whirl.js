/**
 * Pyrestorm — fire whirls: what a twist raises off the near lava.
 *
 * Over a lava river the hot air spins up, now and then, into a whirl of flame: a thin column a
 * few hundred metres tall that leans and wanders, strands of fire winding up round it. Each whirl
 * is one tall quad standing at its place and turned about its upright axis to face the eye; the
 * picture is drawn in the quad's own frame: two helices of flame (the strand in front of the
 * axis bright, the one passing behind it dim, so the column reads as turning), a ragged core
 * carried up it by noise, a hot foot where it stands on the lava and a crown that tears away as
 * it thins. It grows up from its foot, stands a few seconds, then lifts off and is gone.
 *
 * Slots are rows of one uniform array (place and birth; height, width, strength and seed), live
 * rows first, as the bolts' are; nothing is built or destroyed when a whirl comes or goes.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    exp,
    float,
    floor,
    int,
    max,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { noise3, pyBlackbody } from './pyrestorm-tsl.js';

export const WHIRL_SLOTS = 3;
/** Seconds a whirl takes to climb to its height, and how long it lives in all. */
export const WHIRL_RISE = 0.9;
export const WHIRL_LIFE = 6.5;
/** Turns of each strand up the column, and how fast the column turns (rad/s). */
const TURNS = 2.3;
const SPIN = 9;

/** A whirl's strength at an age (the CPU's twin of the shader's envelope): 0 … 1. */
export function whirlEnvelope(age, life = WHIRL_LIFE) {
    if (!(age >= 0) || age >= life) return 0;
    const up = Math.min(1, age / 0.5);
    const out = 1 - Math.min(1, Math.max(0, (age - life * 0.62) / (life * 0.38)));
    return up * out * out * (3 - 2 * out);
}

export function createWhirls(u, t) {
    const tables = Array.from({ length: WHIRL_SLOTS * 2 }, () => new THREE.Vector4(0, -1e5, 0, -1e6));
    const rows = uniformArray(tables, 'vec4');
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 20);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const slots = new Float32Array(WHIRL_SLOTS);
    for (let i = 0; i < WHIRL_SLOTS; i++) slots[i] = i;
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
    const slot = attribute('aSlot', 'float');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormWhirl';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    const read = () => {
        const base = int(floor(slot.add(0.5))).mul(2);
        const a = rows.element(base);
        const b = rows.element(base.add(1));
        return {
            at: a.xyz, born: a.w, height: b.x, width: b.y, power: b.z, seed: b.w,
        };
    };
    const vAge = varying(float(0.0), 'vPyWhirlAge');
    const vLook = varying(vec3(0.0), 'vPyWhirlLook');
    material.vertexNode = Fn(() => {
        const w = read();
        const age = u.time.sub(w.born);
        const y = positionGeometry.y.add(0.5);
        // Turned about its upright axis to face the eye.
        const facing = normalize(u.eye.xz.sub(w.at.xz).add(vec2(1e-3, 0.0)));
        const right = vec3(facing.y.negate(), 0.0, facing.x);
        // It leans downwind and wanders as it climbs (more the higher up), and lifts off at the end.
        const sway = sin(y.mul(5.3).sub(u.time.mul(2.1)).add(w.seed.mul(40.0))).mul(0.11)
            .add(sin(y.mul(2.1).add(u.time.mul(0.9)).add(w.seed.mul(17.0))).mul(0.16))
            .mul(y)
            .add(y.mul(y).mul(0.22));
        const lift = smoothstep(WHIRL_LIFE * 0.62, WHIRL_LIFE, age).mul(w.height).mul(0.5);
        const P = w.at
            .add(vec3(0.0, y.mul(w.height).add(lift), 0.0))
            .add(right.mul(positionGeometry.x.mul(w.width).mul(2.0).add(sway.mul(w.height))));
        vAge.assign(age);
        vLook.assign(vec3(w.power, w.seed, w.height.div(w.width.max(1.0))));
        const live = w.power.greaterThan(0.0).and(age.greaterThanEqual(0.0)).and(age.lessThan(WHIRL_LIFE));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P, 1.0)));
        return live.select(clip, vec4(0.0, 0.0, -2.0, 1.0));
    })();
    const vLocal = varying(positionGeometry.xy, 'vPyWhirlLocal');
    material.outputNode = Fn(() => {
        const y = vLocal.y.add(0.5).toVar();
        const x = vLocal.x.mul(2.0).toVar();
        const age = vAge;
        const power = vLook.x;
        const seed = vLook.y;
        // A funnel: a wide foot of flame on the lava, a thin waist, opening as it climbs.
        const girth = exp(y.mul(-9.0)).mul(0.5).add(y.mul(0.34)).add(0.13)
            .toVar();
        const a = x.div(girth).toVar();
        // Noise carried up the column tears everything it draws.
        const q = vec3(a.mul(1.2).add(seed.mul(9.0)), y.mul(vLook.z).mul(0.42).sub(u.time.mul(3.4)), u.time.mul(0.3).add(seed.mul(5.0)));
        const n = noise3(t.lattice, q);
        const n2 = noise3(t.lattice, q.mul(vec3(2.3, 2.6, 1.0)).add(vec3(3.3, 0.7, 1.9)));
        // Wisps wind up round the axis, each at its own pitch, broken along their length; the
        // column turns, so they climb. In front of the axis a wisp is bright, behind it dim.
        const wisp = (phase, turns, wide, cut) => {
            const ang = y.mul(turns * 6.2832).sub(u.time.mul(SPIN)).add(phase).add(seed.mul(31.0))
                .add(n.y.mul(1.6));
            const front = cos(ang).mul(0.5).add(0.5);
            const d = a.sub(sin(ang).mul(0.78));
            return exp(d.mul(d).div(wide * wide).negate()).mul(front.mul(0.85).add(0.15)).mul(smoothstep(cut, cut + 0.3, n2.x.add(front.mul(0.25))));
        };
        const strands = wisp(0.0, TURNS, 0.13, 0.22).add(wisp(2.2, TURNS * 0.8, 0.1, 0.3)).add(wisp(4.3, TURNS * 1.25, 0.08, 0.36).mul(0.7));
        // The core: thin and bright, flickering; a faint sheath of flame round it.
        const core = exp(a.mul(a).mul(-11.0)).mul(n.x.mul(0.8).add(0.45));
        const sheath = exp(a.mul(a).mul(-1.3)).mul(n2.y.mul(0.6).add(0.15)).mul(0.3);
        // It grows up from its foot; its crown tears; at the end it thins from the foot up.
        const grown = smoothstep(0.0, WHIRL_RISE, age);
        const top = float(1.0).sub(smoothstep(grown.mul(0.6), grown, y.add(n.y.sub(0.5).mul(0.3))));
        const fade = float(1.0).sub(smoothstep(WHIRL_LIFE * 0.62, WHIRL_LIFE, age));
        const thin = smoothstep(float(1.0).sub(fade).mul(0.9).sub(0.12), float(1.0).sub(fade).mul(0.9).add(0.05), y);
        const foot = exp(y.mul(-13.0)).mul(exp(a.mul(a).mul(-0.8)));
        const T = float(0.9).sub(y.mul(0.34)).add(core.mul(0.05)).clamp(0.3, 0.94);
        const light = strands.mul(0.7).add(core.mul(0.95)).add(sheath).add(foot.mul(0.6));
        const win = float(1.0).sub(smoothstep(0.85, 1.0, x.abs()));
        return vec4(pyBlackbody(T).mul(light).mul(top).mul(thin)
            .mul(fade.mul(0.6).add(0.4))
            .mul(win)
            .mul(power)
            .mul(0.7), 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, WHIRL_SLOTS);
    mesh.name = 'PyrestormWhirls';
    mesh.frustumCulled = false;
    mesh.renderOrder = 28;
    return {
        mesh,
        meshes: [mesh],
        tables,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}

export { max };
