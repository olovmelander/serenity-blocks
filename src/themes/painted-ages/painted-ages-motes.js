/**
 * Painted Ages — the motes: pigment dust, sparks, rain and the dust devil's swirl.
 *
 * One instanced billboard mesh whose instances are written once when spawned and then move in
 * closed form on the GPU (no per-frame CPU work beyond the spawns).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { airClarity } from './painted-ages-light.js';

export const MOTE_KIND = Object.freeze({
    dust: 0, spark: 1, rain: 2, devil: 3,
});

/**
 * One instanced quad per mote. Attributes (written once at spawn):
 *   aStart  (x, y, z, born)       aMove  (vx, vy, vz, life)
 *   aLook   (r, g, b, size m)     aKind  (kind, seed, swirl radius, rise accel)
 * Motion: p = start + v·age + ½·(0, rise, 0)·age², plus a curl (dust drifts and turns), or for a
 * dust devil a helix about the start point; rain falls straight and stretches along its fall.
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
        // Born far in the past: every slot starts dead.
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
        this.mesh.name = 'PaintedAgesMotes';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        this.dirty = false;
        this.dirtyFrom = count;
        this.dirtyTo = -1;
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'PaintedAgesMotes';
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
            const drift = start.xyz.add(move.xyz.mul(age)).add(vec3(0.0, kind.w.mul(age).mul(age).mul(0.5), 0.0));
            // Dust curls as it drifts.
            const curl = vec3(sin(age.mul(1.3).add(kind.y.mul(40.0))), 0.0, cos(age.mul(1.1).add(kind.y.mul(31.0)))).mul(kind.z).mul(age.min(3.0));
            // The dust devil's helix: round its axis, rising.
            const lift = move.y.mul(age);
            const turn = age.mul(3.2).add(kind.y.mul(6.283));
            // A funnel: tight at the ground, opening as it climbs.
            const r = kind.z.mul(float(0.3).add(lift.mul(0.014)));
            const helix = start.xyz.add(vec3(cos(turn).mul(r), lift, sin(turn).mul(r)));
            return mix(drift.add(curl.mul(float(1.0).sub(isKind(MOTE_KIND.devil)))), helix, isKind(MOTE_KIND.devil));
        };
        material.vertexNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
            const c = centre();
            const view = cameraViewMatrix.mul(vec4(c, 1.0));
            const size = look.w.mul(float(1.0).add(age.div(life).mul(0.6).mul(isKind(MOTE_KIND.dust))));
            // Rain: a streak along its fall, in view space.
            const fall = cameraViewMatrix.mul(vec4(move.xyz, 0.0)).xyz;
            const streak = isKind(MOTE_KIND.rain);
            const corner = positionGeometry.xy;
            const along = vec2(fall.x, fall.y).normalize().mul(corner.y).mul(size.mul(14.0))
                .mul(streak);
            const across = vec2(corner.x, corner.y.mul(float(1.0).sub(streak))).mul(size);
            const lifted = view.add(vec4(across.add(along), 0.0, 0.0));
            // A dead mote collapses behind the far plane.
            return alive.select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const age = ageOf();
            const life = move.w;
            const t = clamp(age.div(life), 0.0, 1.0);
            const corner = positionGeometry.xy.mul(2.0);
            const r2 = corner.dot(corner);
            // A bright core inside a soft halo: a glinting grain, not a cotton ball.
            const disc = exp(r2.mul(-14.0)).mul(0.8).add(exp(r2.mul(-3.2)).sub(0.04).max(0.0).mul(0.35));
            const fadeIn = smoothstep(0.0, 0.08, t);
            const fadeOut = float(1.0).sub(smoothstep(0.55, 1.0, t));
            // Sparks burn bright and short; dust glows in the sun; rain is a faint silver.
            // Pigment dust glows in its own colour (lit by the sun a little more); sparks burn hot.
            const sunlit = u.sun.mul(u.sunUp).mul(0.1).add(u.fill.mul(0.4)).add(0.9);
            const lightOf = mix(sunlit, vec3(1.0, 1.0, 1.0), isKind(MOTE_KIND.spark));
            const power = mix(float(1.4), float(3.2), isKind(MOTE_KIND.spark)).mul(mix(float(1.0), float(0.3), isKind(MOTE_KIND.rain)));
            const clarity = airClarity(this.u, centre());
            const rgb = look.xyz.mul(lightOf).mul(power).mul(disc).mul(fadeIn)
                .mul(fadeOut)
                .mul(clarity.mul(0.7).add(0.3));
            return vec4(rgb, 0.0);
        })();
        return material;
    }

    /**
     * Spawn one mote. `start` and `velocity` in metres and m/s, `born` on the theme clock.
     */
    spawn({
        x, y, z, vx = 0, vy = 0, vz = 0, born, life = 3, rgb = [1, 1, 1], size = 1, kind = MOTE_KIND.dust, seed = Math.random(), swirl = 0, rise = 0,
    }) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.count;
        this.start.set([x, y, z, born], i * 4);
        this.move.set([vx, vy, vz, life], i * 4);
        this.look.set([rgb[0], rgb[1], rgb[2], size], i * 4);
        this.kind.set([kind, seed, swirl, rise], i * 4);
        this.dirtyFrom = Math.min(this.dirtyFrom, i);
        this.dirtyTo = Math.max(this.dirtyTo, i);
        this.dirty = true;
        return i;
    }

    /** Kill every mote (a seek, a new session). */
    clear() {
        for (let i = 0; i < this.count; i++) this.start[i * 4 + 3] = -1e6;
        this.dirtyFrom = 0;
        this.dirtyTo = this.count - 1;
        this.dirty = true;
        this.cursor = 0;
    }

    /** Upload what was written since the last frame (whole buffers: partial updates are unreliable). */
    update() {
        if (!this.dirty) return;
        for (const a of Object.values(this.attr)) a.needsUpdate = true;
        this.dirty = false;
        this.dirtyFrom = this.count;
        this.dirtyTo = -1;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose?.();
    }
}
