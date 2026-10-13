/**
 * High Coast — the motes: spray, sea mist off the risen rock, and glints.
 *
 * One instanced billboard mesh whose instances are written once when spawned and then move in
 * closed form on the GPU (no per-frame CPU work beyond the spawns):
 *
 *   spray   droplets thrown up where a hard drop's gust starts, and off every shore in the great
 *           rebound: they arc and fall under gravity, sparkling where the sun catches them
 *   mist    soft breaths of sea mist that rise off the risen rock while the sea runs off it
 *   glint   brief sun-sparks on the wet rock after a lift
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
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { airClarity } from './high-coast-light.js';

export const MOTE_KIND = Object.freeze({ spray: 0, mist: 1, glint: 2 });

/**
 * One instanced quad per mote. Attributes (written once at spawn):
 *   aStart  (x, y, z, born)       aMove  (vx, vy, vz, life)
 *   aLook   (r, g, b, size m)     aKind  (kind, seed, drift, gravity)
 * Motion: p = start + v·age + ½·(0, gravity, 0)·age², mist also curls a little as it rises.
 */
export class Motes {
    constructor(u, count = 2048) {
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
        this.mesh.name = 'HighCoastMotes';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        this.dirty = false;
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'HighCoastMotes';
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
            const curl = vec3(sin(age.mul(0.9).add(kind.y.mul(40.0))), 0.0, cos(age.mul(0.7).add(kind.y.mul(31.0)))).mul(kind.z).mul(age.min(4.0));
            return start.xyz.add(move.xyz.mul(age)).add(fall).add(curl);
        };
        material.vertexNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
            const c = centre();
            const view = cameraViewMatrix.mul(vec4(c, 1.0));
            // Mist swells as it rises; spray and glints keep their size.
            const size = look.w.mul(float(1.0).add(age.div(life).mul(1.4).mul(isKind(MOTE_KIND.mist))));
            const flat = mix(vec2(1.0, 1.0), vec2(1.9, 0.5), isKind(MOTE_KIND.mist));
            const lifted = view.add(vec4(positionGeometry.xy.mul(flat).mul(size), 0.0, 0.0));
            return alive.select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const t = clamp(age.div(life), 0.0, 1.0);
            const corner = positionGeometry.xy.mul(2.0);
            const r2 = corner.dot(corner);
            const droplet = exp(r2.mul(-16.0)).mul(0.9).add(exp(r2.mul(-4.0)).sub(0.02).max(0.0).mul(0.25));
            const puff = exp(r2.mul(-3.2)).sub(0.04).max(0.0);
            const shape = mix(droplet, puff, isKind(MOTE_KIND.mist));
            const fadeIn = smoothstep(0.0, mix(float(0.05), float(0.25), isKind(MOTE_KIND.mist)), t);
            const fadeOut = float(1.0).sub(smoothstep(0.5, 1.0, t));
            // Droplets sparkle where the sun is behind them (forward scatter), mist glows softly.
            const c = centre();
            const view = normalize(c.sub(u.eye));
            const forward = clamp(dot(view, u.sunDir), 0.0, 1.0);
            const f2 = forward.mul(forward);
            const sunlit = u.sun.mul(u.sunUp).mul(float(0.12).add(f2.mul(f2).mul(0.9))).add(u.fill.mul(0.8));
            const power = mix(mix(float(1.0), float(0.08), isKind(MOTE_KIND.mist)), float(2.6), isKind(MOTE_KIND.glint));
            const clarity = airClarity(u, c);
            const rgb = look.xyz.mul(sunlit).mul(power).mul(shape).mul(fadeIn)
                .mul(fadeOut)
                .mul(clarity.mul(0.7).add(0.3));
            return vec4(rgb, 0.0);
        })();
        return material;
    }

    /** Spawn one mote. `start` and `velocity` in metres and m/s, `born` on the theme clock. */
    spawn({
        x, y, z, vx = 0, vy = 0, vz = 0, born, life = 2, rgb = [1, 1, 1], size = 0.4, kind = MOTE_KIND.spray, seed = 0.5, drift = 0, gravity = -9.8,
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
