/**
 * Spring — the motes: what gameplay throws into the air over the field.
 *
 * One instanced billboard mesh whose instances are written once when spawned and then move in
 * closed form on the GPU (no per-frame CPU work beyond the spawns):
 *
 *   pollen  specks shaken out of a clump as its cups open, in the piece's own colour: they drift
 *           up and away on the breeze, glinting where the sun is behind them
 *   dew     a hard drop's spray of dew off the leaves: bright drops that arc and fall
 *   glint   a brief sparkle on a cup a bloom front opens, or on the river's ripples
 *   down    willow seed down: soft white tufts that float, ride the breeze and blaze against the sun
 *   whirl   pollen and down caught in a little whirlwind: they circle a centre as they climb
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
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU } from './spring-core.js';
import { airClarity } from './spring-light.js';
import { AIR } from './spring-air.js';

export const MOTE_KIND = Object.freeze({
    pollen: 0, dew: 1, glint: 2, down: 3, whirl: 4,
});

/** How fast the breeze carries what floats off downwind (m/s², the drift grows with age²). */
const BREEZE_PULL = 0.09;
/**
 * A spawn whose turn in the ring finds a mote still in the air looks this many slots further for
 * the one with the least life left (a busy moment then gives up its glints and spray, which live
 * a second, before the pollen and down still drifting).
 */
export const MOTE_PROBE = 16;

/**
 * One instanced quad per mote. Attributes (written once at spawn):
 *   aStart  (x, y, z, born)       aMove  (vx, vy, vz, life)
 *   aLook   (r, g, b, size m)     aKind  (kind, seed, drift, gravity)
 * Motion: p = start + v·age + ½·(0, gravity, 0)·age² + a slow curl (pollen rides the breeze),
 * and what floats (pollen, down, a whirl) drifts off down the breeze. A whirl's aMove is (radius,
 * climb m/s, turn rad/s) and its drift how fast the radius grows (m/s): it circles `start`.
 */
export class Motes {
    constructor(u, count = 1024) {
        this.u = u;
        this.count = count;
        this.cursor = 0;
        /** The theme clock as of the last frame (the world sets it): what is still in the air. */
        this.now = -Infinity;
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
        // The mote's light (rgb) and whether it is down (w), worked out once a corner.
        const vGlow = varying(vec4(0.0), 'spMoteGlow');
        material.vertexNode = Fn(() => {
            const age = u.time.sub(start.w);
            const life = move.w;
            const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
            const a = max(age, 0.0);
            const dew = isKind(MOTE_KIND.dew);
            const glint = isKind(MOTE_KIND.glint);
            const down = isKind(MOTE_KIND.down);
            const whirl = isKind(MOTE_KIND.whirl);
            const floats = float(1.0).sub(dew).sub(glint);
            // Thrown: a line, an arc under gravity, a slow curl.
            const fall = vec3(0.0, kind.w.mul(a).mul(a).mul(0.5), 0.0);
            const curl = vec3(
                sin(a.mul(1.3).add(kind.y.mul(40.0))),
                cos(a.mul(0.9).add(kind.y.mul(23.0))).mul(0.4),
                cos(a.mul(1.1).add(kind.y.mul(31.0))),
            ).mul(kind.z).mul(a.min(3.0));
            const thrown = start.xyz.add(move.xyz.mul(a)).add(fall).add(curl);
            // Whirled: round the centre, climbing, the circle widening.
            const turn = kind.y.mul(TAU).add(move.z.mul(a));
            const radius = move.x.add(kind.z.mul(a));
            const whirled = start.xyz.add(vec3(cos(turn).mul(radius), move.y.mul(a), sin(turn).mul(radius))).add(fall);
            const breeze = vec3(AIR.breeze[0], 0.0, AIR.breeze[1]).mul(a.mul(a).mul(BREEZE_PULL).mul(floats));
            const c = mix(thrown, whirled, whirl).add(breeze).toVar();
            const view = cameraViewMatrix.mul(vec4(c, 1.0));
            // At least about a pixel and a half wide, so a far speck does not shimmer away; its light
            // is spread thinner when it is drawn wider than it is.
            const depth = max(view.z.negate(), 0.01);
            const drawn = max(look.w, depth.mul(u.pixelAngle).mul(1.6));
            const cover = look.w.div(drawn).pow(2.0);
            const lifted = view.add(vec4(positionGeometry.xy.mul(drawn), 0.0, 0.0));

            const t = clamp(a.div(life), 0.0, 1.0);
            const fadeIn = smoothstep(0.0, mix(mix(float(0.12), float(0.04), dew), float(0.2), down), t);
            const fadeOut = float(1.0).sub(smoothstep(mix(float(0.55), float(0.3), glint), 1.0, t));
            // Specks glint where the sun is behind them (forward scatter); down blazes. Pollen keeps
            // its colour in the shade too, so a piece's dust reads against the turf.
            const V = normalize(c.sub(u.eye));
            const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
            const a2 = ahead.mul(ahead);
            const thrownPhase = a2.mul(a2).mul(0.9).add(0.16);
            const dustPhase = a2.mul(a2).mul(2.2).add(a2.mul(0.5)).add(0.25);
            const downPhase = a2.mul(a2).mul(3.6).add(a2.mul(0.4)).add(0.3);
            const phase = mix(mix(thrownPhase, dustPhase, floats), downPhase, down);
            const shade = floats.sub(down).max(0.0).mul(0.18);
            const lit = u.sun.mul(u.sunUp).mul(phase).add(u.fill.mul(0.6)).add(shade);
            const sparkle = mix(
                float(1.0),
                sin(a.mul(mix(6.0, 13.0, kind.y)).add(kind.y.mul(50.0))).mul(0.4).add(0.6),
                floats.sub(down).max(0.0),
            );
            const power = mix(mix(mix(float(1.3), float(1.0), dew), float(2.4), glint), float(0.8), down);
            // A piece's pollen glows in its colour: lifted toward white, so a dark blue still reads.
            const pigment = floats.sub(down).max(0.0);
            const tone = mix(look.xyz, look.xyz.mul(1.3).add(0.12), pigment);
            const rgb = tone.mul(lit).mul(power).mul(sparkle).mul(fadeIn)
                .mul(fadeOut)
                .mul(cover.mul(0.6).add(0.4))
                .mul(airClarity(u, c).mul(0.7).add(0.3));
            vGlow.assign(vec4(rgb, down));
            return alive.select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const corner = positionGeometry.xy.mul(2.0);
            const r2 = corner.dot(corner);
            // (Ended inside the quad's circle, so a near tuft never shows the quad's square.)
            const round = clamp(float(1.0).sub(r2), 0.0, 1.0);
            const speck = exp(r2.mul(-9.0)).mul(0.9).add(exp(r2.mul(-2.6)).sub(0.08).max(0.0).mul(0.2));
            const tuft = exp(r2.mul(-2.0)).mul(0.75).add(exp(r2.mul(-8.0)).mul(0.5));
            return vec4(vGlow.xyz.mul(mix(speck, tuft, vGlow.w)).mul(round.mul(round)), 0.0);
        })();
        return material;
    }

