/**
 * Neon Dusk — the flight: five gliders come out of the sun, through the pass, and pass over
 * the lens with a line of light behind each.
 *
 * The hull is modelled in Blender (scripts/blender/neon_dusk_glider.py → neon-dusk-glider-model.js):
 * a faceted delta dart, drawn as the dusk draws everything — a dark body with one neon line
 * along every crease (the model carries an edge code a corner, so only its real edges light,
 * never a triangulation's diagonal). Far out in the pass a glider is a spark; over the lens it
 * is a wing forty units across.
 *
 * Two instanced draws (hulls, trails), always in the scene: a glider that is not flying has no
 * size. A flight is a closed form of the time since it set off (a seek lands in the middle of
 * the same flight); the world places the five on the CPU, ten matrices a frame while one is up.
 * On the default layer, so the glass mirrors them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    max,
    min,
    mix,
    normalWorld,
    smoothstep,
    step,
    vec3,
    vec4,
} from 'three/tsl';
import {
    GLIDER, GLIDER_EDGE, GLIDER_KIND, GLIDER_NORMAL, GLIDER_POSITION,
} from './neon-dusk-glider-model.js';
import { RIG } from './neon-dusk-tsl.js';

/**
 * The flight: how many gliders, how much larger than life they are drawn, how long the pass
 * takes (s), where it starts (units out along the sun's bearing, and how high) and ends (units
 * behind the lens, and how high), how the formation is spaced (units to the side, back and up a
 * place), and the trail's length and half-width (in the hull's own metres).
 */
export const FLIGHT = Object.freeze({
    count: 5,
    scale: 3,
    duration: 15,
    from: Object.freeze({ out: 1750, height: 150 }),
    to: Object.freeze({ behind: 130, height: 66 }),
    spacing: Object.freeze({ side: 24, back: 30, up: 3.5 }),
    trail: Object.freeze({ length: 62, half: 0.34 }),
});

/** Where each glider flies in the V: (places to the side, places back). */
const PLACES = Object.freeze([[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2]]);

const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
};

function createHulls(u) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(GLIDER_POSITION, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(GLIDER_NORMAL, 3));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(GLIDER_EDGE, 3));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(GLIDER_KIND, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), GLIDER.length);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskGliders';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.colorNode = Fn(() => {
        const edge = attribute('aEdge', 'vec3');
        const kind = attribute('aKind', 'float');
        // The distance to the nearest drawn edge, in pixels of its own footprint.
        const fw = max(fwidth(edge), vec3(1e-5)).toVar();
        const near = edge.div(fw).toVar();
        const px = min(near.x, min(near.y, near.z)).toVar();
        const line = float(1.0).sub(smoothstep(0.6, 1.8, px));
        const glow = exp(px.mul(-0.22)).mul(0.22);
        // Far out the whole hull is under one line: a spark, not a blaze.
        const small = smoothstep(0.25, 0.8, max(fw.x, max(fw.y, fw.z)));
        const isEngine = step(1.5, kind);
        const isCanopy = step(0.5, kind).mul(float(1.0).sub(isEngine));
        const m = u.mood;
        // A dark body the sun behind it barely lights.
        const lit = clamp(abs(dot(normalWorld, u.sunDir)), 0.0, 1.0);
        const body = m.rangeNear.mul(1.4).add(m.glowHalo.mul(lit.mul(0.05))).toVar();
        body.assign(mix(body, u.ridge.mul(0.16), isCanopy));
        const light = u.ridge.mul(line.add(glow).mul(mix(float(1.7), float(0.8), small)));
        const engine = mix(u.ridge, vec3(2.4), 0.6).mul(isEngine).mul(1.6);
        return body.add(light).add(engine);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, FLIGHT.count);
    mesh.name = 'NeonDuskGliders';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return mesh;
}

function createTrails(u) {
    // Two crossed ribbons behind the engine: seen from any side one of them faces the lens.
    const T = FLIGHT.trail;
    const tail = -GLIDER.length / 2;
    const position = [];
    const coord = [];
    const quad = (ax, ay) => {
        const at = (along, across) => [tail - along * T.length, ay * across * T.half, ax * across * T.half];
        const corners = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
        for (const [along, across] of corners) {
            position.push(...at(along, across));
            coord.push(along, across);
        }
    };
    quad(1, 0);
    quad(0, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aTrail', new THREE.BufferAttribute(new Float32Array(coord), 2));
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(FLIGHT.count), 1);
    for (let i = 0; i < FLIGHT.count; i += 1) tint.array[i] = i % 2;
    geometry.setAttribute('iTint', tint);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), T.length);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskGliderTrails';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.outputNode = Fn(() => {
        const t = attribute('aTrail', 'vec2');
        const along = clamp(t.x, 0.0, 1.0);
        const across = clamp(abs(t.y), 0.0, 1.0);
        const k = across.div(0.3);
        const core = exp(k.mul(k).negate()).add(exp(across.mul(-3.6)).mul(0.25));
        const fade = float(1.0).sub(along).mul(float(1.0).sub(along)).mul(smoothstep(0.0, 0.02, along));
        const edge = float(1.0).sub(smoothstep(0.75, 1.0, across));
        const colour = mix(u.ridge, u.ridgeFar, attribute('iTint', 'float'));
        return vec4(colour.mul(core.mul(fade).mul(edge).mul(1.5)), 0.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, FLIGHT.count);
    mesh.name = 'NeonDuskGliderTrails';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
}

