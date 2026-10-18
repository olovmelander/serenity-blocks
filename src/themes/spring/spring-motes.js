/**
 * Spring — the motes: pollen, dew and spray in the air over the field.
 *
 * One instanced billboard mesh whose instances are written once when spawned and then move in
 * closed form on the GPU (no per-frame CPU work beyond the spawns):
 *
 *   pollen  golden specks shaken out of a clump as its cups open; they drift up and away on the
 *           breeze, glinting where the sun is behind them
 *   dew     a hard drop's spray of dew off the leaves: bright drops that arc and fall
 *   glint   a brief sparkle on a cup a bloom front opens (the light catching a wet petal)
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
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { airClarity } from './spring-light.js';

export const MOTE_KIND = Object.freeze({ pollen: 0, dew: 1, glint: 2 });

/**
 * One instanced quad per mote. Attributes (written once at spawn):
 *   aStart  (x, y, z, born)       aMove  (vx, vy, vz, life)
 *   aLook   (r, g, b, size m)     aKind  (kind, seed, drift, gravity)
 * Motion: p = start + v·age + ½·(0, gravity, 0)·age² + a slow curl (pollen rides the breeze).
 */
export class Motes {
    constructor(u, count = 1024) {
        this.u = u;
        this.count = count;
        this.cursor = 0;
        const quad = new THREE.PlaneGeometry(1, 1);
        quad.deleteAttribute('normal');
        quad.deleteAttribute('uv');
        this.start = new Float32Array(count * 4);
        this.move = new Float32Array(count * 4);
        this.look = new Float32Array(count * 4);
        this.kind = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            this.start[i * 4 + 3] = -1e6;
            this.move[i * 4 + 3] = 0.001;
        }
        this.attr = {
            start: new THREE.InstancedBufferAttribute(this.start, 4).setUsage(THREE.DynamicDrawUsage),
            move: new THREE.InstancedBufferAttribute(this.move, 4).setUsage(THREE.DynamicDrawUsage),
            look: new THREE.InstancedBufferAttribute(this.look, 4).setUsage(THREE.DynamicDrawUsage),
            kind: new THREE.InstancedBufferAttribute(this.kind, 4).setUsage(THREE.DynamicDrawUsage),
        };
        quad.setAttribute('aStart', this.attr.start);
        quad.setAttribute('aMove', this.attr.move);
        quad.setAttribute('aLook', this.attr.look);
        quad.setAttribute('aKind', this.attr.kind);
        this.geometry = quad;
        this.material = this.createMaterial();
        this.mesh = new THREE.InstancedMesh(quad, this.material, count);
        this.mesh.name = 'SpringMotes';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        this.dirty = false;
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'SpringMotes';
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.premultipliedAlpha = true;
        material.fog = false;
        const start = attribute('aStart', 'vec4');
        const move = attribute('aMove', 'vec4');
        const look = attribute('aLook', 'vec4');
        const kind = attribute('aKind', 'vec4');
        const isKind = (k) => float(1.0).sub(smoothstep(0.2, 0.45, kind.x.sub(k).abs()));
        const ageOf = () => u.time.sub(start.w);
        const centre = () => {
            const age = max(ageOf(), 0.0);
            const fall = vec3(0.0, kind.w.mul(age).mul(age).mul(0.5), 0.0);
            const curl = vec3(
                sin(age.mul(1.3).add(kind.y.mul(40.0))),
                cos(age.mul(0.9).add(kind.y.mul(23.0))).mul(0.4),
                cos(age.mul(1.1).add(kind.y.mul(31.0))),
            ).mul(kind.z).mul(age.min(3.0));
            return start.xyz.add(move.xyz.mul(age)).add(fall).add(curl);
        };
        material.vertexNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
            const c = centre();
            const view = cameraViewMatrix.mul(vec4(c, 1.0));
            // At least about a pixel and a half wide, so a far speck does not shimmer away.
            const depth = max(view.z.negate(), 0.01);
            const size = max(look.w, depth.mul(u.pixelAngle).mul(1.6));
            const lifted = view.add(vec4(positionGeometry.xy.mul(size), 0.0, 0.0));
            return alive.select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const t = clamp(age.div(life), 0.0, 1.0);
            const corner = positionGeometry.xy.mul(2.0);
            const r2 = corner.dot(corner);
            const speck = exp(r2.mul(-9.0)).mul(0.9).add(exp(r2.mul(-2.6)).sub(0.08).max(0.0).mul(0.2));
            const fadeIn = smoothstep(0.0, mix(float(0.12), float(0.04), isKind(MOTE_KIND.dew)), t);
            const fadeOut = float(1.0).sub(smoothstep(mix(float(0.55), float(0.3), isKind(MOTE_KIND.glint)), 1.0, t));
            // Specks glint where the sun is behind them (forward scatter).
            const c = centre();
            const view = normalize(c.sub(u.eye));
            const forward = clamp(dot(view, u.sunDir), 0.0, 1.0);
            const f2 = forward.mul(forward);
            const sunlit = u.sun.mul(u.sunUp).mul(float(0.16).add(f2.mul(f2).mul(0.9))).add(u.fill.mul(0.6));
            const power = mix(mix(float(0.7), float(1.0), isKind(MOTE_KIND.dew)), float(2.4), isKind(MOTE_KIND.glint));
            const rgb = look.xyz.mul(sunlit).mul(power).mul(speck).mul(fadeIn)
                .mul(fadeOut)
                .mul(airClarity(u, c).mul(0.7).add(0.3));
            return vec4(rgb, 0.0);
        })();
        return material;
    }

    /** Spawn one mote. `start` and `velocity` in metres and m/s, `born` on the theme clock. */
    spawn({
        x, y, z, vx = 0, vy = 0, vz = 0, born, life = 2, rgb = [1, 1, 1], size = 0.02, kind = MOTE_KIND.pollen,
        seed = 0.5, drift = 0, gravity = 0,
    }) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.count;
        this.start.set([x, y, z, born], i * 4);
        this.move.set([vx, vy, vz, life], i * 4);
        this.look.set([rgb[0], rgb[1], rgb[2], size], i * 4);
        this.kind.set([kind, seed, drift, gravity], i * 4);
        this.dirty = true;
        return i;
    }

    /** Kill every mote (a seek, a new session). */
    clear() {
        for (let i = 0; i < this.count; i++) this.start[i * 4 + 3] = -1e6;
        this.dirty = true;
        this.cursor = 0;
    }

    /** Upload what was written since the last frame. */
    update() {
        if (!this.dirty) return;
        for (const a of Object.values(this.attr)) a.needsUpdate = true;
        this.dirty = false;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose?.();
    }
}