    /** The ring's next slot: its turn, or (when that mote is still in the air) the one near it with the least life left. */
    nextSlot() {
        let i = this.cursor;
        const { now, start, move } = this;
        if (Number.isFinite(now)) {
            let left = start[i * 4 + 3] + move[i * 4 + 3] - now;
            for (let k = 1; k <= MOTE_PROBE && left > 0; k++) {
                const j = (this.cursor + k) % this.count;
                const there = start[j * 4 + 3] + move[j * 4 + 3] - now;
                if (there < left) {
                    left = there;
                    i = j;
                }
            }
        }
        this.cursor = (i + 1) % this.count;
        return i;
    }

    /** Spawn one mote. `start` and `velocity` in metres and m/s, `born` on the theme clock. */
    spawn({
        x, y, z, vx = 0, vy = 0, vz = 0, born, life = 2, rgb = [1, 1, 1], size = 0.02, kind = MOTE_KIND.pollen,
        seed = 0.5, drift = 0, gravity = 0,
    }) {
        const i = this.nextSlot();
        this.start.set([x, y, z, born], i * 4);
        this.move.set([vx, vy, vz, life], i * 4);
        this.look.set([rgb[0], rgb[1], rgb[2], size], i * 4);
        this.kind.set([kind, seed, drift, gravity], i * 4);
        this.dirty = true;
        return i;
    }

    /**
     * Spawn one mote of a whirl: circling (x, z) at `radius` m, from height y, climbing `climb` m/s,
     * turning `turn` rad/s (positive clockwise seen from above) from the angle `seed` · τ, its
     * circle widening `grow` m/s.
     */
    whirl({
        x, y, z, radius = 1, climb = 1, turn = 3, grow = 0, born, life = 4, rgb = [1, 1, 1], size = 0.014,
        seed = 0.5, gravity = 0,
    }) {
        return this.spawn({
            x,
            y,
            z,
            vx: radius,
            vy: climb,
            vz: turn,
            born,
            life,
            rgb,
            size,
            kind: MOTE_KIND.whirl,
            seed,
            drift: grow,
            gravity,
        });
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