export class NeonDuskFlight {
    /** @param {object} u  shared world uniforms */
    constructor(u) {
        this.group = new THREE.Group();
        this.group.name = 'NeonDuskFlight';
        this.hulls = createHulls(u);
        this.trails = createTrails(u);
        this.group.add(this.hulls);
        this.group.add(this.trails);
        this.t0 = -1e6;
        this.live = false;
        /** Where the pass ends beside the lens (units to the side) and each glider's own weave. */
        this.aside = 0;
        this.weave = new Float32Array(FLIGHT.count);
        this._from = new THREE.Vector3();
        this._to = new THREE.Vector3();
        this._f = new THREE.Vector3();
        this._s = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._p = new THREE.Vector3();
        this._x = new THREE.Vector3();
        this._y = new THREE.Vector3();
        this._z = new THREE.Vector3();
        this._m = new THREE.Matrix4();
        this.park();
    }

    /** No glider has a size. */
    park() {
        this._m.makeScale(0, 0, 0);
        for (let i = 0; i < FLIGHT.count; i += 1) {
            this.hulls.setMatrixAt(i, this._m);
            this.trails.setMatrixAt(i, this._m);
        }
        this.hulls.instanceMatrix.needsUpdate = true;
        this.trails.instanceMatrix.needsUpdate = true;
        this.live = false;
    }

    /**
     * A flight sets off at `t0`: out of the sun (the pass, azimuth 0), over the lens, ending
     * `aside` units beside it (the generator `r` draws that and each glider's weave).
     */
    start(t0, r) {
        this.t0 = t0;
        this.aside = (r() - 0.5) * 70;
        for (let i = 0; i < FLIGHT.count; i += 1) this.weave[i] = r() * Math.PI * 2;
        this.live = true;
    }

    /** How far through its pass the flight is at `t` (0..1), or −1 when none is up. */
    progress(t) {
        const k = (t - this.t0) / FLIGHT.duration;
        return k >= 0 && k < 1 ? k : -1;
    }

    /** Place the five for time `t` (`motion` 1, or toward 0 under reduced motion: no weave). */
    update(t, motion = 1) {
        const k = this.progress(t);
        if (k < 0) {
            if (this.live) this.park();
            return;
        }
        this.live = true;
        const F = FLIGHT;
        const from = this._from.set(RIG.x, F.from.height, RIG.z - F.from.out);
        const to = this._to.set(RIG.x + this.aside, F.to.height, RIG.z + F.to.behind);
        const f = this._f.subVectors(to, from).normalize();
        const s = this._s.set(-f.z, 0, f.x).normalize();
        const up = this._up.crossVectors(s, f).normalize();
        // They come up out of the pass and are gone before the pass's end shows.
        const show = smooth(0, 0.04, k) * (1 - smooth(0.97, 1, k));
        for (let i = 0; i < F.count; i += 1) {
            const [side, back] = PLACES[i];
            const sway = Math.sin(t * 0.7 + this.weave[i]) * motion;
            const p = this._p.copy(from).lerp(to, k)
                .addScaledVector(s, side * F.spacing.side + sway * 2.2)
                .addScaledVector(f, -back * F.spacing.back)
                .addScaledVector(up, back * F.spacing.up + Math.cos(t * 0.53 + this.weave[i]) * 1.2 * motion);
            // A little bank with the sway.
            const roll = sway * 0.22;
            const c = Math.cos(roll);
            const n = Math.sin(roll);
            const scale = F.scale * show;
            this._x.copy(f).multiplyScalar(scale);
            this._y.copy(up).multiplyScalar(c).addScaledVector(s, -n).multiplyScalar(scale);
            this._z.copy(s).multiplyScalar(c).addScaledVector(up, n).multiplyScalar(scale);
            this._m.makeBasis(this._x, this._y, this._z).setPosition(p);
            this.hulls.setMatrixAt(i, this._m);
            this.trails.setMatrixAt(i, this._m);
        }
        this.hulls.instanceMatrix.needsUpdate = true;
        this.trails.instanceMatrix.needsUpdate = true;
    }

    clear() {
        this.t0 = -1e6;
        this.park();
    }

    dispose() {
        this.group.removeFromParent();
        this.group.traverse((obj) => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
    }
}
