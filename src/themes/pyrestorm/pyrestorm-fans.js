/**
 * Pyrestorm — fans of fire: the fountains that play along a flank vent while it is fresh.
 *
 * A level-up tears a vent open on the cone's face (pyrestorm-world.js, openVent). The sparks the
 * particle pool throws along it are its spatter; these are its fire: a few fans standing along the
 * vent's head, each a camera-facing quad drawn as the summit's own fountain is (a jet that widens
 * as it climbs, torn into tongues by noise carried up it, white-yellow in its throat, a ragged red
 * crown), so a new vent reads as a second eruption on the mountain at any size, not as one more
 * thread of lava. Each fan is a slot of two uniform rows (its foot and height; its strength, its
 * own seed), written by the world every frame; a fan of no strength is not drawn.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    floor,
    int,
    positionGeometry,
    smoothstep,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { noise3, pyBlackbody } from './pyrestorm-tsl.js';

/** Fans a vent carries, and fans in all (two vents may burn at once). */
export const FANS_PER_VENT = 3;
export const FAN_SLOTS = FANS_PER_VENT * 2;

export function createFans(u, t) {
    const tables = Array.from({ length: FAN_SLOTS * 2 }, () => new THREE.Vector4(0, -1e5, 0, 0));
    const rows = uniformArray(tables, 'vec4');
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const slots = new Float32Array(FAN_SLOTS);
    for (let i = 0; i < FAN_SLOTS; i++) slots[i] = i;
    geometry.setAttribute('aFan', new THREE.InstancedBufferAttribute(slots, 1));
    const slot = attribute('aFan', 'float');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormFans';
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
            foot: a.xyz, height: a.w, power: b.x, seed: b.y,
        };
    };
    const halfOf = (h) => vec2(h.mul(0.55).add(40.0), h.mul(0.7).add(50.0));
    const vLook = varying(vec3(0.0), 'vPyFanLook');
    material.vertexNode = Fn(() => {
        const fan = read();
        const h = fan.height.max(1.0);
        const view = cameraViewMatrix.mul(vec4(fan.foot.add(vec3(0.0, h.mul(0.5), 0.0)), 1.0));
        vLook.assign(vec3(h, fan.power, fan.seed));
        const clip = cameraProjectionMatrix.mul(view.add(vec4(positionGeometry.xy.mul(halfOf(h)).mul(2.0), 0.0, 0.0)));
        return fan.power.greaterThan(0.002).select(clip, vec4(0.0, 0.0, -2.0, 1.0));
    })();
    const vLocal = varying(positionGeometry.xy, 'vPyFanLocal');
    material.outputNode = Fn(() => {
        const c = vLocal.mul(2.0).toVar();
        const h = vLook.x;
        const power = vLook.y;
        const seed = vLook.z;
        const half = halfOf(h);
        // In fan heights: 0 at the vent, 1 where it tops out; across from its axis.
        const yn = c.y.mul(half.y).add(h.mul(0.5)).div(h).toVar();
        const xn = c.x.mul(half.x).div(h).toVar();
        // A fan: wider than the summit's jet for its height (a fissure's fountain).
        const w = clamp(yn, 0.0, 1.3).mul(0.3).add(0.07);
        const ax = xn.div(w).toVar();
        const q = vec3(ax.mul(0.9).add(seed.mul(13.0)), yn.mul(2.8).sub(u.time.mul(2.3)), u.time.mul(0.23).add(seed.mul(7.0)));
        const n1 = noise3(t.lattice, q);
        const n2 = noise3(t.lattice, q.mul(vec3(2.4, 2.1, 1.0)).add(vec3(4.7, 1.3, 2.9)));
        const rag = n1.x.mul(0.62).add(n2.y.mul(0.38)).toVar();
        const reach = float(1.0).sub(smoothstep(0.4, 1.0, yn.add(rag.sub(0.5).mul(0.8))));
        const side = exp(ax.mul(ax).mul(-1.2).mul(rag.mul(0.8).add(0.6)));
        const foot = smoothstep(-0.04, 0.03, yn);
        const body = side.mul(reach).mul(foot).mul(rag.add(0.5));
        const fil = smoothstep(0.52, 0.86, n2.x.mul(0.6).add(n1.y.mul(0.4)));
        const win = float(1.0).sub(c.x.mul(c.x)).max(0.0).mul(float(1.0).sub(c.y.mul(c.y)).max(0.0));
        const T = float(0.9).sub(yn.max(0.0).mul(0.32)).sub(ax.abs().min(2.0).mul(0.07)).add(fil.mul(0.07))
            .clamp(0.3, 0.94);
        const halo = exp(c.dot(c).mul(-2.4)).mul(0.22).mul(win.mul(win));
        const fire = pyBlackbody(T).mul(body).mul(fil.mul(0.5).add(0.5)).mul(win.sqrt())
            .mul(0.62);
        const air = pyBlackbody(float(0.6)).mul(halo);
        return vec4(fire.add(air).mul(power).mul(u.activity.mul(0.5).add(0.5)), 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, FAN_SLOTS);
    mesh.name = 'PyrestormFans';
    mesh.frustumCulled = false;
    mesh.renderOrder = 27;
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
